#!/usr/bin/env bash
# Run by SSM on the dedicated ForemanHQ EC2 host. Never print runtime secrets.
set -euo pipefail
image=${1:?image digest required}
[[ "$image" =~ ^337658133209\.dkr\.ecr\.us-east-2\.amazonaws\.com/foremanhq@sha256:[a-f0-9]{64}$ ]] || exit 64
exec 9>/run/foremanhq-deploy.lock
flock -n 9
mountpoint -q /srv/foremanhq
install -d -m 700 /etc/foremanhq /var/lib/foremanhq
umask 077
env_file=$(mktemp /etc/foremanhq/env.XXXXXX)
migration_env=$(mktemp /etc/foremanhq/migration.XXXXXX)
trap 'rm -f "$env_file" "$migration_env"' EXIT
aws ssm get-parameter --region us-east-2 --name /foremanhq/app-env --with-decryption --query Parameter.Value --output text > "$env_file"
for key in DATABASE_URL CLERK_SECRET_KEY STRIPE_SECRET_KEY; do
  grep -q "^${key}=.\+" "$env_file" || { echo "Missing runtime setting: $key" >&2; exit 1; }
done
aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin "${image%%/*}"
docker pull "$image"
aws ssm get-parameter --region us-east-2 --name /foremanhq/migration-env --with-decryption --query Parameter.Value --output text > "$migration_env"
# Apply reviewed, versioned migrations before launching the candidate.
# The application container never receives schema-owner credentials.
docker run --rm --env-file "$migration_env" --memory 512m --pids-limit 64 --security-opt no-new-privileges --cap-drop ALL "$image" node --import tsx scripts/migrate-aws.ts
# Verify the candidate before changing the running release.
. /opt/foremanhq/start-container.sh
docker rm -f foremanhq-candidate >/dev/null 2>&1 || true
cleanup_cgroup_mount foremanhq-candidate
start_container foremanhq-candidate "$image" "$env_file"
healthy=false
for attempt in $(seq 1 36); do
  if docker exec foremanhq-candidate node scripts/check-health.mjs >/dev/null 2>&1; then healthy=true; break; fi
  sleep 5
done
docker rm -f foremanhq-candidate >/dev/null
cleanup_cgroup_mount foremanhq-candidate
$healthy || { echo 'Candidate failed database/app healthcheck; active release unchanged.' >&2; exit 1; }
old_image=$(cat /var/lib/foremanhq/current-image 2>/dev/null || true)
cp /etc/foremanhq/app.env /etc/foremanhq/previous.env 2>/dev/null || true
install -m 600 "$env_file" /etc/foremanhq/app.env
printf '%s\n' "$image" > /var/lib/foremanhq/current-image
cat > /etc/systemd/system/foremanhq.service <<'UNIT'
[Unit]
Description=ForemanHQ application with bounded drawing workers
Requires=docker.service
After=docker.service network-online.target
RequiresMountsFor=/srv/foremanhq
StartLimitIntervalSec=300
StartLimitBurst=5
[Service]
Type=simple
ExecStart=/bin/bash /opt/foremanhq/run-service.sh
ExecStop=-/usr/bin/docker stop -t 20 foremanhq
Restart=always
RestartSec=5
TimeoutStopSec=30
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable foremanhq.service
systemctl restart foremanhq.service
healthy=false
for attempt in $(seq 1 36); do
  if docker exec foremanhq node scripts/check-health.mjs >/dev/null 2>&1; then healthy=true; break; fi
  sleep 5
done
if ! $healthy; then
  systemctl stop foremanhq.service
  if [[ -n "$old_image" ]]; then
    printf '%s\n' "$old_image" > /var/lib/foremanhq/current-image
    cp /etc/foremanhq/previous.env /etc/foremanhq/app.env
    systemctl start foremanhq.service
  fi
  echo 'Release failed; previous release restored when present.' >&2
  exit 1
fi
rm -f /etc/foremanhq/previous.env
echo 'Release healthy. Production DNS cutover is managed separately.'
