/**
 * Docker adapter. `DockerCliRunner` shells out to the local `docker` CLI;
 * `DryRunDockerRunner` logs the exact commands instead of executing them
 * (used by GREENROOM_DRY_RUN=1 and by the smoke script).
 */
import { execFile } from 'node:child_process';
import type { Logger } from '../logger';
import type { ComposeOptions, DockerRunner } from './types';

/** Argument vector for `docker compose ... up`. Pure and unit-tested. */
export function composeUpArgs(projectName: string, composeFile: string): string[] {
  return [
    'compose',
    '-p',
    projectName,
    '-f',
    composeFile,
    'up',
    '-d',
    '--build',
    '--remove-orphans',
  ];
}

/** Argument vector for `docker compose ... down`. Pure and unit-tested. */
export function composeDownArgs(projectName: string, composeFile: string): string[] {
  return ['compose', '-p', projectName, '-f', composeFile, 'down', '-v', '--remove-orphans'];
}

function runDocker(args: string[], cwd: string, env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'docker',
      args,
      {
        cwd,
        env: { ...process.env, ...env },
        maxBuffer: 16 * 1024 * 1024,
        timeout: 15 * 60 * 1000,
      },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`docker ${args.join(' ')} failed: ${stderr.trim() || error.message}`));
        } else {
          resolve();
        }
      },
    );
  });
}

export class DockerCliRunner implements DockerRunner {
  constructor(private readonly logger: Logger) {}

  async up(options: ComposeOptions): Promise<void> {
    const args = composeUpArgs(options.projectName, options.composeFile);
    this.logger.info(`docker ${args.join(' ')} (cwd=${options.cwd})`);
    await runDocker(args, options.cwd, options.env);
  }

  async down(options: ComposeOptions): Promise<void> {
    const args = composeDownArgs(options.projectName, options.composeFile);
    this.logger.info(`docker ${args.join(' ')} (cwd=${options.cwd})`);
    await runDocker(args, options.cwd, options.env);
  }
}

export class DryRunDockerRunner implements DockerRunner {
  /** Commands that would have been executed, for assertions and logs. */
  readonly commands: string[] = [];

  constructor(private readonly logger: Logger) {}

  async up(options: ComposeOptions): Promise<void> {
    const command = `docker ${composeUpArgs(options.projectName, options.composeFile).join(' ')}`;
    this.commands.push(command);
    this.logger.info(`[dry-run] ${command} (cwd=${options.cwd}, GREENROOM_PORT=${options.env.GREENROOM_PORT ?? ''})`);
  }

  async down(options: ComposeOptions): Promise<void> {
    const command = `docker ${composeDownArgs(options.projectName, options.composeFile).join(' ')}`;
    this.commands.push(command);
    this.logger.info(`[dry-run] ${command} (cwd=${options.cwd})`);
  }
}
