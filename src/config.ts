import { z } from 'zod';

const required = z.string().trim().min(1);

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

const optional = required.optional();

/** DATABASE_URL boşsa gömülü Postgres (PGlite) bu klasörde açılır. */
export const DEFAULT_DATABASE_URL = './data/pg';
/** Supabase yoksa medya bu klasöre yazılır. */
export const DEFAULT_MEDIA_DIR = './data/media';

const WHATSAPP_KEYS = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_GRAPH_VERSION',
] as const;

const envSchema = z
  .object({
    // WhatsApp ve Telegram ayrı ayrı isteğe bağlı; en az biri dolu olmalı.
    WHATSAPP_ACCESS_TOKEN: optional,
    WHATSAPP_PHONE_NUMBER_ID: optional,
    WHATSAPP_BUSINESS_ACCOUNT_ID: optional,
    WHATSAPP_APP_SECRET: optional,
    WHATSAPP_VERIFY_TOKEN: optional,
    WHATSAPP_GRAPH_VERSION: required.regex(/^v\d+\.\d+$/, 'v23.0 gibi olmalı').optional(),

    TELEGRAM_BOT_TOKEN: required.regex(/^\d+:[\w-]+$/, "@BotFather'ın verdiği 123456:ABC… biçiminde olmalı").optional(),

    DATABASE_URL: required.default(DEFAULT_DATABASE_URL),
    SUPABASE_URL: required.url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: optional,
    SUPABASE_BUCKET: required.default('media'),
    MEDIA_DIR: required.default(DEFAULT_MEDIA_DIR),

    LLM_BASE_URL: required.url().default('http://localhost:11434/v1'),
    LLM_MODEL: required,
    LLM_API_KEY: optional,

    // İsteğe bağlı: boşsa sesli notlar için yazılı mesaj istenir.
    TRANSCRIBE_BASE_URL: required.url().optional(),
    TRANSCRIBE_API_KEY: optional,
    TRANSCRIBE_MODEL: required.default('whisper-1'),

    APP_TIMEZONE: required.default('Europe/Istanbul'),
    QUIET_HOURS: required
      .default('22:00-08:00')
      .refine((v) => {
        const [a, b] = v.split('-');
        return a !== undefined && b !== undefined && hhmm.test(a) && hhmm.test(b);
      }, 'SS:DD-SS:DD biçiminde olmalı (ör. 22:00-08:00)'),
    PORT: z.coerce.number().int().positive().default(3000),
    /** Sunucunun dinlediği adres. Varsayılan yalnızca bu bilgisayar; tünel de buraya bağlanır. */
    HOST: required.default('127.0.0.1'),
    /** Panelin ve takvim aboneliğinin dışarıdan görünen adresi; boşsa http://localhost:PORT. */
    APP_URL: required.url().optional(),
    /** Yalnızca 127.0.0.1'i dinleyen yönetim ucu (rapor). */
    ADMIN_PORT: z.coerce.number().int().positive().default(3001),
  })
  .superRefine((env, ctx) => {
    const waSet = WHATSAPP_KEYS.filter((k) => env[k] !== undefined);
    if (waSet.length > 0 && waSet.length < WHATSAPP_KEYS.length) {
      for (const k of WHATSAPP_KEYS) if (env[k] === undefined) ctx.addIssue({ code: 'custom', path: [k], message: 'eksik' });
    }
    if (waSet.length === 0 && !env.TELEGRAM_BOT_TOKEN) {
      ctx.addIssue({ code: 'custom', path: ['TELEGRAM_BOT_TOKEN'], message: 'eksik' });
    }
    if (env.SUPABASE_URL && !env.SUPABASE_SERVICE_ROLE_KEY) {
      ctx.addIssue({ code: 'custom', path: ['SUPABASE_SERVICE_ROLE_KEY'], message: 'eksik' });
    }
  });

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  appSecret: string;
  verifyToken: string;
  graphVersion: string;
}

export type Config = z.infer<typeof envSchema> & { quietStart: string; quietEnd: string; whatsapp: WhatsAppConfig | null };

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Boş dizeyi "yok" say; .env.example'dan kopyalanan boş satırlar varsayılanı ezmesin.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const missing: string[] = [];
    const invalid: string[] = [];
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      if (cleaned[key] === undefined) missing.push(key);
      else invalid.push(`${key}: ${issue.message}`);
    }
    const lines = ['Ortam değişkenleri eksik ya da hatalı (.env dosyasını kontrol et):'];
    if (missing.length) lines.push(`  Eksik: ${[...new Set(missing)].join(', ')}`);
    if (invalid.length) lines.push(...invalid.map((l) => `  Hatalı: ${l}`));
    throw new ConfigError(lines.join('\n'));
  }
  const [quietStart, quietEnd] = parsed.data.QUIET_HOURS.split('-') as [string, string];
  const d = parsed.data;
  const whatsapp = d.WHATSAPP_ACCESS_TOKEN
    ? {
        accessToken: d.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: d.WHATSAPP_PHONE_NUMBER_ID!,
        businessAccountId: d.WHATSAPP_BUSINESS_ACCOUNT_ID!,
        appSecret: d.WHATSAPP_APP_SECRET!,
        verifyToken: d.WHATSAPP_VERIFY_TOKEN!,
        graphVersion: d.WHATSAPP_GRAPH_VERSION!,
      }
    : null;
  return { ...d, quietStart, quietEnd, whatsapp };
}
