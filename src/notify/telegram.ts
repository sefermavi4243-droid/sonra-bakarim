import type { RawMessage } from '../webhook/parse.js';
import type { Button, Notifier, OutgoingFile, SendResult, TemplateMessage } from './notifier.js';

/**
 * Telegram Bot API kanalı. Adresler `tg:<chat_id>`, medya kimlikleri `tg:<file_id>`,
 * gelen mesaj kimlikleri `tg:<chat_id>:<update_id>` biçimindedir; böylece WhatsApp
 * kimlikleriyle çakışmaz ve yönlendirici öneke bakarak kanalı seçer.
 */
export const TG_PREFIX = 'tg:';

export interface TelegramConfig {
  token: string;
  fetch?: typeof fetch;
}

export class TelegramApiError extends Error {}

const TEXT_LIMIT = 4096;

/** WhatsApp biçimindeki *kalın* metni Telegram HTML'ine çevirir. */
export function toTelegramHtml(text: string): string {
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return escaped.replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
}

function chatIdOf(to: string): string {
  if (!to.startsWith(TG_PREFIX)) throw new TelegramApiError(`Telegram adresi değil: ${to}`);
  return to.slice(TG_PREFIX.length);
}

// Telegram dosyalarının uzantısından MIME türü (belge dışındakiler türünü bildirmez).
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
};

export class TelegramClient implements Notifier {
  readonly channel = 'telegram' as const;
  private readonly fetch: typeof fetch;
  private readonly base: string;

  constructor(private readonly cfg: TelegramConfig) {
    this.fetch = cfg.fetch ?? fetch;
    this.base = `https://api.telegram.org/bot${cfg.token}`;
  }

  async call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    const res = await this.fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!res.ok || !body?.ok) throw new TelegramApiError(`Telegram API ${res.status}: ${body?.description ?? ''}`);
    return body.result as T;
  }

  private async send(to: string, text: string, extra: Record<string, unknown> = {}): Promise<SendResult> {
    const html = toTelegramHtml(text);
    const msg = await this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatIdOf(to),
      text: html.length <= TEXT_LIMIT ? html : `${html.slice(0, TEXT_LIMIT - 1)}…`,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...extra,
    });
    return { messageId: String(msg.message_id) };
  }

  sendText(to: string, text: string): Promise<SendResult> {
    return this.send(to, text);
  }

  sendButtons(to: string, text: string, buttons: Button[]): Promise<SendResult> {
    // Üçten fazla düğme ikişerli satırlara bölünür; dar ekranda sıkışmasın.
    const perRow = buttons.length > 3 ? 2 : 3;
    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < buttons.length; i += perRow) {
      rows.push(buttons.slice(i, i + perRow).map((b) => ({ text: b.title, callback_data: b.id })));
    }
    return this.send(to, text, { reply_markup: { inline_keyboard: rows } });
  }

  async sendFile(to: string, file: OutgoingFile, caption?: string): Promise<SendResult> {
    const form = new FormData();
    form.append('chat_id', chatIdOf(to));
    form.append('document', new Blob([new Uint8Array(file.data)], { type: file.mimeType }), file.name);
    if (caption) {
      form.append('caption', toTelegramHtml(caption));
      form.append('parse_mode', 'HTML');
    }
    const res = await this.fetch(`${this.base}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: { message_id: number }; description?: string } | null;
    if (!res.ok || !body?.ok) throw new TelegramApiError(`Telegram API ${res.status}: ${body?.description ?? ''}`);
    return { messageId: String(body.result?.message_id ?? '') };
  }

  /** Telegram'da 24 saat penceresi yok; şablon gerekmez. Çağrılırsa kod hatasıdır. */
  async sendTemplate(_to: string, template: TemplateMessage): Promise<SendResult> {
    throw new TelegramApiError(`Telegram'da şablon gönderilmez (${template.name})`);
  }

  async typing(messageId: string): Promise<void> {
    const chatId = messageId.slice(TG_PREFIX.length).split(':')[0];
    if (chatId) await this.call('sendChatAction', { chat_id: chatId, action: 'typing' });
  }

  async downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
    const file = await this.call<{ file_path?: string }>('getFile', { file_id: mediaId.slice(TG_PREFIX.length) });
    if (!file.file_path) throw new TelegramApiError('Dosya yolu yok');
    const res = await this.fetch(`https://api.telegram.org/file/bot${this.cfg.token}/${file.file_path}`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new TelegramApiError(`Dosya indirilemedi: ${res.status}`);
    const ext = file.file_path.split('.').pop()?.toLowerCase() ?? '';
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: MIME_BY_EXT[ext] ?? 'application/octet-stream' };
  }
}

// Bot API'den kullandığımız alanlar.
interface TgMedia {
  file_id: string;
  mime_type?: string;
  file_name?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    chat: { id: number };
    from?: { first_name?: string; last_name?: string };
    text?: string;
    caption?: string;
    photo?: (TgMedia & { width: number; height: number })[];
    document?: TgMedia;
    voice?: TgMedia;
    audio?: TgMedia;
  };
  callback_query?: {
    id: string;
    data?: string;
    from: { first_name?: string };
    message?: { chat: { id: number } };
  };
}

export interface TgEnvelope {
  address: string;
  displayName: string | null;
  message: RawMessage;
  callbackQueryId: string | null;
}

/** Telegram komutlarını (`/start`, `/listem`) uygulamanın Türkçe komutlarına çevirir. */
function commandText(text: string): string {
  const m = /^\/(\w+)(@\w+)?\s*$/.exec(text.trim());
  if (!m) return text;
  return m[1] === 'start' || m[1] === 'help' ? 'yardım' : m[1]!;
}

/**
 * Telegram güncellemesini WhatsApp mesajıyla aynı biçime çevirir; böylece işleme hattı
 * (sınıflandırma, komutlar, düğmeler) kanaldan bağımsız kalır.
 */
export function fromTelegram(u: TgUpdate): TgEnvelope | null {
  if (u.callback_query) {
    const q = u.callback_query;
    if (!q.message || !q.data) return null;
    const address = `${TG_PREFIX}${q.message.chat.id}`;
    return {
      address,
      displayName: q.from.first_name ?? null,
      callbackQueryId: q.id,
      message: {
        from: address,
        id: `${address}:${u.update_id}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: q.data, title: '' } },
      },
    };
  }
  const m = u.message;
  if (!m) return null;
  const address = `${TG_PREFIX}${m.chat.id}`;
  const base = { from: address, id: `${address}:${u.update_id}`, timestamp: String(m.date) };
  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || null;
  const caption = m.caption ?? '';
  const env = (message: RawMessage): TgEnvelope => ({ address, displayName: name, callbackQueryId: null, message });

  if (m.text !== undefined) return env({ ...base, type: 'text', text: { body: commandText(m.text) } });
  if (m.photo?.length) {
    const largest = m.photo.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
    return env({ ...base, type: 'image', image: { id: `${TG_PREFIX}${largest.file_id}`, mime_type: 'image/jpeg', caption } });
  }
  if (m.document) {
    const d = m.document;
    return env({
      ...base,
      type: 'document',
      document: { id: `${TG_PREFIX}${d.file_id}`, mime_type: d.mime_type, caption, ...(d.file_name ? { filename: d.file_name } : {}) },
    });
  }
  const audio = m.voice ?? m.audio;
  if (audio) return env({ ...base, type: 'audio', audio: { id: `${TG_PREFIX}${audio.file_id}`, mime_type: audio.mime_type ?? 'audio/ogg' } });
  return env({ ...base, type: 'unsupported' });
}

export interface PollerDeps {
  client: TelegramClient;
  accept: (e: TgEnvelope) => Promise<void>;
  log: (msg: string, extra?: unknown) => void;
}

/** Uzun yoklama: webhook ve tünel gerekmez. Durdurmak için dönen fonksiyonu çağır. */
export function startTelegramPolling(deps: PollerDeps): () => void {
  let stopped = false;
  let offset = 0;
  void (async () => {
    // Webhook tanımlıysa getUpdates çalışmaz.
    await deps.client.call('deleteWebhook').catch(() => undefined);
    while (!stopped) {
      try {
        const updates = await deps.client.call<TgUpdate[]>(
          'getUpdates',
          { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] },
          60_000,
        );
        for (const u of updates) {
          const e = fromTelegram(u);
          if (e) {
            if (e.callbackQueryId) await deps.client.call('answerCallbackQuery', { callback_query_id: e.callbackQueryId }).catch(() => undefined);
            // Kayıt başarısızsa offset ilerlemez; güncelleme bir sonraki turda yeniden gelir.
            await deps.accept(e);
          }
          offset = u.update_id + 1;
        }
      } catch (err) {
        deps.log('telegram yoklama hatası', { err: String(err) });
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  })();
  return () => {
    stopped = true;
  };
}
