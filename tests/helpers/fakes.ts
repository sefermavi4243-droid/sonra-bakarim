import { DateTime } from 'luxon';
import type { Extraction } from '../../src/extract/schema.js';
import type { ChatRequest, LlmClient } from '../../src/extract/llm.js';
import type { AppDeps } from '../../src/jobs/deps.js';
import type { Button, Notifier, SendResult, TemplateMessage } from '../../src/notify/notifier.js';
import { MemoryStore } from './memoryStore.js';

export const ZONE = 'Europe/Istanbul';
export const ist = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toJSDate();
export const show = (d: Date) => DateTime.fromJSDate(d, { zone: ZONE }).toFormat("yyyy-MM-dd'T'HH:mm");

export type Sent =
  | { type: 'text'; to: string; text: string }
  | { type: 'buttons'; to: string; text: string; buttons: Button[] }
  | { type: 'template'; to: string; template: TemplateMessage };

export class FakeNotifier implements Notifier {
  readonly channel = 'whatsapp' as const;
  sent: Sent[] = [];
  failNext = 0;
  /** Gönderim sırasında başka işlerin araya girmesi için bekleme. */
  delayMs = 0;
  private n = 0;

  private async record(s: Sent): Promise<SendResult> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('WhatsApp API 500');
    }
    this.sent.push(s);
    return { messageId: `wamid.${++this.n}` };
  }
  sendText(to: string, text: string) {
    return this.record({ type: 'text', to, text });
  }
  sendButtons(to: string, text: string, buttons: Button[]) {
    return this.record({ type: 'buttons', to, text, buttons });
  }
  sendTemplate(to: string, template: TemplateMessage) {
    return this.record({ type: 'template', to, template });
  }
  last(): Sent {
    return this.sent[this.sent.length - 1]!;
  }
  lastText(): string {
    const s = this.last();
    return s.type === 'template' ? s.template.bodyParams.join(' | ') : s.text;
  }
}

export function extraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    title: 'Veri Analisti Stajyeri',
    category: 'job',
    organization: 'Örnek Fintech',
    deadline: null,
    deadline_source: null,
    deadline_evidence: null,
    event_time: null,
    event_evidence: null,
    location: null,
    effort_minutes: 45,
    requirements: ['CV', 'Motivasyon yazısı'],
    key_notes: [],
    next_action: "CV'yi güncelle ve başvur",
    question_for_user: null,
    off_topic: false,
    source_text: null,
    ...overrides,
  };
}

/** Yerel model taklidi: her çağrıda sıradaki yanıtı JSON metni olarak döndürür. */
export class FakeLlm {
  calls: ChatRequest[] = [];
  constructor(public responses: (Extraction | Record<string, unknown> | 'no_json')[] = []) {}

  client(): LlmClient {
    return {
      chat: async (req) => {
        this.calls.push(req);
        const next = this.responses.shift() ?? 'no_json';
        return next === 'no_json' ? 'Üzgünüm, yardımcı olamam.' : JSON.stringify(next);
      },
    };
  }
}

export interface TestEnv {
  deps: AppDeps;
  store: MemoryStore;
  notifier: FakeNotifier;
  llm: FakeLlm;
  clock: { now: Date };
  media: Map<string, { data: Buffer; mimeType: string }>;
  stored: string[];
  removed: string[];
  transcripts: string[];
  pages: Map<string, string>;
  /** Taranmış PDF için "render" edilecek sayfa görüntüleri. */
  pdfPages: Buffer[];
}

export function createEnv(now = ist('2026-10-20T12:00')): TestEnv {
  const store = new MemoryStore();
  const notifier = new FakeNotifier();
  const llm = new FakeLlm();
  const clock = { now };
  const media = new Map<string, { data: Buffer; mimeType: string }>();
  const stored: string[] = [];
  const removed: string[] = [];
  const transcripts: string[] = [];
  const pages = new Map<string, string>();
  const pdfPages: Buffer[] = [];

  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const html = pages.get(url);
    if (html === undefined) return new Response('not found', { status: 404 });
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }) as typeof fetch;

  const deps: AppDeps = {
    store,
    notifier,
    media: {
      async downloadMedia(id) {
        const m = media.get(id);
        if (!m) throw new Error('medya yok');
        return m;
      },
    },
    storage: {
      async put(userId, _data, mimeType) {
        const path = `${userId}/${stored.length + 1}.${mimeType.split('/')[1]}`;
        stored.push(path);
        return path;
      },
      async remove(paths) {
        removed.push(...paths);
      },
    },
    transcriber: {
      async transcribe() {
        return transcripts.shift() ?? '';
      },
    },
    llm: llm.client(),
    extractModel: 'test-model',
    renderPdf: async () => pdfPages.splice(0),
    fetch: fakeFetch,
    safeHost: async () => true,
    now: () => clock.now,
    log: () => undefined,
  };
  return { deps, store, notifier, llm, clock, media, stored, removed, transcripts, pages, pdfPages };
}

export async function addUser(env: TestEnv, phone = '905551112233') {
  return env.store.touchUser(
    { address: phone, displayName: 'Deneme', timezone: ZONE, quietStart: '22:00', quietEnd: '08:00' },
    env.clock.now,
  );
}
