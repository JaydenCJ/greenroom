/**
 * Proxy reload adapter. Caddy only reads the snippet import directory when
 * its configuration is (re)loaded, so greenroom runs a reload command after
 * every snippet change. In the bundled compose deployment the command is
 * `docker exec greenroom-caddy caddy reload ...` (the docker socket is
 * already mounted); with a host-managed Caddy it is typically
 * `caddy reload --config /etc/caddy/Caddyfile` or `systemctl reload caddy`.
 */
import { execFile } from 'node:child_process';
import type { Logger } from '../logger';
import type { ProxyReloader } from './types';

/** Runs the configured shell command; rejects when it exits non-zero. */
export class CommandProxyReloader implements ProxyReloader {
  constructor(
    private readonly command: string,
    private readonly logger: Logger,
  ) {}

  reload(): Promise<void> {
    this.logger.info(`reloading proxy: ${this.command}`);
    return new Promise((resolve, reject) => {
      execFile(
        'sh',
        ['-c', this.command],
        { maxBuffer: 4 * 1024 * 1024, timeout: 60 * 1000 },
        (error, _stdout, stderr) => {
          if (error) {
            reject(new Error(`proxy reload command failed: ${stderr.trim() || error.message}`));
          } else {
            resolve();
          }
        },
      );
    });
  }
}

/**
 * Used in dry-run mode and when CADDY_RELOAD_CMD is unset. Snippet files are
 * still written; the operator is responsible for reloading Caddy.
 */
export class NoopProxyReloader implements ProxyReloader {
  constructor(
    private readonly logger: Logger,
    private readonly reason: string,
  ) {}

  async reload(): Promise<void> {
    this.logger.debug(`proxy reload skipped (${this.reason})`);
  }
}
