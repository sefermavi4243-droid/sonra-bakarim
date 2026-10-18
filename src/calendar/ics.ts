import { DateTime } from 'luxon';
import type { Item } from '../db/schema.js';

/**
 * RFC 5545 takvim dosyası. Son tarihler ve etkinlikler ayrı olaylar olur:
 * - Gün sonu (23:59) son tarihi tüm gün olayı olarak, bir gün önce uyarıyla.
 * - Saatli son tarih, son tarihe biten 30 dakikalık bir olay olarak.
 * - Etkinlik, başlangıcından itibaren 1 saat (ya da tahmini süre kadar).
 */

const PRODID = '-//Sonra Bakarim//TR';
const DEADLINE_BLOCK_MINUTES = 30;
const DEFAULT_EVENT_MINUTES = 60;

/** Metin değerlerinde \ ; , ve satır sonu kaçırılır. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Satırlar 75 baytı geçmeyecek şekilde katlanır; çok baytlı karakterler bölünmez. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    const limit = out.length === 0 ? 75 : 74; // devam satırları bir boşlukla başlar
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

function utc(d: Date): string {
  return DateTime.fromJSDate(d, { zone: 'utc' }).toFormat("yyyyMMdd'T'HHmmss'Z'");
}

function dateOnly(d: DateTime): string {
  return d.toFormat('yyyyMMdd');
}

function description(item: Item): string {
  const parts: string[] = [];
  if (item.organization) parts.push(item.organization);
  if (item.nextAction) parts.push(`İlk adım: ${item.nextAction}`);
  if (item.requirements.length) parts.push(`Gerekenler: ${item.requirements.join(', ')}`);
  if (item.deadlineEvidence) parts.push(`Kaynakta: "${item.deadlineEvidence}"`);
  if (item.sourceUrl) parts.push(item.sourceUrl);
  return parts.join('\n');
}

function alarm(trigger: string, text: string): string[] {
  return ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(text)}`, `TRIGGER:${trigger}`, 'END:VALARM'];
}

/** Bir kaydın takvim olayları (0, 1 ya da 2 olay). */
export function itemEvents(item: Item, zone: string, now: Date): string[][] {
  const events: string[][] = [];
  const common = (suffix: string) => [
    'BEGIN:VEVENT',
    `UID:${item.id}-${suffix}@sonra-bakarim`,
    `DTSTAMP:${utc(now)}`,
    ...(item.sourceUrl ? [`URL:${item.sourceUrl}`] : []),
  ];
  const desc = description(item);

  if (item.deadlineAt) {
    const local = DateTime.fromJSDate(item.deadlineAt, { zone });
    const endOfDay = local.hour === 23 && local.minute === 59;
    const lines = [...common('deadline'), `SUMMARY:${escapeText(`Son gün: ${item.title}`)}`];
    if (endOfDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(local)}`, `DTEND;VALUE=DATE:${dateOnly(local.plus({ days: 1 }))}`, 'TRANSP:TRANSPARENT');
      lines.push(...alarm('-PT15H', `Yarın son gün: ${item.title}`)); // önceki gün 09:00
    } else {
      lines.push(`DTSTART:${utc(local.minus({ minutes: DEADLINE_BLOCK_MINUTES }).toJSDate())}`, `DTEND:${utc(item.deadlineAt)}`);
      lines.push(...alarm('-P1D', `Yarın son tarih: ${item.title}`));
    }
    if (desc) lines.push(`DESCRIPTION:${escapeText(desc)}`);
    lines.push('END:VEVENT');
    events.push(lines);
  }

  if (item.eventAt) {
    const minutes = item.category === 'event' ? DEFAULT_EVENT_MINUTES : Math.max(item.effortMinutes ?? 0, DEFAULT_EVENT_MINUTES);
    const lines = [
      ...common('event'),
      `SUMMARY:${escapeText(item.title)}`,
      `DTSTART:${utc(item.eventAt)}`,
      `DTEND:${utc(new Date(+item.eventAt + minutes * 60_000))}`,
      ...(item.location ? [`LOCATION:${escapeText(item.location)}`] : []),
      ...(desc ? [`DESCRIPTION:${escapeText(desc)}`] : []),
      ...alarm('-PT2H', `2 saat sonra: ${item.title}`),
      'END:VEVENT',
    ];
    events.push(lines);
  }
  return events;
}

export function buildCalendar(items: Item[], zone: string, now: Date, name = 'Sonra Bakarım'): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${zone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...items.flatMap((item) => itemEvents(item, zone, now).flat()),
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** Dosya adı için güvenli kısa ad. */
export function icsFileName(title: string): string {
  const base = title
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${base || 'kayit'}.ics`;
}
