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

## Faz 2–4

Faz 1 kapısı geçilince bu bölüm, Faz 1'deki gibi görevlere ve kabul ölçütlerine
bölünür. Kapsam yukarıdaki tabloda.
