#!/usr/bin/env bash
# Initialize a NEW named volume only. Never starts the editor or replaces a volume.
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: bash install-volume.sh /private/path/config.tar" >&2
  exit 2
fi
collabora_image='collabora/code@sha256:4e983196eb9878f339cc506c38c21f1cc3473bca3d6de883c5de08f9c0cc3a6c'
collabora_volume='foremanhq-collabora-config'
if docker volume inspect "$collabora_volume" >/dev/null 2>&1; then
  echo "Refusing to replace existing $collabora_volume. Preserve its proof key and review any configuration update separately." >&2
  exit 1
fi
docker image inspect "$collabora_image" >/dev/null
docker volume create "$collabora_volume" >/dev/null
collabora_container=''
cleanup() {
  if [[ -n "$collabora_container" ]]; then
    docker rm "$collabora_container" >/dev/null
  fi
}
trap cleanup EXIT
collabora_container=$(docker create --mount "type=volume,src=$collabora_volume,dst=/etc/coolwsd" "$collabora_image")
# -a retains numeric UID/GID 1001 in the archive; rootless Docker maps them to
# subordinate host IDs. There is no shell/chown dependency inside the image.
docker cp -a - "$collabora_container:/etc/coolwsd" < "$1"
echo "Initialized $collabora_volume. The editor was not started."
