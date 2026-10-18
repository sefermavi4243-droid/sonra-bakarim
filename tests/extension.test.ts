import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { createApi } from '../src/api/routes.js';
import { processInbound, route } from '../src/jobs/process.js';
import { STRUCTURED_PAGE_CHARS } from '../src/jobs/capture.js';
// @ts-expect-error: uzantı düz JavaScript; tip bildirimi yok.
import { highlightEvidence, readPage } from '../extension/page.js';
import { addUser, createEnv, extraction, ist, show } from './helpers/fakes.js';

process.env.TZ = 'Europe/Istanbul';

type Page = { url: string; title: string; text: string; selection: string; structured: string };

/** Uzantının sekmeye enjekte ettiği fonksiyonu jsdom içinde çalıştırır. */
function runInPage<T>(html: string, fn: () => T): T {
  const dom = new JSDOM(html, { url: 'https://ornek.com/ilan/42' });
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, location: g.location, window: g.window, NodeFilter: g.NodeFilter };
  Object.assign(g, { document: dom.window.document, location: dom.window.location, window: dom.window, NodeFilter: dom.window.NodeFilter });
  // jsdom innerText desteklemez; textContent yeterli.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    get(this: HTMLElement) {
      return this.textContent ?? '';
    },
  });
  try {
    return fn();
  } finally {
    Object.assign(g, saved);
  }
}

const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;


describe('uzantı: sayfa okuyucu (JSON-LD)', () => {
  it('iş ilanı: son başvuru, kurum, konum; yayın tarihi ayrıca işaretlenir', () => {
    const page = runInPage<Page>(
      `<html><head><title>İlan</title>${ld({
        '@context': 'https://schema.org',
        '@type': 'JobPosting',
        title: 'Veri Analisti Stajyeri',
        hiringOrganization: { '@type': 'Organization', name: 'Örnek Fintech' },
        validThrough: '2026-10-24T23:59:00+03:00',
        datePosted: '2026-10-01',
        jobLocation: { '@type': 'Place', address: { addressLocality: 'İstanbul', addressCountry: 'TR' } },
        employmentType: ['INTERN'],
      })}</head><body><main>İlan metni</main></body></html>`,
      () => readPage(),
    );
    expect(page.structured.split('\n')).toEqual([
      'Tür: İş ilanı',
      'Başlık: Veri Analisti Stajyeri',
      'Kurum: Örnek Fintech',
      'Son başvuru: 24 Ekim 2026 23:59',
      'Konum: İstanbul, TR',
      'Çalışma şekli: INTERN',
      'İlanın yayın tarihi (son tarih değildir): 1 Ekim 2026',
    ]);
    expect(page.text).toContain('İlan metni');
  });

  it('@graph içindeki etkinlik; çevrim içi konum; bozuk JSON-LD atlanır', () => {
    const page = runInPage<Page>(
      `<html><head><script type="application/ld+json">{bozuk</script>${ld({
        '@graph': [
          { '@type': 'WebPage', name: 'x' },
          {
            '@type': 'EducationEvent',
            name: 'Kariyer Günü',
            startDate: '2026-11-07T10:00:00+03:00',
            location: { '@type': 'VirtualLocation', url: 'https://zoom.us' },
            organizer: { name: 'İTÜ' },
            offers: [{ validThrough: '2026-11-05' }],
          },
        ],
      })}</head><body></body></html>`,
      () => readPage(),
    );
    expect(page.structured).toContain('Tür: Etkinlik');
    expect(page.structured).toContain('Etkinlik başlangıcı: 7 Kasım 2026 10:00');
    expect(page.structured).toContain('Konum: Çevrim içi');
    expect(page.structured).toContain('Kayıt son tarihi: 5 Kasım 2026');
  });

  it('yapılandırılmış veri yoksa boş', () => {
    const page = runInPage<Page>('<html><body><p>Merhaba</p></body></html>', () => readPage());
    expect(page.structured).toBe('');
  });

  it('kaydedilmiş sayfada son tarih cümlesi vurgulanır ve etiket çıkar', () => {
    const found = runInPage<{ mark: boolean; badge: string | undefined }>(
      '<html><body><p>Başvurular için son tarih: <b>24 Ekim 2026</b>.</p><p>Son başvuru: 24 Ekim 2026</p></body></html>',
      () => {
        const ok = highlightEvidence('son başvuru: 24 ekim 2026', 'Rafta · son tarih 24 Eki Cmt');
        return { mark: ok && document.querySelector('mark') !== null, badge: document.getElementById('rafta-badge')?.textContent ?? undefined };
      },
    );
    expect(found).toEqual({ mark: true, badge: 'Rafta · son tarih 24 Eki Cmt' });
  });
});

describe('sunucu: yapılandırılmış veriyle kayıt', () => {
  it('yapılandırılmış veri önce gelir, sayfa metni kısalır, tarih kanıttan doğrulanır', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    const pending: string[] = [];
    const api = createApi({ app: env.deps, enqueue: (id) => void pending.push(id) });
    const user = await addUser(env, 'tg:42');
    await route(env.deps, user, { kind: 'text', text: 'bağla' });
    const code = /\*(\d{3}) (\d{3})\*/.exec(env.notifier.lastText())!.slice(1).join('');
    const { token } = (await (await api.request('/api/link', { method: 'POST', body: JSON.stringify({ code }) })).json()) as { token: string };

    env.llm.responses.push(
      extraction({ deadline: '2026-10-24T23:59:00+03:00', deadline_source: 'explicit', deadline_evidence: 'Son başvuru: 24 Ekim 2026 23:59' }),
    );
    const structured = 'Tür: İş ilanı\nBaşlık: Veri Analisti Stajyeri\nSon başvuru: 24 Ekim 2026 23:59';
    await api.request('/api/capture', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.linkedin.com/jobs/view/9', title: 'İlan', text: 'x'.repeat(20_000), structured }),
    });
    for (const id of pending) await processInbound(env.deps, (await env.store.getInbound(id))!);

    const prompt = env.llm.calls[0]!.messages[1]!.content as { type: string; text?: string }[];
    const body = prompt.find((p) => p.type === 'text')!.text!;
    expect(body.indexOf('[Sayfadaki yapılandırılmış veri]')).toBeLessThan(body.indexOf('[Sayfa:'));
    expect(body.match(/x/g)!.length).toBeLessThanOrEqual(STRUCTURED_PAGE_CHARS);
    expect(show(env.store.items[0]!.deadlineAt!)).toBe('2026-10-24T23:59');
  });

  it('yapılandırılmış veri varken sunucu sayfayı yeniden açmaz', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    let fetched = 0;
    env.deps.fetch = (async () => {
      fetched++;
      return new Response('x', { status: 500 });
    }) as typeof fetch;
    const user = await addUser(env, 'tg:42');
    env.llm.responses.push(extraction());
    const { handleCapture } = await import('../src/jobs/capture.js');
    const status = await handleCapture(env.deps, user, 'cap:1', { url: 'https://ornek.com/ilan', title: 'İlan', structured: 'Son başvuru: 24 Ekim 2026' });
    expect(status.state).toBe('saved');
    expect(fetched).toBe(0);
  });
});
