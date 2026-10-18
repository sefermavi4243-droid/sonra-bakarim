import { createHmac, timingSafeEqual } from 'node:crypto';

/** Meta'nın `X-Hub-Signature-256: sha256=<hex>` başlığını ham gövdeyle doğrular. */
export function verifySignature(rawBody: string | Buffer, header: string | undefined | null, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function sign(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}
