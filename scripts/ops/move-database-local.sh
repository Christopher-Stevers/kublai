#!/usr/bin/env bash
# Moves the ForemanHQ database from Ubicloud to the local PostgreSQL 18 on this
# machine, with a verified copy and automatic rollback.
#
#   scripts/ops/move-database-local.sh
#
#   1. Installs and starts the foremenhq-postgres user service (port 5433).
#   2. Stops ForemanHQ (maintenance window, a few minutes).
#   3. Dumps the Ubicloud database and restores it locally.
#   4. Compares exact row counts for every table; any mismatch rolls back.
#   5. Points .env DATABASE_URL at the local database (old .env kept) and
#      restarts ForemanHQ, then checks /api/health.
#   6. Installs a nightly backup timer (scripts/ops/nightly-db-backup.sh).
# Ubicloud is only read from here; it stays intact as the fallback.
# Undo with scripts/ops/rollback-database-ubicloud.sh.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PG_BIN="$HOME/.local/pgsql-18/bin"
PG_DATA="$HOME/.local/share/foremenhq-postgres"
BACKUP_DIR="$HOME/.local/share/foremenhq-db-backups"
SECRETS="$HOME/.config/foremenhq"
UNIT_DIR="$HOME/.config/systemd/user"
STAMP="$(date +%Y%m%d-%H%M%S)"

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

cd "$APP_DIR"
[[ -x "$PG_BIN/postgres" ]] || die "PostgreSQL 18 not found at $PG_BIN"
[[ -f "$SECRETS/postgres-app-password" ]] || die "missing $SECRETS/postgres-app-password"
REMOTE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d "\"'")"
[[ "$REMOTE_URL" == *ubicloud* ]] || die ".env DATABASE_URL is not the Ubicloud database (already moved?)"
APP_PW="$(cat "$SECRETS/postgres-app-password")"
LOCAL_URL="postgresql://foremenhq:${APP_PW}@localhost:5433/foremenhq"

log "Installing foremenhq-postgres service"
mkdir -p "$UNIT_DIR" "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cat > "$UNIT_DIR/foremenhq-postgres.service" <<EOF
[Unit]
Description=ForemanHQ local PostgreSQL 18
Before=foremenhq.service

[Service]
Type=exec
ExecStart=$PG_BIN/postgres -D $PG_DATA
ExecReload=/bin/kill -HUP \$MAINPID
KillMode=mixed
KillSignal=SIGINT
TimeoutSec=120
Restart=always
RestartSec=5
UMask=0077

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now foremenhq-postgres
for _ in $(seq 1 30); do "$PG_BIN/pg_isready" -h localhost -p 5433 -q && break; sleep 1; done
"$PG_BIN/pg_isready" -h localhost -p 5433 -q || die "local PostgreSQL did not start"

rollback() {
  log "Rolling back: restarting ForemanHQ on Ubicloud"
  if [[ -f ".env.before-local-db-$STAMP" ]]; then cp ".env.before-local-db-$STAMP" .env; fi
  systemctl --user start foremenhq
}

log "Stopping ForemanHQ (maintenance window starts)"
systemctl --user stop foremenhq
trap 'rollback' ERR

DUMP="$BACKUP_DIR/ubicloud-cutover-$STAMP.dump"
log "Dumping Ubicloud database to $DUMP"
"$PG_BIN/pg_dump" "$REMOTE_URL" -Fc --no-owner --no-privileges -f "$DUMP"

log "Restoring into local database"
export PGPASSWORD="$(cat "$SECRETS/postgres-superuser-password")"
"$PG_BIN/psql" -h localhost -p 5433 -U postgres -v ON_ERROR_STOP=1 -q -d postgres \
  -c "drop database if exists foremenhq" -c "create database foremenhq owner foremenhq"
"$PG_BIN/psql" -h localhost -p 5433 -U postgres -v ON_ERROR_STOP=1 -q -d foremenhq \
  -c "alter schema public owner to foremenhq"
unset PGPASSWORD
"$PG_BIN/pg_restore" -d "$LOCAL_URL" --no-owner --no-privileges --exit-on-error "$DUMP"

log "Verifying exact row counts for every table"
count_sql="select format('select %L || count(*)::text from %I.%I;',
  table_schema || '.' || table_name || '=', table_schema, table_name)
  from information_schema.tables
  where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
  order by table_schema, table_name"
"$PG_BIN/psql" "$REMOTE_URL" -XAt -v ON_ERROR_STOP=1 -c "$count_sql" |
  "$PG_BIN/psql" "$REMOTE_URL" -XAt -v ON_ERROR_STOP=1 > "/tmp/foremenhq-counts-remote-$STAMP.txt"
"$PG_BIN/psql" "$LOCAL_URL" -XAt -v ON_ERROR_STOP=1 -c "$count_sql" |
  "$PG_BIN/psql" "$LOCAL_URL" -XAt -v ON_ERROR_STOP=1 > "/tmp/foremenhq-counts-local-$STAMP.txt"
if ! diff -u "/tmp/foremenhq-counts-remote-$STAMP.txt" "/tmp/foremenhq-counts-local-$STAMP.txt"; then
  die "row counts differ (see diff above)"
fi
echo "$(wc -l < "/tmp/foremenhq-counts-local-$STAMP.txt") tables match exactly"

log "Pointing .env at the local database"
cp .env ".env.before-local-db-$STAMP"
chmod 600 ".env.before-local-db-$STAMP"
python3 - "$LOCAL_URL" <<'PY'
import sys, re, pathlib
p = pathlib.Path(".env")
s = p.read_text()
s = re.sub(r'^DATABASE_URL=.*$', lambda m: f'DATABASE_URL="{sys.argv[1]}"', s, count=1, flags=re.M)
p.write_text(s)
PY
grep -q '^DATABASE_URL="postgresql://foremenhq:.*@localhost:5433/foremenhq"' .env || die ".env update failed"

# Keep the Ubicloud address for the nightly off-site backup.
printf '%s' "$REMOTE_URL" > "$SECRETS/ubicloud-database-url"
chmod 600 "$SECRETS/ubicloud-database-url"

log "Starting ForemanHQ on the local database"
systemctl --user start foremenhq
code=""
for _ in $(seq 1 40); do
  code="$(curl -s -o /tmp/foremenhq-health.json -w '%{http_code}' http://localhost:3000/api/health || true)"
  [[ "$code" == 200 ]] && break
  sleep 1
done
[[ "$code" == 200 ]] || die "health check failed after cutover (HTTP $code)"
grep -q '"database":"ok"' /tmp/foremenhq-health.json || die "database health not ok"
trap - ERR
cat /tmp/foremenhq-health.json; echo

log "Installing nightly backup timer"
cat > "$UNIT_DIR/foremenhq-db-backup.service" <<EOF
[Unit]
Description=ForemanHQ nightly database backup
After=foremenhq-postgres.service

[Service]
Type=oneshot
ExecStart=$APP_DIR/scripts/ops/nightly-db-backup.sh
EOF
cat > "$UNIT_DIR/foremenhq-db-backup.timer" <<EOF
[Unit]
Description=Run the ForemanHQ database backup nightly

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now foremenhq-db-backup.timer

log "Done. ForemanHQ now uses the local database."
echo "Previous .env: $APP_DIR/.env.before-local-db-$STAMP"
echo "Cutover dump:  $DUMP"
echo "Undo:          scripts/ops/rollback-database-ubicloud.sh"
