import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/jobs/commands.js';
import { route } from '../src/jobs/process.js';
import { TEXT } from '../src/notify/messages.js';
import { type TestEnv, addUser, createEnv, ist } from './helpers/fakes.js';

async function say(env: TestEnv, userId: string, text: string) {
  await route(env.deps, (await env.store.getUser(userId))!, { kind: 'text', text });
}
async function press(env: TestEnv, userId: string, payload: string) {
  await route(env.deps, (await env.store.getUser(userId))!, { kind: 'button', payload });
}

async function seedItems(env: TestEnv, userId: string) {
  const mk = (title: string, deadlineAt: Date | null, status: 'open' | 'done' | 'snoozed' = 'open') =>
    env.store.createItem({ userId, sourceType: 'text', title, category: 'task', deadlineAt, status });
  await mk('Tarihsiz', null);
  await mk('Üç', ist('2026-10-25T12:00'));
  await mk('Bir', ist('2026-10-20T18:00'));
  await mk('Kapalı', ist('2026-10-19T12:00'), 'done');
  await mk('İki', ist('2026-10-21T09:00'), 'snoozed');
}

describe('komut ayrıştırma', () => {
  it('Türkçe ve ASCII yazımlar', () => {
    expect(parseCommand('Listem')).toBe('listem');
    expect(parseCommand(' bugun ')).toBe('bugün');
    expect(parseCommand('YARDIM')).toBe('yardım');
    expect(parseCommand('Verilerimi sil.')).toBe('verilerimi sil');
    expect(parseCommand('listemdeki ilana bak')).toBeNull();
  });
});

describe('listem / bugün / yardım', () => {
  it('listem açık kayıtları son tarihe göre sıralı gösterir', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    const user = await addUser(env);
    await seedItems(env, user.id);
    await say(env, user.id, 'listem');
    expect(env.notifier.lastText()).toBe(
      ['Raftakiler:', '1. Bir — 20 Eki Sal 18:00', '2. İki — 21 Eki Çar 09:00', '3. Üç — 25 Eki Paz 12:00', '4. Tarihsiz'].join('\n'),
    );
  });

  it('listem en fazla 10 kayıt gösterir', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    const user = await addUser(env);
    for (let i = 0; i < 12; i++) {
      await env.store.createItem({ userId: user.id, sourceType: 'text', title: `K${i}`, category: 'task' });
    }
    await say(env, user.id, 'listem');
    expect(env.notifier.lastText().split('\n')).toHaveLength(11);
  });

  it('boş liste', async () => {
    const env = createEnv();
    const user = await addUser(env);
    await say(env, user.id, 'listem');
    expect(env.notifier.lastText()).toBe(TEXT.emptyList);
  });

  it('bugün: bugün ve yarın son tarihi olanlar', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    const user = await addUser(env);
    await seedItems(env, user.id);
    await say(env, user.id, 'bugün');
    expect(env.notifier.lastText()).toBe(['Bugün ve yarın:', '1. Bir — 20 Eki Sal 18:00', '2. İki — 21 Eki Çar 09:00'].join('\n'));
  });

  it('yardım üç satır', async () => {
    const env = createEnv();
    const user = await addUser(env);
    await say(env, user.id, 'yardım');
    expect(env.notifier.lastText().split('\n')).toHaveLength(3);
  });

  it('komut, bekleyen tarih sorusunu iptal eder', async () => {
    const env = createEnv();
    const user = await addUser(env);
    await env.store.setPendingAction(user.id, { type: 'change_date', itemId: 'x' });
    await say(env, user.id, 'listem');
    expect(env.store.users[0]!.pendingAction).toBeNull();
  });
});

describe('verilerimi sil', () => {
  async function setup() {
    const env = createEnv(ist('2026-10-20T12:00'));
    const user = await addUser(env);
    const other = await addUser(env, '905550000000');
    const item = await env.store.createItem({ userId: user.id, sourceType: 'image', title: 'X', category: 'job', mediaPath: `${user.id}/1.jpg` });
    await env.store.createItem({ userId: other.id, sourceType: 'text', title: 'Başkası', category: 'task' });
    await env.store.insertReminders([{ itemId: item.id, userId: user.id, kind: 'nudge', sendAt: ist('2026-10-21T10:00') }]);
    await env.store.insertInteraction(user.id, item.id, 'ok', env.clock.now);
    await env.store.insertPrep(item.id, 'checklist', '☐ X');
    return { env, user, other };
  }

  it('onay ister; onaydan sonra kullanıcının tüm verisini ve medyasını siler', async () => {
    const { env, user, other } = await setup();
    await say(env, user.id, 'verilerimi sil');
    const s = env.notifier.last();
    expect(s.type === 'buttons' && s.text).toBe(TEXT.deleteConfirm);
    expect(env.store.items).toHaveLength(2); // henüz silinmedi

    await press(env, user.id, 'delyes:-');
    expect(env.store.users.map((u) => u.id)).toEqual([other.id]);
    expect(env.store.items.map((i) => i.title)).toEqual(['Başkası']);
    expect(env.store.reminders).toHaveLength(0);
    expect(env.store.interactions).toHaveLength(0);
    expect(env.store.preps).toHaveLength(0);
    expect(env.removed).toEqual([`${user.id}/1.jpg`]);
    expect(env.notifier.lastText()).toBe(TEXT.deleteDone);
  });

  it('"evet" yazmak da onaydır', async () => {
    const { env, user } = await setup();
    await say(env, user.id, 'verilerimi sil');
    await say(env, user.id, 'Evet');
    expect(env.store.users).toHaveLength(1);
  });

  it('Vazgeç ya da başka yanıt hiçbir şey silmez', async () => {
    const { env, user } = await setup();
    await say(env, user.id, 'verilerimi sil');
    await press(env, user.id, 'delno:-');
    expect(env.store.items).toHaveLength(2);
    expect(env.notifier.lastText()).toBe(TEXT.deleteCancelled);

    await say(env, user.id, 'verilerimi sil');
    await say(env, user.id, 'hmm');
    expect(env.store.items).toHaveLength(2);
  });

  it('süresi geçen onay geçersiz', async () => {
    const { env, user } = await setup();
    await say(env, user.id, 'verilerimi sil');
    env.clock.now = ist('2026-10-20T12:30');
    await press(env, user.id, 'delyes:-');
    expect(env.store.items).toHaveLength(2);
  });

  it('onay olmadan gelen eski "Evet, sil" düğmesi silmez', async () => {
    const { env, user } = await setup();
    await press(env, user.id, 'delyes:-');
    expect(env.store.items).toHaveLength(2);
  });
});
