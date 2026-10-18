import { createHash } from 'node:crypto';
import type { InboundMessage, Item, User } from '../db/schema.js';
import { extract, type ExtractInput } from '../extract/extract.js';
import { finalizeExtraction } from '../extract/finalize.js';
import { canonicalUrl, findUrl, readLink } from '../ingest/link.js';
import { PDF_MIN_TEXT, pdfText } from '../ingest/pdf.js';
import { TEXT, alreadySaved } from '../notify/messages.js';
import { classify, type Incoming, type RawMessage } from '../webhook/parse.js';
import { applyDateAnswer, handleButton } from './buttons.js';
import { handleCapture, linkDedupeHash } from './capture.js';
import { deleteAllData, parseCommand, runCommand } from './commands.js';
import { type AppDeps, prefsOf } from './deps.js';
import { saveItem, type SourceInfo } from './items.js';

/** `inbound_messages.type` değeri: tarayıcıdan gelen kayıt isteği. */
export const CAPTURE_TYPE = 'capture';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

const SMALL_TALK = /^(selam(lar)?|merhaba(lar)?|mrb|slm|sa|selamün aleyküm|günaydın|iyi akşamlar|iyi geceler|teşekkür(ler| ederim)?|sağ ?ol|eyvallah|ok|okey|tamam|tmm|👍|🙏|❤️|hey|naber|nasılsın)[.!? ]*$/iu;

/** Kuyruktaki bir gelen mesajı işler. Hata olsa da mesaj işlendi sayılır (sonsuz döngü olmasın). */
export async function processInbound(deps: AppDeps, msg: InboundMessage): Promise<void> {
  const user = await deps.store.getUser(msg.userId);
  try {
    if (!user) return;
    // Tarayıcı uzantısından ya da panelden gelen kayıt isteği (sohbet mesajı değil).
    if (msg.type === CAPTURE_TYPE) {
      await handleCapture(deps, user, msg.messageId, msg.payload);
      return;
    }
    await deps.markRead?.(msg.messageId).catch(() => undefined);
    await route(deps, user, classify(msg.payload as RawMessage));
  } catch (err) {
    deps.log('mesaj işlenemedi', { id: msg.messageId, err: err instanceof Error ? err.stack : String(err) });
    if (user) await deps.notifier.sendText(user.address, 'Bir sorun oldu. Birazdan tekrar gönderir misin?').catch(() => undefined);
  } finally {
    await deps.store.markInboundProcessed(msg.messageId, deps.now());
  }
}

export async function route(deps: AppDeps, user: User, incoming: Incoming): Promise<void> {
  const to = user.address;
  switch (incoming.kind) {
    case 'button':
      return handleButton(deps, user, incoming.payload);
    case 'unsupported':
      await deps.notifier.sendText(to, TEXT.unsupportedMedia);
      return;
    case 'media':
      if (user.pendingAction) await deps.store.setPendingAction(user.id, null);
      return ingestMedia(deps, user, incoming);
    case 'text':
      return handleText(deps, user, incoming.text);
  }
}

async function handleText(deps: AppDeps, user: User, text: string): Promise<void> {
  const to = user.address;
  const pending = user.pendingAction;
  const trimmed = text.trim();

  const cmd = parseCommand(trimmed);
  if (cmd) {
    if (pending) await deps.store.setPendingAction(user.id, null);
    return runCommand(deps, user, cmd);
  }

  if (pending?.type === 'confirm_delete') {
    await deps.store.setPendingAction(user.id, null);
    const yes = /^(evet|evet,? sil|sil|onaylıyorum)[.! ]*$/iu.test(trimmed);
    if (yes && new Date(pending.expiresAt) > deps.now()) return deleteAllData(deps, user);
    await deps.notifier.sendText(to, TEXT.deleteCancelled);
    return;
  }

  const url = findUrl(trimmed);
  if (url) {
    if (pending) await deps.store.setPendingAction(user.id, null);
    return ingestLink(deps, user, url, trimmed);
  }

  // Uzun bir metin büyük olasılıkla tarih yanıtı değil, yeni bir içeriktir.
  if (pending?.type === 'change_date' && trimmed.length <= 80) {
    await applyDateAnswer(deps, user, pending.itemId, trimmed);
    return;
  }
  if (pending) await deps.store.setPendingAction(user.id, null);

  if (SMALL_TALK.test(trimmed)) {
    await deps.notifier.sendText(to, TEXT.offTopic);
    return;
  }

  return ingest(deps, user, { texts: [{ label: 'Mesaj', text: trimmed }] }, trimmed, {
    sourceType: 'text',
    sourceUrl: null,
    rawText: trimmed,
    mediaPath: null,
    dedupeHash: hash(trimmed.toLocaleLowerCase('tr').replace(/\s+/g, ' ')),
  });
}

async function ingestLink(deps: AppDeps, user: User, url: string, message: string): Promise<void> {
  let canonical: string;
  try {
    canonical = canonicalUrl(url);
  } catch {
    await deps.notifier.sendText(user.address, TEXT.linkNeedsScreenshot);
    return;
  }
  const dedupeHash = linkDedupeHash(canonical);
  if (await sendIfDuplicate(deps, user, dedupeHash)) return;

  const page = await readLink(url, { fetch: deps.fetch, safeHost: deps.safeHost });
  if (!page.ok) {
    deps.log('link okunamadı', { url, reason: page.reason });
    await deps.notifier.sendText(user.address, TEXT.linkNeedsScreenshot);
    return;
  }
  const note = message.replace(url, '').trim();
  const texts = [
    { label: 'Kullanıcının notu', text: note },
    { label: `Sayfa: ${page.url}`, text: `${page.title}\n\n${page.text}` },
  ];
  const inputText = texts.map((t) => t.text).join('\n');
  return ingest(deps, user, { texts }, inputText, {
    sourceType: 'link',
    sourceUrl: canonical,
    rawText: page.text,
    mediaPath: null,
    dedupeHash,
  });
}

async function ingestMedia(deps: AppDeps, user: User, m: Extract<Incoming, { kind: 'media' }>): Promise<void> {
  const to = user.address;
  const { data, mimeType: downloadedType } = await deps.media.downloadMedia(m.mediaId);
  const mimeType = (m.mimeType || downloadedType).split(';')[0]!.trim();
  const dedupeHash = createHash('sha256').update(data).digest('hex');
  if (m.media !== 'audio' && (await sendIfDuplicate(deps, user, dedupeHash))) return;
  const caption = { label: 'Kullanıcının notu', text: m.caption };
  const store = () => deps.storage.put(user.id, data, mimeType);

  if (IMAGE_TYPES.includes(mimeType as ImageType)) {
    const input: ExtractInput = {
      texts: [caption, { label: 'Ekteki görsel', text: 'Görseldeki içeriği oku.' }],
      images: [{ mediaType: mimeType as ImageType, base64: data.toString('base64') }],
    };
    return ingest(deps, user, input, m.caption, { sourceType: 'image', sourceUrl: null, rawText: m.caption || null, mediaPath: null, dedupeHash }, store);
  }

  if (mimeType === 'application/pdf') {
    const text = await pdfText(data);
    let input: ExtractInput;
    if (text.length >= PDF_MIN_TEXT) {
      input = { texts: [caption, { label: `PDF${m.filename ? `: ${m.filename}` : ''}`, text }] };
    } else {
      // Taranmış PDF: sayfalar görüntüye çevrilip model tarafından okunur.
      const pages = await deps.renderPdf(data);
      if (pages.length === 0) {
        await deps.notifier.sendText(to, TEXT.unreadable);
        return;
      }
      input = {
        texts: [caption, { label: 'Ekteki taranmış PDF', text: 'PDF sayfalarındaki içeriği oku.' }],
        images: pages.map((p) => ({ mediaType: 'image/png' as const, base64: p.toString('base64') })),
      };
    }
    return ingest(deps, user, input, [m.caption, text].join('\n'), { sourceType: 'document', sourceUrl: null, rawText: text || null, mediaPath: null, dedupeHash }, store);
  }

  if (m.media === 'audio' || mimeType.startsWith('audio/')) {
    if (!deps.transcriber) {
      await deps.notifier.sendText(to, TEXT.voiceUnavailable);
      return;
    }
    let transcript: string;
    try {
      transcript = await deps.transcriber.transcribe(data, mimeType);
    } catch (err) {
      deps.log('yazıya dökme hatası', { err: String(err) });
      transcript = '';
    }
    if (!transcript) {
      await deps.notifier.sendText(to, TEXT.transcribeFailed);
      return;
    }
    if (SMALL_TALK.test(transcript)) {
      await deps.notifier.sendText(to, TEXT.offTopic);
      return;
    }
    const input: ExtractInput = { texts: [{ label: 'Sesli not dökümü', text: transcript }] };
    return ingest(deps, user, input, transcript, { sourceType: 'audio', sourceUrl: null, rawText: transcript, mediaPath: null, dedupeHash }, store);
  }

  await deps.notifier.sendText(to, TEXT.unsupportedMedia);
}

/** Ortak hat (sohbet): çıkar ve kaydet; olmazsa kullanıcıya nedenini yaz. */
async function ingest(
  deps: AppDeps,
  user: User,
  input: ExtractInput,
  inputText: string,
  source: SourceInfo,
  storeMedia?: () => Promise<string>,
): Promise<void> {
  const outcome = await extractAndSave(deps, user, input, inputText, source, { storeMedia });
  if (outcome.kind === 'unreadable') await deps.notifier.sendText(user.address, TEXT.unreadable);
  if (outcome.kind === 'off_topic') await deps.notifier.sendText(user.address, TEXT.offTopic);
}

export type IngestOutcome = { kind: 'saved'; item: Item } | { kind: 'unreadable' } | { kind: 'off_topic' };

/**
 * Kanaldan bağımsız hat: modelle çıkar, kurallardan geçir, kaydet ve kartı gönder.
 * Başarısızlıkta mesaj göndermez; sonucu döndürür (tarayıcı uzantısı da kullanır).
 */
export async function extractAndSave(
  deps: AppDeps,
  user: User,
  input: ExtractInput,
  inputText: string,
  source: SourceInfo,
  opts: { storeMedia?: () => Promise<string>; fromBrowser?: boolean } = {},
): Promise<IngestOutcome> {
  const now = deps.now();
  const x = await extract(input, { client: deps.llm, model: deps.extractModel, now, zone: user.timezone, log: deps.log });
  if (!x) return { kind: 'unreadable' };
  if (x.off_topic) return { kind: 'off_topic' };
  const finalized = finalizeExtraction(x, inputText, now, prefsOf(user));
  let mediaPath: string | null = null;
  if (opts.storeMedia) {
    try {
      mediaPath = await opts.storeMedia();
    } catch (err) {
      deps.log('medya depolanamadı', { err: String(err) });
    }
  }
  const item = await saveItem(deps, user, finalized, { ...source, mediaPath }, { fromBrowser: opts.fromBrowser });
  return { kind: 'saved', item };
}

async function sendIfDuplicate(deps: AppDeps, user: User, dedupeHash: string): Promise<boolean> {
  const existing = await deps.store.findOpenItemByDedupe(user.id, dedupeHash);
  if (!existing) return false;
  await deps.notifier.sendText(user.address, alreadySaved(existing, user.timezone));
  return true;
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
