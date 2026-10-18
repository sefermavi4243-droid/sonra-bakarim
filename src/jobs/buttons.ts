import type { User } from '../db/schema.js';
import { TEXT, dateUpdated, prepMessage, checklist, snoozeButtons, snoozed, devicesMessage } from '../notify/messages.js';
import type { SnoozeOption } from '../rules/schedule.js';
import { finishItem, isClosed, setDeadlineFromText, snoozeItem, snoozeOptions } from './actions.js';
import { sendItemCalendar } from './calendar.js';
import { deleteAllData } from './commands.js';
import type { AppDeps } from './deps.js';

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

  if (action === 'devdel') {
    const removed = await store.deleteDevice(user.id, itemId);
    await notifier.sendText(to, removed ? TEXT.deviceRemoved : TEXT.deviceGone);
    if (removed) await notifier.sendText(to, devicesMessage(await store.listDevices(user.id), user.timezone));
    return;
  }

  const item = await store.getItem(itemId);
  if (!item || item.userId !== user.id) {
    await notifier.sendText(to, TEXT.itemGone);
    return;
  }
  const closed = isClosed(item);

  switch (action) {
    case 'ok':
      await store.insertInteraction(user.id, item.id, action, now);
      await notifier.sendText(to, TEXT.confirmed);
      return;
    case 'date':
      await store.insertInteraction(user.id, item.id, action, now);
      await store.setPendingAction(user.id, { type: 'change_date', itemId: item.id });
      await notifier.sendText(to, TEXT.askDate);
      return;
    case 'prep':
      await store.insertInteraction(user.id, item.id, action, now);
      await store.insertPrep(item.id, 'checklist', checklist(item));
      await notifier.sendText(to, prepMessage(item));
      return;
    case 'cal':
      await sendItemCalendar(deps, user, item);
      return;
    case 'done':
    case 'drop':
      if (closed) {
        await notifier.sendText(to, TEXT.itemClosed);
        return;
      }
      await finishItem(deps, user, item, action === 'done' ? 'done' : 'dropped');
      await notifier.sendText(to, action === 'done' ? TEXT.done : TEXT.dropped);
      return;
    case 'start':
      await store.insertInteraction(user.id, item.id, action, now);
      await notifier.sendText(to, TEXT.started);
      return;
    case 'going':
      await store.insertInteraction(user.id, item.id, action, now);
      await notifier.sendText(to, TEXT.going);
      return;
    case 'snooze': {
      if (closed) {
        await notifier.sendText(to, TEXT.itemClosed);
        return;
      }
      const options = snoozeOptions(deps, user, item);
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
    const at = await snoozeItem(deps, user, item, option);
    await notifier.sendText(to, at ? snoozed(at, user.timezone) : TEXT.cannotSnooze);
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
  const item = await store.getItem(itemId);
  if (!item || item.userId !== user.id) {
    await store.setPendingAction(user.id, null);
    await notifier.sendText(to, TEXT.itemGone);
    return true;
  }
  const result = await setDeadlineFromText(deps, user, item, text);
  switch (result.kind) {
    case 'ambiguous':
      await notifier.sendText(to, result.question);
      return false;
    case 'not_understood':
      await notifier.sendText(to, TEXT.dateNotUnderstood);
      return false;
    case 'past':
      await notifier.sendText(to, TEXT.datePast);
      return false;
    case 'ok':
      await store.setPendingAction(user.id, null);
      await notifier.sendText(to, dateUpdated(result.item, user.timezone, result.reminders));
      return true;
  }
}
