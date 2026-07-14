import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Reaper } from '../src/reaper';
import { EnvironmentStore, type EnvironmentRecord } from '../src/core/store';
import type { DestroyReason } from '../src/core/orchestrator';
import { silentLogger } from '../src/logger';
import { MockGithubClient, tempDir } from './helpers';

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

function build(now: string) {
  const store = new EnvironmentStore(join(tempDir('reaper'), 'environments.json'));
  const github = new MockGithubClient();
  const destroyed: Array<{ project: string; reason: DestroyReason }> = [];
  const reaper = new Reaper({
    store,
    github,
    logger: silentLogger,
    destroy: async (project, reason) => {
      destroyed.push({ project, reason });
      const existing = store.get(project);
      if (existing) store.upsert({ ...existing, status: 'destroyed', destroyedReason: reason });
    },
    clock: () => new Date(now),
  });
  return { store, github, destroyed, reaper };
}

describe('TTL reaper', () => {
  it('destroys environments past their TTL', async () => {
    const { store, destroyed, reaper } = build('2026-07-11T10:00:01.000Z');
    store.upsert(record('gr-acme-demo-app-42'));
    const reaped = await reaper.runOnce();
    assert.equal(reaped, 1);
    assert.deepEqual(destroyed, [{ project: 'gr-acme-demo-app-42', reason: 'expired' }]);
  });

  it('leaves unexpired environments with open PRs alone', async () => {
    const { store, destroyed, reaper } = build('2026-07-09T10:00:00.000Z');
    store.upsert(record('gr-acme-demo-app-42'));
    const reaped = await reaper.runOnce();
    assert.equal(reaped, 0);
    assert.deepEqual(destroyed, []);
    assert.equal(store.get('gr-acme-demo-app-42')?.status, 'running');
  });

  it('destroys environments whose PR was merged (missed webhook)', async () => {
    const { store, github, destroyed, reaper } = build('2026-07-09T10:00:00.000Z');
    store.upsert(record('gr-acme-demo-app-42'));
    github.pullStates.set('acme/demo-app#42', { state: 'closed', merged: true });
    await reaper.runOnce();
    assert.deepEqual(destroyed, [{ project: 'gr-acme-demo-app-42', reason: 'merged' }]);
  });

  it('destroys environments whose PR was closed without merging', async () => {
    const { store, github, destroyed, reaper } = build('2026-07-09T10:00:00.000Z');
    store.upsert(record('gr-acme-demo-app-42'));
    github.pullStates.set('acme/demo-app#42', { state: 'closed', merged: false });
    await reaper.runOnce();
    assert.deepEqual(destroyed, [{ project: 'gr-acme-demo-app-42', reason: 'closed' }]);
  });

  it('keeps environments when the PR state is unknown (no token) and TTL is not reached', async () => {
    const { store, github, destroyed, reaper } = build('2026-07-09T10:00:00.000Z');
    store.upsert(record('gr-acme-demo-app-42'));
    github.pullStates.set('acme/demo-app#42', { state: 'unknown' });
    const reaped = await reaper.runOnce();
    assert.equal(reaped, 0);
    assert.deepEqual(destroyed, []);
  });

  it('skips destroyed environments entirely', async () => {
    const { store, destroyed, reaper } = build('2026-07-12T10:00:00.000Z');
    store.upsert(record('gr-acme-demo-app-42', { status: 'destroyed', destroyedReason: 'closed' }));
    const reaped = await reaper.runOnce();
    assert.equal(reaped, 0);
    assert.deepEqual(destroyed, []);
  });

  it('reaps expired failed environments too', async () => {
    const { store, destroyed, reaper } = build('2026-07-12T10:00:00.000Z');
    store.upsert(record('gr-acme-demo-app-42', { status: 'failed', lastError: 'compose build broke' }));
    await reaper.runOnce();
    assert.deepEqual(destroyed, [{ project: 'gr-acme-demo-app-42', reason: 'expired' }]);
  });
});
