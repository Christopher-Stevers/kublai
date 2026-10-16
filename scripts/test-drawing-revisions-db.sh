#!/usr/bin/env bash
# Isolated PostgreSQL only; never reads DATABASE_URL or changes real drawings.
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pg_bin=${PURCHASE_PG_BIN:-/home/tim/.local/pgsql-18/bin}
purchase_test_dir=$(mktemp -d /tmp/foremanhq-purchase-pg.XXXXXX)
cleanup() {
  "$pg_bin/pg_ctl" -D "$purchase_test_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$purchase_test_dir"
}
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$purchase_test_dir/data" --auth=trust --no-locale --encoding=UTF8 > "$purchase_test_dir/init.log"
"$pg_bin/pg_ctl" -D "$purchase_test_dir/data" -l "$purchase_test_dir/server.log" -o "-h '' -k $purchase_test_dir -p 55461" start >/dev/null
"$pg_bin/createdb" -h "$purchase_test_dir" -p 55461 purchase_integration
cd "$repo_root"
PURCHASE_TEST_SOCKET="$purchase_test_dir" ./node_modules/.bin/vitest run src/server/drawings/revisions.integration.test.ts --reporter=verbose
