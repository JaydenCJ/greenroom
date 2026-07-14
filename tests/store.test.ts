import { strict as assert } from 'node:assert';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { EnvironmentStore, type EnvironmentRecord } from '../src/core/store';
import { allocatePort, PortsExhaustedError } from '../src/core/ports';
import { tempDir } from './helpers';

function record(project: string, overrides: Partial<EnvironmentRecord> = {}): EnvironmentRecord {
  return {
    project,
    repoFullName: 'acme/demo-app',
    repoName: 'demo-app',
    cloneUrl: 'https://github.com/acme/demo-app.git',
    prNumber: 42,
    headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    headRef: 'feature/checkout',
    status: 'running',
    subdomain: '42-acme-demo-app.preview.example.com',
    url: 'https://42-acme-demo-app.preview.example.com',
    port: 20000,
    createdAt: '2026-07-08T10:00:00.000Z',
    updatedAt: '2026-07-08T10:00:00.000Z',
    expiresAt: '2026-07-11T10:00:00.000Z',
    commentId: null,
    dryRun: false,
    lastError: null,
    destroyedReason: null,
    ...overrides,
  };
}

describe('environment store', () => {
  it('persists records and reloads them from disk', () => {
    const filePath = join(tempDir('store'), 'environments.json');
    const store = new EnvironmentStore(filePath);
    store.upsert(record('gr-acme-demo-app-42'));
    store.upsert(record('gr-acme-demo-app-43', { prNumber: 43, port: 20001 }));

    const reloaded = new EnvironmentStore(filePath);
    assert.equal(reloaded.list().length, 2);
    assert.equal(reloaded.get('gr-acme-demo-app-42')?.port, 20000);
    assert.equal(reloaded.get('gr-acme-demo-app-43')?.prNumber, 43);
  });

  it('starts empty when no state file exists', () => {
    const store = new EnvironmentStore(join(tempDir('store'), 'environments.json'));
    assert.deepEqual(store.list(), []);
  });

  it('upsert overwrites an existing record', () => {
    const store = new EnvironmentStore(join(tempDir('store'), 'environments.json'));
    store.upsert(record('gr-acme-demo-app-42', { status: 'deploying' }));
    store.upsert(record('gr-acme-demo-app-42', { status: 'running' }));
    assert.equal(store.list().length, 1);
    assert.equal(store.get('gr-acme-demo-app-42')?.status, 'running');
  });

  it('active() excludes destroyed environments and usedPorts follows it', () => {
    const store = new EnvironmentStore(join(tempDir('store'), 'environments.json'));
    store.upsert(record('gr-acme-demo-app-42', { status: 'running', port: 20000 }));
    store.upsert(record('gr-acme-demo-app-43', { status: 'destroyed', port: 20001 }));
    assert.deepEqual(
      store.active().map((r) => r.project),
      ['gr-acme-demo-app-42'],
    );
    assert.deepEqual([...store.usedPorts()], [20000]);
  });

  it('leaves no temp files behind after atomic writes', () => {
    const dir = tempDir('store');
    const filePath = join(dir, 'environments.json');
    const store = new EnvironmentStore(filePath);
    store.upsert(record('gr-acme-demo-app-42'));
    assert.ok(existsSync(filePath));
    const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
  });

  it('remove deletes a record', () => {
    const store = new EnvironmentStore(join(tempDir('store'), 'environments.json'));
    store.upsert(record('gr-acme-demo-app-42'));
    store.remove('gr-acme-demo-app-42');
    assert.equal(store.get('gr-acme-demo-app-42'), undefined);
  });
});

describe('port allocation', () => {
  it('allocates the lowest free port', () => {
    assert.equal(allocatePort(new Set([20000, 20001]), 20000, 20100), 20002);
  });

  it('allocates the start port when nothing is used', () => {
    assert.equal(allocatePort(new Set(), 20000, 20100), 20000);
  });

  it('throws a clear error when the range is exhausted', () => {
    assert.throws(() => allocatePort(new Set([20000, 20001]), 20000, 20001), PortsExhaustedError);
  });
});
