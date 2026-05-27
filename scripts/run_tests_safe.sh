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
