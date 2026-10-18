import type { Reminder } from '../db/schema.js';
import { buildReminder } from '../notify/messages.js';
import { type AppDeps, windowOpen } from './deps.js';

export const MAX_ATTEMPTS = 4; // ilk deneme + 3 yeniden deneme, sonra `failed`
const BATCH = 20;
const STALE_CLAIM_MS = 10 * 60_000;

/** n. başarısız denemeden sonra bekleme: 1, 4, 16 dakika. */
export function retryDelayMs(attempts: number): number {
  return 4 ** (attempts - 1) * 60_000;
}

export type DeliveryOutcome = 'sent' | 'retry' | 'failed' | 'cancelled';

/** Tek bir hatırlatmayı gönderir; pencere açıksa serbest mesaj, kapalıysa şablon. */
export async function deliver(deps: AppDeps, r: Reminder): Promise<DeliveryOutcome> {
  const { store } = deps;
  const now = deps.now();
  const [item, user] = await Promise.all([store.getItem(r.itemId), store.getUser(r.userId)]);
  if (!item || !user || item.status === 'done' || item.status === 'dropped' || item.status === 'expired') {
    await store.markReminderCancelled(r.id);
    return 'cancelled';
  }
  const msg = buildReminder(r.kind, item, user.timezone, now);
  try {
    const result = windowOpen(user, now)
      ? await deps.notifier.sendButtons(user.address, msg.text, msg.buttons)
      : await deps.notifier.sendTemplate(user.address, msg.template);
    await store.markReminderSent(r.id, result.messageId, now);
    if (item.status === 'snoozed') await store.updateItem(item.id, { status: 'open' });
    return 'sent';
  } catch (err) {
    const attempts = r.attempts + 1;
    const error = err instanceof Error ? err.message : String(err);
    if (attempts >= MAX_ATTEMPTS) {
      await store.markReminderFailed(r.id, attempts, error);
      deps.log('hatırlatma gönderilemedi', { id: r.id, error });
      return 'failed';
    }
    await store.markReminderRetry(r.id, attempts, new Date(+now + retryDelayMs(attempts)), error);
    return 'retry';
  }
}

/** Zamanlayıcının bir turu: vadesi gelenleri üzerine al ve gönder. */
export async function tick(deps: AppDeps): Promise<number> {
  const now = deps.now();
  await deps.store.releaseStaleClaims(new Date(+now - STALE_CLAIM_MS));
  let total = 0;
  for (;;) {
    const due = await deps.store.claimDueReminders(now, BATCH);
    for (const r of due) await deliver(deps, r);
    total += due.length;
    if (due.length < BATCH) return total;
  }
}

/** Dakikada bir çalışır; önceki tur bitmeden yenisi başlamaz. */
export function startScheduler(deps: AppDeps, intervalMs = 60_000): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick(deps);
    } catch (err) {
      deps.log('zamanlayıcı hatası', { err: String(err) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  void run();
  return () => clearInterval(timer);
}
