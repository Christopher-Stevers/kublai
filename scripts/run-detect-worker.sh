#!/bin/bash
set -eu

floor_id=${1:-}
method=${2:-standard}
upload_id=${3:-}
case "$upload_id" in
  ????????-????-????-????-????????????) ;;
  *) echo "Invalid upload id" >&2; exit 64 ;;
esac

# Each queued drawing has its own bounded runtime.
worker_seconds=600
case "$worker_seconds" in
  600) ;;
  *) echo "Invalid worker time budget" >&2; exit 64 ;;
esac

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node_binary=${FOREMANHQ_NODE_BINARY:-$(command -v node || true)}
if [ -z "$node_binary" ] || [ ! -x "$node_binary" ]; then
  echo "Node runtime unavailable" >&2
  exit 70
fi
# Backstop the database lease across process death/floor deletion. A previous
# worker's native children may still be unwinding even after its parent exits.
# The inherited descriptor keeps CPU-heavy detection globally serialized.
lock_root=${XDG_RUNTIME_DIR:-/tmp}
exec 9>"$lock_root/foremanhq-room-detection-$UID.lock"
/usr/bin/flock 9

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
cgroup_dir="$cgroup_parent/foremenhq-detect-$upload_id"
mkdir -p "$cgroup_dir"
# Full-resolution hybrid tracing holds several native/typed pixel buffers in
# addition to the JavaScript heap. Keep a 4 GiB process ceiling; the global
# single-worker queue bounds detection to 4 GiB on this host.
printf '%s\n' 4294967296 > "$cgroup_dir/memory.max"
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
    "$node_binary" --max-old-space-size=768 --expose-gc \
    --import dotenv/config \
    --import tsx \
    "$repo_root/src/server/rooms/detect-worker.ts" \
    "$floor_id" "$method" "$upload_id"
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
