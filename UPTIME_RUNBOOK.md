# ForemenHQ uptime runbook

Verified 2026-09-20 after migration to Omarchy.

## Current production route

- Public app: https://foremanhq.stellarator.work
- Public health: https://foremanhq.stellarator.work/api/health
- Cloudflare Tunnel forwards the existing hostname to http://localhost:3000 on this Omarchy computer.
- This is not the unused OpenNext/Workers deployment.
- Application: `/home/tim/.openclaw/workspace/kublai`.
- User services: `foremenhq.service` and `cloudflared-foremenhq.service`, both enabled at login.
- Tunnel configuration: `/home/tim/.cloudflared/foremenhq.yml`. Credentials are private; do not print or publish them.
- Existing hosted PostgreSQL database remains unchanged.

## Diagnose availability

```bash
systemctl --user status foremenhq cloudflared-foremenhq
curl --fail http://localhost:3000/api/health
curl --fail https://foremanhq.stellarator.work/api/health
journalctl --user -u foremenhq -u cloudflared-foremenhq -n 60
```

Public and local health should return HTTP 200 with `ok: true` and database `ok`. If local health passes but public health fails, inspect the tunnel. This computer must stay powered on and connected to serve the site. Do not run `pnpm deploy` to repair the tunnel; that targets a different deployment method.
