import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Değer kümeleri: docs/SPEC.md bölüm 8.
export const sourceTypeEnum = pgEnum('source_type', [
  'link',
  'image',
  'audio',
  'document',
  'text',
  'extension',
  'email',
]);
export const categoryEnum = pgEnum('category', [
  'job',
  'event',
  'application',
  'tool',
  'read',
  'task',
  'other',
  // Haftalık hedef: "bu hafta Medium yazımı yayınlayacağım" (SPEC'e ek).
  'goal',
]);
export const deadlineSourceEnum = pgEnum('deadline_source', ['explicit', 'inferred', 'default', 'user']);
export const itemStatusEnum = pgEnum('item_status', ['open', 'snoozed', 'done', 'dropped', 'expired']);
export const reminderKindEnum = pgEnum('reminder_kind', [
  'plan',
  'nudge',
  'last_call',
  'event_eve',
  'event_soon',
  'digest',
]);
// `sending`: zamanlayıcının üzerine aldığı, gönderimi süren hatırlatma (SPEC'e ek).
export const reminderStatusEnum = pgEnum('reminder_status', [
  'scheduled',
  'sending',
  'sent',
  'failed',
  'cancelled',
]);
export const channelEnum = pgEnum('channel', ['whatsapp', 'telegram', 'webpush']);
export const prepKindEnum = pgEnum('prep_kind', ['cover_letter', 'checklist', 'summary', 'trial_plan']);

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Kullanıcının bir sonraki serbest metin yanıtını neyin beklediği (SPEC'e ek). */
export type PendingAction =
  | { type: 'change_date'; itemId: string }
  | { type: 'confirm_delete'; expiresAt: string };

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Kanaldaki alıcı: WhatsApp'ta telefon numarası, Telegram'da `tg:<chat_id>`. */
  address: text('address').notNull().unique(),
  displayName: text('display_name'),
  timezone: text('timezone').notNull().default('Europe/Istanbul'),
  quietStart: text('quiet_start').notNull().default('22:00'),
  quietEnd: text('quiet_end').notNull().default('08:00'),
  preferredHour: integer('preferred_hour').notNull().default(20),
  digestDay: integer('digest_day').notNull().default(0),
  cvText: text('cv_text'),
  pendingAction: jsonb('pending_action').$type<PendingAction | null>(),
  lastInboundAt: tz('last_inbound_at'),
  createdAt: tz('created_at').notNull().defaultNow(),
  // Takvim aboneliği için gizli adres parçası; ilk istendiğinde üretilir.
  calendarToken: text('calendar_token').unique(),
  // Pazar akşamı haftalık özet ve isteğe bağlı sabah brifingi.
  weeklyDigest: boolean('weekly_digest').notNull().default(true),
  morningBrief: boolean('morning_brief').notNull().default(false),
  lastDigestAt: tz('last_digest_at'),
  lastBriefAt: tz('last_brief_at'),
  lastWeekPlanAt: tz('last_week_plan_at'),
});

/** Bağlı cihaz (tarayıcı uzantısı, web paneli). Anahtarın yalnızca SHA-256 özeti tutulur. */
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    lastSeenAt: tz('last_seen_at'),
  },
  (t) => [uniqueIndex('devices_token_hash_key').on(t.tokenHash), index('devices_user_idx').on(t.userId)],
);

/** `bağla` komutunun verdiği tek kullanımlık 6 haneli kodlar (özet olarak). */
export const linkCodes = pgTable('link_codes', {
  codeHash: text('code_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: tz('expires_at').notNull(),
});

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceType: sourceTypeEnum('source_type').notNull(),
    sourceUrl: text('source_url'),
    rawText: text('raw_text'),
    mediaPath: text('media_path'),
    title: text('title').notNull(),
    category: categoryEnum('category').notNull(),
    organization: text('organization'),
    deadlineAt: tz('deadline_at'),
    deadlineSource: deadlineSourceEnum('deadline_source'),
    deadlineEvidence: text('deadline_evidence'),
    eventAt: tz('event_at'),
    location: text('location'),
    effortMinutes: integer('effort_minutes'),
    requirements: jsonb('requirements').$type<string[]>().notNull().default([]),
    keyNotes: jsonb('key_notes').$type<string[]>().notNull().default([]),
    nextAction: text('next_action'),
    status: itemStatusEnum('status').notNull().default('open'),
    dedupeHash: text('dedupe_hash'),
    createdAt: tz('created_at').notNull().defaultNow(),
    closedAt: tz('closed_at'),
  },
  (t) => [
    index('items_user_status_idx').on(t.userId, t.status),
    index('items_user_dedupe_idx').on(t.userId, t.dedupeHash),
  ],
);

export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: reminderKindEnum('kind').notNull(),
    sendAt: tz('send_at').notNull(),
    channel: channelEnum('channel').notNull().default('whatsapp'),
    status: reminderStatusEnum('status').notNull().default('scheduled'),
    messageId: text('message_id'),
    sentAt: tz('sent_at'),
    error: text('error'),
    // Gönderim denemesi sayısı ve üzerine alınma anı (SPEC'e ek).
    attempts: integer('attempts').notNull().default(0),
    claimedAt: tz('claimed_at'),
  },
  (t) => [
    index('reminders_due_idx').on(t.status, t.sendAt),
    index('reminders_item_idx').on(t.itemId),
  ],
);

export const preps = pgTable('preps', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  kind: prepKindEnum('kind').notNull(),
  content: text('content').notNull(),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const interactions = pgTable('interactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').references(() => items.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  at: tz('at').notNull().defaultNow(),
});

export const inboundMessages = pgTable(
  'inbound_messages',
  {
    messageId: text('message_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: tz('received_at').notNull().defaultNow(),
    processedAt: tz('processed_at'),
  },
  (t) => [uniqueIndex('inbound_messages_message_id_key').on(t.messageId)],
);

export type User = typeof users.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Reminder = typeof reminders.$inferSelect;
export type InboundMessage = typeof inboundMessages.$inferSelect;
export type Category = Item['category'];
export type SourceType = Item['sourceType'];
export type ItemStatus = Item['status'];
export type ReminderKind = Reminder['kind'];
export type DeadlineSource = NonNullable<Item['deadlineSource']>;
