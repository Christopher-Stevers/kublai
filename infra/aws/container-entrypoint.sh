#!/usr/bin/env bash
set -euo pipefail
# The deployer delegates only this container's own bounded cgroup subtree.
# Waiting prevents application processes from racing the host's initial move.
if [[ ${FOREMANHQ_CGROUP_ROOT:-} ]]; then
  for attempt in $(seq 1 60); do
    if [[ -w "$FOREMANHQ_CGROUP_ROOT/workers/cgroup.procs" ]]; then
      exec "$@"
    fi
    sleep 1
  done
  echo 'Container cgroup delegation was not prepared' >&2
  exit 70
fi
exec "$@"
