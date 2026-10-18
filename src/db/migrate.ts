import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { DEFAULT_DATABASE_URL } from '../config.js';
import { createDb } from './drizzleStore.js';

const url = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;

const { db, close } = createDb(url);
try {
  // Göç adımı sürücüden bağımsız (dialect + session); PGlite'ta da aynı fonksiyon çalışır.
  await migrate(db as never, { migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)) });
  console.log(`Migration tamam (${/^postgres/.test(url) ? 'Postgres' : `yerel: ${url}`}).`);
} finally {
  await close();
}
