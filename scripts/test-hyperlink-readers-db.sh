#!/usr/bin/env bash
# Only a disposable database; never reads DATABASE_URL.
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pg_bin=${HYPERLINK_PG_BIN:-/home/tim/.local/pgsql-18/bin}
hyperlink_test_dir=$(mktemp -d /tmp/foremanhq-hyperlink-pg.XXXXXX)
cleanup() {
  "$pg_bin/pg_ctl" -D "$hyperlink_test_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$hyperlink_test_dir"
}
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$hyperlink_test_dir/data" --auth=trust --no-locale --encoding=UTF8 > "$hyperlink_test_dir/init.log"
"$pg_bin/pg_ctl" -D "$hyperlink_test_dir/data" -l "$hyperlink_test_dir/server.log" -o "-h '' -k $hyperlink_test_dir -p 55462" start >/dev/null
"$pg_bin/createdb" -h "$hyperlink_test_dir" -p 55462 hyperlink_integration
cd "$repo_root"
HYPERLINK_TEST_SOCKET="$hyperlink_test_dir" ./node_modules/.bin/vitest run src/server/drawings/hyperlink-reader-store.integration.test.ts --reporter=verbose
