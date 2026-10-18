// Arka plan: sağ tık menüsü, kısayol, kayıt takibi, rozet, masaüstü hatırlatmaları,
// kaydedilmiş sayfada vurgu ve sunucu kapalıyken kuyruk.
import { FAIL_TEXT, api, dueOf, enqueueCapture, flushQueue, getConfig, readTab, sendCapture, shortDate, waitCapture } from './lib.js';
import { highlightEvidence } from './page.js';

const MENU = {
  page: 'sb-page',
  selection: 'sb-selection',
  link: 'sb-link',
  image: 'sb-image',
};

const PERIODIC = 'periodic';

function setup() {
  chrome.alarms.create(PERIODIC, { periodInMinutes: 10 });
  tickAll();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.page, title: 'Rafa kaldır: bu sayfa', contexts: ['page'] });
    chrome.contextMenus.create({ id: MENU.selection, title: 'Rafa kaldır: seçili metin', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU.link, title: 'Rafa kaldır: bu link', contexts: ['link'] });
    chrome.contextMenus.create({ id: MENU.image, title: 'Rafa kaldır: bu görsel', contexts: ['image'] });
  });
  setup();
});

chrome.runtime.onStartup.addListener(setup);

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === PERIODIC) tickAll();
  else if (a.name.startsWith('rem:')) fireReminder(a.name.slice(4));
});

/** Rozet, kuyruk ve hatırlatma zamanlayıcıları. */
async function tickAll() {
  await flushPending();
  await Promise.all([refreshBadge(), scheduleReminders()]);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let payload;
  switch (info.menuItemId) {
    case MENU.page:
      payload = await readTab(tab);
      payload.selection = '';
      break;
    case MENU.selection:
      payload = { url: tab?.url, title: tab?.title, selection: info.selectionText };
      break;
    case MENU.link:
      payload = { url: info.linkUrl, title: info.selectionText || '' };
      break;
    case MENU.image:
      payload = { url: tab?.url, title: tab?.title, imageUrl: info.srcUrl };
      break;
    default:
      return;
  }
  await captureAndNotify(payload);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'kaydet') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const page = await readTab(tab);
  await captureAndNotify({ ...page, selection: page.selection || '' });
});

// Açılır pencere kaydı başlatıp kapanabilir; takibi arka plan sürdürür.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'track') {
    track(msg.id, msg.title);
    reply({ ok: true });
  }
  if (msg?.type === 'refresh') {
    tickAll().then(() => reply({ ok: true }));
    return true;
  }
  return false;
});

function notify(id, title, message, extra = {}) {
  chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 0, ...extra });
}

async function captureAndNotify(payload) {
  const { token } = await getConfig();
  if (!token) {
    notify(`sb-${Date.now()}`, 'Rafta bağlı değil', 'Uzantı simgesine tıklayıp Telegram\'dan aldığın kodu gir.');
    return;
  }
  try {
    const id = await sendCapture(payload);
    notify(id, 'Rafa kaldırılıyor', payload.title || payload.url || 'İçerik okunuyor…');
    await track(id, payload.title);
  } catch (err) {
    if (err.status === 0) {
      const n = await enqueueCapture(payload);
      notify(`sb-${Date.now()}`, 'Sıraya aldım', `Rafta şu an kapalı. Açılınca rafa kaldıracağım (${n} bekleyen).`);
    } else {
      notify(`sb-${Date.now()}`, 'Rafa kaldırılamadı', err.message);
    }
  }
}

/** Sunucu yeniden açıldıysa bekleyen kayıtları gönder. */
async function flushPending() {
  const { token } = await getConfig();
  if (!token) return;
  const sent = await flushQueue();
  for (const s of sent) track(s.id, s.title);
}

const tracking = new Set();

async function track(id, title) {
  if (tracking.has(id)) return;
  tracking.add(id);
  try {
    const status = await waitCapture(id);
    if (status.state === 'saved') {
      const due = dueOf(status.item);
      notify(id, `Rafa koydum: ${status.item.title}`, due ? `Son tarih: ${shortDate(due)}` : 'Tarihsiz rafa koydum.');
    } else if (status.state === 'duplicate') {
      const due = dueOf(status.item);
      notify(id, 'Bu zaten rafta', `${status.item.title}${due ? ` · ${shortDate(due)}` : ''}`);
    } else {
      notify(id, 'Rafa kaldırılamadı', FAIL_TEXT[status.reason] || FAIL_TEXT.error);
    }
  } catch (err) {
    notify(id, 'Rafa kaldırılamadı', err.message || title || '');
  } finally {
    tracking.delete(id);
    tickAll();
  }
}

/** Rozet: bugün ve gecikmiş kayıt sayısı. */
async function refreshBadge() {
  const { token } = await getConfig();
  if (!token) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  try {
    const { items } = await api('/api/items?status=open');
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const due = items.filter((i) => dueOf(i) && new Date(dueOf(i)) <= end).length;
    await chrome.action.setBadgeBackgroundColor({ color: '#F26B1D' });
    await chrome.action.setBadgeText({ text: due ? String(due) : '' });
    await chrome.action.setTitle({ title: due ? `Rafta · bugün ${due} iş` : 'Rafa kaldır' });
  } catch {
    await chrome.action.setBadgeText({ text: '' });
  }
}

// --- Masaüstü hatırlatmaları -----------------------------------------------------
// Sunucudaki hatırlatma zamanları için tarayıcıda zamanlayıcı kurulur; vakti gelince
// Telegram'daki mesajla birlikte masaüstünde de bildirim çıkar.

const REM_META = 'remMeta';
const REM_WINDOW_MS = 48 * 3600_000;
const REM_TITLES = {
  plan: 'Başlamak için iyi zaman',
  nudge: 'Hatırlatma',
  last_call: 'Bugün son gün',
  event_eve: 'Yarın etkinlik',
  event_soon: 'Etkinlik yaklaşıyor',
};

async function scheduleReminders() {
  const { token } = await getConfig();
  const existing = (await chrome.alarms.getAll()).filter((a) => a.name.startsWith('rem:'));
  if (!token) {
    for (const a of existing) chrome.alarms.clear(a.name);
    return;
  }
  try {
    const [{ reminders }, { items }] = await Promise.all([api('/api/reminders'), api('/api/items?status=open')]);
    const byId = new Map(items.map((i) => [i.id, i]));
    const now = Date.now();
    const meta = {};
    for (const r of reminders) {
      const at = new Date(r.sendAt).getTime();
      const item = byId.get(r.itemId);
      if (!item || at <= now || at - now > REM_WINDOW_MS) continue;
      meta[r.id] = { itemId: item.id, title: item.title, kind: r.kind, due: dueOf(item), snooze: (item.snoozeOptions || []).some((o) => o.id === '3h') };
      chrome.alarms.create(`rem:${r.id}`, { when: at });
    }
    for (const a of existing) if (!meta[a.name.slice(4)]) chrome.alarms.clear(a.name);
    await chrome.storage.local.set({ [REM_META]: meta });
  } catch {
    // Sunucu kapalıysa mevcut zamanlayıcılar kalır.
  }
}

async function fireReminder(reminderId) {
  const { [REM_META]: meta = {} } = await chrome.storage.local.get(REM_META);
  const m = meta[reminderId];
  if (!m) return;
  const buttons = [{ title: 'Yaptım' }, ...(m.snooze ? [{ title: '3 saat ertele' }] : [])];
  notify(`rem:${m.itemId}`, REM_TITLES[m.kind] || 'Hatırlatma', `${m.title}${m.due ? ` · son tarih ${shortDate(m.due)}` : ''}`, {
    buttons,
    requireInteraction: true,
    priority: 2,
  });
}

chrome.notifications.onButtonClicked.addListener(async (id, index) => {
  if (!id.startsWith('rem:')) return;
  const itemId = id.slice(4);
  chrome.notifications.clear(id);
  try {
    if (index === 0) {
      const { item } = await api(`/api/items/${itemId}/done`, { method: 'POST' });
      notify(`ok-${Date.now()}`, 'Raftan indirdim', item.title);
    } else {
      const { item, remindAt } = await api(`/api/items/${itemId}/snooze`, { method: 'POST', body: { option: '3h' } });
      notify(`ok-${Date.now()}`, 'Erteledim', `${item.title} · ${shortDate(remindAt)}`);
    }
  } catch (err) {
    notify(`err-${Date.now()}`, 'Yapılamadı', err.message);
  }
  tickAll();
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (!id.startsWith('rem:')) return;
  const { server } = await getConfig();
  chrome.tabs.create({ url: `${server}/#raf` });
  chrome.notifications.clear(id);
});

// --- Kaydedilmiş sayfa: vurgu ya da bildirim ------------------------------------

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status !== 'complete' || !/^https?:/.test(tab.url || '')) return;
  const { token } = await getConfig();
  if (!token) return;
  try {
    const { item } = await api(`/api/lookup?url=${encodeURIComponent(tab.url)}`);
    if (!item) return;
    const due = dueOf(item);
    const label = `Rafta · ${due ? `son tarih ${shortDate(due)}` : 'tarihsiz'}`;
    // İzin verildiyse sayfanın içinde vurgula; verilmediyse günde bir masaüstü bildirimi.
    const origin = new URL(tab.url).origin;
    if (await chrome.permissions.contains({ origins: [`${origin}/*`] })) {
      await chrome.scripting.executeScript({ target: { tabId }, func: highlightEvidence, args: [item.deadlineEvidence || '', label] });
      return;
    }
    const key = `seen:${item.id}:${new Date().toDateString()}`;
    const seen = await chrome.storage.session.get(key);
    if (seen[key]) return;
    await chrome.storage.session.set({ [key]: true });
    notify(`seen-${item.id}`, 'Bu sayfa rafında', `${item.title}${due ? ` · son tarih ${shortDate(due)}` : ''}`);
  } catch {
    // Sunucu kapalıysa sessiz geç.
  }
});
