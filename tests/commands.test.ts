import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { composeDownArgs, composeUpArgs } from '../src/adapters/docker-cli';
import { checkoutFetchHeadArgs, cloneArgs, fetchPrArgs } from '../src/adapters/git-cli';

describe('docker compose command construction', () => {
  it('builds the exact up command for a PR project', () => {
    assert.deepEqual(composeUpArgs('gr-acme-demo-app-42', 'docker-compose.yml'), [
      'compose',
      '-p',
      'gr-acme-demo-app-42',
      '-f',
      'docker-compose.yml',
      'up',
      '-d',
      '--build',
      '--remove-orphans',
    ]);
  });

  it('builds the exact down command including volume removal', () => {
    assert.deepEqual(composeDownArgs('gr-acme-demo-app-42', 'docker-compose.yml'), [
      'compose',
      '-p',
      'gr-acme-demo-app-42',
      '-f',
      'docker-compose.yml',
      'down',
      '-v',
      '--remove-orphans',
    ]);
  });

  it('passes a custom compose file through unchanged', () => {
    const args = composeUpArgs('gr-x-1', 'compose.preview.yaml');
    assert.ok(args.includes('compose.preview.yaml'));
  });
});

describe('git command construction', () => {
  it('builds a shallow clone command', () => {
    assert.deepEqual(cloneArgs('https://github.com/acme/demo-app.git', '/work/gr-acme-demo-app-42'), [
      'clone',
      '--depth',
      '50',
      'https://github.com/acme/demo-app.git',
      '/work/gr-acme-demo-app-42',
    ]);
  });

  it('fetches the pull/<n>/head ref GitHub exposes for every PR', () => {
    assert.deepEqual(fetchPrArgs(42), ['fetch', '--depth', '50', 'origin', 'pull/42/head']);
  });

  it('checks out FETCH_HEAD detached', () => {
    assert.deepEqual(checkoutFetchHeadArgs(), ['checkout', '--force', '--detach', 'FETCH_HEAD']);
  });
});
