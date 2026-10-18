import type { Category, Device, Item, ReminderKind } from '../db/schema.js';
import { SNOOZE_LABELS, type SnoozeOption } from '../rules/schedule.js';
import { formatDateTime, formatShort } from '../rules/time.js';
import type { Button, TemplateMessage } from './notifier.js';

// Kullanıcıya giden tüm metinler burada; hepsi Türkçe (CLAUDE.md kural 8).

export const TEXT = {
  offTopic: 'Ben sadece kaydettiklerinle ilgilenirim. Bir link, ekran görüntüsü ya da sesli not at.',
  unreadable: 'Bunu okuyamadım, ekran görüntüsü atar mısın?',
  linkNeedsScreenshot:
    'Bu sayfayı açamadım ya da içinde yeterli metin yok (giriş isteyen sayfalar böyle olur). Ekran görüntüsünü atar mısın?',
  unsupportedMedia: 'Şimdilik link, ekran görüntüsü, PDF, sesli not ve yazılı mesaj okuyabiliyorum.',
  help: [
    'Bana sonra bakacağın şeyi at: link, ekran görüntüsü, PDF ya da sesli not. Son tarihini bulup kaydederim.',
    'Zamanı gelince hatırlatırım; Yaptım, Ertele ya da Vazgeç ile kapatırsın.',
    'Komutlar: listem, bugün, takvim, özet, bağla, cihazlarım, verilerimi sil.',
  ].join('\n'),
  emptyList: 'Açık kaydın yok. Bir link ya da ekran görüntüsü atarak başlayabilirsin.',
  nothingToday: 'Bugün ve yarın son tarihi olan bir kaydın yok.',
  deleteConfirm:
    'Tüm kayıtların, hatırlatmaların ve gönderdiğin dosyalar kalıcı olarak silinecek. Emin misin?',
  deleteDone: 'Tüm verilerin silindi. Yeniden bir şey gönderirsen sıfırdan başlarız.',
  deleteCancelled: 'Tamam, hiçbir şey silmedim.',
  askDate: 'Yeni tarihi yaz. Örneğin "perşembe 18:00", "cuma" ya da "24 Ekim".',
  dateNotUnderstood: 'Tarihi anlayamadım. Örneğin "perşembe 18:00", "haftaya salı" ya da "24 Ekim" yazabilirsin.',
  datePast: 'Bu tarih geçmişte kalıyor. Gelecekte bir tarih yazar mısın?',
  confirmed: 'Tamam, zamanı gelince hatırlatırım.',
  itemGone: 'Bu kayıt artık yok.',
  itemClosed: 'Bu kayıt zaten kapalı.',
  done: 'Harika, kapattım.',
  dropped: 'Tamam, bıraktım. Hatırlatma gelmeyecek.',
  started: 'Kolay gelsin. Son tarihe göre hatırlatmaya devam edeceğim.',
  going: 'Not ettim. Etkinlikten önce yine hatırlatırım.',
  cannotSnooze: 'Son tarihe çok az kaldı, daha fazla erteleyemiyorum.',
  snoozeAsk: 'Ne zaman hatırlatayım?',
  voiceUnavailable: 'Sesli notları şimdilik yazıya dökemiyorum. Yazarak atar mısın?',
  transcribeFailed: 'Sesli notu anlayamadım. Tekrar dener misin ya da yazar mısın?',
  deviceRemoved: 'Cihazın bağlantısını kaldırdım; artık kayıtlarına erişemez.',
  deviceGone: 'Bu cihaz zaten bağlı değil.',
  noDevices: 'Bağlı cihazın yok. Tarayıcı uzantısını ya da web panelini bağlamak için "bağla" yaz.',
  noDateForCalendar: 'Bu kaydın tarihi yok; önce "Tarihi değiştir" ile bir tarih ver.',
  calendarFileUnsupported: 'Bu kanaldan dosya gönderemiyorum; "takvim" yazınca gelen abonelik adresini kullanabilirsin.',
  calendarFileCaption: 'Dokun, takvimine eklensin.',
  digestOn: 'Tamam, her pazar akşamı haftalık özet göndereceğim.',
  digestOff: 'Haftalık özeti kapattım. Açmak için "özet aç" yaz.',
  briefOn: 'Tamam, son tarihi olan günlerde sabah 08.30\'da kısa bir brifing göndereceğim.',
  briefOff: 'Sabah brifingini kapattım.',
  noDigest: 'Önümüzdeki hafta için bir şey yok. Yeni bir şey kaydettiğinde özet de dolacak.',
} as const;

const CATEGORY_LABEL: Record<Category, string> = {
  job: 'İş ilanı',
  event: 'Etkinlik',
  application: 'Başvuru',
  tool: 'Denenecek araç',
  read: 'Okunacak',
  task: 'Yapılacak',
  other: 'Diğer',
};

export function effortText(minutes: number): string {
  if (minutes < 60) return `${minutes} dakika`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} saat ${m} dakika` : `${h} saat`;
}

export function buttonId(action: string, itemId: string): string {
  return `${action}:${itemId}`;
}

export interface CardInput {
  item: Item;
  zone: string;
  defaultReason: string | null;
  question: string | null;
  deadlinePassed: boolean;
  /** Kayıt tarayıcıdan geldiyse kartın başlığı bunu söyler. */
  fromBrowser?: boolean;
  /** "Takvime ekle" düğmesi (yalnızca dosya gönderebilen kanallarda). */
  calendarButton?: boolean;
}

/** SPEC bölüm 4: kayıt kartı. */
export function buildCard({ item, zone, defaultReason, question, deadlinePassed, fromBrowser, calendarButton }: CardInput): {
  text: string;
  buttons: Button[];
} {
  const lines: string[] = [];
  const org = item.organization ? `, ${item.organization}` : '';
  lines.push(`${fromBrowser ? 'Tarayıcıdan kaydettim' : 'Kaydettim'}: *${item.title}*${org}`);
  lines.push(`Tür: ${CATEGORY_LABEL[item.category]}`);
  if (item.eventAt) {
    lines.push(`Etkinlik: ${formatDateTime(item.eventAt, zone)}${item.location ? `, ${item.location}` : ''}`);
  }
  if (item.deadlineAt) {
    const reason = defaultReason ? ` (${defaultReason})` : '';
    lines.push(`Son tarih: ${formatDateTime(item.deadlineAt, zone)}${reason}`);
    if (deadlinePassed) lines.push('Bu tarih geçmiş görünüyor. Yanlışsa "Tarihi değiştir"e bas.');
  } else if (!question) {
    lines.push(
      item.category === 'tool' || item.category === 'read'
        ? 'Son tarih yok; 14 gün sonra hâlâ istiyor musun diye soracağım.'
        : 'Son tarih yok.',
    );
  }
  if (item.requirements.length) lines.push(`Gerekenler: ${item.requirements.join(', ')}`);
  if (item.effortMinutes) lines.push(`Süre: yaklaşık ${effortText(item.effortMinutes)}`);
  if (item.nextAction) lines.push(`İlk adım: ${item.nextAction}`);
  if (question) lines.push('', question);

  return {
    text: lines.join('\n'),
    buttons: [
      { id: buttonId('ok', item.id), title: 'Tamam' },
      { id: buttonId('date', item.id), title: 'Tarihi değiştir' },
      { id: buttonId('prep', item.id), title: 'Hemen hazırla' },
      ...(calendarButton && (item.deadlineAt || item.eventAt) ? [{ id: buttonId('cal', item.id), title: 'Takvime ekle' }] : []),
    ],
  };
}

export function linkCodeMessage(code: string, minutes: number): string {
  return [
    `Bağlantı kodun: *${code.slice(0, 3)} ${code.slice(3)}*`,
    `Tarayıcı uzantısında ya da web panelinde bu kodu gir. ${minutes} dakika geçerli, tek kullanımlık.`,
  ].join('\n');
}

export function devicesMessage(devices: Device[], zone: string): string {
  if (devices.length === 0) return TEXT.noDevices;
  const lines = devices.map((d, i) => {
    const seen = d.lastSeenAt ? `, son kullanım ${formatShort(d.lastSeenAt, zone)}` : '';
    return `${i + 1}. ${d.name}${seen}`;
  });
  return ['Bağlı cihazların:', ...lines].join('\n');
}

/** Cihaz kaldırma düğmeleri; WhatsApp sınırı nedeniyle en fazla 3. */
export function deviceButtons(devices: Device[]): Button[] {
  return devices.slice(0, 3).map((d, i) => ({ id: buttonId('devdel', d.id), title: `${i + 1}. cihazı kaldır` }));
}

export function calendarMessage(url: string, count: number): string {
  return [
    `Takvim abonelik adresin:\n${url}`,
    'Outlook, Thunderbird ya da Apple Takvim\'de "abone ol" diyerek ekleyebilirsin; kayıtların kendiliğinden güncellenir.',
    count ? 'Aşağıdaki dosyaya dokunarak şu anki kayıtları tek seferde de ekleyebilirsin.' : 'Henüz tarihli bir kaydın yok.',
  ].join('\n\n');
}

export function alreadySaved(item: Item, zone: string): string {
  const when = item.deadlineAt ? ` Son tarih: ${formatDateTime(item.deadlineAt, zone)}.` : '';
  return `Bunu zaten kaydetmiştin: *${item.title}*.${when}`;
}

export function dateUpdated(item: Item, zone: string, count: number): string {
  const tail = count > 0 ? ' Hatırlatmaları buna göre kurdum.' : '';
  return `Tamam, *${item.title}* için son tarih: ${formatDateTime(item.deadlineAt!, zone)}.${tail}`;
}

export function snoozed(at: Date, zone: string): string {
  return `Tamam, ${formatDateTime(at, zone)} için hatırlatıyorum.`;
}

export function snoozeButtons(itemId: string, options: SnoozeOption[]): Button[] {
  const action: Record<SnoozeOption, string> = { '3h': 's3h', tomorrow: 'stm', weekend: 'swe' };
  return options.map((o) => ({ id: buttonId(action[o], itemId), title: SNOOZE_LABELS[o] }));
}

export function deleteButtons(): Button[] {
  return [
    { id: 'delyes:-', title: 'Evet, sil' },
    { id: 'delno:-', title: 'Vazgeç' },
  ];
}

function listLine(i: number, item: Item, zone: string): string {
  const when = item.deadlineAt ? ` — ${formatShort(item.deadlineAt, zone)}` : '';
  return `${i + 1}. ${item.title}${when}`;
}

export function listMessage(items: Item[], zone: string): string {
  if (items.length === 0) return TEXT.emptyList;
  return ['Açık kayıtların:', ...items.map((it, i) => listLine(i, it, zone))].join('\n');
}

export function todayMessage(items: Item[], zone: string): string {
  if (items.length === 0) return TEXT.nothingToday;
  return ['Bugün ve yarın:', ...items.map((it, i) => listLine(i, it, zone))].join('\n');
}

export function checklist(item: Item): string {
  const steps = [...item.requirements.map((r) => `☐ ${r}`)];
  if (item.nextAction) steps.unshift(`☐ ${item.nextAction}`);
  if (steps.length === 0) steps.push(`☐ ${item.title}`);
  return steps.join('\n');
}

export function prepMessage(item: Item): string {
  return `*${item.title}* için kontrol listesi:\n${checklist(item)}\n\nÖn yazı taslağı gibi hazırlıklar yakında geliyor.`;
}

export interface ReminderMessage {
  text: string;
  buttons: Button[];
  template: TemplateMessage;
}

/** Hatırlatma: pencere açıksa `text`+`buttons`, kapalıysa `template` gönderilir. */
export function buildReminder(kind: ReminderKind, item: Item, zone: string, now: Date): ReminderMessage {
  const done = { id: buttonId('done', item.id), title: 'Yaptım' };
  const snooze = { id: buttonId('snooze', item.id), title: 'Ertele' };
  const drop = { id: buttonId('drop', item.id), title: 'Vazgeç' };
  const needs = item.requirements.length ? item.requirements.join(', ') : 'ek bir şey yok';

  if (kind === 'event_eve' || kind === 'event_soon') {
    const when = formatDateTime(item.eventAt ?? item.deadlineAt ?? now, zone);
    const where = item.location ?? 'belirtilmemiş';
    const going = { id: buttonId('going', item.id), title: 'Gideceğim' };
    return {
      text: `${item.title} ${when} tarihinde, ${where} konumunda.`,
      buttons: [going, drop],
      template: {
        name: 'etkinlik_hatirlatma',
        language: 'tr',
        bodyParams: [item.title, when, where],
        buttonPayloads: [going.id, drop.id],
      },
    };
  }

  if (!item.deadlineAt) {
    const days = String(Math.max(1, Math.round((+now - +item.createdAt) / 86_400_000)));
    return {
      text: `${item.title} kaydın ${days} gündür açık. Hâlâ istiyor musun?`,
      buttons: [done, snooze, drop],
      template: {
        name: 'kayit_kontrol',
        language: 'tr',
        bodyParams: [item.title, days],
        buttonPayloads: [done.id, snooze.id, drop.id],
      },
    };
  }

  const deadline = formatDateTime(item.deadlineAt, zone);
  if (kind === 'plan') {
    const effort = effortText(item.effortMinutes ?? 30);
    const start = { id: buttonId('start', item.id), title: 'Başladım' };
    return {
      text: `${item.title} yaklaşık ${effort} sürüyor. Son tarih ${deadline}; bugün başlamak için iyi bir zaman.`,
      buttons: [start, snooze],
      template: {
        name: 'hatirlatma_plan',
        language: 'tr',
        bodyParams: [item.title, effort, deadline],
        buttonPayloads: [start.id, snooze.id],
      },
    };
  }

  return {
    text: `${item.title} için son tarih ${deadline}. Gerekenler: ${needs}.`,
    buttons: [done, snooze, drop],
    template: {
      name: 'hatirlatma_son_tarih',
      language: 'tr',
      bodyParams: [item.title, deadline, needs],
      buttonPayloads: [done.id, snooze.id, drop.id],
    },
  };
}
