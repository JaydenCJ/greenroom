/**
 * Entrypoint: load config, wire adapters, start the webhook server and the
 * TTL reaper. Selects real adapters (docker/git CLI, GitHub REST) or dry-run
 * adapters depending on GREENROOM_DRY_RUN.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, ConfigError } from './config';
import { createLogger } from './logger';
import { ensureBasicAuth } from './auth';
import { CaddyWriter } from './caddy/caddy';
import { EnvironmentStore } from './core/store';
import { Orchestrator } from './core/orchestrator';
import { DockerCliRunner, DryRunDockerRunner } from './adapters/docker-cli';
import { GitCliFetcher, DryRunRepoFetcher } from './adapters/git-cli';
import { GithubHttpClient, NullGithubClient } from './adapters/github-http';
import { CommandProxyReloader, NoopProxyReloader } from './adapters/proxy-reload';
import type { ProxyReloader } from './adapters/types';
import { JobQueue } from './queue';
import { Reaper } from './reaper';
import { createServer } from './server';
import { VERSION } from './version';

function main(): void {
  const logger = createLogger();

  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`configuration error: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  logger.info(`greenroom v${VERSION} starting`);
  if (config.dryRun) {
    logger.info('mode: dry-run (git and docker commands are logged, not executed)');
  }

  for (const dir of [config.dataDir, config.caddyDir, config.workDir]) {
    mkdirSync(dir, { recursive: true });
  }

  const auth = ensureBasicAuth(config.dataDir, config.basicAuthUser, config.basicAuthPassword);
  if (auth.generatedPassword) {
    logger.info(
      `generated basic auth credentials for preview URLs: user "${auth.user}" password "${auth.generatedPassword}" ` +
        '(shown once; set BASIC_AUTH_PASSWORD to choose your own)',
    );
  }

  const store = new EnvironmentStore(join(config.dataDir, 'environments.json'));
  const caddy = new CaddyWriter(config.caddyDir);
  const docker = config.dryRun ? new DryRunDockerRunner(logger) : new DockerCliRunner(logger);
  const fetcher = config.dryRun ? new DryRunRepoFetcher(logger) : new GitCliFetcher(logger);
  // Dry-run means zero side effects: GitHub API calls are disabled as well.
  const github =
    config.githubToken && !config.dryRun
      ? new GithubHttpClient(config.githubToken, config.githubApiUrl, logger)
      : new NullGithubClient(logger);
  if (config.dryRun && config.githubToken) {
    logger.info('dry-run: GITHUB_TOKEN is ignored, no GitHub API calls will be made');
  } else if (!config.githubToken) {
    logger.warn('GITHUB_TOKEN is not set: PR comments and closed-PR detection are disabled');
  }

  let reloader: ProxyReloader;
  if (config.dryRun) {
    reloader = new NoopProxyReloader(logger, 'dry-run');
  } else if (config.caddyReloadCmd) {
    reloader = new CommandProxyReloader(config.caddyReloadCmd, logger);
  } else {
    reloader = new NoopProxyReloader(logger, 'CADDY_RELOAD_CMD is not set');
    logger.warn(
      'CADDY_RELOAD_CMD is not set: Caddy will not pick up new or removed preview sites until you reload it yourself',
    );
  }

  const orchestrator = new Orchestrator({
    config,
    store,
    docker,
    fetcher,
    github,
    caddy,
    reloader,
    logger,
    basicAuthHash: auth.hash,
  });

  const refreshed = orchestrator.rewriteSnippets();
  if (refreshed > 0) {
    logger.info(`refreshed ${refreshed} Caddy site snippet(s)`);
    reloader.reload().catch((error: Error) => {
      logger.warn(`proxy reload after snippet refresh failed: ${error.message}`);
    });
  }

  const queue = new JobQueue(logger);
  const reaper = new Reaper({
    store,
    github,
    logger,
    destroy: (project, reason) => queue.push(`reap ${project}`, () => orchestrator.destroy(project, reason).then(() => undefined)),
  });
  reaper.start(config.reaperIntervalMinutes * 60 * 1000);

  const server = createServer({ config, store, queue, orchestrator, logger });
  server.listen(config.port, config.host, () => {
    logger.info(`listening on http://${config.host}:${config.port}`);
    logger.info('webhook endpoint: POST /webhook');
    if (config.host !== '127.0.0.1' && config.host !== 'localhost' && config.host !== '::1') {
      logger.warn(
        `binding to ${config.host}: make sure the port is only reachable through your reverse proxy or firewall`,
      );
    }
  });

  const shutdown = (signal: string) => {
    logger.info(`received ${signal}, shutting down`);
    reaper.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
