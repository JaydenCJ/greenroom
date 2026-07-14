/** Shared test utilities: fixture loading and mock adapters. */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../src/config';
import type {
  ComposeOptions,
  DockerRunner,
  FetchOptions,
  GithubClient,
  ProxyReloader,
  PullState,
  RepoFetcher,
} from '../src/adapters/types';

/** Absolute path of a file in tests/fixtures (works from dist/tests too). */
export function fixturePath(name: string): string {
  return join(__dirname, '..', '..', 'tests', 'fixtures', name);
}

export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(fixturePath(name), 'utf8'));
}

export function loadFixtureRaw(name: string): Buffer {
  return readFileSync(fixturePath(name));
}

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

/** A Config with test-friendly defaults; override fields as needed. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  const base = tempDir('greenroom-test');
  return {
    host: '127.0.0.1',
    port: 0,
    webhookSecret: 'test-webhook-secret',
    baseDomain: 'preview.example.com',
    githubToken: null,
    githubApiUrl: 'https://api.github.com',
    dataDir: join(base, 'data'),
    caddyDir: join(base, 'caddy'),
    workDir: join(base, 'work'),
    ttlHours: 72,
    reaperIntervalMinutes: 10,
    portRangeStart: 20000,
    portRangeEnd: 20100,
    basicAuthUser: 'preview',
    basicAuthPassword: null,
    proxyUpstreamHost: '127.0.0.1',
    caddyReloadCmd: null,
    previewBindHost: '127.0.0.1',
    allowedRepos: null,
    composeFile: 'docker-compose.yml',
    dryRun: false,
    ...overrides,
  };
}

export class MockDockerRunner implements DockerRunner {
  readonly calls: Array<{ op: 'up' | 'down'; options: ComposeOptions }> = [];
  failNextUp: string | null = null;

  async up(options: ComposeOptions): Promise<void> {
    this.calls.push({ op: 'up', options });
    if (this.failNextUp) {
      const message = this.failNextUp;
      this.failNextUp = null;
      throw new Error(message);
    }
  }

  async down(options: ComposeOptions): Promise<void> {
    this.calls.push({ op: 'down', options });
  }
}

export class MockProxyReloader implements ProxyReloader {
  /** Number of reloads triggered so far. */
  calls = 0;
  /** When set, the next reload rejects with this message. */
  failNext: string | null = null;

  async reload(): Promise<void> {
    this.calls += 1;
    if (this.failNext) {
      const message = this.failNext;
      this.failNext = null;
      throw new Error(message);
    }
  }
}

export class MockRepoFetcher implements RepoFetcher {
  readonly calls: FetchOptions[] = [];

  async fetchPullRequest(options: FetchOptions): Promise<void> {
    this.calls.push(options);
  }
}

export class MockGithubClient implements GithubClient {
  readonly created: Array<{ repo: string; issue: number; body: string }> = [];
  readonly updated: Array<{ repo: string; commentId: number; body: string }> = [];
  pullStates = new Map<string, PullState>();
  private nextCommentId = 1000;

  async createIssueComment(repoFullName: string, issueNumber: number, body: string): Promise<number | null> {
    this.created.push({ repo: repoFullName, issue: issueNumber, body });
    this.nextCommentId += 1;
    return this.nextCommentId;
  }

  async updateIssueComment(repoFullName: string, commentId: number, body: string): Promise<void> {
    this.updated.push({ repo: repoFullName, commentId, body });
  }

  async getPullState(repoFullName: string, prNumber: number): Promise<PullState> {
    return this.pullStates.get(`${repoFullName}#${prNumber}`) ?? { state: 'open' };
  }
}
