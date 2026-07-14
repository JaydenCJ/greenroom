# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-08

### Added

- GitHub webhook server with `X-Hub-Signature-256` verification (HMAC
  SHA-256, timing-safe comparison; tampered and unsigned deliveries are
  rejected with 401).
- Per-PR orchestration: each `pull_request` opened/reopened/synchronize
  event fetches `pull/<n>/head` and starts an isolated
  `docker compose -p gr-<owner>-<repo>-<pr>` project with an allocated host
  port; names include the repository owner, so same-named repos under
  different owners never collide.
- Preview subdomains: one Caddy site snippet per environment
  (`<pr>-<owner>-<repo>.<base-domain>`) with basic auth and reverse proxy;
  snippets are written only after `compose up` succeeds, Caddy is reloaded
  via `CADDY_RELOAD_CMD` after every change, and snippets are rewritten on
  startup so credential changes propagate.
- Basic auth credential management: random password generated at first
  start and printed once; only the bcrypt hash is persisted.
- PR bot comment: a single comment per pull request, edited in place with
  status, preview URL, commit and expiry.
- TTL reaper: environments past `TTL_HOURS` (default 72) or whose PR was
  merged/closed are torn down with `compose down -v`, including the Caddy
  site and the working copy.
- Read API (`GET /api/environments`) and health endpoint (`GET /health`),
  bound to 127.0.0.1 by default; request bodies over 1 MiB are answered
  with 413 before the connection is closed.
- Dry-run mode (`GREENROOM_DRY_RUN=1`): logs the exact git/docker commands
  and skips all GitHub API calls.
- `ALLOWED_REPOS` allowlist, JSON state store with atomic writes,
  docker compose deployment (greenroom + host-networked Caddy) and
  `.env.example`.
- Test suite: 127 tests covering signature verification, event routing,
  naming (including cross-owner isolation), TTL, comments, Caddy snippets,
  proxy reloads, orchestration, reaping, the HTTP API and the GitHub client
  (mocks and fixtures only, no network).

[0.1.0]: https://github.com/JaydenCJ/greenroom
