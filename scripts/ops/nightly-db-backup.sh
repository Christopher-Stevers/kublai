#!/usr/bin/env bash
# Nightly ForemanHQ database backup (run by foremenhq-db-backup.timer).
#   1. pg_dump of the local database into ~/.local/share/foremenhq-db-backups,
#      keeping the newest 14 nightly dumps.
#   2. Off-site copy: restores that dump over the old Ubicloud database so it
#      stays a warm standby (at most one day old). Skipped if the new dump
#      looks wrong (far fewer parts/jobs than Ubicloud already holds).
set -euo pipefail

PG_BIN="$HOME/.local/pgsql-18/bin"
BACKUP_DIR="$HOME/.local/share/foremenhq-db-backups"
SECRETS="$HOME/.config/foremenhq"
APP_PW="$(cat "$SECRETS/postgres-app-password")"
LOCAL_URL="postgresql://foremenhq:${APP_PW}@localhost:5433/foremenhq"
REMOTE_URL="$(cat "$SECRETS/ubicloud-database-url")"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="$BACKUP_DIR/nightly-$STAMP.dump"

umask 077
mkdir -p "$BACKUP_DIR"
"$PG_BIN/pg_dump" "$LOCAL_URL" -Fc --no-owner --no-privileges -f "$DUMP"
echo "local dump: $DUMP ($(stat -c %s "$DUMP") bytes)"

# Keep the newest 14 nightly dumps; cutover/rehearsal dumps are left alone.
ls -1t "$BACKUP_DIR"/nightly-*.dump 2>/dev/null | tail -n +15 | xargs -r rm --

# Sanity check before overwriting the off-site copy.
rows() { "$PG_BIN/psql" "$1" -Atc "select (select count(*) from kublai_part_definition) + (select count(*) from kublai_job)"; }
local_rows="$(rows "$LOCAL_URL")"
remote_rows="$(rows "$REMOTE_URL" 2>/dev/null || echo 0)"
if (( local_rows * 2 < remote_rows )); then
  echo "SKIPPING off-site copy: local has $local_rows part+job rows vs $remote_rows off-site" >&2
  exit 1
fi

"$PG_BIN/pg_restore" -d "$REMOTE_URL" --clean --if-exists --no-owner --no-privileges "$DUMP"
echo "off-site copy refreshed on Ubicloud"
