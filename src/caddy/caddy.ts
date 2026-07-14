/**
 * Caddy integration: renders one site snippet per preview environment and
 * manages the snippet files in the directory that the main Caddyfile
 * imports (see deploy/Caddyfile: `import /etc/caddy/greenroom/*.caddy`).
 *
 * Each snippet opens a site block for the preview subdomain, protects it
 * with basic auth (bcrypt hash, never the plaintext password) and reverse
 * proxies to the compose project's published port. Snippets are plain files
 * so an operator can always inspect exactly what the proxy is serving.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CaddySnippetOptions {
  /** Fully qualified preview host, e.g. `42-acme-app.preview.example.com`. */
  subdomain: string;
  /**
   * Host Caddy should proxy to. `127.0.0.1` when everything shares a network
   * namespace (host networking), `host.docker.internal` for compose setups
   * where Caddy runs in its own container.
   */
  upstreamHost: string;
  /** Published host port of the preview environment. */
  port: number;
  /** Basic auth user name shown to reviewers. */
  basicAuthUser: string;
  /** bcrypt hash of the basic auth password (Caddy consumes the hash). */
  basicAuthHash: string;
}

/** Render the Caddy site block for one preview environment. */
export function renderCaddySnippet(options: CaddySnippetOptions): string {
  const { subdomain, upstreamHost, port, basicAuthUser, basicAuthHash } = options;
  return [
    `# Managed by greenroom. Do not edit: this file is rewritten on every`,
    `# deploy and deleted when the preview environment is destroyed.`,
    `${subdomain} {`,
    `\tbasic_auth {`,
    `\t\t${basicAuthUser} ${basicAuthHash}`,
    `\t}`,
    `\treverse_proxy ${upstreamHost}:${port}`,
    `}`,
    ``,
  ].join('\n');
}

/** File name of the snippet for a compose project, e.g. `gr-acme-app-42.caddy`. */
export function snippetFileName(project: string): string {
  return `${project}.caddy`;
}

/**
 * Owns the snippet directory: writes one `<project>.caddy` file per live
 * environment and removes it on teardown. Idempotent in both directions so
 * crash-recovery replays are safe.
 */
export class CaddyWriter {
  constructor(private readonly dir: string) {}

  /** Write (or overwrite) the snippet for a project; returns the file path. */
  write(project: string, snippet: string): string {
    mkdirSync(this.dir, { recursive: true });
    const filePath = join(this.dir, snippetFileName(project));
    writeFileSync(filePath, snippet, 'utf8');
    return filePath;
  }

  /** Remove the snippet for a project. Missing files are not an error. */
  remove(project: string): void {
    const filePath = join(this.dir, snippetFileName(project));
    if (existsSync(filePath)) {
      rmSync(filePath, { force: true });
    }
  }
}
