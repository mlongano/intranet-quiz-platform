#!/usr/bin/env bash
set -euo pipefail

# Safe pytest runner for the Docker debug stack.
#
# Never run pytest directly inside the app container: its DATABASE_URL points at
# the real application database. This script creates/uses quizparty_test and
# passes TEST_DATABASE_URL so tests/conftest.py redirects all test DB access to
# the isolated test database.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f compose.yaml -f compose-debug.yaml)
TEST_DB="${TEST_DB:-quizparty_test}"

if [[ "${TEST_DB,,}" != *test* ]]; then
  echo "Refusing to use TEST_DB='$TEST_DB': test database name must contain 'test'." >&2
  exit 1
fi

cd "$ROOT_DIR"

# Ensure the database container is available.
"${COMPOSE[@]}" up -d db >/dev/null

# ── stale-source guard ───────────────────────────────────────────────────────
# compose-debug.yaml bind-mounts the repo's top-level modules one file at a
# time. Docker resolves a single-file mount to an inode, and `git pull` replaces
# the file rather than rewriting it, so the container keeps serving the
# pre-pull content while the working tree looks correct. Tests then run against
# stale code and fail — or, far worse, pass. Directory mounts (services/, db/,
# routes/, tests/) do not have this problem.
# Derived from compose-debug.yaml rather than hardcoded, so adding or deleting
# a top-level module cannot leave this list wrong.
mapfile -t ROOT_MODULES < <(
  grep -oE '^\s*-\s*\./[A-Za-z0-9_]+\.py:' compose-debug.yaml \
    | sed -E 's#^\s*-\s*\./##; s#:$##' | sort -u
)

stale=()
if "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx app; then
  for f in "${ROOT_MODULES[@]}"; do
    # A module may have been deleted on the host but still exist in the
    # container, or vice versa; either way the container is out of date.
    host_sum="$(sha1sum "$f" 2>/dev/null | cut -d' ' -f1 || true)"
    cont_sum="$("${COMPOSE[@]}" exec -T app sha1sum "$f" 2>/dev/null | cut -d' ' -f1 || true)"
    if [[ "$host_sum" != "$cont_sum" ]]; then
      stale+=("$f")
    fi
  done
fi

if (( ${#stale[@]} > 0 )); then
  echo "Stale source in the app container: ${stale[*]}"
  echo "Recreating app and worker so tests run against the working tree..."
  "${COMPOSE[@]}" up -d --force-recreate app worker >/dev/null
  # The container accepts exec well before its entrypoint has finished
  # installing dev dependencies, so wait for pytest itself, not just the
  # container. Without this the run dies with "pytest: not found".
  echo -n "Waiting for the app container to finish starting"
  ready=0
  for _ in $(seq 1 90); do
    if "${COMPOSE[@]}" exec -T app sh -c 'command -v pytest >/dev/null 2>&1'; then
      ready=1
      break
    fi
    echo -n "."
    sleep 2
  done
  echo
  if (( ready == 0 )); then
    echo "app container never became ready (pytest unavailable after 180s)." >&2
    exit 1
  fi
fi

# Create the test DB if it does not exist. Do not drop or recreate anything here.
if ! "${COMPOSE[@]}" exec -T db psql -U quizparty -d postgres -Atc \
  "SELECT 1 FROM pg_database WHERE datname = '$TEST_DB'" | grep -qx '1'; then
  echo "Creating isolated test database '$TEST_DB'..."
  "${COMPOSE[@]}" exec -T db createdb -U quizparty "$TEST_DB"
fi

echo "Running pytest against isolated database '$TEST_DB'..."
"${COMPOSE[@]}" exec -T app sh -c \
  'TEST_DATABASE_URL="postgresql://quizparty:${POSTGRES_PASSWORD}@db:5432/'"$TEST_DB"'" pytest "$@"' \
  -- "$@"
