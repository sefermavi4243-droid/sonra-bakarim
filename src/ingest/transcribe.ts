export interface Transcriber {
  transcribe(audio: Buffer, mimeType: string): Promise<string>;
}

export interface TranscriberConfig {
  /** Yerel sunucular genelde anahtar istemez. */
  apiKey?: string;
  /** OpenAI uyumlu uç: yerel whisper sunucusu (speaches, whisper.cpp) ya da Groq. */
  baseUrl: string;
  model: string;
  fetch?: typeof fetch;
}

const FILE_NAME: Record<string, string> = {
  'audio/ogg': 'not.ogg',
  'audio/mpeg': 'not.mp3',
  'audio/mp4': 'not.m4a',
  'audio/aac': 'not.aac',
  'audio/amr': 'not.amr',
};

/** OpenAI uyumlu `/audio/transcriptions` ucuyla sesi Türkçe yazıya döker. */
export function createTranscriber(cfg: TranscriberConfig): Transcriber {
  const doFetch = cfg.fetch ?? fetch;
  return {
    async transcribe(audio, mimeType) {
      const base = mimeType.split(';')[0]!.trim();
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audio)], { type: base }), FILE_NAME[base] ?? 'not.ogg');
      form.append('model', cfg.model);
      form.append('language', 'tr');
      form.append('response_format', 'json');
      const res = await doFetch(`${cfg.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Yazıya dökme hatası ${res.status}: ${await res.text().catch(() => '')}`);
      const body = (await res.json()) as { text?: string };
      return (body.text ?? '').trim();
    },
  };
}
