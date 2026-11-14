#!/usr/bin/env bash
# Sourced by deploy.sh on the host. Never delegate host-wide cgroups or Docker.
seed_catalogue_uploads() (
  # Keep customer uploads, while exposing new bundled images after a release.
  local image=$1 destination=$2 temporary seed=""
  temporary=$(mktemp -d)
  trap '[[ -z "$seed" ]] || docker rm "$seed" >/dev/null; rm -rf -- "$temporary"' EXIT
  seed=$(docker create "$image")
  docker cp "$seed:/app/public/images/catalog/uploads/." "$temporary/"
  cp -an "$temporary/." "$destination/"
  chown -R 1000:1000 "$destination"
)

start_container() {
  local name=$1 image=$2 env_file=$3
  local network=foremanhq uploads=/srv/foremanhq/uploads shares=1024 reservation=1024m oom_score=-250
  local -a catalogue_mount=()
  if [[ "${DEPLOY_ENVIRONMENT:-production}" == development ]]; then
    network=foremanhq-dev uploads=/srv/foremanhq/dev/uploads shares=256 reservation=128m oom_score=500
    # A migrated catalogue includes customer uploads outside the release image.
    # Only mount a fully populated directory prepared by the migration process.
    if [[ -d /srv/foremanhq/dev/catalogue-uploads ]]; then
      seed_catalogue_uploads "$image" /srv/foremanhq/dev/catalogue-uploads
      catalogue_mount=(--mount "type=bind,src=/srv/foremanhq/dev/catalogue-uploads,dst=/app/public/images/catalog/uploads")
    fi
  fi
  local mount_root="/run/foremanhq-cgroups/$name"
  install -d -m 755 "$mount_root"
  # Propagate just the cgroup submount into the unprivileged container.
  mountpoint -q "$mount_root" || mount --bind "$mount_root" "$mount_root"
  mount --make-shared "$mount_root"
  install -d -m 755 "$mount_root/delegated"
  docker run -d --name "$name" --network "$network" \
    --restart no --env-file "$env_file" \
    --cgroup-parent foremanhq.slice --cpu-shares "$shares" --memory-reservation "$reservation" \
    --memory 3200m --memory-swap 3200m --oom-score-adj "$oom_score" --pids-limit 256 \
    --security-opt no-new-privileges --cap-drop ALL \
    -e DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:-production}" \
    -e FOREMANHQ_CGROUP_ROOT=/run/foremanhq-cgroup/delegated \
    --mount "type=bind,src=$mount_root,dst=/run/foremanhq-cgroup,bind-propagation=rslave" \
    --mount "type=bind,src=$uploads,dst=/app/uploads" \
    "${catalogue_mount[@]}" \
    "$image" >/dev/null
  local pid group root
  pid=$(docker inspect --format '{{.State.Pid}}' "$name")
  group=$(awk -F: '$1 == "0" {print $3}' "/proc/$pid/cgroup")
  [[ "$group" == /foremanhq.slice/docker-*.scope ]] || { echo 'Unexpected Docker cgroup layout' >&2; return 1; }
  root="/sys/fs/cgroup$group"
  mkdir -p "$root/web" "$root/workers"
  # Drain the root before enabling domain controllers (cgroup v2 no-internal-process rule).
  for attempt in $(seq 1 20); do
    while read -r pid; do
      echo "$pid" > "$root/web/cgroup.procs" 2>/dev/null || true
    done < "$root/cgroup.procs"
    [[ ! -s "$root/cgroup.procs" ]] && [[ -z $(cat "$root/cgroup.procs") ]] && break
  done
  echo '+memory +pids' > "$root/cgroup.subtree_control"
  echo max > "$root/web/memory.max"
  echo 2147483648 > "$root/workers/memory.max"
  echo 0 > "$root/workers/memory.swap.max"
  echo 64 > "$root/workers/pids.max"
  echo 1 > "$root/workers/memory.oom.group"
  echo '+memory +pids' > "$root/workers/cgroup.subtree_control"
  # Only delegation control files and the workers directory belong to UID 1000.
  # Parent limits remain root-owned and cannot be raised by the application.
  chown 1000:1000 "$root/cgroup.procs" "$root/workers" "$root/workers/cgroup.procs" "$root/workers/cgroup.subtree_control" "$root/workers/cgroup.threads"
  mount --bind "$root" "$mount_root/delegated"
}
cleanup_cgroup_mount() {
  local mount_root="/run/foremanhq-cgroups/$1"
  mountpoint -q "$mount_root/delegated" && umount "$mount_root/delegated"
  mountpoint -q "$mount_root" && umount "$mount_root"
  return 0
}
