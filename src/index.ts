import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApi } from './api/routes.js';
import { ConfigError, loadConfig } from './config.js';
import { createDb, createDrizzleStore } from './db/drizzleStore.js';
import { createLlmClient } from './extract/llm.js';
import { pdfPageImages } from './ingest/pdf.js';
import { createLocalStorage, createSupabaseStorage } from './ingest/storage.js';
import { createTranscriber } from './ingest/transcribe.js';
import { CaptureLog } from './jobs/capture.js';
import type { AppDeps } from './jobs/deps.js';
import { processInbound } from './jobs/process.js';
import { gateReport } from './jobs/report.js';
import { PerUserQueue } from './jobs/queue.js';
import { startScheduler } from './jobs/scheduler.js';
import { createChannelRouter } from './notify/notifier.js';
import { TG_PREFIX, TelegramClient, startTelegramPolling } from './notify/telegram.js';
import { WhatsAppClient } from './notify/whatsapp.js';
import { acceptMessage, createWebhookApp } from './webhook/routes.js';

function log(msg: string, extra?: unknown) {
  console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...(extra ? { extra } : {}) }));
}

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const { db } = createDb(config.DATABASE_URL);
const store = createDrizzleStore(db);

const whatsapp = config.whatsapp
  ? new WhatsAppClient({
      accessToken: config.whatsapp.accessToken,
      phoneNumberId: config.whatsapp.phoneNumberId,
      graphVersion: config.whatsapp.graphVersion,
    })
  : null;
const telegram = config.TELEGRAM_BOT_TOKEN ? new TelegramClient({ token: config.TELEGRAM_BOT_TOKEN }) : null;

const isTelegram = (id: string) => id.startsWith(TG_PREFIX);

const deps: AppDeps = {
  store,
  notifier: createChannelRouter({ whatsapp, telegram }),
  media: {
    downloadMedia: (id) => {
      const source = isTelegram(id) ? telegram : whatsapp;
      if (!source) throw new Error('Medya kanalı yapılandırılmadı');
      return source.downloadMedia(id);
    },
  },
  markRead: async (id) => {
    if (isTelegram(id)) await telegram?.typing(id);
    else await whatsapp?.markReadTyping(id);
  },
  storage:
    config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY
      ? createSupabaseStorage(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, config.SUPABASE_BUCKET)
      : createLocalStorage(config.MEDIA_DIR),
  transcriber: config.TRANSCRIBE_BASE_URL
    ? createTranscriber({ apiKey: config.TRANSCRIBE_API_KEY, baseUrl: config.TRANSCRIBE_BASE_URL, model: config.TRANSCRIBE_MODEL })
    : null,
  llm: createLlmClient({ baseUrl: config.LLM_BASE_URL, apiKey: config.LLM_API_KEY }),
  extractModel: config.LLM_MODEL,
  renderPdf: (pdf) => pdfPageImages(pdf),
  appUrl: config.APP_URL ?? `http://localhost:${config.PORT}`,
  captures: new CaptureLog(),
  now: () => new Date(),
  log,
};

const queue = new PerUserQueue((err) => log('kuyruk hatası', { err: String(err) }));

function enqueue(messageId: string, userId: string) {
  void queue.push(userId, async () => {
    const msg = await store.getInbound(messageId);
    if (msg && !msg.processedAt) await processInbound(deps, msg);
  });
}

const defaults = { timezone: config.APP_TIMEZONE, quietStart: config.quietStart, quietEnd: config.quietEnd };

const app = config.whatsapp
  ? createWebhookApp({
      store,
      appSecret: config.whatsapp.appSecret,
      verifyToken: config.whatsapp.verifyToken,
      defaults,
      enqueue,
      log,
    })
  : new Hono().get('/health', (c) => c.json({ ok: true }));

// Uzantı ve web paneli için API, takvim aboneliği ve panelin kendisi.
app.route('/', createApi({ app: deps, enqueue }));
app.use('/*', serveStatic({ root: './web' }));

// Süreç kapanırken yarım kalan mesajları yeniden kuyruğa al.
for (const msg of await store.listUnprocessedInbound(100)) enqueue(msg.messageId, msg.userId);

if (telegram) {
  const me = await telegram.call<{ username: string }>('getMe');
  startTelegramPolling({
    client: telegram,
    accept: (e) => acceptMessage({ store, defaults, enqueue, log, now: () => new Date() }, e),
    log,
  });
  log('telegram botu dinliyor', { bot: `@${me.username}` });
}

startScheduler(deps);

// Yönetim ucu yalnızca bu makineden erişilir; tünel ya da webhook üzerinden açılmaz.
const admin = new Hono().get('/rapor', async (c) =>
  c.text(await gateReport(db, Number(c.req.query('limit') ?? 10) || 10, config.APP_TIMEZONE)),
);
serve({ fetch: admin.fetch, port: config.ADMIN_PORT, hostname: '127.0.0.1' });

// Modeli ilk mesajdan önce belleğe yükle; ilk kayıt beklemesin.
void deps.llm
  .chat({ model: config.LLM_MODEL, messages: [{ role: 'user', content: 'merhaba' }], max_tokens: 1 })
  .then(() => log('model hazır', { model: config.LLM_MODEL }))
  .catch((err) => log('model yüklenemedi; Ollama açık mı?', { err: String(err) }));
serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) =>
  log('sunucu açıldı', {
    port: info.port,
    panel: deps.appUrl,
    kanallar: [whatsapp && 'whatsapp', telegram && 'telegram'].filter(Boolean),
    veritabani: /^postgres/.test(config.DATABASE_URL) ? 'postgres' : 'yerel',
  }),
);
