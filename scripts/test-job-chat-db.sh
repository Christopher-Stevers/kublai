#!/usr/bin/env bash
# Isolated PostgreSQL only: no DATABASE_URL, production DB, network listener, or real push.
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pg_bin=${JOB_CHAT_PG_BIN:-/home/tim/.local/pgsql-18/bin}
if [[ ! -x "$pg_bin/initdb" ]]; then
  printf '%s\n' 'Set JOB_CHAT_PG_BIN to a PostgreSQL bin directory containing initdb, pg_ctl, and createdb.' >&2
  exit 1
fi
chat_test_dir=$(mktemp -d /tmp/foremanhq-chat-pg.XXXXXX)
cleanup() {
  "$pg_bin/pg_ctl" -D "$chat_test_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$chat_test_dir"
}
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$chat_test_dir/data" --auth=trust --no-locale --encoding=UTF8 > "$chat_test_dir/init.log"
"$pg_bin/pg_ctl" -D "$chat_test_dir/data" -l "$chat_test_dir/server.log" -o "-h '' -k $chat_test_dir -p 55448" start >/dev/null
"$pg_bin/createdb" -h "$chat_test_dir" -p 55448 chat_integration
"$pg_bin/createdb" -h "$chat_test_dir" -p 55448 chat_push_integration
cd "$repo_root"
JOB_CHAT_TEST_SOCKET="$chat_test_dir" pnpm exec vitest run src/server/chat/chat.integration.test.ts src/server/chat/push.integration.test.ts --reporter=verbose
