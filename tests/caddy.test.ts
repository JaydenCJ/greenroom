import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CaddyWriter, renderCaddySnippet, snippetFileName } from '../src/caddy/caddy';
import { tempDir } from './helpers';

const OPTIONS = {
  subdomain: '42-acme-demo-app.preview.example.com',
  upstreamHost: '127.0.0.1',
  port: 20000,
  basicAuthUser: 'preview',
  basicAuthHash: '$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUV0123456789',
};

describe('Caddy snippet rendering', () => {
  it('opens a site block for the preview subdomain', () => {
    const snippet = renderCaddySnippet(OPTIONS);
    assert.ok(snippet.includes('42-acme-demo-app.preview.example.com {'));
    assert.ok(snippet.trimEnd().endsWith('}'));
  });

  it('protects the site with basic_auth using the bcrypt hash', () => {
    const snippet = renderCaddySnippet(OPTIONS);
    assert.ok(snippet.includes('basic_auth {'));
    assert.ok(snippet.includes(`preview ${OPTIONS.basicAuthHash}`));
  });

  it('reverse proxies to the upstream host and allocated port', () => {
    const snippet = renderCaddySnippet(OPTIONS);
    assert.ok(snippet.includes('reverse_proxy 127.0.0.1:20000'));
  });

  it('uses the configured upstream host for compose deployments', () => {
    const snippet = renderCaddySnippet({ ...OPTIONS, upstreamHost: 'host.docker.internal' });
    assert.ok(snippet.includes('reverse_proxy host.docker.internal:20000'));
  });

  it('names snippet files <project>.caddy', () => {
    assert.equal(snippetFileName('gr-acme-demo-app-42'), 'gr-acme-demo-app-42.caddy');
  });
});

describe('CaddyWriter', () => {
  it('writes and removes snippet files', () => {
    const dir = tempDir('caddy');
    const writer = new CaddyWriter(join(dir, 'sites'));
    const filePath = writer.write('gr-acme-demo-app-42', renderCaddySnippet(OPTIONS));
    assert.ok(existsSync(filePath));
    assert.ok(readFileSync(filePath, 'utf8').includes('reverse_proxy 127.0.0.1:20000'));

    writer.remove('gr-acme-demo-app-42');
    assert.ok(!existsSync(filePath));
  });

  it('remove is idempotent for missing files', () => {
    const writer = new CaddyWriter(join(tempDir('caddy'), 'sites'));
    writer.remove('gr-never-existed-1');
  });
});
