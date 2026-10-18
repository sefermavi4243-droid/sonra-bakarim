import type { ChatContent, LlmClient } from './llm.js';
import { parseJsonObject } from './llm.js';
import { buildSystemPrompt, wrapInput } from './prompt.js';
import { extractJsonSchema, extractionSchema, type Extraction } from './schema.js';

export interface ExtractInput {
  /** Etiketli metin parçaları: kullanıcı notu, sayfa metni, PDF metni, ses dökümü. */
  texts: { label: string; text: string }[];
  images?: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; base64: string }[];
}

export interface ExtractDeps {
  client: LlmClient;
  model: string;
  now: Date;
  zone: string;
  log?: (msg: string, extra?: unknown) => void;
}

const MAX_ATTEMPTS = 2; // CLAUDE.md: doğrulanamayan çıktı bir kez yeniden denenir.

/**
 * Yerel modelden JSON şemasıyla yapılandırılmış kayıt alır ve zod ile doğrular.
 * İki denemede de geçerli çıktı gelmezse null döner.
 */
export async function extract(input: ExtractInput, deps: ExtractDeps): Promise<Extraction | null> {
  const content: Exclude<ChatContent, string> = [];
  for (const img of input.images ?? []) {
    content.push({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}` } });
  }
  content.push({ type: 'text', text: wrapInput(input.texts) });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const text = await deps.client.chat({
        model: deps.model,
        temperature: 0,
        max_tokens: 4000,
        messages: [
          { role: 'system', content: buildSystemPrompt(deps.now, deps.zone) },
          { role: 'user', content },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'kayit', strict: true, schema: extractJsonSchema } },
      });
      const json = parseJsonObject(text);
      if (json === undefined) {
        deps.log?.('çıkarım: JSON yok', { attempt, text: text.slice(0, 200) });
        continue;
      }
      const parsed = extractionSchema.safeParse(json);
      if (parsed.success) return parsed.data;
      deps.log?.('çıkarım: şema doğrulanamadı', { attempt, issues: parsed.error.issues });
    } catch (err) {
      deps.log?.('çıkarım: model hatası', { attempt, err: String(err) });
    }
  }
  return null;
}
