#!/usr/bin/env bash
# Send a signed sample pull_request webhook to a locally running greenroom.
# Defaults match the Quickstart demo; override via environment variables:
#   GREENROOM_HOST, GREENROOM_PORT, GITHUB_WEBHOOK_SECRET, FIXTURE
set -euo pipefail

HOST="${GREENROOM_HOST:-127.0.0.1}"
PORT="${GREENROOM_PORT:-8811}"
SECRET="${GITHUB_WEBHOOK_SECRET:-demo-secret}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAYLOAD="$ROOT/tests/fixtures/${FIXTURE:-pull_request.opened.json}"

SIGNATURE=$(node -e '
const fs = require("node:fs");
const crypto = require("node:crypto");
const body = fs.readFileSync(process.argv[1]);
const digest = crypto.createHmac("sha256", process.argv[2]).update(body).digest("hex");
console.log(`sha256=${digest}`);
' "$PAYLOAD" "$SECRET")

echo "POST http://$HOST:$PORT/webhook ($(basename "$PAYLOAD"))"
curl -sS -X POST "http://$HOST:$PORT/webhook" \
  -H "content-type: application/json" \
  -H "x-github-event: pull_request" \
  -H "x-github-delivery: sample-$(date +%s)" \
  -H "x-hub-signature-256: $SIGNATURE" \
  --data-binary "@$PAYLOAD"
echo
sleep 1
echo "GET http://$HOST:$PORT/api/environments"
curl -sS "http://$HOST:$PORT/api/environments"
echo
