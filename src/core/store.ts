/**
 * Environment state store. Records are kept in memory and persisted to a
 * single JSON file with atomic writes (write temp file, then rename), so a
 * crash never leaves a half-written state file.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type EnvironmentStatus = 'deploying' | 'running' | 'failed' | 'destroyed';

export interface EnvironmentRecord {
  /** Compose project name, e.g. "gr-acme-demo-app-42". Primary key. */
  project: string;
  repoFullName: string;
  repoName: string;
  cloneUrl: string;
  prNumber: number;
  headSha: string;
  headRef: string;
  status: EnvironmentStatus;
  subdomain: string;
  url: string;
  /** Host port allocated to this environment. */
  port: number;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp after which the reaper collects the environment. */
  expiresAt: string | null;
  /** GitHub comment id of the bot comment on the PR, if one was created. */
  commentId: number | null;
  dryRun: boolean;
  lastError: string | null;
  destroyedReason: string | null;
}

interface StoreFile {
  version: 1;
  environments: EnvironmentRecord[];
}

export class EnvironmentStore {
  private records = new Map<string, EnvironmentRecord>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as StoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.environments)) {
      throw new Error(`unsupported state file format in ${this.filePath}`);
    }
    for (const record of parsed.environments) {
      this.records.set(record.project, record);
    }
  }

  private persist(): void {
    const payload: StoreFile = { version: 1, environments: this.list() };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = join(dirname(this.filePath), `.${Date.now()}-${process.pid}.tmp`);
    writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    renameSync(tempPath, this.filePath);
  }

  get(project: string): EnvironmentRecord | undefined {
    return this.records.get(project);
  }

  list(): EnvironmentRecord[] {
    return [...this.records.values()].sort((a, b) => a.project.localeCompare(b.project));
  }

  /** Environments that still hold resources (a port, containers, a Caddy site). */
  active(): EnvironmentRecord[] {
    return this.list().filter((r) => r.status !== 'destroyed');
  }

  usedPorts(): Set<number> {
    return new Set(this.active().map((r) => r.port));
  }

  upsert(record: EnvironmentRecord): void {
    this.records.set(record.project, record);
    this.persist();
  }

  remove(project: string): void {
    if (this.records.delete(project)) this.persist();
  }
}
