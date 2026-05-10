#!/usr/bin/env bash
# Curl-driven E2E smoke for the admin API.
#
# Prerequisites:
#   - Gateway running at $HOST (defaults to http://127.0.0.1:8081)
#   - WEB_UI_PASSWORD configured matching $ADMIN_PASSWORD env var
#   - DRIME_GATEWAY_WORKSPACE_ID set OR a real DRIME_API_KEY (init step requires Drime)
#
# Usage:
#   HOST=http://127.0.0.1:8099 ADMIN_PASSWORD=testpass scripts/smoke/admin-curl-flow.sh
#
# Optional flags:
#   SKIP_INIT=1     skip the workspace init step (use when DRIME_GATEWAY_WORKSPACE_ID pre-set)
#   SKIP_OBJECTS=1  skip bucket+object steps (only validate auth/health/UI path)

set -euo pipefail

HOST="${HOST:-http://127.0.0.1:8081}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?Set ADMIN_PASSWORD}"
ORIGIN="${ORIGIN:-$HOST}"
COOKIE_JAR="$(mktemp -t drime-s3-smoke-XXXXXX)"
trap 'rm -f "$COOKIE_JAR"' EXIT
BUCKET_NAME="${BUCKET_NAME:-smoke-$RANDOM-$RANDOM}"

step() { printf "\n\033[1;34m==> %s\033[0m\n" "$1"; }

step "Health"
curl -fsS "$HOST/_admin/health" | tee /dev/stderr | grep -q '"ok":true'

step "UI shell"
curl -fsS -i "$HOST/_ui/" | grep -E "^HTTP|^Content-Type" | head -2
curl -fsS "$HOST/_ui/" | grep -q 'id="root"'

step "Login"
curl -fsS -c "$COOKIE_JAR" \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}" \
  "$HOST/_admin/login" | grep -q '"authenticated":true'

step "Session"
curl -fsS -b "$COOKIE_JAR" -H "Origin: $ORIGIN" "$HOST/_admin/session" | grep -q '"authenticated":true'

step "Status"
curl -fsS -b "$COOKIE_JAR" -H "Origin: $ORIGIN" "$HOST/_admin/status" | head -c 400; echo

if [ "${SKIP_INIT:-0}" != "1" ]; then
  step "Init workspace"
  curl -fsS -b "$COOKIE_JAR" -H "Origin: $ORIGIN" -X POST "$HOST/_admin/init" | head -c 200; echo
fi

if [ "${SKIP_OBJECTS:-0}" != "1" ]; then
  step "Create bucket: $BUCKET_NAME"
  curl -fsS -b "$COOKIE_JAR" -H "Origin: $ORIGIN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$BUCKET_NAME\"}" \
    "$HOST/_admin/buckets" | grep -q "\"name\":\"$BUCKET_NAME\""

  step "PUT object"
  payload="hello-plan-b"
  curl -fsS -b "$COOKIE_JAR" -H "Origin: $ORIGIN" \
    -H "Content-Type: text/plain" \
    -H "Content-Length: ${#payload}" \
    -X PUT --data-binary "$payload" \
    "$HOST/_admin/buckets/$BUCKET_NAME/objects/hello.txt" | grep -q '"etag"'

  step "List objects"
  curl -fsS -b "$COOKIE_JAR" -H "Origin: $ORIGIN" \
    "$HOST/_admin/buckets/$BUCKET_NAME/objects?delimiter=/" | grep -q '"hello.txt"'

  step "GET object"
  curl -fsS -b "$COOKIE_JAR" -H "Origin: $ORIGIN" \
    "$HOST/_admin/buckets/$BUCKET_NAME/objects/hello.txt" | grep -q "hello-plan-b"

  step "DELETE object"
  code="$(curl -fsS -b "$COOKIE_JAR" -H "Origin: $ORIGIN" \
    -X DELETE -o /dev/null -w '%{http_code}' \
    "$HOST/_admin/buckets/$BUCKET_NAME/objects/hello.txt")"
  [ "$code" = "204" ]

  step "DELETE bucket"
  code="$(curl -fsS -b "$COOKIE_JAR" -H "Origin: $ORIGIN" \
    -X DELETE -o /dev/null -w '%{http_code}' \
    "$HOST/_admin/buckets/$BUCKET_NAME")"
  [ "$code" = "204" ]
fi

step "Logout"
code="$(curl -fsS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H "Origin: $ORIGIN" \
  -X POST -o /dev/null -w '%{http_code}' "$HOST/_admin/logout")"
[ "$code" = "204" ]

step "Verify session is cleared after logout"
curl -fsS -b "$COOKIE_JAR" -H "Origin: $ORIGIN" "$HOST/_admin/session" | grep -q '"authenticated":false'

printf "\n\033[1;32msmoke complete\033[0m\n"
