/**
 * Git adapter. Fetches the head of a pull request into a working directory
 * using the standard `pull/<n>/head` ref that GitHub exposes on every
 * repository. `DryRunRepoFetcher` logs commands instead of executing them.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Logger } from '../logger';
import type { FetchOptions, RepoFetcher } from './types';

/** `git clone` argument vector. Pure and unit-tested. */
export function cloneArgs(cloneUrl: string, dir: string): string[] {
  return ['clone', '--depth', '50', cloneUrl, dir];
}

/** `git fetch` argument vector for a PR head ref. Pure and unit-tested. */
export function fetchPrArgs(prNumber: number): string[] {
  return ['fetch', '--depth', '50', 'origin', `pull/${prNumber}/head`];
}

/** `git checkout` argument vector for the fetched ref. Pure and unit-tested. */
export function checkoutFetchHeadArgs(): string[] {
  return ['checkout', '--force', '--detach', 'FETCH_HEAD'];
}

function runGit(args: string[], cwd: string | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`git ${args.join(' ')} failed: ${stderr.trim() || error.message}`));
        } else {
          resolve();
        }
      },
    );
  });
}

export class GitCliFetcher implements RepoFetcher {
  constructor(private readonly logger: Logger) {}

  async fetchPullRequest(options: FetchOptions): Promise<void> {
    const gitDir = join(options.dir, '.git');
    if (!existsSync(gitDir)) {
      mkdirSync(dirname(options.dir), { recursive: true });
      this.logger.info(`git clone ${options.cloneUrl} -> ${options.dir}`);
      await runGit(cloneArgs(options.cloneUrl, options.dir), undefined);
    }
    this.logger.info(`git fetch origin pull/${options.prNumber}/head (cwd=${options.dir})`);
    await runGit(fetchPrArgs(options.prNumber), options.dir);
    await runGit(checkoutFetchHeadArgs(), options.dir);
  }
}

export class DryRunRepoFetcher implements RepoFetcher {
  /** Commands that would have been executed, for assertions and logs. */
  readonly commands: string[] = [];

  constructor(private readonly logger: Logger) {}

  async fetchPullRequest(options: FetchOptions): Promise<void> {
    const commands = [
      `git ${cloneArgs(options.cloneUrl, options.dir).join(' ')}`,
      `git ${fetchPrArgs(options.prNumber).join(' ')}`,
      `git ${checkoutFetchHeadArgs().join(' ')}`,
    ];
    for (const command of commands) {
      this.commands.push(command);
      this.logger.info(`[dry-run] ${command}`);
    }
  }
}
