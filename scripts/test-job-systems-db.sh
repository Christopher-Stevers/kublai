#!/usr/bin/env bash
# Isolated PostgreSQL only. Never reads DATABASE_URL or changes customer systems.
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pg_bin=${SYSTEMS_PG_BIN:-/home/tim/.local/pgsql-18/bin}
systems_test_dir=$(mktemp -d /tmp/foremanhq-systems-pg.XXXXXX)
cleanup() {
  "$pg_bin/pg_ctl" -D "$systems_test_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$systems_test_dir"
}
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$systems_test_dir/data" --auth=trust --no-locale --encoding=UTF8 > "$systems_test_dir/init.log"
"$pg_bin/pg_ctl" -D "$systems_test_dir/data" -l "$systems_test_dir/server.log" -o "-h '' -k $systems_test_dir -p 55467" start >/dev/null
"$pg_bin/createdb" -h "$systems_test_dir" -p 55467 systems_integration
cd "$repo_root"
SYSTEMS_TEST_SOCKET="$systems_test_dir" ./node_modules/.bin/vitest run src/server/job-systems/service.integration.test.ts --reporter=verbose
