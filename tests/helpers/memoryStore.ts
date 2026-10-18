import { randomUUID } from 'node:crypto';
import type { InboundMessage, Item, Reminder, User } from '../../src/db/schema.js';
import { OPEN_STATUSES, type Store } from '../../src/db/store.js';

/** Testler için bellek içi Store. Davranışı drizzleStore ile aynı tutulur. */
export class MemoryStore implements Store {
  users: User[] = [];
  items: Item[] = [];
  reminders: Reminder[] = [];
  inbound: InboundMessage[] = [];
  interactions: { userId: string; itemId: string | null; action: string; at: Date }[] = [];
  preps: { itemId: string; kind: string; content: string }[] = [];

  async touchUser(input: Parameters<Store['touchUser']>[0], at: Date): Promise<User> {
    let u = this.users.find((x) => x.address === input.address);
    if (!u) {
      u = {
        id: randomUUID(),
        address: input.address,
        displayName: input.displayName,
        timezone: input.timezone,
        quietStart: input.quietStart,
        quietEnd: input.quietEnd,
        preferredHour: 20,
        digestDay: 0,
        cvText: null,
        pendingAction: null,
        lastInboundAt: at,
        createdAt: at,
      };
      this.users.push(u);
    } else {
      u.lastInboundAt = at;
      u.displayName = input.displayName ?? u.displayName;
    }
    return { ...u };
  }
  async getUser(id: string) {
    const u = this.users.find((x) => x.id === id);
    return u ? { ...u } : null;
  }
  async updateUser(id: string, patch: Partial<User>) {
    Object.assign(this.users.find((x) => x.id === id) ?? {}, patch);
  }
  async setPendingAction(userId: string, action: User['pendingAction']) {
    const u = this.users.find((x) => x.id === userId);
    if (u) u.pendingAction = action;
  }

  async insertInbound(msg: Parameters<Store['insertInbound']>[0]) {
    if (this.inbound.some((m) => m.messageId === msg.messageId)) return false;
    this.inbound.push({ ...msg, receivedAt: new Date(), processedAt: null });
    return true;
  }
  async getInbound(id: string) {
    return this.inbound.find((m) => m.messageId === id) ?? null;
  }
  async markInboundProcessed(id: string, at: Date) {
    const m = this.inbound.find((x) => x.messageId === id);
    if (m) m.processedAt = at;
  }
  async listUnprocessedInbound(limit: number) {
    return this.inbound.filter((m) => !m.processedAt).slice(0, limit);
  }

  async createItem(item: Parameters<Store['createItem']>[0]): Promise<Item> {
    const row: Item = {
      id: randomUUID(),
      sourceUrl: null,
      rawText: null,
      mediaPath: null,
      organization: null,
      deadlineAt: null,
      deadlineSource: null,
      deadlineEvidence: null,
      eventAt: null,
      location: null,
      effortMinutes: null,
      requirements: [],
      keyNotes: [],
      nextAction: null,
      status: 'open',
      dedupeHash: null,
      createdAt: new Date(),
      closedAt: null,
      ...item,
    } as Item;
    this.items.push(row);
    return { ...row };
  }
  async getItem(id: string) {
    const i = this.items.find((x) => x.id === id);
    return i ? { ...i } : null;
  }
  async updateItem(id: string, patch: Partial<Item>) {
    const i = this.items.find((x) => x.id === id);
    if (!i) return null;
    Object.assign(i, patch);
    return { ...i };
  }
  async findOpenItemByDedupe(userId: string, hash: string) {
    return this.items.find((i) => i.userId === userId && i.dedupeHash === hash && OPEN_STATUSES.includes(i.status)) ?? null;
  }
  async listOpenItems(userId: string, limit: number) {
    return this.items
      .filter((i) => i.userId === userId && OPEN_STATUSES.includes(i.status))
      .sort((a, b) => (a.deadlineAt ? +a.deadlineAt : Infinity) - (b.deadlineAt ? +b.deadlineAt : Infinity) || +a.createdAt - +b.createdAt)
      .slice(0, limit);
  }
  async listOpenItemsDueBetween(userId: string, from: Date, to: Date) {
    return (await this.listOpenItems(userId, 1000)).filter((i) => i.deadlineAt && i.deadlineAt >= from && i.deadlineAt <= to);
  }

  async insertReminders(list: Parameters<Store['insertReminders']>[0]) {
    for (const r of list) {
      this.reminders.push({
        id: randomUUID(),
        channel: 'whatsapp',
        status: 'scheduled',
        messageId: null,
        sentAt: null,
        error: null,
        attempts: 0,
        claimedAt: null,
        ...r,
      });
    }
  }
  async listRemindersForItem(itemId: string) {
    return this.reminders.filter((r) => r.itemId === itemId).sort((a, b) => +a.sendAt - +b.sendAt);
  }
  async cancelScheduledReminders(itemId: string) {
    let n = 0;
    for (const r of this.reminders) {
      if (r.itemId === itemId && r.status === 'scheduled') {
        r.status = 'cancelled';
        n++;
      }
    }
    return n;
  }
  async claimDueReminders(now: Date, limit: number) {
    // Bekleme (await) olmadan seç ve işaretle: Postgres'teki FOR UPDATE SKIP LOCKED
    // + UPDATE ifadesinin atomikliğini taklit eder.
    const due = this.reminders
      .filter((r) => r.status === 'scheduled' && r.sendAt <= now)
      .sort((a, b) => +a.sendAt - +b.sendAt)
      .slice(0, limit);
    for (const r of due) {
      r.status = 'sending';
      r.claimedAt = now;
    }
    return due.map((r) => ({ ...r }));
  }
  async releaseStaleClaims(olderThan: Date) {
    let n = 0;
    for (const r of this.reminders) {
      if (r.status === 'sending' && r.claimedAt && r.claimedAt < olderThan) {
        r.status = 'scheduled';
        r.claimedAt = null;
        n++;
      }
    }
    return n;
  }
  private rem(id: string) {
    return this.reminders.find((r) => r.id === id)!;
  }
  async markReminderSent(id: string, messageId: string | null, at: Date) {
    Object.assign(this.rem(id), { status: 'sent', messageId, sentAt: at, error: null });
  }
  async markReminderRetry(id: string, attempts: number, nextAt: Date, error: string) {
    Object.assign(this.rem(id), { status: 'scheduled', attempts, sendAt: nextAt, error, claimedAt: null });
  }
  async markReminderFailed(id: string, attempts: number, error: string) {
    Object.assign(this.rem(id), { status: 'failed', attempts, error });
  }
  async markReminderCancelled(id: string) {
    this.rem(id).status = 'cancelled';
  }

  async insertInteraction(userId: string, itemId: string | null, action: string, at: Date) {
    this.interactions.push({ userId, itemId, action, at });
  }
  async insertPrep(itemId: string, kind: string, content: string) {
    this.preps.push({ itemId, kind, content });
  }

  async deleteUserData(userId: string) {
    const paths = this.items.filter((i) => i.userId === userId && i.mediaPath).map((i) => i.mediaPath!);
    const itemIds = new Set(this.items.filter((i) => i.userId === userId).map((i) => i.id));
    this.reminders = this.reminders.filter((r) => r.userId !== userId);
    this.interactions = this.interactions.filter((r) => r.userId !== userId);
    this.preps = this.preps.filter((p) => !itemIds.has(p.itemId));
    this.items = this.items.filter((i) => i.userId !== userId);
    this.inbound = this.inbound.filter((m) => m.userId !== userId);
    this.users = this.users.filter((u) => u.id !== userId);
    return paths;
  }
}
