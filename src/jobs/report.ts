import { desc } from 'drizzle-orm';
import type { Db } from '../db/drizzleStore.js';
import { items } from '../db/schema.js';
import { formatShort } from '../rules/time.js';

const SOURCE: Record<string, string> = {
  link: 'Link',
  image: 'Görsel',
  audio: 'Sesli not',
  document: 'PDF',
  text: 'Metin',
  extension: 'Eklenti',
  email: 'E-posta',
};
const HOW: Record<string, string> = { explicit: 'metinde yazılı', inferred: 'göreli ifade', default: 'varsayılan kural', user: 'kullanıcı' };

const cell = (s: string | null | undefined) => (s ?? '').replace(/\|/g, '\|').replace(/\s+/g, ' ').trim();

/**
 * Kapı 1 tablosu (docs/ROADMAP.md): son kayıtların çıkan tarihleri, Markdown olarak.
 * "Beklenen tarih" ve "Doğru mu?" sütunlarını kullanıcı doldurur.
 */
export async function gateReport(db: Db, limit: number, zone: string): Promise<string> {
  const rows = (await db.select().from(items).orderBy(desc(items.createdAt)).limit(limit)).reverse();
  const lines = [
    '| # | Girdi türü | Başlık | Beklenen tarih | Çıkan tarih | Nasıl | Kanıt | Doğru mu? |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r, i) => {
      const date = r.deadlineAt ? formatShort(r.deadlineAt, zone) : 'yok';
      const how = r.deadlineSource ? (HOW[r.deadlineSource] ?? '') : '';
      return `| ${i + 1} | ${SOURCE[r.sourceType] ?? r.sourceType} | ${cell(r.title)} | | ${date} | ${how} | ${cell(r.deadlineEvidence)} | |`;
    }),
  ];
  if (rows.length === 0) lines.push('(henüz kayıt yok)');
  return lines.join('\n');
}
