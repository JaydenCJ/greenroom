import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ConfigError, loadConfig } from '../src/config';

const BASE_ENV = {
  GITHUB_WEBHOOK_SECRET: 'a-long-webhook-secret',
  BASE_DOMAIN: 'preview.example.com',
};

describe('configuration loading', () => {
  it('applies safe defaults', () => {
    const config = loadConfig({ ...BASE_ENV });
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 8811);
    assert.equal(config.ttlHours, 72);
    assert.equal(config.portRangeStart, 20000);
    assert.equal(config.portRangeEnd, 20100);
    assert.equal(config.basicAuthUser, 'preview');
    assert.equal(config.basicAuthPassword, null);
    assert.equal(config.githubToken, null);
    assert.equal(config.allowedRepos, null);
    assert.equal(config.dryRun, false);
  });

  it('requires GITHUB_WEBHOOK_SECRET', () => {
    assert.throws(() => loadConfig({ BASE_DOMAIN: 'preview.example.com' }), ConfigError);
  });

  it('rejects a too-short webhook secret', () => {
    assert.throws(
      () => loadConfig({ GITHUB_WEBHOOK_SECRET: 'short', BASE_DOMAIN: 'preview.example.com' }),
      ConfigError,
    );
  });

  it('requires a valid BASE_DOMAIN', () => {
    assert.throws(() => loadConfig({ GITHUB_WEBHOOK_SECRET: 'a-long-webhook-secret' }), ConfigError);
    assert.throws(
      () => loadConfig({ GITHUB_WEBHOOK_SECRET: 'a-long-webhook-secret', BASE_DOMAIN: 'not a domain' }),
      ConfigError,
    );
  });

  it('lowercases BASE_DOMAIN', () => {
    const config = loadConfig({ ...BASE_ENV, BASE_DOMAIN: 'Preview.Example.COM' });
    assert.equal(config.baseDomain, 'preview.example.com');
  });

  it('parses PORT_RANGE', () => {
    const config = loadConfig({ ...BASE_ENV, PORT_RANGE: '30000-30010' });
    assert.equal(config.portRangeStart, 30000);
    assert.equal(config.portRangeEnd, 30010);
  });

  it('rejects malformed or inverted PORT_RANGE', () => {
    assert.throws(() => loadConfig({ ...BASE_ENV, PORT_RANGE: 'abc' }), ConfigError);
    assert.throws(() => loadConfig({ ...BASE_ENV, PORT_RANGE: '30010-30000' }), ConfigError);
    assert.throws(() => loadConfig({ ...BASE_ENV, PORT_RANGE: '100-200' }), ConfigError);
  });

  it('parses and normalizes ALLOWED_REPOS', () => {
    const config = loadConfig({ ...BASE_ENV, ALLOWED_REPOS: 'Acme/Demo-App, acme/api ' });
    assert.deepEqual(config.allowedRepos, ['acme/demo-app', 'acme/api']);
  });

  it('rejects ALLOWED_REPOS entries that are not owner/repo', () => {
    assert.throws(() => loadConfig({ ...BASE_ENV, ALLOWED_REPOS: 'just-a-name' }), ConfigError);
  });

  it('rejects out-of-range TTL_HOURS', () => {
    assert.throws(() => loadConfig({ ...BASE_ENV, TTL_HOURS: '0' }), ConfigError);
    assert.throws(() => loadConfig({ ...BASE_ENV, TTL_HOURS: 'many' }), ConfigError);
  });

  it('enables dry-run via GREENROOM_DRY_RUN', () => {
    assert.equal(loadConfig({ ...BASE_ENV, GREENROOM_DRY_RUN: '1' }).dryRun, true);
    assert.equal(loadConfig({ ...BASE_ENV, GREENROOM_DRY_RUN: 'true' }).dryRun, true);
    assert.equal(loadConfig({ ...BASE_ENV, GREENROOM_DRY_RUN: '0' }).dryRun, false);
  });

  it('treats an empty GITHUB_TOKEN as absent', () => {
    assert.equal(loadConfig({ ...BASE_ENV, GITHUB_TOKEN: '  ' }).githubToken, null);
  });

  it('treats an empty CADDY_RELOAD_CMD as disabled and keeps a configured one', () => {
    assert.equal(loadConfig({ ...BASE_ENV }).caddyReloadCmd, null);
    assert.equal(loadConfig({ ...BASE_ENV, CADDY_RELOAD_CMD: '  ' }).caddyReloadCmd, null);
    assert.equal(
      loadConfig({ ...BASE_ENV, CADDY_RELOAD_CMD: 'systemctl reload caddy' }).caddyReloadCmd,
      'systemctl reload caddy',
    );
  });
});
