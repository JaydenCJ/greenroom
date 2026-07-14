#!/usr/bin/env bash
# Greenroom smoke test. Starts the server in dry-run mode on 127.0.0.1,
# drives the full PR lifecycle through signed webhooks and asserts every
# step. Prints "SMOKE OK" and exits 0 only if all assertions pass.
# No network access beyond 127.0.0.1 is required or performed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT=18811
HOST=127.0.0.1
SECRET="smoke-webhook-secret"
BASE_URL="http://$HOST:$PORT"
TMP="$(mktemp -d)"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
  echo "[smoke] FAIL: $1" >&2
  echo "[smoke] server log tail:" >&2
  tail -20 "$TMP/server.log" >&2 || true
  exit 1
}

sign() {
  node -e '
const fs = require("node:fs");
const crypto = require("node:crypto");
const body = fs.readFileSync(process.argv[1]);
console.log(`sha256=${crypto.createHmac("sha256", process.argv[2]).update(body).digest("hex")}`);
' "$1" "$SECRET"
}

post_webhook() { # fixture signature -> prints http status
  curl -s -o "$TMP/response.json" -w '%{http_code}' -X POST "$BASE_URL/webhook" \
    -H "content-type: application/json" \
    -H "x-github-event: pull_request" \
    -H "x-github-delivery: smoke-$RANDOM" \
    -H "x-hub-signature-256: $2" \
    --data-binary "@$1"
}

echo "[smoke] 1/8 building"
if [[ ! -d node_modules ]]; then
  fail "node_modules missing; run 'npm ci' first"
fi
npm run build --silent >/dev/null

echo "[smoke] 2/8 validating docker-compose.yml"
if command -v docker >/dev/null 2>&1; then
  GITHUB_WEBHOOK_SECRET="$SECRET" BASE_DOMAIN=preview.example.com \
    docker compose -f docker-compose.yml config -q || fail "docker compose config failed"
else
  echo "[smoke]     docker CLI not found, skipping compose validation"
fi

echo "[smoke] 3/8 starting server on $HOST:$PORT (dry-run)"
GREENROOM_DRY_RUN=1 \
GREENROOM_HOST="$HOST" \
GREENROOM_PORT="$PORT" \
GITHUB_TOKEN="" \
GITHUB_WEBHOOK_SECRET="$SECRET" \
BASE_DOMAIN=preview.example.com \
BASIC_AUTH_PASSWORD=smoke-basic-auth-pass \
DATA_DIR="$TMP/data" \
CADDY_DIR="$TMP/caddy" \
WORK_DIR="$TMP/work" \
  node dist/src/index.js >"$TMP/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 50); do
  if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || fail "server exited early"
  sleep 0.2
done

echo "[smoke] 4/8 GET /health"
STATUS=$(curl -s -o "$TMP/health.json" -w '%{http_code}' "$BASE_URL/health")
[[ "$STATUS" == "200" ]] || fail "GET /health returned $STATUS, expected 200"
grep -q '"status":"ok"' "$TMP/health.json" || fail "health body missing status ok"
echo "[smoke]     -> 200 $(cat "$TMP/health.json")"

echo "[smoke] 5/8 signed pull_request opened webhook"
FIXTURE=tests/fixtures/pull_request.opened.json
STATUS=$(post_webhook "$FIXTURE" "$(sign "$FIXTURE")")
[[ "$STATUS" == "202" ]] || fail "webhook returned $STATUS, expected 202"
grep -q '"project":"gr-acme-demo-app-42"' "$TMP/response.json" || fail "webhook response missing project"

for _ in $(seq 1 50); do
  curl -s "$BASE_URL/api/environments" >"$TMP/envs.json"
  if grep -q '"status": *"running"' "$TMP/envs.json"; then break; fi
  sleep 0.2
done
node -e '
const data = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const env = data.environments.find((e) => e.project === "gr-acme-demo-app-42");
if (!env) throw new Error("environment record gr-acme-demo-app-42 not found");
if (env.status !== "running") throw new Error(`status is ${env.status}, expected running`);
if (env.url !== "https://42-acme-demo-app.preview.example.com") throw new Error(`unexpected url ${env.url}`);
if (env.port < 20000 || env.port > 20100) throw new Error(`port ${env.port} outside range`);
console.log(`[smoke]     -> environment ${env.project} ${env.status} at ${env.url} (port ${env.port})`);
' "$TMP/envs.json" || fail "environment record assertions failed"

echo "[smoke] 6/8 Caddy snippet"
SNIPPET="$TMP/caddy/gr-acme-demo-app-42.caddy"
[[ -f "$SNIPPET" ]] || fail "Caddy snippet $SNIPPET was not written"
grep -q '42-acme-demo-app.preview.example.com {' "$SNIPPET" || fail "snippet missing preview host"
grep -q 'basic_auth' "$SNIPPET" || fail "snippet missing basic_auth"
grep -q 'reverse_proxy 127.0.0.1:' "$SNIPPET" || fail "snippet missing reverse_proxy"
echo "[smoke]     -> $(basename "$SNIPPET") contains host, basic_auth, reverse_proxy"

echo "[smoke] 7/8 tampered signature is rejected"
BAD_SIG="sha256=0000000000000000000000000000000000000000000000000000000000000000"
STATUS=$(post_webhook "$FIXTURE" "$BAD_SIG")
[[ "$STATUS" == "401" ]] || fail "tampered webhook returned $STATUS, expected 401"
echo "[smoke]     -> 401 as expected"

echo "[smoke] 8/8 closed webhook tears the environment down"
FIXTURE=tests/fixtures/pull_request.closed_merged.json
STATUS=$(post_webhook "$FIXTURE" "$(sign "$FIXTURE")")
[[ "$STATUS" == "202" ]] || fail "close webhook returned $STATUS, expected 202"
for _ in $(seq 1 50); do
  curl -s "$BASE_URL/api/environments" >"$TMP/envs.json"
  if grep -q '"status": *"destroyed"' "$TMP/envs.json"; then break; fi
  sleep 0.2
done
grep -q '"destroyedReason": *"merged"' "$TMP/envs.json" || fail "environment was not destroyed with reason merged"
[[ ! -f "$SNIPPET" ]] || fail "Caddy snippet still present after teardown"
echo "[smoke]     -> environment destroyed, snippet removed"

echo "SMOKE OK"
