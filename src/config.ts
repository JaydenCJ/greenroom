/**
 * Environment-based configuration. All settings come from process.env so the
 * same code path works for `npm start`, docker compose and tests.
 */

export class ConfigError extends Error {}

export interface Config {
  /** Address the HTTP server binds to. Defaults to loopback for safety. */
  host: string;
  /** Port the HTTP server listens on. */
  port: number;
  /** Shared secret used to verify X-Hub-Signature-256 webhook signatures. */
  webhookSecret: string;
  /** Base domain under which preview subdomains are created. */
  baseDomain: string;
  /** GitHub API token used for PR comments and PR state checks. Null disables both. */
  githubToken: string | null;
  /** GitHub REST API base URL (override for GitHub Enterprise). */
  githubApiUrl: string;
  /** Directory for greenroom state (environment records, basic auth hash). */
  dataDir: string;
  /** Directory where per-environment Caddy site snippets are written. */
  caddyDir: string;
  /** Directory where PR working copies are checked out. */
  workDir: string;
  /** Hours an environment lives after its last deploy before the reaper collects it. */
  ttlHours: number;
  /** Minutes between reaper scans. */
  reaperIntervalMinutes: number;
  /** Inclusive host port range allocated to preview environments. */
  portRangeStart: number;
  portRangeEnd: number;
  /** Basic auth user for preview subdomains. */
  basicAuthUser: string;
  /** Basic auth password; null means "generate one at first start". */
  basicAuthPassword: string | null;
  /** Host that Caddy uses to reach preview containers (reverse_proxy upstream). */
  proxyUpstreamHost: string;
  /**
   * Shell command run after every Caddy snippet change so Caddy picks it up
   * (e.g. "docker exec greenroom-caddy caddy reload --config /etc/caddy/Caddyfile").
   * Null disables the reload; the operator must reload Caddy manually.
   */
  caddyReloadCmd: string | null;
  /** Host address preview containers should publish their port on. */
  previewBindHost: string;
  /** Lowercased owner/repo allowlist; null allows any repo that passes signature checks. */
  allowedRepos: string[] | null;
  /** Compose file path, relative to the checked-out repository root. */
  composeFile: string;
  /** Dry-run mode: log git/docker commands instead of executing them. */
  dryRun: boolean;
}

function intFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

function parsePortRange(raw: string): { start: number; end: number } {
  const match = /^(\d+)-(\d+)$/.exec(raw.trim());
  if (!match) {
    throw new ConfigError(`PORT_RANGE must look like "20000-20100", got "${raw}"`);
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 1024 || end > 65535 || start > end) {
    throw new ConfigError(`PORT_RANGE must be within 1024-65535 and start <= end, got "${raw}"`);
  }
  return { start, end };
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const webhookSecret = env.GITHUB_WEBHOOK_SECRET ?? '';
  if (webhookSecret.length < 8) {
    throw new ConfigError(
      'GITHUB_WEBHOOK_SECRET is required (min 8 chars). Generate one with: openssl rand -hex 32',
    );
  }

  const baseDomain = (env.BASE_DOMAIN ?? '').trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(baseDomain)) {
    throw new ConfigError(
      `BASE_DOMAIN is required and must be a DNS name like "preview.example.com", got "${baseDomain}"`,
    );
  }

  const range = parsePortRange(env.PORT_RANGE ?? '20000-20100');

  const allowedRaw = (env.ALLOWED_REPOS ?? '').trim();
  const allowedRepos = allowedRaw
    ? allowedRaw
        .split(',')
        .map((r) => r.trim().toLowerCase())
        .filter((r) => r.length > 0)
    : null;
  if (allowedRepos) {
    for (const repo of allowedRepos) {
      if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
        throw new ConfigError(`ALLOWED_REPOS entries must be "owner/repo", got "${repo}"`);
      }
    }
  }

  const githubToken = (env.GITHUB_TOKEN ?? '').trim();

  return {
    host: env.GREENROOM_HOST ?? '127.0.0.1',
    port: intFromEnv(env, 'GREENROOM_PORT', 8811, 1, 65535),
    webhookSecret,
    baseDomain,
    githubToken: githubToken.length > 0 ? githubToken : null,
    githubApiUrl: (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, ''),
    dataDir: env.DATA_DIR ?? './data',
    caddyDir: env.CADDY_DIR ?? './caddy',
    workDir: env.WORK_DIR ?? './work',
    ttlHours: intFromEnv(env, 'TTL_HOURS', 72, 1, 24 * 365),
    reaperIntervalMinutes: intFromEnv(env, 'REAPER_INTERVAL_MINUTES', 10, 1, 24 * 60),
    portRangeStart: range.start,
    portRangeEnd: range.end,
    basicAuthUser: env.BASIC_AUTH_USER ?? 'preview',
    basicAuthPassword: env.BASIC_AUTH_PASSWORD ? env.BASIC_AUTH_PASSWORD : null,
    proxyUpstreamHost: env.PROXY_UPSTREAM_HOST ?? '127.0.0.1',
    caddyReloadCmd: (env.CADDY_RELOAD_CMD ?? '').trim() || null,
    previewBindHost: env.PREVIEW_BIND_HOST ?? '127.0.0.1',
    allowedRepos,
    composeFile: env.COMPOSE_FILE ?? 'docker-compose.yml',
    dryRun: env.GREENROOM_DRY_RUN === '1' || env.GREENROOM_DRY_RUN === 'true',
  };
}
