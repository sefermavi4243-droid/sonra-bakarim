import type { DateTime } from 'luxon';
import type { Item, User } from '../db/schema.js';
import { carryOverButtons, carryOverQuestion, effortText } from '../notify/messages.js';
import { isQuiet, local } from '../rules/time.js';
import { type AppDeps, prefsOf, windowOpen } from './deps.js';

/** Pazar akşamı özeti bu saatten sonra gider. */
export const DIGEST_HOUR = 19;
/** Sabah brifingi bu saatten sonra gider (sessiz saat bitmişse). */
export const BRIEF_HOUR = 8;
export const BRIEF_MINUTE = 30;
/** Aynı güne bu kadar son tarih düşerse "yoğun gün" sayılır. */
export const BUSY_DAY_THRESHOLD = 2;
/** Pazartesi hafta planı bu saatten sonra gider. */
export const WEEK_PLAN_HOUR = 9;

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

/** Bu haftanın hedefleri: tamamlanan sayısı ve hâlâ açık olanlar. */
export interface GoalStats {
  done: number;
  open: Item[];
}

/** Haftalık hedefin bitişi bu hafta içinde mi (pazartesi–pazar)? */
export function isThisWeeksGoal(item: Item, now: Date, zone: string): boolean {
  if (item.category !== 'goal' || !item.deadlineAt) return false;
  const start = local(now, zone).startOf('week'); // luxon: hafta pazartesi başlar
  const end = start.plus({ weeks: 1 });
  return item.deadlineAt >= start.toJSDate() && item.deadlineAt < end.toJSDate();
}

/**
 * Haftalık özet: önümüzdeki 7 günün işleri gün gün, yoğun günler için öneri,
 * geçen haftanın sayıları. Göndermeye değecek bir şey yoksa null.
 */
export function weeklyDigest(
  open: Item[],
  stats: WeeklyStats,
  now: Date,
  zone: string,
  goals: GoalStats = { done: 0, open: [] },
): string | null {
  const start = local(now, zone).startOf('day');
  const end = start.plus({ days: 8 }); // bugün dahil önümüzdeki 7 gün
  const upcoming = open
    .filter((i) => {
      if (i.category === 'goal') return false; // hedefler kendi bölümünde
      const at = dueAt(i);
      return at !== null && at >= now && at < end.toJSDate();
    })
    .sort((a, b) => +dueAt(a)! - +dueAt(b)!);
  const undated = open.filter((i) => dueAt(i) === null).length;
  const goalTotal = goals.done + goals.open.length;
  if (upcoming.length === 0 && undated === 0 && stats.added === 0 && goalTotal === 0) return null;

  const lines = ['*Haftalık özet*'];
  if (stats.added || stats.closed) lines.push(`Bu hafta ${stats.added} kayıt ekledin, ${stats.closed} tanesini kapattın.`);
  if (goalTotal) {
    lines.push('', `Bu haftanın hedefleri: ${goals.done}/${goalTotal} tamam.`);
    if (goals.open.length) lines.push(...goals.open.map((g) => `• ${g.title} (bitmedi)`));
  }

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

/** Pazartesi sabahı hafta planı: bu haftanın hedefleri. Hedef yoksa null. */
export function weekPlan(goals: Item[], zone: string): string | null {
  if (goals.length === 0) return null;
  return [
    `Yeni hafta. Rafında ${goals.length} haftalık hedef var:`,
    ...goals.map((g) => `• ${g.title}`),
    'Çarşamba akşamı nasıl gittiğini sorarım.',
  ].join('\n');
}

const WEEK_MS = 7 * 24 * 3600_000;

/** Kullanıcının haftalık özetini (hemen) hazırlar; `özet` komutu ve zamanlayıcı kullanır. */
export async function buildUserDigest(deps: AppDeps, user: User): Promise<string | null> {
  return (await collectDigest(deps, user)).text;
}

async function collectDigest(deps: AppDeps, user: User): Promise<{ text: string | null; unfinishedGoals: Item[] }> {
  const now = deps.now();
  const all = await deps.store.listItems(user.id, ['open', 'snoozed', 'done', 'dropped', 'expired'], 1000);
  const weekAgo = +now - WEEK_MS;
  const stats = {
    added: all.filter((i) => +i.createdAt >= weekAgo).length,
    closed: all.filter((i) => i.closedAt && +i.closedAt >= weekAgo && (i.status === 'done' || i.status === 'dropped')).length,
  };
  const open = all.filter((i) => i.status === 'open' || i.status === 'snoozed');
  const weekGoals = all.filter((i) => isThisWeeksGoal(i, now, user.timezone));
  const goals = {
    done: weekGoals.filter((g) => g.status === 'done').length,
    open: weekGoals.filter((g) => g.status === 'open' || g.status === 'snoozed'),
  };
  return { text: weeklyDigest(open, stats, now, user.timezone, goals), unfinishedGoals: goals.open };
}

/** Bitmeyen hedef için "gelecek haftaya taşı / bırak" sorusu (en fazla 3 hedef). */
export const MAX_CARRY_PROMPTS = 3;

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
      const { text, unfinishedGoals } = await collectDigest(deps, user);
      try {
        if (text) await deps.notifier.sendText(user.address, text);
        for (const goal of unfinishedGoals.slice(0, MAX_CARRY_PROMPTS)) {
          await deps.notifier.sendButtons(user.address, carryOverQuestion(goal), carryOverButtons(goal.id));
        }
      } catch (err) {
        deps.log('özet gönderilemedi', { err: String(err) });
      }
    }

    // Pazartesi sabahı hafta planı (yalnızca hedef varsa).
    if (canText && t.weekday === 1 && t.hour >= WEEK_PLAN_HOUR && t.hour < 12 && (!user.lastWeekPlanAt || user.lastWeekPlanAt < todayStart)) {
      await deps.store.updateUser(user.id, { lastWeekPlanAt: now });
      const open = await deps.store.listItems(user.id, ['open', 'snoozed'], 500);
      const text = weekPlan(
        open.filter((i) => isThisWeeksGoal(i, now, zone)),
        zone,
      );
      if (text) await deps.notifier.sendText(user.address, text).catch((err) => deps.log('hafta planı gönderilemedi', { err: String(err) }));
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
