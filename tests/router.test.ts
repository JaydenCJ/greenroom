import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { routeEvent } from '../src/webhook/router';
import { loadFixture } from './helpers';

describe('webhook event routing', () => {
  it('routes pull_request opened to a deploy with full PR info', () => {
    const routed = routeEvent('pull_request', loadFixture('pull_request.opened.json'));
    assert.equal(routed.kind, 'deploy');
    if (routed.kind !== 'deploy') return;
    assert.equal(routed.action, 'opened');
    assert.equal(routed.pr.number, 42);
    assert.equal(routed.pr.headSha, 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678');
    assert.equal(routed.pr.headRef, 'feature/checkout');
    assert.equal(routed.pr.repo.owner, 'acme');
    assert.equal(routed.pr.repo.name, 'demo-app');
    assert.equal(routed.pr.repo.fullName, 'acme/demo-app');
    assert.equal(routed.pr.repo.cloneUrl, 'https://github.com/acme/demo-app.git');
    assert.equal(routed.pr.title, 'Add checkout flow');
  });

  it('routes pull_request synchronize to a deploy with the new head sha', () => {
    const routed = routeEvent('pull_request', loadFixture('pull_request.synchronize.json'));
    assert.equal(routed.kind, 'deploy');
    if (routed.kind !== 'deploy') return;
    assert.equal(routed.action, 'synchronize');
    assert.equal(routed.pr.headSha, 'b2c3d4e5f60718293a4b5c6d7e8f90123456789a');
  });

  it('routes pull_request closed (merged) to a destroy with merged=true', () => {
    const routed = routeEvent('pull_request', loadFixture('pull_request.closed_merged.json'));
    assert.equal(routed.kind, 'destroy');
    if (routed.kind !== 'destroy') return;
    assert.equal(routed.merged, true);
    assert.equal(routed.pr.number, 42);
  });

  it('routes pull_request closed (unmerged) to a destroy with merged=false', () => {
    const routed = routeEvent('pull_request', loadFixture('pull_request.closed_unmerged.json'));
    assert.equal(routed.kind, 'destroy');
    if (routed.kind !== 'destroy') return;
    assert.equal(routed.merged, false);
    assert.equal(routed.pr.number, 43);
  });

  it('routes ping events to ping', () => {
    const routed = routeEvent('ping', loadFixture('ping.json'));
    assert.equal(routed.kind, 'ping');
  });

  it('ignores events other than pull_request', () => {
    const routed = routeEvent('issue_comment', { action: 'created' });
    assert.equal(routed.kind, 'ignored');
  });

  it('ignores pull_request actions greenroom does not handle', () => {
    const payload = loadFixture('pull_request.opened.json') as Record<string, unknown>;
    const routed = routeEvent('pull_request', { ...payload, action: 'labeled' });
    assert.equal(routed.kind, 'ignored');
  });

  it('flags a pull_request payload without an action as invalid', () => {
    const routed = routeEvent('pull_request', { pull_request: {} });
    assert.equal(routed.kind, 'invalid');
  });

  it('flags a pull_request payload with missing fields as invalid', () => {
    const routed = routeEvent('pull_request', {
      action: 'opened',
      pull_request: { number: 7 },
      repository: { name: 'x' },
    });
    assert.equal(routed.kind, 'invalid');
  });

  it('flags a non-object payload as invalid', () => {
    const routed = routeEvent('pull_request', 'not-json-object');
    assert.equal(routed.kind, 'invalid');
  });
});
