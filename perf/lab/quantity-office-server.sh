#!/usr/bin/env bash
set -euo pipefail
method=${PERF_QUANTITY_METHOD_ROOT:?Reviewed frozen supplemental method required}
role=${PERF_QUANTITY_ROLE:?}
result=${PERF_QUANTITY_ROLE_OUTPUT:?}
[[ "$method" == /tmp/foremanhq-quantity-office-method.* ]]
[[ "$result" == "/tmp/foremanhq-quantity-office-v1-attempt1/$role" ]]
case "$role" in
 baseline) snapshot=/tmp/foremanhq-speed-app-epcRJM; port=3485;;
 candidate) snapshot=/tmp/foremanhq-speed-app-mIZVko; port=3486;;
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
 node "$method/perf/lab/quantity-office-reuse.mjs" after || failed=1
 return "$failed"
}
cleanup() {
 local status=$? next_status=0 copy_failed=0
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
  "${PERF_PG_BIN:-/home/tim/.local/pgsql-18/bin}/pg_ctl" -D "$PERF_LAB_SOCKET/data" -m immediate -t 5 stop > "$result/pg-stop.log" 2>&1 || status=1
 else status=1;fi
 preserve || { copy_failed=1;status=1; }
 printf '{"inputExitCode":%s,"nextExitCode":%s,"copyFailed":%s,"finalExitCode":%s}\n' "$original_status" "$next_status" "$copy_failed" "$status" > "$result/cleanup.json" || status=1
 exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cp "$PERF_LAB_SOCKET/schema-inventory.json" "$result/schema-inventory-before.json"
node "$method/perf/lab/quantity-office-reuse.mjs"
export PERF_QUANTITY_SOURCE_EVIDENCE="$result/source-before.json" PERF_QUANTITY_ITEM_PROOF="$result/quantity-items.json"
node "$method/perf/lab/quantity-item-preflight.mjs"
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
