/**
 * Injected side-effect boundaries. Everything that talks to docker, git or
 * the GitHub API sits behind these interfaces, so core logic is testable
 * with mocks and the test suite never touches the network or a daemon.
 */

export interface ComposeOptions {
  /** Compose project name (-p). */
  projectName: string;
  /** Compose file path relative to `cwd`. */
  composeFile: string;
  /** Working directory: the checked-out PR working copy. */
  cwd: string;
  /** Extra environment variables passed to compose (GREENROOM_PORT etc.). */
  env: Record<string, string>;
}

export interface DockerRunner {
  /** `docker compose ... up -d --build` for a PR environment. */
  up(options: ComposeOptions): Promise<void>;
  /** `docker compose ... down -v` releasing containers, networks and volumes. */
  down(options: ComposeOptions): Promise<void>;
}

export interface FetchOptions {
  cloneUrl: string;
  prNumber: number;
  /** Directory the working copy lives in (created on first fetch). */
  dir: string;
}

export interface RepoFetcher {
  /** Ensure `dir` contains a checkout of the PR head. */
  fetchPullRequest(options: FetchOptions): Promise<void>;
}

export interface ProxyReloader {
  /**
   * Make the reverse proxy pick up snippet changes (e.g. `caddy reload`).
   * Rejects when the reload could not be applied.
   */
  reload(): Promise<void>;
}

export type PullState =
  | { state: 'open' }
  | { state: 'closed'; merged: boolean }
  | { state: 'unknown' };

export interface GithubClient {
  /**
   * Create an issue comment on a PR. Returns the comment id, or null when
   * commenting is disabled (no token configured).
   */
  createIssueComment(repoFullName: string, issueNumber: number, body: string): Promise<number | null>;
  /** Edit an existing issue comment in place. */
  updateIssueComment(repoFullName: string, commentId: number, body: string): Promise<void>;
  /** Current state of a PR, used by the reaper to catch missed close events. */
  getPullState(repoFullName: string, prNumber: number): Promise<PullState>;
}
