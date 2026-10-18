import 'dotenv/config';
import { DEFAULT_DATABASE_URL } from './config.js';
import { createDb } from './db/drizzleStore.js';
import { gateReport } from './jobs/report.js';

/**
 * Kapı 1 raporu. Kullanım: npm run rapor [-- adet]
 * Bot açıksa onun yerel ucundan okur (gömülü veritabanını iki süreç aynı anda açamaz);
 * kapalıysa veritabanını doğrudan açar.
 */
const limit = Number(process.argv[2] ?? 10) || 10;
const adminPort = Number(process.env.ADMIN_PORT?.trim() || 3001);

try {
  const res = await fetch(`http://127.0.0.1:${adminPort}/rapor?limit=${limit}`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(String(res.status));
  console.log(await res.text());
} catch {
  const { db, close } = createDb(process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL);
  try {
    console.log(await gateReport(db, limit, process.env.APP_TIMEZONE?.trim() || 'Europe/Istanbul'));
  } finally {
    await close();
  }
}
