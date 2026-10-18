import { describe, expect, it } from 'vitest';
import { windowOpen } from '../src/jobs/deps.js';
import { route } from '../src/jobs/process.js';
import { createChannelRouter, type Notifier } from '../src/notify/notifier.js';
import { TelegramClient, fromTelegram, toTelegramHtml } from '../src/notify/telegram.js';
import { classify } from '../src/webhook/parse.js';
import { FakeNotifier, addUser, createEnv, ist } from './helpers/fakes.js';

const msg = (extra: Record<string, unknown>) => ({
  update_id: 7,
  message: { message_id: 1, date: 1_760_000_000, chat: { id: 42 }, from: { first_name: 'Ayşe' }, ...extra },
});

describe('Telegram güncellemesi → ortak mesaj', () => {
  it('metin', () => {
    const e = fromTelegram(msg({ text: 'listem' }))!;
    expect(e).toMatchObject({ address: 'tg:42', displayName: 'Ayşe', callbackQueryId: null });
    expect(e.message.id).toBe('tg:42:7');
    expect(classify(e.message)).toEqual({ kind: 'text', text: 'listem' });
  });

  it('/start yardım komutuna, /listem listem komutuna döner', () => {
    expect(classify(fromTelegram(msg({ text: '/start' }))!.message)).toEqual({ kind: 'text', text: 'yardım' });
    expect(classify(fromTelegram(msg({ text: '/listem@SonraBot' }))!.message)).toEqual({ kind: 'text', text: 'listem' });
  });

  it('fotoğrafın en büyük boyutu medya olarak alınır', () => {
    const e = fromTelegram(
      msg({
        caption: 'staj',
        photo: [
          { file_id: 'kucuk', width: 90, height: 90 },
          { file_id: 'buyuk', width: 1280, height: 960 },
        ],
      }),
    )!;
    expect(classify(e.message)).toMatchObject({ kind: 'media', media: 'image', mediaId: 'tg:buyuk', mimeType: 'image/jpeg', caption: 'staj' });
  });

  it('PDF belge ve sesli not', () => {
    const pdf = fromTelegram(msg({ document: { file_id: 'd1', mime_type: 'application/pdf', file_name: 'burs.pdf' } }))!;
    expect(classify(pdf.message)).toMatchObject({ kind: 'media', media: 'document', mediaId: 'tg:d1', filename: 'burs.pdf' });
    const voice = fromTelegram(msg({ voice: { file_id: 'v1', mime_type: 'audio/ogg' } }))!;
    expect(classify(voice.message)).toMatchObject({ kind: 'media', media: 'audio', mediaId: 'tg:v1' });
  });

  it('düğme basışı (callback_query)', () => {
    const e = fromTelegram({
      update_id: 8,
      callback_query: { id: 'cq1', data: 'done:abc', from: { first_name: 'Ayşe' }, message: { chat: { id: 42 } } },
    })!;
    expect(e.callbackQueryId).toBe('cq1');
    expect(e.message.id).toBe('tg:42:8');
    expect(classify(e.message)).toEqual({ kind: 'button', payload: 'done:abc' });
  });

  it('desteklenmeyen tür (çıkartma) kibarca reddedilir', () => {
    expect(classify(fromTelegram(msg({ sticker: {} }))!.message)).toEqual({ kind: 'unsupported', type: 'unsupported' });
  });
});

describe('Telegram gönderimi', () => {
  it('*kalın* HTML\'e çevrilir, özel karakterler kaçırılır', () => {
    expect(toTelegramHtml('Kaydettim: *Staj <A&B>*')).toBe('Kaydettim: <b>Staj &lt;A&amp;B&gt;</b>');
  });

  it('düğmeler inline klavye olarak gider', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }));
    }) as unknown as typeof fetch;
    const tg = new TelegramClient({ token: '1:x', fetch: fakeFetch });
    const r = await tg.sendButtons('tg:42', 'Hatırlatma', [{ id: 'done:a', title: 'Yaptım' }]);
    expect(r.messageId).toBe('99');
    expect(calls[0]!.url).toBe('https://api.telegram.org/bot1:x/sendMessage');
    expect(calls[0]!.body).toMatchObject({
      chat_id: '42',
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Yaptım', callback_data: 'done:a' }]] },
    });
  });
});

describe('kanal yönlendirici', () => {
  it('tg: önekli adres Telegram\'a, diğerleri WhatsApp\'a gider', async () => {
    const wa = new FakeNotifier();
    const tg = new FakeNotifier();
    const router = createChannelRouter({ whatsapp: wa, telegram: tg as unknown as Notifier });
    await router.sendText('tg:42', 'a');
    await router.sendText('905551112233', 'b');
    expect(tg.sent).toHaveLength(1);
    expect(wa.sent).toHaveLength(1);
  });

  it('yapılandırılmamış kanala gönderim hata verir', async () => {
    const router = createChannelRouter({ telegram: new FakeNotifier() });
    await expect(router.sendText('905551112233', 'x')).rejects.toThrow(/whatsapp/);
  });
});

describe('Telegram kullanıcısı', () => {
  it('24 saat penceresi her zaman açık sayılır', async () => {
    const env = createEnv(ist('2026-10-20T12:00'));
    const user = await addUser(env, 'tg:42');
    expect(windowOpen({ ...user, lastInboundAt: ist('2026-10-01T12:00') }, env.clock.now)).toBe(true);
  });

  it('komutlar Telegram adresine yanıtlanır', async () => {
    const env = createEnv();
    const user = await addUser(env, 'tg:42');
    await route(env.deps, user, classify(fromTelegram(msg({ text: '/start' }))!.message));
    const last = env.notifier.sent.at(-1)!;
    expect(last.to).toBe('tg:42');
  });
});
