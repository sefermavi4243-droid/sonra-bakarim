import type { ReminderKind } from '../db/schema.js';
import { adjustForQuiet, at, local, type UserPrefs } from './time.js';

export interface PlannedReminder {
  kind: ReminderKind;
  sendAt: Date;
}

export interface PlanInput {
  deadline: Date | null;
  effortMinutes: number | null;
  eventAt: Date | null;
  /** Tarihsiz kayıtlar için "hâlâ istiyor musun?" zamanı. */
  checkInAt?: Date | null;
  now: Date;
  prefs: UserPrefs;
}

export const MAX_REMINDERS = 3;

// Üçten fazla aday varsa önce bunlar kalır (kural 7).
const PRIORITY: ReminderKind[] = ['last_call', 'event_soon', 'event_eve', 'nudge', 'plan', 'digest'];

interface Candidate extends PlannedReminder {
  limit: Date | null;
}

/** SPEC bölüm 10: bir kaydın hatırlatma zamanları. */
export function planReminders({ deadline, effortMinutes, eventAt, checkInAt, now, prefs }: PlanInput): PlannedReminder[] {
  const zone = prefs.timezone;
  const candidates: Candidate[] = [];

  if (deadline) {
    const D = local(deadline, zone);
    const E = effortMinutes ?? 0;
    // Kural 1
    if (E >= 30) {
      const days = Math.ceil(E / 60) + 1;
      candidates.push({ kind: 'plan', sendAt: at(D.minus({ days }), prefs.preferredHour).toJSDate(), limit: deadline });
    }
    // Kural 2 ve 3
    if (D.hour < 12) {
      candidates.push({ kind: 'nudge', sendAt: at(D.minus({ days: 1 }), 20).toJSDate(), limit: deadline });
    } else {
      candidates.push({ kind: 'nudge', sendAt: at(D.minus({ days: 1 }), 10).toJSDate(), limit: deadline });
      candidates.push({ kind: 'last_call', sendAt: at(D, 9).toJSDate(), limit: deadline });
    }
  }

  // Kural 4
  if (eventAt) {
    const ev = local(eventAt, zone);
    candidates.push({ kind: 'event_eve', sendAt: at(ev.minus({ days: 1 }), 20).toJSDate(), limit: eventAt });
    candidates.push({ kind: 'event_soon', sendAt: ev.minus({ hours: 2 }).toJSDate(), limit: eventAt });
  }

  if (!deadline && !eventAt && checkInAt) {
    candidates.push({ kind: 'nudge', sendAt: checkInAt, limit: null });
  }

  const settle = (c: Candidate): Candidate | null => {
    if (c.sendAt <= now) return null; // Kural 5
    const sendAt = adjustForQuiet(c.sendAt, prefs, c.limit); // Kural 6
    if (sendAt <= now || (c.limit && sendAt >= c.limit)) return null;
    return { ...c, sendAt };
  };

  let result = candidates.map(settle).filter((c): c is Candidate => c !== null);

  // Kural 5: hiçbiri kalmadıysa ve tarih gelecekteyse hemen tek hatırlatma.
  if (result.length === 0) {
    const target = [deadline, eventAt].filter((d): d is Date => d !== null && d > now).sort((a, b) => +a - +b)[0];
    if (target) {
      const kind: ReminderKind = target === deadline ? 'last_call' : 'event_soon';
      const immediate = adjustForQuiet(now, prefs, target);
      if (immediate >= now && immediate < target) result = [{ kind, sendAt: immediate, limit: target }];
    }
  }

  // Aynı ana düşenleri birleştir, öncelik sırasıyla en fazla 3 tane tut (kural 7).
  const byPriority = [...result].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  const kept: Candidate[] = [];
  for (const c of byPriority) {
    if (kept.length >= MAX_REMINDERS) break;
    if (kept.some((k) => +k.sendAt === +c.sendAt)) continue;
    kept.push(c);
  }
  return kept.sort((a, b) => +a.sendAt - +b.sendAt).map(({ kind, sendAt }) => ({ kind, sendAt }));
}

export type SnoozeOption = '3h' | 'tomorrow' | 'weekend';

export const SNOOZE_LABELS: Record<SnoozeOption, string> = {
  '3h': '3 saat sonra',
  tomorrow: 'Yarın aynı saat',
  weekend: 'Hafta sonu',
};

/**
 * Kural 8: erteleme seçeneği için gönderim zamanı. Sessiz saate uyar;
 * son tarihi geçiyorsa null (bu seçenek sunulmaz).
 */
export function snoozeTime(option: SnoozeOption, now: Date, deadline: Date | null, prefs: UserPrefs): Date | null {
  const n = local(now, prefs.timezone);
  let target;
  switch (option) {
    case '3h':
      target = n.plus({ hours: 3 });
      break;
    case 'tomorrow':
      target = n.plus({ days: 1 });
      break;
    case 'weekend': {
      // Bir sonraki cumartesi 11:00 (şu andan sonra).
      let sat = at(n.plus({ days: (6 - n.weekday + 7) % 7 }), 11);
      if (sat <= n) sat = sat.plus({ weeks: 1 });
      target = sat;
      break;
    }
  }
  const sendAt = adjustForQuiet(target.toJSDate(), prefs, deadline);
  if (sendAt <= now) return null;
  if (deadline && sendAt >= deadline) return null;
  return sendAt;
}

export function availableSnoozes(now: Date, deadline: Date | null, prefs: UserPrefs): SnoozeOption[] {
  return (['3h', 'tomorrow', 'weekend'] as const).filter((o) => snoozeTime(o, now, deadline, prefs) !== null);
}
