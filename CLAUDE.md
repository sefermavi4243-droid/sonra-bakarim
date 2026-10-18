# Sonra Bakarım

Kullanıcının "sonra bakarım" dediği şeyleri (link, ekran görüntüsü, sesli not, PDF,
iletilen mesaj) WhatsApp üzerinden yakalayan, son tarihini çıkaran, işi önceden
hazırlayan ve zamanında hatırlatan bir servis.

- Ürünün tamamı: `docs/SPEC.md`
- Fazlar, görevler ve kabul ölçütleri: `docs/ROADMAP.md`
- Şu an üzerinde çalışılan faz: **Faz 1** + öne alınan **Paket 2+** (ROADMAP'te başka faza geçildiyse burayı güncelle)

## Değişmez ürün kuralları

1. **Bot genel amaçlı sohbet botu değildir.** Yalnızca kaydetme, listeleme, hatırlatma
   ve hazırlık yapar. Konu dışı mesajlara tek cümlelik bir yönlendirme verir.
   WhatsApp Business API 15 Ocak 2026'dan beri genel amaçlı yapay zekâ asistanlarını
   yasaklıyor; bu kural ürünün yaşaması için şart.
2. **Yapay zekâ tarih uydurmaz.** `deadline_evidence` metinden aynen alınmış bir cümle
   değilse `deadline` null kalır. Boş tarihleri yalnızca `src/rules/defaults.ts` doldurur.
3. **Belirsiz tarih kullanıcıya sorulur** (`question_for_user` alanı).
4. **24 saatlik pencere kapalıysa yalnızca onaylı utility şablonları gönderilir.**
   Şablon metinleri `templates/` klasöründe; tanıtım dili kullanılmaz.
5. **Bir kayıt için en fazla 3 hatırlatma.** Sessiz saatlerde (varsayılan 22:00–08:00)
   mesaj gönderilmez, bir sonraki uygun saate kayar.
6. **Bildirimler kanaldan bağımsızdır.** Tüm gönderimler `Notifier` arayüzünden geçer:
   `whatsapp` (birincil), `telegram` ve `webpush` (yedek).
7. **Her kayıt bir `user_id`'ye bağlıdır.** Sistem baştan çok kullanıcılı tasarlanır.
8. **Kullanıcıya giden tüm metinler Türkçedir.** Varsayılan saat dilimi `Europe/Istanbul`;
   tarihler veritabanında UTC (`timestamptz`) saklanır.

## Teknik yığın

- TypeScript (strict), Node LTS, Hono, Drizzle ORM, zod, Vitest
- Postgres ve dosya depolama: Supabase. `DATABASE_URL` boşsa gömülü Postgres (PGlite,
  `./data/pg`) ve yerel medya klasörü (`./data/media`) kullanılır.
- Kanallar: Telegram Bot API (uzun yoklama, tünel gerekmez) ve WhatsApp Cloud API.
  En az biri `.env`'de dolu olmalı. Telegram adresleri `tg:<chat_id>`; Telegram'da
  24 saat penceresi yoktur, şablon gönderilmez.
- WhatsApp: resmi Cloud API (Meta Graph API). `whatsapp-web.js`, `Baileys` gibi resmi
  olmayan kütüphaneler **yasak**.
- Dil modeli: **yerel**, ücretli API yok. OpenAI uyumlu `/chat/completions` ucu
  (Ollama, LM Studio, llama.cpp); adres ve model `.env`'de `LLM_BASE_URL`, `LLM_MODEL`.
  Yapılandırılmış çıktı JSON şemasıyla (`response_format`) alınır ve zod ile doğrulanır;
  doğrulanamayan çıktı bir kez yeniden denenir, sonra kullanıcıya "Bunu okuyamadım,
  ekran görüntüsü atar mısın?" denir. Taranmış (metinsiz) PDF'lerde de aynı yanıt verilir.
- Sesi yazıya dökme isteğe bağlı (`TRANSCRIBE_BASE_URL`, OpenAI uyumlu yerel whisper).
- Sayfa okuma: `@mozilla/readability` + `jsdom`
- Zamanlayıcı: dakikada bir çalışan iş; `reminders` tablosundan `send_at <= now()`
  olanları `FOR UPDATE SKIP LOCKED` ile alır.

## Klasör yapısı

```
src/
  webhook/   WhatsApp webhook: GET doğrulama, X-Hub-Signature-256 kontrolü, hemen 200
  ingest/    link okuma, medya indirme, sesi yazıya dökme
  extract/   Claude çağrıları, istemler, zod şemaları
  rules/     varsayılan tarih kuralları, hatırlatma planlama
  notify/    Notifier arayüzü, kanallar, şablon gönderimi
  jobs/      zamanlayıcı ve kuyruk işleyici
  db/        Drizzle şeması ve migration'lar
  api/       uzantı ve panel için HTTP API (cihaz anahtarı ya da panel çerezi)
  calendar/  .ics üretimi
templates/   WhatsApp şablon metinleri (Meta onayına gidecek hâliyle)
web/         web paneli (derleme yok, düz HTML/CSS/JS)
extension/   tarayıcı uzantısı (Manifest V3, derleme yok)
tests/
```

## Komutlar

- `npm run dev` — sunucuyu izleme modunda açar (webhook + zamanlayıcı). `.env` gerekir.
- `npm test` — birim testleri (dış servis yok).
- `npm run test:live` — `*.live.test.ts`: gerçek Postgres ve yerel model (açık olmalı).
- `npm run migrate` — `src/db/migrations` içindeki migration'ları `DATABASE_URL`'e (boşsa yerel PGlite'a) uygular.
- `npm run db:generate` — `src/db/schema.ts` değişince yeni migration üretir.
- `npm run lint` — `tsc --noEmit` (strict tip kontrolü).
- `npm run rapor [-- adet]` — Kapı 1 tablosu: son kayıtların çıkan tarihleri ve kanıtları.
- `npm run bagla` — bot açıkken, Telegram'a gitmeden uzantı/panel için bağlantı kodu verir.
- `scripts\setup-whisper.ps1` — yerel sesi yazıya dökme sunucusunu kurar (bir kez).
- `scripts\install-autostart.ps1` — bot ve Whisper Windows açılışında gizli başlar, çökerse
  yeniden kalkar; günlükler `data\logs\`. Kaldırmak için `scripts\uninstall-autostart.ps1`.

## Çalışma şekli

- Her görevde önce kısa bir plan yaz ve onay bekle; sonra kodla.
- Tarih kuralları, saat dilimleri ve hatırlatma planlaması için birim testi zorunlu.
- Dış servisler (WhatsApp, dil modeli) testlerde taklit edilir. Gerçek çağrı yapan testler
  `*.live.test.ts` adını alır ve varsayılan test koşusunda çalışmaz.
- Gizli anahtarlar yalnızca `.env` içinde; `.env.example` her zaman güncel tutulur.
- Bir görev bitince `docs/ROADMAP.md`'deki kabul ölçütlerini tek tek kontrol et ve
  sonucu yaz.
