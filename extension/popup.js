import { DEFAULT_SERVER, FAIL_TEXT, api, dueOf, enqueueCapture, getConfig, queueSize, readTab, relative, sendCapture, setConfig, shortDate, waitCapture } from './lib.js';

const $ = (id) => document.getElementById(id);
let currentTab = null;

async function init() {
  const cfg = await getConfig();
  $('server').value = cfg.server;
  $('openPanel').hidden = !cfg.token;
  $('openPanel').onclick = () => chrome.tabs.create({ url: cfg.server });
  if (!cfg.token) return showConnect();
  showMain();
}

function showConnect() {
  $('connect').hidden = false;
  $('main').hidden = true;
  $('code').focus();
}

async function showMain() {
  $('connect').hidden = true;
  $('main').hidden = false;
  [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('pageTitle').textContent = currentTab?.title || currentTab?.url || 'Bu sekme';
  $('save').focus();
  await Promise.all([loadPageState(), loadUpcoming()]);
  await loadExtras();
}

async function loadPageState() {
  const el = $('pageState');
  el.className = 'page-state';
  if (!/^https?:/.test(currentTab?.url || '')) {
    el.textContent = 'Bu sayfa kaydedilemez.';
    $('save').disabled = true;
    return;
  }
  el.textContent = new URL(currentTab.url).hostname.replace(/^www\./, '');
  try {
    const { item } = await api(`/api/lookup?url=${encodeURIComponent(currentTab.url)}`);
    if (item) {
      const due = dueOf(item);
      el.textContent = `Rafında${due ? ` · son tarih ${shortDate(due)}` : ''}`;
      el.classList.add('saved');
      $('save').textContent = 'Tekrar gönder';
    }
  } catch (err) {
    if (err.status === 401) return showConnect();
  }
}

async function loadUpcoming() {
  const ul = $('upcoming');
  ul.textContent = '';
  try {
    const { items } = await api('/api/items?status=open');
    const dated = items.filter(dueOf).slice(0, 5);
    $('emptyUpcoming').hidden = dated.length > 0;
    for (const item of dated) ul.append(row(item));
  } catch (err) {
    if (err.status === 401) return showConnect();
    $('emptyUpcoming').hidden = false;
    $('emptyUpcoming').textContent = err.message;
  }
}

function row(item) {
  const li = document.createElement('li');
  const what = document.createElement('div');
  what.className = 'what';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = item.title;
  title.title = item.title;
  const when = document.createElement('div');
  const due = dueOf(item);
  const rel = relative(due);
  when.className = `when${rel === 'geçti' ? ' late' : rel === 'bugün' || rel === 'yarın' ? ' soon' : ''}`;
  when.textContent = `${shortDate(due)} · ${rel}`;
  what.append(title, when);
  const done = document.createElement('button');
  done.className = 'small';
  done.textContent = 'Yaptım';
  done.onclick = async () => {
    done.disabled = true;
    try {
      await api(`/api/items/${item.id}/done`, { method: 'POST' });
      li.remove();
      chrome.runtime.sendMessage({ type: 'refresh' });
    } catch (err) {
      done.disabled = false;
      done.textContent = 'Tekrar dene';
      done.title = err.message;
    }
  };
  li.append(what, done);
  return li;
}

$('connectForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('connectError');
  err.textContent = '';
  const server = ($('server').value || DEFAULT_SERVER).trim().replace(/\/$/, '');
  await setConfig({ server });
  // Yerel ağ dışındaki bir sunucu için erişim izni iste.
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(server)) {
    const granted = await chrome.permissions.request({ origins: [`${server}/*`] });
    if (!granted) {
      err.textContent = 'Bu sunucuya erişim izni verilmedi.';
      return;
    }
  }
  try {
    const browser = navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome';
    const { token } = await api('/api/link', { method: 'POST', body: { code: $('code').value, name: `${browser} uzantısı` } });
    await setConfig({ token });
    chrome.runtime.sendMessage({ type: 'refresh' });
    init();
  } catch (e2) {
    err.textContent = e2.message;
  }
});

$('save').addEventListener('click', async () => {
  const btn = $('save');
  const status = $('saveStatus');
  btn.disabled = true;
  status.className = 'status';
  status.textContent = 'Sayfa okunuyor…';
  let payload = null;
  try {
    const page = await readTab(currentTab);
    payload = { ...page, note: $('note').value };
    if (page.structured) status.textContent = 'Sayfanın kendi tarih bilgisi bulundu, okunuyor…';
    const id = await sendCapture(payload);
    // Pencere kapansa da arka plan takip edip bildirim gösterir.
    chrome.runtime.sendMessage({ type: 'track', id, title: page.title });
    status.textContent = 'Son tarih aranıyor… Pencereyi kapatabilirsin, bitince bildirim gelir.';
    const result = await waitCapture(id, (ms) => {
      status.textContent = `Son tarih aranıyor… ${Math.round(ms / 1000)} sn`;
    });
    if (result.state === 'saved' || result.state === 'duplicate') {
      const due = dueOf(result.item);
      status.className = 'status ok';
      status.textContent =
        result.state === 'saved'
          ? `Rafa koydum: ${result.item.title}${due ? ` · ${shortDate(due)}` : ''}`
          : `Zaten rafta: ${result.item.title}`;
      $('note').value = '';
      loadPageState();
      loadUpcoming();
    } else {
      status.className = 'status err';
      status.textContent = FAIL_TEXT[result.reason] || FAIL_TEXT.error;
    }
  } catch (err) {
    if (err.status === 401) return showConnect();
    if (err.status === 0 && payload) {
      const n = await enqueueCapture(payload);
      status.className = 'status';
      status.textContent = `Rafta şu an kapalı; sıraya aldım (${n} bekleyen). Açılınca gönderirim.`;
      $('note').value = '';
      loadExtras();
      return;
    }
    status.className = 'status err';
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('note').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('save').click();
});

const ALL_SITES = { origins: ['https://*/*', 'http://*/*'] };

async function loadExtras() {
  const pending = await queueSize();
  $('queueInfo').hidden = pending === 0;
  $('queueInfo').textContent = `${pending} kayıt sırada; Rafta açılınca gönderilecek.`;
  $('highlightBox').hidden = await chrome.permissions.contains(ALL_SITES);
}

$('allowHighlight').addEventListener('click', async () => {
  const granted = await chrome.permissions.request(ALL_SITES);
  $('highlightBox').hidden = granted;
});

$('disconnect').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    // Sunucu kapalı olsa da yerel anahtarı sil.
  }
  await chrome.storage.local.remove('token');
  chrome.runtime.sendMessage({ type: 'refresh' });
  init();
});

init();
