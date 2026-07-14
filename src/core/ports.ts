/** Host port allocation for preview environments. */

export class PortsExhaustedError extends Error {
  constructor(start: number, end: number) {
    super(
      `no free port in range ${start}-${end}; ` +
        `raise PORT_RANGE or lower TTL_HOURS so old environments are reaped sooner`,
    );
  }
}

/** Return the lowest port in [start, end] not present in `used`. */
export function allocatePort(used: ReadonlySet<number>, start: number, end: number): number {
  for (let port = start; port <= end; port += 1) {
    if (!used.has(port)) return port;
  }
  throw new PortsExhaustedError(start, end);
}
