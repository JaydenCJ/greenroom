/**
 * Minimal structured logger. Writes single-line, timestamped entries to the
 * given stream (stdout by default). Greenroom never logs secrets: webhook
 * secrets, tokens and generated passwords are only printed where explicitly
 * documented (the one-time generated basic auth password at first start).
 */

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

function line(level: string, msg: string): string {
  return `${new Date().toISOString()} ${level.padEnd(5)} ${msg}\n`;
}

export function createLogger(stream: NodeJS.WritableStream = process.stdout): Logger {
  return {
    debug(msg: string) {
      if (process.env.GREENROOM_DEBUG === '1') stream.write(line('DEBUG', msg));
    },
    info(msg: string) {
      stream.write(line('INFO', msg));
    },
    warn(msg: string) {
      stream.write(line('WARN', msg));
    },
    error(msg: string) {
      stream.write(line('ERROR', msg));
    },
  };
}

/** No-op logger for tests. */
export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
