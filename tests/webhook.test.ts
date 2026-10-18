import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { sign, verifySignature } from '../src/webhook/signature.js';
import { createWebhookApp } from '../src/webhook/routes.js';
import { MemoryStore } from './helpers/memoryStore.js';

const SECRET = 'app-secret';

function setup() {
  const store = new MemoryStore();
  const queued: string[] = [];
  const app = createWebhookApp({
    store,
    appSecret: SECRET,
    verifyToken: 'dogrula',
    defaults: { timezone: 'Europe/Istanbul', quietStart: '22:00', quietEnd: '08:00' },
    enqueue: (id) => queued.push(id),
  });
  return { app, store, queued };
}

function textMessage(id: string, body = 'merhaba') {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ wa_id: '905551112233', profile: { name: 'Ayşe' } }],
              messages: [{ from: '905551112233', id, timestamp: '1760950000', type: 'text', text: { body } }],
            },
          },
        ],
      },
    ],
  });
}

function post(app: ReturnType<typeof setup>['app'], body: string, signature: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers['x-hub-signature-256'] = signature;
  return app.request('/webhook', { method: 'POST', body, headers });
}

describe('GET /webhook', () => {
  it('doğru token ile hub.challenge döner', async () => {
    const { app } = setup();
    const res = await app.request('/webhook?hub.mode=subscribe&hub.verify_token=dogrula&hub.challenge=12345');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('12345');
  });

  it('yanlış token 403', async () => {
    const { app } = setup();
    const res = await app.request('/webhook?hub.mode=subscribe&hub.verify_token=yanlis&hub.challenge=1');
    expect(res.status).toBe(403);
  });
});

describe('POST /webhook', () => {
  it('geçersiz imzalı istek 401 alır ve hiçbir şey yazılmaz', async () => {
    const { app, store, queued } = setup();
    const body = textMessage('wamid.A');
    expect((await post(app, body, sign(body, 'baska-secret'))).status).toBe(401);
    expect((await post(app, body, null)).status).toBe(401);
    expect((await post(app, body, 'sha256=abc')).status).toBe(401);
    // Gövde değiştirilmişse eski imza tutmaz.
    expect((await post(app, textMessage('wamid.A', 'değişti'), sign(body, SECRET))).status).toBe(401);
    expect(store.inbound).toHaveLength(0);
    expect(store.users).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it('geçerli istek: kullanıcı oluşur, mesaj yazılır, hemen 200', async () => {
    const { app, store, queued } = setup();
    const body = textMessage('wamid.A');
    const res = await post(app, body, sign(body, SECRET));
    expect(res.status).toBe(200);
    expect(store.users).toHaveLength(1);
    expect(store.users[0]).toMatchObject({ address: '905551112233', displayName: 'Ayşe' });
    expect(store.users[0]!.lastInboundAt).toBeInstanceOf(Date);
    expect(store.inbound).toHaveLength(1);
    expect(queued).toEqual(['wamid.A']);
  });

  it('aynı mesaj iki kez gelince tek kayıt oluşur ve bir kez işlenir', async () => {
    const { app, store, queued } = setup();
    const body = textMessage('wamid.A');
    expect((await post(app, body, sign(body, SECRET))).status).toBe(200);
    expect((await post(app, body, sign(body, SECRET))).status).toBe(200);
    expect(store.inbound).toHaveLength(1);
    expect(store.users).toHaveLength(1);
    expect(queued).toEqual(['wamid.A']);
  });

  it('durum bildirimleri (statuses) mesaj sayılmaz', async () => {
    const { app, store } = setup();
    const body = JSON.stringify({
      entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }],
    });
    expect((await post(app, body, sign(body, SECRET))).status).toBe(200);
    expect(store.inbound).toHaveLength(0);
  });
});

describe('verifySignature', () => {
  it('Meta biçimindeki imzayı doğrular', () => {
    const body = '{"a":1}';
    expect(verifySignature(body, sign(body, SECRET), SECRET)).toBe(true);
    expect(verifySignature(body, sign(body, SECRET).toUpperCase(), SECRET)).toBe(false);
  });
});

describe('loadConfig', () => {
  it('eksik değişkenin adını söyler', () => {
    const message = (env: NodeJS.ProcessEnv) => {
      try {
        loadConfig(env);
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        return (err as Error).message;
      }
      throw new Error('hata bekleniyordu');
    };
    const noModel = message({ WHATSAPP_ACCESS_TOKEN: '' });
    expect(noModel).toContain('Eksik: LLM_MODEL');
    expect(noModel).not.toContain('DATABASE_URL'); // varsayılanı var (yerel PGlite)
    expect(noModel).not.toContain('APP_TIMEZONE');

    expect(message({ LLM_MODEL: 'm' })).toContain('TELEGRAM_BOT_TOKEN'); // hiç kanal yok

    const partialWa = message({ LLM_MODEL: 'm', WHATSAPP_ACCESS_TOKEN: 't' });
    expect(partialWa).toContain('WHATSAPP_APP_SECRET');
    expect(partialWa).not.toContain('TELEGRAM_BOT_TOKEN');

    expect(message({ LLM_MODEL: 'm', TELEGRAM_BOT_TOKEN: 'abc' })).toContain('Hatalı: TELEGRAM_BOT_TOKEN');
  });

  it('yalnızca Telegram ile ve Supabase olmadan açılır', () => {
    const cfg = loadConfig({ LLM_MODEL: 'gemma3:12b', TELEGRAM_BOT_TOKEN: '123456:ABC-def_1' });
    expect(cfg.whatsapp).toBeNull();
    expect(cfg.DATABASE_URL).toBe('./data/pg');
    expect(cfg.SUPABASE_URL).toBeUndefined();
  });

  it('tam ortamla açılır ve sessiz saatleri ayırır', () => {
    const env = {
      WHATSAPP_ACCESS_TOKEN: 't',
      WHATSAPP_PHONE_NUMBER_ID: '1',
      WHATSAPP_BUSINESS_ACCOUNT_ID: '2',
      WHATSAPP_APP_SECRET: 's',
      WHATSAPP_VERIFY_TOKEN: 'v',
      WHATSAPP_GRAPH_VERSION: 'v23.0',
      DATABASE_URL: 'postgres://x',
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      LLM_MODEL: 'gemma3:12b',
      QUIET_HOURS: '23:00-07:30',
    };
    const cfg = loadConfig(env);
    expect(cfg).toMatchObject({ quietStart: '23:00', quietEnd: '07:30', PORT: 3000, APP_TIMEZONE: 'Europe/Istanbul', LLM_BASE_URL: 'http://localhost:11434/v1' });
    expect(cfg.TRANSCRIBE_BASE_URL).toBeUndefined();
    expect(cfg.whatsapp).toMatchObject({ appSecret: 's', graphVersion: 'v23.0' });
    expect(() => loadConfig({ ...env, QUIET_HOURS: '22-08' })).toThrow(/QUIET_HOURS/);
  });
});
