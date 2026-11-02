#!/usr/bin/env bash
set -euo pipefail
mountpoint -q /srv/foremanhq
install -d -m 700 /etc/foremanhq /srv/foremanhq/caddy/data /srv/foremanhq/caddy/config
docker network inspect foremanhq >/dev/null 2>&1 || docker network create foremanhq >/dev/null
cat > /etc/foremanhq/Caddyfile <<'CADDY'
aws.foremanhq.ca {
  encode zstd gzip
  reverse_proxy foremanhq:3000
}
CADDY
# Network isolation keeps the proxy away from host metadata credentials.
docker inspect foremanhq-proxy >/dev/null 2>&1 || docker run -d \
  --name foremanhq-proxy --restart unless-stopped --network foremanhq \
  --memory 128m --pids-limit 64 --security-opt no-new-privileges \
  --cap-drop ALL --cap-add NET_BIND_SERVICE \
  -p 80:80 -p 443:443 \
  -v /etc/foremanhq/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v /srv/foremanhq/caddy/data:/data \
  -v /srv/foremanhq/caddy/config:/config \
  caddy:2.10.2-alpine >/dev/null
docker exec foremanhq-proxy caddy reload --config /etc/caddy/Caddyfile
