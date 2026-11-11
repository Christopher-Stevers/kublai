#!/usr/bin/env bash
set -euo pipefail
method=${PERF_FAILED_CELLS_METHOD_ROOT:?Reviewed frozen supplemental method required}
role=${PERF_FAILED_CELLS_ROLE:?}
result=${PERF_FAILED_CELLS_ROLE_OUTPUT:?}
[[ "$method" == /tmp/foremanhq-failed-cells-method.* ]]
[[ "$result" == "/tmp/foremanhq-failed-cells-v1-attempt1/$role" ]]
case "$role" in
 baseline) snapshot=/tmp/foremanhq-speed-app-5h2kmq; port=3485;;
 candidate) snapshot=/tmp/foremanhq-speed-app-PSljsn; port=3486;;
 *) exit 1;;
esac
server_pid=
server_owner=
preserve() {
 local failed=0
 [[ "${PERF_LAB_SOCKET:-}" == /tmp/foremanhq-perf-pg.* ]] || return 1
 for name in schema-inventory.json server.log;do
  cp "$PERF_LAB_SOCKET/$name" "$result/pg-$name" || failed=1
 done
 cp "$PERF_LAB_FIXTURES" "$result/fixtures-after.json" || failed=1
 node "$method/perf/lab/failed-cells-reuse.mjs" after || failed=1
 return "$failed"
}
cleanup() {
 local status=$? next_status=0 copy_failed=0 pg_stopped=0
 local original_status=$status
 trap - EXIT
 if [[ -n "$server_pid" ]];then
  python3 "$method/perf/lab/owned-process-supervisor.py" stop --record "$result/next-processes.json" || status=1
  if [[ -n "$server_owner" ]];then wait "$server_owner" || next_status=$?;fi
  if [[ "$next_status" != 0 && "$next_status" != 143 ]];then status=1;fi
 fi
 # This child owns this exact freshly created data directory. Stop PG before
 # preserving its final log; unchanged database.sh cleanup is idempotent later.
 if [[ "${PERF_LAB_SOCKET:-}" == /tmp/foremanhq-perf-pg.* ]];then
  if timeout --kill-after=2s 8s "${PERF_PG_BIN:-/home/tim/.local/pgsql-18/bin}/pg_ctl" -D "$PERF_LAB_SOCKET/data" -m immediate -t 5 stop > "$result/pg-stop.log" 2>&1 && [[ ! -f "$PERF_LAB_SOCKET/data/postmaster.pid" ]];then pg_stopped=1;else status=1;fi
 else status=1;fi
 preserve || { copy_failed=1;status=1; }
 # A failed copy must not let unchanged database.sh delete the only raw evidence.
 # Rename this owned STOPPED cluster on the same filesystem; parent cleanup then
 # finds no old path. No rename of a live PG cluster is permitted.
 if [[ "$copy_failed" == 1 && "$pg_stopped" == 1 ]];then
  mv -- "$PERF_LAB_SOCKET" "$result/failed-evidence-raw-pg" || status=1
 fi
 printf '{"inputExitCode":%s,"nextExitCode":%s,"copyFailed":%s,"finalExitCode":%s}\n' "$original_status" "$next_status" "$copy_failed" "$status" > "$result/cleanup.json" || status=1
 exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cp "$PERF_LAB_SOCKET/schema-inventory.json" "$result/schema-inventory-before.json"
# Both frozen seed asset copies must finish before either retained app is refreshed.
touch "$result/seed-complete"
for attempt in $(seq 1 120);do
 [[ -f /tmp/foremanhq-failed-cells-v1-attempt1/baseline/seed-complete && -f /tmp/foremanhq-failed-cells-v1-attempt1/candidate/seed-complete ]] && break
 sleep 0.5
done
[[ -f /tmp/foremanhq-failed-cells-v1-attempt1/baseline/seed-complete && -f /tmp/foremanhq-failed-cells-v1-attempt1/candidate/seed-complete ]]
printf '{"bothSeedsCompleteBeforeRefresh":true}\n' > "$result/seed-copy-barrier.json"

node "$method/perf/lab/failed-cells-reuse.mjs"
export PERF_QUANTITY_SOURCE_EVIDENCE="$result/source-before.json" PERF_QUANTITY_ITEM_PROOF="$result/quantity-items.json"
node "$method/perf/lab/failed-cells-item-preflight.mjs"
export FOREMANHQ_BACKGROUND_MODE=separate BIM_WORKER_DISABLED=1 SKIP_ENV_VALIDATION=1
export CLERK_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_speed_lab_only
export STRIPE_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_speed_lab_only
export PORT="$port" PERF_BUILD=$(cat "$snapshot/.next/BUILD_ID") PERF_FIXTURES="$snapshot/perf/fixtures.json" PERF_LOG_DIR="$result/numeric-telemetry"
unset NEXT_DIST_DIR NEXT_TSCONFIG_PATH FOREMANHQ_RUNTIME_DIR FOREMANHQ_PUBLIC_DIR
cd "$snapshot"
python3 "$method/perf/lab/owned-process-supervisor.py" run --seconds 400 --record "$result/next-processes.json" --pid-file "$result/server.pid" -- ./node_modules/.bin/next start --hostname 127.0.0.1 --port "$port" > "$result/server.log" 2>&1 &
server_owner=$!
for attempt in $(seq 1 50);do [[ -f "$result/server.pid" ]] && break;kill -0 "$server_owner" 2>/dev/null || exit 1;sleep 0.1;done
server_pid=$(cat "$result/server.pid")
for attempt in $(seq 1 90);do
 if curl -fsS "http://127.0.0.1:$port/api/perf-lab" >/dev/null 2>&1;then break;fi
 kill -0 "$server_pid" 2>/dev/null || exit 1
 sleep 1
done
PERF_BASE_URL="http://127.0.0.1:$port" node "$PERF_HARNESS_DIR/perf/preflight.mjs"
cp "$snapshot/preflight.json" "$result/preflight.json"
touch "$result/ready"
wait "$server_owner"
