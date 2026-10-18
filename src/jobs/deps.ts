import type { Store } from '../db/store.js';
import type { User } from '../db/schema.js';
import type { LlmClient } from '../extract/llm.js';
import type { MediaStorage } from '../ingest/storage.js';
import type { Transcriber } from '../ingest/transcribe.js';
import type { Notifier } from '../notify/notifier.js';
import type { UserPrefs } from '../rules/time.js';

export interface MediaSource {
  downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }>;
}

export interface AppDeps {
  store: Store;
  notifier: Notifier;
  media: MediaSource;
  storage: MediaStorage;
  /** Yapılandırılmadıysa sesli notlar için yazılı mesaj istenir. */
  transcriber: Transcriber | null;
  llm: LlmClient;
  /** Taranmış PDF sayfalarını PNG'ye çevirir; çeviremezse boş liste. */
  renderPdf: (pdf: Buffer) => Promise<Buffer[]>;
  extractModel: string;
  fetch?: typeof fetch;
  /** Link okurken iç ağ denetimi; testlerde DNS'e gitmemek için değiştirilir. */
  safeHost?: (hostname: string) => Promise<boolean>;
  /** Gelen mesajı okundu işaretleyip "yazıyor…" gösterir; isteğe bağlı. */
  markRead?: (messageId: string) => Promise<void>;
  now: () => Date;
  log: (msg: string, extra?: unknown) => void;
}

export function prefsOf(user: User): UserPrefs {
  return {
    timezone: user.timezone,
    quietStart: user.quietStart,
    quietEnd: user.quietEnd,
    preferredHour: user.preferredHour,
  };
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Kullanıcının son mesajından bu yana 24 saat geçmediyse serbest mesaj atılabilir.
 * Telegram'da böyle bir kısıt yok; pencere hep açık sayılır.
 */
export function windowOpen(user: User, now: Date): boolean {
  if (user.address.startsWith('tg:')) return true;
  return user.lastInboundAt !== null && +now - +user.lastInboundAt < WINDOW_MS;
}
