import type { Category } from '../db/schema.js';
import { at, local, type UserPrefs } from './time.js';

export interface DefaultsInput {
  category: Category;
  deadline: Date | null;
  eventAt: Date | null;
  now: Date;
  prefs: UserPrefs;
}

export interface DefaultsResult {
  deadline: Date | null;
  /** Varsayılan kural uygulandıysa açıklama (kartta gösterilir). */
  reason: string | null;
  /** Kullanıcıya tarih sorulmalı mı? */
  ask: boolean;
  /** Tarihsiz kayıtlar için "hâlâ istiyor musun?" sorusunun zamanı. */
  checkInAt: Date | null;
}

export const ASK_DEADLINE_QUESTION = 'Bunun son tarihi ne zaman? Örneğin "cuma", "24 Ekim" ya da "perşembe 18:00" yaz.';

/**
 * SPEC bölüm 9: son tarih yoksa türe göre varsayılan. Boş tarihleri yalnızca bu dosya
 * doldurur; yapay zekâ tarih uydurmaz.
 */
export function applyDefaults({ category, deadline, eventAt, now, prefs }: DefaultsInput): DefaultsResult {
  const none = { deadline, reason: null, ask: false, checkInAt: null };
  if (deadline) return none;
  const today = local(now, prefs.timezone);

  switch (category) {
    case 'job':
      return {
        ...none,
        deadline: at(today.plus({ days: 2 }), 11).toJSDate(),
        reason: 'İlanda son tarih yok; erken başvuran öne çıkar.',
      };
    case 'event': {
      if (!eventAt) return { ...none, ask: true };
      const before = local(eventAt, prefs.timezone).minus({ days: 3 }).toJSDate();
      // Etkinliğe 3 günden az kaldıysa kayıt tarihi koymayız; etkinlik hatırlatmaları yeter.
      return before > now
        ? { ...none, deadline: before, reason: 'Kayıt tarihi yok; etkinlikten 3 gün önceye koydum.' }
        : none;
    }
    case 'application':
    case 'task':
      return { ...none, ask: true };
    case 'tool':
    case 'read':
    case 'other':
      return { ...none, checkInAt: at(today.plus({ days: 14 }), prefs.preferredHour).toJSDate() };
  }
}
