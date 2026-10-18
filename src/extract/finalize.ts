import { DateTime } from 'luxon';
import type { Category, DeadlineSource } from '../db/schema.js';
import { ASK_DEADLINE_QUESTION, applyDefaults } from '../rules/defaults.js';
import { hasDateCue, parseTurkishDate } from '../rules/relative.js';
import { at, type UserPrefs } from '../rules/time.js';
import type { Extraction } from './schema.js';

export interface Finalized {
  title: string;
  category: Category;
  organization: string | null;
  deadline: Date | null;
  deadlineSource: DeadlineSource | null;
  deadlineEvidence: string | null;
  defaultReason: string | null;
  eventAt: Date | null;
  location: string | null;
  effortMinutes: number | null;
  requirements: string[];
  keyNotes: string[];
  nextAction: string | null;
  question: string | null;
  checkInAt: Date | null;
}

function normalizeForMatch(s: string): string {
  return s
    .normalize('NFC')
    .toLocaleLowerCase('tr')
    .replace(/[“”«»„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * SPEC bölüm 9: kanıt ifadesi girdi metninde aynen geçiyor mu? Büyük-küçük harf ve
 * boşluk farkları yok sayılır; başka hiçbir esneklik yoktur.
 */
export function evidenceInText(evidence: string | null, sourceText: string): boolean {
  if (!evidence) return false;
  const e = normalizeForMatch(evidence).replace(/^[\s.,;:]+|[\s.,;:]+$/g, '');
  if (e.length < 2) return false;
  return normalizeForMatch(sourceText).includes(e);
}

function parseIso(value: string, zone: string): Date | null {
  // Yalnızca tarih ("2026-10-24") verilmişse saat 23:59.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = DateTime.fromISO(value, { zone });
    return d.isValid ? at(d, 23, 59).toJSDate() : null;
  }
  const d = DateTime.fromISO(value, { zone, setZone: false });
  return d.isValid ? d.toJSDate() : null;
}

type Resolved = { date: Date | null; question: string | null };

/**
 * Modelin verdiği tarihi kanıtla doğrular. Kanıt metinde yoksa ya da tarih ipucu
 * içermiyorsa tarih atılır. Kanıt kural tabanlı çözücüyle okunabiliyorsa onun sonucu
 * esas alınır (tarihleri model değil kurallar belirler).
 */
function resolveDate(
  value: string | null,
  evidence: string | null,
  sourceText: string,
  now: Date,
  zone: string,
): Resolved {
  if (!value) return { date: null, question: null };
  if (!evidenceInText(evidence, sourceText) || !hasDateCue(evidence!)) return { date: null, question: null };
  const parsed = parseTurkishDate(evidence!, now, zone);
  if (parsed.kind === 'ambiguous') return { date: null, question: parsed.question };
  const model = parseIso(value, zone);
  const explicit = /\d/.test(evidence!);
  const modelOk = model !== null && (!explicit || matchesEvidence(model, evidence!, zone));

  if (parsed.kind === 'ok') {
    // Aynı gün: modelin saati korunur (saat metnin başka yerinde yazıyor olabilir).
    if (model && sameLocalDay(model, parsed.date, zone)) return { date: parsed.hasTime ? parsed.date : model, question: null };
    // Farklı gün: göreli ifadede kural, açık tarihte kanıtla tutarlı olan kazanır.
    return { date: explicit && modelOk ? model : parsed.date, question: null };
  }
  return { date: modelOk ? model : null, question: null };
}

function sameLocalDay(a: Date, b: Date, zone: string): boolean {
  return DateTime.fromJSDate(a, { zone }).hasSame(DateTime.fromJSDate(b, { zone }), 'day');
}

const MONTH_WORDS = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'];

/** Modelin tarihindeki gün ve ay, rakamlı kanıt ifadesinde gerçekten yazıyor mu? */
function matchesEvidence(date: Date, evidence: string, zone: string): boolean {
  const d = DateTime.fromJSDate(date, { zone });
  const e = evidence.toLocaleLowerCase('tr');
  const numbers = (e.match(/\d+/g) ?? []).map(Number);
  if (!numbers.includes(d.day)) return false;
  return numbers.includes(d.month) || e.includes(MONTH_WORDS[d.month - 1]!);
}

/** Bu uzunluğa kadar olan görev notlarında tarih, model atlasa da metinden okunur. */
const TASK_FALLBACK_MAX = 300;

/** Modelin çıktısını kurallardan geçirip kayda yazılacak hâle getirir. */
export function finalizeExtraction(x: Extraction, inputText: string, now: Date, prefs: UserPrefs): Finalized {
  const zone = prefs.timezone;
  // Görsel/PDF girdisinde kanıt, modelin görselden yaptığı dökümde de aranır.
  const sourceText = [inputText, x.source_text ?? ''].join('\n');

  let dl = resolveDate(x.deadline, x.deadline_evidence, sourceText, now, zone);
  let dlEvidence = x.deadline_evidence;
  let dlSource = x.deadline_source;
  // Kısa kişisel notta ("Cuma Ali'ye dosyayı at") küçük modeller göreli tarihi atlayabiliyor.
  // Tarihi model değil kural tabanlı çözücü metnin kendisinden okur; uydurma olmaz.
  if (!dl.date && !dl.question && !x.deadline && x.category === 'task' && inputText.trim().length <= TASK_FALLBACK_MAX) {
    const parsed = parseTurkishDate(inputText, now, zone);
    if (parsed.kind === 'ambiguous') dl = { date: null, question: parsed.question };
    else if (parsed.kind === 'ok' && parsed.date > now) {
      dl = { date: parsed.date, question: null };
      dlEvidence = inputText.trim();
      dlSource = /\d/.test(inputText) ? 'explicit' : 'inferred';
    }
  }
  const ev = resolveDate(x.event_time, x.event_evidence, sourceText, now, zone);

  const defaults = applyDefaults({ category: x.category, deadline: dl.date, eventAt: ev.date, now, prefs });

  let deadlineSource: DeadlineSource | null = null;
  if (dl.date) deadlineSource = dlSource === 'inferred' ? 'inferred' : 'explicit';
  else if (defaults.deadline) deadlineSource = 'default';

  const question =
    dl.question ??
    (defaults.deadline === null && (defaults.ask || x.question_for_user) ? (x.question_for_user ?? ASK_DEADLINE_QUESTION) : null);

  return {
    title: x.title,
    category: x.category,
    organization: x.organization,
    deadline: defaults.deadline,
    deadlineSource,
    deadlineEvidence: dl.date ? dlEvidence : null,
    defaultReason: defaults.reason,
    eventAt: ev.date,
    location: x.location,
    effortMinutes: x.effort_minutes,
    requirements: x.requirements,
    keyNotes: x.key_notes,
    nextAction: x.next_action,
    question,
    checkInAt: question ? null : defaults.checkInAt,
  };
}
