import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, createDrizzleStore } from '../src/db/drizzleStore.js';
import { users } from '../src/db/schema.js';

// Gerçek Postgres'te FOR UPDATE SKIP LOCKED: iki bağlantı aynı anda üzerine alır.
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('claimDueReminders (Postgres)', () => {
  const a = createDb(url!);
  const b = createDb(url!);
  const phone = `test-${Date.now()}`;

  afterAll(async () => {
    await a.db.delete(users).where(eq(users.address, phone));
    await a.close();
    await b.close();
  });

  it('iki zamanlayıcı aynı hatırlatmayı alamaz', async () => {
    const store = createDrizzleStore(a.db);
    const other = createDrizzleStore(b.db);
    const now = new Date();
    const user = await store.touchUser(
      { address: phone, displayName: null, timezone: 'Europe/Istanbul', quietStart: '22:00', quietEnd: '08:00' },
      now,
    );
    const item = await store.createItem({ userId: user.id, sourceType: 'text', title: 'Canlı test', category: 'task' });
    await store.insertReminders(
      Array.from({ length: 30 }, (_, i) => ({ itemId: item.id, userId: user.id, kind: 'nudge' as const, sendAt: new Date(+now - i * 1000) })),
    );

    const [x, y] = await Promise.all([store.claimDueReminders(now, 20), other.claimDueReminders(now, 20)]);
    const mine = [...x, ...y].filter((r) => r.itemId === item.id).map((r) => r.id);
    expect(new Set(mine).size).toBe(mine.length);
    const rows = await store.listRemindersForItem(item.id);
    expect(rows.filter((r) => r.status === 'sending')).toHaveLength(mine.length);
  });
});
