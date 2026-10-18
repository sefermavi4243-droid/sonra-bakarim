import type { DateTime } from 'luxon';
import type { Block, Item } from '../db/schema.js';
import { at, isQuiet, local, type UserPrefs } from './time.js';

/**
 * Geriye doğru planlama: süresi tahmin edilmiş her açık işe, son tarihten önce
 * takvimde boş bir çalışma bloğu önerir. Öneri yalnızca öneridir; kullanıcı onaylarsa
 * blok olarak kaydedilir.
 *
 * Kurallar:
 * 1. Blok süresi tahmini süre kadardır; 30 dakikadan kısa, 3 saatten uzun olmaz.
 * 2. Tercih edilen gün, son tarihten önceki gündür (bir gün pay); süre 2 saati aşıyorsa
 *    bir gün daha erkene alınır. Saat, kullanıcının tercih ettiği akşam saatidir.
 * 3. Blok şimdiden en az 30 dakika sonra başlar, son tarihten önce biter, sessiz
 *    saatlere taşmaz ve başka bir blokla ya da etkinlikle çakışmaz.
 * 4. Uygun yer yoksa günler birer birer geriye, bugüne kadar denenir; sonra son tarih
 *    gününün sabahı (10:00) denenir. Hiçbiri olmazsa öneri yoktur.
 * 5. Etkinlikler, onaylanmış bloğu olan işler ve süresi bilinmeyen işler atlanır.
 */

export const MIN_BLOCK_MINUTES = 30;
export const MAX_BLOCK_MINUTES = 180;
const LEAD_MINUTES = 30;

export interface Suggestion {
  itemId: string;
  startAt: Date;
  endAt: Date;
}

interface Busy {
  start: number;
  end: number;
}

const overlaps = (a: Busy, b: Busy) => a.start < b.end && b.start < a.end;

function fits(start: DateTime, minutes: number, deadline: Date, now: Date, prefs: UserPrefs, busy: Busy[]): Busy | null {
  const s = start.toJSDate();
  const e = start.plus({ minutes }).toJSDate();
  if (+s < +now + LEAD_MINUTES * 60_000) return null;
  if (e > deadline) return null;
  // Başlangıç ve bitiş (bir dakika öncesi) sessiz saatte olmamalı.
  if (isQuiet(s, prefs) || isQuiet(new Date(+e - 60_000), prefs)) return null;
  const slot = { start: +s, end: +e };
  return busy.some((b) => overlaps(b, slot)) ? null : slot;
}

/** Akşam bloğunun başlangıcı: tercih edilen saat; blok sessiz saate taşacaksa daha erken. */
function eveningStart(day: DateTime, minutes: number, prefs: UserPrefs): DateTime {
  const [qh, qm] = prefs.quietStart.split(':').map(Number) as [number, number];
  const latest = qh * 60 + qm - minutes;
  const preferred = prefs.preferredHour * 60;
  const start = Math.floor(Math.min(preferred, latest) / 15) * 15;
  return at(day, Math.floor(start / 60), start % 60);
}

export function suggestBlocks(items: Item[], existing: Block[], now: Date, prefs: UserPrefs): Suggestion[] {
  const zone = prefs.timezone;
  const busy: Busy[] = existing.map((b) => ({ start: +b.startAt, end: +b.endAt }));
  for (const item of items) {
    if (item.eventAt) busy.push({ start: +item.eventAt, end: +item.eventAt + 60 * 60_000 });
  }
  const planned = new Set(existing.map((b) => b.itemId));
  const candidates = items
    .filter((i) => (i.status === 'open' || i.status === 'snoozed') && i.category !== 'event')
    .filter((i) => i.deadlineAt && i.deadlineAt > now && i.effortMinutes && !planned.has(i.id))
    .sort((a, b) => +a.deadlineAt! - +b.deadlineAt!); // önce en acil

  const today = local(now, zone).startOf('day');
  const out: Suggestion[] = [];
  for (const item of candidates) {
    const minutes = Math.min(MAX_BLOCK_MINUTES, Math.max(MIN_BLOCK_MINUTES, Math.round(item.effortMinutes! / 15) * 15));
    const deadline = item.deadlineAt!;
    const D = local(deadline, zone).startOf('day');
    const leadDays = minutes > 120 ? 2 : 1;
    let found: Busy | null = null;
    for (let day = D.minus({ days: leadDays }); day >= today && !found; day = day.minus({ days: 1 })) {
      found = fits(eveningStart(day, minutes, prefs), minutes, deadline, now, prefs, busy);
    }
    // Son çare: son tarih gününün sabahı, ya da bugün hemen.
    if (!found) found = fits(at(D, 10), minutes, deadline, now, prefs, busy);
    if (!found) {
      const soon = local(new Date(+now + LEAD_MINUTES * 60_000), zone);
      const rounded = soon.plus({ minutes: (15 - (soon.minute % 15)) % 15 }).startOf('minute');
      found = fits(rounded, minutes, deadline, now, prefs, busy);
    }
    if (!found) continue;
    busy.push(found);
    out.push({ itemId: item.id, startAt: new Date(found.start), endAt: new Date(found.end) });
  }
  return out;
}
