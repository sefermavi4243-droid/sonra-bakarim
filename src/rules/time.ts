import { DateTime } from 'luxon';

export interface UserPrefs {
  timezone: string;
  quietStart: string; // "22:00"
  quietEnd: string; // "08:00"
  preferredHour: number; // 0-23
}

export const DEFAULT_TIMEZONE = 'Europe/Istanbul';

export function local(date: Date, zone: string): DateTime {
  return DateTime.fromJSDate(date, { zone });
}

export function at(dt: DateTime, hour: number, minute = 0): DateTime {
  return dt.set({ hour, minute, second: 0, millisecond: 0 });
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minuteOfDay(dt: DateTime): number {
  return dt.hour * 60 + dt.minute;
}

export function isQuiet(date: Date, prefs: UserPrefs): boolean {
  const start = minutesOf(prefs.quietStart);
  const end = minutesOf(prefs.quietEnd);
  if (start === end) return false;
  const m = minuteOfDay(local(date, prefs.timezone));
  return start < end ? m >= start && m < end : m >= start || m < end;
}

/** Sessiz saatin bittiği an. `date` sessiz saatte olmalı. */
function quietEndAfter(date: Date, prefs: UserPrefs): DateTime {
  const dt = local(date, prefs.timezone);
  const end = minutesOf(prefs.quietEnd);
  const sameDay = at(dt, Math.floor(end / 60), end % 60);
  return sameDay > dt ? sameDay : sameDay.plus({ days: 1 });
}

/** `date`'i içine alan sessiz dönemin başladığı an. `date` sessiz saatte olmalı. */
function quietStartBefore(date: Date, prefs: UserPrefs): DateTime {
  const dt = local(date, prefs.timezone);
  const start = minutesOf(prefs.quietStart);
  const sameDay = at(dt, Math.floor(start / 60), start % 60);
  return sameDay <= dt ? sameDay : sameDay.minus({ days: 1 });
}

/** Sessiz saat başlamadan ne kadar önceye alınacağı (kural 6). */
export const BEFORE_QUIET_MINUTES = 15;

/**
 * SPEC bölüm 10, kural 6: sessiz saate düşen hatırlatma bir sonraki uygun saate kayar;
 * kayınca `limit`i (son tarih ya da etkinlik) geçiyorsa sessiz saat başlamadan hemen
 * önceye alınır.
 */
export function adjustForQuiet(date: Date, prefs: UserPrefs, limit: Date | null): Date {
  if (!isQuiet(date, prefs)) return date;
  const moved = quietEndAfter(date, prefs).toJSDate();
  if (limit === null || moved <= limit) return moved;
  return quietStartBefore(date, prefs).minus({ minutes: BEFORE_QUIET_MINUTES }).toJSDate();
}

const TR = 'tr';

/** "24 Ekim Cumartesi 23:59" */
export function formatDateTime(date: Date, zone: string): string {
  return local(date, zone).setLocale(TR).toFormat('d MMMM cccc HH:mm');
}

/** "24 Eki Cmt 23:59" — listeler için kısa biçim. */
export function formatShort(date: Date, zone: string): string {
  return local(date, zone).setLocale(TR).toFormat('d MMM ccc HH:mm');
}
