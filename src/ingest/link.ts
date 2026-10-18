import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';

export const MIN_TEXT_LENGTH = 300;
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export type LinkResult =
  | { ok: true; url: string; title: string; text: string }
  | { ok: false; reason: 'blocked' | 'http' | 'not_html' | 'too_short' | 'network' };

const URL_RE = /https?:\/\/[^\s<>"']+/i;

export function findUrl(text: string): string | null {
  const m = URL_RE.exec(text);
  return m ? m[0].replace(/[),.;!?]+$/, '') : null;
}

/** Aynı linkin tekrar işlenmemesi için izleme parametrelerini atar. */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|ref|refid|trackingid|trk|si$|s$)/i.test(key)) u.searchParams.delete(key);
  }
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  return u.toString().replace(/\/$/, '');
}

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:');
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Sunucunun iç ağına istek atılmasını engeller (SSRF). */
export async function isSafeHost(hostname: string): Promise<boolean> {
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;
  const addresses = isIP(hostname) ? [hostname] : (await lookup(hostname, { all: true })).map((a) => a.address);
  return addresses.length > 0 && addresses.every((ip) => !isPrivateAddress(ip));
}

/** Sayfayı indirir ve Readability ile ana metni çıkarır. */
export interface ReadLinkOptions {
  fetch?: typeof fetch;
  safeHost?: (hostname: string) => Promise<boolean>;
}

export async function readLink(rawUrl: string, opts: ReadLinkOptions = {}): Promise<LinkResult> {
  const fetchImpl = opts.fetch ?? fetch;
  const safeHost = opts.safeHost ?? isSafeHost;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'blocked' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'blocked' };

  let html: string;
  let finalUrl = url.toString();
  try {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let res: Response | null = null;
    // Yönlendirmeleri elle izle: her adresin iç ağa gitmediğini denetle.
    for (let hop = 0; hop < 5; hop++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'blocked' };
      if (!(await safeHost(url.hostname))) return { ok: false, reason: 'blocked' };
      res = await fetchImpl(url, {
        redirect: 'manual',
        signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SonraBakarimBot/1.0)',
          'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      const location = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !location) break;
      url = new URL(location, url);
      res = null;
    }
    if (!res || !res.ok) return { ok: false, reason: 'http' };
    finalUrl = url.toString();
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('html')) return { ok: false, reason: 'not_html' };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return { ok: false, reason: 'too_short' };
    html = new TextDecoder().decode(buf);
  } catch {
    return { ok: false, reason: 'network' };
  }

  return extractReadable(html, finalUrl);
}

export function extractReadable(html: string, url: string): LinkResult {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  const article = new Readability(doc).parse();
  const title = (article?.title || doc.title || '').trim();
  const text = (article?.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  dom.window.close();
  if (text.length < MIN_TEXT_LENGTH) return { ok: false, reason: 'too_short' };
  return { ok: true, url, title, text };
}
