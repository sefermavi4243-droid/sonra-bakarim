import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { extract } from '../src/extract/extract.js';
import { createLlmClient } from '../src/extract/llm.js';
import { finalizeExtraction } from '../src/extract/finalize.js';

// Gerçek yerel model çağrısı (Ollama vb. açık olmalı). `npm run test:live`.
const model = process.env.LLM_MODEL;
const baseUrl = process.env.LLM_BASE_URL || 'http://localhost:11434/v1';
const ZONE = 'Europe/Istanbul';
const now = DateTime.fromISO('2026-10-20T12:00', { zone: ZONE }).toJSDate();
const prefs = { timezone: ZONE, quietStart: '22:00', quietEnd: '08:00', preferredHour: 20 };

describe.skipIf(!model)('yerel model çıkarımı (canlı)', { timeout: 300_000 }, () => {
  const deps = { client: createLlmClient({ baseUrl, apiKey: process.env.LLM_API_KEY }), model: model!, now, zone: ZONE, log: console.log };

  it('iş ilanından açık son tarih', async () => {
    const text = 'Örnek Fintech Veri Analisti Stajyeri arıyor. İstanbul, hibrit. SQL ve Python. Son başvuru: 24 Ekim 2026. CV ve motivasyon yazısı gönderin.';
    const x = await extract({ texts: [{ label: 'Mesaj', text }] }, deps);
    expect(x?.category).toBe('job');
    const f = finalizeExtraction(x!, text, now, prefs);
    expect(f.deadline?.toISOString()).toBe('2026-10-24T20:59:00.000Z');
  });

  it('konu dışı soru', async () => {
    const x = await extract({ texts: [{ label: 'Mesaj', text: 'Bugün hava nasıl?' }] }, deps);
    expect(x?.off_topic).toBe(true);
  });

  it('sesli not: cuma', async () => {
    const text = "Cuma Ali'ye dosyayı atmayı unutma";
    const x = await extract({ texts: [{ label: 'Sesli not dökümü', text }] }, deps);
    expect(x?.category).toBe('task');
    const f = finalizeExtraction(x!, text, now, prefs);
    expect(DateTime.fromJSDate(f.deadline!, { zone: ZONE }).toISODate()).toBe('2026-10-23');
  });

  it('metinde olmayan tarih uydurulmaz', async () => {
    const text = 'Yeni bir not alma uygulaması çıkmış, denemek istiyorum: Notion benzeri.';
    const x = await extract({ texts: [{ label: 'Mesaj', text }] }, deps);
    const f = finalizeExtraction(x!, text, now, prefs);
    expect(f.deadline).toBeNull();
  });
});
