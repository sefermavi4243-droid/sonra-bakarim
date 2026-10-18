# Rafta — Marka

## Öz

**Rafta**, "sonra bakarım" dediğin her şeyi senin yerine rafa kaldıran ve vakti
gelince indiren bir asistan. İlanlar, etkinlikler, başvurular, bu hafta yapmak
istediğin işler: hepsi tek rafta, hiçbiri unutulmaz.

**Slogan:** Rafa kaldır, unutma.

**Kısa tanım (bir cümle):** Link, ekran görüntüsü ya da sesli notu gönder; Rafta son
tarihi bulur, takvimine koyar ve zamanında hatırlatır.

## Ses tonu

- **Kısa ve sakin.** Bir arkadaşın not defteri gibi; telaş yaratmaz, iş görür.
- **Fiil önce.** "Rafa koydum", "Rafa kaldırdım", "Raftan indirdim".
- **Abartı yok.** Ünlem, emoji ve satış dili kullanılmaz. Sayılar ve tarihler net.
- **Sen dili.** "Bu hafta 3 hedefin var", "Perşembe yoğun görünüyor".

| Yerine | Rafta der ki |
| --- | --- |
| Kaydettim! 🎉 | Rafa koydum: *Veri Analisti Stajyeri* |
| Görev tamamlandı | Raftan indirdim. |
| Hatırlatma ayarlandı | Perşembe 20:00'de hatırlatırım. |
| Bir hata oluştu | Bunu okuyamadım. Ekran görüntüsünü atar mısın? |

## Renkler

İki renkli bir kimlik: **mor** sakinliği ve düzeni, **safran** dikkat isteyen anı taşır.

| Rol | Ad | Açık tema | Koyu tema | Kullanım |
| --- | --- | --- | --- | --- |
| Ana renk | Mürekkep | `#5B4FE9` | `#8E86FF` | Logo, birincil düğme, seçim, son tarih |
| Vurgu | Safran | `#F26B1D` | `#FF8B4D` | Bugün, yaklaşan, gecikmiş, "şu an" çizgisi |
| Etkinlik | Deniz | `#0E9384` | `#3CCBB4` | Etkinlikler |
| Hedef | Yaprak | `#3B8F2E` | `#7BCB6A` | Haftalık hedefler |
| Zemin | Kâğıt | `#FAF9F6` | `#121118` | Sayfa zemini |
| Yüzey | — | `#FFFFFF` | `#1A1922` | Kartlar |
| Çizgi | — | `#ECE9E3` | `#2A2833` | Ayraçlar |
| Metin | Mürekkep siyahı | `#1C1A24` | `#EEECF6` | Metin |
| Soluk metin | — | `#6D6A7C` | `#A09DB2` | İkincil metin |

Kurallar:
- Safran yalnızca zamanla ilgili dikkat için kullanılır; dekor amaçlı kullanılmaz.
- Metin hiçbir zaman safran zemin üzerine beyaz yazılmaz (kontrast); safran zeminde mürekkep siyahı kullanılır.

## Logo

Mor, yuvarlak köşeli kare içinde iki raf çizgisi ve üst rafta duran safran bir kutu:
"rafa kaldırılmış bir şey". Simge `extension/icons/` ve `web/` içinde; `scripts/make-icons.ts`
ile yeniden üretilir.

- Simge yalnız başına uygulama simgesi olarak, yazıyla birlikte üst çubukta kullanılır.
- Simge döndürülmez, renkleri değiştirilmez, gölge eklenmez.

## Yazı

Sistem yazı tipi ailesi (Segoe UI, SF Pro, Roboto). Başlıklar kalın ve sıkı aralıklı
(`letter-spacing: -0.02em`), gövde 15 px. Sayılar tablo hizalı (`font-variant-numeric: tabular-nums`).

## Adlandırma

- Ürün: **Rafta** (her zaman büyük R).
- Telegram botu görünen adı: **Rafta**. Kullanıcı adı değiştirilemediği için eski kalır.
- Tarayıcı uzantısı: **Rafta — Rafa kaldır**.
- Düğme metinleri: "Rafa kaldır", "Yaptım", "Ertele", "Tarihi değiştir", "Takvime ekle", "Vazgeç".
