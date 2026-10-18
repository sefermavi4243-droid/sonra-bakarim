import { describe, expect, it } from 'vitest';
import { createApi } from '../src/api/routes.js';
import { buildCalendar } from '../src/calendar/ics.js';
import type { Block, Item } from '../src/db/schema.js';
import { route } from '../src/jobs/process.js';
import { suggestBlocks } from '../src/rules/blocks.js';
import { ZONE, addUser, createEnv, ist, show } from './helpers/fakes.js';

const prefs = { timezone: ZONE, quietStart: '22:00', quietEnd: '08:00', preferredHour: 20 };
const now = ist('2026-10-20T12:00'); // salı

let n = 0;
function item(patch: Partial<Item>): Item {
  n++;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
    userId: 'u',
    sourceType: 'text',
    sourceUrl: null,
    rawText: null,
    mediaPath: null,
    title: `İş ${n}`,
    category: 'task',
    organization: null,
    deadlineAt: ist('2026-10-24T23:59'),
    deadlineSource: 'explicit',
    deadlineEvidence: null,
    eventAt: null,
    location: null,
    effortMinutes: 60,
    requirements: [],
    keyNotes: [],
    nextAction: null,
    status: 'open',
    dedupeHash: null,
    createdAt: now,
    closedAt: null,
    ...patch,
  };
}

const show2 = (s: { startAt: Date; endAt: Date }) => `${show(s.startAt)}–${show(s.endAt).slice(11)}`;

describe('çalışma bloğu önerisi', () => {
  it('son tarihten önceki akşam, tercih edilen saatte, süre kadar', () => {
    const [s] = suggestBlocks([item({ effortMinutes: 45 })], [], now, prefs);
    expect(show2(s!)).toBe('2026-10-23T20:00–20:45');
  });

  it('2 saati aşan iş bir gün daha erkene alınır ve sessiz saate taşmaz', () => {
    const [s] = suggestBlocks([item({ effortMinutes: 180 })], [], now, prefs);
    expect(show2(s!)).toBe('2026-10-22T19:00–22:00');
  });

  it('süre 30 dakikadan kısa olmaz, çakışan blok bir gün geriye kayar', () => {
    const a = item({ effortMinutes: 10 });
    const b = item({ effortMinutes: 60 });
    const out = suggestBlocks([a, b], [], now, prefs);
    expect(out.map(show2)).toEqual(['2026-10-23T20:00–20:30', '2026-10-22T20:00–21:00']);
  });

  it('onaylanmış bloğu olan, etkinlik olan ve süresi bilinmeyen işler atlanır', () => {
    const planned = item({});
    const block: Block = { id: 'b', userId: 'u', itemId: planned.id, startAt: ist('2026-10-23T20:00'), endAt: ist('2026-10-23T21:00'), createdAt: now };
    const out = suggestBlocks(
      [planned, item({ category: 'event', eventAt: ist('2026-10-25T10:00') }), item({ effortMinutes: null }), item({})],
      [block],
      now,
      prefs,
    );
    expect(out).toHaveLength(1);
    expect(show2(out[0]!)).toBe('2026-10-22T20:00–21:00'); // 23'ü akşamı dolu
  });

  it('son tarih yarın sabahsa bugün akşam; bugün de olmazsa hemen', () => {
    const [s] = suggestBlocks([item({ deadlineAt: ist('2026-10-21T10:00') })], [], now, prefs);
    expect(show2(s!)).toBe('2026-10-20T20:00–21:00');
    const late = ist('2026-10-20T21:30');
    expect(suggestBlocks([item({ deadlineAt: ist('2026-10-21T09:00') })], [], late, prefs)).toEqual([]);
    const [soon] = suggestBlocks([item({ deadlineAt: ist('2026-10-20T18:00') })], [], ist('2026-10-20T13:05'), prefs);
    expect(show2(soon!)).toBe('2026-10-20T13:45–14:45');
  });

  it('takvim dosyasında "Çalış:" olayı', () => {
    const it2 = item({ title: 'Rapor' });
    const block: Block = { id: 'b1', userId: 'u', itemId: it2.id, startAt: ist('2026-10-23T20:00'), endAt: ist('2026-10-23T21:00'), createdAt: now };
    const cal = buildCalendar([it2], ZONE, now, 'Rafta', [block]);
    expect(cal).toContain('SUMMARY:Çalış: Rapor');
    expect(cal).toContain('DTSTART:20261023T170000Z');
  });
});

describe('takvim API', () => {
  async function setup() {
    const env = createEnv(now);
    const api = createApi({ app: env.deps, enqueue: () => undefined });
    const user = await addUser(env, 'tg:42');
    await route(env.deps, user, { kind: 'text', text: 'bağla' });
    const code = /\*(\d{3}) (\d{3})\*/.exec(env.notifier.lastText())!.slice(1).join('');
    const { token } = (await (await api.request('/api/link', { method: 'POST', body: JSON.stringify({ code }) })).json()) as { token: string };
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const it1 = await env.store.createItem({ userId: user.id, sourceType: 'text', title: 'Rapor', category: 'task', deadlineAt: ist('2026-10-24T23:59'), effortMinutes: 60 });
    return { env, api, headers, user, it1 };
  }

  it('öneri → onay → taşı → sil', async () => {
    const { api, headers, it1, env } = await setup();
    const { suggestions } = (await (await api.request('/api/blocks/suggestions', { headers })).json()) as { suggestions: { itemId: string; startAt: string; endAt: string }[] };
    expect(suggestions).toHaveLength(1);
    const created = await api.request('/api/blocks', { method: 'POST', headers, body: JSON.stringify(suggestions[0]) });
    expect(created.status).toBe(201);
    const { block } = (await created.json()) as { block: { id: string } };
    expect(((await (await api.request('/api/blocks/suggestions', { headers })).json()) as { suggestions: unknown[] }).suggestions).toHaveLength(0);

    const moved = await api.request(`/api/blocks/${block.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ startAt: '2026-10-22T18:00:00+03:00', endAt: '2026-10-22T19:00:00+03:00' }),
    });
    expect(moved.status).toBe(200);
    expect(show(env.store.blocks[0]!.startAt)).toBe('2026-10-22T18:00');

    const bad = await api.request(`/api/blocks/${block.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ startAt: '2026-10-22T18:00:00+03:00', endAt: '2026-10-22T17:00:00+03:00' }),
    });
    expect(bad.status).toBe(400);
    expect((await api.request(`/api/blocks/${block.id}`, { method: 'DELETE', headers })).status).toBe(200);
    expect(env.store.blocks).toHaveLength(0);
    expect(it1.id).toBeTruthy();
  });

  it('başkasının kaydına blok eklenemez', async () => {
    const { api, headers, env } = await setup();
    const other = await addUser(env, 'tg:99');
    const foreign = await env.store.createItem({ userId: other.id, sourceType: 'text', title: 'X', category: 'task' });
    const res = await api.request('/api/blocks', {
      method: 'POST',
      headers,
      body: JSON.stringify({ itemId: foreign.id, startAt: '2026-10-22T18:00:00+03:00', endAt: '2026-10-22T19:00:00+03:00' }),
    });
    expect(res.status).toBe(404);
  });

  it('hatırlatmalar listelenir; telefon kısayolu anahtarı bir kez verilir ve çalışır', async () => {
    const { api, headers, env, user } = await setup();
    await env.store.insertReminders([{ itemId: env.store.items[0]!.id, userId: user.id, kind: 'nudge', sendAt: ist('2026-10-23T10:00') }]);
    const { reminders } = (await (await api.request('/api/reminders', { headers })).json()) as { reminders: { kind: string }[] };
    expect(reminders.map((r) => r.kind)).toEqual(['nudge']);

    const res = await api.request('/api/devices', { method: 'POST', headers, body: JSON.stringify({ name: 'Android kısayol' }) });
    const { token } = (await res.json()) as { token: string };
    expect(res.status).toBe(201);
    const me = await api.request('/api/me', { headers: { authorization: `Bearer ${token}` } });
    expect(((await me.json()) as { device: { name: string } }).device.name).toBe('Android kısayol');
  });
});
