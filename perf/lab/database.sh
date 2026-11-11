#!/usr/bin/env bash
# Isolated PostgreSQL with a private Unix socket; never connects to DATABASE_URL.
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
pg_bin=${PERF_PG_BIN:-/home/tim/.local/pgsql-18/bin}
lab_dir=$(mktemp -d /tmp/foremanhq-perf-pg.XXXXXX)
cleanup() {
  "$pg_bin/pg_ctl" -D "$lab_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$lab_dir"
}
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$lab_dir/data" --auth=trust --no-locale --encoding=UTF8 > "$lab_dir/init.log"
"$pg_bin/pg_ctl" -D "$lab_dir/data" -l "$lab_dir/server.log" -o "-h '' -k $lab_dir -p 55463" start >/dev/null
"$pg_bin/createdb" -h "$lab_dir" -p 55463 foremanhq_perf_lab
export PERF_LAB_SOCKET="$lab_dir"
export PERF_LAB_DATABASE_URL="postgresql://localhost/foremanhq_perf_lab?host=${lab_dir//\//%2F}&port=55463"
export DATABASE_URL="$PERF_LAB_DATABASE_URL"
export PERF_LAB_FIXTURES="$lab_dir/fixtures.json"
export PERF_LAB_ASSETS="$lab_dir/assets"
cd "$repo_root"
./node_modules/.bin/drizzle-kit export --config perf/lab/drizzle.config.ts > "$lab_dir/schema.sql"
node perf/lab/order-schema.mjs "$lab_dir/schema.sql" "$lab_dir/ordered-schema.sql"
"$pg_bin/psql" -h "$lab_dir" -p 55463 -d foremanhq_perf_lab -v ON_ERROR_STOP=1 -f "$lab_dir/ordered-schema.sql" > "$lab_dir/schema.log" 2>&1 || { cat "$lab_dir/schema.log"; exit 1; }
./node_modules/.bin/tsx perf/lab/seed.ts
if [[ $# -gt 0 ]]; then "$@"; else cat "$PERF_LAB_FIXTURES"; fi
