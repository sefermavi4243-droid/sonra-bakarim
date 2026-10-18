/**
 * Yerel dil modeli istemcisi. OpenAI uyumlu `/chat/completions` ucunu konuşur:
 * Ollama (`http://localhost:11434/v1`), LM Studio (`http://localhost:1234/v1`),
 * llama.cpp `llama-server` ve vLLM aynı biçimi kabul eder.
 */

export type ChatContent =
  | string
  | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ChatContent;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  /** Yapılandırılmış çıktı: model yalnızca bu JSON şemasına uyan metin üretir. */
  response_format?: { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: object } };
}

export interface LlmClient {
  /** Modelin yanıt metnini döndürür. */
  chat(req: ChatRequest): Promise<string>;
}

export interface LlmConfig {
  baseUrl: string;
  /** Yerel sunucular genelde anahtar istemez. */
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class LlmError extends Error {}

export function createLlmClient(cfg: LlmConfig): LlmClient {
  const doFetch = cfg.fetch ?? fetch;
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  return {
    async chat(req) {
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 180_000),
      });
      if (!res.ok) throw new LlmError(`Model hatası ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
      const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new LlmError('Model boş yanıt döndürdü');
      return content;
    },
  };
}

/**
 * Yanıttaki JSON nesnesini ayıklar. Küçük modeller şemaya uysa bile bazen
 * ```json çiti ya da düşünme bloğu (<think>…</think>) ekler.
 */
export function parseJsonObject(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
