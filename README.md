<p align="center"><img src="docs/rafta-logo.png" width="96" alt="Rafta"></p>

# Rafta

**Rafa kaldır, unutma.**

İş ilanı, etkinlik afişi, burs yönergesi, sesli not ya da "bu hafta Medium yazımı
yayınlayacağım" dediğin bir hedef: Rafta'ya at, gerisini o halletsin. İçeriği okur,
son tarihi bulur, takvimine koyar, işe ne zaman oturman gerektiğini planlar ve sen
unutmadan önce hatırlatır.

## Nasıl çalışır

1. **Rafa kaldır.** Telegram'da bota, tarayıcı uzantısına, panele ya da telefonundaki
   Rafta simgesine; link, ekran görüntüsü, PDF, sesli not ya da düz metin.
2. **Rafa koyar.** Birkaç saniye içinde bir kart gelir:

   ```
   Rafa koydum: Veri Analisti Stajyeri, Örnek Fintech
   Son tarih: 24 Ekim Cumartesi 23:59
   Gerekenler: CV, Motivasyon yazısı
   Süre: yaklaşık 45 dakika
   [Tamam] [Tarihi değiştir] [Hemen hazırla] [Takvime ekle]
   ```

3. **Vakti gelince indirir.** Son tarihe göre en fazla üç hatırlatma; düğmelerle
   kapatır, erteler ya da bırakırsın.

## Her yerden rafa kaldır

- **Telefondan, Telegram'a girmeden:** Rafta'yı ana ekrana uygulama gibi yükle.
  Simgeye dokun, "Ne rafa kalksın?" ekranına yaz ya da klavyedeki mikrofona söyle.
  Herhangi bir uygulamada **Paylaş → Rafta** de, link doğrudan rafa kalksın. İstersen
  HTTP Shortcuts ile tek dokunuşluk bir ana ekran widget'ı da kurabilirsin.
- **Telegram'dan:** bota ilet, paylaş ya da sesli not at.
- **Tarayıcıdan:** uzantı simgesine tıkla, `Alt+Shift+K`'ye bas ya da sağ tıkla
  "Rafa kaldır". Sayfa metni tarayıcının içinden okunduğu için LinkedIn gibi giriş
  isteyen sayfalar da olur.

Nereden gelirse gelsin hepsi tek rafta. Aynı ilanı iki yoldan gönderirsen tek kayıt kalır.

## Takvim

- **Hafta görünümü:** saat ızgarası, "şu an" çizgisi, her günün iş yükü. Gün sonu son
  tarihleri ve hedefler üstte, saatli işler saatinde.
- **Sürükle bırak:** bir kaydı başka güne ya da saate taşı; son tarih ve hatırlatmalar
  kendiliğinden yeniden kurulur.
- **Çalışma blokları:** Rafta her işin süresine bakıp son tarihten önce takviminde boş
  bir yer önerir ("Çalış: Staj başvurusu, perşembe 20:00–20:45"). Tek tıkla onayla,
  sürükleyerek taşı, alt kenarından süresini değiştir.
- **Ay görünümü:** yoğun günler daha koyu; bir güne tıkla, o haftaya in.
- **Hatırlatmalar da takvimde:** hangi gün ne zaman mesaj geleceğini görürsün.
- **Kendi takvimine:** her kartta **Takvime ekle**; ya da kişisel abonelik adresini
  Google, Outlook veya Apple Takvim'e ekle. Onayladığın çalışma blokları da orada görünür.
- Klavye: `/` rafa kaldır, `T` bugün, `W` hafta, `M` ay, `←` `→` gezin.

## Bu hafta

Bota "bu hafta portfolyo projemi bitireceğim", "hafta sonuna kadar LinkedIn
gönderisini paylaşacağım" yaz; Rafta bunları **haftalık hedef** olarak rafa koyar ve
hafta boyunca takip eder:

- Pazartesi sabahı: "Yeni hafta. Rafında 3 haftalık hedef var."
- Çarşamba akşamı ara kontrol, cuma akşamı son dürtme.
- Pazar akşamı özet: "Bu haftanın hedefleri: 2/3 tamam." Bitmeyenler için
  **Haftaya taşı** ya da **Bırak**.

Panelde **Bu hafta** sayfası hedeflerini ilerleme halkasıyla gösterir.

## Haftanı önceden gör

Pazar akşamı kısa bir özet gelir: önümüzdeki yedi günün işleri gün gün, geçen hafta
ne kadarını kapattığın ve çakışan günler için bir uyarı:

```
Dikkat: Perşembe günü 3 son tarih denk geliyor. "Burs başvurusu" ve
"Staj başvurusu" için bu hafta başında başlamak iyi olur (toplam yaklaşık 2 saat).
```

İstersen son tarihi olan günlerde sabah 08.30'da yalnızca o günün işlerini içeren
kısa bir brifing de alırsın.

## Öne çıkanlar

- **Tarih uydurmaz.** Son tarih yalnızca içerikte gerçekten yazıyorsa kaydedilir. Her
  tarih, metinde birebir geçen bir kanıt cümlesiyle doğrulanır; "cuma", "haftaya salı",
  "yarın akşam 7" gibi göreli ifadeleri kural tabanlı bir Türkçe tarih çözücü okur.
- **Belirsizse sorar.** "Ayın 5'i" gibi birden fazla anlama gelen ifadelerde tahmin
  yürütmez, sana tek bir kısa soru sorar.
- **Mantıklı varsayılanlar.** Tarihi olmayan bir iş ilanı için iki gün sonrasına, bir
  etkinlik için üç gün öncesine hatırlatma kurar. Denenecek araçlar ve okunacak
  yazılar için iki hafta sonra "hâlâ ilgileniyor musun?" diye sorar.
- **Rahatsız etmez.** Gece 22:00 ile sabah 08:00 arasında mesaj gelmez; hatırlatma
  bir sonraki uygun saate kayar. Bir kayıt için en fazla üç hatırlatma gönderilir.
- **Ertelemeyi akıllıca yapar.** "3 saat sonra", "yarın aynı saat" ve "hafta sonu"
  seçeneklerinden yalnızca son tarihi geçmeyenler sunulur.
- **Aynı şeyi iki kez kaydetmez.** Aynı link ya da aynı dosya tekrar gelirse mevcut
  kaydı hatırlatır.
- **Konuya odaklıdır.** Genel sohbet botu değildir; kaydetme, listeleme, hatırlatma ve
  hazırlık dışındaki mesajlara kısa bir yönlendirmeyle yanıt verir.
- **Verin senindir.** `verilerimi sil` komutu, onay sonrası tüm kayıtlarını, geçmişini
  ve yüklediğin dosyaları kalıcı olarak siler.

## Desteklenen içerikler

| Tür | Ne yapılır |
| --- | --- |
| Link | Sayfa okunur, ana metin ayıklanır, izleme parametreleri temizlenir |
| Ekran görüntüsü / fotoğraf | Görsel destekli dil modeli içeriği okur |
| PDF | Metin katmanı okunur; taranmış PDF'lerde sayfalar görüntüye çevrilip okunur |
| Sesli not | Yerel konuşma tanıma ile Türkçe yazıya dökülür |
| Düz metin / iletilen mesaj | Doğrudan işlenir |

## Komutlar

| Komut | Açıklama |
| --- | --- |
| `listem` | Açık kayıtların, son tarihe göre sıralı |
| `bugün` | Bugün ve yarın son tarihi olan kayıtlar |
| `takvim` | Takvim abonelik adresi ve tüm kayıtların takvim dosyası |
| `özet` | Haftalık özeti hemen gönderir |
| `özet aç` / `özet kapat` | Pazar akşamı özetini açar ya da kapatır |
| `brifing aç` / `brifing kapat` | Sabah brifingini açar ya da kapatır |
| `bağla` | Tarayıcı uzantısı ya da web paneli için 6 haneli bağlantı kodu |
| `cihazlarım` | Bağlı cihazlar; istediğini kaldırabilirsin |
| `yardım` | Kısa kullanım bilgisi |
| `verilerimi sil` | Tüm verilerini siler (onay ister) |

Telegram'da aynı komutlar `/listem`, `/bugun`, `/takvim`, `/bagla`, `/ozet_kapat` gibi de yazılabilir.

## Kanallar

- **Telegram**: önerilen başlangıç. Ücretsizdir, işletme hesabı ya da onay gerektirmez,
  dış dünyaya açık bir adrese ihtiyaç duymaz.
- **WhatsApp**: resmi WhatsApp Cloud API ile. 24 saatlik mesaj penceresi kapalıyken
  yalnızca `templates/` klasöründeki onaylı bilgilendirme şablonlarıyla hatırlatır.

Gönderimlerin tamamı kanaldan bağımsız tek bir arayüzden geçer; iki kanal aynı anda
açık olabilir.

## Gizlilik ve maliyet

Rafta tamamen kendi bilgisayarında çalışabilir:

- **Dil modeli yereldir.** Ollama, LM Studio ya da llama.cpp gibi OpenAI uyumlu bir
  yerel sunucu kullanır; içeriklerin üçüncü taraf bir yapay zekâ servisine gitmez.
- **Konuşma tanıma yereldir.** Sesli notlar faster-whisper ile makinende yazıya dökülür.
- **Veritabanı yereldir.** Ayrı bir veritabanı sunucusu gerekmez; gömülü Postgres
  (PGlite) kullanılır. İstersen Supabase'e geçebilirsin.

Ücretli bir API anahtarı gerekmez.

## Kurulum

### Gereksinimler

- Node.js 22 veya üstü
- [Ollama](https://ollama.com) ve görsel destekli bir model (ör. `gemma3:12b`)
- Python 3.11 veya üstü (yalnızca sesli not için)
- Bir Telegram botu ([@BotFather](https://t.me/BotFather) → `/newbot`)

### Adımlar

```bash
git clone <repo-adresi> rafta
cd rafta
npm install

ollama pull gemma3:12b
cp .env.example .env        # TELEGRAM_BOT_TOKEN satırını doldur
npm run migrate             # veritabanı tablolarını kurar
npm start
```

Sesli not desteği için (Windows):

```powershell
scripts\setup-whisper.ps1
```

Botun bilgisayar açıldığında kendiliğinden başlaması ve çökerse yeniden kalkması için:

```powershell
scripts\install-autostart.ps1     # kaldırmak için: scripts\uninstall-autostart.ps1
```

Günlükler `data\logs\` klasörüne yazılır.

### Web paneli

Bot çalışırken tarayıcıda **http://localhost:3000** adresini aç. Telegram'da bota
`bağla` yaz ve gelen kodu gir. Bilgisayar başındaysan `npm run bagla` komutu da kod verir.

### Tarayıcı uzantısı (Chrome, Edge, Brave)

1. Tarayıcıda `chrome://extensions` adresini aç (Edge'de `edge://extensions`).
2. Sağ üstten **Geliştirici modu**nu aç.
3. **Paketlenmemiş öğe yükle** düğmesiyle projedeki `extension` klasörünü seç.
4. Araç çubuğundaki Rafta simgesine tıkla ve bağlantı kodunu gir.

Kısayollar: `Alt+Shift+S` pencereyi açar, `Alt+Shift+K` sayfayı doğrudan kaydeder.

Uzantının yapabildikleri:

- **Sitenin kendi bilgisini okur.** İlan ve etkinlik siteleri son başvuru, etkinlik
  tarihi, kurum ve konumu sayfaya makine için gömer (JSON-LD). Rafta bunu okur; tarih
  tahmin edilmez, doğrudan siteden gelir ve kayıt daha hızlı olur.
- **Masaüstü hatırlatması:** hatırlatma vakti gelince Telegram mesajının yanında
  bilgisayarında da **Yaptım** ve **3 saat ertele** düğmeli bir bildirim çıkar.
- **Sayfada vurgu:** rafındaki bir sayfayı yeniden açınca son tarih cümlesi safranla
  işaretlenir, köşede "Rafta · son tarih …" etiketi çıkar (bir kez izin verilir).
- **Kuyruk:** Rafta kapalıyken rafa kaldırdıkların uzantıda bekler, açılınca gönderilir.

### Telefon: Tailscale ile güvenli erişim

Telefonun, bilgisayarındaki Rafta'ya internete kapı açmadan ulaşsın:

1. Bilgisayara ve telefona [Tailscale](https://tailscale.com) kur, ikisinde de aynı hesapla giriş yap.
2. Bilgisayarda: `tailscale serve --bg 3000`. Çıkan `https://<bilgisayar>.<ağ>.ts.net` adresini
   `.env` içinde `APP_URL` olarak yaz ve Rafta'yı yeniden başlat.
3. Telefonda Chrome ile bu adresi aç, `bağla` kodunla giriş yap, menüden **Ana ekrana ekle**.

### Tarayıcı dışından erişim: Cloudflare tüneli (isteğe bağlı)

Panel ve takvim aboneliği varsayılan olarak yalnızca bu bilgisayardan açılır. Telefondan
erişmek ya da Google Takvim'e abone olmak için dışarıdan erişilebilen bir adres gerekir:

```powershell
cloudflared tunnel --url http://localhost:3000
```

Çıkan `https://….trycloudflare.com` adresini `.env` içinde `APP_URL` olarak yaz ve
botu yeniden başlat. Hızlı tünel adresi her açılışta değişir; kalıcı adres için
ücretsiz bir Cloudflare hesabıyla adlandırılmış tünel kurabilirsin.

### Önerilen Ollama ayarları

```powershell
setx OLLAMA_KEEP_ALIVE -1          # model bellekte kalır, ilk mesaj beklemez
setx OLLAMA_CONTEXT_LENGTH 8192    # uzun ilan metinleri kesilmez
```

Daha hızlı ama daha az isabetli bir seçenek için `gemma3:4b` kullanabilirsin.

## Yapılandırma

Tüm ayarlar `.env` dosyasındadır; açıklamalı örnek `.env.example` içinde.

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | | Telegram kanalı |
| `WHATSAPP_*` | | WhatsApp kanalı (isteğe bağlı) |
| `LLM_BASE_URL` | `http://localhost:11434/v1` | Yerel dil modeli sunucusu |
| `LLM_MODEL` | `gemma3:12b` | Kullanılacak model |
| `TRANSCRIBE_BASE_URL` | | Konuşma tanıma sunucusu; boşsa sesli not kapalı |
| `DATABASE_URL` | `./data/pg` | Boşsa gömülü veritabanı; `postgres://…` ile harici sunucu |
| `APP_TIMEZONE` | `Europe/Istanbul` | Varsayılan saat dilimi |
| `QUIET_HOURS` | `22:00-08:00` | Mesaj gönderilmeyen saatler |
| `APP_URL` | `http://localhost:3000` | Panelin ve takvim aboneliğinin dışarıdan görünen adresi |
| `HOST` | `127.0.0.1` | Sunucunun dinlediği adres |

## Geliştirme

```bash
npm run dev          # izleme modunda çalıştırır
npm test             # birim testleri (dış servis kullanmaz)
npm run test:live    # gerçek dil modeli ve veritabanıyla testler
npm run lint         # TypeScript tip kontrolü
npm run rapor        # son kayıtların çıkan tarihlerini tablo olarak gösterir
npm run bagla        # uzantı ya da panel için bağlantı kodu (bot açıkken)
```

Teknik yığın: TypeScript, Hono, Drizzle ORM, zod, Vitest, luxon, Mozilla Readability.

Proje yapısı:

```
src/
  api/       uzantı ve panel için HTTP API
  calendar/  takvim (.ics) üretimi
  webhook/   WhatsApp webhook (imza doğrulama)
  ingest/    link okuma, PDF, depolama, konuşma tanıma
  extract/   dil modeli istemcisi, istem ve şema, tarih doğrulama
  rules/     Türkçe tarih çözücü, varsayılan kurallar, hatırlatma planlama
  notify/    kanal arayüzü, Telegram ve WhatsApp istemcileri, mesaj metinleri
  jobs/      işleme hattı, düğmeler, komutlar, zamanlayıcı
  db/        şema ve migration'lar
web/         web paneli (derleme adımı yok)
extension/   tarayıcı uzantısı (Manifest V3, derleme adımı yok)
templates/   WhatsApp bilgilendirme şablonları
tools/       yerel konuşma tanıma sunucusu
docs/        ürün tanımı ve yol haritası
```

Ürünün ayrıntılı tanımı `docs/SPEC.md`, yol haritası `docs/ROADMAP.md` içindedir.
