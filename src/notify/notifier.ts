export type Channel = 'whatsapp' | 'telegram' | 'webpush';

export interface Button {
  /** Geri dönen yük; `eylem:kayıtId` biçiminde (bkz. jobs/buttons.ts). */
  id: string;
  /** WhatsApp'ta en fazla 20 karakter. */
  title: string;
}

export interface TemplateMessage {
  name: string;
  language: string;
  bodyParams: string[];
  /** Şablondaki hızlı yanıt düğmelerinin sırasıyla yükleri. */
  buttonPayloads: string[];
}

export interface OutgoingFile {
  name: string;
  mimeType: string;
  data: Buffer;
}

export interface SendResult {
  messageId: string | null;
}

/**
 * Tüm gönderimler bu arayüzden geçer (CLAUDE.md kural 6). `to` kanala özgü alıcı
 * kimliğidir: WhatsApp'ta telefon numarası, Telegram'da `tg:<chat_id>`.
 */
export interface Notifier {
  readonly channel: Channel;
  sendText(to: string, text: string): Promise<SendResult>;
  /** En fazla 3 düğme. */
  sendButtons(to: string, text: string, buttons: Button[]): Promise<SendResult>;
  /** 24 saat penceresi kapalıyken yalnızca onaylı şablon gönderilir. */
  sendTemplate(to: string, template: TemplateMessage): Promise<SendResult>;
  /** Dosya (ör. takvim .ics) gönderir; desteklemeyen kanalda tanımsızdır. */
  sendFile?(to: string, file: OutgoingFile, caption?: string): Promise<SendResult>;
}

export class NotImplementedChannelError extends Error {}

/** Yedek kanallar Faz 1'de bağlı değil; arayüz hazır, gönderim hata verir. */
export function createUnavailableNotifier(channel: Exclude<Channel, 'whatsapp'>): Notifier {
  const fail = async (): Promise<SendResult> => {
    throw new NotImplementedChannelError(`${channel} kanalı henüz etkin değil`);
  };
  return { channel, sendText: fail, sendButtons: fail, sendTemplate: fail };
}

/**
 * Alıcının adresine bakıp doğru kanala gönderir: `tg:` önekliler Telegram'a,
 * diğerleri WhatsApp'a. Kanal yapılandırılmamışsa gönderim hata verir.
 */
export function createChannelRouter(channels: { whatsapp?: Notifier | null; telegram?: Notifier | null }): Notifier {
  const pick = (to: string): Notifier => {
    const n = to.startsWith('tg:') ? channels.telegram : channels.whatsapp;
    if (!n) throw new NotImplementedChannelError(`${to.startsWith('tg:') ? 'telegram' : 'whatsapp'} kanalı yapılandırılmadı`);
    return n;
  };
  return {
    channel: channels.whatsapp ? 'whatsapp' : 'telegram',
    sendText: async (to, text) => pick(to).sendText(to, text),
    sendButtons: async (to, text, buttons) => pick(to).sendButtons(to, text, buttons),
    sendTemplate: async (to, template) => pick(to).sendTemplate(to, template),
    sendFile: async (to, file, caption) => {
      const n = pick(to);
      if (!n.sendFile) throw new NotImplementedChannelError(`${n.channel} kanalı dosya göndermiyor`);
      return n.sendFile(to, file, caption);
    },
  };
}
