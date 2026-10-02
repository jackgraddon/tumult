#!/bin/sh
# Spin up a throwaway Synapse, run the core integration suite, tear it down.
# KEEP=1 leaves the container running for debugging.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
export TEST_SYNAPSE_URL="${TEST_SYNAPSE_URL:-http://localhost:8008}"

if [ ! -f "$HERE/data/homeserver.yaml" ]; then
    echo "[synapse] generating server config..."
    mkdir -p "$HERE/data"
    docker run --rm \
        -v "$HERE/data:/data" \
        -e SYNAPSE_SERVER_NAME=localhost \
        -e SYNAPSE_REPORT_STATS=no \
        matrixdotorg/synapse:v1.114.0 generate
fi

echo "[synapse] starting..."
cp "$HERE/override.yaml" "$HERE/data/override.yaml"
# Fresh container every run: picks up override.yaml changes and clears
# in-memory ratelimiter state from previous runs.
docker compose -f "$HERE/docker-compose.yml" down > /dev/null 2>&1 || true
docker compose -f "$HERE/docker-compose.yml" up -d

cleanup() {
    if [ "${KEEP:-0}" != "1" ]; then
        echo "[synapse] stopping..."
        docker compose -f "$HERE/docker-compose.yml" down
    else
        echo "[synapse] KEEP=1 — leaving container up"
    fi
}
trap cleanup EXIT INT TERM

echo "[synapse] waiting for healthy server..."
for _ in $(seq 1 60); do
    if curl -sf "$TEST_SYNAPSE_URL/_matrix/client/versions" > /dev/null 2>&1; then
        break
    fi
    sleep 2
done
curl -sf "$TEST_SYNAPSE_URL/_matrix/client/versions" > /dev/null

echo "[synapse] running integration tests..."
node --test ${TEST_FILTER:+--test-name-pattern="$TEST_FILTER"} packages/core/test-integration/
