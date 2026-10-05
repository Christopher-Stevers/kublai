#!/bin/bash
# Makes Drawings tiles for one upload in a bounded cgroup (see run-upload-worker.sh).
set -eu

job_id=${1:-}
upload_id=${2:-}
for id in "$job_id" "$upload_id"; do
  case "$id" in
    ????????-????-????-????-????????????) ;;
    *) echo "Invalid id" >&2; exit 64 ;;
  esac
done
worker_seconds=1800

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node_binary=${FOREMANHQ_NODE_BINARY:-$(command -v node || true)}
if [ -z "$node_binary" ] || [ ! -x "$node_binary" ]; then
  echo "Node runtime unavailable" >&2
  exit 70
fi
export NODE_ENV=production
export UV_THREADPOOL_SIZE=4
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
cgroup_dir="$cgroup_parent/foremenhq-tiles-$upload_id"
mkdir -p "$cgroup_dir"
# Three pages at a time, each up to ~1 GiB for PDF.js/canvas plus tile encoding.
printf '%s\n' 3221225472 > "$cgroup_dir/memory.max"
printf '%s\n' 0 > "$cgroup_dir/memory.swap.max"
# Counts threads too: Node, libvips (sharp) and the canvas library each start several.
printf '%s\n' 512 > "$cgroup_dir/pids.max"

cleanup() {
  rmdir "$cgroup_dir" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

(
  printf '%s\n' "$BASHPID" > "$cgroup_dir/cgroup.procs"
  cd "$repo_root"
  exec /usr/bin/timeout --signal=KILL "$worker_seconds" \
    /usr/bin/nice -n 15 \
    "$node_binary" --max-old-space-size=256 \
    --import dotenv/config \
    --import tsx \
    "$repo_root/src/server/rooms/tile-worker.ts" \
    "$job_id" "$upload_id"
)
