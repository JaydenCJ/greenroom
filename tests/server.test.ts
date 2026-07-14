import { strict as assert } from 'node:assert';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { CaddyWriter } from '../src/caddy/caddy';
import { Orchestrator } from '../src/core/orchestrator';
import { EnvironmentStore } from '../src/core/store';
import { JobQueue } from '../src/queue';
import { createServer } from '../src/server';
import { signPayload } from '../src/webhook/verify';
import { silentLogger } from '../src/logger';
import {
  loadFixtureRaw,
  MockDockerRunner,
  MockGithubClient,
  MockProxyReloader,
  MockRepoFetcher,
  testConfig,
} from './helpers';

const SECRET = 'test-webhook-secret';
const HASH = '$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUV0123456789';

describe('HTTP server', () => {
  let server: Server;
  let baseUrl: string;
  let store: EnvironmentStore;
  let queue: JobQueue;
  let docker: MockDockerRunner;

  before(async () => {
    const config = testConfig({ webhookSecret: SECRET });
    store = new EnvironmentStore(join(config.dataDir, 'environments.json'));
    docker = new MockDockerRunner();
    const orchestrator = new Orchestrator({
      config,
      store,
      docker,
      fetcher: new MockRepoFetcher(),
      github: new MockGithubClient(),
      caddy: new CaddyWriter(config.caddyDir),
      reloader: new MockProxyReloader(),
      logger: silentLogger,
      basicAuthHash: HASH,
    });
    queue = new JobQueue(silentLogger);
    server = createServer({ config, store, queue, orchestrator, logger: silentLogger });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(() => {
    server.close();
  });

  beforeEach(() => {
    for (const record of store.list()) store.remove(record.project);
  });

  function postWebhook(event: string, body: Buffer, signature?: string) {
    return fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': event,
        'x-github-delivery': 'test-delivery-1',
        ...(signature !== undefined ? { 'x-hub-signature-256': signature } : {}),
      },
      body: new Uint8Array(body),
    });
  }

  it('GET /health returns 200 with status ok', async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string; version: string };
    assert.equal(body.status, 'ok');
    assert.match(body.version, /^\d+\.\d+\.\d+$/);
  });

  it('accepts a correctly signed pull_request webhook and creates an environment', async () => {
    const payload = loadFixtureRaw('pull_request.opened.json');
    const response = await postWebhook('pull_request', payload, signPayload(SECRET, payload));
    assert.equal(response.status, 202);
    const body = (await response.json()) as { queued: string; project: string };
    assert.equal(body.queued, 'deploy');
    assert.equal(body.project, 'gr-acme-demo-app-42');

    await queue.onIdle();
    const record = store.get('gr-acme-demo-app-42');
    assert.equal(record?.status, 'running');
    assert.equal(record?.url, 'https://42-acme-demo-app.preview.example.com');
  });

  it('rejects a tampered payload with 401 and deploys nothing', async () => {
    const payload = loadFixtureRaw('pull_request.opened.json');
    const goodSignature = signPayload(SECRET, payload);
    const tampered = Buffer.from(payload.toString('utf8').replace('"number": 42', '"number": 99'));
    const response = await postWebhook('pull_request', tampered, goodSignature);
    assert.equal(response.status, 401);
    await queue.onIdle();
    assert.equal(store.list().length, 0);
  });

  it('rejects a missing signature with 401', async () => {
    const payload = loadFixtureRaw('pull_request.opened.json');
    const response = await postWebhook('pull_request', payload);
    assert.equal(response.status, 401);
  });

  it('answers ping events with 200', async () => {
    const payload = loadFixtureRaw('ping.json');
    const response = await postWebhook('ping', payload, signPayload(SECRET, payload));
    assert.equal(response.status, 200);
  });

  it('acknowledges unhandled events with 200 ignored', async () => {
    const payload = Buffer.from(JSON.stringify({ action: 'created' }));
    const response = await postWebhook('issue_comment', payload, signPayload(SECRET, payload));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ignored: boolean };
    assert.equal(body.ignored, true);
  });

  it('destroys the environment when the PR closes', async () => {
    const opened = loadFixtureRaw('pull_request.opened.json');
    await postWebhook('pull_request', opened, signPayload(SECRET, opened));
    const closed = loadFixtureRaw('pull_request.closed_merged.json');
    const response = await postWebhook('pull_request', closed, signPayload(SECRET, closed));
    assert.equal(response.status, 202);

    await queue.onIdle();
    const record = store.get('gr-acme-demo-app-42');
    assert.equal(record?.status, 'destroyed');
    assert.equal(record?.destroyedReason, 'merged');
    assert.ok(docker.calls.some((c) => c.op === 'down'));
  });

  it('lists environments over the read API', async () => {
    const payload = loadFixtureRaw('pull_request.opened.json');
    await postWebhook('pull_request', payload, signPayload(SECRET, payload));
    await queue.onIdle();

    const response = await fetch(`${baseUrl}/api/environments`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { environments: Array<{ project: string }> };
    assert.equal(body.environments.length, 1);
    assert.equal(body.environments[0]?.project, 'gr-acme-demo-app-42');
  });

  it('returns 400 for a signed body that is not valid JSON', async () => {
    const payload = Buffer.from('this is not json');
    const response = await postWebhook('pull_request', payload, signPayload(SECRET, payload));
    assert.equal(response.status, 400);
  });

  it('returns 404 for unknown paths and 405 for wrong methods', async () => {
    assert.equal((await fetch(`${baseUrl}/nope`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/webhook`)).status, 405);
    assert.equal((await fetch(`${baseUrl}/health`, { method: 'POST' })).status, 405);
  });

  it('answers bodies over 1MB with 413 and closes the connection', async () => {
    // Slightly over the 1 MiB cap; node:http is used instead of fetch so the
    // early response is readable even though the server then drops the socket.
    const body = Buffer.alloc(1024 * 1024 + 64 * 1024, 0x61);
    const address = server.address() as AddressInfo;
    const result = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: address.port,
          path: '/webhook',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-github-event': 'pull_request',
            'content-length': body.length,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
          );
        },
      );
      // The server may reset the socket after flushing the 413; ignore
      // write-side errors once the response has been received.
      req.on('error', reject);
      req.end(body);
    });
    assert.equal(result.status, 413);
    assert.ok(result.text.includes('payload too large'));
    assert.equal(store.list().length, 0);
  });
});
