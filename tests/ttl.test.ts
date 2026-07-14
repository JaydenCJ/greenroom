import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { computeExpiresAt, isExpired } from '../src/core/ttl';

describe('TTL computation', () => {
  it('adds the TTL in hours to the deploy time', () => {
    const now = new Date('2026-07-08T10:00:00.000Z');
    assert.equal(computeExpiresAt(now, 72), '2026-07-11T10:00:00.000Z');
  });

  it('supports a one hour TTL', () => {
    const now = new Date('2026-07-08T23:30:00.000Z');
    assert.equal(computeExpiresAt(now, 1), '2026-07-09T00:30:00.000Z');
  });
});

describe('expiry checks', () => {
  const expiresAt = '2026-07-11T10:00:00.000Z';

  it('is not expired before the deadline', () => {
    assert.equal(isExpired(expiresAt, new Date('2026-07-11T09:59:59.999Z')), false);
  });

  it('is not expired exactly at the deadline', () => {
    assert.equal(isExpired(expiresAt, new Date('2026-07-11T10:00:00.000Z')), false);
  });

  it('is expired one millisecond after the deadline', () => {
    assert.equal(isExpired(expiresAt, new Date('2026-07-11T10:00:00.001Z')), true);
  });

  it('never expires when no expiry is set (still deploying)', () => {
    assert.equal(isExpired(null, new Date('2030-01-01T00:00:00.000Z')), false);
  });

  it('never expires on an unparseable timestamp', () => {
    assert.equal(isExpired('not-a-date', new Date()), false);
  });
});
