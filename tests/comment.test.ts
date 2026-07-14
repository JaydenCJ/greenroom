import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { commentMarker, renderComment } from '../src/core/comment';
import type { EnvironmentRecord } from '../src/core/store';

function record(overrides: Partial<EnvironmentRecord> = {}): EnvironmentRecord {
  return {
    project: 'gr-acme-demo-app-42',
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
    updatedAt: '2026-07-08T10:01:00.000Z',
    expiresAt: '2026-07-11T10:01:00.000Z',
    commentId: null,
    dryRun: false,
    lastError: null,
    destroyedReason: null,
    ...overrides,
  };
}

describe('PR comment rendering', () => {
  it('starts with the hidden project marker', () => {
    const body = renderComment(record());
    assert.ok(body.startsWith(commentMarker('gr-acme-demo-app-42')));
  });

  it('shows the preview URL, short sha and expiry when running', () => {
    const body = renderComment(record());
    assert.ok(body.includes('| **Status** | Ready |'));
    assert.ok(body.includes('https://42-acme-demo-app.preview.example.com'));
    assert.ok(body.includes('`a1b2c3d`'));
    assert.ok(body.includes('2026-07-11T10:01:00Z'));
  });

  it('does not show a URL while deploying', () => {
    const body = renderComment(record({ status: 'deploying', expiresAt: null }));
    assert.ok(body.includes('| **Status** | Deploying |'));
    assert.ok(!body.includes('https://42-acme-demo-app.preview.example.com'));
  });

  it('shows the first error line when failed', () => {
    const body = renderComment(
      record({ status: 'failed', lastError: 'docker compose up failed: exit 1\nlong stack trace' }),
    );
    assert.ok(body.includes('| **Status** | Failed |'));
    assert.ok(body.includes('docker compose up failed: exit 1'));
    assert.ok(!body.includes('long stack trace'));
  });

  it('shows the teardown reason when destroyed', () => {
    const body = renderComment(record({ status: 'destroyed', destroyedReason: 'merged' }));
    assert.ok(body.includes('| **Status** | Destroyed |'));
    assert.ok(body.includes('| **Reason** | merged |'));
    assert.ok(!body.includes('https://42-acme-demo-app.preview.example.com'));
  });

  it('renders valid markdown table rows', () => {
    const body = renderComment(record());
    const tableLines = body.split('\n').filter((l) => l.startsWith('|'));
    assert.ok(tableLines.length >= 4);
    for (const line of tableLines) {
      assert.ok(line.endsWith('|'), `table row not closed: ${line}`);
    }
  });
});
