#!/usr/bin/env bash
set -euo pipefail
mountpoint -q /srv/foremanhq
install -d -m 700 /etc/foremanhq /srv/foremanhq/caddy/data /srv/foremanhq/caddy/config
docker network inspect foremanhq >/dev/null 2>&1 || docker network create foremanhq >/dev/null
docker network inspect foremanhq-dev >/dev/null 2>&1 || docker network create foremanhq-dev >/dev/null
install -d -m 750 -o 1000 -g 1000 /srv/foremanhq/uploads /srv/foremanhq/dev/uploads
cat > /etc/systemd/system/foremanhq.slice <<'UNIT'
[Unit]
Description=Shared elastic budget for ForemanHQ production and development
[Slice]
MemoryAccounting=yes
CPUAccounting=yes
MemoryMax=3200M
MemorySwapMax=0
UNIT
systemctl daemon-reload
systemctl start foremanhq.slice
cat > /etc/foremanhq/Caddyfile <<'CADDY'
www.foremanhq.ca, aws.foremanhq.ca {
  # Existing Clerk/Stripe subscriptions must not receive an HTTP redirect.
  handle /api/webhooks/* {
    reverse_proxy foremanhq:3000
  }
  handle {
    redir https://foremanhq.ca{uri} permanent
  }
}
foremanhq.ca {
  encode zstd gzip
  reverse_proxy foremanhq:3000
}
dev.foremanhq.ca {
  encode zstd gzip
  header X-Robots-Tag "noindex, nofollow"
  reverse_proxy foremanhq-dev:3000
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
docker network connect foremanhq-dev foremanhq-proxy 2>/dev/null || docker network inspect foremanhq-dev --format '{{json .Containers}}' | grep -q foremanhq-proxy
docker exec foremanhq-proxy caddy reload --config /etc/caddy/Caddyfile
