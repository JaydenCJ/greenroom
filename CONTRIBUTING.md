# Contributing to Greenroom

Thanks for your interest in improving Greenroom. This document covers the
development setup and the conventions used in this repository.

## Development setup

Requirements: Node.js >= 20 (developed and tested on Node 22). Docker is optional —
the entire test suite and the smoke script run without a Docker daemon.

```bash
git clone https://github.com/JaydenCJ/greenroom.git
cd greenroom
npm ci
npm run build
npm test
```

Run the server locally in dry-run mode (no side effects, commands are logged
instead of executed):

```bash
GREENROOM_DRY_RUN=1 GITHUB_WEBHOOK_SECRET=demo-secret BASE_DOMAIN=preview.example.com npm start
bash scripts/send-sample-webhook.sh   # in a second terminal
```

## Tests

- `npm test` compiles the project and runs the full suite with the built-in
  `node:test` runner.
- `bash scripts/smoke.sh` drives the whole PR lifecycle end to end against a
  real server process on 127.0.0.1 and validates `docker-compose.yml`.
- Tests never touch the network, the GitHub API or a Docker daemon. All side
  effects go through the interfaces in `src/adapters/types.ts` — use the
  mocks in `tests/helpers.ts` and the fixtures in `tests/fixtures/`.

## Pull request guidelines

- Keep changes focused; one topic per PR.
- Every behavior change needs a test that fails without the change.
- Code comments and test descriptions are written in English.
- Run `npm test` and `bash scripts/smoke.sh` before opening the PR.
- If you change webhook handling, update or add a fixture under
  `tests/fixtures/` that reflects the real GitHub payload shape.

## Reporting issues

Include the greenroom version (`GET /health`), your deployment mode
(compose or bare process), and relevant log lines. Never paste your webhook
secret, tokens or generated passwords into an issue.
