/**
 * Basic auth credential management for preview subdomains.
 *
 * Greenroom never stores the plaintext password. If BASIC_AUTH_PASSWORD is
 * set, its bcrypt hash is (re)computed at startup. If not, a random password
 * is generated on first start, printed exactly once to the logs, and only
 * the hash is persisted to DATA_DIR/auth.json for later starts.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSync } from 'bcryptjs';

const BCRYPT_COST = 10;

export interface BasicAuthCredentials {
  user: string;
  /** bcrypt hash in the format Caddy's basic_auth directive expects. */
  hash: string;
  /** Set only when a password was newly generated this start (print once). */
  generatedPassword: string | null;
}

interface AuthFile {
  user: string;
  hash: string;
}

export function ensureBasicAuth(
  dataDir: string,
  user: string,
  configuredPassword: string | null,
): BasicAuthCredentials {
  mkdirSync(dataDir, { recursive: true });
  const authPath = join(dataDir, 'auth.json');

  if (configuredPassword) {
    const hash = hashSync(configuredPassword, BCRYPT_COST);
    writeFileSync(authPath, `${JSON.stringify({ user, hash } satisfies AuthFile, null, 2)}\n`, {
      mode: 0o600,
    });
    return { user, hash, generatedPassword: null };
  }

  if (existsSync(authPath)) {
    const saved = JSON.parse(readFileSync(authPath, 'utf8')) as AuthFile;
    if (saved.user === user && typeof saved.hash === 'string' && saved.hash.length > 0) {
      return { user, hash: saved.hash, generatedPassword: null };
    }
  }

  const generated = randomBytes(18).toString('base64url');
  const hash = hashSync(generated, BCRYPT_COST);
  writeFileSync(authPath, `${JSON.stringify({ user, hash } satisfies AuthFile, null, 2)}\n`, {
    mode: 0o600,
  });
  return { user, hash, generatedPassword: generated };
}
