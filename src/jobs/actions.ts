import type { Item, User } from '../db/schema.js';
import { type DateParse, parseTurkishDate } from '../rules/relative.js';
import { type SnoozeOption, availableSnoozes, snoozeTime } from '../rules/schedule.js';
import { type AppDeps, prefsOf } from './deps.js';
import { closeItem, replan } from './items.js';

/**
 * Kayıt üzerindeki işlemler; kanaldan bağımsız. Telegram/WhatsApp düğmeleri, API ve
 * web paneli aynı fonksiyonları çağırır, mesaj göndermek çağıranın işidir.
 */

export function isClosed(item: Item): boolean {
  return item.status === 'done' || item.status === 'dropped' || item.status === 'expired';
}

export async function finishItem(deps: AppDeps, user: User, item: Item, how: 'done' | 'dropped'): Promise<Item | null> {
  const now = deps.now();
  await deps.store.insertInteraction(user.id, item.id, how === 'done' ? 'done' : 'drop', now);
  return closeItem(deps.store, item.id, how, now);
}

/** Kapalı kaydı yeniden açar ve hatırlatmalarını kurar. */
export async function reopenItem(deps: AppDeps, user: User, item: Item): Promise<Item | null> {
  const now = deps.now();
  const updated = await deps.store.updateItem(item.id, { status: 'open', closedAt: null });
  if (updated) await replan(deps.store, updated, user, now);
  await deps.store.insertInteraction(user.id, item.id, 'reopen', now);
  return updated;
}

export function snoozeOptions(deps: AppDeps, user: User, item: Item): SnoozeOption[] {
  return availableSnoozes(deps.now(), item.deadlineAt, prefsOf(user));
}

/** Kural 8: son tarihi geçmeyen tek bir hatırlatma kurar. Geçiyorsa null. */
export async function snoozeItem(deps: AppDeps, user: User, item: Item, option: SnoozeOption): Promise<Date | null> {
  const now = deps.now();
  const at = snoozeTime(option, now, item.deadlineAt, prefsOf(user));
  if (!at) return null;
  // Erteleme, bekleyen planın yerine kullanıcının seçtiği tek hatırlatmayı koyar.
  await deps.store.cancelScheduledReminders(item.id);
  await deps.store.insertReminders([{ itemId: item.id, userId: user.id, kind: 'nudge', sendAt: at }]);
  await deps.store.updateItem(item.id, { status: 'snoozed' });
  await deps.store.insertInteraction(user.id, item.id, `snooze_${option}`, now);
  return at;
}

export type DateChange =
  | { kind: 'ok'; item: Item; reminders: number }
  | { kind: 'ambiguous'; question: string }
  | { kind: 'not_understood' }
  | { kind: 'past' };

/** Kullanıcının verdiği son tarihi uygular ve hatırlatmaları yeniden kurar. */
export async function setDeadline(deps: AppDeps, user: User, item: Item, date: Date, evidence: string): Promise<DateChange> {
  const now = deps.now();
  if (date <= now) return { kind: 'past' };
  const updated = await deps.store.updateItem(item.id, {
    deadlineAt: date,
    deadlineSource: 'user',
    deadlineEvidence: evidence.trim(),
    status: 'open',
    closedAt: null,
  });
  const count = await replan(deps.store, updated!, user, now);
  await deps.store.insertInteraction(user.id, item.id, 'date_set', now);
  return { kind: 'ok', item: updated!, reminders: count };
}

/** Serbest metinli tarih ("perşembe 18:00") aynı Türkçe çözücüden geçer. */
export async function setDeadlineFromText(deps: AppDeps, user: User, item: Item, text: string): Promise<DateChange> {
  const parsed: DateParse = parseTurkishDate(text, deps.now(), user.timezone);
  if (parsed.kind === 'ambiguous') return { kind: 'ambiguous', question: parsed.question };
  if (parsed.kind === 'none') return { kind: 'not_understood' };
  return setDeadline(deps, user, item, parsed.date, text);
}
