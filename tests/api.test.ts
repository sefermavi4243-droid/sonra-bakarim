import { describe, expect, it } from 'vitest';
import { PANEL_HEADER, SESSION_COOKIE, createApi } from '../src/api/routes.js';
import { processInbound, route } from '../src/jobs/process.js';
import { TEXT } from '../src/notify/messages.js';
import { type TestEnv, addUser, createEnv, extraction, ist } from './helpers/fakes.js';

const PAGE_TEXT = `Örnek Fintech Veri Analisti Stajyeri arıyor. ${'Ekibimiz veriyle karar veren bir kültüre sahip. '.repeat(10)}
Son başvuru: 24 Ekim 2026. CV ve motivasyon yazısı gönderin.`;

function setup(now = ist('2026-10-20T12:00')) {
  const env = createEnv(now);
  // Kuyruk, gerçekteki gibi istekten sonra çalışır; testte `drain` ile boşaltılır.
  const pending: string[] = [];
  const api = createApi({ app: env.deps, enqueue: (id) => void pending.push(id) });
  const drain = async () => {
    for (const id of pending.splice(0)) {
      const msg = await env.store.getInbound(id);
      if (msg) await processInbound(env.deps, msg);
    }
  };
  return { env, api, drain };
}

/** Telegram kullanıcısı `bağla` der, kodu uzantıya girer; anahtar döner. */
async function linkDevice(env: TestEnv, api: ReturnType<typeof setup>['api'], name = 'Chrome uzantısı') {
  const user = await addUser(env, 'tg:42');
  await route(env.deps, user, { kind: 'text', text: 'bağla' });
  const code = /\*(\d{3}) (\d{3})\*/.exec(env.notifier.lastText())!.slice(1).join('');
  const res = await api.request('/api/link', { method: 'POST', body: JSON.stringify({ code, name }), headers: { 'content-type': 'application/json' } });
  const body = (await res.json()) as { token: string };
  return { user, token: body.token, res };
}

const auth = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra });

describe('bağlama', () => {
  it('bağla kodu tek kullanımlık cihaz anahtarına dönüşür; bota bildirim gider', async () => {
    const { env, api } = setup();
    const { res, token, user } = await linkDevice(env, api);
    expect(res.status).toBe(200);
    expect(token.length).toBeGreaterThan(30);
    expect(env.store.devices).toHaveLength(1);
    expect(env.store.devices[0]!.tokenHash).not.toBe(token); // açık hâli saklanmaz
    expect(env.notifier.lastText()).toContain('Yeni cihaz bağlandı: Chrome uzantısı');

    const me = await api.request('/api/me', { headers: auth(token) });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ channel: 'telegram', weeklyDigest: true });

    // Aynı kod ikinci kez kullanılamaz.
    expect(env.store.linkCodes).toHaveLength(0);
    expect(user.id).toBe(env.store.devices[0]!.userId);
  });

  it('yanlış ya da süresi geçmiş kod reddedilir; 10 hatadan sonra kilitlenir', async () => {
    const { env, api } = setup();
    const user = await addUser(env, 'tg:42');
    await route(env.deps, user, { kind: 'text', text: 'bağla' });
    const code = /\*(\d{3}) (\d{3})\*/.exec(env.notifier.lastText())!.slice(1).join('');
    env.clock.now = ist('2026-10-20T12:11'); // 11 dakika sonra
    const late = await api.request('/api/link', { method: 'POST', body: JSON.stringify({ code }) });
    expect(late.status).toBe(401);
    for (let i = 0; i < 9; i++) await api.request('/api/link', { method: 'POST', body: JSON.stringify({ code: '000000' }) });
    const locked = await api.request('/api/link', { method: 'POST', body: JSON.stringify({ code: '000000' }) });
    expect(locked.status).toBe(429);
  });

  it('anahtarsız istek 401; cihaz kaldırılınca anahtar geçersiz olur', async () => {
    const { env, api } = setup();
    expect((await api.request('/api/items')).status).toBe(401);
    const { token, user } = await linkDevice(env, api);
    await route(env.deps, (await env.store.getUser(user.id))!, { kind: 'button', payload: `devdel:${env.store.devices[0]!.id}` });
    expect(env.notifier.sent.some((s) => s.type === 'text' && s.text === TEXT.deviceRemoved)).toBe(true);
    expect((await api.request('/api/items', { headers: auth(token) })).status).toBe(401);
  });

  it('panel çerezi: değiştirici istek özel başlık olmadan reddedilir (CSRF)', async () => {
    const { env, api } = setup();
    const user = await addUser(env, 'tg:42');
    await route(env.deps, user, { kind: 'text', text: 'bağla' });
    const code = /\*(\d{3}) (\d{3})\*/.exec(env.notifier.lastText())!.slice(1).join('');
    const res = await api.request('/api/link', { method: 'POST', body: JSON.stringify({ code, name: 'Web paneli', cookie: true }) });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    const session = cookie.split(';')[0]!;
    expect((await api.request('/api/items', { headers: { cookie: session } })).status).toBe(200);
    expect((await api.request('/api/me', { method: 'PATCH', body: '{"morningBrief":true}', headers: { cookie: session } })).status).toBe(403);
    const ok = await api.request('/api/me', { method: 'PATCH', body: '{"morningBrief":true}', headers: { cookie: session, [PANEL_HEADER]: '1' } });
    expect(ok.status).toBe(200);
    expect(env.store.users[0]!.morningBrief).toBe(true);
  });
});

describe('kayıtlar API', () => {
  async function withItem() {
    const s = setup();
    const linked = await linkDevice(s.env, s.api);
    const item = await s.env.store.createItem({
      userId: linked.user.id,
      sourceType: 'text',
      title: 'Staj başvurusu',
      category: 'job',
      deadlineAt: ist('2026-10-30T23:59'),
      effortMinutes: 45,
    });
    return { ...s, ...linked, item };
  }

  it('liste, başkasının kaydı görünmez', async () => {
    const { env, api, token } = await withItem();
    const other = await addUser(env, 'tg:99');
    await env.store.createItem({ userId: other.id, sourceType: 'text', title: 'Gizli', category: 'task' });
    const body = (await (await api.request('/api/items', { headers: auth(token) })).json()) as { items: { title: string; snoozeOptions: unknown[] }[] };
    expect(body.items.map((i) => i.title)).toEqual(['Staj başvurusu']);
    expect(body.items[0]!.snoozeOptions).toHaveLength(3);
    const otherId = env.store.items[1]!.id;
    expect((await api.request(`/api/items/${otherId}/done`, { method: 'POST', headers: auth(token) })).status).toBe(404);
  });

  it('Yaptım, yeniden aç, ertele ve tarih değiştir', async () => {
    const { env, api, token, item } = await withItem();
    const done = await api.request(`/api/items/${item.id}/done`, { method: 'POST', headers: auth(token) });
    expect(((await done.json()) as { item: { status: string } }).item.status).toBe('done');
    const reopened = await api.request(`/api/items/${item.id}/reopen`, { method: 'POST', headers: auth(token) });
    expect(((await reopened.json()) as { item: { status: string } }).item.status).toBe('open');
    expect(env.store.reminders.some((r) => r.status === 'scheduled')).toBe(true);

    const snooze = await api.request(`/api/items/${item.id}/snooze`, { method: 'POST', headers: auth(token), body: '{"option":"tomorrow"}' });
    expect(snooze.status).toBe(200);
    expect(env.store.items[0]!.status).toBe('snoozed');

    const bad = await api.request(`/api/items/${item.id}/date`, { method: 'POST', headers: auth(token), body: '{"text":"bilmiyorum"}' });
    expect(bad.status).toBe(422);
    const date = await api.request(`/api/items/${item.id}/date`, { method: 'POST', headers: auth(token), body: '{"text":"perşembe 18:00"}' });
    expect(((await date.json()) as { item: { deadlineAt: string } }).item.deadlineAt).toBe(ist('2026-10-22T18:00').toISOString());
    const iso = await api.request(`/api/items/${item.id}/date`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ iso: '2026-11-02T10:00:00+03:00' }),
    });
    expect(((await iso.json()) as { item: { deadlineSource: string } }).item.deadlineSource).toBe('user');
  });

  it('takvim aboneliği gizli adresle açılır, anahtar istemez', async () => {
    const { api, token } = await withItem();
    const me = (await (await api.request('/api/me', { headers: auth(token) })).json()) as { calendarUrl: string };
    expect(me.calendarUrl).toMatch(/^http:\/\/localhost:3000\/takvim\/[\w-]{20,}\.ics$/);
    const res = await api.request(new URL(me.calendarUrl).pathname);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(await res.text()).toContain('SUMMARY:Son gün: Staj başvurusu');
    expect((await api.request('/takvim/yanlis-adres-yanlis-adres.ics')).status).toBe(404);
  });
});

describe('tarayıcıdan kayıt ve birleşme', () => {
  it('sayfa metniyle kayıt: sunucu sayfayı açmaz, kart Telegram\'a gider', async () => {
    const { env, api, drain } = setup();
    const { token } = await linkDevice(env, api);
    env.llm.responses.push(
      extraction({ deadline: '2026-10-24T23:59:00+03:00', deadline_source: 'explicit', deadline_evidence: 'Son başvuru: 24 Ekim 2026' }),
    );
    const res = await api.request('/api/capture', {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ url: 'https://www.linkedin.com/jobs/view/123?trk=abc', title: 'Veri Analisti', text: PAGE_TEXT }),
    });
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };
    expect(((await (await api.request(`/api/captures/${id}`, { headers: auth(token) })).json()) as { state: string }).state).toBe('pending');
    await drain();

    const status = (await (await api.request(`/api/captures/${id}`, { headers: auth(token) })).json()) as { state: string; item: { deadlineAt: string } };
    expect(status.state).toBe('saved');
    expect(status.item.deadlineAt).toBe(ist('2026-10-24T23:59').toISOString());
    expect(env.store.items[0]).toMatchObject({ sourceType: 'extension', sourceUrl: 'https://linkedin.com/jobs/view/123' });
    const card = env.notifier.last();
    expect(card.type === 'buttons' && card.to).toBe('tg:42');
    expect(card.type === 'buttons' && card.text).toContain('Tarayıcıdan kaydettim: *Veri Analisti Stajyeri*');
    expect(card.type === 'buttons' && card.buttons.map((b) => b.title)).toContain('Takvime ekle');
  });

  it('aynı ilan önce tarayıcıdan sonra telefondan gelince tek kayıt kalır', async () => {
    const { env, api, drain } = setup();
    const { token, user } = await linkDevice(env, api);
    env.llm.responses.push(extraction());
    await api.request('/api/capture', {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ url: 'https://www.linkedin.com/jobs/view/123?utm_source=x', text: PAGE_TEXT }),
    });
    await drain();
    expect(env.store.items).toHaveLength(1);

    await route(env.deps, (await env.store.getUser(user.id))!, { kind: 'text', text: 'https://linkedin.com/jobs/view/123' });
    expect(env.store.items).toHaveLength(1);
    expect(env.notifier.lastText()).toContain('Bunu zaten kaydetmiştin');

    const lookup = (await (await api.request(`/api/lookup?url=${encodeURIComponent('https://linkedin.com/jobs/view/123?trk=1')}`, { headers: auth(token) })).json()) as {
      item: { title: string } | null;
    };
    expect(lookup.item?.title).toBe('Veri Analisti Stajyeri');

    // Tarayıcıdan tekrar: yeni kayıt yok, durum "duplicate".
    const again = await api.request('/api/capture', { method: 'POST', headers: auth(token), body: JSON.stringify({ url: 'https://linkedin.com/jobs/view/123' }) });
    const { id } = (await again.json()) as { id: string };
    await drain();
    expect(((await (await api.request(`/api/captures/${id}`, { headers: auth(token) })).json()) as { state: string }).state).toBe('duplicate');
    expect(env.llm.calls).toHaveLength(1);
  });

  it('seçili metin ayrı kayıt olur; okunamayan sayfa needs_text döner, Telegram\'a hata gitmez', async () => {
    const { env, api, drain } = setup();
    const { token } = await linkDevice(env, api);
    const sentBefore = env.notifier.sent.length;
    const r1 = await api.request('/api/capture', { method: 'POST', headers: auth(token), body: JSON.stringify({ url: 'https://ornek.com/kapali' }) });
    const { id } = (await r1.json()) as { id: string };
    await drain();
    expect(await (await api.request(`/api/captures/${id}`, { headers: auth(token) })).json()).toEqual({ state: 'failed', reason: 'needs_text' });
    expect(env.notifier.sent.length).toBe(sentBefore);

    env.llm.responses.push(extraction({ title: 'Kariyer günü', category: 'event' }));
    await api.request('/api/capture', {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ url: 'https://ornek.com/etkinlikler', selection: 'Kariyer Günü 7 Kasım 10:00, İTÜ' }),
    });
    await drain();
    expect(env.store.items[0]).toMatchObject({ title: 'Kariyer günü', rawText: 'Kariyer Günü 7 Kasım 10:00, İTÜ' });
  });

  it('başkasının kayıt durumunu göremez', async () => {
    const { env, api } = setup();
    const { token } = await linkDevice(env, api);
    env.deps.captures.set('cap:x', 'baska-kullanici', { state: 'pending' });
    expect((await api.request('/api/captures/cap:x', { headers: auth(token) })).status).toBe(404);
  });
});

describe('yeni komutlar', () => {
  it('takvim: abonelik adresi ve .ics dosyası', async () => {
    const { env } = setup();
    const user = await addUser(env, 'tg:42');
    await env.store.createItem({ userId: user.id, sourceType: 'text', title: 'Rapor', category: 'task', deadlineAt: ist('2026-10-27T23:59') });
    await route(env.deps, user, { kind: 'text', text: 'takvim' });
    const [text, file] = env.notifier.sent.slice(-2);
    expect(text!.type === 'text' && text!.text).toMatch(/http:\/\/localhost:3000\/takvim\/.+\.ics/);
    expect(file!.type === 'file' && file!.file.name).toBe('sonra-bakarim.ics');
  });

  it('Takvime ekle düğmesi tek kaydı dosya olarak gönderir', async () => {
    const { env } = setup();
    const user = await addUser(env, 'tg:42');
    const item = await env.store.createItem({ userId: user.id, sourceType: 'text', title: 'Rapor', category: 'task', deadlineAt: ist('2026-10-27T23:59') });
    await route(env.deps, user, { kind: 'button', payload: `cal:${item.id}` });
    const s = env.notifier.last();
    expect(s.type).toBe('file');
    if (s.type === 'file') expect(s.file.data.toString()).toContain('SUMMARY:Son gün: Rapor');
  });

  it('cihazlarım, özet aç/kapat, brifing aç/kapat; Telegram /ozet_kapat', async () => {
    const { env } = setup();
    const user = await addUser(env, 'tg:42');
    await route(env.deps, user, { kind: 'text', text: 'cihazlarım' });
    expect(env.notifier.lastText()).toBe(TEXT.noDevices);
    await route(env.deps, user, { kind: 'text', text: 'ozet kapat' });
    expect(env.store.users[0]!.weeklyDigest).toBe(false);
    await route(env.deps, user, { kind: 'text', text: 'brifing aç' });
    expect(env.store.users[0]!.morningBrief).toBe(true);
    await route(env.deps, user, { kind: 'text', text: 'özet' });
    expect(env.notifier.lastText()).toBe(TEXT.noDigest);
  });

  it('verilerimi sil cihazları ve kodları da siler', async () => {
    const { env, api } = setup();
    const { user } = await linkDevice(env, api);
    await route(env.deps, (await env.store.getUser(user.id))!, { kind: 'text', text: 'bağla' });
    await route(env.deps, (await env.store.getUser(user.id))!, { kind: 'text', text: 'verilerimi sil' });
    await route(env.deps, (await env.store.getUser(user.id))!, { kind: 'button', payload: 'delyes:-' });
    expect(env.store.devices).toHaveLength(0);
    expect(env.store.linkCodes).toHaveLength(0);
  });
});
