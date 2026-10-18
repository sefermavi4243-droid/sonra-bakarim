import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { inboundMessages, interactions, items, preps, reminders, users } from './schema.js';
import { OPEN_STATUSES, type Store } from './store.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * `postgres://…` gerçek sunucuya (Supabase) bağlanır. Başka bir değer yerel klasör
 * sayılır ve gömülü Postgres (PGlite) orada açılır; hesap gerektirmez.
 */
export function createDb(url: string): { db: Db; close: () => Promise<void> } {
  if (!/^postgres(ql)?:\/\//.test(url)) {
    const dir = url.replace(/^file:/, '');
    mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    return { db: drizzlePglite(client, { schema }) as unknown as Db, close: () => client.close() };
  }
  // Supabase bağlantı havuzu (transaction modu) hazır ifadeleri desteklemez.
  const client = postgres(url, { prepare: false, max: 5 });
  return { db: drizzle(client, { schema }) as unknown as Db, close: () => client.end() };
}

export function createDrizzleStore(db: Db): Store {
  return {
    async touchUser(input, at) {
      const [row] = await db
        .insert(users)
        .values({ ...input, lastInboundAt: at })
        .onConflictDoUpdate({
          target: users.address,
          set: {
            lastInboundAt: at,
            displayName: sql`coalesce(excluded.display_name, ${users.displayName})`,
          },
        })
        .returning();
      return row!;
    },

    async getUser(id) {
      return (await db.query.users.findFirst({ where: eq(users.id, id) })) ?? null;
    },

    async updateUser(id, patch) {
      await db.update(users).set(patch).where(eq(users.id, id));
    },

    async setPendingAction(userId, action) {
      await db.update(users).set({ pendingAction: action }).where(eq(users.id, userId));
    },

    async insertInbound(msg) {
      const rows = await db
        .insert(inboundMessages)
        .values(msg)
        .onConflictDoNothing({ target: inboundMessages.messageId })
        .returning({ id: inboundMessages.messageId });
      return rows.length === 1;
    },

    async getInbound(messageId) {
      return (await db.query.inboundMessages.findFirst({ where: eq(inboundMessages.messageId, messageId) })) ?? null;
    },

    async markInboundProcessed(messageId, at) {
      await db
        .update(inboundMessages)
        .set({ processedAt: at })
        .where(eq(inboundMessages.messageId, messageId));
    },

    async listUnprocessedInbound(limit) {
      return db
        .select()
        .from(inboundMessages)
        .where(isNull(inboundMessages.processedAt))
        .orderBy(asc(inboundMessages.receivedAt))
        .limit(limit);
    },

    async createItem(item) {
      const [row] = await db.insert(items).values(item).returning();
      return row!;
    },

    async getItem(id) {
      return (await db.query.items.findFirst({ where: eq(items.id, id) })) ?? null;
    },

    async updateItem(id, patch) {
      const [row] = await db.update(items).set(patch).where(eq(items.id, id)).returning();
      return row ?? null;
    },

    async findOpenItemByDedupe(userId, hash) {
      return (
        (await db.query.items.findFirst({
          where: and(
            eq(items.userId, userId),
            eq(items.dedupeHash, hash),
            inArray(items.status, OPEN_STATUSES),
          ),
        })) ?? null
      );
    },

    async listOpenItems(userId, limit) {
      return db
        .select()
        .from(items)
        .where(and(eq(items.userId, userId), inArray(items.status, OPEN_STATUSES)))
        .orderBy(sql`${items.deadlineAt} asc nulls last`, asc(items.createdAt))
        .limit(limit);
    },

    async listOpenItemsDueBetween(userId, from, to) {
      return db
        .select()
        .from(items)
        .where(
          and(
            eq(items.userId, userId),
            inArray(items.status, OPEN_STATUSES),
            isNotNull(items.deadlineAt),
            gte(items.deadlineAt, from),
            lte(items.deadlineAt, to),
          ),
        )
        .orderBy(asc(items.deadlineAt));
    },

    async insertReminders(list) {
      if (list.length === 0) return;
      await db.insert(reminders).values(list);
    },

    async listRemindersForItem(itemId) {
      return db.select().from(reminders).where(eq(reminders.itemId, itemId)).orderBy(asc(reminders.sendAt));
    },

    async cancelScheduledReminders(itemId) {
      const rows = await db
        .update(reminders)
        .set({ status: 'cancelled' })
        .where(and(eq(reminders.itemId, itemId), eq(reminders.status, 'scheduled')))
        .returning({ id: reminders.id });
      return rows.length;
    },

    async claimDueReminders(now, limit) {
      // Satırları kilitleyip aynı ifadede `sending` yapar; başka bir zamanlayıcı
      // kilitli satırları SKIP LOCKED ile atlar, güncellenmiş satırları da artık
      // `scheduled` görmediği için alamaz.
      const due = db
        .select({ id: reminders.id })
        .from(reminders)
        .where(and(eq(reminders.status, 'scheduled'), lte(reminders.sendAt, now)))
        .orderBy(asc(reminders.sendAt))
        .limit(limit)
        .for('update', { skipLocked: true });
      return db
        .update(reminders)
        .set({ status: 'sending', claimedAt: now })
        .where(inArray(reminders.id, due))
        .returning();
    },

    async releaseStaleClaims(olderThan) {
      const rows = await db
        .update(reminders)
        .set({ status: 'scheduled', claimedAt: null })
        .where(and(eq(reminders.status, 'sending'), lt(reminders.claimedAt, olderThan)))
        .returning({ id: reminders.id });
      return rows.length;
    },

    async markReminderSent(id, messageId, at) {
      await db
        .update(reminders)
        .set({ status: 'sent', messageId, sentAt: at, error: null })
        .where(eq(reminders.id, id));
    },

    async markReminderRetry(id, attempts, nextAt, error) {
      await db
        .update(reminders)
        .set({ status: 'scheduled', attempts, sendAt: nextAt, error, claimedAt: null })
        .where(eq(reminders.id, id));
    },

    async markReminderFailed(id, attempts, error) {
      await db.update(reminders).set({ status: 'failed', attempts, error }).where(eq(reminders.id, id));
    },

    async markReminderCancelled(id) {
      await db.update(reminders).set({ status: 'cancelled' }).where(eq(reminders.id, id));
    },

    async insertInteraction(userId, itemId, action, at) {
      await db.insert(interactions).values({ userId, itemId, action, at });
    },

    async insertPrep(itemId, kind, content) {
      await db.insert(preps).values({ itemId, kind, content });
    },

    async deleteUserData(userId) {
      return db.transaction(async (tx) => {
        const media = await tx
          .select({ path: items.mediaPath })
          .from(items)
          .where(and(eq(items.userId, userId), isNotNull(items.mediaPath)));
        // Yabancı anahtarlar ON DELETE CASCADE; yine de sırayla silmek niyeti açık tutar.
        await tx.delete(reminders).where(eq(reminders.userId, userId));
        await tx.delete(interactions).where(eq(interactions.userId, userId));
        const itemIds = tx.select({ id: items.id }).from(items).where(eq(items.userId, userId));
        await tx.delete(preps).where(inArray(preps.itemId, itemIds));
        await tx.delete(items).where(eq(items.userId, userId));
        await tx.delete(inboundMessages).where(eq(inboundMessages.userId, userId));
        await tx.delete(users).where(eq(users.id, userId));
        return media.map((m) => m.path).filter((p): p is string => p !== null);
      });
    },
  };
}
