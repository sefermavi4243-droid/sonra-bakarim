import { buildCalendar, icsFileName } from '../calendar/ics.js';
import type { Item, User } from '../db/schema.js';
import { TEXT, calendarMessage } from '../notify/messages.js';
import type { AppDeps } from './deps.js';
import { ensureCalendarToken } from './link.js';

export function calendarUrl(deps: AppDeps, token: string): string {
  return `${deps.appUrl.replace(/\/$/, '')}/takvim/${token}.ics`;
}

/** Tek kaydı .ics olarak gönderir; telefonda dokununca kendi takvimine eklenir. */
export async function sendItemCalendar(deps: AppDeps, user: User, item: Item): Promise<void> {
  if (!item.deadlineAt && !item.eventAt) {
    await deps.notifier.sendText(user.address, TEXT.noDateForCalendar);
    return;
  }
  if (!deps.notifier.sendFile) {
    await deps.notifier.sendText(user.address, TEXT.calendarFileUnsupported);
    return;
  }
  const ics = buildCalendar([item], user.timezone, deps.now(), item.title);
  await deps.notifier.sendFile(
    user.address,
    { name: icsFileName(item.title), mimeType: 'text/calendar', data: Buffer.from(ics, 'utf8') },
    TEXT.calendarFileCaption,
  );
  await deps.store.insertInteraction(user.id, item.id, 'calendar', deps.now());
}

/** `takvim` komutu: abonelik adresi ve tüm açık kayıtların tek .ics dosyası. */
export async function sendFullCalendar(deps: AppDeps, user: User): Promise<void> {
  const token = await ensureCalendarToken(deps.store, user);
  const items = await deps.store.listItems(user.id, ['open', 'snoozed'], 500);
  await deps.notifier.sendText(user.address, calendarMessage(calendarUrl(deps, token), items.length));
  const dated = items.filter((i) => i.deadlineAt || i.eventAt);
  if (dated.length && deps.notifier.sendFile) {
    const ics = buildCalendar(dated, user.timezone, deps.now());
    await deps.notifier.sendFile(user.address, { name: 'sonra-bakarim.ics', mimeType: 'text/calendar', data: Buffer.from(ics, 'utf8') });
  }
}
