import { z } from 'zod';

/** SPEC bölüm 9'daki çıkarım şeması (+ `event_evidence`, `source_text`). */
export const extractionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.enum(['job', 'event', 'application', 'tool', 'read', 'task', 'other']),
  organization: z.string().trim().min(1).nullable(),
  deadline: z.string().trim().min(1).nullable(),
  deadline_source: z.enum(['explicit', 'inferred']).nullable(),
  deadline_evidence: z.string().trim().min(1).nullable(),
  event_time: z.string().trim().min(1).nullable(),
  event_evidence: z.string().trim().min(1).nullable(),
  location: z.string().trim().min(1).nullable(),
  effort_minutes: z.number().int().min(0).max(60 * 24 * 7).nullable(),
  requirements: z.array(z.string().trim().min(1)).max(20),
  key_notes: z.array(z.string().trim().min(1)).max(10),
  next_action: z.string().trim().min(1).nullable(),
  question_for_user: z.string().trim().min(1).nullable(),
  off_topic: z.boolean(),
  source_text: z.string().nullable(),
});

export type Extraction = z.infer<typeof extractionSchema>;

const str = { type: 'string' } as const;
const nullableStr = { type: ['string', 'null'] } as const;

/**
 * Modele verilen JSON şeması (yapılandırılmış çıktı). Tüm alanlar zorunlu, ek alan yok;
 * zod şemasıyla birebir aynı alanlar.
 */
export const extractJsonSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: Object.keys(extractionSchema.shape),
  properties: {
    title: { ...str, description: 'Kısa, Türkçe başlık. Ör: "Veri Analisti Stajyeri"' },
    category: { type: 'string', enum: ['job', 'event', 'application', 'tool', 'read', 'task', 'other'] },
    organization: { ...nullableStr, description: 'Şirket, kurum ya da düzenleyen. Yoksa null.' },
    deadline: {
      ...nullableStr,
      description:
        'Son tarih, ISO 8601 ve saat dilimi farkıyla (2026-10-24T23:59:00+03:00). Yalnızca girdide açıkça yazıyorsa; yoksa null.',
    },
    deadline_source: {
      type: ['string', 'null'],
      enum: ['explicit', 'inferred', null],
      description: 'explicit: tarih açıkça yazılı. inferred: göreli ifadeden ("cuma") çözüldü. Tarih yoksa null.',
    },
    deadline_evidence: {
      ...nullableStr,
      description: 'Son tarihin geçtiği ifade, girdiden harfi harfine kopyalanmış. Tarih yoksa null.',
    },
    event_time: { ...nullableStr, description: 'Etkinliğin başlama anı, ISO 8601. Etkinlik değilse ya da yazmıyorsa null.' },
    event_evidence: {
      ...nullableStr,
      description: 'Etkinlik tarihinin geçtiği ifade, girdiden harfi harfine kopyalanmış. Yoksa null.',
    },
    location: nullableStr,
    effort_minutes: { type: ['integer', 'null'], description: 'İşin tahmini süresi, dakika.' },
    requirements: { type: 'array', items: str, description: 'Gerekenler: belgeler, ön koşullar.' },
    key_notes: { type: 'array', items: str, description: 'En fazla birkaç kısa önemli not.' },
    next_action: { ...nullableStr, description: 'Kullanıcının atacağı ilk somut adım.' },
    question_for_user: {
      ...nullableStr,
      description: 'Tarih belirsizse kullanıcıya sorulacak tek kısa Türkçe soru. Yoksa null.',
    },
    off_topic: {
      type: 'boolean',
      description: 'Kaydedilecek bir şey değilse (selamlaşma, genel soru, sohbet) true.',
    },
    source_text: {
      ...nullableStr,
      description:
        'Görsel ya da taranmış belge geldiyse içindeki tarih ve başlık satırlarının harfi harfine dökümü. Metin girdisinde null.',
    },
  },
};
