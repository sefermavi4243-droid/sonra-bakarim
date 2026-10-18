import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Item } from '../src/db/schema.js';
import { MAX_ATTEMPTS, tick } from '../src/jobs/scheduler.js';
import { buildReminder } from '../src/notify/messages.js';
import { type TestEnv, ZONE, addUser, createEnv, ist } from './helpers/fakes.js';

async function seed(env: TestEnv, sendAts: Date[], itemPatch: Partial<Item> = {}) {
  const user = await addUser(env);
  const item = await env.store.createItem({
    userId: user.id,
    sourceType: 'text',
    title: 'Staj başvurusu',
    category: 'job',
    deadlineAt: ist('2026-10-24T23:59'),
    requirements: ['CV'],
    effortMinutes: 45,
    ...itemPatch,
  });
  await env.store.insertReminders(sendAts.map((sendAt) => ({ itemId: item.id, userId: user.id, kind: 'nudge' as const, sendAt })));
  return { user, item };
}

describe('zamanlayıcı', () => {
  it('2 dakika sonrasına kurulan hatırlatma vakti gelince gider', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    await seed(env, [ist('2026-10-20T12:02')]);
    expect(await tick(env.deps)).toBe(0);
    env.clock.now = ist('2026-10-20T12:01');
    expect(await tick(env.deps)).toBe(0);
    env.clock.now = ist('2026-10-20T12:02');
    expect(await tick(env.deps)).toBe(1);
    expect(env.notifier.sent).toHaveLength(1);
    expect(env.store.reminders[0]).toMatchObject({ status: 'sent', messageId: 'wamid.1' });
  });

  it('iki zamanlayıcı aynı anda çalışınca aynı hatırlatma iki kez gitmez', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    const times = Array.from({ length: 45 }, (_, i) => new Date(+ist('2026-10-20T11:00') + i * 60_000));
    await seed(env, times);
    env.notifier.delayMs = 1; // gönderim sırasında öbür zamanlayıcı araya girsin
    const [a, b] = await Promise.all([tick(env.deps), tick(env.deps)]);
    expect(a + b).toBe(45);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(env.notifier.sent).toHaveLength(45);
    expect(env.store.reminders.every((r) => r.status === 'sent')).toBe(true);
  });

  it('24 saat penceresi açıksa serbest mesaj ve düğmeler', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    await seed(env, [ist('2026-10-20T12:00')]);
    await tick(env.deps);
    const s = env.notifier.last();
    expect(s.type).toBe('buttons');
    if (s.type === 'buttons') expect(s.buttons.map((b) => b.title)).toEqual(['Yaptım', 'Ertele', 'Vazgeç']);
  });

  it('pencere kapalıysa utility şablonu gider', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    await seed(env, [ist('2026-10-22T10:00')]);
    env.clock.now = ist('2026-10-22T10:00'); // son mesajdan 46 saat sonra
    await tick(env.deps);
    const s = env.notifier.last();
    expect(s.type).toBe('template');
    if (s.type === 'template') {
      expect(s.template.name).toBe('hatirlatma_son_tarih');
      expect(s.template.bodyParams).toEqual(['Staj başvurusu', '24 Ekim Cumartesi 23:59', 'CV']);
      expect(s.template.buttonPayloads[0]).toMatch(/^done:/);
    }
  });

  it('gönderim hatası 3 kez yeniden denenir, sonra failed', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    await seed(env, [ist('2026-10-20T12:00')]);
    env.notifier.failNext = 10;
    const r = env.store.reminders[0]!;
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await tick(env.deps);
      expect(r).toMatchObject({ status: 'scheduled', attempts: i });
      env.clock.now = r.sendAt;
    }
    await tick(env.deps);
    expect(r).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
    expect(r.error).toContain('500');
    await tick(env.deps);
    expect(r.status).toBe('failed');
  });

  it('yeniden denemede başarılı olursa sent', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    await seed(env, [ist('2026-10-20T12:00')]);
    env.notifier.failNext = 1;
    await tick(env.deps);
    env.clock.now = env.store.reminders[0]!.sendAt;
    await tick(env.deps);
    expect(env.store.reminders[0]).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('kapanmış kaydın hatırlatması gönderilmez', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    await seed(env, [ist('2026-10-20T12:00')], { status: 'done' });
    await tick(env.deps);
    expect(env.notifier.sent).toHaveLength(0);
    expect(env.store.reminders[0]!.status).toBe('cancelled');
  });

  it('çöken süreçte kalan sending kayıtları geri alınır', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    await seed(env, [ist('2026-10-20T11:00')]);
    Object.assign(env.store.reminders[0]!, { status: 'sending', claimedAt: ist('2026-10-20T11:00') });
    await tick(env.deps);
    expect(env.store.reminders[0]!.status).toBe('sent');
  });
});

describe('şablonlar', () => {
  const dir = new URL('../templates/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const templates = new Map(
    files.map((f) => {
      const t = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { name: string; body: string; buttons: string[]; category: string };
      return [t.name, t];
    }),
  );

  it('tüm şablonlar utility ve tanıtım dili içermez', () => {
    for (const t of templates.values()) {
      expect(t.category).toBe('UTILITY');
      expect(t.body).not.toMatch(/indirim|kampanya|fırsat|hemen al|ücretsiz|kaçırma/i);
    }
  });

  it('koddaki şablon çağrıları templates/ ile uyumlu', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    const { item } = await seed(env, [], { eventAt: ist('2026-11-05T19:00'), location: 'İTÜ' });
    const noDeadline = { ...item, deadlineAt: null };
    const cases = [
      buildReminder('nudge', item, ZONE, env.clock.now),
      buildReminder('plan', item, ZONE, env.clock.now),
      buildReminder('event_eve', item, ZONE, env.clock.now),
      buildReminder('nudge', noDeadline, ZONE, env.clock.now),
    ];
    for (const { template, buttons } of cases) {
      const def = templates.get(template.name);
      expect(def, template.name).toBeDefined();
      const params = new Set(def!.body.match(/\{\{\d+\}\}/g));
      expect(template.bodyParams).toHaveLength(params.size);
      expect(template.buttonPayloads).toHaveLength(def!.buttons.length);
      expect(buttons.map((b) => b.title)).toEqual(def!.buttons);
    }
  });
});
