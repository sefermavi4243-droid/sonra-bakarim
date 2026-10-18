import type { Button, Notifier, SendResult, TemplateMessage } from './notifier.js';

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
  fetch?: typeof fetch;
}

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

const BODY_LIMIT = 1024;
const BUTTON_TITLE_LIMIT = 20;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Resmi WhatsApp Cloud API istemcisi (Meta Graph API). */
export class WhatsAppClient implements Notifier {
  readonly channel = 'whatsapp' as const;
  private readonly base: string;
  private readonly fetch: typeof fetch;

  constructor(private readonly cfg: WhatsAppConfig) {
    this.base = `https://graph.facebook.com/${cfg.graphVersion}`;
    this.fetch = cfg.fetch ?? fetch;
  }

  private async call(path: string, init: RequestInit): Promise<unknown> {
    const res = await this.fetch(`${this.base}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.cfg.accessToken}`, 'Content-Type': 'application/json', ...init.headers },
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new WhatsAppApiError(`WhatsApp API ${res.status}`, res.status, body);
    return body;
  }

  private async send(to: string, payload: Record<string, unknown>): Promise<SendResult> {
    const body = (await this.call(`${this.cfg.phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload }),
    })) as { messages?: { id: string }[] } | null;
    return { messageId: body?.messages?.[0]?.id ?? null };
  }

  sendText(to: string, text: string): Promise<SendResult> {
    return this.send(to, { type: 'text', text: { body: clip(text, 4096), preview_url: false } });
  }

  sendButtons(to: string, text: string, buttons: Button[]): Promise<SendResult> {
    if (buttons.length === 0) return this.sendText(to, text);
    return this.send(to, {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: clip(text, BODY_LIMIT) },
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: clip(b.title, BUTTON_TITLE_LIMIT) },
          })),
        },
      },
    });
  }

  sendTemplate(to: string, t: TemplateMessage): Promise<SendResult> {
    const components: Record<string, unknown>[] = [];
    if (t.bodyParams.length) {
      components.push({ type: 'body', parameters: t.bodyParams.map((text) => ({ type: 'text', text })) });
    }
    t.buttonPayloads.forEach((payload, index) => {
      components.push({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload }],
      });
    });
    return this.send(to, { type: 'template', template: { name: t.name, language: { code: t.language }, components } });
  }

  /** Mesajı okundu işaretler ve "yazıyor…" göstergesi açar (ücretsiz). */
  async markReadTyping(messageId: string): Promise<void> {
    await this.call(`${this.cfg.phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      }),
    });
  }

  /** Gelen medyayı indirir: önce medya kimliğinden geçici URL, sonra dosya. */
  async downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
    const meta = (await this.call(mediaId, { method: 'GET' })) as { url: string; mime_type: string };
    const res = await this.fetch(meta.url, { headers: { Authorization: `Bearer ${this.cfg.accessToken}` } });
    if (!res.ok) throw new WhatsAppApiError(`Medya indirilemedi ${res.status}`, res.status, null);
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: meta.mime_type };
  }
}
