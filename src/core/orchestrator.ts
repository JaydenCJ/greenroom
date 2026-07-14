/**
 * Environment orchestrator: the one place that turns PR events into real
 * side effects. For each PR it fetches the head ref, brings up an isolated
 * docker compose project, then writes a Caddy site snippet and reloads the
 * proxy; on close/expiry it tears everything down again. All side effects
 * go through injected adapters, so the full lifecycle is covered by unit
 * tests with mocks.
 */
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Config } from '../config';
import type { Logger } from '../logger';
import type { DockerRunner, GithubClient, ProxyReloader, RepoFetcher } from '../adapters/types';
import type { PullRequestInfo } from '../webhook/router';
import { CaddyWriter, renderCaddySnippet } from '../caddy/caddy';
import { renderComment } from './comment';
import { composeProjectName, previewSubdomain, previewUrl } from './names';
import { allocatePort } from './ports';
import { EnvironmentStore, type EnvironmentRecord } from './store';
import { computeExpiresAt } from './ttl';

export type DestroyReason = 'closed' | 'merged' | 'expired';

export interface OrchestratorDeps {
  config: Config;
  store: EnvironmentStore;
  docker: DockerRunner;
  fetcher: RepoFetcher;
  github: GithubClient;
  caddy: CaddyWriter;
  reloader: ProxyReloader;
  logger: Logger;
  /** bcrypt hash used in generated Caddy snippets. */
  basicAuthHash: string;
  /** Injectable clock for deterministic TTL tests. */
  clock?: () => Date;
}

export class Orchestrator {
  private readonly clock: () => Date;

  constructor(private readonly deps: OrchestratorDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  /** Whether a repo is allowed to get environments on this instance. */
  isAllowed(repoFullName: string): boolean {
    const { allowedRepos } = this.deps.config;
    return allowedRepos === null || allowedRepos.includes(repoFullName.toLowerCase());
  }

  private workDirFor(project: string): string {
    return resolve(join(this.deps.config.workDir, project));
  }

  private renderSnippet(record: EnvironmentRecord): string {
    const { config, basicAuthHash } = this.deps;
    return renderCaddySnippet({
      subdomain: record.subdomain,
      upstreamHost: config.proxyUpstreamHost,
      port: record.port,
      basicAuthUser: config.basicAuthUser,
      basicAuthHash,
    });
  }

  /** Create or update the single bot comment for a record; never throws. */
  private async syncComment(record: EnvironmentRecord): Promise<void> {
    const { github, store, logger } = this.deps;
    const body = renderComment(record);
    try {
      if (record.commentId === null) {
        const id = await github.createIssueComment(record.repoFullName, record.prNumber, body);
        if (id !== null) {
          record.commentId = id;
          store.upsert(record);
        }
      } else {
        await github.updateIssueComment(record.repoFullName, record.commentId, body);
      }
    } catch (error) {
      logger.warn(
        `could not sync PR comment for ${record.repoFullName}#${record.prNumber}: ${(error as Error).message}`,
      );
    }
  }

  /** Deploy (or redeploy) the environment for a PR head. */
  async deploy(pr: PullRequestInfo): Promise<EnvironmentRecord | null> {
    const { config, store, docker, fetcher, caddy, reloader, logger } = this.deps;

    if (!this.isAllowed(pr.repo.fullName)) {
      logger.warn(`repo ${pr.repo.fullName} is not in ALLOWED_REPOS; ignoring PR #${pr.number}`);
      return null;
    }

    const project = composeProjectName(pr.repo.owner, pr.repo.name, pr.number);
    const now = this.clock();
    const existing = store.get(project);
    const reusable = existing && existing.status !== 'destroyed';
    const port = reusable
      ? existing.port
      : allocatePort(store.usedPorts(), config.portRangeStart, config.portRangeEnd);

    const record: EnvironmentRecord = {
      project,
      repoFullName: pr.repo.fullName,
      repoName: pr.repo.name,
      cloneUrl: pr.repo.cloneUrl,
      prNumber: pr.number,
      headSha: pr.headSha,
      headRef: pr.headRef,
      status: 'deploying',
      subdomain: previewSubdomain(pr.repo.owner, pr.repo.name, pr.number, config.baseDomain),
      url: previewUrl(pr.repo.owner, pr.repo.name, pr.number, config.baseDomain),
      port,
      createdAt: reusable ? existing.createdAt : now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: reusable ? existing.expiresAt : null,
      commentId: reusable ? existing.commentId : null,
      dryRun: config.dryRun,
      lastError: null,
      destroyedReason: null,
    };
    store.upsert(record);
    logger.info(`deploying ${project} for ${pr.repo.fullName}#${pr.number} @ ${pr.headSha.slice(0, 7)}`);
    await this.syncComment(record);

    const workDir = this.workDirFor(project);
    try {
      await fetcher.fetchPullRequest({ cloneUrl: pr.repo.cloneUrl, prNumber: pr.number, dir: workDir });
      await docker.up({
        projectName: project,
        composeFile: config.composeFile,
        cwd: workDir,
        env: {
          GREENROOM_PORT: String(port),
          GREENROOM_BIND: config.previewBindHost,
          GREENROOM_PROJECT: project,
          GREENROOM_PR: String(pr.number),
          GREENROOM_SHA: pr.headSha,
        },
      });
      // The snippet is only written once the environment is up, and the
      // proxy is reloaded right after, so the preview URL either works or
      // does not exist at all.
      caddy.write(project, this.renderSnippet(record));
      await reloader.reload();
      const done = this.clock();
      record.status = 'running';
      record.updatedAt = done.toISOString();
      record.expiresAt = computeExpiresAt(done, config.ttlHours);
      store.upsert(record);
      logger.info(`environment ${project} running at ${record.url} (expires ${record.expiresAt})`);
    } catch (error) {
      // Never leave a snippet pointing at a dead backend: remove it and
      // reload the proxy on a best-effort basis.
      caddy.remove(project);
      try {
        await reloader.reload();
      } catch (reloadError) {
        logger.warn(`proxy reload after failed deploy of ${project}: ${(reloadError as Error).message}`);
      }
      record.status = 'failed';
      record.updatedAt = this.clock().toISOString();
      record.lastError = (error as Error).message;
      store.upsert(record);
      logger.error(`deploy of ${project} failed: ${record.lastError}`);
    }
    await this.syncComment(record);
    return record;
  }

  /** Tear down an environment and release every resource it holds. */
  async destroy(project: string, reason: DestroyReason): Promise<EnvironmentRecord | null> {
    const { config, store, docker, caddy, reloader, logger } = this.deps;
    const record = store.get(project);
    if (!record || record.status === 'destroyed') return record ?? null;

    logger.info(`destroying ${project} (${reason})`);
    const workDir = this.workDirFor(project);
    try {
      await docker.down({
        projectName: project,
        composeFile: config.composeFile,
        cwd: workDir,
        env: { GREENROOM_PORT: String(record.port), GREENROOM_BIND: config.previewBindHost },
      });
    } catch (error) {
      logger.warn(`compose down for ${project} failed (continuing teardown): ${(error as Error).message}`);
    }
    caddy.remove(project);
    try {
      await reloader.reload();
    } catch (error) {
      logger.warn(`proxy reload after teardown of ${project} failed: ${(error as Error).message}`);
    }
    rmSync(workDir, { recursive: true, force: true });

    record.status = 'destroyed';
    record.destroyedReason = reason;
    record.updatedAt = this.clock().toISOString();
    store.upsert(record);
    await this.syncComment(record);
    logger.info(`environment ${project} destroyed (${reason})`);
    return record;
  }

  /**
   * Rewrite Caddy snippets for all live environments. Called at startup so
   * a changed basic auth password or upstream host propagates everywhere.
   */
  rewriteSnippets(): number {
    let count = 0;
    for (const record of this.deps.store.active()) {
      if (record.status === 'running' || record.status === 'deploying') {
        this.deps.caddy.write(record.project, this.renderSnippet(record));
        count += 1;
      }
    }
    return count;
  }
}
