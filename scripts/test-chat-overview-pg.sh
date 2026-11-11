#!/usr/bin/env bash
# Source-bound thin proof. No DATABASE_URL, app, worker, schema release or timing.
set -euo pipefail
unset NODE_OPTIONS
while IFS= read -r inherited_pg_name; do unset "$inherited_pg_name"; done < <(compgen -v PG)
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
manifest="$repo_root/perf/live/chat-overview-pg-source.json"
expected=${1:?Pass reviewed manifest SHA256}
evidence=${2:?Pass new evidence directory}
[[ ! -e "$evidence" ]] || { echo 'Evidence directory already exists' >&2; exit 1; }
mkdir -m 700 -p "$evidence"
evidence=$(realpath "$evidence")
cd "$repo_root"
node perf/live/chat-overview-source-guard.mjs "$manifest" "$expected" "$evidence/source-before.json"
cp "$manifest" "$evidence/source-manifest.json"
pg_bin=/home/tim/.local/pgsql-18/bin
socket=$(mktemp -d /tmp/foremanhq-chat-overview-pg.XXXXXX)
record="$evidence/owned-processes.json"
cleanup() {
  local original=$? status=$? stop_failed=0 copy_failed=0
  trap - EXIT INT TERM
  status=$original
  python3 perf/lab/owned-process-supervisor.py stop --record "$record" || status=1
  local pg_pid=""
  if [[ -f "$socket/data/postmaster.pid" ]]; then
    read -r pg_pid < "$socket/data/postmaster.pid"
    timeout --kill-after=2s 8s "$pg_bin/pg_ctl" -D "$socket/data" -m fast -w -t 5 stop >"$evidence/pg-stop.log" 2>&1 || {
      timeout --kill-after=2s 8s "$pg_bin/pg_ctl" -D "$socket/data" -m immediate -w -t 5 stop >>"$evidence/pg-stop.log" 2>&1 || stop_failed=1
    }
  fi
  if [[ -f "$socket/data/postmaster.pid" ]]; then stop_failed=1; fi
  if [[ -n "$pg_pid" ]] && kill -0 "$pg_pid" 2>/dev/null; then stop_failed=1; fi
  for item in server.log init.log owner.json; do
    if [[ -f "$socket/$item" ]]; then cp "$socket/$item" "$evidence/$item" || copy_failed=1; else copy_failed=1; fi
  done
  node perf/live/chat-overview-source-guard.mjs "$manifest" "$expected" "$evidence/source-after.json" || status=1
  local errors=0
  python3 - "$evidence" "$original" "$stop_failed" "$copy_failed" "$socket" <<'PY' || errors=$?
import json,pathlib,sys
p=pathlib.Path(sys.argv[1]);expected=(p/'expected-error.json').exists()
log_available=(p/'server.log').is_file()
lines=(p/'server.log').read_text().splitlines() if log_available else []
errors=[s for s in lines if 'ERROR:' in s or 'FATAL:' in s]
known=[s for s in errors if '42501: permission denied for function pg_notify' in s]
unexpected=[s for s in errors if '42501: permission denied for function pg_notify' not in s or not expected]
result={'originalExitCode':int(sys.argv[2]),'pgStopFailed':int(sys.argv[3]),'copyFailed':int(sys.argv[4]),'socket':sys.argv[5],'expected42501Count':len(known),'unexpectedErrorCount':len(unexpected),'expectedErrorProofPresent':expected,'finalPGLogAvailable':log_available}
(p/'cleanup-before-remove.json').write_text(json.dumps(result,indent=2))
(p/'unexpected-errors.json').write_text(json.dumps(unexpected,indent=2))
if not log_available or unexpected or (expected and len(known)!=1):sys.exit(1)
PY
  if (( stop_failed || copy_failed || errors )); then status=1; fi
  if (( ! stop_failed && ! copy_failed && ! errors )); then rm -rf -- "$socket" || status=1; fi
  if [[ -e "$socket" ]]; then status=1; fi
  printf '{"finalExitCode":%s,"socketRemoved":%s}\n' "$status" "$([[ ! -e "$socket" ]] && echo true || echo false)" > "$evidence/final-cleanup.json"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '{"pid":%s,"socket":"%s","port":55471,"database":"chat_overview_proof"}\n' "$$" "$socket" > "$socket/owner.json"
timeout --kill-after=3s 30s "$pg_bin/initdb" -D "$socket/data" --auth=trust --no-locale --encoding=UTF8 >"$socket/init.log" 2>&1
timeout --kill-after=2s 13s "$pg_bin/pg_ctl" -D "$socket/data" -l "$socket/server.log" -o "-h '' -k $socket -p 55471 -c log_error_verbosity=verbose" -w -t 10 start >/dev/null
timeout --kill-after=3s 10s "$pg_bin/createdb" -h "$socket" -p 55471 chat_overview_proof
export CHAT_OVERVIEW_TEST_SOCKET="$socket" CHAT_OVERVIEW_EVIDENCE="$evidence"
unset DATABASE_URL PERF_LAB_DATABASE_URL
python3 perf/lab/owned-process-supervisor.py run --record "$record" --seconds 150 -- \
  ./node_modules/.bin/vitest run --config perf/live/chat-overview-pg-proof.vitest.mts --reporter=verbose \
  >"$evidence/test.log" 2>&1
