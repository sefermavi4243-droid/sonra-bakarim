// Arka plan: sağ tık menüsü, kısayol, kayıtların takibi, rozet ve bildirimler.
import { FAIL_TEXT, api, dueOf, getConfig, readTab, sendCapture, shortDate, waitCapture } from './lib.js';

const MENU = {
  page: 'sb-page',
  selection: 'sb-selection',
  link: 'sb-link',
  image: 'sb-image',
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.page, title: 'Rafa kaldır: bu sayfa', contexts: ['page'] });
    chrome.contextMenus.create({ id: MENU.selection, title: 'Rafa kaldır: seçili metin', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU.link, title: 'Rafa kaldır: bu link', contexts: ['link'] });
    chrome.contextMenus.create({ id: MENU.image, title: 'Rafa kaldır: bu görsel', contexts: ['image'] });
  });
  chrome.alarms.create('badge', { periodInMinutes: 15 });
  refreshBadge();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('badge', { periodInMinutes: 15 });
  refreshBadge();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'badge') refreshBadge();
});

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
    refreshBadge().then(() => reply({ ok: true }));
    return true;
  }
  return false;
});

function notify(id, title, message) {
  chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 0 });
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
    notify(`sb-${Date.now()}`, 'Kaydedilemedi', err.message);
  }
}

const tracking = new Set();

async function track(id, title) {
  if (tracking.has(id)) return;
  tracking.add(id);
  try {
    const status = await waitCapture(id);
    if (status.state === 'saved') {
      const due = dueOf(status.item);
      notify(id, `Rafa koydum: ${status.item.title}`, due ? `Son tarih: ${shortDate(due)}` : 'Tarihsiz kaydedildi.');
    } else if (status.state === 'duplicate') {
      const due = dueOf(status.item);
      notify(id, 'Bu zaten rafta', `${status.item.title}${due ? ` · ${shortDate(due)}` : ''}`);
    } else {
      notify(id, 'Kaydedilemedi', FAIL_TEXT[status.reason] || FAIL_TEXT.error);
    }
  } catch (err) {
    notify(id, 'Kaydedilemedi', err.message || title || '');
  } finally {
    tracking.delete(id);
    refreshBadge();
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

// Daha önce kaydedilen bir sayfa açılınca günde bir kez hatırlat.
chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status !== 'complete' || !/^https?:/.test(tab.url || '')) return;
  const { token } = await getConfig();
  if (!token) return;
  try {
    const { item } = await api(`/api/lookup?url=${encodeURIComponent(tab.url)}`);
    if (!item) return;
    const key = `seen:${item.id}:${new Date().toDateString()}`;
    const seen = await chrome.storage.session.get(key);
    if (seen[key]) return;
    await chrome.storage.session.set({ [key]: true });
    const due = dueOf(item);
    notify(`seen-${item.id}`, 'Bu sayfa rafında', `${item.title}${due ? ` · son tarih ${shortDate(due)}` : ''}`);
  } catch {
    // Sunucu kapalıysa sessiz geç.
  }
});
