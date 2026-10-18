import type { Item, ItemStatus, SourceType, User } from '../db/schema.js';
import type { Store } from '../db/store.js';
import type { Finalized } from '../extract/finalize.js';
import { buildCard } from '../notify/messages.js';
import { planReminders } from '../rules/schedule.js';
import { type AppDeps, prefsOf } from './deps.js';

export interface SourceInfo {
  sourceType: SourceType;
  sourceUrl: string | null;
  rawText: string | null;
  mediaPath: string | null;
  dedupeHash: string | null;
}

/** Kaydın bekleyen hatırlatmalarını iptal edip SPEC bölüm 10'a göre yeniden kurar. */
export async function replan(store: Store, item: Item, user: User, now: Date, checkInAt: Date | null = null): Promise<number> {
  await store.cancelScheduledReminders(item.id);
  const planned = planReminders({
    deadline: item.deadlineAt,
    effortMinutes: item.effortMinutes,
    eventAt: item.eventAt,
    checkInAt,
    now,
    prefs: prefsOf(user),
  });
  await store.insertReminders(planned.map((p) => ({ itemId: item.id, userId: user.id, kind: p.kind, sendAt: p.sendAt })));
  return planned.length;
}

/** Kural 7: kayıt kapanınca bekleyen hatırlatmalar iptal edilir. */
export async function closeItem(store: Store, itemId: string, status: Extract<ItemStatus, 'done' | 'dropped' | 'expired'>, now: Date) {
  const item = await store.updateItem(itemId, { status, closedAt: now });
  await store.cancelScheduledReminders(itemId);
  return item;
}

/** Çıkarılan bilgiden kaydı oluşturur, hatırlatmaları kurar ve kartı gönderir. */
export async function saveItem(
  deps: AppDeps,
  user: User,
  f: Finalized,
  source: SourceInfo,
  opts: { fromBrowser?: boolean } = {},
): Promise<Item> {
  const now = deps.now();
  const item = await deps.store.createItem({
    userId: user.id,
    ...source,
    title: f.title,
    category: f.category,
    organization: f.organization,
    deadlineAt: f.deadline,
    deadlineSource: f.deadlineSource,
    deadlineEvidence: f.deadlineEvidence,
    eventAt: f.eventAt,
    location: f.location,
    effortMinutes: f.effortMinutes,
    requirements: f.requirements,
    keyNotes: f.keyNotes,
    nextAction: f.nextAction,
    status: 'open',
  });
  await replan(deps.store, item, user, now, f.checkInAt);

  if (f.question) await deps.store.setPendingAction(user.id, { type: 'change_date', itemId: item.id });

  const card = buildCard({
    item,
    zone: user.timezone,
    defaultReason: f.defaultReason,
    question: f.question,
    deadlinePassed: item.deadlineAt !== null && item.deadlineAt <= now,
    fromBrowser: opts.fromBrowser,
    // Telegram dosya gönderebilir; WhatsApp'ta 3 düğme sınırı var.
    calendarButton: user.address.startsWith('tg:'),
  });
  await deps.notifier.sendButtons(user.address, card.text, card.buttons);
  return item;
}
