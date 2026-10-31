#!/bin/sh
# Spin up Synapse + LiveKit + lk-jwt-service, run the MatrixRTC tests, tear it
# down. KEEP=1 leaves the stack running for debugging. Docker or Podman, see
# tests/container.sh; host networking, see docker-compose.yml.
#
# Three suites, in order:
#  1. packages/core/test-integration/{call,voice}.test.ts — Node: the call
#     widget driver and the native-voice token exchange against the real stack.
#  2. apps/web/test/rtc-media.test.ts — two Chromium browsers join one video
#     call through the built app and check each other's mic and camera arrive.
#  3. apps/web/test/e2ee.test.ts — one account on three devices: recovery
#     setup, emoji verification, and history restored from the recovery key.
# RTC_MEDIA=0 skips both browser suites (they need Chromium:
# `playwright install chromium`).
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LOG_PREFIX="[rtc]"
COMPOSE_FILE="$HERE/docker-compose.yml"
# shellcheck source=../container.sh
. "$HERE/../container.sh"

export TEST_SYNAPSE_URL="${TEST_SYNAPSE_URL:-http://127.0.0.1:8018}"
export TEST_RTC=1
pick_runtime

if [ ! -f "$HERE/data/homeserver.yaml" ]; then
    echo "$LOG_PREFIX generating server config..."
    mkdir -p "$HERE/data"
    ctr run --rm \
        -v "$HERE/data:/data:z" \
        -e SYNAPSE_SERVER_NAME=localhost \
        -e SYNAPSE_REPORT_STATS=no \
        docker.io/matrixdotorg/synapse:v1.163.0 generate
fi

# The federation listener's certificate. Self-signed and generated, never
# committed; world-readable on purpose, because Synapse runs as its own user.
if [ ! -f "$HERE/tls/tls.key" ]; then
    echo "$LOG_PREFIX generating a self-signed federation certificate..."
    mkdir -p "$HERE/tls"
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=localhost" \
        -keyout "$HERE/tls/tls.key" -out "$HERE/tls/tls.crt" 2> /dev/null
    chmod 644 "$HERE/tls/tls.key" "$HERE/tls/tls.crt"
fi

compose down > /dev/null 2>&1 || true
trap stack_cleanup EXIT
trap 'exit 130' INT TERM
compose up -d

wait_for_synapse

echo "$LOG_PREFIX waiting for lk-jwt-service and LiveKit..."
for _ in $(seq 1 30); do
    # Both answer plain HTTP on their ports once listening; any status will do.
    if curl -s -o /dev/null http://127.0.0.1:8090/ && curl -s -o /dev/null http://127.0.0.1:7880/; then break; fi
    sleep 2
done

echo "$LOG_PREFIX running call and voice integration tests..."
(cd "$ROOT/packages/core" && node --test test-integration/call.test.ts test-integration/voice.test.ts)

if [ "${RTC_MEDIA:-1}" = "1" ]; then
    echo "$LOG_PREFIX running the two-browser media test..."
    (cd "$ROOT" && pnpm --filter @tumult/web test:rtc-media)
    # Not a call test, but it needs the same things: the real app in Chromium
    # and a modern Synapse (this stack's, not tests/synapse's v1.114).
    echo "$LOG_PREFIX running the encryption trust-flow test..."
    (cd "$ROOT" && pnpm --filter @tumult/web test:e2ee)
fi
