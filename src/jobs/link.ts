import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Device, User } from '../db/schema.js';
import type { Store } from '../db/store.js';

/** `bağla` kodunun geçerlilik süresi. */
export const LINK_CODE_MINUTES = 10;

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Boşluk ve tireleri atıp 6 haneyi döndürür; geçersizse null. */
export function normalizeCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** Tek kullanımlık 6 haneli kod üretir; veritabanına yalnızca özeti yazılır. */
export async function createLinkCode(store: Store, user: User, now: Date): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await store.createLinkCode(user.id, sha256(code), new Date(+now + LINK_CODE_MINUTES * 60_000));
  return code;
}

/**
 * Kodu cihaz anahtarıyla takas eder. Anahtar yalnızca bu yanıtta açık hâliyle
 * döner; sonra yalnızca özeti saklanır.
 */
export async function redeemLinkCode(
  store: Store,
  code: string,
  deviceName: string,
  now: Date,
): Promise<{ token: string; device: Device; user: User } | null> {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const userId = await store.consumeLinkCode(sha256(normalized), now);
  if (!userId) return null;
  const user = await store.getUser(userId);
  if (!user) return null;
  const token = randomBytes(32).toString('base64url');
  const name = deviceName.trim().slice(0, 60) || 'Cihaz';
  const device = await store.createDevice({ userId, name, tokenHash: sha256(token) }, now);
  return { token, device, user };
}

/** Cihaz anahtarından kullanıcıyı bulur. */
export async function authenticate(store: Store, token: string, now: Date): Promise<{ user: User; device: Device } | null> {
  if (!token || token.length < 20) return null;
  const device = await store.findDeviceByToken(sha256(token));
  if (!device) return null;
  const user = await store.getUser(device.userId);
  if (!user) return null;
  // Her istekte yazmamak için dakikada bir güncelle.
  if (!device.lastSeenAt || +now - +device.lastSeenAt > 60_000) await store.touchDevice(device.id, now);
  return { user, device };
}

/** Takvim aboneliği adresindeki gizli parça; yoksa üretilir. */
export async function ensureCalendarToken(store: Store, user: User): Promise<string> {
  if (user.calendarToken) return user.calendarToken;
  const token = randomBytes(24).toString('base64url');
  await store.updateUser(user.id, { calendarToken: token });
  return token;
}
