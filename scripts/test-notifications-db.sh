#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
pg_bin=${NOTIFICATIONS_PG_BIN:-/home/tim/.local/pgsql-18/bin}
notification_test_dir=$(mktemp -d /tmp/foremanhq-notification-pg.XXXXXX)
cleanup() {
  "$pg_bin/pg_ctl" -D "$notification_test_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$notification_test_dir"
}
trap cleanup EXIT INT TERM
"$pg_bin/initdb" -D "$notification_test_dir/data" --auth=trust --no-locale --encoding=UTF8 > "$notification_test_dir/init.log"
"$pg_bin/pg_ctl" -D "$notification_test_dir/data" -l "$notification_test_dir/server.log" -o "-h '' -k $notification_test_dir -p 55451" start >/dev/null
"$pg_bin/createdb" -h "$notification_test_dir" -p 55451 notifications_test
cd "$repo_root"
NOTIFICATIONS_TEST_SOCKET="$notification_test_dir" pnpm exec vitest run src/server/notifications/notifications.integration.test.ts --reporter=verbose
