import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { GithubHttpClient, NullGithubClient } from '../src/adapters/github-http';
import { silentLogger } from '../src/logger';
import { loadFixtureRaw } from './helpers';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function fakeFetch(responses: Array<{ status: number; body: string }>) {
  const requests: RecordedRequest[] = [];
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : null,
    });
    const next = responses.shift() ?? { status: 200, body: '{}' };
    return new Response(next.body, {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { requests, fetchFn };
}

describe('GitHub HTTP client', () => {
  it('creates issue comments with the documented REST call', async () => {
    const { requests, fetchFn } = fakeFetch([
      { status: 201, body: loadFixtureRaw('api.comment_created.json').toString('utf8') },
    ]);
    const client = new GithubHttpClient('gh-test-token', 'https://api.github.com', silentLogger, fetchFn);

    const id = await client.createIssueComment('acme/demo-app', 42, 'preview body');
    assert.equal(id, 3141592653);
    assert.equal(requests.length, 1);
    const req = requests[0]!;
    assert.equal(req.url, 'https://api.github.com/repos/acme/demo-app/issues/42/comments');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.authorization, 'Bearer gh-test-token');
    assert.equal(req.headers.accept, 'application/vnd.github+json');
    assert.equal(req.headers['x-github-api-version'], '2022-11-28');
    assert.deepEqual(JSON.parse(req.body ?? '{}'), { body: 'preview body' });
  });

  it('updates issue comments with PATCH on the comment id', async () => {
    const { requests, fetchFn } = fakeFetch([{ status: 200, body: '{}' }]);
    const client = new GithubHttpClient('gh-test-token', 'https://api.github.com', silentLogger, fetchFn);

    await client.updateIssueComment('acme/demo-app', 3141592653, 'updated body');
    const req = requests[0]!;
    assert.equal(req.url, 'https://api.github.com/repos/acme/demo-app/issues/comments/3141592653');
    assert.equal(req.method, 'PATCH');
    assert.deepEqual(JSON.parse(req.body ?? '{}'), { body: 'updated body' });
  });

  it('reads PR state from the pulls endpoint', async () => {
    const { requests, fetchFn } = fakeFetch([
      { status: 200, body: loadFixtureRaw('api.pull_merged.json').toString('utf8') },
    ]);
    const client = new GithubHttpClient('gh-test-token', 'https://api.github.com', silentLogger, fetchFn);

    const state = await client.getPullState('acme/demo-app', 42);
    assert.deepEqual(state, { state: 'closed', merged: true });
    assert.equal(requests[0]?.url, 'https://api.github.com/repos/acme/demo-app/pulls/42');
    assert.equal(requests[0]?.method, 'GET');
  });

  it('returns unknown instead of throwing when the pulls endpoint fails', async () => {
    const { fetchFn } = fakeFetch([{ status: 500, body: '{"message":"boom"}' }]);
    const client = new GithubHttpClient('gh-test-token', 'https://api.github.com', silentLogger, fetchFn);
    const state = await client.getPullState('acme/demo-app', 42);
    assert.deepEqual(state, { state: 'unknown' });
  });

  it('throws a typed error with status for failed comment calls', async () => {
    const { fetchFn } = fakeFetch([{ status: 403, body: '{"message":"forbidden"}' }]);
    const client = new GithubHttpClient('gh-test-token', 'https://api.github.com', silentLogger, fetchFn);
    await assert.rejects(
      () => client.createIssueComment('acme/demo-app', 42, 'body'),
      (error: Error & { status?: number }) => error.status === 403,
    );
  });

  it('supports GitHub Enterprise base URLs', async () => {
    const { requests, fetchFn } = fakeFetch([{ status: 200, body: '{"id": 1}' }]);
    const client = new GithubHttpClient('gh-test-token', 'https://ghe.internal/api/v3', silentLogger, fetchFn);
    await client.createIssueComment('acme/demo-app', 42, 'body');
    assert.ok(requests[0]?.url.startsWith('https://ghe.internal/api/v3/repos/'));
  });
});

describe('null GitHub client (no token)', () => {
  it('skips comment creation and reports unknown PR state', async () => {
    const client = new NullGithubClient(silentLogger);
    assert.equal(await client.createIssueComment('acme/demo-app', 42), null);
    assert.deepEqual(await client.getPullState(), { state: 'unknown' });
  });
});
