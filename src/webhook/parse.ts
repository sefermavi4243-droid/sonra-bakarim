import { z } from 'zod';

// WhatsApp Cloud API webhook gövdesinden yalnızca kullandığımız alanlar.
const mediaSchema = z.object({ id: z.string(), mime_type: z.string().optional(), caption: z.string().optional() });

const messageSchema = z
  .object({
    from: z.string(),
    id: z.string(),
    timestamp: z.string(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
    image: mediaSchema.optional(),
    document: mediaSchema.extend({ filename: z.string().optional() }).optional(),
    audio: mediaSchema.optional(),
    voice: mediaSchema.optional(),
    button: z.object({ payload: z.string().optional(), text: z.string().optional() }).optional(),
    interactive: z
      .object({
        type: z.string(),
        button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
        list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      })
      .optional(),
  })
  .passthrough();

const webhookSchema = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        changes: z.array(
          z.object({
            value: z
              .object({
                contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }).optional() })).optional(),
                messages: z.array(z.unknown()).optional(),
              })
              .passthrough(),
          }),
        ),
      }),
    )
    .default([]),
});

export type RawMessage = z.infer<typeof messageSchema>;

export interface IncomingEnvelope {
  message: RawMessage;
  contactName: string | null;
}

/** Webhook gövdesindeki kullanıcı mesajlarını çıkarır; durum bildirimlerini (statuses) yok sayar. */
export function parseWebhook(body: unknown): IncomingEnvelope[] {
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) return [];
  const out: IncomingEnvelope[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const names = new Map(change.value.contacts?.map((c) => [c.wa_id, c.profile?.name ?? null]) ?? []);
      for (const raw of change.value.messages ?? []) {
        const m = messageSchema.safeParse(raw);
        if (m.success) out.push({ message: m.data, contactName: names.get(m.data.from) ?? null });
      }
    }
  }
  return out;
}

export type Incoming =
  | { kind: 'text'; text: string }
  | { kind: 'media'; media: 'image' | 'document' | 'audio'; mediaId: string; mimeType: string; caption: string; filename: string | null }
  | { kind: 'button'; payload: string }
  | { kind: 'unsupported'; type: string };

/** Ham mesajı işleyicinin anladığı biçime çevirir. */
export function classify(m: RawMessage): Incoming {
  if (m.type === 'text' && m.text) return { kind: 'text', text: m.text.body };
  if (m.type === 'interactive') {
    const id = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id;
    if (id) return { kind: 'button', payload: id };
  }
  if (m.type === 'button' && m.button) {
    if (m.button.payload) return { kind: 'button', payload: m.button.payload };
    if (m.button.text) return { kind: 'text', text: m.button.text };
  }
  const media = m.type === 'image' ? m.image : m.type === 'document' ? m.document : m.type === 'audio' ? (m.audio ?? m.voice) : undefined;
  if (media) {
    return {
      kind: 'media',
      media: m.type as 'image' | 'document' | 'audio',
      mediaId: media.id,
      mimeType: media.mime_type ?? 'application/octet-stream',
      caption: media.caption ?? '',
      filename: m.type === 'document' ? (m.document?.filename ?? null) : null,
    };
  }
  return { kind: 'unsupported', type: m.type };
}
