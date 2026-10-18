import type { DateTime } from 'luxon';
import { at, local } from './time.js';

export type DateParse =
  | { kind: 'ok'; date: Date; hasTime: boolean }
  | { kind: 'ambiguous'; question: string }
  | { kind: 'none' };

const MONTHS: Record<string, number> = {
  ocak: 1,
  şubat: 2,
  subat: 2,
  mart: 3,
  nisan: 4,
  mayıs: 5,
  mayis: 5,
  haziran: 6,
  temmuz: 7,
  ağustos: 8,
  agustos: 8,
  eylül: 9,
  eylul: 9,
  ekim: 10,
  kasım: 11,
  kasim: 11,
  aralık: 12,
  aralik: 12,
};

// luxon: pazartesi = 1 ... pazar = 7. Uzunlar önce (cumartesi > cuma, pazartesi > pazar).
const WEEKDAYS: [string, number][] = [
  ['pazartesi', 1],
  ['cumartesi', 6],
  ['çarşamba', 3],
  ['carsamba', 3],
  ['perşembe', 4],
  ['persembe', 4],
  ['salı', 2],
  ['sali', 2],
  ['cuma', 5],
  ['pazar', 7],
];

const WEEKDAY_NAMES = ['', 'pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi', 'pazar'];

// Harf olmayan bir karakterden sonra başlayan sözcük (Türkçe ekler serbest: "cumaya").
const W = '(?:^|[^\\p{L}])';

function normalize(text: string): string {
  return text.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
}

const MONTH_WORDS = Object.keys(MONTHS);

/**
 * Konuşma dilindeki saat: "12'de", "3'te", "9.30'da", "14:00'te". Önünde ay adı ya da
 * "ayın" varsa gündür ("Ekim 24'te"), saat sayılmaz. 1–6 arası, sabah/gece denmedikçe
 * öğleden sonradır ("cuma 3'te" → 15:00); insanlar gece 3 için bunu pek kullanmaz.
 */
function suffixedTime(t: string): { hour: number; minute: number } | null {
  const re = /(?<![\d.:/])(\d{1,2})(?:[:.](\d{2}))?['’](?:de|da|te|ta)(?!\p{L})/gu;
  for (const m of t.matchAll(re)) {
    const before = t.slice(0, m.index).trimEnd();
    const prevWord = /(\p{L}+)$/u.exec(before)?.[1] ?? '';
    if (prevWord === 'ayın' || prevWord === 'ayin' || MONTH_WORDS.includes(prevWord)) continue;
    let hour = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    if (hour > 23 || minute > 59) continue;
    const morning = new RegExp(`${W}(sabah|gece)`, 'u').test(t);
    const evening = new RegExp(`${W}(akşam|aksam|öğleden sonra|ogleden sonra)`, 'u').test(t);
    if (hour >= 1 && hour < 12 && (evening || (hour <= 6 && !morning))) hour += 12;
    return { hour, minute };
  }
  return null;
}

function findTime(t: string): { hour: number; minute: number } | null {
  const evening = new RegExp(`${W}(?:akşam|aksam) (?:saat )?(\\d{1,2})(?:[:.](\\d{2}))?(?![\\d.:/])`, 'u').exec(t);
  if (evening) {
    const hour = Number(evening[1]);
    const minute = evening[2] ? Number(evening[2]) : 0;
    if (hour <= 23 && minute <= 59) return { hour: hour < 12 ? hour + 12 : hour, minute };
  }
  const patterns = [
    new RegExp(`${W}saat (\\d{1,2})(?:[:.](\\d{2}))?`, 'u'),
    /(?<![\d.:/])(\d{1,2}):(\d{2})(?![\d:])/,
    // "18.00", "9.30": nokta ile; ikinci kısım 12'den büyükse ya da 00 ise ay olamaz.
    /(?<![\d.:/])(\d{1,2})\.(00|1[3-9]|[2-5]\d)(?![\d.:/])/,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (!m) continue;
    let hour = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    if (hour > 23 || minute > 59) continue;
    if (hour < 12 && new RegExp(`${W}(akşam|aksam|gece|öğleden sonra|ogleden sonra)`, 'u').test(t)) hour += 12;
    return { hour, minute };
  }
  const suffixed = suffixedTime(t);
  if (suffixed) return suffixed;
  if (new RegExp(`${W}(sabah)`, 'u').test(t)) return { hour: 9, minute: 0 };
  if (new RegExp(`${W}(öğle|ogle)(?!den)`, 'u').test(t)) return { hour: 12, minute: 0 };
  if (new RegExp(`${W}(akşam|aksam)`, 'u').test(t)) return { hour: 20, minute: 0 };
  return null;
}

function weekStart(dt: DateTime): DateTime {
  return dt.startOf('day').minus({ days: dt.weekday - 1 });
}

type DayResult = { kind: 'day'; day: DateTime } | { kind: 'ambiguous'; question: string } | null;

function findDay(t: string, now: DateTime): DayResult {
  const today = now.startOf('day');

  // 2026-10-24
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) {
    const d = today.set({ year: +m[1]!, month: +m[2]!, day: +m[3]! });
    return valid(d, +m[2]!, +m[3]!);
  }

  // 24.10.2026, 24/10, 24.10.26
  m = /(?<![\d:])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d:])/.exec(t);
  if (m && +m[2]! >= 1 && +m[2]! <= 12) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
    return withYear(today, +m[1]!, +m[2]!, year);
  }

  // 24 ekim (2026)
  const monthNames = Object.keys(MONTHS).join('|');
  m = new RegExp(`(\\d{1,2}) (${monthNames})\\p{L}*(?: (\\d{4}))?`, 'u').exec(t);
  if (m) {
    return withYear(today, +m[1]!, MONTHS[m[2]!]!, m[3] ? +m[3] : null);
  }

  if (new RegExp(`${W}bugün|${W}bugun|${W}bu ?akşam|${W}bu ?aksam|${W}bu gece`, 'u').test(t)) {
    return { kind: 'day', day: today };
  }
  if (new RegExp(`${W}(öbür ?gün|obur ?gun|ertesi gün|ertesi gun)`, 'u').test(t)) {
    return { kind: 'day', day: today.plus({ days: 2 }) };
  }
  if (new RegExp(`${W}yarın|${W}yarin`, 'u').test(t)) return { kind: 'day', day: today.plus({ days: 1 }) };

  for (const [name, weekday] of WEEKDAYS) {
    const wm = new RegExp(`${W}((?:bu |haftaya |gelecek hafta |önümüzdeki |onumuzdeki |seneye )?)${name}`, 'u').exec(
      t,
    );
    if (!wm) continue;
    const modifier = wm[1]!.trim();
    if (modifier === 'haftaya' || modifier === 'gelecek hafta') {
      return { kind: 'day', day: weekStart(today).plus({ weeks: 1, days: weekday - 1 }) };
    }
    let diff = (weekday - today.weekday + 7) % 7;
    if (diff === 0) {
      if (modifier === 'bu') return { kind: 'day', day: today };
      if (modifier === 'önümüzdeki' || modifier === 'onumuzdeki') diff = 7;
      else {
        const next = today.plus({ days: 7 }).setLocale('tr').toFormat('d MMMM');
        return {
          kind: 'ambiguous',
          question: `Bugün ${WEEKDAY_NAMES[weekday]} mi, yoksa haftaya ${WEEKDAY_NAMES[weekday]} (${next}) mi?`,
        };
      }
    }
    return { kind: 'day', day: today.plus({ days: diff }) };
  }

  // Hafta ifadeleri (gün adı yoksa): haftalık hedefler için.
  const sunday = weekStart(today).plus({ days: 6 });
  if (new RegExp(`${W}(gelecek|önümüzdeki|onumuzdeki) hafta(?![\\p{L}]| ?sonu| ?içi| ?ici)`, 'u').test(t)) {
    return { kind: 'day', day: sunday.plus({ weeks: 1 }) };
  }
  if (new RegExp(`${W}hafta ?i[çc]i(?!n)`, 'u').test(t)) {
    const friday = weekStart(today).plus({ days: 4 });
    return { kind: 'day', day: friday >= today ? friday : friday.plus({ weeks: 1 }) };
  }
  if (new RegExp(`${W}(bu hafta(?![\\p{L}])|bu hafta i[çc]inde|hafta ?sonu(na|ndan)? ?(kadar)?|bu haftanın sonu)`, 'u').test(t)) {
    return { kind: 'day', day: sunday };
  }

  if (new RegExp(`${W}haftaya(?![\\p{L}])`, 'u').test(t)) return { kind: 'day', day: today.plus({ weeks: 1 }) };

  return null;
}

function valid(d: DateTime, month: number, day: number): DayResult {
  return d.isValid && d.month === month && d.day === day ? { kind: 'day', day: d } : null;
}

/** Yıl yazılmamışsa bu yıl; tarih geçmişte kalıyorsa gelecek yıl. */
function withYear(today: DateTime, day: number, month: number, year: number | null): DayResult {
  const d = today.set({ year: year ?? today.year, month, day });
  const checked = valid(d, month, day);
  if (!checked || checked.kind !== 'day' || year !== null) return checked;
  return checked.day < today ? valid(d.plus({ years: 1 }), month, day) : checked;
}

/**
 * Türkçe serbest tarih ifadesini (`cuma`, `haftaya salı`, `24 Ekim 18:00`, `yarın akşam`)
 * kullanıcının saat diliminde çözer. Saat verilmemişse 23:59 kabul edilir (SPEC bölüm 9).
 */
export function parseTurkishDate(text: string, now: Date, zone: string): DateParse {
  const t = normalize(text);
  const nowLocal = local(now, zone);
  const day = findDay(t, nowLocal);
  const time = findTime(t);

  if (day?.kind === 'ambiguous') return day;
  if (!day) {
    if (!time) return { kind: 'none' };
    // Yalnızca saat: bugün o saat geçmediyse bugün, geçtiyse yarın.
    let d = at(nowLocal, time.hour, time.minute);
    if (d <= nowLocal) d = d.plus({ days: 1 });
    return { kind: 'ok', date: d.toJSDate(), hasTime: true };
  }
  const result = time ? at(day.day, time.hour, time.minute) : at(day.day, 23, 59);
  return { kind: 'ok', date: result.toJSDate(), hasTime: time !== null };
}

/** Metinde bir tarih ya da zaman ipucu var mı? Kanıt cümlesinin gerçekten tarih içerdiğini denetler. */
export function hasDateCue(text: string): boolean {
  const t = normalize(text);
  if (/\d/.test(t)) return true;
  const words = [
    ...Object.keys(MONTHS),
    ...WEEKDAYS.map(([n]) => n),
    'bugün',
    'bugun',
    'yarın',
    'yarin',
    'haftaya',
    'hafta',
    'öbür',
    'obur',
    'ertesi',
    'akşam',
    'aksam',
    'sabah',
    'gece',
    'hafta',
    'ay sonu',
    'ayın',
    'ayin',
  ];
  return words.some((w) => new RegExp(`${W}${w}`, 'u').test(t));
}
