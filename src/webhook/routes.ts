import { Hono } from 'hono';
import type { Store } from '../db/store.js';
import type { UserPrefs } from '../rules/time.js';
import { parseWebhook, type RawMessage } from './parse.js';
import { verifySignature } from './signature.js';

export interface WebhookDeps {
  store: Store;
  appSecret: string;
  verifyToken: string;
  defaults: Pick<UserPrefs, 'timezone' | 'quietStart' | 'quietEnd'>;
  /** Yeni kaydedilen mesajı arka planda işlemeye gönderir; beklenmez. */
  enqueue: (messageId: string, userId: string) => void;
  now?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

export function createWebhookApp(deps: WebhookDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());

  // Meta'nın abonelik doğrulaması.
  app.get('/webhook', (c) => {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    const challenge = c.req.query('hub.challenge');
    if (mode === 'subscribe' && token === deps.verifyToken && challenge) return c.text(challenge, 200);
    return c.text('Forbidden', 403);
  });

  app.post('/webhook', async (c) => {
    const raw = await c.req.text();
    if (!verifySignature(raw, c.req.header('x-hub-signature-256'), deps.appSecret)) {
      return c.text('Invalid signature', 401);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.text('Bad Request', 400);
    }

    // Mesajı kaydedip hemen 200 dönüyoruz; asıl iş kuyrukta. Kayıt başarısız olursa
    // 500 döner ve Meta tekrar gönderir; `wa_message_id` tekrarı engeller.
    for (const { message, contactName } of parseWebhook(body)) {
      await acceptMessage({ ...deps, now }, { address: message.from, displayName: contactName, message });
    }
    return c.text('OK', 200);
  });

  app.get('/health', (c) => c.json({ ok: true }));

  return app;
}

export type AcceptDeps = Pick<WebhookDeps, 'store' | 'defaults' | 'enqueue' | 'log'> & { now: () => Date };

/**
 * Kanaldan bağımsız giriş: kullanıcıyı bulur/oluşturur, mesajı bir kez kaydeder ve
 * kuyruğa gönderir. Aynı mesaj kimliği ikinci kez gelirse atlanır.
 */
export async function acceptMessage(
  deps: AcceptDeps,
  e: { address: string; displayName: string | null; message: RawMessage },
): Promise<void> {
  const user = await deps.store.touchUser({ address: e.address, displayName: e.displayName, ...deps.defaults }, deps.now());
  const isNew = await deps.store.insertInbound({
    messageId: e.message.id,
    userId: user.id,
    type: e.message.type,
    payload: e.message as Record<string, unknown>,
  });
  if (isNew) deps.enqueue(e.message.id, user.id);
  else deps.log?.('tekrar gelen mesaj atlandı', { id: e.message.id });
}
