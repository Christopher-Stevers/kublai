#!/usr/bin/env bash
# Temporary PostgreSQL cluster; never reads DATABASE_URL or real uploads.
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pg_bin=${MODELS_PG_BIN:-/home/tim/.local/pgsql-18/bin}
model_test_dir=$(mktemp -d /tmp/foremanhq-models-pg.XXXXXX)
cleanup() {
  "$pg_bin/pg_ctl" -D "$model_test_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$model_test_dir"
}
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$model_test_dir/data" --auth=trust --no-locale --encoding=UTF8 > "$model_test_dir/init.log"
"$pg_bin/pg_ctl" -D "$model_test_dir/data" -l "$model_test_dir/server.log" -o "-h '' -k $model_test_dir -p 55469" start >/dev/null
"$pg_bin/createdb" -h "$model_test_dir" -p 55469 models_integration
cd "$repo_root"
MODELS_TEST_SOCKET="$model_test_dir" ./node_modules/.bin/vitest run src/server/models/deletion.integration.test.ts --reporter=verbose
