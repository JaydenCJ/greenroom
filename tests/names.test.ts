import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  composeProjectName,
  previewSubdomain,
  previewUrl,
  sanitizeSlug,
  subdomainLabel,
} from '../src/core/names';

describe('name sanitization', () => {
  it('lowercases and keeps alphanumerics and hyphens', () => {
    assert.equal(sanitizeSlug('Demo-App'), 'demo-app');
  });

  it('collapses runs of invalid characters into one hyphen', () => {
    assert.equal(sanitizeSlug('My_Repo.js'), 'my-repo-js');
    assert.equal(sanitizeSlug('a__b..c  d'), 'a-b-c-d');
  });

  it('trims leading and trailing hyphens', () => {
    assert.equal(sanitizeSlug('.hidden-repo-'), 'hidden-repo');
  });

  it('truncates to the requested length without a dangling hyphen', () => {
    assert.equal(sanitizeSlug('abc-def', 4), 'abc');
  });

  it('falls back to "repo" when nothing survives', () => {
    assert.equal(sanitizeSlug('...'), 'repo');
  });
});

describe('compose project names', () => {
  it('builds gr-<owner>-<repo>-<pr>', () => {
    assert.equal(composeProjectName('acme', 'demo-app', 42), 'gr-acme-demo-app-42');
  });

  it('sanitizes owner and repo names with uppercase and dots', () => {
    assert.equal(composeProjectName('ChenCorp', 'Web.Portal_v2', 7), 'gr-chencorp-web-portal-v2-7');
  });

  it('is a valid compose project name (lowercase, [a-z0-9_-])', () => {
    const name = composeProjectName('Some Owner!!', 'Some Repo!!', 123);
    assert.match(name, /^[a-z0-9][a-z0-9_-]*$/);
  });

  it('keeps same-named repos under different owners apart', () => {
    const a = composeProjectName('chencorp', 'Shop.Backend_API', 7);
    const b = composeProjectName('evilcorp', 'Shop.Backend_API', 7);
    assert.equal(a, 'gr-chencorp-shop-backend-api-7');
    assert.equal(b, 'gr-evilcorp-shop-backend-api-7');
    assert.notEqual(a, b);
  });
});

describe('preview subdomains', () => {
  it('builds <pr>-<owner>-<repo>.<baseDomain>', () => {
    assert.equal(
      previewSubdomain('acme', 'demo-app', 42, 'preview.example.com'),
      '42-acme-demo-app.preview.example.com',
    );
  });

  it('keeps the leftmost label within the 63 char DNS limit', () => {
    const label = subdomainLabel('o'.repeat(50), 'a'.repeat(100), 123456);
    assert.ok(label.length <= 63, `label too long: ${label.length}`);
    assert.match(label, /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
  });

  it('gives same-named repos under different owners distinct subdomains', () => {
    const a = subdomainLabel('chencorp', 'Shop.Backend_API', 7);
    const b = subdomainLabel('evilcorp', 'Shop.Backend_API', 7);
    assert.equal(a, '7-chencorp-shop-backend-api');
    assert.notEqual(a, b);
  });

  it('builds an https URL', () => {
    assert.equal(
      previewUrl('acme', 'demo-app', 42, 'preview.example.com'),
      'https://42-acme-demo-app.preview.example.com',
    );
  });
});
