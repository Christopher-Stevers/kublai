#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pg_bin=${PERF_PG_BIN:-/home/tim/.local/pgsql-18/bin}
timing_dir=$(mktemp -d /tmp/foremanhq-query-timing.XXXXXX)
cleanup() {
  "$pg_bin/pg_ctl" -D "$timing_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$timing_dir"
}
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$timing_dir/data" --auth=trust --no-locale --encoding=UTF8 > "$timing_dir/init.log"
"$pg_bin/pg_ctl" -D "$timing_dir/data" -l "$timing_dir/server.log" -o "-h '' -k $timing_dir -p 55464" start >/dev/null
"$pg_bin/createdb" -h "$timing_dir" -p 55464 timing_test
cd "$repo_root"
QUERY_TIMING_TEST_SOCKET="$timing_dir" ./node_modules/.bin/vitest run src/server/db/timed-client.integration.test.ts --reporter=dot
