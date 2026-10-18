import type { User } from '../db/schema.js';
import { TEXT, dateUpdated, prepMessage, checklist, snoozeButtons, snoozed } from '../notify/messages.js';
import { parseTurkishDate } from '../rules/relative.js';
import { availableSnoozes, snoozeTime, type SnoozeOption } from '../rules/schedule.js';
import { deleteAllData } from './commands.js';
import { type AppDeps, prefsOf } from './deps.js';
import { closeItem, replan } from './items.js';

const SNOOZE_ACTIONS: Record<string, SnoozeOption> = { s3h: '3h', stm: 'tomorrow', swe: 'weekend' };

/** Düğme yükü: `eylem:kayıtId`. */
export async function handleButton(deps: AppDeps, user: User, payload: string): Promise<void> {
  const [action = '', itemId = ''] = payload.split(':');
  const { store, notifier } = deps;
  const to = user.address;
  const now = deps.now();

  if (action === 'delyes' || action === 'delno') {
    const pending = user.pendingAction;
    const valid = pending?.type === 'confirm_delete' && new Date(pending.expiresAt) > now;
    await store.setPendingAction(user.id, null);
    if (action === 'delyes' && valid) {
      await deleteAllData(deps, user);
    } else {
      await notifier.sendText(to, TEXT.deleteCancelled);
    }
    return;
  }

  const item = await store.getItem(itemId);
  if (!item || item.userId !== user.id) {
    await notifier.sendText(to, TEXT.itemGone);
    return;
  }
  await store.insertInteraction(user.id, item.id, action, now);
  const closed = item.status === 'done' || item.status === 'dropped';

  switch (action) {
    case 'ok':
      await notifier.sendText(to, TEXT.confirmed);
      return;
    case 'date':
      await store.setPendingAction(user.id, { type: 'change_date', itemId: item.id });
      await notifier.sendText(to, TEXT.askDate);
      return;
    case 'prep':
      await store.insertPrep(item.id, 'checklist', checklist(item));
      await notifier.sendText(to, prepMessage(item));
      return;
    case 'done':
    case 'drop':
      if (closed) {
        await notifier.sendText(to, TEXT.itemClosed);
        return;
      }
      await closeItem(store, item.id, action === 'done' ? 'done' : 'dropped', now);
      await notifier.sendText(to, action === 'done' ? TEXT.done : TEXT.dropped);
      return;
    case 'start':
      await notifier.sendText(to, TEXT.started);
      return;
    case 'going':
      await notifier.sendText(to, TEXT.going);
      return;
    case 'snooze': {
      if (closed) {
        await notifier.sendText(to, TEXT.itemClosed);
        return;
      }
      const options = availableSnoozes(now, item.deadlineAt, prefsOf(user));
      if (options.length === 0) await notifier.sendText(to, TEXT.cannotSnooze);
      else await notifier.sendButtons(to, TEXT.snoozeAsk, snoozeButtons(item.id, options));
      return;
    }
  }

  const option = SNOOZE_ACTIONS[action];
  if (option) {
    if (closed) {
      await notifier.sendText(to, TEXT.itemClosed);
      return;
    }
    const at = snoozeTime(option, now, item.deadlineAt, prefsOf(user));
    if (!at) {
      await notifier.sendText(to, TEXT.cannotSnooze);
      return;
    }
    // Erteleme, bekleyen planın yerine kullanıcının seçtiği tek hatırlatmayı koyar.
    await store.cancelScheduledReminders(item.id);
    await store.insertReminders([{ itemId: item.id, userId: user.id, kind: 'nudge', sendAt: at }]);
    await store.updateItem(item.id, { status: 'snoozed' });
    await notifier.sendText(to, snoozed(at, user.timezone));
    return;
  }

  deps.log('bilinmeyen düğme', { payload });
}

/**
 * "Tarihi değiştir" ya da tarih sorusuna verilen serbest metin yanıtı (SPEC bölüm 11).
 * Tarih anlaşılırsa true döner.
 */
export async function applyDateAnswer(deps: AppDeps, user: User, itemId: string, text: string): Promise<boolean> {
  const { store, notifier } = deps;
  const to = user.address;
  const now = deps.now();
  const item = await store.getItem(itemId);
  if (!item || item.userId !== user.id) {
    await store.setPendingAction(user.id, null);
    await notifier.sendText(to, TEXT.itemGone);
    return true;
  }
  const parsed = parseTurkishDate(text, now, user.timezone);
  if (parsed.kind === 'ambiguous') {
    await notifier.sendText(to, parsed.question);
    return false;
  }
  if (parsed.kind === 'none') {
    await notifier.sendText(to, TEXT.dateNotUnderstood);
    return false;
  }
  if (parsed.date <= now) {
    await notifier.sendText(to, TEXT.datePast);
    return false;
  }
  const updated = await store.updateItem(item.id, {
    deadlineAt: parsed.date,
    deadlineSource: 'user',
    deadlineEvidence: text.trim(),
    status: 'open',
  });
  await store.setPendingAction(user.id, null);
  const count = await replan(store, updated!, user, now);
  await store.insertInteraction(user.id, item.id, 'date_set', now);
  await notifier.sendText(to, dateUpdated(updated!, user.timezone, count));
  return true;
}
