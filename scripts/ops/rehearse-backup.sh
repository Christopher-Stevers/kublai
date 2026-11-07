#!/usr/bin/env bash
# Restore off-site files and a full database into a temporary, socket-only cluster.
set -euo pipefail
umask 077
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
PG_BIN="$HOME/.local/pgsql-18/bin"
REHEARSAL_DIR=$(mktemp -d)
cleanup() { "$PG_BIN/pg_ctl" -D "$REHEARSAL_DIR/pgdata" -m immediate stop >/dev/null 2>&1 || true; rm -rf -- "$REHEARSAL_DIR"; }
trap cleanup EXIT
node "$REPO_ROOT/scripts/ops/backup-snapshot.mjs" restore "${1:-latest}" "$REHEARSAL_DIR/restored"
"$PG_BIN/initdb" -D "$REHEARSAL_DIR/pgdata" --auth=trust --no-instructions >/dev/null
mkdir "$REHEARSAL_DIR/socket"
"$PG_BIN/pg_ctl" -D "$REHEARSAL_DIR/pgdata" -o "-c listen_addresses='' -k $REHEARSAL_DIR/socket" -w start >/dev/null
"$PG_BIN/createdb" -h "$REHEARSAL_DIR/socket" rehearsal
"$PG_BIN/pg_restore" -h "$REHEARSAL_DIR/socket" -d rehearsal --single-transaction --exit-on-error --no-owner --no-privileges "$REHEARSAL_DIR/restored/database.dump"
"$PG_BIN/psql" -h "$REHEARSAL_DIR/socket" -d rehearsal -Atc 'SELECT (SELECT count(*) FROM kublai_part_definition) AS parts, (SELECT count(*) FROM kublai_job) AS jobs'
"$PG_BIN/psql" -h "$REHEARSAL_DIR/socket" -d rehearsal -Atc "SELECT coalesce(jsonb_agg(r), '[]'::jsonb) FROM (
  SELECT DISTINCT 'image' AS kind, \"imageUrl\" AS value FROM kublai_part_definition WHERE \"imageUrl\" LIKE '/%'
  UNION SELECT 'image', \"imageUrl\" FROM kublai_job_floor WHERE \"imageUrl\" LIKE '/%'
  UNION SELECT 'pdf', \"storageKey\" FROM kublai_job_floor_plan WHERE \"status\" = 'ready'
) r" > "$REHEARSAL_DIR/asset-references.json"
node "$REPO_ROOT/scripts/ops/check-restored-assets.mjs" "$REHEARSAL_DIR/restored" "$REHEARSAL_DIR/asset-references.json"
echo 'Off-site database and asset restore rehearsal passed'
