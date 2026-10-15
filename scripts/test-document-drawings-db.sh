#!/usr/bin/env bash
# Disposable PostgreSQL; never connects to the application's database.
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pg_bin=${DOC_DRAWING_PG_BIN:-/home/tim/.local/pgsql-18/bin}
doc_drawing_test_dir=$(mktemp -d /tmp/foremanhq-doc-drawings-pg.XXXXXX)
cleanup() {
  "$pg_bin/pg_ctl" -D "$doc_drawing_test_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$doc_drawing_test_dir"
}
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$doc_drawing_test_dir/data" --auth=trust --no-locale --encoding=UTF8 > "$doc_drawing_test_dir/init.log"
"$pg_bin/pg_ctl" -D "$doc_drawing_test_dir/data" -l "$doc_drawing_test_dir/server.log" -o "-h '' -k $doc_drawing_test_dir -p 55464" start >/dev/null
"$pg_bin/createdb" -h "$doc_drawing_test_dir" -p 55464 document_drawings_integration
cd "$repo_root"
DOC_DRAWING_TEST_SOCKET="$doc_drawing_test_dir" ./node_modules/.bin/vitest run src/server/documents/drawing-workspace.integration.test.ts --reporter=verbose
