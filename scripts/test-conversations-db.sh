#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pg_bin=${CONVERSATIONS_PG_BIN:-/home/tim/.local/pgsql-18/bin}
conversation_test_dir=$(mktemp -d /tmp/foremanhq-conversation-pg.XXXXXX)
cleanup() {
  "$pg_bin/pg_ctl" -D "$conversation_test_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$conversation_test_dir"
}
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$conversation_test_dir/data" --auth=trust --no-locale --encoding=UTF8 > "$conversation_test_dir/init.log"
"$pg_bin/pg_ctl" -D "$conversation_test_dir/data" -l "$conversation_test_dir/server.log" -o "-h '' -k $conversation_test_dir -p 55450" start >/dev/null
"$pg_bin/createdb" -h "$conversation_test_dir" -p 55450 conversations_test
cd "$repo_root"
CONVERSATIONS_TEST_SOCKET="$conversation_test_dir" CONVERSATION_UPLOAD_DIR="$conversation_test_dir/files" pnpm exec vitest run src/server/conversations/conversations.integration.test.ts --reporter=verbose
