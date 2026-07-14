import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { signPayload, verifySignature } from '../src/webhook/verify';
import { loadFixtureRaw } from './helpers';

const SECRET = 'test-webhook-secret';

describe('webhook signature verification', () => {
  it('accepts a payload signed with the correct secret', () => {
    const payload = loadFixtureRaw('pull_request.opened.json');
    const header = signPayload(SECRET, payload);
    assert.equal(verifySignature(SECRET, payload, header), true);
  });

  it('produces the sha256= prefixed hex format GitHub documents', () => {
    const header = signPayload('mysecret', 'hello');
    assert.match(header, /^sha256=[0-9a-f]{64}$/);
  });

  it('matches the known HMAC test vector from the GitHub docs', () => {
    // Example from the GitHub webhook validation docs:
    // secret "It's a Secret to Everybody", payload "Hello, World!"
    const header = signPayload("It's a Secret to Everybody", 'Hello, World!');
    assert.equal(
      header,
      'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
    );
  });

  it('rejects a tampered payload', () => {
    const payload = loadFixtureRaw('pull_request.opened.json');
    const header = signPayload(SECRET, payload);
    const tampered = Buffer.from(payload.toString('utf8').replace('"number": 42', '"number": 99'));
    assert.equal(verifySignature(SECRET, tampered, header), false);
  });

  it('rejects a signature made with a different secret', () => {
    const payload = loadFixtureRaw('pull_request.opened.json');
    const header = signPayload('some-other-secret', payload);
    assert.equal(verifySignature(SECRET, payload, header), false);
  });

  it('rejects a missing header', () => {
    assert.equal(verifySignature(SECRET, 'body', undefined), false);
  });

  it('rejects an empty header', () => {
    assert.equal(verifySignature(SECRET, 'body', ''), false);
  });

  it('rejects a sha1 header (GitHub legacy algorithm)', () => {
    assert.equal(verifySignature(SECRET, 'body', 'sha1=deadbeef'), false);
  });

  it('rejects a truncated signature of the right prefix', () => {
    const payload = Buffer.from('body');
    const header = signPayload(SECRET, payload).slice(0, 20);
    assert.equal(verifySignature(SECRET, payload, header), false);
  });

  it('rejects garbage that is not hex', () => {
    const header = `sha256=${'z'.repeat(64)}`;
    assert.equal(verifySignature(SECRET, 'body', header), false);
  });
});
