/**
 * GitHub webhook signature verification (X-Hub-Signature-256).
 *
 * GitHub signs the raw request body with HMAC-SHA256 using the webhook
 * secret and sends the hex digest as `sha256=<hex>`. Verification recomputes
 * the digest over the exact raw bytes and compares in constant time.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Compute the signature header value GitHub would send for a payload. */
export function signPayload(secret: string, payload: Buffer | string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verify an X-Hub-Signature-256 header against the raw request body.
 * Returns false for missing, malformed, wrong-algorithm or tampered
 * signatures. Comparison is timing-safe.
 */
export function verifySignature(
  secret: string,
  payload: Buffer | string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = Buffer.from(signPayload(secret, payload), 'utf8');
  const actual = Buffer.from(signatureHeader, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
