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
node_binary=${FOREMANHQ_NODE_BINARY:-$(command -v node || true)}
if [ -z "$node_binary" ] || [ ! -x "$node_binary" ]; then
  echo "Node runtime unavailable" >&2
  exit 70
fi
export NODE_ENV=production
export UV_THREADPOOL_SIZE=2
# Native image/OCR pools share the worker's task budget with Node, tsx and
# the per-page renderer. Limit their parallelism before native libraries load.
export VIPS_CONCURRENCY=1
export OMP_THREAD_LIMIT=1
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
# Dense architectural pages need more than a 512 MiB JavaScript heap.
# Allow a 1.5 GiB page heap plus native canvas/decoder and coordinator memory.
# Pages remain sequential and isolated within a hard 3 GiB process-tree cap.
printf '%s\n' 3221225472 > "$cgroup_dir/memory.max"
printf '%s\n' 0 > "$cgroup_dir/memory.swap.max"
# Linux counts threads here, not just processes. On the 28-core host the
# canvas renderer alone starts ~40 threads; 64 leaves too little headroom
# for the coordinator, tsx/esbuild and image encoding/OCR. Keep a bounded
# budget for that whole process tree while pages remain strictly sequential.
printf '%s\n' 128 > "$cgroup_dir/pids.max"
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
    "$node_binary" --max-old-space-size=512 --expose-gc \
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
