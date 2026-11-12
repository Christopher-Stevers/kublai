#!/usr/bin/env bash
# Disposable receiving service validation. Never imports production DB wiring.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [[ ${1:-} != --clean-env ]]; then
  exec env -i HOME="$HOME" USER="$(id -un)" PATH=/home/tim/.local/share/mise/installs/node/26.8.2/bin:/usr/bin:/bin LANG=C.UTF-8 \
    bash "$here/service-private.sh" --clean-env "$@"
fi
shift
tree=${1:?Explicit validation-only source tree required}
evidence=${2:?New absolute evidence path required}
expected=${3:?Reviewed service-method.json SHA required}
[[ "$evidence" = /* && ! -e "$evidence" ]] || { echo 'New absolute evidence path required' >&2; exit 1; }
mkdir -m 700 -p "$evidence"
evidence=$(realpath "$evidence")
# Verify operational files before PG/test startup; no environment secrets recorded.
node --input-type=module - "$here" "$expected" "$evidence" <<'JS'
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
const [root,expected,out]=process.argv.slice(2),sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=fs.readFileSync(path.join(root,'service-method.json'));assert.equal(sha(bytes),expected);
const manifest=JSON.parse(bytes);for(const [name,hash]of Object.entries(manifest.files))assert.equal(sha(fs.readFileSync(path.resolve(root,name))),hash,name);
fs.writeFileSync(path.join(out,'service-method.json'),bytes,{flag:'wx'});
JS
repo=$(realpath "$here/../..")
pg_bin=/home/tim/.local/pgsql-18/bin
socket=$(mktemp -d /tmp/foremanhq-purchase-pg.XXXXXX)
record="$evidence/owned-tests.json"
prepared=0
cleanup() {
  local original=$? status=$? stop_failed=0 copy_failed=0 source_failed=0
  trap - EXIT INT TERM
  status=$original
  python3 "$repo/perf/lab/owned-process-supervisor.py" stop --record "$record" || status=1
  if [[ -f "$socket/data/postmaster.pid" ]]; then
    timeout --kill-after=2s 10s "$pg_bin/pg_ctl" -D "$socket/data" -m fast -w -t 7 stop >"$evidence/pg-stop.log" 2>&1 || {
      timeout --kill-after=2s 10s "$pg_bin/pg_ctl" -D "$socket/data" -m immediate -w -t 7 stop >>"$evidence/pg-stop.log" 2>&1 || stop_failed=1
    }
  fi
  if [[ -f "$socket/data/postmaster.pid" || -S "$socket/.s.PGSQL.55461" ]]; then stop_failed=1; fi
  for name in init.log server.log owner.json; do
    if [[ -f "$socket/$name" ]]; then cp "$socket/$name" "$evidence/$name" || copy_failed=1; else copy_failed=1; fi
  done
  if [[ -f "$evidence/source-before.json" ]]; then node "$here/service-prepare.mjs" finish "$tree" "$evidence" || source_failed=1; fi
  python3 - "$evidence" "$socket" "$original" "$stop_failed" "$copy_failed" "$source_failed" <<'PY' || status=1
import json,pathlib,sys
out=pathlib.Path(sys.argv[1]);socket=pathlib.Path(sys.argv[2])
log=out/'server.log';lines=log.read_text().splitlines() if log.is_file() else []
errors=[line for line in lines if 'ERROR:' in line or 'FATAL:' in line or 'PANIC:' in line]
owner=json.loads((out/'owner.json').read_text()) if (out/'owner.json').is_file() else {}
pid=owner.get('postmasterPid');proc=pathlib.Path('/proc',str(pid))
state=proc.joinpath('stat').read_text().rsplit(')',1)[1].split()[0] if proc.exists() else None
absent=bool(pid) and not proc.exists();nonlive=bool(pid) and (absent or state=='Z')
expected=[line for line in errors if 'ERROR:  23514: new row for relation \"kublai_packing_slip_review_history\" violates check constraint \"block_confirmation\"' in line]
unexpected=[line for line in errors if line not in expected]
result={'originalExitCode':int(sys.argv[3]),'pgStopFailed':int(sys.argv[4]),'copyFailed':int(sys.argv[5]),'sourceCheckFailed':int(sys.argv[6]),'postmasterPid':pid,'postmasterAbsent':absent,'postmasterState':state,'postmasterNonlive':nonlive,'socketAbsent':not (socket/'.s.PGSQL.55461').exists(),'expectedRollback23514Count':len(expected),'unexpectedPGErrors':len(unexpected),'finalPGLogPreserved':log.is_file()}
(out/'pg-errors.json').write_text(json.dumps(errors,indent=2))
(out/'cleanup-before-remove.json').write_text(json.dumps(result,indent=2))
if not nonlive or not log.is_file() or len(expected)!=1 or unexpected or any(int(v) for v in sys.argv[4:7]):sys.exit(1)
PY
  if (( stop_failed || copy_failed || source_failed )); then status=1; fi
  # Retain all original private data/log evidence if preservation/cleanup failed.
  if (( status == 0 )); then rm -rf -- "$socket" || status=1; fi
  printf '{"exitCode":%s,"socketRemoved":%s,"retainedPrivateDirectory":"%s"}\n' "$status" "$([[ ! -e "$socket" ]] && echo true || echo false)" "$([[ -e "$socket" ]] && echo "$socket" || true)" > "$evidence/final-cleanup.json"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node "$here/service-prepare.mjs" prepare "$tree" "$evidence"
prepared=1
printf '{"socket":"%s","user":"receiving_rc_fixture"}\n' "$socket" > "$socket/owner.json"
timeout --kill-after=2s 30s "$pg_bin/initdb" -D "$socket/data" -U receiving_rc_fixture --auth=trust --no-locale --encoding=UTF8 >"$socket/init.log" 2>&1
timeout --kill-after=2s 15s "$pg_bin/pg_ctl" -D "$socket/data" -l "$socket/server.log" -o "-h '' -k $socket -p 55461 -c log_error_verbosity=verbose" -w -t 12 start >"$evidence/pg-start.log" 2>&1
python3 - "$socket" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1]);f=p/'owner.json';v=json.loads(f.read_text());v['postmasterPid']=int((p/'data/postmaster.pid').read_text().splitlines()[0]);f.write_text(json.dumps(v))
PY
timeout --kill-after=2s 10s "$pg_bin/createdb" -h "$socket" -p 55461 -U receiving_rc_fixture purchase_integration
export PURCHASE_TEST_SOCKET="$socket" RECEIVING_RC_EVIDENCE="$evidence"
cd "$tree"
python3 "$repo/perf/lab/owned-process-supervisor.py" run --record "$record" --seconds 300 -- \
  ./node_modules/.bin/vitest run --config receiving-rc-private.vitest.mts --reporter=verbose >"$evidence/test.log" 2>&1
[[ -f "$evidence/actual-client.json" ]] || { echo 'Actual fixture client identity evidence missing' >&2; exit 1; }
