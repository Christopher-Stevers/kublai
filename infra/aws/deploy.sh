#!/usr/bin/env bash
# Run by SSM on the dedicated ForemanHQ EC2 host. Never print runtime secrets.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
. "$script_dir/environment.sh"
image=${1:?image digest required}
[[ "$image" =~ ^337658133209\.dkr\.ecr\.us-east-2\.amazonaws\.com/foremanhq@sha256:[a-f0-9]{64}$ ]] || exit 64
exec 9>/run/foremanhq-deploy.lock
flock -w 600 9
mountpoint -q /srv/foremanhq
install -d -m 700 "$CONFIG_DIR" "$STATE_DIR"
umask 077
env_file=$(mktemp $CONFIG_DIR/env.XXXXXX)
migration_env=$(mktemp $CONFIG_DIR/migration.XXXXXX)
cleanup() {
  rm -f "$env_file" "$migration_env"
  docker rm -f "$APP_NAME-candidate" >/dev/null 2>&1 || true
  if declare -F cleanup_cgroup_mount >/dev/null; then cleanup_cgroup_mount "$APP_NAME-candidate"; fi
}
trap cleanup EXIT
aws ssm get-parameter --region us-east-2 --name "$PARAMETER_PREFIX/app-env" --with-decryption --query Parameter.Value --output text > "$env_file"
for key in DATABASE_URL CLERK_SECRET_KEY STRIPE_SECRET_KEY; do
  grep -q "^${key}=.\+" "$env_file" || { echo "Missing runtime setting: $key" >&2; exit 1; }
done
aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin "${image%%/*}"
docker pull "$image"
aws ssm get-parameter --region us-east-2 --name "$PARAMETER_PREFIX/migration-env" --with-decryption --query Parameter.Value --output text > "$migration_env"
# Apply reviewed, versioned migrations before launching the candidate.
# The application container never receives schema-owner credentials.
docker run --rm --env-file "$migration_env" --cgroup-parent foremanhq.slice --cpu-shares 256 --memory 512m --pids-limit 64 --security-opt no-new-privileges --cap-drop ALL "$image" node --import tsx scripts/migrate-aws.ts
# Verify the candidate before changing the running release.
. "$script_dir/start-container.sh"
docker rm -f "$APP_NAME-candidate" >/dev/null 2>&1 || true
cleanup_cgroup_mount "$APP_NAME-candidate"
start_container "$APP_NAME-candidate" "$image" "$env_file"
healthy=false
for attempt in $(seq 1 36); do
  if docker exec "$APP_NAME-candidate" node scripts/check-health.mjs >/dev/null 2>&1; then healthy=true; break; fi
  sleep 5
done
docker rm -f "$APP_NAME-candidate" >/dev/null
cleanup_cgroup_mount "$APP_NAME-candidate"
$healthy || { echo 'Candidate failed database/app healthcheck; active release unchanged.' >&2; exit 1; }
old_image=$(cat $STATE_DIR/current-image 2>/dev/null || true)
cp $CONFIG_DIR/app.env $CONFIG_DIR/previous.env 2>/dev/null || true
install -m 600 "$env_file" $CONFIG_DIR/app.env
printf '%s\n' "$image" > $STATE_DIR/current-image
cp "/etc/systemd/system/$APP_NAME.service" "$STATE_DIR/previous.service" 2>/dev/null || true
cat > /etc/systemd/system/$APP_NAME.service <<UNIT
[Unit]
Description=ForemanHQ application with bounded drawing workers
Requires=docker.service
After=docker.service network-online.target
RequiresMountsFor=/srv/foremanhq
StartLimitIntervalSec=300
StartLimitBurst=5
[Service]
Type=simple
Environment=DEPLOY_ENVIRONMENT=$DEPLOY_ENVIRONMENT
ExecStart=/bin/bash $script_dir/run-service.sh
ExecStop=-/usr/bin/docker stop -t 20 $APP_NAME
Restart=always
RestartSec=5
TimeoutStopSec=30
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$APP_NAME.service"
systemctl restart "$APP_NAME.service"
healthy=false
for attempt in $(seq 1 36); do
  if docker exec "$APP_NAME" node scripts/check-health.mjs >/dev/null 2>&1; then healthy=true; break; fi
  sleep 5
done
if ! $healthy; then
  systemctl stop "$APP_NAME.service"
  if [[ -n "$old_image" ]]; then
    printf '%s\n' "$old_image" > $STATE_DIR/current-image
    cp $CONFIG_DIR/previous.env $CONFIG_DIR/app.env
    if [[ -f "$STATE_DIR/previous.service" ]]; then
      cp "$STATE_DIR/previous.service" "/etc/systemd/system/$APP_NAME.service"
      systemctl daemon-reload
    fi
    systemctl start "$APP_NAME.service"
  fi
  echo 'Release failed; previous release restored when present.' >&2
  exit 1
fi
rm -f $CONFIG_DIR/previous.env
echo "$DEPLOY_ENVIRONMENT release healthy."
