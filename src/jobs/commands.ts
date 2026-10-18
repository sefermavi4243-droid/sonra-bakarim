import type { User } from '../db/schema.js';
import {
  TEXT,
  deleteButtons,
  deviceButtons,
  devicesMessage,
  linkCodeMessage,
  listMessage,
  todayMessage,
} from '../notify/messages.js';
import { local } from '../rules/time.js';
import { sendFullCalendar } from './calendar.js';
import type { AppDeps } from './deps.js';
import { buildUserDigest } from './digest.js';
import { LINK_CODE_MINUTES, createLinkCode } from './link.js';

export type Command =
  | 'listem'
  | 'bugün'
  | 'yardım'
  | 'verilerimi sil'
  | 'bağla'
  | 'cihazlarım'
  | 'takvim'
  | 'özet'
  | 'özet aç'
  | 'özet kapat'
  | 'brifing aç'
  | 'brifing kapat';

const ALIASES: Record<string, Command> = {
  listem: 'listem',
  liste: 'listem',
  listele: 'listem',
  bugün: 'bugün',
  bugun: 'bugün',
  yardım: 'yardım',
  yardim: 'yardım',
  help: 'yardım',
  'verilerimi sil': 'verilerimi sil',
  'verilerimi silin': 'verilerimi sil',
  bağla: 'bağla',
  bagla: 'bağla',
  'cihaz bağla': 'bağla',
  cihazlarım: 'cihazlarım',
  cihazlarim: 'cihazlarım',
  cihazlar: 'cihazlarım',
  takvim: 'takvim',
  takvimim: 'takvim',
  özet: 'özet',
  ozet: 'özet',
  'haftalık özet': 'özet',
  'özet aç': 'özet aç',
  'ozet ac': 'özet aç',
  'özet kapat': 'özet kapat',
  'ozet kapat': 'özet kapat',
  'brifing aç': 'brifing aç',
  'brifing ac': 'brifing aç',
  'sabah brifingi aç': 'brifing aç',
  'brifing kapat': 'brifing kapat',
  'sabah brifingi kapat': 'brifing kapat',
};

export function parseCommand(text: string): Command | null {
  const t = text
    .toLocaleLowerCase('tr')
    .replace(/[.!?,;:'"]/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIASES[t] ?? null;
}

const LIST_LIMIT = 10;
export const DELETE_CONFIRM_MINUTES = 10;

export async function runCommand(deps: AppDeps, user: User, cmd: Command): Promise<void> {
  const to = user.address;
  const zone = user.timezone;
  const { store, notifier } = deps;
  switch (cmd) {
    case 'listem': {
      const items = await store.listOpenItems(user.id, LIST_LIMIT);
      await notifier.sendText(to, listMessage(items, zone));
      return;
    }
    case 'bugün': {
      const today = local(deps.now(), zone).startOf('day');
      const items = await store.listOpenItemsDueBetween(user.id, today.toJSDate(), today.plus({ days: 1 }).endOf('day').toJSDate());
      await notifier.sendText(to, todayMessage(items, zone));
      return;
    }
    case 'yardım':
      await notifier.sendText(to, TEXT.help);
      return;
    case 'verilerimi sil': {
      const expiresAt = new Date(+deps.now() + DELETE_CONFIRM_MINUTES * 60_000).toISOString();
      await store.setPendingAction(user.id, { type: 'confirm_delete', expiresAt });
      await notifier.sendButtons(to, TEXT.deleteConfirm, deleteButtons());
      return;
    }
    case 'bağla': {
      const code = await createLinkCode(store, user, deps.now());
      await notifier.sendText(to, linkCodeMessage(code, LINK_CODE_MINUTES));
      return;
    }
    case 'cihazlarım': {
      const devices = await store.listDevices(user.id);
      const text = devicesMessage(devices, zone);
      if (devices.length) await notifier.sendButtons(to, text, deviceButtons(devices));
      else await notifier.sendText(to, text);
      return;
    }
    case 'takvim':
      await sendFullCalendar(deps, user);
      return;
    case 'özet':
      await notifier.sendText(to, (await buildUserDigest(deps, user)) ?? TEXT.noDigest);
      return;
    case 'özet aç':
    case 'özet kapat':
      await store.updateUser(user.id, { weeklyDigest: cmd === 'özet aç' });
      await notifier.sendText(to, cmd === 'özet aç' ? TEXT.digestOn : TEXT.digestOff);
      return;
    case 'brifing aç':
    case 'brifing kapat':
      await store.updateUser(user.id, { morningBrief: cmd === 'brifing aç' });
      await notifier.sendText(to, cmd === 'brifing aç' ? TEXT.briefOn : TEXT.briefOff);
      return;
  }
}

/** Onaydan sonra kullanıcının tüm verisini (kayıtlar, hatırlatmalar, cihazlar, medya) siler. */
export async function deleteAllData(deps: AppDeps, user: User): Promise<void> {
  const paths = await deps.store.deleteUserData(user.id);
  try {
    await deps.storage.remove(paths);
  } catch (err) {
    deps.log('medya silinemedi', { userId: user.id, err: String(err) });
  }
  await deps.notifier.sendText(user.address, TEXT.deleteDone);
}
