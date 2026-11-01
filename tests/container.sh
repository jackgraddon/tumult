# Shared by tests/*/run.sh (sourced, not executed). Picks a container runtime so
# the integration stacks run on any machine that has ONE of them:
#
#   1. Docker, when its daemon answers (`docker info`), with `docker compose`.
#   2. Podman (Fedora Atomic ships it), with `podman compose` or `podman-compose`.
#
# Neither → exit with directions to the CI workflow, which always has Docker.
# Override the choice with CONTAINER_RUNTIME=docker|podman.
#
# Defines `ctr` (the runtime) and `compose` (its compose). Callers set
# COMPOSE_FILE and LOG_PREFIX first.

runtime_missing() {
    cat >&2 <<EOF
${LOG_PREFIX} $1

The integration suite needs Docker (with a running daemon) or Podman.
Without either, run it on GitHub's runners instead:

    gh workflow run integration.yml --ref \$(git branch --show-current)
    gh run watch

Or point it at a Synapse you already run (no container is started):

    TEST_SYNAPSE_URL=http://host:8008 pnpm test:integration
EOF
    exit 1
}

pick_runtime() {
    case "${CONTAINER_RUNTIME:-}" in
        docker | podman) ;;
        "")
            if command -v docker > /dev/null 2>&1 && docker info > /dev/null 2>&1; then
                CONTAINER_RUNTIME=docker
            elif command -v podman > /dev/null 2>&1; then
                CONTAINER_RUNTIME=podman
            elif command -v docker > /dev/null 2>&1; then
                runtime_missing "docker is installed but its daemon is not running."
            else
                runtime_missing "no container runtime found."
            fi
            ;;
        *) runtime_missing "CONTAINER_RUNTIME must be docker or podman, not '${CONTAINER_RUNTIME}'." ;;
    esac

    # `podman compose` is a front end that needs a provider installed, so probe
    # it rather than assume; `podman-compose` is the standalone fallback.
    if "$CONTAINER_RUNTIME" compose version > /dev/null 2>&1; then
        COMPOSE_CMD="$CONTAINER_RUNTIME compose"
    elif [ "$CONTAINER_RUNTIME" = podman ] && command -v podman-compose > /dev/null 2>&1; then
        COMPOSE_CMD="podman-compose"
    else
        runtime_missing "$CONTAINER_RUNTIME has no compose (install docker-compose or podman-compose)."
    fi
    echo "${LOG_PREFIX} using $CONTAINER_RUNTIME ($COMPOSE_CMD)"
}

ctr() { "$CONTAINER_RUNTIME" "$@"; }

# Word-splitting COMPOSE_CMD is intended: it is one or two words, never a path.
# shellcheck disable=SC2086
compose() { $COMPOSE_CMD -f "$COMPOSE_FILE" "$@"; }

# Tear down unless KEEP=1. On failure, print the stack's recent logs first:
# CI cannot keep the stack up for a look, so the logs are all it gets.
stack_cleanup() {
    status=$?
    if [ "$status" -ne 0 ]; then
        echo "${LOG_PREFIX} failed (exit $status); recent container logs:"
        compose logs --tail 80 || true
    fi
    if [ "${KEEP:-0}" = "1" ]; then
        echo "${LOG_PREFIX} KEEP=1 — leaving the stack up"
    else
        echo "${LOG_PREFIX} stopping..."
        compose down > /dev/null 2>&1 || true
    fi
    exit "$status"
}

# Poll until Synapse answers, then fail loudly (not silently) if it never did.
wait_for_synapse() {
    echo "${LOG_PREFIX} waiting for Synapse at $TEST_SYNAPSE_URL..."
    for _ in $(seq 1 60); do
        curl -sf "$TEST_SYNAPSE_URL/_matrix/client/versions" > /dev/null 2>&1 && return 0
        sleep 2
    done
    echo "${LOG_PREFIX} Synapse did not answer within 120 s." >&2
    return 1
}
