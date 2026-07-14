import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CommandProxyReloader, NoopProxyReloader } from '../src/adapters/proxy-reload';
import { silentLogger } from '../src/logger';
import { tempDir } from './helpers';

describe('CommandProxyReloader', () => {
  it('runs the configured command and resolves on exit 0', async () => {
    const dir = tempDir('reload');
    const marker = join(dir, 'reloaded');
    const reloader = new CommandProxyReloader(`printf reloaded > "${marker}"`, silentLogger);
    await reloader.reload();
    assert.equal(readFileSync(marker, 'utf8'), 'reloaded');
  });

  it('rejects with the command stderr when the command exits non-zero', async () => {
    const reloader = new CommandProxyReloader('echo caddy is down >&2; exit 3', silentLogger);
    await assert.rejects(reloader.reload(), /proxy reload command failed: caddy is down/);
  });
});

describe('NoopProxyReloader', () => {
  it('resolves without side effects', async () => {
    await new NoopProxyReloader(silentLogger, 'dry-run').reload();
  });
});
