#!/usr/bin/env bash
set -euo pipefail
umask 077
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
PG_BIN="$HOME/.local/pgsql-18/bin"
TEST_DIR=$(mktemp -d)
cleanup() { "$PG_BIN/pg_ctl" -D "$TEST_DIR/pgdata" -m immediate stop >/dev/null 2>&1 || true; rm -rf -- "$TEST_DIR"; }
trap cleanup EXIT
DUMP=$(find "$HOME/.local/share/foremenhq-db-backups" -maxdepth 1 -name 'nightly-*.dump' | sort | tail -1)
[ -n "$DUMP" ]
"$PG_BIN/initdb" -D "$TEST_DIR/pgdata" --auth=trust --no-instructions >/dev/null
mkdir "$TEST_DIR/socket"
"$PG_BIN/pg_ctl" -D "$TEST_DIR/pgdata" -o "-c listen_addresses='' -k $TEST_DIR/socket" -w start >/dev/null
"$PG_BIN/createdb" -h "$TEST_DIR/socket" reliability_test
"$PG_BIN/pg_restore" -h "$TEST_DIR/socket" -d reliability_test --single-transaction --exit-on-error --no-owner --no-privileges "$DUMP"
cd "$REPO_ROOT"
PGHOST="$TEST_DIR/socket" PGUSER="$USER" DATABASE_URL="postgresql:///reliability_test" RELIABILITY_TEST_DB=1 node --import dotenv/config --import tsx scripts/check-reliability-db.ts
