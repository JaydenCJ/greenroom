/** TTL helpers. Expiry timestamps are stored as ISO-8601 strings. */

/** Compute the expiry timestamp for an environment deployed at `now`. */
export function computeExpiresAt(now: Date, ttlHours: number): string {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
}

/**
 * Whether an environment is past its expiry. A missing/empty expiry never
 * expires (the record is still being deployed for the first time).
 */
export function isExpired(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return false;
  return now.getTime() > expiry;
}
