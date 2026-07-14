/**
 * Serial job queue. Webhook handlers respond immediately (GitHub expects a
 * response within 10 seconds) while deploys and teardowns run one at a time
 * in the background, so two events for the same PR can never race.
 */
import type { Logger } from './logger';

export class JobQueue {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly logger: Logger) {}

  /**
   * Enqueue a job. The returned promise resolves when this job has finished
   * (errors are logged, never re-thrown into callers).
   */
  push(name: string, job: () => Promise<void>): Promise<void> {
    const run = this.tail.then(async () => {
      try {
        await job();
      } catch (error) {
        this.logger.error(`job "${name}" failed: ${(error as Error).message}`);
      }
    });
    this.tail = run;
    return run;
  }

  /** Resolves once every job enqueued so far has finished. */
  onIdle(): Promise<void> {
    return this.tail;
  }
}
