/**
 * TTL reaper. Periodically scans the store and tears down environments that
 * are past their TTL, plus environments whose PR was merged or closed while
 * greenroom missed the webhook (downtime, redelivery failure). Destroy jobs
 * go through the same serial queue as webhook-triggered work.
 */
import type { GithubClient } from './adapters/types';
import type { Logger } from './logger';
import type { DestroyReason } from './core/orchestrator';
import type { EnvironmentStore } from './core/store';
import { isExpired } from './core/ttl';

export interface ReaperDeps {
  store: EnvironmentStore;
  github: GithubClient;
  logger: Logger;
  /** Enqueue a destroy; resolves when the teardown has completed. */
  destroy: (project: string, reason: DestroyReason) => Promise<void>;
  clock?: () => Date;
}

export class Reaper {
  private readonly clock: () => Date;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: ReaperDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  /** One scan over all live environments. Returns the number reaped. */
  async runOnce(): Promise<number> {
    const now = this.clock();
    let reaped = 0;
    for (const record of this.deps.store.active()) {
      if (isExpired(record.expiresAt, now)) {
        this.deps.logger.info(`reaper: ${record.project} exceeded its TTL`);
        await this.deps.destroy(record.project, 'expired');
        reaped += 1;
        continue;
      }
      const pull = await this.deps.github.getPullState(record.repoFullName, record.prNumber);
      if (pull.state === 'closed') {
        const reason: DestroyReason = pull.merged ? 'merged' : 'closed';
        this.deps.logger.info(`reaper: PR ${record.repoFullName}#${record.prNumber} is ${reason}`);
        await this.deps.destroy(record.project, reason);
        reaped += 1;
      }
    }
    return reaped;
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        this.deps.logger.error(`reaper scan failed: ${(error as Error).message}`);
      });
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
