# Yol Haritası

Her faz bir kapıyla biter. Kapıyı geçmeden sonraki faza başlanmaz.

| Faz | Amaç | Kapsam | Kapı (geçiş ölçütü) |
| --- | --- | --- | --- |
| 1. Kendin için | Kaydet ve hatırlat | WhatsApp test numarası, link/görsel/PDF/metin, Claude ile çıkarım, hatırlatma, 3 düğme, sesli not, `listem` | 10 gerçek kayıttan en az 9'u doğru tarihle çıktı; 2 hafta her gün kullanıldı |
| 2. Hazırlayıcı | İşi önceden yap | Geriye doğru planlama, CV'ye göre ön yazı, pazar özeti, ölü ilan dedektörü, ICS takvim linki | 20 test kullanıcısı; 4. haftada yarısı hâlâ aktif |
| 3. Her yerden yakala | Girişleri çoğalt | Chrome eklentisi, e-posta adresi, web paneli, tekrar birleştirme, ritmi öğrenme | Kapatılan kayıt oranı %50'nin üstünde |
| 4. Paylaş | Herkese aç | İşletme numarası, giriş, KVKK metni, arkadaş linki, organizatör linki, Pro plan | — |

## Faz 1 görevleri

Her görev ayrı bir Claude Code oturumunda yapılabilir. Her görevin sonunda kabul
ölçütleri tek tek kontrol edilir.

### 1.1 Proje iskeleti ve veritabanı

- TypeScript (strict), Hono, Drizzle, zod, Vitest kurulumu
- `docs/SPEC.md` bölüm 8'deki altı tablo ve migration'lar
- `.env` doğrulaması: eksik değişken varsa uygulama açılmaz ve hangisinin eksik olduğunu söyler
- `CLAUDE.md`'deki Komutlar bölümü doldurulur

Kabul:
- [ ] `test`, `migrate`, `dev` komutları çalışıyor
- [ ] Tablolar Supabase'de oluştu
- [ ] Eksik bir env değişkeniyle açılış anlaşılır bir hata veriyor

### 1.2 WhatsApp webhook

- `GET /webhook`: `hub.verify_token` doğrulaması, `hub.challenge` dönüşü
- `POST /webhook`: `X-Hub-Signature-256` kontrolü, `inbound_messages`'a yazma, hemen 200
- Aynı `wa_message_id` ikinci kez gelirse işlenmez
- Kullanıcı yoksa `users`'a eklenir; `last_inbound_at` güncellenir
- `src/notify/whatsapp.ts`: serbest metin, hızlı yanıt düğmeli mesaj ve şablon gönderimi

Kabul:
- [ ] Test numarasına yazılan mesaja "Aldım" yanıtı geliyor
- [ ] Geçersiz imzalı istek 401 alıyor (testli)
- [ ] Aynı mesaj iki kez gelince tek kayıt oluşuyor (testli)

### 1.3 İçe alma, çıkarım ve kayıt kartı

- Link: sayfayı indir, Readability ile metni çıkar; metin çok kısaysa ekran görüntüsü iste
- Görsel ve PDF: Meta'dan medyayı indir, Supabase Storage'a koy, Claude'a gönder
- `docs/SPEC.md` bölüm 9'daki şema, tool use ve zod doğrulaması
- `deadline_evidence` alt dize kontrolü; tutmazsa `deadline` null
- `off_topic` ise yönlendirme yanıtı
- Kart: başlık, tür, tarih, gerekenler, süre; Tamam / Tarihi değiştir / Hemen hazırla

Kabul:
- [ ] Bir LinkedIn ilan linki, bir ekran görüntüsü ve bir PDF doğru kayda dönüşüyor
- [ ] Metinde olmayan bir tarih kayda yazılmıyor (testli)
- [ ] "Bugün hava nasıl?" mesajı kayıt oluşturmuyor

### 1.4 Tarih kuralları ve hatırlatma planlama

- `src/rules/defaults.ts`: bölüm 9'daki varsayılanlar
- `src/rules/schedule.ts`: bölüm 10'daki planlama kuralları
- Göreli tarih çözümü ("cuma", "haftaya salı") ve "Tarihi değiştir" akışı

Kabul:
- [ ] Bölüm 10'daki 8 kuralın her biri için en az bir test
- [ ] Sessiz saat, ay sonu, yaz saati olmayan Europe/Istanbul ve gece yarısı sınır durumları testli
- [ ] Kayıt kapanınca bekleyen hatırlatmalar iptal ediliyor

### 1.5 Zamanlayıcı ve düğmeler

- Dakikada bir çalışan iş: vadesi gelen hatırlatmaları `FOR UPDATE SKIP LOCKED` ile al
- 24 saat penceresi açıksa serbest mesaj, kapalıysa utility şablonu
- Yaptım / Ertele / Vazgeç işleyişi; `interactions` kaydı
- `templates/` klasöründe bölüm 12'deki şablon metinleri
- Gönderim hatası 3 kez yeniden denenir, sonra `failed`

Kabul:
- [ ] 2 dakika sonrasına kurulan bir hatırlatma telefona geliyor
- [ ] İki zamanlayıcı aynı anda çalışınca aynı hatırlatma iki kez gitmiyor (testli)
- [ ] Ertele, son tarihi geçmeyen bir zamana kuruyor

### 1.6 Sesli not ve komutlar

- Sesli notu yazıya dök, metni aynı çıkarım hattına sok
- `listem`, `bugün`, `yardım`, `verilerimi sil` komutları

Kabul:
- [ ] "Cuma Ali'ye dosyayı atmayı unutma" sesli notu cuma tarihli bir `task` kaydı oluyor
- [ ] `listem` açık kayıtları son tarihe göre sıralı gösteriyor
- [ ] `verilerimi sil` onaydan sonra kullanıcının tüm verisini siliyor

### Kapı 1 testi

Kendi telefonundan 10 gerçek kayıt gönder: en az bir LinkedIn ilanı, bir X ekran
görüntüsü, bir afiş fotoğrafı, bir PDF ve bir sesli not. Her biri için tarihin doğru
çıkıp çıkmadığını bu tabloya yaz:

| # | Girdi türü | Beklenen tarih | Çıkan tarih | Doğru mu? |
| --- | --- | --- | --- | --- |
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |
| 9 | | | | |
| 10 | | | | |

## Paket 2+ (öne alındı)

Kullanıcı isteğiyle Kapı 1 beklenmeden Faz 2 ve 3'ten şu parçalar öne alındı:
takvim (Faz 2, özellik 8), pazar özeti (Faz 2, özellik 6), Chrome eklentisi ve web
paneli (Faz 3, özellik 9 ve 11). Kapı 1 testi yine geçerli; Faz 2'nin kalanı (ön yazı,
CV eşleştirme, pazar özeti tut/seç/vazgeç akışı) Kapı 1'den sonra.

### A. Hesap bağlama
- [x] `bağla` 6 haneli, 10 dakika geçerli, tek kullanımlık kod verir; veritabanında yalnızca özeti tutulur.
- [x] Kod cihaz anahtarına dönüşür; anahtarın yalnızca SHA-256 özeti saklanır.
- [x] Yeni cihaz bağlanınca bota bildirim gider; `cihazlarım` listeler ve kaldırır.
- [x] 10 hatalı denemeden sonra 10 dakika kilit.
- [x] `verilerimi sil` cihazları ve kodları da siler.

### B. API ve birleşme
- [x] Kayıtlar listelenir; Yaptım, Vazgeç, Yeniden aç, Ertele ve tarih değiştirme kanaldan bağımsız aynı kodla çalışır.
- [x] Tarayıcıdan gelen kayıt aynı hattan geçer; kart Telegram'a "Tarayıcıdan kaydettim" diye düşer.
- [x] Aynı link telefondan ve tarayıcıdan gelince tek kayıt kalır (ortak tekrar anahtarı).
- [x] Başkasının kaydı ve kayıt durumu görünmez; panel çerezinde CSRF koruması var.

### C. Web paneli
- [x] Ajanda (gecikmiş, bugün, yarın, bu hafta, sonra, tarihsiz) ve haftalık yük özeti.
- [x] Ay takvimi; son tarih ve etkinlik ayrı renkte; güne tıklayınca o günün listesi.
- [x] Kayıt detayı: kanıt cümlesi, gerekenler listesi, Yaptım / Ertele / Tarih / Takvime ekle / Vazgeç.
- [x] Hızlı kayıt kutusu, arşiv ve geri alma, ayarlar (takvim adresi, özetler, cihazlar).
- [x] Açık ve koyu tema, dar ekranda tek sütun.

### D. Tarayıcı uzantısı (Manifest V3)
- [x] Sayfa metni tarayıcıdan okunur (giriş isteyen sayfalar dahil); sağ tık: sayfa, seçili metin, link, görsel.
- [x] Kısayol Alt+Shift+K; bitince sistem bildirimi.
- [x] Açılır pencerede yaklaşanlar ve "Yaptım"; rozette bugünkü iş sayısı.
- [x] Kaydedilmiş sayfa açılınca günde bir kez hatırlatma.

### E. Takvim
- [x] Kayıt başına .ics (Telegram'da "Takvime ekle" düğmesi), `takvim` komutu, gizli abonelik adresi.
- [x] Gün sonu son tarihi tüm gün olayı, saatli son tarih 30 dakikalık blok, etkinlik ayrı olay; uyarılar.

### F. Özetler
- [x] Pazar 19:00 sonrası haftalık özet; aynı güne 2+ son tarih düşerse uyarı ve öneri.
- [x] İsteğe bağlı sabah brifingi (08:30); ikisi de günde en fazla bir kez, sessiz saatlere uyar.
- [x] `özet`, `özet aç/kapat`, `brifing aç/kapat`.

## Paket 3: Rafta

### 1. Marka
- [x] Ad Rafta, slogan "Rafa kaldır, unutma.", marka belgesi `docs/MARKA.md`.
- [x] Mürekkep moru ana renk, safran yalnızca zamanla ilgili dikkat için; simge yeniden üretildi.
- [x] Bot metinleri, panel, uzantı ve README yeni ad ve tonla.

### 2. Takvim
- [x] Hafta görünümü: saat ızgarası, şu an çizgisi, gün yükü çubuğu, gün sonu işler üstte.
- [x] Sürükle bırak: son tarih ve blok taşınır, hatırlatmalar yeniden kurulur; geçmişe taşınamaz.
- [x] Çalışma blokları: geriye doğru öneri (testli kurallar), onay, taşıma, süre değiştirme; .ics'e girer.
- [x] Ay görünümünde yoğunluk ısısı; filtreler; hatırlatmalar takvimde; klavye kısayolları.

### 3. Haftalık hedefler
- [x] "bu hafta / hafta sonuna kadar / hafta içi / gelecek hafta" çözülür; hedef kategorisi.
- [x] Ritim: çarşamba 19:00, cuma 18:00, son gün 11:00; pazartesi 09:00 hafta planı.
- [x] Pazar özetinde tamamlanma oranı; bitmeyenler için Haftaya taşı / Bırak.
- [x] Panelde "Bu hafta" sayfası.

### 4. Telefon
- [x] Panel yüklenebilir uygulama (PWA): simge, kısayollar (Rafa kaldır, Bu hafta, Takvim), Paylaş hedefi.
- [x] "Ne rafa kalksın?" hızlı kayıt ekranı.
- [x] HTTP Shortcuts widget'ı için ayrı cihaz anahtarı ve kurulum adımları.
- [x] Tailscale ile telefondan erişim (HTTPS, yalnızca kendi ağın; telefon bağlandı).

## Faz 2–4 (kalan)

Faz 1 kapısı geçilince bu bölüm, Faz 1'deki gibi görevlere ve kabul ölçütlerine
bölünür. Kapsam yukarıdaki tabloda.
