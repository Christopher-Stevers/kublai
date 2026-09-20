#!/bin/bash
set -eu

upload_id=${1:-}
case "$upload_id" in
  ????????-????-????-????-????????????) ;;
  *) echo "Invalid upload id" >&2; exit 64 ;;
esac

# Request process supplies the shared bounded budget; reject arbitrary overrides.
worker_seconds=${2:-600}
case "$worker_seconds" in
  600) ;;
  *) echo "Invalid worker time budget" >&2; exit 64 ;;
esac

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export NODE_ENV=production
export UV_THREADPOOL_SIZE=2
export DOTENV_CONFIG_PATH="$repo_root/.env"
current_cgroup=
while IFS=: read -r hierarchy _ cgroup_path; do
  if [ "$hierarchy" = "0" ]; then
    current_cgroup=$cgroup_path
    break
  fi
done < /proc/self/cgroup

if [ -z "$current_cgroup" ]; then
  echo "Unified cgroup path unavailable" >&2
  exit 70
fi

cgroup_parent=$(dirname "/sys/fs/cgroup$current_cgroup")
cgroup_dir="$cgroup_parent/foremenhq-upload-$upload_id"
mkdir -p "$cgroup_dir"
# Complex architectural pages can transiently require about 1.5 GiB in
# PDF.js/canvas. Per-page child isolation makes 2 GiB a hard per-page ceiling
# while preventing allocations from accumulating across the drawing set.
printf '%s\n' 2147483648 > "$cgroup_dir/memory.max"
printf '%s\n' 0 > "$cgroup_dir/memory.swap.max"
printf '%s\n' 64 > "$cgroup_dir/pids.max"
printf '%s\n' 1 > "$cgroup_dir/memory.oom.group"

cleanup() {
  rmdir "$cgroup_dir" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

(
  printf '%s\n' "$BASHPID" > "$cgroup_dir/cgroup.procs"
  ulimit -S -t "$((worker_seconds - 5))"
  ulimit -H -t "$worker_seconds"
  cd "$repo_root"
  exec /usr/bin/timeout --signal=KILL "$worker_seconds" \
    /usr/bin/nice -n 10 \
    /usr/bin/node --max-old-space-size=512 --expose-gc \
    --import dotenv/config \
    --import tsx \
    "$repo_root/src/server/rooms/upload-worker.ts" \
    "$upload_id"
) &
worker_pid=$!
set +e
wait "$worker_pid"
worker_status=$?
set -e
if [ "$worker_status" -ne 0 ]; then
  cat "$cgroup_dir/memory.events" >&2 || true
  cat "$cgroup_dir/pids.events" >&2 || true
fi
exit "$worker_status"
