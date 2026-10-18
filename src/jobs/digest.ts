import type { DateTime } from 'luxon';
import type { Item, User } from '../db/schema.js';
import { effortText } from '../notify/messages.js';
import { isQuiet, local } from '../rules/time.js';
import { type AppDeps, prefsOf, windowOpen } from './deps.js';

/** Pazar akşamı özeti bu saatten sonra gider. */
export const DIGEST_HOUR = 19;
/** Sabah brifingi bu saatten sonra gider (sessiz saat bitmişse). */
export const BRIEF_HOUR = 8;
export const BRIEF_MINUTE = 30;
/** Aynı güne bu kadar son tarih düşerse "yoğun gün" sayılır. */
export const BUSY_DAY_THRESHOLD = 2;

const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

function hhmm(d: Date, zone: string): string {
  return local(d, zone).toFormat('HH:mm');
}

/** Bir kaydın o günkü "an"ı: son tarih, yoksa etkinlik. */
function dueAt(item: Item): Date | null {
  return item.deadlineAt ?? item.eventAt;
}

function line(item: Item, zone: string): string {
  const at = dueAt(item)!;
  const time = hhmm(at, zone);
  const what = item.deadlineAt ? (time === '23:59' ? 'son gün' : `son tarih ${time}`) : `etkinlik ${time}`;
  return `• ${item.title} (${what})`;
}

export interface WeeklyStats {
  added: number;
  closed: number;
}

/**
 * Haftalık özet: önümüzdeki 7 günün işleri gün gün, yoğun günler için öneri,
 * geçen haftanın sayıları. Göndermeye değecek bir şey yoksa null.
 */
export function weeklyDigest(open: Item[], stats: WeeklyStats, now: Date, zone: string): string | null {
  const start = local(now, zone).startOf('day');
  const end = start.plus({ days: 8 }); // bugün dahil önümüzdeki 7 gün
  const upcoming = open
    .filter((i) => {
      const at = dueAt(i);
      return at !== null && at >= now && at < end.toJSDate();
    })
    .sort((a, b) => +dueAt(a)! - +dueAt(b)!);
  const undated = open.filter((i) => dueAt(i) === null).length;
  if (upcoming.length === 0 && undated === 0 && stats.added === 0) return null;

  const lines = ['*Haftalık özet*'];
  if (stats.added || stats.closed) lines.push(`Bu hafta ${stats.added} kayıt ekledin, ${stats.closed} tanesini kapattın.`);

  if (upcoming.length) {
    lines.push('', 'Önümüzdeki 7 gün:');
    const byDay = new Map<string, Item[]>();
    for (const item of upcoming) {
      const key = local(dueAt(item)!, zone).toISODate()!;
      byDay.set(key, [...(byDay.get(key) ?? []), item]);
    }
    for (const [, dayItems] of byDay) {
      const d = local(dueAt(dayItems[0]!)!, zone);
      lines.push(`${dayLabel(d, start)}:`, ...dayItems.map((i) => line(i, zone)));
    }

    const busy = [...byDay.values()].find((dayItems) => dayItems.filter((i) => i.deadlineAt).length >= BUSY_DAY_THRESHOLD);
    if (busy) {
      const deadlines = busy.filter((i) => i.deadlineAt);
      const d = local(deadlines[0]!.deadlineAt!, zone);
      const heavy = [...deadlines].sort((a, b) => (b.effortMinutes ?? 0) - (a.effortMinutes ?? 0)).slice(0, 2);
      const total = heavy.reduce((s, i) => s + (i.effortMinutes ?? 0), 0);
      const names = heavy.map((i) => `"${i.title}"`).join(' ve ');
      const effort = total ? ` (toplam yaklaşık ${effortText(total)})` : '';
      lines.push('', `Dikkat: ${DAY_NAMES[d.weekday - 1]} günü ${deadlines.length} son tarih denk geliyor. ${names} için bu hafta başında başlamak iyi olur${effort}.`);
    }
  } else {
    lines.push('', 'Önümüzdeki 7 gün için son tarih yok.');
  }

  if (undated) lines.push('', `Tarihsiz bekleyen ${undated} kayıt var; "listem" ile bakabilirsin.`);
  return lines.join('\n');
}

function dayLabel(d: DateTime, today: DateTime): string {
  const diff = Math.round(d.startOf('day').diff(today, 'days').days);
  const name = DAY_NAMES[d.weekday - 1]!;
  const date = `${d.day} ${d.setLocale('tr').toFormat('LLLL')}`;
  if (diff === 0) return `Bugün, ${date}`;
  if (diff === 1) return `Yarın, ${date}`;
  return `${name}, ${date}`;
}

/** Sabah brifingi: yalnızca bugünün son tarihleri ve etkinlikleri. Bugün boşsa null. */
export function morningBrief(open: Item[], now: Date, zone: string): string | null {
  const today = local(now, zone);
  const todays = open
    .filter((i) => {
      const at = dueAt(i);
      return at !== null && at >= now && local(at, zone).hasSame(today, 'day');
    })
    .sort((a, b) => +dueAt(a)! - +dueAt(b)!);
  if (todays.length === 0) return null;
  return ['Günaydın. Bugün:', ...todays.map((i) => line(i, zone))].join('\n');
}

const WEEK_MS = 7 * 24 * 3600_000;

/** Kullanıcının haftalık özetini (hemen) hazırlar; `özet` komutu ve zamanlayıcı kullanır. */
export async function buildUserDigest(deps: AppDeps, user: User): Promise<string | null> {
  const now = deps.now();
  const all = await deps.store.listItems(user.id, ['open', 'snoozed', 'done', 'dropped', 'expired'], 1000);
  const weekAgo = +now - WEEK_MS;
  const stats = {
    added: all.filter((i) => +i.createdAt >= weekAgo).length,
    closed: all.filter((i) => i.closedAt && +i.closedAt >= weekAgo && (i.status === 'done' || i.status === 'dropped')).length,
  };
  const open = all.filter((i) => i.status === 'open' || i.status === 'snoozed');
  return weeklyDigest(open, stats, now, user.timezone);
}

/**
 * Zamanlayıcının her turunda çağrılır: vakti gelen kullanıcılara haftalık özeti ve
 * sabah brifingini gönderir. Her biri günde en fazla bir kez gider; sessiz saatlere uyar.
 */
export async function runDigests(deps: AppDeps): Promise<void> {
  const now = deps.now();
  for (const user of await deps.store.listUsers()) {
    const zone = user.timezone;
    const t = local(now, zone);
    const todayStart = t.startOf('day').toJSDate();
    if (isQuiet(now, prefsOf(user))) continue;
    // WhatsApp'ta pencere kapalıysa serbest metin gönderilemez; özet şablonu ileride.
    const canText = windowOpen(user, now);

    // digest_day: 0 = pazar (SPEC); luxon'da pazar 7.
    const digestWeekday = user.digestDay === 0 ? 7 : user.digestDay;
    if (
      canText &&
      user.weeklyDigest &&
      t.weekday === digestWeekday &&
      t.hour >= DIGEST_HOUR &&
      (!user.lastDigestAt || user.lastDigestAt < todayStart)
    ) {
      await deps.store.updateUser(user.id, { lastDigestAt: now });
      const text = await buildUserDigest(deps, user);
      if (text) await deps.notifier.sendText(user.address, text).catch((err) => deps.log('özet gönderilemedi', { err: String(err) }));
    }

    if (
      canText &&
      user.morningBrief &&
      (t.hour > BRIEF_HOUR || (t.hour === BRIEF_HOUR && t.minute >= BRIEF_MINUTE)) &&
      t.hour < 12 &&
      (!user.lastBriefAt || user.lastBriefAt < todayStart)
    ) {
      await deps.store.updateUser(user.id, { lastBriefAt: now });
      const open = await deps.store.listItems(user.id, ['open', 'snoozed'], 500);
      const text = morningBrief(open, now, zone);
      if (text) await deps.notifier.sendText(user.address, text).catch((err) => deps.log('brifing gönderilemedi', { err: String(err) }));
    }
  }
}
