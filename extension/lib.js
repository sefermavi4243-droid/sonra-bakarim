// Uzantının ortak yardımcıları: ayarlar, API çağrıları, sayfa okuma ve tarih biçimi.

export const DEFAULT_SERVER = 'http://localhost:3000';

export async function getConfig() {
  const { server = DEFAULT_SERVER, token = null } = await chrome.storage.local.get(['server', 'token']);
  return { server: server.replace(/\/$/, ''), token };
}

export async function setConfig(patch) {
  await chrome.storage.local.set(patch);
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Sunucu hatası (${status})`);
    this.status = status;
    this.body = body;
  }
}

/** Sunucuya istek; anahtar varsa ekler. Sunucu kapalıysa anlaşılır hata verir. */
export async function api(path, { method = 'GET', body, token } = {}) {
  const cfg = await getConfig();
  const auth = token ?? cfg.token;
  let res;
  try {
    res = await fetch(`${cfg.server}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { message: `Sunucuya ulaşılamadı (${cfg.server}). Rafta bilgisayarında açık mı?` });
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path !== '/api/link') {
    await chrome.storage.local.remove('token');
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/**
 * Sekmedeki sayfanın metnini tarayıcının içinden okur. Giriş isteyen sayfalarda
 * (LinkedIn gibi) sunucu sayfayı açamaz; bu yüzden metin buradan gönderilir.
 */
export async function readTab(tab) {
  const base = { url: tab.url, title: tab.title };
  if (!tab.id || !/^https?:/.test(tab.url || '')) return base;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const root = document.querySelector('article, main, [role="main"]') || document.body;
        const meta = (name) =>
          document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') || '';
        const description = meta('og:description') || meta('description');
        const text = [description, root ? root.innerText : ''].filter(Boolean).join('\n\n');
        return {
          url: location.href,
          title: meta('og:title') || document.title,
          text: text.slice(0, 150000),
          selection: String(window.getSelection() || '').slice(0, 20000),
        };
      },
    });
    return { ...base, ...(res?.result || {}) };
  } catch {
    return base;
  }
}

/** Kayıt isteğini gönderir; işlem arka planda sürer, durum kimliği döner. */
export async function sendCapture(payload) {
  const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => typeof v === 'string' && v.trim() !== ''));
  const { id } = await api('/api/capture', { method: 'POST', body: clean });
  return id;
}

/** Kayıt bitene kadar bekler (en fazla 4 dakika). */
export async function waitCapture(id, onTick) {
  const started = Date.now();
  while (Date.now() - started < 4 * 60_000) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await api(`/api/captures/${encodeURIComponent(id)}`);
    if (status.state !== 'pending') return status;
    onTick?.(Date.now() - started);
  }
  return { state: 'failed', reason: 'timeout' };
}

const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** "24 Eki Cmt 23:59"; gün sonu (23:59) için saat yazılmaz. */
export function shortDate(iso) {
  const d = new Date(iso);
  const day = DAYS[(d.getDay() + 6) % 7];
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${day}${time === '23:59' ? '' : ` ${time}`}`;
}

/** "bugün", "yarın", "3 gün", "geçti". */
export function relative(iso) {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const days = Math.round((that - today) / 86400000);
  if (d < new Date()) return 'geçti';
  if (days === 0) return 'bugün';
  if (days === 1) return 'yarın';
  return `${days} gün`;
}

export function dueOf(item) {
  return item.deadlineAt || item.eventAt;
}

export const FAIL_TEXT = {
  needs_text: 'Bu sayfada okunacak metin bulamadım. Önemli kısmı seçip sağ tıkla "Rafa kaldır: seçili metin" de.',
  unreadable: 'İçeriği okuyamadım. Ekran görüntüsünü Telegram\'dan gönderebilirsin.',
  off_topic: 'Bu sayfada rafa kaldırılacak bir iş, etkinlik ya da başvuru bulamadım.',
  error: 'Bir sorun oldu, birazdan tekrar dener misin?',
  timeout: 'İşlem uzun sürdü. Kayıt yine de Telegram\'a düşebilir.',
};
