#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
pg_bin=${PERF_PG_BIN:-/home/tim/.local/pgsql-18/bin}
lab=$(mktemp -d /tmp/foremanhq-preference-pg.XXXXXX)
cleanup() {
  "$pg_bin/pg_ctl" -D "$lab/data" -m immediate stop >/dev/null 2>&1 || true
  # The test deliberately terminates its LISTEN backend once to verify recovery.
  if rg 'ERROR:|FATAL:|PANIC:' "$lab/server.log" | rg -v 'FATAL:  terminating connection due to administrator command'; then
    echo 'Unexpected private PostgreSQL error log present' >&2
  fi
  rm -rf -- "$lab"
}
trap cleanup EXIT
"$pg_bin/initdb" -D "$lab/data" --auth=trust --no-locale --encoding=UTF8 > "$lab/init.log"
"$pg_bin/pg_ctl" -D "$lab/data" -l "$lab/server.log" -o "-k $lab -p 55467 -h ''" start >/dev/null
"$pg_bin/createdb" -h "$lab" -p 55467 preference_test
PREFERENCE_TEST_SOCKET="$lab" pnpm exec vitest run src/server/material-sort-preferences.integration.test.ts --maxWorkers=1
