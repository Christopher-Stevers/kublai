#!/usr/bin/env bash
# Isolated PostgreSQL only; never reads DATABASE_URL or changes real catalogue settings.
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pg_bin=${PURCHASE_PG_BIN:-/home/tim/.local/pgsql-18/bin}
test_dir=$(mktemp -d /tmp/foremanhq-catalogue-pg.XXXXXX)
cleanup() {
  "$pg_bin/pg_ctl" -D "$test_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$test_dir"
}
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$test_dir/data" --auth=trust --no-locale --encoding=UTF8 > "$test_dir/init.log"
"$pg_bin/pg_ctl" -D "$test_dir/data" -l "$test_dir/server.log" -o "-h '' -k $test_dir -p 55462" start >/dev/null
"$pg_bin/createdb" -h "$test_dir" -p 55462 catalogue_integration
cd "$repo_root"
CATALOGUE_TEST_SOCKET="$test_dir" ./node_modules/.bin/vitest run src/server/catalogue/hidden-parts.integration.test.ts --reporter=verbose
