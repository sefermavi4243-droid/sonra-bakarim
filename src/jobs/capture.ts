import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Item, User } from '../db/schema.js';
import type { ExtractInput } from '../extract/extract.js';
import { fetchImage } from '../ingest/image.js';
import { MIN_TEXT_LENGTH, canonicalUrl, readLink } from '../ingest/link.js';
import type { AppDeps } from './deps.js';
import { extractAndSave } from './process.js';

/** Tarayıcı uzantısının ya da web panelinin gönderdiği kayıt isteği. */
export const captureSchema = z
  .object({
    url: z.string().trim().url().max(4000).optional(),
    title: z.string().trim().max(500).optional(),
    /** Tarayıcıda okunmuş sayfa metni (giriş isteyen sayfalarda da dolu). */
    text: z.string().max(200_000).optional(),
    selection: z.string().trim().max(20_000).optional(),
    imageUrl: z.string().trim().url().max(4000).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((c) => c.url || c.text?.trim() || c.selection || c.imageUrl || c.note, 'Boş istek');

export type CaptureRequest = z.infer<typeof captureSchema>;

export type CaptureStatus =
  | { state: 'pending' }
  | { state: 'saved'; item: Item }
  | { state: 'duplicate'; item: Item }
  | { state: 'failed'; reason: 'unreadable' | 'off_topic' | 'needs_text' | 'error' };

/** Kayıt isteklerinin durumu; bellekte tutulur, 1 saat sonra unutulur. */
export class CaptureLog {
  private readonly entries = new Map<string, { userId: string; status: CaptureStatus; at: number }>();
  constructor(private readonly ttlMs = 3600_000) {}

  set(id: string, userId: string, status: CaptureStatus): void {
    this.entries.set(id, { userId, status, at: Date.now() });
    for (const [key, e] of this.entries) if (Date.now() - e.at > this.ttlMs) this.entries.delete(key);
  }

  /** Yalnızca isteği yapan kullanıcı görebilir. */
  get(id: string, userId: string): CaptureStatus | null {
    const e = this.entries.get(id);
    return e && e.userId === userId ? e.status : null;
  }
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** Link kayıtlarının tekrar anahtarı; sohbet (process.ts) ve tarayıcı aynısını kullanır. */
export function linkDedupeHash(canonical: string): string {
  return hash(canonical);
}

/** Sayfa metni bu uzunluktaysa sunucu sayfayı yeniden açmaz. */
const PAGE_TEXT_MIN = 200;

export async function handleCapture(deps: AppDeps, user: User, id: string, raw: unknown): Promise<CaptureStatus> {
  const status = await runCapture(deps, user, raw).catch((err): CaptureStatus => {
    deps.log('tarayıcı kaydı işlenemedi', { err: err instanceof Error ? err.stack : String(err) });
    return { state: 'failed', reason: 'error' };
  });
  deps.captures.set(id, user.id, status);
  return status;
}

async function runCapture(deps: AppDeps, user: User, raw: unknown): Promise<CaptureStatus> {
  const parsed = captureSchema.safeParse(raw);
  if (!parsed.success) return { state: 'failed', reason: 'needs_text' };
  const c = parsed.data;

  let canonical: string | null = null;
  if (c.url) {
    try {
      canonical = canonicalUrl(c.url);
    } catch {
      canonical = null;
    }
  }
  const selection = c.selection?.trim() ?? '';
  // Aynı sayfadan farklı seçimler ayrı kayıt olabilir (ör. bir etkinlik listesi).
  // Yalnızca link: Telegram'daki link kaydıyla aynı özet; böylece telefondan ve
  // tarayıcıdan gelen aynı ilan tek kayıtta birleşir.
  let dedupeHash: string | null = null;
  if (canonical && !selection) dedupeHash = linkDedupeHash(canonical);
  else {
    const key = canonical ? `${canonical}#${selection}` : selection || c.note || c.imageUrl || '';
    if (key) dedupeHash = hash(key.toLocaleLowerCase('tr'));
  }
  if (dedupeHash) {
    const existing = await deps.store.findOpenItemByDedupe(user.id, dedupeHash);
    if (existing) return { state: 'duplicate', item: existing };
  }

  const texts: ExtractInput['texts'] = [];
  if (c.note) texts.push({ label: 'Kullanıcının notu', text: c.note });
  if (selection) texts.push({ label: 'Seçili metin', text: selection });

  const pageText = c.text?.trim() ?? '';
  let rawText: string | null = selection || null;
  if (pageText.length >= PAGE_TEXT_MIN && !selection) {
    texts.push({ label: `Sayfa: ${c.url ?? ''}`, text: `${c.title ?? ''}\n\n${pageText}` });
    rawText = pageText;
  } else if (c.url && !selection && !c.imageUrl) {
    const page = await readLink(c.url, { fetch: deps.fetch, safeHost: deps.safeHost });
    if (page.ok && page.text.length >= MIN_TEXT_LENGTH) {
      texts.push({ label: `Sayfa: ${page.url}`, text: `${page.title}\n\n${page.text}` });
      rawText = page.text;
    } else if (pageText || c.title) {
      texts.push({ label: `Sayfa: ${c.url}`, text: `${c.title ?? ''}\n\n${pageText}` });
    } else {
      return { state: 'failed', reason: 'needs_text' };
    }
  } else if (c.title && (selection || c.imageUrl)) {
    texts.push({ label: 'Sayfa başlığı', text: c.title });
  }

  const images: NonNullable<ExtractInput['images']> = [];
  if (c.imageUrl) {
    const img = await fetchImage(c.imageUrl, { fetch: deps.fetch, safeHost: deps.safeHost });
    if (img) images.push({ mediaType: img.mimeType, base64: img.data.toString('base64') });
    else if (texts.length === 0) return { state: 'failed', reason: 'unreadable' };
  }
  if (texts.length === 0 && images.length === 0) return { state: 'failed', reason: 'needs_text' };
  if (images.length) texts.push({ label: 'Ekteki görsel', text: 'Görseldeki içeriği oku.' });

  const inputText = texts.map((t) => t.text).join('\n');
  const outcome = await extractAndSave(
    deps,
    user,
    { texts, images },
    inputText,
    { sourceType: 'extension', sourceUrl: canonical, rawText, mediaPath: null, dedupeHash },
    { fromBrowser: true },
  );
  if (outcome.kind === 'saved') return { state: 'saved', item: outcome.item };
  return { state: 'failed', reason: outcome.kind };
}
