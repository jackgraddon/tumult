#!/bin/sh
# Spin up a throwaway Synapse, run the core integration suite, tear it down.
# KEEP=1 leaves the container running for debugging. Docker or Podman, see
# tests/container.sh; with neither, it points at the CI workflow instead.
#
# TEST_SYNAPSE_URL set by the caller means "use that server": no container is
# started or stopped, and nothing here needs a container runtime.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LOG_PREFIX="[synapse]"
COMPOSE_FILE="$HERE/docker-compose.yml"
# shellcheck source=../container.sh
. "$HERE/../container.sh"

run_suite() {
    echo "$LOG_PREFIX running integration tests..."
    # Globbed, not a directory: `node --test <dir>` broke on Node 25.
    cd "$ROOT/packages/core"
    node --test ${TEST_FILTER:+--test-name-pattern="$TEST_FILTER"} "test-integration/**/*.test.ts"
}

if [ -n "${TEST_SYNAPSE_URL:-}" ]; then
    echo "$LOG_PREFIX using the server at $TEST_SYNAPSE_URL (no container)"
    wait_for_synapse
    run_suite
    exit 0
fi

export TEST_SYNAPSE_URL=http://localhost:8008
pick_runtime

if [ ! -f "$HERE/data/homeserver.yaml" ]; then
    echo "$LOG_PREFIX generating server config..."
    mkdir -p "$HERE/data"
    # `:z` relabels for SELinux (Fedora); a no-op elsewhere. The registry is
    # spelled out because Podman refuses short image names without a TTY.
    ctr run --rm \
        -v "$HERE/data:/data:z" \
        -e SYNAPSE_SERVER_NAME=localhost \
        -e SYNAPSE_REPORT_STATS=no \
        docker.io/matrixdotorg/synapse:v1.114.0 generate
fi

echo "$LOG_PREFIX starting..."
# Fresh container every run: picks up override.yaml changes and clears
# in-memory ratelimiter state from previous runs.
compose down > /dev/null 2>&1 || true
trap stack_cleanup EXIT
trap 'exit 130' INT TERM
compose up -d

wait_for_synapse
run_suite
