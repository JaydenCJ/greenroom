/**
 * GitHub REST API adapter. Uses the injected `fetch` implementation so unit
 * tests can assert requests and serve fixture responses without any network
 * traffic. `NullGithubClient` is used when no GITHUB_TOKEN is configured:
 * deployments still happen, PR comments and state checks are skipped.
 */
import { VERSION } from '../version';
import type { Logger } from '../logger';
import type { GithubClient, PullState } from './types';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class GithubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class GithubHttpClient implements GithubClient {
  constructor(
    private readonly token: string,
    private readonly apiUrl: string,
    private readonly logger: Logger,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
  ) {}

  private headers(): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${this.token}`,
      'user-agent': `greenroom/${VERSION}`,
      'x-github-api-version': '2022-11-28',
    };
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetchFn(`${this.apiUrl}${path}`, {
      method,
      headers: {
        ...this.headers(),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      throw new GithubApiError(response.status, `${method} ${path} -> ${response.status}: ${text}`);
    }
    return response.json();
  }

  async createIssueComment(repoFullName: string, issueNumber: number, body: string): Promise<number | null> {
    const result = (await this.request('POST', `/repos/${repoFullName}/issues/${issueNumber}/comments`, {
      body,
    })) as { id: number };
    return result.id;
  }

  async updateIssueComment(repoFullName: string, commentId: number, body: string): Promise<void> {
    await this.request('PATCH', `/repos/${repoFullName}/issues/comments/${commentId}`, { body });
  }

  async getPullState(repoFullName: string, prNumber: number): Promise<PullState> {
    try {
      const pr = (await this.request('GET', `/repos/${repoFullName}/pulls/${prNumber}`)) as {
        state: string;
        merged: boolean;
      };
      if (pr.state === 'open') return { state: 'open' };
      return { state: 'closed', merged: pr.merged === true };
    } catch (error) {
      this.logger.warn(`could not read PR state for ${repoFullName}#${prNumber}: ${(error as Error).message}`);
      return { state: 'unknown' };
    }
  }
}

/** Used when no GITHUB_TOKEN is set: comments are skipped, PR state is unknown. */
export class NullGithubClient implements GithubClient {
  constructor(private readonly logger: Logger) {}

  async createIssueComment(repoFullName: string, issueNumber: number): Promise<number | null> {
    this.logger.info(`PR comment skipped for ${repoFullName}#${issueNumber} (no GITHUB_TOKEN configured)`);
    return null;
  }

  async updateIssueComment(): Promise<void> {
    // Nothing to update: comments are disabled without a token.
  }

  async getPullState(): Promise<PullState> {
    return { state: 'unknown' };
  }
}
