// Sonra Bakarım web paneli: ajanda, ay takvimi, arşiv, ayarlar ve kayıt detayı.
// Derleme adımı yok; tarayıcıda doğrudan çalışır.

const $ = (sel) => document.querySelector(sel);

/** Güvenli DOM kurucu: metinler her zaman textContent ile girer. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// --- API -------------------------------------------------------------------------

class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Sunucu hatası (${status})`);
    this.status = status;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'x-sonra-bakarim': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    showLogin();
    throw new ApiError(401, data);
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// --- Tarih yardımcıları ------------------------------------------------------

const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const DAYS_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
const weekdayIndex = (d) => (d.getDay() + 6) % 7; // pazartesi = 0
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isEndOfDay = (d) => d.getHours() === 23 && d.getMinutes() === 59;

function fullDate(d) {
  const time = isEndOfDay(d) ? 'gün sonu' : hhmm(d);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${DAYS[weekdayIndex(d)]}, ${time}`;
}

function dueOf(item) {
  const iso = item.deadlineAt || item.eventAt;
  return iso ? new Date(iso) : null;
}

/** "bugün 18:00", "yarın", "Per 23 Eki", "3 gün geçti". */
function whenText(d) {
  const today = startOfDay(new Date());
  const days = Math.round((startOfDay(d) - today) / 86400000);
  const time = isEndOfDay(d) ? '' : ` ${hhmm(d)}`;
  if (d < new Date()) return days === 0 ? `bugün${time}, geçti` : `${-days} gün geçti`;
  if (days === 0) return `bugün${time}`;
  if (days === 1) return `yarın${time}`;
  if (days < 7) return `${DAYS[weekdayIndex(d)]}${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${DAYS_SHORT[weekdayIndex(d)]}${time}`;
}

function whenClass(d) {
  if (d < new Date()) return 'when late';
  const days = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  return days <= 1 ? 'when soon' : 'when';
}

const CATEGORY = {
  job: 'İş ilanı',
  event: 'Etkinlik',
  application: 'Başvuru',
  tool: 'Denenecek araç',
  read: 'Okunacak',
  task: 'Yapılacak',
  other: 'Diğer',
};

const SOURCE = {
  explicit: 'metinde yazılı',
  inferred: 'göreli ifadeden çözüldü',
  default: 'varsayılan kural',
  user: 'senin verdiğin tarih',
};

function effortText(min) {
  if (!min) return null;
  if (min < 60) return `${min} dk`;
  const h2 = Math.floor(min / 60);
  return min % 60 ? `${h2} sa ${min % 60} dk` : `${h2} saat`;
}

// --- Durum ---------------------------------------------------------------------

const state = {
  items: [],
  me: null,
  view: 'ajanda',
  month: startOfDay(new Date()),
  selectedDay: null,
  openId: null,
};

function toast(text, kind = '') {
  const el = $('#toast');
  el.textContent = text;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), kind === 'err' ? 6000 : 3500);
}

// --- Giriş ---------------------------------------------------------------------

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  closeDrawer();
  $('#loginCode').focus();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    await api('/api/link', { method: 'POST', body: { code: $('#loginCode').value, name: 'Web paneli', cookie: true } });
    $('#loginCode').value = '';
    start();
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});

// --- Veri ---------------------------------------------------------------------

async function load() {
  const { items } = await api('/api/items?status=open');
  state.items = items;
  render();
}

function upsert(item) {
  const i = state.items.findIndex((x) => x.id === item.id);
  const open = item.status === 'open' || item.status === 'snoozed';
  if (i >= 0 && open) state.items[i] = item;
  else if (i >= 0) state.items.splice(i, 1);
  else if (open) state.items.push(item);
  state.items.sort((a, b) => (dueOf(a) ?? Infinity) - (dueOf(b) ?? Infinity));
}

// --- Görünümler --------------------------------------------------------------------

function render() {
  for (const a of document.querySelectorAll('.tabs a')) a.classList.toggle('active', a.dataset.view === state.view);
  for (const v of ['ajanda', 'takvim', 'arsiv', 'ayarlar']) $(`#view-${v}`).hidden = v !== state.view;
  if (state.view === 'ajanda') renderAgenda();
  if (state.view === 'takvim') renderCalendar();
  if (state.view === 'arsiv') renderArchive();
  if (state.view === 'ayarlar') renderSettings();
  if (state.openId) {
    const item = state.items.find((x) => x.id === state.openId);
    if (item) renderDrawer(item);
  }
}

function itemRow(item, { showDate = true } = {}) {
  const d = dueOf(item);
  const meta = [
    item.organization,
    CATEGORY[item.category],
    item.eventAt && item.deadlineAt ? `Etkinlik ${whenText(new Date(item.eventAt))}` : null,
    effortText(item.effortMinutes),
    item.status === 'snoozed' ? 'ertelendi' : null,
  ].filter(Boolean);
  const done = h('button', { class: 'btn done-btn', title: 'Yaptım', onclick: (e) => (e.stopPropagation(), act(item, 'done')) }, 'Yaptım');
  return h(
    'div',
    {
      class: `item cat-${item.category}`,
      tabindex: '0',
      role: 'button',
      onclick: () => openDrawer(item.id),
      onkeydown: (e) => e.key === 'Enter' && openDrawer(item.id),
    },
    h('span', { class: 'bar' }),
    h('div', { style: 'min-width:0' }, h('div', { class: 'title' }, item.title), h('div', { class: 'meta' }, meta.map((m) => h('span', {}, m)))),
    h('div', { class: 'side' }, showDate && d ? h('span', { class: whenClass(d) }, whenText(d)) : null, done),
  );
}

function renderAgenda() {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  const groups = [
    { key: 'late', title: 'Gecikmiş', items: [] },
    { key: 'today', title: 'Bugün', items: [] },
    { key: 'tomorrow', title: 'Yarın', items: [] },
    { key: 'week', title: 'Bu hafta', items: [] },
    { key: 'later', title: 'Daha sonra', items: [] },
    { key: 'undated', title: 'Tarihsiz', items: [] },
  ];
  const by = Object.fromEntries(groups.map((g) => [g.key, g]));
  for (const item of state.items) {
    const d = dueOf(item);
    if (!d) by.undated.items.push(item);
    else if (d < now) by.late.items.push(item);
    else if (sameDay(d, today)) by.today.items.push(item);
    else if (sameDay(d, tomorrow)) by.tomorrow.items.push(item);
    else if (d < weekEnd) by.week.items.push(item);
    else by.later.items.push(item);
  }

  const weekCount = by.today.items.length + by.tomorrow.items.length + by.week.items.length;
  const effort = [...by.today.items, ...by.tomorrow.items, ...by.week.items].reduce((s, i) => s + (i.effortMinutes || 0), 0);
  $('#summary').replaceChildren(
    stat(by.late.items.length, 'gecikmiş', by.late.items.length > 0),
    stat(by.today.items.length, 'bugün'),
    stat(weekCount, '7 gün içinde'),
    stat(effortText(effort) || '0', 'bu haftanın tahmini yükü'),
  );

  const root = $('#agenda');
  if (state.items.length === 0) {
    root.replaceChildren(
      h('div', { class: 'empty' }, h('b', {}, 'Her şey yolunda'), 'Yukarıya bir link ya da not yapıştır; Telegram\'dan ya da tarayıcı uzantısından gönderdiklerin de burada görünür.'),
    );
    return;
  }
  root.replaceChildren(
    ...groups
      .filter((g) => g.items.length)
      .map((g) =>
        h(
          'section',
          { class: `group ${g.key}` },
          h('h3', {}, g.title, h('span', { class: 'count' }, String(g.items.length))),
          h('div', { class: 'items' }, g.items.map((i) => itemRow(i))),
        ),
      ),
  );
}

function stat(value, label, alert = false) {
  return h('div', { class: `stat${alert ? ' alert' : ''}` }, h('b', {}, String(value)), h('span', {}, label));
}

function renderCalendar() {
  const m = state.month;
  $('#calTitle').textContent = `${MONTHS[m.getMonth()]} ${m.getFullYear()}`;
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const start = addDays(first, -weekdayIndex(first));
  const cells = [...DAYS_SHORT.map((d) => h('div', { class: 'dow' }, d))];
  const byDay = new Map();
  for (const item of state.items) {
    for (const [iso, kind] of [
      [item.deadlineAt, 'deadline'],
      [item.eventAt, 'event'],
    ]) {
      if (!iso) continue;
      const key = startOfDay(new Date(iso)).getTime();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push({ item, kind });
    }
  }
  const today = startOfDay(new Date());
  for (let i = 0; i < 42; i++) {
    const day = addDays(start, i);
    if (i >= 35 && day.getMonth() !== m.getMonth()) break;
    const entries = byDay.get(day.getTime()) || [];
    const classes = ['day'];
    if (day.getMonth() !== m.getMonth()) classes.push('other');
    if (day.getTime() === today.getTime()) classes.push('today');
    if (state.selectedDay && day.getTime() === state.selectedDay.getTime()) classes.push('selected');
    cells.push(
      h(
        'button',
        {
          class: classes.join(' '),
          role: 'gridcell',
          'aria-label': `${day.getDate()} ${MONTHS[day.getMonth()]}, ${entries.length} kayıt`,
          onclick: () => {
            state.selectedDay = day;
            renderCalendar();
          },
        },
        h('span', { class: 'num' }, String(day.getDate())),
        entries.slice(0, 3).map((e) => h('span', { class: `pill ${e.kind}`, title: e.item.title }, e.item.title)),
        entries.length > 3 ? h('span', { class: 'more' }, `+${entries.length - 3}`) : null,
      ),
    );
  }
  $('#calendar').replaceChildren(...cells);

  const sel = state.selectedDay;
  const list = $('#dayList');
  if (!sel) {
    list.replaceChildren(h('p', { class: 'muted' }, 'Bir güne tıkla, o günün işleri burada listelensin.'));
    return;
  }
  const entries = byDay.get(sel.getTime()) || [];
  list.replaceChildren(
    h('h3', { class: 'section-title' }, `${sel.getDate()} ${MONTHS[sel.getMonth()]} ${DAYS[weekdayIndex(sel)]}`),
    entries.length
      ? h('div', { class: 'items' }, [...new Set(entries.map((e) => e.item))].map((i) => itemRow(i)))
      : h('p', { class: 'muted' }, 'Bu gün için kayıt yok.'),
  );
}

async function renderArchive() {
  const root = $('#archive');
  root.replaceChildren(h('p', { class: 'muted' }, 'Yükleniyor…'));
  const { items } = await api('/api/items?status=closed');
  items.sort((a, b) => new Date(b.closedAt || b.createdAt) - new Date(a.closedAt || a.createdAt));
  if (!items.length) {
    root.replaceChildren(h('div', { class: 'empty' }, h('b', {}, 'Henüz kapanan kayıt yok'), 'Yaptığın ya da vazgeçtiğin kayıtlar burada birikir.'));
    return;
  }
  const label = { done: 'Yapıldı', dropped: 'Vazgeçildi', expired: 'Süresi geçti' };
  root.replaceChildren(
    h(
      'div',
      { class: 'items' },
      items.map((item) =>
        h(
          'div',
          { class: `item cat-${item.category}` },
          h('span', { class: 'bar' }),
          h(
            'div',
            { style: 'min-width:0' },
            h('div', { class: 'title' }, item.title),
            h('div', { class: 'meta' }, h('span', {}, label[item.status] || item.status), item.closedAt ? h('span', {}, fullDate(new Date(item.closedAt))) : null),
          ),
          h(
            'div',
            { class: 'side' },
            h(
              'button',
              {
                class: 'btn',
                onclick: async () => {
                  const { item: back } = await api(`/api/items/${item.id}/reopen`, { method: 'POST' });
                  upsert(back);
                  toast('Kayıt yeniden açıldı; hatırlatmalar kuruldu.');
                  renderArchive();
                },
              },
              'Geri al',
            ),
          ),
        ),
      ),
    ),
  );
}

async function renderSettings() {
  const me = (state.me = await api('/api/me'));
  const toggle = (key, title, desc) =>
    h(
      'label',
      { class: 'toggle' },
      h('input', {
        type: 'checkbox',
        checked: me[key],
        onchange: async (e) => {
          await api('/api/me', { method: 'PATCH', body: { [key]: e.target.checked } });
          toast('Kaydedildi.');
        },
      }),
      h('div', {}, h('b', {}, title), h('div', { class: 'muted' }, desc)),
    );

  const urlInput = h('input', { value: me.calendarUrl, readonly: true, onclick: (e) => e.target.select() });
  $('#settings').replaceChildren(
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Takvim aboneliği'),
      h('p', { class: 'muted' }, 'Bu adresi Outlook, Thunderbird ya da Apple Takvim\'de "abone ol" ile ekle. Son tarihlerin ve etkinliklerin takviminde kendiliğinden görünür, güncellenir.'),
      h(
        'div',
        { class: 'row' },
        urlInput,
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              await navigator.clipboard.writeText(me.calendarUrl);
              toast('Adres kopyalandı.');
            },
          },
          'Kopyala',
        ),
        h('a', { class: 'btn', href: '/api/calendar.ics', download: 'sonra-bakarim.ics' }, '.ics indir'),
      ),
      h('p', { class: 'muted' }, 'Google Takvim ve telefon için bu adresin internetten erişilebilir olması gerekir (bkz. README: Tünel).'),
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Özetler'),
      toggle('weeklyDigest', 'Pazar akşamı haftalık özet', 'Önümüzdeki 7 günün son tarihleri ve çakışan günler için uyarı.'),
      toggle('morningBrief', 'Sabah brifingi', 'Son tarihi olan günlerde 08.30\'da yalnızca o günün işleri.'),
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Bağlı cihazlar'),
      h(
        'ul',
        { class: 'devices' },
        me.devices.map((d) =>
          h(
            'li',
            {},
            h('div', {}, h('b', {}, d.name), d.current ? h('span', { class: 'chip accent', style: 'margin-left:8px' }, 'bu cihaz') : null, h('div', { class: 'muted' }, d.lastSeenAt ? `Son kullanım ${fullDate(new Date(d.lastSeenAt))}` : '')),
            d.current
              ? null
              : h(
                  'button',
                  {
                    class: 'btn danger',
                    onclick: async () => {
                      await api(`/api/devices/${d.id}`, { method: 'DELETE' });
                      toast('Cihaz kaldırıldı.');
                      renderSettings();
                    },
                  },
                  'Kaldır',
                ),
          ),
        ),
      ),
      h('p', { class: 'muted' }, 'Yeni cihaz eklemek için Telegram\'da "bağla" yaz.'),
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Oturum'),
      h('p', { class: 'muted' }, `Kanal: ${me.channel === 'telegram' ? 'Telegram' : 'WhatsApp'} · Sessiz saatler: ${me.quietHours}`),
      h(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            await api('/api/logout', { method: 'POST' });
            showLogin();
          },
        },
        'Çıkış yap',
      ),
    ),
  );
}

// --- Detay çekmecesi -----------------------------------------------------------------

function openDrawer(id) {
  state.openId = id;
  const item = state.items.find((x) => x.id === id);
  if (!item) return;
  renderDrawer(item);
  $('#drawer').hidden = false;
  $('#drawerBackdrop').hidden = false;
  $('#drawer').focus();
}

function closeDrawer() {
  state.openId = null;
  $('#drawer').hidden = true;
  $('#drawerBackdrop').hidden = true;
}

$('#drawerBackdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer();
});

/** Gereken belgelerin işaretleri yalnızca bu tarayıcıda tutulur. */
function checkKey(item, i) {
  return `sb-check:${item.id}:${i}`;
}

function renderDrawer(item) {
  const facts = [];
  if (item.deadlineAt) {
    const d = new Date(item.deadlineAt);
    facts.push(
      h(
        'div',
        { class: 'fact' },
        h('div', { class: 'label' }, 'Son tarih'),
        h('div', { class: 'big' }, fullDate(d)),
        h('div', { class: whenClass(d) }, `${whenText(d)} · ${SOURCE[item.deadlineSource] || ''}`),
        item.deadlineEvidence ? h('blockquote', { class: 'quote' }, `“${item.deadlineEvidence}”`) : null,
      ),
    );
  }
  if (item.eventAt) {
    facts.push(
      h(
        'div',
        { class: 'fact' },
        h('div', { class: 'label' }, 'Etkinlik'),
        h('div', { class: 'big' }, fullDate(new Date(item.eventAt))),
        item.location ? h('div', { class: 'muted' }, item.location) : null,
      ),
    );
  }
  if (!item.deadlineAt && !item.eventAt) {
    facts.push(h('div', { class: 'fact' }, h('div', { class: 'label' }, 'Son tarih'), h('div', { class: 'muted' }, 'Tarih yok. Aşağıdan bir tarih verebilirsin.')));
  }
  if (item.nextAction) facts.push(h('div', { class: 'fact' }, h('div', { class: 'label' }, 'İlk adım'), h('div', {}, item.nextAction)));
  if (item.requirements.length) {
    facts.push(
      h(
        'div',
        { class: 'fact' },
        h('div', { class: 'label' }, 'Gerekenler'),
        h(
          'ul',
          { class: 'checklist' },
          item.requirements.map((r, i) => {
            let checked = false;
            try {
              checked = localStorage.getItem(checkKey(item, i)) === '1';
            } catch {}
            return h(
              'li',
              {},
              h('input', {
                type: 'checkbox',
                id: `chk-${i}`,
                checked,
                onchange: (e) => {
                  try {
                    localStorage.setItem(checkKey(item, i), e.target.checked ? '1' : '0');
                  } catch {}
                },
              }),
              h('span', {}, r),
            );
          }),
        ),
      ),
    );
  }
  if (item.keyNotes.length) facts.push(h('div', { class: 'fact' }, h('div', { class: 'label' }, 'Notlar'), h('ul', {}, item.keyNotes.map((n) => h('li', {}, n)))));
  if (item.effortMinutes) facts.push(h('div', { class: 'fact' }, h('div', { class: 'label' }, 'Tahmini süre'), h('div', {}, effortText(item.effortMinutes))));
  if (item.sourceUrl) facts.push(h('div', { class: 'fact' }, h('div', { class: 'label' }, 'Kaynak'), h('a', { href: item.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, new URL(item.sourceUrl).hostname.replace(/^www\./, ''))));

  const dateArea = h('div', { hidden: true });
  const snoozeArea = h('div', { class: 'snooze-menu', hidden: true });
  const dateText = h('input', { placeholder: 'perşembe 18:00, cuma, 24 Ekim…', 'aria-label': 'Yeni tarih' });
  const dateLocal = h('input', { type: 'datetime-local', 'aria-label': 'Tarih seç' });
  dateArea.append(
    h(
      'form',
      {
        class: 'date-form',
        onsubmit: async (e) => {
          e.preventDefault();
          const body = dateLocal.value ? { iso: new Date(dateLocal.value).toISOString() } : { text: dateText.value };
          try {
            const { item: updated, reminders } = await api(`/api/items/${item.id}/date`, { method: 'POST', body });
            upsert(updated);
            toast(`Son tarih güncellendi; ${reminders} hatırlatma kuruldu.`);
            render();
          } catch (err) {
            toast(err.message, 'err');
          }
        },
      },
      dateText,
      h('button', { class: 'btn primary', type: 'submit' }, 'Kaydet'),
    ),
    h('div', { class: 'date-form' }, dateLocal),
  );
  for (const o of item.snoozeOptions || []) {
    snoozeArea.append(
      h(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            try {
              const { item: updated, remindAt } = await api(`/api/items/${item.id}/snooze`, { method: 'POST', body: { option: o.id } });
              upsert(updated);
              toast(`Tamam, ${fullDate(new Date(remindAt))} için hatırlatacağım.`);
              render();
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        },
        o.label,
      ),
    );
  }

  const drawer = $('#drawer');
  drawer.tabIndex = -1;
  drawer.replaceChildren(
    h(
      'header',
      {},
      h(
        'div',
        {},
        h('span', { class: 'chip accent' }, CATEGORY[item.category]),
        item.sourceType === 'extension' ? h('span', { class: 'chip' }, 'tarayıcıdan') : null,
        h('h2', { id: 'drawerTitle' }, item.title),
        item.organization ? h('div', { class: 'muted' }, item.organization) : null,
      ),
      h('button', { class: 'btn icon', 'aria-label': 'Kapat', onclick: closeDrawer }, '×'),
    ),
    h('div', { style: 'margin-top:12px' }, facts),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => act(item, 'done') }, 'Yaptım'),
      item.snoozeOptions?.length
        ? h('button', { class: 'btn', onclick: () => ((snoozeArea.hidden = !snoozeArea.hidden), (dateArea.hidden = true)) }, 'Ertele')
        : null,
      h('button', { class: 'btn', onclick: () => ((dateArea.hidden = !dateArea.hidden), (snoozeArea.hidden = true), dateText.focus()) }, 'Tarihi değiştir'),
      item.deadlineAt || item.eventAt ? h('a', { class: 'btn', href: `/api/items/${item.id}/ics`, download: '' }, 'Takvime ekle') : null,
      h('button', { class: 'btn danger', onclick: () => act(item, 'drop') }, 'Vazgeç'),
    ),
    snoozeArea,
    dateArea,
  );
}

async function act(item, action) {
  try {
    const { item: updated } = await api(`/api/items/${item.id}/${action}`, { method: 'POST' });
    upsert(updated);
    if (state.openId === item.id) closeDrawer();
    render();
    toast(action === 'done' ? `Kapattım: ${item.title}` : `Bıraktım: ${item.title}`);
  } catch (err) {
    toast(err.message, 'err');
  }
}

// --- Hızlı kayıt --------------------------------------------------------------------

$('#quickAdd').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#quickInput');
  const value = input.value.trim();
  if (!value) return;
  const url = value.match(/https?:\/\/\S+/)?.[0];
  const rest = url ? value.replace(url, '').trim() : value;
  const body = url ? { url, note: rest || undefined } : rest.length > 1000 ? { text: rest } : { note: rest };
  input.value = '';
  input.disabled = true;
  try {
    const { id } = await api('/api/capture', { method: 'POST', body });
    toast('Okunuyor, son tarih aranıyor…');
    const started = Date.now();
    let status;
    do {
      await new Promise((r) => setTimeout(r, 2000));
      status = await api(`/api/captures/${encodeURIComponent(id)}`);
    } while (status.state === 'pending' && Date.now() - started < 240_000);
    if (status.state === 'saved' || status.state === 'duplicate') {
      upsert(status.item);
      render();
      const d = dueOf(status.item);
      toast(`${status.state === 'saved' ? 'Kaydedildi' : 'Zaten kayıtlı'}: ${status.item.title}${d ? ` · ${whenText(d)}` : ''}`);
    } else {
      const reasons = {
        needs_text: 'Bu sayfayı açamadım. Tarayıcı uzantısıyla ya da metni yapıştırarak dene.',
        off_topic: 'Burada kaydedilecek bir iş bulamadım.',
        unreadable: 'İçeriği okuyamadım.',
      };
      toast(reasons[status.reason] || 'Kaydedilemedi.', 'err');
    }
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    input.disabled = false;
    input.focus();
  }
});

// --- Gezinme -----------------------------------------------------------------------

function route() {
  const view = location.hash.replace('#', '') || 'ajanda';
  state.view = ['ajanda', 'takvim', 'arsiv', 'ayarlar'].includes(view) ? view : 'ajanda';
  render();
}

window.addEventListener('hashchange', route);
$('#calPrev').addEventListener('click', () => {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
  renderCalendar();
});
$('#calNext').addEventListener('click', () => {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
  renderCalendar();
});
$('#calToday').addEventListener('click', () => {
  state.month = startOfDay(new Date());
  state.selectedDay = startOfDay(new Date());
  renderCalendar();
});

// "/" ile hızlı kayıt kutusuna odaklan.
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
    e.preventDefault();
    $('#quickInput').focus();
  }
});

async function start() {
  try {
    await load();
  } catch (err) {
    if (err.status === 401) return;
    toast(err.message, 'err');
    return;
  }
  $('#login').hidden = true;
  $('#app').hidden = false;
  route();
}

// Telegram'dan ya da uzantıdan gelenler için dakikada bir tazele.
setInterval(() => {
  if (!$('#app').hidden && document.visibilityState === 'visible') load().catch(() => {});
}, 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('#app').hidden) load().catch(() => {});
});

start();
