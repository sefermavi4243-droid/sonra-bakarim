import { describe, expect, it } from 'vitest';
import type { InboundMessage } from '../src/db/schema.js';
import { processInbound } from '../src/jobs/process.js';
import { TEXT } from '../src/notify/messages.js';
import { type TestEnv, addUser, createEnv, extraction, show } from './helpers/fakes.js';

let seq = 0;
async function receive(env: TestEnv, payload: Record<string, unknown>, phone = '905551112233') {
  const user = await addUser(env, phone);
  const id = `wamid.${++seq}`;
  const msg: InboundMessage = {
    messageId: id,
    userId: user.id,
    type: String(payload.type),
    payload: { from: phone, id, timestamp: '1', ...payload },
    receivedAt: env.clock.now,
    processedAt: null,
  };
  env.store.inbound.push(msg);
  await processInbound(env.deps, msg);
  return user;
}
const text = (body: string) => ({ type: 'text', text: { body } });

const LINKEDIN_URL = 'https://www.linkedin.com/jobs/view/123456?trk=share&utm_source=wa';
const LINKEDIN_HTML = `<!doctype html><html><head><title>Veri Analisti Stajyeri - Örnek Fintech</title></head><body>
<article><h1>Veri Analisti Stajyeri</h1>
<p>Örnek Fintech, İstanbul ofisinde hibrit çalışacak bir veri analisti stajyeri arıyor. Ekibimiz ödeme verileri üzerinde
çalışıyor ve stajyerimiz haftada üç gün SQL ve Python ile raporlar hazırlayacak.</p>
<p>Aradığımız nitelikler: üniversitelerin ilgili bölümlerinde okuyan, SQL ve Python bilen, veriyle hikâye anlatmayı seven
adaylar. Staj altı ay sürecek ve yarı zamanlı olacak.</p>
<p>Son başvuru: 24 Ekim 2026. Başvuru için CV ve kısa bir motivasyon yazısı gönderin.</p></article></body></html>`;

describe('link', () => {
  it('LinkedIn ilan linki doğru kayda dönüşür ve kart gelir', async () => {
    const env = createEnv();
    env.pages.set(LINKEDIN_URL, LINKEDIN_HTML);
    env.llm.responses.push(
      extraction({ deadline: '2026-10-24T23:59:00+03:00', deadline_source: 'explicit', deadline_evidence: 'Son başvuru: 24 Ekim 2026' }),
    );
    await receive(env, text(`Buna bakarım ${LINKEDIN_URL}`));

    expect(env.store.items).toHaveLength(1);
    const item = env.store.items[0]!;
    expect(item).toMatchObject({ sourceType: 'link', sourceUrl: 'https://linkedin.com/jobs/view/123456', category: 'job', deadlineSource: 'explicit' });
    expect(show(item.deadlineAt!)).toBe('2026-10-24T23:59');

    const prompt = JSON.stringify(env.llm.calls[0]!.messages);
    expect(prompt).toContain('Son başvuru: 24 Ekim 2026');
    expect(prompt).toContain('Buna bakarım');

    const card = env.notifier.last();
    expect(card.type).toBe('buttons');
    if (card.type !== 'buttons') return;
    expect(card.text).toContain('Rafa koydum: *Veri Analisti Stajyeri*');
    expect(card.text).toContain('Son tarih: 24 Ekim Cumartesi 23:59');
    expect(card.text).toContain('Gerekenler: CV, Motivasyon yazısı');
    expect(card.text).toContain('Süre: yaklaşık 45 dakika');
    expect(card.buttons.map((b) => b.title)).toEqual(['Tamam', 'Tarihi değiştir', 'Hemen hazırla']);

    expect(env.store.reminders.map((r) => [r.kind, show(r.sendAt)])).toEqual([
      ['plan', '2026-10-22T20:00'],
      ['nudge', '2026-10-23T10:00'],
      ['last_call', '2026-10-24T09:00'],
    ]);
  });

  it('aynı link ikinci kez gelince yeniden işlenmez', async () => {
    const env = createEnv();
    env.pages.set(LINKEDIN_URL, LINKEDIN_HTML);
    env.llm.responses.push(extraction());
    await receive(env, text(LINKEDIN_URL));
    await receive(env, text('https://linkedin.com/jobs/view/123456'));
    expect(env.store.items).toHaveLength(1);
    expect(env.llm.calls).toHaveLength(1);
    expect(env.notifier.lastText()).toContain('zaten rafta');
  });

  it('giriş isteyen ya da metni kısa sayfa için ekran görüntüsü istenir', async () => {
    const env = createEnv();
    env.pages.set('https://x.com/user/status/1', '<html><body>Giriş yap</body></html>');
    await receive(env, text('https://x.com/user/status/1'));
    expect(env.notifier.lastText()).toBe(TEXT.linkNeedsScreenshot);
    expect(env.llm.calls).toHaveLength(0);
    expect(env.store.items).toHaveLength(0);
  });
});

describe('ekran görüntüsü ve PDF', () => {
  it('ekran görüntüsü kayda dönüşür, medya özel depoya konur', async () => {
    const env = createEnv();
    env.media.set('img1', { data: Buffer.from('jpeg-bytes'), mimeType: 'image/jpeg' });
    env.llm.responses.push(
      extraction({
        title: 'Yapay Zekâ Hackathonu',
        category: 'event',
        event_time: '2026-11-07T10:00:00+03:00',
        event_evidence: '7 Kasım 10:00',
        deadline: '2026-11-01',
        deadline_evidence: 'Kayıt: 1 Kasım',
        source_text: 'YAPAY ZEKÂ HACKATHONU\n7 Kasım 10:00 · İTÜ\nKayıt: 1 Kasım',
        location: 'İTÜ',
      }),
    );
    await receive(env, { type: 'image', image: { id: 'img1', mime_type: 'image/jpeg', caption: '' } });

    const call = env.llm.calls[0]!;
    const content = call.messages[1]!.content as { type: string }[];
    expect(content[0]!.type).toBe('image_url');
    const item = env.store.items[0]!;
    expect(item).toMatchObject({ sourceType: 'image', category: 'event', location: 'İTÜ' });
    expect(show(item.deadlineAt!)).toBe('2026-11-01T23:59');
    expect(show(item.eventAt!)).toBe('2026-11-07T10:00');
    expect(item.mediaPath).toBe(env.stored[0]);
  });

  it('taranmış PDF sayfaları görüntüye çevrilip okunur', async () => {
    const env = createEnv();
    env.media.set('pdf1', { data: Buffer.from('%PDF-1.4 taranmış'), mimeType: 'application/pdf' });
    env.pdfPages.push(Buffer.from('png-1'), Buffer.from('png-2'));
    env.llm.responses.push(
      extraction({
        title: 'Erasmus+ Öğrenim Hareketliliği',
        category: 'application',
        deadline: '2026-11-15T17:00:00+03:00',
        deadline_evidence: 'Son başvuru tarihi: 15.11.2026 saat 17:00',
        source_text: 'ERASMUS+\nSon başvuru tarihi: 15.11.2026 saat 17:00',
      }),
    );
    await receive(env, { type: 'document', document: { id: 'pdf1', mime_type: 'application/pdf', filename: 'erasmus.pdf' } });

    const content = env.llm.calls[0]!.messages[1]!.content as { type: string }[];
    expect(content.map((c) => c.type)).toEqual(['image_url', 'image_url', 'text']);
    const item = env.store.items[0]!;
    expect(item).toMatchObject({ sourceType: 'document', category: 'application' });
    expect(show(item.deadlineAt!)).toBe('2026-11-15T17:00');
  });

  it('görüntüye çevrilemeyen PDF için ekran görüntüsü istenir', async () => {
    const env = createEnv();
    env.media.set('pdf2', { data: Buffer.from('bozuk'), mimeType: 'application/pdf' });
    await receive(env, { type: 'document', document: { id: 'pdf2', mime_type: 'application/pdf' } });
    expect(env.llm.calls).toHaveLength(0);
    expect(env.notifier.lastText()).toBe(TEXT.unreadable);
  });

  it('desteklenmeyen dosya türü kibarca reddedilir', async () => {
    const env = createEnv();
    env.media.set('doc1', { data: Buffer.from('x'), mimeType: 'application/msword' });
    await receive(env, { type: 'document', document: { id: 'doc1', mime_type: 'application/msword' } });
    expect(env.notifier.lastText()).toBe(TEXT.unsupportedMedia);
  });
});

describe('konu dışı ve okunamayan', () => {
  it('"Bugün hava nasıl?" kayıt oluşturmaz, yönlendirme yanıtı gelir', async () => {
    const env = createEnv();
    env.llm.responses.push(extraction({ title: 'Hava durumu', category: 'other', off_topic: true }));
    await receive(env, text('Bugün hava nasıl?'));
    expect(env.store.items).toHaveLength(0);
    expect(env.store.reminders).toHaveLength(0);
    expect(env.notifier.lastText()).toBe(TEXT.offTopic);
  });

  it('selamlaşma modele gitmeden yönlendirilir', async () => {
    const env = createEnv();
    await receive(env, text('Merhaba!'));
    expect(env.llm.calls).toHaveLength(0);
    expect(env.notifier.lastText()).toBe(TEXT.offTopic);
  });

  it('iki denemede de okunamayan içerik için ekran görüntüsü istenir', async () => {
    const env = createEnv();
    env.llm.responses.push('no_json', 'no_json');
    await receive(env, text('Şu duyuruya bakmam lazım ama tam hatırlamıyorum'));
    expect(env.notifier.lastText()).toBe(TEXT.unreadable);
    expect(env.store.items).toHaveLength(0);
  });
});

describe('sesli not', () => {
  it('"Cuma Ali\'ye dosyayı atmayı unutma" cuma tarihli bir task olur', async () => {
    const env = createEnv(); // 20 Ekim 2026 salı
    env.media.set('aud1', { data: Buffer.from('ogg'), mimeType: 'audio/ogg; codecs=opus' });
    env.transcripts.push("Cuma Ali'ye dosyayı atmayı unutma.");
    env.llm.responses.push(
      extraction({
        title: "Ali'ye dosyayı at",
        category: 'task',
        organization: null,
        deadline: '2026-10-23T23:59:00+03:00',
        deadline_source: 'inferred',
        deadline_evidence: 'Cuma',
        effort_minutes: 5,
        requirements: [],
        next_action: "Dosyayı Ali'ye gönder",
      }),
    );
    await receive(env, { type: 'audio', audio: { id: 'aud1', mime_type: 'audio/ogg; codecs=opus' } });

    expect(JSON.stringify(env.llm.calls[0]!.messages)).toContain('Sesli not dökümü');
    const item = env.store.items[0]!;
    expect(item).toMatchObject({ sourceType: 'audio', category: 'task', deadlineSource: 'inferred' });
    expect(show(item.deadlineAt!)).toBe('2026-10-23T23:59');
    expect(item.rawText).toBe("Cuma Ali'ye dosyayı atmayı unutma.");
  });

  it('yazıya dökme kapalıysa yazılı mesaj istenir', async () => {
    const env = createEnv();
    env.deps.transcriber = null;
    env.media.set('aud3', { data: Buffer.from('ogg'), mimeType: 'audio/ogg' });
    await receive(env, { type: 'audio', audio: { id: 'aud3', mime_type: 'audio/ogg' } });
    expect(env.notifier.lastText()).toBe(TEXT.voiceUnavailable);
  });

  it('yazıya dökülemeyen ses için tekrar istenir', async () => {
    const env = createEnv();
    env.media.set('aud2', { data: Buffer.from('ogg'), mimeType: 'audio/ogg' });
    await receive(env, { type: 'audio', audio: { id: 'aud2', mime_type: 'audio/ogg' } });
    expect(env.notifier.lastText()).toBe(TEXT.transcribeFailed);
  });
});

describe('belirsiz tarih', () => {
  it('soru sorulur, yanıt aynı çözücüden geçer', async () => {
    const env = createEnv();
    env.llm.responses.push(
      extraction({ title: 'Burs başvurusu', category: 'application', question_for_user: 'Başvurunun son günü ne zaman?' }),
    );
    const user = await receive(env, text('KYK bursu başvurusu yapılacak'));
    const card = env.notifier.last();
    expect(card.type === 'buttons' && card.text).toContain('Başvurunun son günü ne zaman?');
    expect(env.store.users[0]!.pendingAction).toMatchObject({ type: 'change_date' });
    expect(env.store.reminders).toHaveLength(0);

    await receive(env, text('haftaya cuma'), user.address);
    const item = env.store.items[0]!;
    expect(show(item.deadlineAt!)).toBe('2026-10-30T23:59');
    expect(item.deadlineSource).toBe('user');
    expect(env.store.users[0]!.pendingAction).toBeNull();
    expect(env.store.reminders.filter((r) => r.status === 'scheduled').length).toBeGreaterThan(0);
  });
});
