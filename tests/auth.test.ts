import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { compareSync } from 'bcryptjs';
import { ensureBasicAuth } from '../src/auth';
import { tempDir } from './helpers';

describe('basic auth credentials', () => {
  it('hashes a configured password with bcrypt', () => {
    const dir = tempDir('auth');
    const creds = ensureBasicAuth(dir, 'preview', 'my-chosen-password');
    assert.equal(creds.user, 'preview');
    assert.equal(creds.generatedPassword, null);
    assert.ok(creds.hash.startsWith('$2'));
    assert.ok(compareSync('my-chosen-password', creds.hash));
  });

  it('generates a password on first start and persists only the hash', () => {
    const dir = tempDir('auth');
    const creds = ensureBasicAuth(dir, 'preview', null);
    assert.ok(creds.generatedPassword);
    assert.ok(compareSync(creds.generatedPassword!, creds.hash));

    const saved = readFileSync(join(dir, 'auth.json'), 'utf8');
    assert.ok(!saved.includes(creds.generatedPassword!), 'plaintext password must not be persisted');
    assert.ok(existsSync(join(dir, 'auth.json')));
  });

  it('reuses the stored hash on later starts (password shown only once)', () => {
    const dir = tempDir('auth');
    const first = ensureBasicAuth(dir, 'preview', null);
    const second = ensureBasicAuth(dir, 'preview', null);
    assert.equal(second.generatedPassword, null);
    assert.equal(second.hash, first.hash);
  });

  it('generated passwords are long and unique', () => {
    const a = ensureBasicAuth(tempDir('auth'), 'preview', null);
    const b = ensureBasicAuth(tempDir('auth'), 'preview', null);
    assert.ok((a.generatedPassword ?? '').length >= 20);
    assert.notEqual(a.generatedPassword, b.generatedPassword);
  });
});
