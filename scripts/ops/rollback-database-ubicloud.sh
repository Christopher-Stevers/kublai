#!/usr/bin/env bash
# Points ForemanHQ back at the Ubicloud database (undoes move-database-local.sh).
#
#   scripts/ops/rollback-database-ubicloud.sh [--no-copy]
#
# Changes made since the cutover live only in the local database, so by
# default this first copies the local database over Ubicloud; pass --no-copy
# to switch back without copying.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_DIR"
PREVIOUS_ENV="$(ls -1t .env.before-local-db-* 2>/dev/null | head -1)"
[[ -n "$PREVIOUS_ENV" ]] || { echo "No .env.before-local-db-* backup found" >&2; exit 1; }

systemctl --user stop foremenhq
if [[ "${1:-}" != "--no-copy" ]]; then
  "$APP_DIR/scripts/ops/nightly-db-backup.sh"
fi
cp "$PREVIOUS_ENV" .env
systemctl --user disable --now foremenhq-db-backup.timer 2>/dev/null || true
systemctl --user start foremenhq
sleep 5
curl -s http://localhost:3000/api/health; echo
echo "ForemanHQ is back on Ubicloud (.env restored from $PREVIOUS_ENV)."
