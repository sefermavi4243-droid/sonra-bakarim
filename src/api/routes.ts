import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { buildCalendar, icsFileName } from '../calendar/ics.js';
import type { Block, Device, Item, User } from '../db/schema.js';
import { canonicalUrl } from '../ingest/link.js';
import {
  finishItem,
  isClosed,
  moveToNextWeek,
  reopenItem,
  setDeadline,
  setDeadlineFromText,
  snoozeItem,
  snoozeOptions,
  type DateChange,
} from '../jobs/actions.js';
import { calendarUrl } from '../jobs/calendar.js';
import { captureSchema, linkDedupeHash } from '../jobs/capture.js';
import type { AppDeps } from '../jobs/deps.js';
import { buildUserDigest } from '../jobs/digest.js';
import { authenticate, ensureCalendarToken, redeemLinkCode } from '../jobs/link.js';
import { CAPTURE_TYPE } from '../jobs/process.js';
import { suggestBlocks } from '../rules/blocks.js';
import { SNOOZE_LABELS, type SnoozeOption } from '../rules/schedule.js';
import { prefsOf } from '../jobs/deps.js';
import { createDeviceToken } from '../jobs/link.js';

export const SESSION_COOKIE = 'sb_oturum';
/** Çerezle gelen değiştirici isteklerde aranan başlık; başka siteden gönderilemez (CSRF). */
export const PANEL_HEADER = 'x-rafta';

export interface ApiDeps {
  app: AppDeps;
  /** Kayıt isteğini kullanıcının sırasına ekler (processInbound işler). */
  enqueue: (messageId: string, userId: string) => void;
}

type Env = { Variables: { user: User; device: Device } };

/** Kayıtların API biçimi; tarihler ISO. */
export function itemJson(item: Item, extra: { snoozeOptions?: SnoozeOption[] } = {}) {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    organization: item.organization,
    deadlineAt: item.deadlineAt?.toISOString() ?? null,
    deadlineSource: item.deadlineSource,
    deadlineEvidence: item.deadlineEvidence,
    eventAt: item.eventAt?.toISOString() ?? null,
    location: item.location,
    effortMinutes: item.effortMinutes,
    requirements: item.requirements,
    keyNotes: item.keyNotes,
    nextAction: item.nextAction,
    status: item.status,
    sourceType: item.sourceType,
    sourceUrl: item.sourceUrl,
    createdAt: item.createdAt.toISOString(),
    closedAt: item.closedAt?.toISOString() ?? null,
    ...(extra.snoozeOptions ? { snoozeOptions: extra.snoozeOptions.map((o) => ({ id: o, label: SNOOZE_LABELS[o] })) } : {}),
  };
}

export function blockJson(b: Block) {
  return { id: b.id, itemId: b.itemId, startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString() };
}

const STATUS_SETS = {
  open: ['open', 'snoozed'],
  closed: ['done', 'dropped', 'expired'],
  all: ['open', 'snoozed', 'done', 'dropped', 'expired'],
} as const;

/** Kod denemelerini sınırlar: 6 hane kaba kuvvetle denenmesin. */
class AttemptLimiter {
  private failures: number[] = [];
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  blocked(now: number): boolean {
    this.failures = this.failures.filter((t) => now - t < this.windowMs);
    return this.failures.length >= this.max;
  }
  fail(now: number): void {
    this.failures.push(now);
  }
}

function dateChangeResponse(c: Context, result: DateChange, snooze: SnoozeOption[] = []) {
  switch (result.kind) {
    case 'ok':
      return c.json({ item: itemJson(result.item, { snoozeOptions: snooze }), reminders: result.reminders });
    case 'ambiguous':
      return c.json({ error: 'ambiguous', message: result.question }, 422);
    case 'not_understood':
      return c.json({ error: 'not_understood', message: 'Tarihi anlayamadım. Örneğin "perşembe 18:00" ya da "24 Ekim".' }, 422);
    case 'past':
      return c.json({ error: 'past', message: 'Bu tarih geçmişte kalıyor.' }, 422);
  }
}

export function createApi(deps: ApiDeps): Hono<Env> {
  const { app: d } = deps;
  const api = new Hono<Env>();
  const limiter = new AttemptLimiter(10, 10 * 60_000);

  // --- Bağlama: 6 haneli kodu cihaz anahtarıyla takas eder -------------------
  api.post('/api/link', async (c) => {
    const now = d.now();
    if (limiter.blocked(+now)) return c.json({ error: 'too_many', message: 'Çok fazla hatalı deneme. 10 dakika sonra tekrar dene.' }, 429);
    const body = z
      .object({ code: z.string().max(20), name: z.string().max(60).optional(), cookie: z.boolean().optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);
    const result = await redeemLinkCode(d.store, body.data.code, body.data.name ?? 'Cihaz', now);
    if (!result) {
      limiter.fail(+now);
      return c.json({ error: 'invalid_code', message: 'Kod geçersiz ya da süresi dolmuş. Bota "bağla" yazıp yeni kod al.' }, 401);
    }
    d.log('cihaz bağlandı', { userId: result.user.id, device: result.device.name });
    await d.notifier
      .sendText(result.user.address, `Yeni cihaz bağlandı: ${result.device.name}. Sen değilsen "cihazlarım" yazıp kaldır.`)
      .catch(() => undefined);
    if (body.data.cookie) {
      setCookie(c, SESSION_COOKIE, result.token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 365 * 24 * 3600 });
      return c.json({ ok: true, name: result.user.displayName });
    }
    return c.json({ token: result.token, name: result.user.displayName });
  });

  // --- Takvim aboneliği: adresteki gizli parça yeterli ------------------------
  api.get('/takvim/:file', async (c) => {
    const token = c.req.param('file').replace(/\.ics$/, '');
    const user = token.length >= 20 ? await d.store.findUserByCalendarToken(token) : null;
    if (!user) return c.text('Bulunamadı', 404);
    const items = await d.store.listItems(user.id, ['open', 'snoozed'], 500);
    const blocks = await d.store.listBlocks(user.id);
    return c.body(buildCalendar(items, user.timezone, d.now(), 'Rafta', blocks), 200, {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'no-store',
    });
  });

  // --- Kimlik doğrulama -------------------------------------------------------
  api.use('/api/*', async (c, next) => {
    const header = c.req.header('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const cookie = getCookie(c, SESSION_COOKIE);
    const token = bearer ?? cookie;
    const auth = token ? await authenticate(d.store, token, d.now()) : null;
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    if (!bearer && c.req.method !== 'GET' && c.req.header(PANEL_HEADER) !== '1') return c.json({ error: 'forbidden' }, 403);
    c.set('user', auth.user);
    c.set('device', auth.device);
    await next();
  });

  api.post('/api/logout', async (c) => {
    await d.store.deleteDevice(c.var.user.id, c.var.device.id);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  api.get('/api/me', async (c) => {
    const user = c.var.user;
    const token = await ensureCalendarToken(d.store, user);
    const devices = await d.store.listDevices(user.id);
    return c.json({
      name: user.displayName,
      timezone: user.timezone,
      channel: user.address.startsWith('tg:') ? 'telegram' : 'whatsapp',
      calendarUrl: calendarUrl(d, token),
      weeklyDigest: user.weeklyDigest,
      morningBrief: user.morningBrief,
      quietHours: `${user.quietStart}-${user.quietEnd}`,
      device: { id: c.var.device.id, name: c.var.device.name },
      devices: devices.map((x) => ({ id: x.id, name: x.name, lastSeenAt: x.lastSeenAt?.toISOString() ?? null, current: x.id === c.var.device.id })),
    });
  });

  api.patch('/api/me', async (c) => {
    const body = z
      .object({ weeklyDigest: z.boolean().optional(), morningBrief: z.boolean().optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);
    await d.store.updateUser(c.var.user.id, body.data);
    return c.json({ ok: true });
  });

  api.delete('/api/devices/:id', async (c) => {
    const ok = await d.store.deleteDevice(c.var.user.id, c.req.param('id'));
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });

  api.get('/api/digest', async (c) => c.json({ text: await buildUserDigest(d, c.var.user) }));

  // --- Kayıtlar ---------------------------------------------------------------
  api.get('/api/items', async (c) => {
    const key = (c.req.query('status') ?? 'open') as keyof typeof STATUS_SETS;
    const statuses = STATUS_SETS[key] ?? STATUS_SETS.open;
    const items = await d.store.listItems(c.var.user.id, [...statuses], 1000);
    return c.json({ items: items.map((i) => itemJson(i, { snoozeOptions: isClosed(i) ? [] : snoozeOptions(d, c.var.user, i) })) });
  });

  /** Kullanıcıya ait kaydı bulur; yoksa null (başkasının kaydı da "yok" sayılır). */
  async function ownItem(c: Context<Env>): Promise<Item | null> {
    const item = await d.store.getItem(c.req.param('id') ?? '');
    return item && item.userId === c.var.user.id ? item : null;
  }

  api.get('/api/items/:id', async (c) => {
    const item = await ownItem(c);
    if (!item) return c.json({ error: 'not_found' }, 404);
    return c.json({ item: itemJson(item, { snoozeOptions: isClosed(item) ? [] : snoozeOptions(d, c.var.user, item) }) });
  });

  api.post('/api/items/:id/:action{done|drop|reopen}', async (c) => {
    const item = await ownItem(c);
    if (!item) return c.json({ error: 'not_found' }, 404);
    const action = c.req.param('action');
    const updated =
      action === 'reopen'
        ? await reopenItem(d, c.var.user, item)
        : isClosed(item)
          ? item
          : await finishItem(d, c.var.user, item, action === 'done' ? 'done' : 'dropped');
    return c.json({ item: itemJson(updated!, { snoozeOptions: isClosed(updated!) ? [] : snoozeOptions(d, c.var.user, updated!) }) });
  });

  api.post('/api/items/:id/snooze', async (c) => {
    const item = await ownItem(c);
    if (!item) return c.json({ error: 'not_found' }, 404);
    const body = z.object({ option: z.enum(['3h', 'tomorrow', 'weekend']) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);
    if (isClosed(item)) return c.json({ error: 'closed', message: 'Bu kayıt kapalı.' }, 409);
    const at = await snoozeItem(d, c.var.user, item, body.data.option);
    if (!at) return c.json({ error: 'too_late', message: 'Son tarihe çok az kaldı, bu kadar ertelenemez.' }, 422);
    const updated = (await d.store.getItem(item.id))!;
    return c.json({ item: itemJson(updated, { snoozeOptions: snoozeOptions(d, c.var.user, updated) }), remindAt: at.toISOString() });
  });

  api.post('/api/items/:id/date', async (c) => {
    const item = await ownItem(c);
    if (!item) return c.json({ error: 'not_found' }, 404);
    const body = z
      .object({ text: z.string().trim().min(1).max(80).optional(), iso: z.string().datetime({ offset: true }).optional() })
      .refine((b) => b.text || b.iso)
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);
    const result = body.data.iso
      ? await setDeadline(d, c.var.user, item, new Date(body.data.iso), 'Panelden seçildi')
      : await setDeadlineFromText(d, c.var.user, item, body.data.text!);
    const snooze = result.kind === 'ok' ? snoozeOptions(d, c.var.user, result.item) : [];
    return dateChangeResponse(c, result, snooze);
  });

  api.post('/api/items/:id/next-week', async (c) => {
    const item = await ownItem(c);
    if (!item) return c.json({ error: 'not_found' }, 404);
    const result = await moveToNextWeek(d, c.var.user, item);
    return dateChangeResponse(c, result, result.kind === 'ok' ? snoozeOptions(d, c.var.user, result.item) : []);
  });

  api.patch('/api/items/:id', async (c) => {
    const item = await ownItem(c);
    if (!item) return c.json({ error: 'not_found' }, 404);
    const body = z.object({ title: z.string().trim().min(1).max(200) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);
    const updated = await d.store.updateItem(item.id, { title: body.data.title });
    return c.json({ item: itemJson(updated!) });
  });

  api.get('/api/items/:id/ics', async (c) => {
    const item = await ownItem(c);
    if (!item) return c.json({ error: 'not_found' }, 404);
    return c.body(buildCalendar([item], c.var.user.timezone, d.now(), item.title), 200, {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${icsFileName(item.title)}"`,
    });
  });

  api.get('/api/calendar.ics', async (c) => {
    const items = await d.store.listItems(c.var.user.id, ['open', 'snoozed'], 500);
    const blocks = await d.store.listBlocks(c.var.user.id);
    return c.body(buildCalendar(items, c.var.user.timezone, d.now(), 'Rafta', blocks), 200, {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="rafta.ics"',
    });
  });

  // --- Takvim: hatırlatmalar ve çalışma blokları ---------------------------------
  api.get('/api/reminders', async (c) => {
    const list = await d.store.listScheduledReminders(c.var.user.id);
    return c.json({ reminders: list.map((r) => ({ id: r.id, itemId: r.itemId, kind: r.kind, sendAt: r.sendAt.toISOString() })) });
  });

  api.get('/api/blocks', async (c) => {
    const blocks = await d.store.listBlocks(c.var.user.id);
    return c.json({ blocks: blocks.map(blockJson) });
  });

  api.get('/api/blocks/suggestions', async (c) => {
    const user = c.var.user;
    const [items, blocks] = await Promise.all([d.store.listItems(user.id, ['open', 'snoozed'], 500), d.store.listBlocks(user.id)]);
    const suggestions = suggestBlocks(items, blocks, d.now(), prefsOf(user));
    return c.json({ suggestions: suggestions.map((s) => ({ itemId: s.itemId, startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString() })) });
  });

  const blockBody = z
    .object({ startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }) })
    .refine((b) => new Date(b.endAt) > new Date(b.startAt), 'Bitiş başlangıçtan sonra olmalı')
    .refine((b) => +new Date(b.endAt) - +new Date(b.startAt) <= 12 * 3600_000, 'Blok en fazla 12 saat');

  api.post('/api/blocks', async (c) => {
    const raw = await c.req.json().catch(() => null);
    const body = blockBody.and(z.object({ itemId: z.string().uuid() })).safeParse(raw);
    if (!body.success) return c.json({ error: 'bad_request' }, 400);
    const item = await d.store.getItem(body.data.itemId);
    if (!item || item.userId !== c.var.user.id) return c.json({ error: 'not_found' }, 404);
    const block = await d.store.createBlock({
      userId: c.var.user.id,
      itemId: item.id,
      startAt: new Date(body.data.startAt),
      endAt: new Date(body.data.endAt),
    });
    await d.store.insertInteraction(c.var.user.id, item.id, 'block', d.now());
    return c.json({ block: blockJson(block) }, 201);
  });

  api.patch('/api/blocks/:id', async (c) => {
    const body = blockBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);
    const block = await d.store.updateBlock(c.var.user.id, c.req.param('id'), {
      startAt: new Date(body.data.startAt),
      endAt: new Date(body.data.endAt),
    });
    return block ? c.json({ block: blockJson(block) }) : c.json({ error: 'not_found' }, 404);
  });

  api.delete('/api/blocks/:id', async (c) => {
    const ok = await d.store.deleteBlock(c.var.user.id, c.req.param('id'));
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });

  /** Telefon kısayolu (HTTP Shortcuts) için yeni cihaz anahtarı; yalnızca bir kez gösterilir. */
  api.post('/api/devices', async (c) => {
    const body = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);
    const { token, device } = await createDeviceToken(d.store, c.var.user, body.data.name, d.now());
    return c.json({ token, device: { id: device.id, name: device.name } }, 201);
  });

  // --- Tarayıcıdan kayıt --------------------------------------------------------
  api.post('/api/capture', async (c) => {
    const body = captureSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request', message: 'Kaydedilecek bir şey yok.' }, 400);
    const id = `cap:${randomUUID()}`;
    const user = c.var.user;
    d.captures.set(id, user.id, { state: 'pending' });
    await d.store.insertInbound({ messageId: id, userId: user.id, type: CAPTURE_TYPE, payload: body.data });
    deps.enqueue(id, user.id);
    return c.json({ id }, 202);
  });

  api.get('/api/captures/:id', async (c) => {
    const status = d.captures.get(c.req.param('id'), c.var.user.id);
    if (!status) return c.json({ error: 'not_found' }, 404);
    if (status.state === 'saved' || status.state === 'duplicate') return c.json({ state: status.state, item: itemJson(status.item) });
    return c.json(status);
  });

  /** Uzantı, açılan sayfanın daha önce kaydedilip kaydedilmediğini sorar. */
  api.get('/api/lookup', async (c) => {
    const url = c.req.query('url');
    if (!url) return c.json({ item: null });
    let canonical: string;
    try {
      canonical = canonicalUrl(url);
    } catch {
      return c.json({ item: null });
    }
    const item = await d.store.findOpenItemByDedupe(c.var.user.id, linkDedupeHash(canonical));
    return c.json({ item: item ? itemJson(item) : null });
  });

  return api;
}
