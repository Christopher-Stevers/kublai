#!/usr/bin/env bash
set -euo pipefail
. /opt/foremanhq/start-container.sh
docker rm -f foremanhq >/dev/null 2>&1 || true
cleanup_cgroup_mount foremanhq
image=$(cat /var/lib/foremanhq/current-image)
start_container foremanhq "$image" /etc/foremanhq/app.env
# systemd recreates the container and its delegation after crashes or host reboot.
docker wait foremanhq
exit 1
