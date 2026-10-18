// Rafta web paneli. Derleme adımı yok; tarayıcıda doğrudan çalışır.
// Görünümler: Raf (ajanda), Takvim (hafta/ay, sürükle bırak, çalışma blokları),
// Bu hafta (hedefler), Arşiv, Ayarlar ve telefondaki hızlı kayıt ekranı.

const $ = (sel, root = document) => root.querySelector(sel);

/** Güvenli DOM kurucu: metin her zaman textContent ile girer (XSS yok). */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Kökün içeriğini değiştirir; iç içe dizileri düzleştirir, boş değerleri atar. */
function mount(root, ...children) {
  root.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
}

const svg = (path, size = 12) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '3');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  s.append(p);
  return s;
};
const tick = () => svg('M5 12l5 5L19 7');

// --- API -----------------------------------------------------------------------

class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Sunucu hatası (${status})`);
    this.status = status;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'x-rafta': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { message: 'Rafta\'ya ulaşılamadı. Bilgisayarın açık mı?' });
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path !== '/api/link') {
    showLogin();
    throw new ApiError(401, data);
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// --- Tarih ----------------------------------------------------------------------

const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const DAYS_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const DAY_MS = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
const weekdayIndex = (d) => (d.getDay() + 6) % 7;
const startOfWeek = (d) => addDays(startOfDay(d), -weekdayIndex(d));
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isEndOfDay = (d) => d.getHours() === 23 && d.getMinutes() === 59;
const daysFrom = (d) => Math.round((startOfDay(d) - startOfDay(new Date())) / DAY_MS);

function fullDate(d) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${DAYS[weekdayIndex(d)]}, ${isEndOfDay(d) ? 'gün sonu' : hhmm(d)}`;
}

function whenText(d) {
  const days = daysFrom(d);
  const time = isEndOfDay(d) ? '' : ` ${hhmm(d)}`;
  if (d < new Date()) return days === 0 ? `bugün${time}, geçti` : `${-days} gün geçti`;
  if (days === 0) return `bugün${time}`;
  if (days === 1) return `yarın${time}`;
  if (days < 7) return `${DAYS[weekdayIndex(d)]}${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${time}`;
}

function whenClass(d) {
  if (d < new Date()) return 'when late';
  return daysFrom(d) <= 1 ? 'when soon' : 'when';
}

const dueOf = (item) => (item.deadlineAt || item.eventAt ? new Date(item.deadlineAt || item.eventAt) : null);

const CATEGORY = {
  job: 'İş ilanı',
  event: 'Etkinlik',
  application: 'Başvuru',
  tool: 'Denenecek araç',
  read: 'Okunacak',
  task: 'Yapılacak',
  goal: 'Haftalık hedef',
  other: 'Diğer',
};
const CATEGORY_CHIP = { event: 'sea', goal: 'leaf' };

const SOURCE = {
  explicit: 'kaynakta yazılı',
  inferred: 'göreli ifadeden çözüldü',
  default: 'varsayılan kural',
  user: 'senin verdiğin tarih',
};

const REMINDER_KIND = {
  plan: 'Plan',
  nudge: 'Hatırlatma',
  last_call: 'Son çağrı',
  event_eve: 'Etkinlik öncesi',
  event_soon: 'Etkinlik yaklaşıyor',
  digest: 'Özet',
};

function effortText(min) {
  if (!min) return null;
  if (min < 60) return `${min} dk`;
  const hours = Math.floor(min / 60);
  return min % 60 ? `${hours} sa ${min % 60} dk` : `${hours} saat`;
}

// --- Durum ----------------------------------------------------------------------

const state = {
  items: [],
  reminders: [],
  blocks: [],
  suggestions: [],
  view: 'raf',
  calMode: localGet('rafta:calMode') || 'hafta',
  anchor: startOfDay(new Date()),
  filters: JSON.parse(localGet('rafta:filters') || 'null') || { deadline: true, event: true, goal: true, block: true, suggest: true, reminder: true },
  openId: null,
};

function localGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

function toast(text, kind = '') {
  const el = $('#toast');
  el.textContent = text;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), kind === 'err' ? 6000 : 3200);
}

const itemById = (id) => state.items.find((i) => i.id === id);

function upsert(item) {
  const i = state.items.findIndex((x) => x.id === item.id);
  const open = item.status === 'open' || item.status === 'snoozed';
  if (i >= 0 && open) state.items[i] = item;
  else if (i >= 0) state.items.splice(i, 1);
  else if (open) state.items.push(item);
  state.items.sort((a, b) => (dueOf(a) ?? Infinity) - (dueOf(b) ?? Infinity));
}

async function load() {
  const [items, reminders, blocks, suggestions] = await Promise.all([
    api('/api/items?status=open'),
    api('/api/reminders'),
    api('/api/blocks'),
    api('/api/blocks/suggestions'),
  ]);
  state.items = items.items;
  state.reminders = reminders.reminders;
  state.blocks = blocks.blocks;
  state.suggestions = suggestions.suggestions;
  render();
}

/** Bir değişiklikten sonra hatırlatma ve önerileri tazele (kayıtlar zaten güncel). */
async function refreshSide() {
  const [reminders, blocks, suggestions] = await Promise.all([api('/api/reminders'), api('/api/blocks'), api('/api/blocks/suggestions')]);
  state.reminders = reminders.reminders;
  state.blocks = blocks.blocks;
  state.suggestions = suggestions.suggestions;
  render();
}

// --- Giriş ----------------------------------------------------------------------

function showLogin() {
  $('#app').hidden = true;
  $('#quick').hidden = true;
  $('#login').hidden = false;
  closeDrawer();
  $('#loginCode').focus();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    await api('/api/link', { method: 'POST', body: { code: $('#loginCode').value, name: /Android|iPhone/.test(navigator.userAgent) ? 'Telefon' : 'Web paneli', cookie: true } });
    $('#loginCode').value = '';
    start();
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});

// --- Ortak satır ----------------------------------------------------------------

function itemRow(item, { goal = false } = {}) {
  const d = dueOf(item);
  const meta = [
    h('span', {}, h('span', { class: `dot cat-dot-${item.category}` }), CATEGORY[item.category]),
    item.organization ? h('span', {}, item.organization) : null,
    effortText(item.effortMinutes) ? h('span', {}, effortText(item.effortMinutes)) : null,
    item.status === 'snoozed' ? h('span', {}, 'ertelendi') : null,
    state.blocks.some((b) => b.itemId === item.id) ? h('span', {}, 'çalışma planlandı') : null,
  ];
  const done = item.status === 'done';
  return h(
    'div',
    {
      class: `row${goal ? ' goal-row' : ''}${done ? ' done' : ''}`,
      tabindex: '0',
      onclick: () => openDrawer(item.id),
      onkeydown: (e) => e.key === 'Enter' && openDrawer(item.id),
    },
    h(
      'button',
      {
        class: `check${done ? ' done' : ''}`,
        'aria-label': done ? 'Yeniden aç' : 'Yaptım',
        title: done ? 'Yeniden aç' : 'Yaptım',
        onclick: (e) => {
          e.stopPropagation();
          act(item, done ? 'reopen' : 'done');
        },
      },
      tick(),
    ),
    h('div', { style: { minWidth: 0 } }, h('div', { class: 'title' }, item.title), h('div', { class: 'meta' }, meta)),
    d ? h('span', { class: whenClass(d) }, whenText(d)) : h('span', { class: 'when' }, 'tarihsiz'),
  );
}

function emptyState(title, text) {
  const art = h('img', { class: 'art', src: 'icon.png', alt: '' });
  return h('div', { class: 'empty' }, art, h('b', {}, title), text);
}

// --- Raf (ajanda) -----------------------------------------------------------------

function renderRaf() {
  const root = $('#view-raf');
  const now = new Date();
  const today = startOfDay(now);
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
    else if (sameDay(d, addDays(today, 1))) by.tomorrow.items.push(item);
    else if (d < addDays(today, 7)) by.week.items.push(item);
    else by.later.items.push(item);
  }
  const week = [...by.today.items, ...by.tomorrow.items, ...by.week.items];
  const load = week.reduce((s, i) => s + (i.effortMinutes || 0), 0);
  const hour = now.getHours();
  const greet = hour < 6 ? 'İyi geceler' : hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';
  const todayCount = by.today.items.length + by.late.items.length;

  mount(root, 
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        {},
        h('h1', {}, greet),
        h('p', {}, todayCount ? `Bugün rafından inmesi gereken ${todayCount} şey var.` : 'Bugün için acil bir şey yok. Rafın düzenli.'),
      ),
    ),
    h(
      'div',
      { class: 'stats' },
      stat(by.late.items.length, 'gecikmiş', by.late.items.length > 0),
      stat(by.today.items.length, 'bugün', by.today.items.length > 0),
      stat(week.length, '7 gün içinde'),
      stat(effortText(load) || '0', 'bu haftanın yükü'),
    ),
    state.items.length
      ? groups
          .filter((g) => g.items.length)
          .map((g) =>
            h(
              'section',
              { class: `group g-${g.key}` },
              h('h3', { class: 'group-title' }, g.title, h('span', { class: 'num' }, `· ${g.items.length}`)),
              h('div', { class: 'card-list' }, g.items.map((i) => itemRow(i, { goal: i.category === 'goal' }))),
            ),
          )
      : emptyState('Rafın boş', 'Yukarıya bir link ya da not yapıştır. Telegram\'dan ve tarayıcı uzantısından gönderdiklerin de burada toplanır.'),
  );
}

function stat(value, label, hot = false) {
  return h('div', { class: `stat${hot ? ' hot' : ''}` }, h('b', {}, String(value)), h('span', {}, label));
}

// --- Takvim -----------------------------------------------------------------------

const HOUR_START = 7;
const HOUR_END = 24;
const SNAP = 15;

/** Takvime düşen her şey: son tarih, etkinlik, hedef, blok, öneri, hatırlatma. */
function calendarEntries() {
  const out = [];
  const f = state.filters;
  for (const item of state.items) {
    if (item.deadlineAt) {
      const d = new Date(item.deadlineAt);
      const kind = item.category === 'goal' ? 'goal' : 'deadline';
      if (f[kind]) out.push({ kind, item, start: d, allDay: isEndOfDay(d) || kind === 'goal' });
    }
    if (item.eventAt && f.event) out.push({ kind: 'event', item, start: new Date(item.eventAt), end: new Date(+new Date(item.eventAt) + 3600000) });
  }
  if (f.block) {
    for (const b of state.blocks) {
      const item = itemById(b.itemId);
      if (item) out.push({ kind: 'block', item, block: b, start: new Date(b.startAt), end: new Date(b.endAt) });
    }
  }
  if (f.suggest) {
    for (const s of state.suggestions) {
      const item = itemById(s.itemId);
      if (item) out.push({ kind: 'suggest', item, suggestion: s, start: new Date(s.startAt), end: new Date(s.endAt) });
    }
  }
  if (f.reminder) {
    for (const r of state.reminders) {
      const item = itemById(r.itemId);
      if (item) out.push({ kind: 'reminder', item, reminder: r, start: new Date(r.sendAt) });
    }
  }
  return out;
}

function renderTakvim() {
  const root = $('#view-takvim');
  const week = state.calMode === 'hafta';
  const a = state.anchor;
  let title;
  if (week) {
    const s = startOfWeek(a);
    const e = addDays(s, 6);
    title = s.getMonth() === e.getMonth() ? `${s.getDate()}–${e.getDate()} ${MONTHS[s.getMonth()]}` : `${s.getDate()} ${MONTHS[s.getMonth()].slice(0, 3)} – ${e.getDate()} ${MONTHS[e.getMonth()].slice(0, 3)}`;
  } else {
    title = `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  }

  const filterBtn = (key, label, color) =>
    h(
      'button',
      {
        class: 'filter',
        'aria-pressed': String(state.filters[key]),
        onclick: () => {
          state.filters[key] = !state.filters[key];
          localSet('rafta:filters', JSON.stringify(state.filters));
          renderTakvim();
        },
      },
      h('i', { style: { background: color } }),
      label,
    );

  const pendingSuggestions = state.suggestions.length;
  mount(root, 
    h(
      'div',
      { class: 'cal-bar' },
      h('button', { class: 'btn icon', 'aria-label': 'Önceki', onclick: () => shift(-1) }, '‹'),
      h('button', { class: 'btn icon', 'aria-label': 'Sonraki', onclick: () => shift(1) }, '›'),
      h('h1', {}, title),
      h('button', { class: 'btn sm', onclick: () => ((state.anchor = startOfDay(new Date())), renderTakvim()) }, 'Bugün'),
      h('span', { class: 'spacer' }),
      pendingSuggestions
        ? h('button', { class: 'btn sm', onclick: acceptAllSuggestions, title: 'Önerilen tüm çalışma bloklarını takvime koy' }, `${pendingSuggestions} öneriyi onayla`)
        : null,
      h(
        'div',
        { class: 'seg', role: 'group', 'aria-label': 'Görünüm' },
        h('button', { 'aria-pressed': String(week), onclick: () => setCalMode('hafta') }, 'Hafta'),
        h('button', { 'aria-pressed': String(!week), onclick: () => setCalMode('ay') }, 'Ay'),
      ),
    ),
    h(
      'div',
      { class: 'filters' },
      filterBtn('deadline', 'Son tarih', 'var(--saffron)'),
      filterBtn('event', 'Etkinlik', 'var(--sea)'),
      filterBtn('goal', 'Hedef', 'var(--leaf)'),
      filterBtn('block', 'Çalışma', 'var(--ink)'),
      filterBtn('suggest', 'Öneri', 'transparent'),
      filterBtn('reminder', 'Hatırlatma', 'var(--surface-2)'),
    ),
    week ? weekView() : monthView(),
  );
  if (week) scrollWeekToNow();
}

function setCalMode(mode) {
  state.calMode = mode;
  localSet('rafta:calMode', mode);
  renderTakvim();
}

function shift(dir) {
  const a = state.anchor;
  state.anchor = state.calMode === 'hafta' ? addDays(a, 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1);
  renderTakvim();
}

const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();
const topFor = (d, hourPx) => Math.max(0, ((minutesOf(d) - HOUR_START * 60) / 60) * hourPx);

function hourPx() {
  return parseFloat(getComputedStyle($('.week') || document.body).getPropertyValue('--hour')) || 52;
}

function weekView() {
  const start = startOfWeek(state.anchor);
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const today = startOfDay(new Date());
  const entries = calendarEntries();
  const inDay = (e, day) => sameDay(e.start, day);

  // Günün yükü: o güne düşen son tarihlerin ve blokların süresi.
  const loadOf = (day) =>
    entries
      .filter((e) => inDay(e, day) && (e.kind === 'block' || e.kind === 'deadline' || e.kind === 'goal'))
      .reduce((s, e) => s + (e.kind === 'block' ? (e.end - e.start) / 60000 : e.item.effortMinutes || 30), 0);

  const head = h(
    'div',
    { class: 'week-head' },
    h('div', {}),
    days.map((day) => {
      const load = loadOf(day);
      const pct = Math.min(100, (load / 240) * 100);
      return h(
        'div',
        { class: `dh${sameDay(day, today) ? ' today' : ''}`, title: load ? `Tahmini yük: ${effortText(Math.round(load))}` : 'Boş gün' },
        h('div', { class: 'dn' }, DAYS_SHORT[weekdayIndex(day)]),
        h('div', { class: 'dd' }, String(day.getDate())),
        h('div', { class: 'load' }, h('i', { class: load > 180 ? 'heavy' : '', style: { width: `${pct}%` } })),
      );
    }),
  );

  const allday = h(
    'div',
    { class: 'week-allday' },
    h('div', { class: 'lbl' }, 'gün'),
    days.map((day) =>
      h(
        'div',
        { class: 'ad', dataset: { date: day.toISOString(), drop: 'allday' } },
        entries
          .filter((e) => inDay(e, day) && e.allDay)
          .map((e) => {
            const late = e.start < new Date();
            return h(
              'span',
              {
                class: `pill ${e.kind === 'goal' ? 'goal' : ''}${late ? ' late' : ''}`,
                title: `${e.item.title} · ${e.kind === 'goal' ? 'hedef' : 'son gün'}`,
                onpointerdown: (ev) => startDrag(ev, { type: 'date', entry: e }),
              },
              e.item.title,
            );
          }),
      ),
    ),
  );

  const px = 52;
  const hours = h('div', { class: 'hours' }, [...Array(HOUR_END - HOUR_START)].map((_, i) => h('div', {}, i ? `${pad(HOUR_START + i)}:00` : '')));
  const cols = days.map((day) => {
    const col = h('div', { class: `col${sameDay(day, today) ? ' today' : ''}`, dataset: { date: day.toISOString(), drop: 'grid' } });
    col.style.height = `calc(var(--hour) * ${HOUR_END - HOUR_START})`;
    for (const e of entries.filter((x) => inDay(x, day) && !x.allDay)) col.append(calendarBlock(e, px));
    if (sameDay(day, today)) {
      const line = h('div', { class: 'now-line' });
      line.style.top = `calc(var(--hour) * ${(minutesOf(new Date()) - HOUR_START * 60) / 60})`;
      col.append(line);
    }
    return col;
  });
  const body = h('div', { class: 'week-body' }, hours, cols);
  return h('div', { class: 'week' }, head, allday, body);
}

function calendarBlock(e, _px) {
  const top = `calc(var(--hour) * ${(Math.max(minutesOf(e.start), HOUR_START * 60) - HOUR_START * 60) / 60})`;
  if (e.kind === 'reminder') {
    const dot = h('span', { class: 'rem', title: `${REMINDER_KIND[e.reminder.kind] || 'Hatırlatma'}: ${e.item.title} · ${hhmm(e.start)}` });
    dot.style.top = top;
    return dot;
  }
  const minutes = e.end ? (e.end - e.start) / 60000 : 30;
  const el = h(
    'div',
    {
      class: `ev ${e.kind}`,
      title: e.item.title,
      // Sürüklenebilenler tıklamayı sürükleme bitişinde ele alır.
      onclick: e.kind === 'event' ? () => openDrawer(e.item.id) : undefined,
    },
    h('div', { class: 't' }, e.kind === 'deadline' ? `${hhmm(e.start)} · ${e.item.title}` : e.kind === 'block' || e.kind === 'suggest' ? `Çalış: ${e.item.title}` : e.item.title),
    e.kind === 'deadline' ? null : h('div', { class: 's' }, `${hhmm(e.start)}–${hhmm(e.end)}`),
    e.kind === 'suggest'
      ? h(
          'button',
          {
            class: 'btn sm primary accept',
            onclick: (ev) => {
              ev.stopPropagation();
              acceptSuggestion(e.suggestion);
            },
          },
          'Onayla',
        )
      : null,
  );
  el.style.top = top;
  if (e.kind !== 'deadline') el.style.height = `calc(var(--hour) * ${Math.max(minutes, 20) / 60})`;
  if (e.kind === 'block' || e.kind === 'suggest' || e.kind === 'deadline') {
    el.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button')) return;
      startDrag(ev, { type: e.kind === 'deadline' ? 'time' : 'move', entry: e });
    });
  }
  if (e.kind === 'block') {
    const grip = h('div', { class: 'grip', title: 'Süreyi değiştir' });
    grip.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      startDrag(ev, { type: 'resize', entry: e, el });
    });
    el.append(grip);
  }
  return el;
}

function scrollWeekToNow() {
  const body = $('.week-body');
  if (!body) return;
  const target = Math.max(0, (Math.max(minutesOf(new Date()), 8 * 60) - HOUR_START * 60 - 60) / 60) * hourPx();
  body.scrollTop = target;
}

// --- Sürükle bırak ------------------------------------------------------------------

let drag = null;

function startDrag(ev, info) {
  if (ev.button !== 0) return;
  drag = { ...info, x0: ev.clientX, y0: ev.clientY, moved: false, source: ev.currentTarget };
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd, { once: true });
}

function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el?.closest('[data-drop]') || null;
}

function slotAt(col, y) {
  const rect = col.getBoundingClientRect();
  const minutes = ((y - rect.top) / hourPx()) * 60 + HOUR_START * 60;
  const snapped = Math.round(minutes / SNAP) * SNAP;
  return Math.min(Math.max(snapped, HOUR_START * 60), HOUR_END * 60 - SNAP);
}

function onDragMove(ev) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 5) return;
  if (!drag.moved) {
    drag.moved = true;
    if (drag.type !== 'resize') {
      drag.ghost = drag.source.cloneNode(true);
      drag.ghost.classList.add('ghost-drag');
      const r = drag.source.getBoundingClientRect();
      drag.ghost.style.width = `${r.width}px`;
      drag.ghost.style.height = `${r.height}px`;
      drag.dx = drag.x0 - r.left;
      drag.dy = drag.y0 - r.top;
      document.body.append(drag.ghost);
      drag.source.style.opacity = '0.35';
    }
  }
  if (drag.type === 'resize') {
    const col = drag.el.parentElement;
    const end = slotAt(col, ev.clientY);
    const startMin = minutesOf(drag.entry.start);
    const minutes = Math.max(SNAP * 2, end - startMin);
    drag.el.style.height = `calc(var(--hour) * ${minutes / 60})`;
    drag.newMinutes = minutes;
    return;
  }
  drag.ghost.style.left = `${ev.clientX - drag.dx}px`;
  drag.ghost.style.top = `${ev.clientY - drag.dy}px`;
  document.querySelectorAll('.drop, .drop-hint').forEach((n) => (n.classList.contains('drop-hint') ? n.remove() : n.classList.remove('drop')));
  const target = dropTargetAt(ev.clientX, ev.clientY);
  if (!target) return;
  if (target.dataset.drop === 'grid') {
    const minutes = slotAt(target, ev.clientY - drag.dy + 4);
    const dur = drag.entry.end ? (drag.entry.end - drag.entry.start) / 60000 : 30;
    const hint = h('div', { class: 'drop-hint' });
    hint.style.top = `calc(var(--hour) * ${(minutes - HOUR_START * 60) / 60})`;
    hint.style.height = `calc(var(--hour) * ${dur / 60})`;
    target.append(hint);
  } else {
    target.classList.add('drop');
  }
}

async function onDragEnd(ev) {
  window.removeEventListener('pointermove', onDragMove);
  const d = drag;
  drag = null;
  if (!d) return;
  d.ghost?.remove();
  if (d.source) d.source.style.opacity = '';
  document.querySelectorAll('.drop, .drop-hint').forEach((n) => (n.classList.contains('drop-hint') ? n.remove() : n.classList.remove('drop')));
  if (!d.moved) {
    if (d.type !== 'resize' && d.entry.kind !== 'suggest') openDrawer(d.entry.item.id);
    return;
  }
  try {
    if (d.type === 'resize') {
      if (!d.newMinutes) return;
      const end = new Date(+d.entry.start + d.newMinutes * 60000);
      await saveBlock(d.entry, d.entry.start, end);
      return;
    }
    const target = dropTargetAt(ev.clientX, ev.clientY);
    if (!target) return;
    const day = new Date(target.dataset.date);
    if (target.dataset.drop === 'allday' || target.classList.contains('day')) {
      // Gün değişimi: saat korunur (gün sonu son tarihlerde 23:59).
      const s = d.entry.start;
      const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), s.getHours(), s.getMinutes());
      if (d.entry.kind === 'block' || d.entry.kind === 'suggest') await saveBlock(d.entry, when, new Date(+when + (d.entry.end - d.entry.start)));
      else await moveDeadline(d.entry.item, when);
      return;
    }
    const minutes = slotAt(target, ev.clientY - d.dy + 4);
    const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
    if (d.entry.kind === 'block' || d.entry.kind === 'suggest') await saveBlock(d.entry, when, new Date(+when + (d.entry.end - d.entry.start)));
    else await moveDeadline(d.entry.item, when);
  } catch (err) {
    toast(err.message, 'err');
    render();
  }
}

async function moveDeadline(item, when) {
  if (when < new Date()) {
    toast('Geçmişe taşıyamazsın.', 'err');
    render();
    return;
  }
  const { item: updated, reminders } = await api(`/api/items/${item.id}/date`, { method: 'POST', body: { iso: when.toISOString() } });
  upsert(updated);
  toast(`${updated.title}: ${fullDate(when)} · ${reminders} hatırlatma kuruldu.`);
  await refreshSide();
}

async function saveBlock(entry, start, end) {
  if (entry.kind === 'suggest') {
    await api('/api/blocks', { method: 'POST', body: { itemId: entry.item.id, startAt: start.toISOString(), endAt: end.toISOString() } });
    toast(`Çalışma bloğu: ${fullDate(start)}`);
  } else {
    await api(`/api/blocks/${entry.block.id}`, { method: 'PATCH', body: { startAt: start.toISOString(), endAt: end.toISOString() } });
    toast(`Taşındı: ${hhmm(start)}–${hhmm(end)}`);
  }
  await refreshSide();
}

async function acceptSuggestion(s) {
  try {
    await api('/api/blocks', { method: 'POST', body: s });
    toast(`Takvime koydum: ${fullDate(new Date(s.startAt))}`);
    await refreshSide();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function acceptAllSuggestions() {
  try {
    for (const s of state.suggestions) await api('/api/blocks', { method: 'POST', body: s });
    toast(`${state.suggestions.length} çalışma bloğu takvime kondu.`);
    await refreshSide();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function monthView() {
  const a = state.anchor;
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const start = startOfWeek(first);
  const entries = calendarEntries().filter((e) => e.kind !== 'reminder' && e.kind !== 'suggest');
  const today = startOfDay(new Date());
  const cells = [...DAYS_SHORT.map((d) => h('div', { class: 'dow' }, d))];
  // Isı: günün tahmini yükü (dakika); en yoğun gün en koyu.
  const loads = new Map();
  for (const e of entries) {
    const k = startOfDay(e.start).getTime();
    const m = e.kind === 'block' ? (e.end - e.start) / 60000 : e.item.effortMinutes || 30;
    loads.set(k, (loads.get(k) || 0) + m);
  }
  const maxLoad = Math.max(120, ...loads.values());
  for (let i = 0; i < 42; i++) {
    const day = addDays(start, i);
    if (i >= 35 && day.getMonth() !== a.getMonth()) break;
    const list = entries.filter((e) => sameDay(e.start, day));
    const load = loads.get(day.getTime()) || 0;
    const heat = h('span', { class: 'heat' });
    heat.style.opacity = String(load ? 0.04 + (load / maxLoad) * 0.16 : 0);
    cells.push(
      h(
        'div',
        {
          class: `day${day.getMonth() !== a.getMonth() ? ' other' : ''}${sameDay(day, today) ? ' today' : ''}`,
          role: 'button',
          tabindex: '0',
          dataset: { date: day.toISOString(), drop: 'allday' },
          title: load ? `Tahmini yük: ${effortText(Math.round(load))}` : '',
          onclick: (e) => {
            if (e.target.closest('.pill')) return;
            state.anchor = day;
            setCalMode('hafta');
          },
        },
        heat,
        h('span', { class: 'n' }, String(day.getDate())),
        list.slice(0, 3).map((e) =>
          h(
            'span',
            {
              class: `pill ${e.kind === 'event' ? 'event' : e.kind === 'goal' ? 'goal' : ''}${e.start < new Date() && e.kind !== 'block' ? ' late' : ''}`,
              title: e.item.title,
              onpointerdown: (ev) => e.kind !== 'event' && startDrag(ev, { type: 'date', entry: e }),
            },
            e.kind === 'block' ? `Çalış: ${e.item.title}` : e.item.title,
          ),
        ),
        list.length > 3 ? h('span', { class: 'more' }, `+${list.length - 3} daha`) : null,
      ),
    );
  }
  return h('div', { class: 'month' }, cells);
}

// --- Bu hafta (hedefler) ---------------------------------------------------------------

async function renderHafta() {
  const root = $('#view-hafta');
  const { items } = await api('/api/items?status=all');
  const ws = startOfWeek(new Date());
  const we = addDays(ws, 7);
  const goals = items.filter((i) => i.category === 'goal' && i.deadlineAt && new Date(i.deadlineAt) >= ws && new Date(i.deadlineAt) < we && i.status !== 'dropped');
  const done = goals.filter((g) => g.status === 'done').length;
  const pct = goals.length ? Math.round((done / goals.length) * 100) : 0;
  const deadlines = state.items.filter((i) => i.category !== 'goal' && i.deadlineAt && new Date(i.deadlineAt) >= new Date() && new Date(i.deadlineAt) < we);
  const left = Math.max(0, Math.ceil((we - new Date()) / DAY_MS));

  const ring = h('div', { class: 'ring' }, h('div', {}, goals.length ? `${done}/${goals.length}` : '–'));
  ring.style.setProperty('--p', String(pct));
  const input = h('input', { placeholder: 'Bu hafta ne yapacaksın? Örn: Medium yazımı yayınla', 'aria-label': 'Yeni hedef' });

  mount(root, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Bu hafta'), h('p', {}, `${ws.getDate()} ${MONTHS[ws.getMonth()]} – ${addDays(ws, 6).getDate()} ${MONTHS[addDays(ws, 6).getMonth()]} · ${left} gün kaldı`))),
    h(
      'div',
      { class: 'goal-hero' },
      ring,
      h(
        'div',
        {},
        h('h2', {}, goals.length === 0 ? 'Bu hafta için bir hedef koy' : done === goals.length ? 'Haftayı kapattın' : `${goals.length - done} hedef kaldı`),
        h(
          'p',
          {},
          goals.length
            ? 'Çarşamba akşamı ara kontrol, cuma akşamı son dürtme gelir. Bitmeyenleri pazar günü haftaya taşıyabilirsin.'
            : 'Bota ya da aşağıya "bu hafta …" yaz; hedef olarak rafa koyarım ve hafta boyunca takip ederim.',
        ),
      ),
    ),
    h(
      'form',
      {
        class: 'goal-add',
        onsubmit: async (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          input.value = '';
          await capture(/hafta/i.test(text) ? text : `bu hafta ${text}`);
          renderHafta();
        },
      },
      input,
      h('button', { class: 'btn primary', type: 'submit' }, 'Hedef ekle'),
    ),
    goals.length
      ? h(
          'section',
          { class: 'group' },
          h('h3', { class: 'group-title' }, 'Hedefler'),
          h('div', { class: 'card-list' }, goals.map((g) => itemRow(g, { goal: true }))),
        )
      : null,
    deadlines.length
      ? h(
          'section',
          { class: 'group' },
          h('h3', { class: 'group-title' }, 'Bu haftanın son tarihleri'),
          h('div', { class: 'card-list' }, deadlines.map((i) => itemRow(i))),
        )
      : null,
  );
}

// --- Arşiv ---------------------------------------------------------------------------

async function renderArsiv() {
  const root = $('#view-arsiv');
  mount(root, h('p', { class: 'muted' }, 'Yükleniyor…'));
  const { items } = await api('/api/items?status=closed');
  items.sort((a, b) => new Date(b.closedAt || b.createdAt) - new Date(a.closedAt || a.createdAt));
  const label = { done: 'Yapıldı', dropped: 'Vazgeçildi', expired: 'Süresi geçti' };
  mount(root, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Arşiv'), h('p', {}, 'Raftan indirdiklerin. Yanlışlıkla kapattıysan geri al.'))),
    items.length
      ? h(
          'div',
          { class: 'card-list' },
          items.map((item) =>
            h(
              'div',
              { class: 'row' },
              h('span', { class: `check${item.status === 'done' ? ' done' : ''}` }, tick()),
              h(
                'div',
                { style: { minWidth: 0 } },
                h('div', { class: 'title' }, item.title),
                h('div', { class: 'meta' }, h('span', {}, label[item.status] || item.status), item.closedAt ? h('span', {}, fullDate(new Date(item.closedAt))) : null),
              ),
              h(
                'button',
                {
                  class: 'btn sm',
                  onclick: async () => {
                    const { item: back } = await api(`/api/items/${item.id}/reopen`, { method: 'POST' });
                    upsert(back);
                    toast('Rafa geri koydum; hatırlatmalar kuruldu.');
                    renderArsiv();
                  },
                },
                'Geri al',
              ),
            ),
          ),
        )
      : emptyState('Arşiv boş', 'Yaptığın ya da vazgeçtiğin kayıtlar burada birikir.'),
  );
}

// --- Ayarlar -------------------------------------------------------------------------

async function renderAyarlar() {
  const root = $('#view-ayarlar');
  const me = await api('/api/me');
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
  const copy = (text, label = 'Kopyala') =>
    h(
      'button',
      {
        class: 'btn sm',
        onclick: async () => {
          await navigator.clipboard.writeText(text);
          toast('Kopyalandı.');
        },
      },
      label,
    );

  const shortcutArea = h('div', {});
  mount(root, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Ayarlar'))),
    h(
      'div',
      { class: 'panel' },
      h('h3', {}, 'Telefon'),
      h('p', { class: 'muted' }, 'Rafta\'yı telefonuna uygulama gibi yükle: ana ekranda bir simge, dokununca açılan "Ne rafa kalksın?" ekranı ve Paylaş menüsünde Rafta.'),
      h(
        'ol',
        { class: 'steps' },
        h('li', {}, 'Telefonunda Chrome ile bu adresi aç: ', h('code', {}, location.origin)),
        h('li', {}, 'Menüden ', h('b', {}, 'Ana ekrana ekle'), ' (ya da ', h('b', {}, 'Uygulamayı yükle'), ') seç.'),
        h('li', {}, 'Simgeye uzun basınca ', h('b', {}, 'Rafa kaldır'), ', ', h('b', {}, 'Bu hafta'), ' ve ', h('b', {}, 'Takvim'), ' kısayolları çıkar; bunları da ana ekrana sürükleyebilirsin.'),
        h('li', {}, 'Herhangi bir uygulamada ', h('b', {}, 'Paylaş → Rafta'), ' dediğinde link ya da metin doğrudan rafa kalkar.'),
      ),
      location.protocol !== 'https:' && location.hostname !== 'localhost'
        ? h('p', { class: 'error' }, 'Uygulama gibi yüklemek için adresin https olması gerekir (Tailscale kurulumu: README).')
        : null,
    ),
    h(
      'div',
      { class: 'panel' },
      h('h3', {}, 'Ana ekran widget\'ı (HTTP Shortcuts)'),
      h('p', { class: 'muted' }, 'Android\'de "HTTP Shortcuts" uygulamasıyla tek dokunuşla soru soran, yazdığını ya da söylediğini rafa kaldıran bir widget kurabilirsin. Bunun için ayrı bir anahtar oluştur; anahtar yalnızca bir kez gösterilir.'),
      shortcutArea,
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async (e) => {
            e.target.disabled = true;
            const { token } = await api('/api/devices', { method: 'POST', body: { name: 'Android widget' } });
            const url = `${location.origin}/api/capture`;
            const body = '{"note": "{{metin}}"}';
            mount(shortcutArea, 
              h('p', {}, h('b', {}, 'Anahtarın (bir daha gösterilmeyecek):')),
              h('div', { class: 'field-row' }, h('div', { class: 'secret' }, token), copy(token)),
              h(
                'ol',
                { class: 'steps' },
                h('li', {}, 'Play Store\'dan ', h('b', {}, 'HTTP Shortcuts'), ' uygulamasını kur, yeni bir kısayol oluştur.'),
                h('li', {}, 'Yöntem: ', h('code', {}, 'POST'), ' · Adres: ', h('code', {}, url), ' ', copy(url, 'Adresi kopyala')),
                h('li', {}, 'Başlık ekle: ', h('code', {}, 'Authorization'), ' = ', h('code', {}, 'Bearer <anahtar>')),
                h('li', {}, 'Gövde türü JSON: ', h('code', {}, body), ' ', copy(body, 'Gövdeyi kopyala')),
                h('li', {}, 'Değişkenler bölümünde ', h('code', {}, 'metin'), ' adlı, her seferinde soran bir metin değişkeni oluştur (klavyedeki mikrofonla söyleyebilirsin).'),
                h('li', {}, 'Ana ekrana uzun bas → Widget\'lar → HTTP Shortcuts → kısayolunu seç.'),
              ),
            );
            e.target.remove();
            renderAyarlar.devicesDirty = true;
          },
        },
        'Widget anahtarı oluştur',
      ),
    ),
    h(
      'div',
      { class: 'panel' },
      h('h3', {}, 'Takvim aboneliği'),
      h('p', { class: 'muted' }, 'Son tarihlerin, etkinliklerin ve onayladığın çalışma blokların Google, Outlook ya da Apple Takvim\'de görünsün.'),
      h('div', { class: 'field-row' }, h('input', { value: me.calendarUrl, readonly: true, onclick: (e) => e.target.select() }), copy(me.calendarUrl), h('a', { class: 'btn sm', href: '/api/calendar.ics', download: 'rafta.ics' }, '.ics')),
    ),
    h(
      'div',
      { class: 'panel' },
      h('h3', {}, 'Özetler'),
      toggle('weeklyDigest', 'Pazar akşamı haftalık özet', 'Önümüzdeki 7 gün, hedeflerin ve çakışan günler için uyarı.'),
      toggle('morningBrief', 'Sabah brifingi', 'Son tarihi olan günlerde 08.30\'da yalnızca o günün işleri.'),
    ),
    h(
      'div',
      { class: 'panel' },
      h('h3', {}, 'Bağlı cihazlar'),
      h(
        'ul',
        { class: 'devices' },
        me.devices.map((d) =>
          h(
            'li',
            {},
            h('div', {}, h('b', {}, d.name), d.current ? h('span', { class: 'chip ink', style: { marginLeft: '8px' } }, 'bu cihaz') : null, h('div', { class: 'muted' }, d.lastSeenAt ? `Son kullanım ${fullDate(new Date(d.lastSeenAt))}` : '')),
            d.current
              ? null
              : h(
                  'button',
                  {
                    class: 'btn sm danger',
                    onclick: async () => {
                      await api(`/api/devices/${d.id}`, { method: 'DELETE' });
                      toast('Cihaz kaldırıldı.');
                      renderAyarlar();
                    },
                  },
                  'Kaldır',
                ),
          ),
        ),
      ),
      h('p', { class: 'muted' }, 'Yeni cihaz için Telegram\'da "bağla" yaz.'),
    ),
    h(
      'div',
      { class: 'panel' },
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

// --- Detay ---------------------------------------------------------------------------

function openDrawer(id) {
  const item = itemById(id);
  if (!item) return;
  state.openId = id;
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

function renderDrawer(item) {
  const facts = [];
  if (item.deadlineAt) {
    const d = new Date(item.deadlineAt);
    facts.push(
      h(
        'div',
        { class: 'fact' },
        h('div', { class: 'label' }, item.category === 'goal' ? 'Hedef bitişi' : 'Son tarih'),
        h('div', { class: 'big' }, fullDate(d)),
        h('div', { class: whenClass(d) }, `${whenText(d)} · ${SOURCE[item.deadlineSource] || ''}`),
        item.deadlineEvidence ? h('blockquote', { class: 'quote' }, `“${item.deadlineEvidence}”`) : null,
      ),
    );
  }
  if (item.eventAt) {
    facts.push(h('div', { class: 'fact' }, h('div', { class: 'label' }, 'Etkinlik'), h('div', { class: 'big' }, fullDate(new Date(item.eventAt))), item.location ? h('div', { class: 'muted' }, item.location) : null));
  }
  if (!item.deadlineAt && !item.eventAt) facts.push(h('div', { class: 'fact' }, h('div', { class: 'label' }, 'Son tarih'), h('div', { class: 'muted' }, 'Tarih yok. Aşağıdan bir tarih verebilirsin.')));

  const blocks = state.blocks.filter((b) => b.itemId === item.id);
  const reminders = state.reminders.filter((r) => r.itemId === item.id);
  if (blocks.length || reminders.length) {
    facts.push(
      h(
        'div',
        { class: 'fact' },
        h('div', { class: 'label' }, 'Plan'),
        h(
          'ul',
          { class: 'timeline' },
          blocks.map((b) => h('li', {}, `Çalışma: ${fullDate(new Date(b.startAt))}–${hhmm(new Date(b.endAt))}`)),
          reminders.map((r) => h('li', {}, `${REMINDER_KIND[r.kind] || 'Hatırlatma'}: ${fullDate(new Date(r.sendAt))}`)),
        ),
      ),
    );
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
            const key = `rafta:check:${item.id}:${i}`;
            return h('li', {}, h('input', { type: 'checkbox', checked: localGet(key) === '1', onchange: (e) => localSet(key, e.target.checked ? '1' : '0') }), h('span', {}, r));
          }),
        ),
      ),
    );
  }
  if (item.keyNotes.length) facts.push(h('div', { class: 'fact' }, h('div', { class: 'label' }, 'Notlar'), h('ul', {}, item.keyNotes.map((n) => h('li', {}, n)))));
  if (item.effortMinutes) facts.push(h('div', { class: 'fact' }, h('div', { class: 'label' }, 'Tahmini süre'), h('div', {}, effortText(item.effortMinutes))));
  if (item.sourceUrl) {
    let host = item.sourceUrl;
    try {
      host = new URL(item.sourceUrl).hostname.replace(/^www\./, '');
    } catch {}
    facts.push(h('div', { class: 'fact' }, h('div', { class: 'label' }, 'Kaynak'), h('a', { href: item.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, host)));
  }

  const dateArea = h('div', { hidden: true });
  const snoozeArea = h('div', { class: 'snooze-menu', hidden: true });
  const dateText = h('input', { placeholder: 'perşembe 18:00, cuma, 24 Ekim…', 'aria-label': 'Yeni tarih' });
  const dateLocal = h('input', { type: 'datetime-local', 'aria-label': 'Tarih seç' });
  dateArea.append(
    h(
      'form',
      {
        class: 'inline-form',
        onsubmit: async (e) => {
          e.preventDefault();
          const body = dateLocal.value ? { iso: new Date(dateLocal.value).toISOString() } : { text: dateText.value };
          try {
            const { item: updated, reminders: count } = await api(`/api/items/${item.id}/date`, { method: 'POST', body });
            upsert(updated);
            toast(`Son tarih güncellendi; ${count} hatırlatma kuruldu.`);
            await refreshSide();
          } catch (err) {
            toast(err.message, 'err');
          }
        },
      },
      dateText,
      h('button', { class: 'btn primary', type: 'submit' }, 'Kaydet'),
    ),
    h('div', { class: 'inline-form' }, dateLocal),
  );
  for (const o of item.snoozeOptions || []) {
    snoozeArea.append(
      h(
        'button',
        {
          class: 'btn sm',
          onclick: async () => {
            try {
              const { item: updated, remindAt } = await api(`/api/items/${item.id}/snooze`, { method: 'POST', body: { option: o.id } });
              upsert(updated);
              toast(`Tamam, ${fullDate(new Date(remindAt))} için hatırlatırım.`);
              await refreshSide();
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        },
        o.label,
      ),
    );
  }
  const suggestion = state.suggestions.find((s) => s.itemId === item.id);

  $('#drawer').tabIndex = -1;
  mount($('#drawer'), 
    h(
      'div',
      { class: 'head' },
      h(
        'div',
        {},
        h('span', { class: `chip ${CATEGORY_CHIP[item.category] || 'ink'}` }, CATEGORY[item.category]),
        item.sourceType === 'extension' ? h('span', { class: 'chip', style: { marginLeft: '6px' } }, 'tarayıcıdan') : null,
        h('h2', { id: 'drawerTitle' }, item.title),
        item.organization ? h('div', { class: 'muted' }, item.organization) : null,
      ),
      h('button', { class: 'btn icon ghost', 'aria-label': 'Kapat', onclick: closeDrawer }, '×'),
    ),
    h('div', { style: { marginTop: '10px' } }, facts),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => act(item, 'done') }, 'Yaptım'),
      item.snoozeOptions?.length ? h('button', { class: 'btn', onclick: () => ((snoozeArea.hidden = !snoozeArea.hidden), (dateArea.hidden = true)) }, 'Ertele') : null,
      h('button', { class: 'btn', onclick: () => ((dateArea.hidden = !dateArea.hidden), (snoozeArea.hidden = true), dateText.focus()) }, 'Tarihi değiştir'),
      item.category === 'goal' ? h('button', { class: 'btn', onclick: () => nextWeek(item) }, 'Haftaya taşı') : null,
      suggestion ? h('button', { class: 'btn', onclick: () => acceptSuggestion(suggestion) }, `Çalışma bloğu: ${DAYS_SHORT[weekdayIndex(new Date(suggestion.startAt))]} ${hhmm(new Date(suggestion.startAt))}`) : null,
      item.deadlineAt || item.eventAt ? h('a', { class: 'btn', href: `/api/items/${item.id}/ics`, download: '' }, 'Takvime ekle') : null,
      h('button', { class: 'btn danger', onclick: () => act(item, 'drop') }, 'Vazgeç'),
    ),
    snoozeArea,
    dateArea,
  );
}

async function nextWeek(item) {
  try {
    const { item: updated } = await api(`/api/items/${item.id}/next-week`, { method: 'POST' });
    upsert(updated);
    toast('Gelecek haftaya taşındı.');
    await refreshSide();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function act(item, action) {
  try {
    const { item: updated } = await api(`/api/items/${item.id}/${action}`, { method: 'POST' });
    upsert(updated);
    if (state.openId === item.id && action !== 'reopen') closeDrawer();
    toast(action === 'done' ? `Raftan indirdim: ${item.title}` : action === 'drop' ? `Bıraktım: ${item.title}` : 'Rafa geri koydum.');
    await refreshSide();
    if (state.view === 'hafta') renderHafta();
  } catch (err) {
    toast(err.message, 'err');
  }
}

// --- Kayıt (üst çubuk, hızlı ekran, Paylaş) ------------------------------------------

const FAIL = {
  needs_text: 'Bu sayfayı açamadım. Metni yapıştır ya da tarayıcı uzantısını kullan.',
  off_topic: 'Burada rafa kaldırılacak bir iş bulamadım.',
  unreadable: 'İçeriği okuyamadım.',
  error: 'Bir sorun oldu, tekrar dener misin?',
};

/** Metni ya da linki rafa kaldırır; bitene kadar bekler ve sonucu döndürür. */
async function capture(value, onProgress) {
  const url = value.match(/https?:\/\/\S+/)?.[0];
  const rest = url ? value.replace(url, '').trim() : value.trim();
  const body = url ? { url, note: rest || undefined } : rest.length > 1000 ? { text: rest } : { note: rest };
  const { id } = await api('/api/capture', { method: 'POST', body });
  onProgress?.('Okunuyor, son tarih aranıyor…');
  toast('Okunuyor, son tarih aranıyor…');
  const started = Date.now();
  let status;
  do {
    await new Promise((r) => setTimeout(r, 1500));
    status = await api(`/api/captures/${encodeURIComponent(id)}`);
  } while (status.state === 'pending' && Date.now() - started < 240000);
  if (status.state === 'saved' || status.state === 'duplicate') {
    upsert(status.item);
    const d = dueOf(status.item);
    toast(`${status.state === 'saved' ? 'Rafa koydum' : 'Zaten rafta'}: ${status.item.title}${d ? ` · ${whenText(d)}` : ''}`);
    refreshSide().catch(() => {});
  } else {
    toast(FAIL[status.reason] || FAIL.error, 'err');
  }
  return status;
}

$('#captureForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#captureInput');
  const value = input.value.trim();
  if (!value) return;
  input.value = '';
  input.disabled = true;
  try {
    await capture(value);
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    input.disabled = false;
    input.focus();
  }
});

const EXAMPLES = ['bu hafta ', 'yarın ', 'cuma 18:00 ', 'hafta sonuna kadar '];

function showQuick(prefill = '') {
  $('#app').hidden = true;
  $('#login').hidden = true;
  $('#quick').hidden = false;
  const ta = $('#quickText');
  if (prefill) ta.value = prefill;
  mount($('#quickExamples'), 
    ...EXAMPLES.map((ex) =>
      h(
        'button',
        {
          type: 'button',
          onclick: () => {
            ta.value = ex + ta.value;
            ta.focus();
          },
        },
        `${ex.trim()} …`,
      ),
    ),
  );
  ta.focus();
}

$('#quickForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ta = $('#quickText');
  const value = ta.value.trim();
  if (!value) return;
  const result = $('#quickResult');
  const btn = e.submitter;
  btn.disabled = true;
  mount(result, h('p', { class: 'muted' }, 'Rafa kaldırıyorum…'));
  try {
    const status = await capture(value, (t) => mount(result, h('p', { class: 'muted' }, t)));
    if (status.state === 'saved' || status.state === 'duplicate') {
      ta.value = '';
      const d = dueOf(status.item);
      mount(result, 
        h(
          'div',
          { class: 'panel' },
          h('span', { class: `chip ${CATEGORY_CHIP[status.item.category] || 'ink'}` }, CATEGORY[status.item.category]),
          h('h3', { style: { marginTop: '8px' } }, status.item.title),
          h('p', { class: 'muted' }, d ? fullDate(d) : 'Tarihsiz'),
          h('button', { class: 'btn', type: 'button', onclick: () => (mount(result, ), ta.focus()) }, 'Bir tane daha'),
        ),
      );
    } else {
      mount(result, h('p', { class: 'error' }, FAIL[status.reason] || FAIL.error));
    }
  } catch (err) {
    mount(result, h('p', { class: 'error' }, err.message));
  } finally {
    btn.disabled = false;
  }
});

// --- Gezinme ve klavye -----------------------------------------------------------------

const VIEWS = ['raf', 'takvim', 'hafta', 'arsiv', 'ayarlar'];

function render() {
  for (const a of document.querySelectorAll('.nav a')) a.classList.toggle('active', a.dataset.view === state.view);
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== state.view;
  const urgent = state.items.filter((i) => dueOf(i) && dueOf(i) <= addDays(startOfDay(new Date()), 1)).length;
  $('#badgeToday').hidden = !urgent;
  $('#badgeToday').textContent = String(urgent);
  if (state.view === 'raf') renderRaf();
  if (state.view === 'takvim') renderTakvim();
  if (state.view === 'hafta') renderHafta().catch((e) => toast(e.message, 'err'));
  if (state.view === 'arsiv') renderArsiv().catch((e) => toast(e.message, 'err'));
  if (state.view === 'ayarlar') renderAyarlar().catch((e) => toast(e.message, 'err'));
  if (state.openId) {
    const item = itemById(state.openId);
    if (item) renderDrawer(item);
    else closeDrawer();
  }
}

function route() {
  const view = location.hash.replace('#', '') || 'raf';
  if (view === 'yeni') return showQuick();
  $('#quick').hidden = true;
  $('#app').hidden = false;
  state.view = VIEWS.includes(view) ? view : 'raf';
  render();
}

window.addEventListener('hashchange', route);

document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    if (!$('#drawer').hidden) closeDrawer();
    else if (typing) document.activeElement.blur();
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || $('#app').hidden) return;
  const k = e.key.toLowerCase();
  if (k === '/' || k === 'n') {
    e.preventDefault();
    $('#captureInput').focus();
  } else if (state.view === 'takvim' && k === 't') {
    state.anchor = startOfDay(new Date());
    renderTakvim();
  } else if (state.view === 'takvim' && k === 'w') setCalMode('hafta');
  else if (state.view === 'takvim' && k === 'm') setCalMode('ay');
  else if (state.view === 'takvim' && e.key === 'ArrowLeft') shift(-1);
  else if (state.view === 'takvim' && e.key === 'ArrowRight') shift(1);
  else if (k === 'g') location.hash = '#takvim';
});

// --- Başlangıç -----------------------------------------------------------------------

/** Android Paylaş menüsünden gelen: ?title=&text=&url= */
function sharedText() {
  const p = new URLSearchParams(location.search);
  if (!p.has('text') && !p.has('url') && !p.has('title')) return null;
  const parts = [p.get('title'), p.get('text'), p.get('url')].filter(Boolean);
  history.replaceState(null, '', '/#yeni');
  return [...new Set(parts)].join('\n');
}

async function start() {
  const shared = sharedText();
  try {
    await load();
  } catch (err) {
    if (err.status !== 401) toast(err.message, 'err');
    return;
  }
  $('#login').hidden = true;
  if (shared) {
    showQuick(shared);
    $('#quickForm').requestSubmit();
    return;
  }
  route();
}

setInterval(() => {
  if (!$('#app').hidden && document.visibilityState === 'visible' && !drag) load().catch(() => {});
}, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('#app').hidden) load().catch(() => {});
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

start();
