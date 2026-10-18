import { describe, expect, it } from 'vitest';
import { buildCalendar, escapeText, foldLine, icsFileName, itemEvents } from '../src/calendar/ics.js';
import type { Item } from '../src/db/schema.js';
import { BRIEF_HOUR, morningBrief, runDigests, weeklyDigest } from '../src/jobs/digest.js';
import { type TestEnv, ZONE, addUser, createEnv, ist } from './helpers/fakes.js';

function item(patch: Partial<Item> = {}): Item {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    userId: 'u',
    sourceType: 'link',
    sourceUrl: 'https://ornek.com/ilan',
    rawText: null,
    mediaPath: null,
    title: 'Veri Analisti Stajyeri',
    category: 'job',
    organization: 'Örnek Fintech',
    deadlineAt: ist('2026-10-24T23:59'),
    deadlineSource: 'explicit',
    deadlineEvidence: 'Son başvuru: 24 Ekim 2026',
    eventAt: null,
    location: null,
    effortMinutes: 45,
    requirements: ['CV', 'Motivasyon yazısı'],
    keyNotes: [],
    nextAction: 'CV güncelle',
    status: 'open',
    dedupeHash: null,
    createdAt: ist('2026-10-20T12:00'),
    closedAt: null,
    ...patch,
  };
}

const now = ist('2026-10-20T12:00'); // salı

describe('ics', () => {
  it('metin kaçırma: virgül, noktalı virgül, ters bölü, satır sonu', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('75 baytı aşan satır katlanır, Türkçe karakter bölünmez', () => {
    const line = `SUMMARY:${'ğüşİçö'.repeat(20)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(Buffer.byteLength(p)).toBeLessThanOrEqual(75);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
  });

  it('gün sonu son tarihi tüm gün olayı olur, bir gün önce 09:00 uyarısı', () => {
    const [ev] = itemEvents(item(), ZONE, now);
    expect(ev).toContain('DTSTART;VALUE=DATE:20261024');
    expect(ev).toContain('DTEND;VALUE=DATE:20261025');
    expect(ev).toContain('SUMMARY:Son gün: Veri Analisti Stajyeri');
    expect(ev).toContain('TRIGGER:-PT15H');
    expect(ev).toContain('UID:11111111-2222-3333-4444-555555555555-deadline@sonra-bakarim');
  });

  it('saatli son tarih 30 dakikalık blok olur (UTC)', () => {
    const [ev] = itemEvents(item({ deadlineAt: ist('2026-11-15T17:00') }), ZONE, now);
    expect(ev).toContain('DTSTART:20261115T133000Z');
    expect(ev).toContain('DTEND:20261115T140000Z');
  });

  it('etkinlik ayrı olay; konum ve 2 saat önce uyarı', () => {
    const events = itemEvents(item({ category: 'event', deadlineAt: null, eventAt: ist('2026-11-07T10:00'), location: 'İTÜ' }), ZONE, now);
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('DTSTART:20261107T070000Z');
    expect(events[0]).toContain('DTEND:20261107T080000Z');
    expect(events[0]).toContain('LOCATION:İTÜ');
    expect(events[0]).toContain('TRIGGER:-PT2H');
  });

  it('tarihsiz kayıt takvime girmez; takvim CRLF ile biter', () => {
    const cal = buildCalendar([item({ deadlineAt: null })], ZONE, now);
    expect(cal).not.toContain('BEGIN:VEVENT');
    expect(cal.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(cal.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('dosya adı Türkçe karakterlerden arındırılır', () => {
    expect(icsFileName('Çağrı Merkezi Şubat İlanı!')).toBe('cagri-merkezi-subat-ilani.ics');
  });
});

describe('haftalık özet', () => {
  const zero = { added: 0, closed: 0 };

  it('önümüzdeki 7 gün gün gün listelenir, yoğun gün uyarısı verilir', () => {
    const items = [
      item({ id: 'a', title: 'Staj A', deadlineAt: ist('2026-10-22T23:59'), effortMinutes: 60 }),
      item({ id: 'b', title: 'Burs B', deadlineAt: ist('2026-10-22T17:00'), effortMinutes: 90 }),
      item({ id: 'c', title: 'Konferans', category: 'event', deadlineAt: null, eventAt: ist('2026-10-24T10:00') }),
      item({ id: 'd', title: 'Uzak iş', deadlineAt: ist('2026-11-20T23:59') }),
      item({ id: 'e', title: 'Tarihsiz', deadlineAt: null }),
    ];
    const text = weeklyDigest(items, { added: 5, closed: 2 }, now, ZONE)!;
    expect(text).toContain('Bu hafta 5 kayıt ekledin, 2 tanesini kapattın.');
    expect(text).toContain('Perşembe, 22 Ekim:');
    expect(text).toContain('• Burs B (son tarih 17:00)');
    expect(text).toContain('• Staj A (son gün)');
    expect(text).toContain('• Konferans (etkinlik 10:00)');
    expect(text).not.toContain('Uzak iş');
    expect(text).toContain('Dikkat: Perşembe günü 2 son tarih denk geliyor. "Burs B" ve "Staj A"');
    expect(text).toContain('toplam yaklaşık 2 saat 30 dakika');
    expect(text).toContain('Tarihsiz bekleyen 1 kayıt var');
  });

  it('hiçbir şey yoksa özet gönderilmez', () => {
    expect(weeklyDigest([], zero, now, ZONE)).toBeNull();
  });

  it('sabah brifingi yalnızca bugünü içerir; bugün boşsa null', () => {
    const items = [
      item({ id: 'a', title: 'Bugünkü', deadlineAt: ist('2026-10-20T18:00') }),
      item({ id: 'b', title: 'Yarınki', deadlineAt: ist('2026-10-21T18:00') }),
    ];
    expect(morningBrief(items, ist('2026-10-20T08:30'), ZONE)).toBe('Günaydın. Bugün:\n• Bugünkü (son tarih 18:00)');
    expect(morningBrief(items.slice(1), ist('2026-10-20T08:30'), ZONE)).toBeNull();
  });
});

describe('özet zamanlaması', () => {
  async function setup(at: string): Promise<TestEnv> {
    const env = createEnv(ist(at));
    const user = await addUser(env, 'tg:42');
    await env.store.createItem({ userId: user.id, sourceType: 'text', title: 'Rapor', category: 'task', deadlineAt: ist('2026-10-27T23:59') });
    return env;
  }

  it('pazar 19:00 sonrası bir kez gider', async () => {
    const env = await setup('2026-10-25T18:59'); // pazar
    await runDigests(env.deps);
    expect(env.notifier.sent).toHaveLength(0);
    env.clock.now = ist('2026-10-25T19:01');
    await runDigests(env.deps);
    expect(env.notifier.lastText()).toContain('Haftalık özet');
    env.clock.now = ist('2026-10-25T20:00');
    await runDigests(env.deps);
    expect(env.notifier.sent).toHaveLength(1);
  });

  it('kapalıysa ve sessiz saatte gitmez', async () => {
    const env = await setup('2026-10-25T22:30');
    await runDigests(env.deps);
    expect(env.notifier.sent).toHaveLength(0); // sessiz saat
    env.clock.now = ist('2026-10-25T19:30');
    await env.store.updateUser(env.store.users[0]!.id, { weeklyDigest: false });
    await runDigests(env.deps);
    expect(env.notifier.sent).toHaveLength(0);
  });

  it('sabah brifingi açıksa ve bugün iş varsa 08:30 sonrası gider', async () => {
    const env = await setup('2026-10-27T08:20');
    await env.store.updateUser(env.store.users[0]!.id, { morningBrief: true });
    await runDigests(env.deps);
    expect(env.notifier.sent).toHaveLength(0);
    env.clock.now = ist(`2026-10-27T0${BRIEF_HOUR}:31`);
    await runDigests(env.deps);
    expect(env.notifier.lastText()).toBe('Günaydın. Bugün:\n• Rapor (son gün)');
    await runDigests(env.deps);
    expect(env.notifier.sent).toHaveLength(1);
  });
});
