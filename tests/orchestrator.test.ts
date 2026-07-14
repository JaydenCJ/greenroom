import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CaddyWriter } from '../src/caddy/caddy';
import { Orchestrator } from '../src/core/orchestrator';
import { EnvironmentStore } from '../src/core/store';
import { routeEvent, type PullRequestInfo } from '../src/webhook/router';
import { silentLogger } from '../src/logger';
import {
  loadFixture,
  MockDockerRunner,
  MockGithubClient,
  MockProxyReloader,
  MockRepoFetcher,
  testConfig,
} from './helpers';

const HASH = '$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUV0123456789';

function prFromFixture(name: string): PullRequestInfo {
  const routed = routeEvent('pull_request', loadFixture(name));
  if (routed.kind !== 'deploy' && routed.kind !== 'destroy') {
    throw new Error(`fixture ${name} did not route to deploy/destroy`);
  }
  return routed.pr;
}

function build(configOverrides = {}) {
  const config = testConfig(configOverrides);
  const store = new EnvironmentStore(join(config.dataDir, 'environments.json'));
  const docker = new MockDockerRunner();
  const fetcher = new MockRepoFetcher();
  const github = new MockGithubClient();
  const caddy = new CaddyWriter(config.caddyDir);
  const reloader = new MockProxyReloader();
  const orchestrator = new Orchestrator({
    config,
    store,
    docker,
    fetcher,
    github,
    caddy,
    reloader,
    logger: silentLogger,
    basicAuthHash: HASH,
    clock: () => new Date('2026-07-08T10:00:00.000Z'),
  });
  return { config, store, docker, fetcher, github, caddy, reloader, orchestrator };
}

describe('orchestrator deploy', () => {
  it('runs the full lifecycle: fetch, compose up, caddy snippet, proxy reload, running record', async () => {
    const { config, store, docker, fetcher, reloader, orchestrator } = build();
    const pr = prFromFixture('pull_request.opened.json');

    const record = await orchestrator.deploy(pr);
    assert.ok(record);
    assert.equal(record.status, 'running');
    assert.equal(record.project, 'gr-acme-demo-app-42');
    assert.equal(record.port, 20000);
    assert.equal(record.url, 'https://42-acme-demo-app.preview.example.com');
    assert.equal(record.expiresAt, '2026-07-11T10:00:00.000Z');

    assert.equal(fetcher.calls.length, 1);
    assert.equal(fetcher.calls[0]?.cloneUrl, 'https://github.com/acme/demo-app.git');
    assert.equal(fetcher.calls[0]?.prNumber, 42);

    assert.equal(docker.calls.length, 1);
    assert.equal(docker.calls[0]?.op, 'up');
    assert.equal(docker.calls[0]?.options.projectName, 'gr-acme-demo-app-42');
    assert.equal(docker.calls[0]?.options.env.GREENROOM_PORT, '20000');
    assert.equal(docker.calls[0]?.options.env.GREENROOM_SHA, pr.headSha);

    assert.ok(existsSync(join(config.caddyDir, 'gr-acme-demo-app-42.caddy')));
    assert.equal(reloader.calls, 1);
    assert.equal(store.get('gr-acme-demo-app-42')?.status, 'running');
  });

  it('creates one PR comment on first deploy and edits it afterwards', async () => {
    const { github, orchestrator } = build();
    await orchestrator.deploy(prFromFixture('pull_request.opened.json'));
    // First deploy: one create (deploying), then updates on the same comment.
    assert.equal(github.created.length, 1);
    assert.ok(github.updated.length >= 1);

    await orchestrator.deploy(prFromFixture('pull_request.synchronize.json'));
    // Redeploy must not create a second comment.
    assert.equal(github.created.length, 1);
    const lastBody = github.updated.at(-1)?.body ?? '';
    assert.ok(lastBody.includes('<!-- greenroom:gr-acme-demo-app-42 -->'));
    assert.ok(lastBody.includes('`b2c3d4e`'));
  });

  it('reuses the same port when a PR is redeployed', async () => {
    const { store, orchestrator } = build();
    await orchestrator.deploy(prFromFixture('pull_request.opened.json'));
    const firstPort = store.get('gr-acme-demo-app-42')?.port;
    await orchestrator.deploy(prFromFixture('pull_request.synchronize.json'));
    assert.equal(store.get('gr-acme-demo-app-42')?.port, firstPort);
    assert.equal(store.get('gr-acme-demo-app-42')?.headSha, 'b2c3d4e5f60718293a4b5c6d7e8f90123456789a');
  });

  it('allocates distinct ports for different PRs', async () => {
    const { store, orchestrator } = build();
    await orchestrator.deploy(prFromFixture('pull_request.opened.json'));
    const other = { ...prFromFixture('pull_request.opened.json'), number: 43 };
    await orchestrator.deploy(other);
    assert.equal(store.get('gr-acme-demo-app-42')?.port, 20000);
    assert.equal(store.get('gr-acme-demo-app-43')?.port, 20001);
  });

  it('isolates same-named repos under different owners (no cross-repo overwrite)', async () => {
    const { store, orchestrator } = build();
    const base = prFromFixture('pull_request.opened.json');
    const chencorp: PullRequestInfo = {
      ...base,
      repo: {
        owner: 'chencorp',
        name: 'demo-app',
        fullName: 'chencorp/demo-app',
        cloneUrl: 'https://github.com/chencorp/demo-app.git',
      },
    };
    const evilcorp: PullRequestInfo = {
      ...base,
      headSha: 'facefacefacefacefacefacefacefaceface0000',
      repo: {
        owner: 'evilcorp',
        name: 'demo-app',
        fullName: 'evilcorp/demo-app',
        cloneUrl: 'https://github.com/evilcorp/demo-app.git',
      },
    };

    await orchestrator.deploy(chencorp);
    await orchestrator.deploy(evilcorp);

    const first = store.get('gr-chencorp-demo-app-42');
    const second = store.get('gr-evilcorp-demo-app-42');
    assert.ok(first && second);
    // The second deploy must not have overwritten the first record.
    assert.equal(first.repoFullName, 'chencorp/demo-app');
    assert.equal(first.headSha, base.headSha);
    assert.equal(second.repoFullName, 'evilcorp/demo-app');
    assert.notEqual(first.port, second.port);
    assert.notEqual(first.subdomain, second.subdomain);

    // Destroying one owner's environment leaves the other untouched.
    await orchestrator.destroy('gr-evilcorp-demo-app-42', 'closed');
    assert.equal(store.get('gr-evilcorp-demo-app-42')?.status, 'destroyed');
    assert.equal(store.get('gr-chencorp-demo-app-42')?.status, 'running');
  });

  it('marks the environment failed when compose up fails and reports the error', async () => {
    const { config, docker, github, store, reloader, orchestrator } = build();
    docker.failNextUp = 'docker compose up failed: build error';
    const record = await orchestrator.deploy(prFromFixture('pull_request.opened.json'));
    assert.equal(record?.status, 'failed');
    assert.equal(store.get('gr-acme-demo-app-42')?.lastError, 'docker compose up failed: build error');
    const lastBody = github.updated.at(-1)?.body ?? '';
    assert.ok(lastBody.includes('Failed'));
    // No snippet may survive a failed deploy: the subdomain must not route
    // to a dead backend.
    assert.ok(!existsSync(join(config.caddyDir, 'gr-acme-demo-app-42.caddy')));
    // The cleanup path still reloads the proxy once.
    assert.equal(reloader.calls, 1);
  });

  it('marks the environment failed and removes the snippet when the proxy reload fails', async () => {
    const { config, store, reloader, orchestrator } = build();
    reloader.failNext = 'caddy reload exited 1';
    const record = await orchestrator.deploy(prFromFixture('pull_request.opened.json'));
    assert.equal(record?.status, 'failed');
    assert.equal(store.get('gr-acme-demo-app-42')?.lastError, 'caddy reload exited 1');
    assert.ok(!existsSync(join(config.caddyDir, 'gr-acme-demo-app-42.caddy')));
  });

  it('refuses repos outside ALLOWED_REPOS', async () => {
    const { store, docker, orchestrator } = build({ allowedRepos: ['acme/other-repo'] });
    const record = await orchestrator.deploy(prFromFixture('pull_request.opened.json'));
    assert.equal(record, null);
    assert.equal(store.list().length, 0);
    assert.equal(docker.calls.length, 0);
  });

  it('allows repos on the allowlist case-insensitively', async () => {
    const { orchestrator } = build({ allowedRepos: ['acme/demo-app'] });
    assert.equal(orchestrator.isAllowed('Acme/Demo-App'), true);
    assert.equal(orchestrator.isAllowed('evil/repo'), false);
  });
});

describe('orchestrator destroy', () => {
  it('tears down compose, removes the caddy snippet, reloads the proxy and marks the record destroyed', async () => {
    const { config, store, docker, reloader, orchestrator } = build();
    await orchestrator.deploy(prFromFixture('pull_request.opened.json'));
    const snippetPath = join(config.caddyDir, 'gr-acme-demo-app-42.caddy');
    assert.ok(existsSync(snippetPath));
    const reloadsAfterDeploy = reloader.calls;

    const record = await orchestrator.destroy('gr-acme-demo-app-42', 'merged');
    assert.equal(record?.status, 'destroyed');
    assert.equal(record?.destroyedReason, 'merged');
    assert.ok(!existsSync(snippetPath));
    assert.equal(reloader.calls, reloadsAfterDeploy + 1);

    const down = docker.calls.find((c) => c.op === 'down');
    assert.ok(down);
    assert.equal(down.options.projectName, 'gr-acme-demo-app-42');
    // The freed port becomes available again.
    assert.deepEqual([...store.usedPorts()], []);
  });

  it('is a no-op for unknown or already destroyed environments', async () => {
    const { docker, orchestrator } = build();
    assert.equal(await orchestrator.destroy('gr-nope-nope-1', 'closed'), null);
    await orchestrator.deploy(prFromFixture('pull_request.opened.json'));
    await orchestrator.destroy('gr-acme-demo-app-42', 'closed');
    const callsAfterFirst = docker.calls.length;
    await orchestrator.destroy('gr-acme-demo-app-42', 'closed');
    assert.equal(docker.calls.length, callsAfterFirst);
  });

  it('still tears down when the proxy reload fails (best effort)', async () => {
    const { config, reloader, orchestrator } = build();
    await orchestrator.deploy(prFromFixture('pull_request.opened.json'));
    reloader.failNext = 'caddy reload exited 1';
    const record = await orchestrator.destroy('gr-acme-demo-app-42', 'closed');
    assert.equal(record?.status, 'destroyed');
    assert.ok(!existsSync(join(config.caddyDir, 'gr-acme-demo-app-42.caddy')));
  });

  it('updates the PR comment with the destroy reason', async () => {
    const { github, orchestrator } = build();
    await orchestrator.deploy(prFromFixture('pull_request.opened.json'));
    await orchestrator.destroy('gr-acme-demo-app-42', 'expired');
    const lastBody = github.updated.at(-1)?.body ?? '';
    assert.ok(lastBody.includes('Destroyed'));
    assert.ok(lastBody.includes('expired'));
  });
});

describe('orchestrator snippet refresh', () => {
  it('rewrites snippets for live environments at startup', async () => {
    const { config, caddy, store, orchestrator } = build();
    await orchestrator.deploy(prFromFixture('pull_request.opened.json'));
    caddy.remove('gr-acme-demo-app-42');

    const count = orchestrator.rewriteSnippets();
    assert.equal(count, 1);
    assert.ok(existsSync(join(config.caddyDir, 'gr-acme-demo-app-42.caddy')));
    assert.equal(store.get('gr-acme-demo-app-42')?.status, 'running');
  });
});
