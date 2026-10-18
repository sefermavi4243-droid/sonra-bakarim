import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { applyDefaults } from '../src/rules/defaults.js';
import { hasDateCue, parseTurkishDate } from '../src/rules/relative.js';
import { availableSnoozes, planReminders, snoozeTime } from '../src/rules/schedule.js';
import { adjustForQuiet, formatDateTime, isQuiet, type UserPrefs } from '../src/rules/time.js';

const ZONE = 'Europe/Istanbul';
const prefs: UserPrefs = { timezone: ZONE, quietStart: '22:00', quietEnd: '08:00', preferredHour: 20 };

/** İstanbul yerel saatiyle tarih. */
const ist = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toJSDate();
/** Date'i İstanbul yerel saatinde "2026-10-28T20:00" biçimine çevirir. */
const show = (d: Date) => DateTime.fromJSDate(d, { zone: ZONE }).toFormat("yyyy-MM-dd'T'HH:mm");
const plan = (input: Partial<Parameters<typeof planReminders>[0]>) =>
  planReminders({ deadline: null, effortMinutes: null, eventAt: null, now: ist('2026-10-20T12:00'), prefs, ...input }).map(
    (r) => [r.kind, show(r.sendAt)],
  );

describe('planReminders — SPEC bölüm 10', () => {
  it('kural 1: plan = D − (ceil(E/60)+1) gün, tercih saatinde', () => {
    expect(plan({ deadline: ist('2026-10-30T23:59'), effortMinutes: 45 })).toContainEqual(['plan', '2026-10-28T20:00']);
    expect(plan({ deadline: ist('2026-10-30T23:59'), effortMinutes: 150 })).toContainEqual(['plan', '2026-10-26T20:00']);
  });

  it('kural 1: E < 30 ise plan yok', () => {
    const kinds = plan({ deadline: ist('2026-10-30T23:59'), effortMinutes: 20 }).map(([k]) => k);
    expect(kinds).not.toContain('plan');
  });

  it('kural 1: tercih saati kullanıcıdan gelir', () => {
    const r = planReminders({
      deadline: ist('2026-10-30T23:59'),
      effortMinutes: 45,
      eventAt: null,
      now: ist('2026-10-20T12:00'),
      prefs: { ...prefs, preferredHour: 19 },
    });
    expect(show(r[0]!.sendAt)).toBe('2026-10-28T19:00');
  });

  it('kural 2: nudge = D − 1 gün 10:00', () => {
    expect(plan({ deadline: ist('2026-10-30T23:59') })).toContainEqual(['nudge', '2026-10-29T10:00']);
  });

  it('kural 3: last_call = D günü 09:00', () => {
    expect(plan({ deadline: ist('2026-10-30T23:59') })).toEqual([
      ['nudge', '2026-10-29T10:00'],
      ['last_call', '2026-10-30T09:00'],
    ]);
  });

  it('kural 3: D 12:00 öncesiyse last_call atlanır, nudge D − 1 gün 20:00', () => {
    expect(plan({ deadline: ist('2026-10-30T10:00') })).toEqual([['nudge', '2026-10-29T20:00']]);
  });

  it('kural 4: etkinlik — bir gün önce 20:00 ve 2 saat önce', () => {
    expect(plan({ eventAt: ist('2026-11-05T19:00') })).toEqual([
      ['event_eve', '2026-11-04T20:00'],
      ['event_soon', '2026-11-05T17:00'],
    ]);
  });

  it('kural 5: geçmişe düşenler atılır', () => {
    expect(plan({ deadline: ist('2026-10-30T23:59'), now: ist('2026-10-29T12:00') })).toEqual([
      ['last_call', '2026-10-30T09:00'],
    ]);
  });

  it('kural 5: hiçbiri kalmadıysa ve D gelecekteyse hemen tek hatırlatma', () => {
    expect(plan({ deadline: ist('2026-10-30T23:59'), effortMinutes: 60, now: ist('2026-10-30T09:30') })).toEqual([
      ['last_call', '2026-10-30T09:30'],
    ]);
  });

  it('kural 5: D geçmişteyse hatırlatma yok', () => {
    expect(plan({ deadline: ist('2026-10-19T23:59') })).toEqual([]);
  });

  it('kural 6: sessiz saate düşen bir sonraki uygun saate kayar', () => {
    const r = planReminders({
      deadline: ist('2026-10-30T23:59'),
      effortMinutes: 45,
      eventAt: null,
      now: ist('2026-10-20T12:00'),
      prefs: { ...prefs, preferredHour: 23 },
    });
    expect(r.map((x) => [x.kind, show(x.sendAt)])).toContainEqual(['plan', '2026-10-29T08:00']);
  });

  it('kural 6: kayınca sınırı geçiyorsa sessiz saat başlamadan hemen önceye alınır', () => {
    // Etkinlik 07:30 → event_soon 05:30 (sessiz) → 08:00 etkinlikten sonra → önceki akşam 21:45.
    expect(plan({ eventAt: ist('2026-11-05T07:30') })).toEqual([
      ['event_eve', '2026-11-04T20:00'],
      ['event_soon', '2026-11-04T21:45'],
    ]);
  });

  it('kural 6: sessiz saatte hemen hatırlatma gönderilmez', () => {
    expect(plan({ deadline: ist('2026-10-31T07:00'), now: ist('2026-10-30T23:00') })).toEqual([]);
  });

  it('kural 6: sessiz saatte gelen kayıt için tek hatırlatma sabaha kayar', () => {
    expect(plan({ deadline: ist('2026-10-31T15:00'), now: ist('2026-10-30T23:00') })).toEqual([
      ['last_call', '2026-10-31T09:00'],
    ]);
  });

  it('kural 7: en fazla 3 hatırlatma, öncelik sırasıyla', () => {
    const r = plan({ deadline: ist('2026-11-02T23:59'), effortMinutes: 60, eventAt: ist('2026-11-05T19:00') });
    expect(r).toEqual([
      ['last_call', '2026-11-02T09:00'],
      ['event_eve', '2026-11-04T20:00'],
      ['event_soon', '2026-11-05T17:00'],
    ]);
  });

  it('kural 7: aynı ana düşen hatırlatmalar birleşir', () => {
    // E=30 → plan D−2 20:00; tercih saati 10 → plan da 10:00. Farklı günler; çakışma yok.
    // Sessiz saat kaydırması iki adayı 08:00'e topladığında tek kalır.
    const r = planReminders({
      deadline: null,
      effortMinutes: null,
      eventAt: ist('2026-11-05T06:00'),
      now: ist('2026-10-20T12:00'),
      prefs: { ...prefs, quietStart: '19:00', quietEnd: '08:00' },
    });
    // event_eve 20:00 (sessiz) → 08:00 etkinlikten sonra → 18:45; event_soon 04:00 → 18:45. Tek kalır.
    expect(r.map((x) => [x.kind, show(x.sendAt)])).toEqual([['event_soon', '2026-11-04T18:45']]);
  });

  it('tarihsiz kayıt: 14 gün sonraki soru tek hatırlatma olur', () => {
    expect(plan({ checkInAt: ist('2026-11-03T20:00') })).toEqual([['nudge', '2026-11-03T20:00']]);
  });
});

describe('kural 8 — erteleme', () => {
  const now = ist('2026-10-28T15:00'); // çarşamba

  it('üç seçenek: 3 saat sonra, yarın aynı saat, cumartesi 11:00', () => {
    expect(show(snoozeTime('3h', now, null, prefs)!)).toBe('2026-10-28T18:00');
    expect(show(snoozeTime('tomorrow', now, null, prefs)!)).toBe('2026-10-29T15:00');
    expect(show(snoozeTime('weekend', now, null, prefs)!)).toBe('2026-10-31T11:00');
  });

  it('erteleme son tarihi geçemez', () => {
    const deadline = ist('2026-10-30T23:59');
    expect(snoozeTime('weekend', now, deadline, prefs)).toBeNull();
    expect(availableSnoozes(now, deadline, prefs)).toEqual(['3h', 'tomorrow']);
    expect(availableSnoozes(now, ist('2026-10-28T17:00'), prefs)).toEqual([]);
  });

  it('erteleme sessiz saate uyar', () => {
    expect(show(snoozeTime('3h', ist('2026-10-28T20:30'), null, prefs)!)).toBe('2026-10-29T08:00');
  });

  it('cumartesi 11:00 geçtiyse bir sonraki cumartesi', () => {
    expect(show(snoozeTime('weekend', ist('2026-10-31T12:00'), null, prefs)!)).toBe('2026-11-07T11:00');
    expect(show(snoozeTime('weekend', ist('2026-10-31T09:00'), null, prefs)!)).toBe('2026-10-31T11:00');
  });
});

describe('sınır durumları', () => {
  it('ay sonu: D ayın 1\'i ise nudge önceki ayın son günü', () => {
    expect(plan({ deadline: ist('2026-11-01T15:00') })).toEqual([
      ['nudge', '2026-10-31T10:00'],
      ['last_call', '2026-11-01T09:00'],
    ]);
    expect(plan({ deadline: ist('2027-03-01T15:00'), now: ist('2027-02-01T12:00') })).toContainEqual([
      'nudge',
      '2027-02-28T10:00',
    ]);
  });

  it('Europe/Istanbul yaz saati uygulamaz: Avrupa saat değişimlerinde UTC+3 kalır', () => {
    // 25 Ekim 2026 ve 29 Mart 2026'da Avrupa saat değiştirir; İstanbul değiştirmez.
    const r1 = planReminders({ deadline: ist('2026-10-26T15:00'), effortMinutes: null, eventAt: null, now: ist('2026-10-20T12:00'), prefs });
    expect(r1[0]!.sendAt.toISOString()).toBe('2026-10-25T07:00:00.000Z');
    const r2 = planReminders({ deadline: ist('2026-03-30T15:00'), effortMinutes: null, eventAt: null, now: ist('2026-03-20T12:00'), prefs });
    expect(r2[0]!.sendAt.toISOString()).toBe('2026-03-29T07:00:00.000Z');
    expect(ist('2026-07-01T12:00').toISOString()).toBe('2026-07-01T09:00:00.000Z');
  });

  it('gece yarısı: D tam 00:00 ise 12:00 öncesi sayılır', () => {
    expect(plan({ deadline: ist('2026-10-31T00:00') })).toEqual([['nudge', '2026-10-30T20:00']]);
  });

  it('sessiz saat gece yarısını aşar', () => {
    expect(isQuiet(ist('2026-10-20T21:59'), prefs)).toBe(false);
    expect(isQuiet(ist('2026-10-20T22:00'), prefs)).toBe(true);
    expect(isQuiet(ist('2026-10-20T23:59'), prefs)).toBe(true);
    expect(isQuiet(ist('2026-10-21T00:00'), prefs)).toBe(true);
    expect(isQuiet(ist('2026-10-21T07:59'), prefs)).toBe(true);
    expect(isQuiet(ist('2026-10-21T08:00'), prefs)).toBe(false);
  });

  it('gece yarısından sonra sessiz saat aynı günün sabahına kayar', () => {
    expect(show(adjustForQuiet(ist('2026-10-21T01:00'), prefs, null))).toBe('2026-10-21T08:00');
    expect(show(adjustForQuiet(ist('2026-10-20T23:00'), prefs, null))).toBe('2026-10-21T08:00');
  });

  it('tarih biçimi Türkçe', () => {
    expect(formatDateTime(ist('2026-10-24T23:59'), ZONE)).toBe('24 Ekim Cumartesi 23:59');
  });
});

describe('parseTurkishDate — göreli tarihler', () => {
  const now = ist('2026-10-20T12:00'); // salı
  const p = (text: string) => {
    const r = parseTurkishDate(text, now, ZONE);
    return r.kind === 'ok' ? show(r.date) : r.kind;
  };

  it('gün adları bir sonraki o güne çözülür, saat yoksa 23:59', () => {
    expect(p('cuma')).toBe('2026-10-23T23:59');
    expect(p("Cuma Ali'ye dosyayı atmayı unutma")).toBe('2026-10-23T23:59');
    expect(p('cumaya kadar')).toBe('2026-10-23T23:59');
    expect(p('cumartesi')).toBe('2026-10-24T23:59');
    expect(p('pazartesi')).toBe('2026-10-26T23:59');
    expect(p('çarşamba')).toBe('2026-10-21T23:59');
  });

  it('haftaya salı = gelecek takvim haftasının salısı', () => {
    expect(p('haftaya salı')).toBe('2026-10-27T23:59');
    expect(p('haftaya cuma 14:00')).toBe('2026-10-30T14:00');
    expect(p('gelecek hafta pazartesi')).toBe('2026-10-26T23:59');
  });

  it('bugünün adı tek başına belirsizdir, sorulur', () => {
    expect(p('salı')).toBe('ambiguous');
    expect(p('bu salı')).toBe('2026-10-20T23:59');
    expect(p('önümüzdeki salı')).toBe('2026-10-27T23:59');
  });

  it('saatli ifadeler', () => {
    expect(p('perşembe 18:00')).toBe('2026-10-22T18:00');
    expect(p('perşembe saat 18')).toBe('2026-10-22T18:00');
    expect(p('yarın akşam')).toBe('2026-10-21T20:00');
    expect(p('yarın akşam 7')).toBe('2026-10-21T19:00');
    expect(p('yarın saat 7 akşam')).toBe('2026-10-21T19:00');
    expect(p('bugün 18.30')).toBe('2026-10-20T18:30');
    expect(p('15:00')).toBe('2026-10-20T15:00');
    expect(p('10:00')).toBe('2026-10-21T10:00');
  });

  it('açık tarihler', () => {
    expect(p('24 Ekim')).toBe('2026-10-24T23:59');
    expect(p('Son başvuru: 24 Ekim 2026')).toBe('2026-10-24T23:59');
    expect(p('5 Ocak')).toBe('2027-01-05T23:59');
    expect(p('24.10.2026 17:00')).toBe('2026-10-24T17:00');
    expect(p('1/11')).toBe('2026-11-01T23:59');
    expect(p('2026-12-01')).toBe('2026-12-01T23:59');
    expect(p('yarın')).toBe('2026-10-21T23:59');
    expect(p('öbür gün')).toBe('2026-10-22T23:59');
  });

  it('tarih olmayan metin', () => {
    expect(p('Bugün hava nasıl?')).not.toBe('none'); // "bugün" bir tarih ipucudur
    expect(p('hava nasıl')).toBe('none');
    expect(p('31 Şubat')).toBe('none');
  });

  it('tarih ipucu denetimi', () => {
    expect(hasDateCue('Son başvuru: 24 Ekim 2026')).toBe(true);
    expect(hasDateCue('cumaya kadar')).toBe(true);
    expect(hasDateCue('Başvurular açıktır')).toBe(false);
  });
});

describe('applyDefaults — SPEC bölüm 9', () => {
  const now = ist('2026-10-20T15:30');
  const base = { deadline: null, eventAt: null, now, prefs };

  it('job: kayıttan 2 gün sonra 11:00', () => {
    const r = applyDefaults({ ...base, category: 'job' });
    expect(show(r.deadline!)).toBe('2026-10-22T11:00');
    expect(r.reason).toContain('erken başvur');
  });

  it('event: kayıt tarihi yoksa etkinlikten 3 gün önce', () => {
    const r = applyDefaults({ ...base, category: 'event', eventAt: ist('2026-11-05T19:00') });
    expect(show(r.deadline!)).toBe('2026-11-02T19:00');
  });

  it('event: etkinliğe 3 günden az varsa son tarih yok, sorulmaz', () => {
    const r = applyDefaults({ ...base, category: 'event', eventAt: ist('2026-10-22T19:00') });
    expect(r).toMatchObject({ deadline: null, ask: false });
  });

  it('event: etkinlik tarihi de yoksa sorulur', () => {
    expect(applyDefaults({ ...base, category: 'event' }).ask).toBe(true);
  });

  it('application ve task: kullanıcıya sorulur', () => {
    expect(applyDefaults({ ...base, category: 'application' })).toMatchObject({ deadline: null, ask: true });
    expect(applyDefaults({ ...base, category: 'task' })).toMatchObject({ deadline: null, ask: true });
  });

  it('tool ve read: tarih yok, 14 gün sonra sorulur', () => {
    for (const category of ['tool', 'read'] as const) {
      const r = applyDefaults({ ...base, category });
      expect(r.deadline).toBeNull();
      expect(show(r.checkInAt!)).toBe('2026-11-03T20:00');
    }
  });

  it('metinde tarih varsa varsayılan uygulanmaz', () => {
    const deadline = ist('2026-10-24T23:59');
    expect(applyDefaults({ ...base, category: 'job', deadline })).toMatchObject({ deadline, reason: null });
  });
});
