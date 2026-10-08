#!/usr/bin/env bash
# Isolated Unix-socket PostgreSQL, synthetic fixtures only. Never uses DATABASE_URL.
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pg_bin=${TIMESHEETS_PG_BIN:-/home/tim/.local/pgsql-18/bin}
time_test_dir=$(mktemp -d /tmp/foremanhq-time-pg.XXXXXX)
cleanup() {
  "$pg_bin/pg_ctl" -D "$time_test_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$time_test_dir"
}
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$time_test_dir/data" --auth=trust --no-locale --encoding=UTF8 > "$time_test_dir/init.log"
"$pg_bin/pg_ctl" -D "$time_test_dir/data" -l "$time_test_dir/server.log" -o "-h '' -k $time_test_dir -p 55449" start >/dev/null
"$pg_bin/createdb" -h "$time_test_dir" -p 55449 timesheets_integration
cd "$repo_root"
TIMESHEETS_TEST_SOCKET="$time_test_dir" pnpm exec vitest run src/server/timesheets/timesheets.integration.test.ts --reporter=verbose
