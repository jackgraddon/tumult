#!/bin/sh
# Spin up Synapse + LiveKit + lk-jwt-service, run the call integration test,
# tear it down. KEEP=1 leaves the stack running for debugging. Docker or
# Podman, see tests/container.sh.
# UNVERIFIED on first write: see docker-compose.yml.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LOG_PREFIX="[rtc]"
COMPOSE_FILE="$HERE/docker-compose.yml"
# shellcheck source=../container.sh
. "$HERE/../container.sh"

export TEST_SYNAPSE_URL="${TEST_SYNAPSE_URL:-http://localhost:8018}"
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

compose down > /dev/null 2>&1 || true
trap stack_cleanup EXIT
trap 'exit 130' INT TERM
compose up -d

wait_for_synapse

echo "$LOG_PREFIX running call integration tests..."
cd "$ROOT/packages/core"
node --test test-integration/call.test.ts
