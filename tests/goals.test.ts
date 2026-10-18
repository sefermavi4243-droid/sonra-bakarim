import { describe, expect, it } from 'vitest';
import { finalizeExtraction } from '../src/extract/finalize.js';
import { runDigests, weekPlan, weeklyDigest } from '../src/jobs/digest.js';
import { route } from '../src/jobs/process.js';
import { applyDefaults } from '../src/rules/defaults.js';
import { parseTurkishDate } from '../src/rules/relative.js';
import { planReminders } from '../src/rules/schedule.js';
import { ZONE, addUser, createEnv, extraction, ist, show } from './helpers/fakes.js';

const prefs = { timezone: ZONE, quietStart: '22:00', quietEnd: '08:00', preferredHour: 20 };
const tuesday = ist('2026-10-20T12:00');

describe('hafta ifadeleri', () => {
  const p = (text: string, now = tuesday) => {
    const r = parseTurkishDate(text, now, ZONE);
    return r.kind === 'ok' ? show(r.date) : r.kind;
  };

  it('bu hafta / hafta sonuna kadar = bu pazar gün sonu', () => {
    expect(p('bu hafta Medium yazımı yayınlayacağım')).toBe('2026-10-25T23:59');
    expect(p('bu hafta içinde projeyi bitir')).toBe('2026-10-25T23:59');
    expect(p('hafta sonuna kadar gönderiyi paylaş')).toBe('2026-10-25T23:59');
    expect(p('bu hafta', ist('2026-10-25T10:00'))).toBe('2026-10-25T23:59'); // pazar günü
  });

  it('hafta içi = cuma; gelecek hafta = gelecek pazar', () => {
    expect(p('hafta içi raporu bitir')).toBe('2026-10-23T23:59');
    expect(p('gelecek hafta portfolyoyu yayınla')).toBe('2026-11-01T23:59');
    expect(p('önümüzdeki hafta')).toBe('2026-11-01T23:59');
  });

  it('gün adı varsa gün adı kazanır', () => {
    expect(p('bu hafta perşembe sunum')).toBe('2026-10-22T23:59');
    expect(p('gelecek hafta salı')).toBe('2026-10-27T23:59');
  });
});

describe('hedef kaydı', () => {
  it('model tarihi atlasa da "bu hafta" metinden okunur; hedef ritmi kurulur', () => {
    const text = 'Bu hafta Medium yazımı yayınlayacağım';
    const f = finalizeExtraction(extraction({ title: 'Medium yazısını yayınla', category: 'goal', deadline: null, deadline_evidence: null }), text, tuesday, prefs);
    expect(show(f.deadline!)).toBe('2026-10-25T23:59');
    expect(f.deadlineSource).toBe('inferred');
  });

  it('tarihsiz hedefin varsayılanı bu haftanın sonu', () => {
    const d = applyDefaults({ category: 'goal', deadline: null, eventAt: null, now: tuesday, prefs });
    expect(show(d.deadline!)).toBe('2026-10-25T23:59');
    expect(d.ask).toBe(false);
  });

  it('ritim: çarşamba 19:00, cuma 18:00, pazar 11:00', () => {
    const planned = planReminders({ deadline: ist('2026-10-25T23:59'), effortMinutes: 120, eventAt: null, goal: true, now: tuesday, prefs });
    expect(planned.map((r) => [r.kind, show(r.sendAt)])).toEqual([
      ['plan', '2026-10-21T19:00'],
      ['nudge', '2026-10-23T18:00'],
      ['last_call', '2026-10-25T11:00'],
    ]);
  });

  it('hafta ortası geçtiyse yalnızca kalanlar kurulur', () => {
    const planned = planReminders({ deadline: ist('2026-10-25T23:59'), effortMinutes: null, eventAt: null, goal: true, now: ist('2026-10-22T10:00'), prefs });
    expect(planned.map((r) => r.kind)).toEqual(['nudge', 'last_call']);
  });
});

describe('hedef özetleri', () => {
  async function setup(now: string) {
    const env = createEnv(ist(now));
    const user = await addUser(env, 'tg:42');
    const mk = (title: string, status: 'open' | 'done', deadline = '2026-10-25T23:59') =>
      env.store.createItem({ userId: user.id, sourceType: 'text', title, category: 'goal', deadlineAt: ist(deadline), status });
    await mk('Medium yazısını yayınla', 'done');
    await mk('Portfolyo projesini bitir', 'open');
    await mk('LinkedIn gönderisini paylaş', 'open');
    await mk('Gelecek haftanın hedefi', 'open', '2026-11-01T23:59');
    return { env, user };
  }

  it('pazar özeti: tamamlanma oranı ve bitmeyenler için taşı/bırak', async () => {
    const { env } = await setup('2026-10-25T19:30');
    await runDigests(env.deps);
    const [digest, ...prompts] = env.notifier.sent;
    expect(digest!.type === 'text' && digest!.text).toContain('Bu haftanın hedefleri: 1/3 tamam.');
    expect(digest!.type === 'text' && digest!.text).toContain('• Portfolyo projesini bitir (bitmedi)');
    expect(prompts).toHaveLength(2);
    expect(prompts[0]!.type === 'buttons' && prompts[0]!.buttons.map((b) => b.title)).toEqual(['Haftaya taşı', 'Bırak']);
  });

  it('Haftaya taşı: son tarih gelecek pazar, hatırlatmalar yeniden kurulur', async () => {
    const { env, user } = await setup('2026-10-25T19:30');
    const goal = env.store.items[1]!;
    await route(env.deps, (await env.store.getUser(user.id))!, { kind: 'button', payload: `goalnext:${goal.id}` });
    expect(show(env.store.items[1]!.deadlineAt!)).toBe('2026-11-01T23:59');
    expect(env.notifier.lastText()).toContain('gelecek haftaya taşındı');
    expect(env.store.reminders.filter((r) => r.itemId === goal.id && r.status === 'scheduled').map((r) => show(r.sendAt))).toEqual([
      '2026-10-28T19:00',
      '2026-10-30T18:00',
      '2026-11-01T11:00',
    ]);
  });

  it('pazartesi 09:00 hafta planı; hedef yoksa gitmez; bir kez gider', async () => {
    const { env } = await setup('2026-10-26T09:05'); // pazartesi; bu haftanın hedefi 1 Kasım
    await runDigests(env.deps);
    expect(env.notifier.lastText()).toBe(
      'Yeni hafta. Rafında 1 haftalık hedef var:\n• Gelecek haftanın hedefi\nÇarşamba akşamı nasıl gittiğini sorarım.',
    );
    await runDigests(env.deps);
    expect(env.notifier.sent).toHaveLength(1);
    expect(weekPlan([], ZONE)).toBeNull();
  });

  it('hedefler 7 günlük listede tekrar görünmez', () => {
    const goal = { id: 'g', title: 'Hedef', category: 'goal', deadlineAt: ist('2026-10-25T23:59'), eventAt: null, effortMinutes: null } as never;
    const text = weeklyDigest([goal], { added: 1, closed: 0 }, tuesday, ZONE, { done: 0, open: [goal] })!;
    expect(text).not.toContain('Önümüzdeki 7 gün:');
    expect(text).toContain('Bu haftanın hedefleri: 0/1 tamam.');
  });
});
