#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$script_dir/environment.sh"
. "$script_dir/start-container.sh"
docker rm -f "$APP_NAME" >/dev/null 2>&1 || true
cleanup_cgroup_mount "$APP_NAME"
image=$(cat "$STATE_DIR/current-image")
start_container "$APP_NAME" "$image" "$CONFIG_DIR/app.env"
# systemd recreates the container and its delegation after crashes or host reboot.
docker wait "$APP_NAME"
exit 1
