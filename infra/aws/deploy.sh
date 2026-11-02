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
# Check the DB and app without replacing the active container after applying reviewed migrations.
docker rm -f foremanhq-candidate >/dev/null 2>&1 || true
docker run -d --name foremanhq-candidate --env-file "$env_file" --memory 1400m --memory-swap 1400m --pids-limit 256 --security-opt no-new-privileges --cap-drop ALL --mount type=bind,src=/srv/foremanhq/uploads,dst=/app/uploads "$image" >/dev/null
healthy=false
for attempt in $(seq 1 36); do
  if docker exec foremanhq-candidate node scripts/check-health.mjs >/dev/null 2>&1; then healthy=true; break; fi
  sleep 5
done
docker rm -f foremanhq-candidate >/dev/null
$healthy || { echo 'Candidate failed database/app healthcheck; active release unchanged.' >&2; exit 1; }
old_image=$(docker inspect --format '{{.Config.Image}}' foremanhq 2>/dev/null || true)
if [[ -n "$old_image" ]]; then
  docker rename foremanhq foremanhq-previous
  docker stop foremanhq-previous >/dev/null
fi
start() {
  docker run -d --name foremanhq --network foremanhq --restart unless-stopped --env-file "$env_file" --memory 1400m --memory-swap 1400m --pids-limit 256 --security-opt no-new-privileges --cap-drop ALL -p 127.0.0.1:3000:3000 --mount type=bind,src=/srv/foremanhq/uploads,dst=/app/uploads "$image" >/dev/null
}
healthy=false
if start; then
  for attempt in $(seq 1 36); do
    if docker exec foremanhq node scripts/check-health.mjs >/dev/null 2>&1; then healthy=true; break; fi
    sleep 5
  done
fi
if ! $healthy; then
  docker rm -f foremanhq >/dev/null 2>&1 || true
  if [[ -n "$old_image" ]]; then docker rename foremanhq-previous foremanhq; docker start foremanhq >/dev/null; fi
  echo 'Release failed; previous container restored when present.' >&2
  exit 1
fi
docker rm foremanhq-previous >/dev/null 2>&1 || true
printf '%s\n' "$image" > /var/lib/foremanhq/current-image
echo 'Release healthy on localhost:3000. DNS/proxy cutover is managed separately.'
