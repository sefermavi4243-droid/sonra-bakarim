import { describe, expect, it } from 'vitest';
import { handleButton } from '../src/jobs/buttons.js';
import { closeItem } from '../src/jobs/items.js';
import { route } from '../src/jobs/process.js';
import { TEXT } from '../src/notify/messages.js';
import { type TestEnv, addUser, createEnv, ist, show } from './helpers/fakes.js';

async function seed(env: TestEnv, deadline = ist('2026-10-30T23:59')) {
  const user = await addUser(env);
  const item = await env.store.createItem({
    userId: user.id,
    sourceType: 'text',
    title: 'Staj başvurusu',
    category: 'job',
    deadlineAt: deadline,
    effortMinutes: 45,
  });
  await env.store.insertReminders([
    { itemId: item.id, userId: user.id, kind: 'plan', sendAt: ist('2026-10-28T20:00') },
    { itemId: item.id, userId: user.id, kind: 'nudge', sendAt: ist('2026-10-29T10:00') },
  ]);
  return { user: (await env.store.getUser(user.id))!, item };
}

const press = async (env: TestEnv, userId: string, payload: string) =>
  handleButton(env.deps, (await env.store.getUser(userId))!, payload);

describe('kapatma', () => {
  it('Yaptım: kayıt kapanır, bekleyen hatırlatmalar iptal edilir, etkileşim yazılır', async () => {
    const env = createEnv(ist('2026-10-28T15:00'));
    const { user, item } = await seed(env);
    await press(env, user.id, `done:${item.id}`);
    expect(env.store.items[0]).toMatchObject({ status: 'done' });
    expect(env.store.items[0]!.closedAt).toEqual(env.clock.now);
    expect(env.store.reminders.map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
    expect(env.store.interactions).toEqual([expect.objectContaining({ action: 'done', itemId: item.id })]);
    expect(env.notifier.lastText()).toBe(TEXT.done);
  });

  it('Vazgeç: dropped, hatırlatmalar iptal', async () => {
    const env = createEnv(ist('2026-10-28T15:00'));
    const { user, item } = await seed(env);
    await press(env, user.id, `drop:${item.id}`);
    expect(env.store.items[0]!.status).toBe('dropped');
    expect(env.store.reminders.every((r) => r.status === 'cancelled')).toBe(true);
  });

  it('closeItem gönderilmiş hatırlatmalara dokunmaz', async () => {
    const env = createEnv(ist('2026-10-28T15:00'));
    const { item } = await seed(env);
    env.store.reminders[0]!.status = 'sent';
    await closeItem(env.store, item.id, 'expired', env.clock.now);
    expect(env.store.reminders.map((r) => r.status)).toEqual(['sent', 'cancelled']);
  });

  it('başka kullanıcının kaydına basılamaz', async () => {
    const env = createEnv(ist('2026-10-28T15:00'));
    const { item } = await seed(env);
    const other = await addUser(env, '905559998877');
    await press(env, other.id, `done:${item.id}`);
    expect(env.store.items[0]!.status).toBe('open');
    expect(env.notifier.lastText()).toBe(TEXT.itemGone);
  });
});

describe('ertele (kural 8)', () => {
  it('son tarihi geçmeyen seçenekler sunulur', async () => {
    const env = createEnv(ist('2026-10-28T15:00')); // çarşamba, D = cuma
    const { user, item } = await seed(env);
    await press(env, user.id, `snooze:${item.id}`);
    const s = env.notifier.last();
    expect(s.type === 'buttons' && s.buttons.map((b) => b.title)).toEqual(['3 saat sonra', 'Yarın aynı saat']);
  });

  it('seçilen erteleme son tarihi geçmeyen bir zamana kurulur', async () => {
    const env = createEnv(ist('2026-10-28T15:00'));
    const { user, item } = await seed(env);
    await press(env, user.id, `stm:${item.id}`);
    const scheduled = env.store.reminders.filter((r) => r.status === 'scheduled');
    expect(scheduled).toHaveLength(1);
    expect(show(scheduled[0]!.sendAt)).toBe('2026-10-29T15:00');
    expect(scheduled[0]!.sendAt < item.deadlineAt!).toBe(true);
    expect(env.store.items[0]!.status).toBe('snoozed');
  });

  it('son tarihi geçecek seçenek reddedilir', async () => {
    const env = createEnv(ist('2026-10-28T15:00'));
    const { user, item } = await seed(env);
    await press(env, user.id, `swe:${item.id}`);
    expect(env.notifier.lastText()).toBe(TEXT.cannotSnooze);
    expect(env.store.reminders.filter((r) => r.status === 'scheduled')).toHaveLength(2);
  });

  it('son tarihe çok az kaldıysa erteleme yok', async () => {
    const env = createEnv(ist('2026-10-30T22:30'));
    const { user, item } = await seed(env);
    await press(env, user.id, `snooze:${item.id}`);
    expect(env.notifier.lastText()).toBe(TEXT.cannotSnooze);
  });
});

describe('kart düğmeleri', () => {
  it('Tarihi değiştir: serbest metin aynı çözücüden geçer, hatırlatmalar yeniden kurulur', async () => {
    const env = createEnv(ist('2026-10-20T12:00')); // salı
    const { user, item } = await seed(env);
    await press(env, user.id, `date:${item.id}`);
    expect(env.notifier.lastText()).toBe(TEXT.askDate);

    await route(env.deps, (await env.store.getUser(user.id))!, { kind: 'text', text: 'perşembe 18:00' });
    const updated = env.store.items[0]!;
    expect(show(updated.deadlineAt!)).toBe('2026-10-22T18:00');
    expect(updated.deadlineSource).toBe('user');
    const statuses = env.store.reminders.map((r) => [r.kind, r.status, show(r.sendAt)]);
    expect(statuses).toEqual([
      ['plan', 'cancelled', '2026-10-28T20:00'],
      ['nudge', 'cancelled', '2026-10-29T10:00'],
      ['plan', 'scheduled', '2026-10-20T20:00'],
      ['nudge', 'scheduled', '2026-10-21T10:00'],
      ['last_call', 'scheduled', '2026-10-22T09:00'],
    ]);
    expect(env.notifier.lastText()).toContain('22 Ekim Perşembe 18:00');
  });

  it('anlaşılmayan tarih tekrar sorulur, geçmiş tarih kabul edilmez', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    const { user, item } = await seed(env);
    await press(env, user.id, `date:${item.id}`);
    await route(env.deps, (await env.store.getUser(user.id))!, { kind: 'text', text: 'bilmiyorum' });
    expect(env.notifier.lastText()).toBe(TEXT.dateNotUnderstood);
    await route(env.deps, (await env.store.getUser(user.id))!, { kind: 'text', text: 'bugün 09:00' });
    expect(env.notifier.lastText()).toBe(TEXT.datePast);
    expect(env.store.users[0]!.pendingAction).toMatchObject({ type: 'change_date' });
  });

  it('Hemen hazırla: kontrol listesi kaydedilir ve gönderilir', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    const { user, item } = await seed(env);
    await env.store.updateItem(item.id, {});
    Object.assign(env.store.items[0]!, { requirements: ['CV', 'Ön yazı'], nextAction: 'CV güncelle' });
    await press(env, user.id, `prep:${item.id}`);
    expect(env.store.preps).toEqual([expect.objectContaining({ kind: 'checklist', content: '☐ CV güncelle\n☐ CV\n☐ Ön yazı' })]);
    expect(env.notifier.lastText()).toContain('kontrol listesi');
  });
});
