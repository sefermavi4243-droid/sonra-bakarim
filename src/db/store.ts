import type {
  Device,
  InboundMessage,
  Item,
  ItemStatus,
  NewItem,
  PendingAction,
  Reminder,
  ReminderKind,
  User,
} from './schema.js';

export interface NewUser {
  address: string;
  displayName: string | null;
  timezone: string;
  quietStart: string;
  quietEnd: string;
}

export interface NewReminder {
  itemId: string;
  userId: string;
  kind: ReminderKind;
  sendAt: Date;
}

export interface NewInbound {
  messageId: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
}

export type UserPatch = Partial<
  Pick<
    User,
    'displayName' | 'pendingAction' | 'lastInboundAt' | 'calendarToken' | 'weeklyDigest' | 'morningBrief' | 'lastDigestAt' | 'lastBriefAt'
  >
>;
export type ItemPatch = Partial<
  Pick<Item, 'title' | 'deadlineAt' | 'deadlineSource' | 'deadlineEvidence' | 'eventAt' | 'status' | 'closedAt'>
>;

/**
 * Veritabanı erişiminin tamamı. Gerçek uygulama Drizzle ile (`drizzleStore.ts`),
 * testler bellek içi sahte ile (`tests/helpers/memoryStore.ts`) çalışır.
 */
export interface Store {
  /** Kullanıcıyı telefonla bulur, yoksa oluşturur; `last_inbound_at`'ı günceller. */
  touchUser(input: NewUser, at: Date): Promise<User>;
  getUser(id: string): Promise<User | null>;
  updateUser(id: string, patch: UserPatch): Promise<void>;
  setPendingAction(userId: string, action: PendingAction | null): Promise<void>;

  /** Yeni mesajsa true, aynı `wa_message_id` daha önce geldiyse false döner. */
  insertInbound(msg: NewInbound): Promise<boolean>;
  getInbound(messageId: string): Promise<InboundMessage | null>;
  markInboundProcessed(messageId: string, at: Date): Promise<void>;
  listUnprocessedInbound(limit: number): Promise<InboundMessage[]>;

  createItem(item: NewItem): Promise<Item>;
  getItem(id: string): Promise<Item | null>;
  updateItem(id: string, patch: ItemPatch): Promise<Item | null>;
  findOpenItemByDedupe(userId: string, hash: string): Promise<Item | null>;
  /** Açık kayıtlar (open, snoozed), son tarihe göre; tarihsizler sonda. */
  listOpenItems(userId: string, limit: number): Promise<Item[]>;
  listOpenItemsDueBetween(userId: string, from: Date, to: Date): Promise<Item[]>;

  insertReminders(list: NewReminder[]): Promise<void>;
  listRemindersForItem(itemId: string): Promise<Reminder[]>;
  /** Kaydın `scheduled` hatırlatmalarını `cancelled` yapar. */
  cancelScheduledReminders(itemId: string): Promise<number>;
  /**
   * Vadesi gelen hatırlatmaları atomik olarak üzerine alır (`sending`).
   * İki zamanlayıcı aynı anda çağırsa bile bir hatırlatma yalnızca birine düşer.
   */
  claimDueReminders(now: Date, limit: number): Promise<Reminder[]>;
  /** Uzun süre `sending`de kalanları (çöken süreç) yeniden `scheduled` yapar. */
  releaseStaleClaims(olderThan: Date): Promise<number>;
  markReminderSent(id: string, messageId: string | null, at: Date): Promise<void>;
  markReminderRetry(id: string, attempts: number, nextAt: Date, error: string): Promise<void>;
  markReminderFailed(id: string, attempts: number, error: string): Promise<void>;
  markReminderCancelled(id: string): Promise<void>;

  insertInteraction(userId: string, itemId: string | null, action: string, at: Date): Promise<void>;
  insertPrep(itemId: string, kind: 'checklist' | 'summary' | 'cover_letter' | 'trial_plan', content: string): Promise<void>;

  /** Kullanıcının tüm verisini siler; silinmesi gereken medya yollarını döndürür. */
  deleteUserData(userId: string): Promise<string[]>;

  /** Kullanıcının kayıtları (verilen durumlarda); son tarih ya da etkinlik zamanına göre, tarihsizler sonda. */
  listItems(userId: string, statuses: ItemStatus[], limit: number): Promise<Item[]>;
  listUsers(): Promise<User[]>;
  findUserByCalendarToken(token: string): Promise<User | null>;

  /** Kullanıcının önceki kodlarını silip yenisini yazar. */
  createLinkCode(userId: string, codeHash: string, expiresAt: Date): Promise<void>;
  /** Kod geçerliyse siler ve sahibini döndürür; tek kullanımlıktır. */
  consumeLinkCode(codeHash: string, now: Date): Promise<string | null>;
  createDevice(input: { userId: string; name: string; tokenHash: string }, at: Date): Promise<Device>;
  findDeviceByToken(tokenHash: string): Promise<Device | null>;
  touchDevice(id: string, at: Date): Promise<void>;
  listDevices(userId: string): Promise<Device[]>;
  deleteDevice(userId: string, id: string): Promise<boolean>;
}

export const OPEN_STATUSES: ItemStatus[] = ['open', 'snoozed'];
