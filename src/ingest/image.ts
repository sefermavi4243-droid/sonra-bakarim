import { isSafeHost } from './link.js';

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
export const FETCHABLE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type FetchableImageType = (typeof FETCHABLE_IMAGE_TYPES)[number];

/**
 * Tarayıcıda sağ tıklanan görseli indirir. Link okumadaki gibi iç ağ adreslerine
 * gidilmez, yönlendirmeler elle izlenir ve boyut sınırlanır.
 */
export async function fetchImage(
  rawUrl: string,
  opts: { fetch?: typeof fetch; safeHost?: (hostname: string) => Promise<boolean> } = {},
): Promise<{ data: Buffer; mimeType: FetchableImageType } | null> {
  const fetchImpl = opts.fetch ?? fetch;
  const safeHost = opts.safeHost ?? isSafeHost;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  try {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    for (let hop = 0; hop < 5; hop++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (!(await safeHost(url.hostname))) return null;
      const res = await fetchImpl(url, { redirect: 'manual', signal, headers: { Accept: 'image/*' } });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        url = new URL(location, url);
        continue;
      }
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim() as FetchableImageType;
      if (!FETCHABLE_IMAGE_TYPES.includes(type)) return null;
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > MAX_BYTES) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES || buf.byteLength === 0) return null;
      return { data: buf, mimeType: type };
    }
    return null;
  } catch {
    return null;
  }
}
