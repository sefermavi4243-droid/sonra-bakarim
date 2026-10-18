# Sonra Bakarım — Ürün Spesifikasyonu

Son güncelleme: 15 Ekim 2026. WhatsApp kuralları ve fiyatları bu tarihte doğrulandı;
Meta bunları üç ayda bir değiştirebilir (bkz. Kaynaklar).

## 1. Özet

Sonra Bakarım, "sonra bakarım" denen her şeyi WhatsApp'tan yakalayan kişisel bir asistan.
Kaydın son tarihini çıkarır, işin bir kısmını önceden hazırlar ve kullanıcıyı doğru
zamanda dürter. Bir hatırlatıcı değil, bir **hazırlayıcı**: "yarın son gün" demekle
kalmaz, "başvuru mektubun hazır, kontrol et ve gönder" der.

Üç ilke:

- **Yüklenecek uygulama yok.** Arayüz WhatsApp.
- **Ne atıldığı önemli değil.** Link, ekran görüntüsü, sesli not, afiş fotoğrafı,
  iletilen mesaj, PDF, e-posta.
- **Başarı bitirilenle ölçülür.** Kaç şey kaydedildiği değil, kaçının yapıldığı ya da
  bilinçli olarak bırakıldığı.

## 2. Hedef kullanıcı ve problem

İlk hedef kitle:

- Üniversite öğrencileri ve yeni mezunlar: staj, burs, Erasmus, hackathon, kariyer günü
- İş arayanlar: LinkedIn, Kariyer.net, X ve şirket sitelerinde kaydedilen ilanlar
- Serbest çalışanlar ve meraklılar: denenecek araçlar, kurslar, etkinlikler

Çözülen problem üç parçalı:

1. Kaydedilenler dağınık; her uygulamanın kendi "kaydedilenler" klasörü var.
2. Hiçbiri son tarihi takip etmiyor.
3. Son tarih geldiğinde iş hâlâ sıfırdan yapılmayı bekliyor. Hatırlatma gelse bile
   "şimdi iki saatim yok" diye iş yine ertelenir.

## 3. Girdiler

| Ne atılır | Bot ne yapar |
| --- | --- |
| Link (LinkedIn, X, haber, etkinlik sayfası) | Sayfayı okur. Giriş gerektiren bir sayfaysa ya da metin çıkmazsa ekran görüntüsü ister. |
| Ekran görüntüsü | Görseldeki metni ve tarihleri okur (Claude görsel girdi). |
| Afiş ya da broşür fotoğrafı | Etkinlik adını, yeri, tarihi çıkarır; QR kod varsa linkini çözer. |
| Sesli not | Yazıya döker ve niyeti anlar: "Cuma Ali'ye dosyayı atmayı unutma." |
| Bir gruptan iletilen mesaj | Duyurudaki tarihi ve yapılacak işi çıkarır. |
| PDF (burs yönergesi, şartname) | Son tarihi ve istenen belgelerin listesini çıkarır. |
| E-posta (kullanıcıya özel adrese iletilen) | Mülakat daveti, etkinlik onayı, son ödeme günü. (Faz 3) |
| Chrome eklentisinden gelen sayfa metni | Tarayıcıda açık, giriş yapılmış sayfanın metni. (Faz 3) |

LinkedIn ve X'e API ya da kazıma ile bağlanılmaz. Kullanıcı içeriği kendisi paylaşır.

## 4. Bir kaydın yolculuğu

1. **At.** Paylaş → WhatsApp → Sonra Bakarım. Tek dokunuş.
2. **Anlar.** Birkaç saniye içinde bir kart döner: başlık, tür, son tarih, gerekenler,
   tahmini süre.
3. **Onaylar.** Kartın altında üç düğme: *Tamam*, *Tarihi değiştir*, *Hemen hazırla*.
   Tarih belirsizse bot sorar, uydurmaz.
4. **Hazırlar.** Türe göre işin bir kısmını önceden yapar (bkz. Özellikler).
5. **Dürter.** Geriye doğru hesaplanmış zamanlarda, sessiz saatlere uyarak.
6. **Kapatır.** *Yaptım*, *Ertele* ya da *Vazgeç*. Hiçbir kayıt sonsuza kadar açık kalmaz.

Örnek konuşma:

> **Kullanıcı:** (LinkedIn ilan linki)
>
> **Sonra Bakarım:** Kaydettim: *Veri Analisti Stajyeri, bir fintech şirketi.*
> İlanda son tarih yok; erken başvuran öne çıkar, bu yüzden cumartesi 11:00'e koydum.
> Gerekenler: CV ve kısa bir motivasyon yazısı, yaklaşık 45 dakika.
>
> [Tamam] [Tarihi değiştir] [Hemen hazırla]

Kart metni kısa tutulur; WhatsApp'ta en fazla 3 hızlı yanıt düğmesi kullanılır.

## 5. Özellikler

| # | Özellik | Ne yapar | Faz |
| --- | --- | --- | --- |
| 1 | Yakalama ve çıkarım | Her girdi türünden başlık, tür, son tarih, gerekenler, süre | 1 |
| 2 | Hatırlatma ve kapatma | Planlı hatırlatmalar; Yaptım / Ertele / Vazgeç | 1 |
| 3 | Sesli not | Sesi yazıya döker, kayda çevirir | 1 |
| 4 | Geriye doğru planlama | Süreyi tahmin eder; hatırlatmayı son güne değil, işe başlanması gereken boş bir akşama koyar | 2 |
| 5 | Hazır gelen iş | İlan: CV'ye göre ön yazı taslağı ve eksik anahtar kelimeler. Etkinlik: takvim kaydı. Burs: işaretlenebilir belge listesi. Araç: 15 dakikalık deneme planı. Yazı: üç cümlelik özet. | 2 |
| 6 | Pazar akşamı hesaplaşması | Haftalık özet: kaydedilen, yapılan, süresi geçen; kalanlar için tut / seç / hepsinden vazgeç | 2 |
| 7 | Ölü ilan dedektörü | Açılabilen linkleri belli aralıklarla kontrol eder; ilan kalktıysa haber verir ve kaydı kapatır | 2 |
| 8 | Takvim linki | Kullanıcıya özel ICS adresi; Google ve Apple Takvim abone olur | 2 |
| 9 | Chrome eklentisi | Tarayıcıdaki sayfayı tek tıkla kaydeder; bota "bağla" yazınca gelen 6 haneli kodla eşleşir | 3 |
| 10 | E-posta adresi | Kullanıcıya özel adrese iletilen e-postaları kayda çevirir | 3 |
| 11 | Web paneli | Liste, takvim görünümü, filtreler, arşiv | 3 |
| 12 | Tekrar birleştirme | Aynı ilan iki yerden kaydedildiyse tek kayda indirir; benzerleri karşılaştırır | 3 |
| 13 | Ritmi öğrenme | Kullanıcının yanıt verdiği saatlere göre zamanlamayı ayarlar | 3 |
| 14 | Arkadaşına gönder | Fırsatı "Bana da hatırlat" linkiyle iletir; isteğe bağlı hesap ortağı modu | 4 |
| 15 | Organizatör linki | Kulüp ya da etkinlik sahibi için "Sonra Bakarım'a ekle" linki ve QR | 4 |

## 6. WhatsApp kuralları ve maliyet

1. **Genel amaçlı yapay zekâ botu olamaz.** 15 Ocak 2026'dan beri WhatsApp Business
   API'de genel amaçlı yapay zekâ asistanları yasak. Bildirim, hatırlatma, rezervasyon
   gibi belirli bir işe odaklı botlara izin var; yapay zekâ ana ürün değil, hizmetin
   bir parçası olmalı. Konu dışı sorulara yanıt:
   "Ben sadece kaydettiklerinle ilgilenirim. Bir link, ekran görüntüsü ya da sesli not at."
2. **Hatırlatmalar onaylı şablonla gider.** Kullanıcının son mesajından sonraki 24 saat
   içinde serbest mesaj atılabilir. Pencere kapalıysa yalnızca Meta onaylı şablonlar
   gönderilebilir. Tüm hatırlatma şablonları "utility" kategorisinde olmalı; tanıtım
   dili şablonu pazarlama kategorisine düşürür (Türkiye'de yaklaşık 12 kat pahalı).
3. **Her mesajın küçük bir maliyeti var.** 1 Ekim 2026'dan beri 24 saat içindeki
   yanıtlar da ücretli; her işletme numarasına ayda ilk 1.000 yanıt ücretsiz.

   | Mesaj türü | Üründe ne için | Türkiye (USD/mesaj, 1 Ekim 2026) |
   | --- | --- | --- |
   | 24 saat içindeki yanıt | Kayıt kartı, onay, sohbet | Ayda ilk 1.000 ücretsiz, sonra 0,0009 |
   | Utility şablonu | Hatırlatma, haftalık özet | 0,0009 |
   | Pazarlama şablonu | Kullanılmaz | 0,0109 |

   Kaba hesap: ayda 20 kayıt, kayıt başına 3 hatırlatma ve haftalık özet alan bir
   kullanıcı yaklaşık 64 şablon ve 40 yanıt üretir; 1.000 kullanıcı için ayda yaklaşık
   93 dolar.
4. **Yalnızca resmi Cloud API.** WhatsApp Web'i taklit eden kütüphaneler kurallara
   aykırıdır ve numaranın kapatılmasına yol açabilir.

Geliştirme ücretsiz: Meta'nın verdiği test numarasıyla 5 alıcıya kadar ücretsiz mesaj
atılabilir. Yayın için kendi numara ve doğrulanmış Meta işletme hesabı gerekir.

## 7. Mimari

```
YAKALAMA                 SUNUCU (TypeScript, Node, Hono)                 ÇIKTI
WhatsApp ─────────┐
Chrome eklentisi ─┼──> Webhook ve API ──> İşleyici ──> Claude API
E-posta adresi ───┘     (imza, kuyruk)    (sayfa,       (çıkarım,
                              ▲            medya, ses)    hazırlık)
                              │                              │
   Düğme basışları ───────────┘                              ▼
                                                   Kurallar ve planlayıcı
                                                   (boş tarih, hatırlatma zamanları)
                                                             │
                                                             ▼
                                                   Postgres (Supabase) ──> Web paneli
                                                             │          ──> Takvim (ICS)
                                                             ▼
                                                        Zamanlayıcı ──> WhatsApp şablonu
                                                                    ──> Telegram, web push
```

Yapay zekâ çıkarır ve hazırlar; tarihleri ve zamanlamayı sabit, test edilmiş kurallar
belirler.

| Bileşen | Seçim | Neden |
| --- | --- | --- |
| Dil ve sunucu | TypeScript, Node, Hono | Bot, eklenti ve panel tek dilde |
| Veritabanı ve dosyalar | Supabase (Postgres, Storage) | Ücretsiz katman, hazır giriş sistemi |
| WhatsApp | Resmi Cloud API | Kurallara uygun tek yol |
| Yapay zekâ | Claude: hızlı model çıkarım, güçlü model hazırlık | Çıkarım ucuz, ön yazı kaliteli |
| Sesi yazıya dökme | Bir konuşma tanıma servisi (ör. Whisper) | Sesli notlar |
| Sayfa okuma | Mozilla Readability + jsdom | Haber ve ilanlardan temiz metin |
| Chrome eklentisi | WXT (Manifest V3) | Hazır eklenti iskeleti |
| Barındırma | Railway ya da Fly.io | Webhook ve zamanlayıcı için sürekli açık sunucu |

Webhook işleyişi: Meta'ya 200 hemen döner; asıl iş kuyrukta yapılır. Meta aynı
mesajı tekrar gönderebilir, bu yüzden `wa_message_id` ile tekrar işleme engellenir.

## 8. Veri modeli

| Tablo | Ne tutar | Önemli alanlar |
| --- | --- | --- |
| `users` | Kullanıcı ve tercihleri | `id`, `whatsapp_phone` (benzersiz), `display_name`, `timezone`, `quiet_start`, `quiet_end`, `preferred_hour`, `digest_day`, `cv_text`, `last_inbound_at`, `created_at` |
| `items` | Her kaydedilen şey | `id`, `user_id`, `source_type`, `source_url`, `raw_text`, `media_path`, `title`, `category`, `organization`, `deadline_at`, `deadline_source`, `deadline_evidence`, `event_at`, `location`, `effort_minutes`, `requirements` (jsonb), `key_notes` (jsonb), `next_action`, `status`, `dedupe_hash`, `created_at`, `closed_at` |
| `reminders` | Planlanmış her bildirim | `id`, `item_id`, `user_id`, `kind`, `send_at`, `channel`, `status`, `wa_message_id`, `sent_at`, `error` |
| `preps` | Önceden hazırlanan işler | `id`, `item_id`, `kind` (cover_letter, checklist, summary, trial_plan), `content`, `created_at` |
| `interactions` | Düğme basışları ve yanıtlar | `id`, `user_id`, `item_id`, `action`, `at` |
| `inbound_messages` | Gelen WhatsApp mesajları (tekrar işlemeyi önler) | `wa_message_id` (benzersiz), `user_id`, `type`, `payload` (jsonb), `processed_at` |

Değer kümeleri:

- `source_type`: `link`, `image`, `audio`, `document`, `text`, `extension`, `email`
- `category`: `job`, `event`, `application`, `tool`, `read`, `task`, `other`
- `deadline_source`: `explicit`, `inferred`, `default`, `user`
- `status` (items): `open`, `snoozed`, `done`, `dropped`, `expired`
- `kind` (reminders): `plan`, `nudge`, `last_call`, `event_eve`, `event_soon`, `digest`
- `status` (reminders): `scheduled`, `sent`, `failed`, `cancelled`

`last_inbound_at`, 24 saatlik pencerenin açık olup olmadığını belirler: açıksa serbest
mesaj, kapalıysa utility şablonu.

## 9. Çıkarım şeması

Claude her kayıttan şu yapıyı tool use ile döndürür; çıktı zod ile doğrulanır.

```json
{
  "title": "Veri Analisti Stajyeri",
  "category": "job",
  "organization": "Şirket ya da kurum adı",
  "deadline": "2026-10-24T23:59:00+03:00",
  "deadline_source": "explicit",
  "deadline_evidence": "Son başvuru: 24 Ekim 2026",
  "event_time": null,
  "location": "İstanbul, hibrit",
  "effort_minutes": 45,
  "requirements": ["CV", "Motivasyon yazısı"],
  "key_notes": ["SQL ve Python bekleniyor", "6 aylık, yarı zamanlı"],
  "next_action": "CV'yi güncelle ve başvur",
  "question_for_user": null,
  "off_topic": false
}
```

Kurallar:

- **Tarih uydurulmaz.** `deadline_evidence` girdi metninde aynen geçmiyorsa kod
  `deadline`'ı null yapar (modelin sözüne güvenilmez, alt dize kontrolü yapılır).
- **Göreli tarihler** ("cuma", "haftaya") kaydın geldiği ana ve kullanıcının saat
  dilimine göre çözülür; birden fazla anlam varsa `question_for_user` dolar.
- **Yalnızca tarih verilmişse** saat 23:59 kabul edilir.
- **`off_topic: true`** ise kayıt oluşturulmaz; yönlendirme yanıtı gönderilir.
- İstem, girdi metnini veri olarak işaretler; içindeki talimatlara uyulmaz.

Son tarih yoksa `src/rules/defaults.ts`:

| Tür | Varsayılan |
| --- | --- |
| `job` | Kayıttan 2 gün sonra 11:00, "erken başvur" |
| `event` | Etkinlik tarihi esas alınır; kayıt tarihi yoksa etkinlikten 3 gün önce |
| `application` | Kullanıcıya sorulur |
| `tool`, `read` | Tarih verilmez; pazar özetine girer. 14 gün sonra "hâlâ istiyor musun?" diye sorulur |
| `task` | Kullanıcıya sorulur |

## 10. Hatırlatma planlama

Başlangıç kuralları. Hepsi birim testleriyle sabitlenir; sonraki fazlarda kullanıcı
davranışına göre ayarlanır. `D` = son tarih, `E` = tahmini süre (dakika).

1. **`plan`**: `D − (ceil(E / 60) + 1)` gün, kullanıcının tercih saatinde
   (varsayılan 20:00). Yalnızca `E >= 30` ise.
2. **`nudge`**: `D − 1` gün, 10:00.
3. **`last_call`**: `D` günü 09:00. `D` 12:00'den önceyse atlanır ve `nudge`
   `D − 1` gün 20:00'ye kayar.
4. **Etkinlikler**: `event_eve` = etkinlikten bir gün önce 20:00,
   `event_soon` = etkinlikten 2 saat önce.
5. Geçmişe düşen hatırlatmalar atılır. Hiçbiri kalmadıysa ve `D` gelecekteyse hemen
   tek bir hatırlatma gönderilir.
6. Sessiz saate düşen hatırlatma bir sonraki uygun saate kayar; kayınca `D`'yi
   geçiyorsa sessiz saat başlamadan hemen önceye alınır.
7. Kayıt başına en fazla 3 hatırlatma. Kayıt kapanınca bekleyen hatırlatmalar
   `cancelled` olur.
8. **Ertele** seçenekleri: 3 saat sonra, yarın aynı saat, hafta sonu (cumartesi 11:00).
   Erteleme `D`'yi geçemez.

## 11. Komutlar ve düğmeler

| Kullanıcı yazar ya da basar | Bot ne yapar |
| --- | --- |
| Herhangi bir içerik | Kaydeder, kart gönderir |
| `listem` | Açık kayıtları son tarihe göre sıralı gösterir (en fazla 10) |
| `bugün` | Bugün ve yarın son tarihi olanları gösterir |
| `yardım` | Ne yapabildiğini üç satırda anlatır |
| `bağla` | Chrome eklentisi için 6 haneli eşleştirme kodu verir (Faz 3) |
| `verilerimi sil` | Onay ister, sonra kullanıcının tüm verisini siler |
| Tamam / Tarihi değiştir / Hemen hazırla | Kart düğmeleri |
| Yaptım / Ertele / Vazgeç | Hatırlatma düğmeleri |

"Tarihi değiştir"e basınca kullanıcı tarihi serbest metinle yazar ("perşembe 18:00");
bu metin de aynı tarih çözücüden geçer.

## 12. Şablon taslakları (Meta onayına gidecek)

Hepsi Türkçe, utility kategorisi, tanıtım dili yok. Kesin metinler `templates/`
klasöründe tutulur.

- `hatirlatma_son_tarih`: "{{1}} için son tarih {{2}}. Gerekenler: {{3}}."
  Düğmeler: Yaptım, Ertele, Vazgeç.
- `hatirlatma_plan`: "{{1}} yaklaşık {{2}} sürüyor. Son tarih {{3}}; bugün başlamak
  için iyi bir zaman." Düğmeler: Başladım, Ertele.
- `etkinlik_hatirlatma`: "{{1}} {{2}} tarihinde, {{3}} konumunda." Düğmeler:
  Gideceğim, Vazgeç.
- `haftalik_ozet`: "Bu hafta {{1}} kayıt eklendi, {{2}} tanesi tamamlandı, {{3}} tanesi
  açık." Düğme: Listem.

## 13. Güvenlik ve gizlilik

- Webhook isteklerinde `X-Hub-Signature-256` doğrulanır; geçersizse 401.
- Medya dosyaları özel depolama alanında tutulur; herkese açık link verilmez.
- Kullanıcı verisi yalnızca kullanıcının kendi kayıtları için kullanılır.
- `verilerimi sil` tüm kayıtları, medyayı ve hatırlatmaları siler.
- Veriler yurt dışındaki servislere (veritabanı, Claude API) gittiği için herkese
  açmadan önce KVKK aydınlatma metni ve yurt dışına aktarım dayanağı hazırlanır;
  bir avukata danışılır.

## 14. Riskler

| Risk | Etkisi | Önlem |
| --- | --- | --- |
| Yanlış tarih çıkarımı | Kaçırılan son tarih, güven kaybı | Kanıt cümlesi zorunlu, alt dize kontrolü, belirsizse sorma, kartta tarih açıkça |
| Meta botu genel amaçlı sayar ya da kuralları daraltır | Ana kanal kapanır | Dar kapsam, konu dışı yanıt, Notifier ile Telegram ve web push yedeği |
| LinkedIn ve X sayfaları sunucudan açılmaz | Kayıt boş kalır | Ekran görüntüsü iste; Chrome eklentisi |
| Bildirim yorgunluğu | Kullanıcı botu susturur | En fazla 3 hatırlatma, sessiz saatler, haftalık toplu karar |
| Kişisel veri (CV, telefon) | KVKK riski | Aydınlatma metni, silme komutu, özel depolama |
| Yapay zekâ maliyeti | Gider kontrolsüz büyür | Aynı link bir kez işlenir, ucuz model, kullanıcı başı limit |

## 15. Başarı ölçütü

**Kapatılan kayıt oranı** = (yapıldı + vazgeçildi) / toplam kayıt. Kaydedilen sayısı
tek başına bir şey söylemez.

## Kaynaklar (15 Ekim 2026'da kontrol edildi)

- WhatsApp 2026 yapay zekâ politikası: https://respond.io/blog/whatsapp-general-purpose-chatbots-ban
- Yapay zekâ sağlayıcıları için fiyatlandırma (Meta): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers
- WhatsApp Business Platform fiyatlandırması (Meta): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- 1 Ekim 2026 fiyat değişikliği: https://respond.io/blog/whatsapp-pricing-change-2026
- Ülkelere göre mesaj fiyatları: https://zernio.com/whatsapp-api-pricing
- Cloud API'ye başlarken (Meta): https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/
