#!/bin/sh
# Spin up Synapse + LiveKit + lk-jwt-service, run the call integration test,
# tear it down. KEEP=1 leaves the stack running for debugging.
# UNVERIFIED on first write: see docker-compose.yml.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
export TEST_SYNAPSE_URL="${TEST_SYNAPSE_URL:-http://localhost:8018}"
export TEST_RTC=1

if [ ! -f "$HERE/data/homeserver.yaml" ]; then
    echo "[rtc] generating server config..."
    mkdir -p "$HERE/data"
    docker run --rm \
        -v "$HERE/data:/data" \
        -e SYNAPSE_SERVER_NAME=localhost \
        -e SYNAPSE_REPORT_STATS=no \
        matrixdotorg/synapse:v1.163.0 generate
fi

cp "$HERE/override.yaml" "$HERE/data/override.yaml"
docker compose -f "$HERE/docker-compose.yml" down > /dev/null 2>&1 || true
docker compose -f "$HERE/docker-compose.yml" up -d

cleanup() {
    if [ "${KEEP:-0}" != "1" ]; then
        docker compose -f "$HERE/docker-compose.yml" down
    else
        echo "[rtc] KEEP=1 — leaving the stack up"
    fi
}
trap cleanup EXIT INT TERM

echo "[rtc] waiting for Synapse..."
for _ in $(seq 1 60); do
    curl -sf "$TEST_SYNAPSE_URL/_matrix/client/versions" > /dev/null 2>&1 && break
    sleep 2
done
curl -sf "$TEST_SYNAPSE_URL/_matrix/client/versions" > /dev/null

echo "[rtc] running call integration tests..."
node --test packages/core/test-integration/call.test.ts
