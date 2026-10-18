import type { User } from '../db/schema.js';
import { TEXT, deleteButtons, listMessage, todayMessage } from '../notify/messages.js';
import { local } from '../rules/time.js';
import type { AppDeps } from './deps.js';

export type Command = 'listem' | 'bugün' | 'yardım' | 'verilerimi sil';

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
};

export function parseCommand(text: string): Command | null {
  const t = text
    .toLocaleLowerCase('tr')
    .replace(/[.!?,;:'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIASES[t] ?? null;
}

const LIST_LIMIT = 10;
export const DELETE_CONFIRM_MINUTES = 10;

export async function runCommand(deps: AppDeps, user: User, cmd: Command): Promise<void> {
  const to = user.address;
  const zone = user.timezone;
  switch (cmd) {
    case 'listem': {
      const items = await deps.store.listOpenItems(user.id, LIST_LIMIT);
      await deps.notifier.sendText(to, listMessage(items, zone));
      return;
    }
    case 'bugün': {
      const today = local(deps.now(), zone).startOf('day');
      const items = await deps.store.listOpenItemsDueBetween(
        user.id,
        today.toJSDate(),
        today.plus({ days: 1 }).endOf('day').toJSDate(),
      );
      await deps.notifier.sendText(to, todayMessage(items, zone));
      return;
    }
    case 'yardım':
      await deps.notifier.sendText(to, TEXT.help);
      return;
    case 'verilerimi sil': {
      const expiresAt = new Date(+deps.now() + DELETE_CONFIRM_MINUTES * 60_000).toISOString();
      await deps.store.setPendingAction(user.id, { type: 'confirm_delete', expiresAt });
      await deps.notifier.sendButtons(to, TEXT.deleteConfirm, deleteButtons());
      return;
    }
  }
}

/** Onaydan sonra kullanıcının tüm verisini (kayıtlar, hatırlatmalar, medya) siler. */
export async function deleteAllData(deps: AppDeps, user: User): Promise<void> {
  const paths = await deps.store.deleteUserData(user.id);
  try {
    await deps.storage.remove(paths);
  } catch (err) {
    deps.log('medya silinemedi', { userId: user.id, err: String(err) });
  }
  await deps.notifier.sendText(user.address, TEXT.deleteDone);
}
