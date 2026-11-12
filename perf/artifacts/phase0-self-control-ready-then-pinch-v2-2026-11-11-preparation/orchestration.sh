#!/usr/bin/env bash
# Phase0 control single-capture operational guards/evidence copying; immutable timing harness unchanged.
set -euo pipefail
# Freeze a copy before execution; run under perf/lab/database.sh.
harness_root=${PERF_HARNESS_DIR:?Freeze the timing harness first}
[[ "${PERF_REUSE_SNAPSHOT:-}" == /tmp/foremanhq-speed-app-5h2kmq ]] || { printf "%s\n" "Explicit Phase0 control compiled reuse required; rebuild needs separate authorization"; exit 1; }
unset PERF_PILOT PERF_LINKS PERF_JOURNEYS PERF_RUNS
: "${PERF_BASELINE_DIST:?Set actual previous canonical release build directory}"
: "${PERF_SOURCE_BUILD_DIST:?Set actual canonical source release build directory}"
if [[ -n "${PERF_REUSE_SNAPSHOT:-}" ]]; then
  snapshot=$(node /tmp/foremanhq-phase0-control-reuse-frozen-app.mjs)
else
  snapshot=$(node "$harness_root/perf/create-lab-snapshot.mjs")
fi
export FOREMANHQ_BACKGROUND_MODE=separate BIM_WORKER_DISABLED=1 SKIP_ENV_VALIDATION=1
export CLERK_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_speed_lab_only
export STRIPE_SECRET_KEY=sk_test_speed_lab_only NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_speed_lab_only
export NEXT_PUBLIC_BUILD_ID=isolated-speed-baseline
unset NEXT_DIST_DIR NEXT_TSCONFIG_PATH FOREMANHQ_RUNTIME_DIR FOREMANHQ_PUBLIC_DIR
export PERF_LOG_DIR="$snapshot/data/perf"
export PERF_FIXTURES="$snapshot/perf/fixtures.json"
cd "$snapshot"
printf '%s\n' "$snapshot" > /tmp/foremanhq-speed-full-snapshot
if [[ -z "${PERF_REUSE_SNAPSHOT:-}" ]]; then
  ./node_modules/.bin/next build --webpack > "$snapshot/build.log" 2>&1 || { tail -80 "$snapshot/build.log"; exit 1; }
fi
export PERF_BUILD=$(cat .next/BUILD_ID)
export PERF_BASE_URL=http://127.0.0.1:3481 PERF_JOURNEY_ADAPTER="$harness_root/perf/journeys.mjs"
server_pid=
cleanup() {
  local shutdown_status=0
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || shutdown_status=$?
    printf '{"pid":%s,"exitCode":%s}\n' "$server_pid" "$shutdown_status" >> "$PERF_RUN_EVIDENCE_DIR/server-shutdowns.jsonl" || return 1
    [[ "$shutdown_status" == 0 || "$shutdown_status" == 143 ]] || return 1
  fi
  return 0
}
preserve_evidence() {
  local destination=${PERF_RUN_EVIDENCE_DIR:?}
  local failed=0
  [[ "$destination" == /tmp/foremanhq-phase0-control-full-v2-evidence ]] || return 1
  [[ "${PERF_LAB_SOCKET:-}" == /tmp/foremanhq-perf-pg.* ]] || return 1
  # Explicit status handling: callers may invoke this function in an OR-list,
  # where bash disables errexit even inside the function. Try all safe copies.
  cp "$PERF_LAB_SOCKET/schema-inventory.json" "$destination/schema-inventory.json" || failed=1
  cp "$PERF_LAB_SOCKET/server.log" "$destination/private-pg-before-helper-shutdown.log" || failed=1
  cp "$PERF_LAB_FIXTURES" "$destination/fixtures.json" || failed=1
  for name in preflight.json source-evidence.json idle.json static-bytes.json lab-static-bytes.json static.json control.json control-comparison.txt server.log; do
    if [[ -f "$snapshot/$name" ]]; then
      cp "$snapshot/$name" "$destination/$name" || failed=1
    fi
  done
  node /tmp/foremanhq-phase0-control-source-after.mjs || failed=1
  return "$failed"
}
final_cleanup() {
  local status=$? copy_failed=0 shutdown_failed=0
  local original_status=$status
  trap - EXIT
  cleanup || { shutdown_failed=1;status=1; }
  preserve_evidence || { printf '%s\n' 'THIS_RUN_EVIDENCE_COPY_FAILED' >&2;copy_failed=1;status=1; }
  printf '{"inputExitCode":%s,"shutdownFailed":%s,"evidenceCopyFailed":%s,"finalExitCode":%s}\n' "$original_status" "$shutdown_failed" "$copy_failed" "$status" > "$PERF_RUN_EVIDENCE_DIR/final-cleanup.json" || status=1
  exit "$status"
}
trap final_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Preserve exact schema/fixture identity immediately, even if later preflight fails.
cp "$PERF_LAB_SOCKET/schema-inventory.json" "$PERF_RUN_EVIDENCE_DIR/schema-inventory-before.json"
cp "$PERF_LAB_FIXTURES" "$PERF_RUN_EVIDENCE_DIR/fixtures-before.json"
cp "$snapshot/source-evidence.json" "$PERF_RUN_EVIDENCE_DIR/source-evidence-before.json"
start_server() {
  ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3481 >> "$snapshot/server.log" 2>&1 &
  server_pid=$!
  for attempt in $(seq 1 120); do
    if curl -fsS http://127.0.0.1:3481/api/perf-lab > /dev/null 2>&1; then return; fi
    sleep 1
  done
  tail -50 "$snapshot/server.log"; exit 1
}
node "$harness_root/scripts/release/static-metrics.mjs" "$PERF_SOURCE_BUILD_DIST" "$PERF_BASELINE_DIST" > "$snapshot/static-bytes.json"
node --input-type=module -e 'import fs from"node:fs";const actual=JSON.parse(fs.readFileSync("static-bytes.json")),baseline=JSON.parse(fs.readFileSync(process.env.PERF_COMPARISON_BASELINE));for(const k of ["build","sharedGzipBytes","screenGzipBytes","deployGzipBytes"])if(actual[k]!==baseline.static[k])throw Error("Original Phase0 static reference differs: "+k);fs.writeFileSync(process.env.PERF_RUN_EVIDENCE_DIR+"/static-reference-check.json",JSON.stringify({actual,matchedOriginalBaseline:true},null,2));'
node "$harness_root/scripts/release/static-metrics.mjs" "$snapshot/.next" "$PERF_BASELINE_DIST" > "$snapshot/lab-static-bytes.json"
start_server
node "$harness_root/perf/preflight.mjs"
node /tmp/foremanhq-phase0-control-only-guard.mjs > "$PERF_RUN_EVIDENCE_DIR/effective-environment-before-idle.json"
PERF_IDLE_OUTPUT="$snapshot/idle.json" node "$harness_root/perf/idle.mjs"
node --input-type=module -e 'import fs from "node:fs";const bytes=JSON.parse(fs.readFileSync("static-bytes.json"));const idle=JSON.parse(fs.readFileSync("idle.json"));if(bytes.build!==idle.sourceBuild)throw Error("Canonical static and idle source build mismatch");fs.writeFileSync("static.json",JSON.stringify({...bytes,idlePolls:idle.idlePolls,idleEvidence:idle},null,2));'
export PERF_STATIC_REPORT="$snapshot/static.json"
# Single candidate capture; timing/seed/auth/preflight code remains sealed.
: "${PERF_COMPARISON_BASELINE:?Predeclare accepted first baseline report}"
cleanup; server_pid=
node "$harness_root/perf/lab/reset-writes.mjs"
start_server
node /tmp/foremanhq-phase0-control-only-guard.mjs > "$PERF_RUN_EVIDENCE_DIR/effective-environment-before-matrix.json"
PERF_OUTPUT="$snapshot/control.json" node "$harness_root/perf/run.mjs"
printf '%s\n' "Independent complete candidate capture finished."
node "$harness_root/perf/check.mjs" --baseline "$PERF_COMPARISON_BASELINE" --report "$snapshot/control.json" > "$snapshot/control-comparison.txt" 2>&1 || { cat "$snapshot/control-comparison.txt"; exit 1; }
cat "$snapshot/control-comparison.txt"
printf '%s\n' "CONTROL ONLY: not release evidence and never clears R20."
