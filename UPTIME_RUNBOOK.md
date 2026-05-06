# ForemanHQ Uptime Runbook

## Current production target
- App URL: `https://foremanhq.stellarator.work`
- Health URL: `https://foremanhq.stellarator.work/api/health`
- Platform: Cloudflare Workers via OpenNext

## Fast checks

### Local/manual
```bash
curl -I https://foremanhq.stellarator.work
node scripts/check-health.mjs https://foremanhq.stellarator.work/api/health
```

### Expected result
- `/` returns `200` or redirects cleanly to auth
- `/api/health` returns `200` with `{ "ok": true }`

## If the site is down

1. Check the public health endpoint.
2. Check Cloudflare Worker logs/tail.
3. Check latest deployment status.
4. Check database reachability from the worker.
5. Redeploy the latest known-good build if needed.

## Wrangler commands

Authentication is required first (`wrangler login` or `CLOUDFLARE_API_TOKEN`).

```bash
node_modules/.bin/wrangler whoami
node_modules/.bin/wrangler deployments list
node_modules/.bin/wrangler tail foremanhq --format pretty
pnpm deploy
```

## Recommendation for "up all the time"

Minimum:
- monitor `/api/health` every minute
- alert on 2+ consecutive failures
- keep a Cloudflare API token available in the deployment environment
- use automatic deploys from main only after a build/health gate passes

Better:
- external uptime monitor (UptimeRobot, Better Stack, Pingdom, etc.)
- Cloudflare tail/log review for runtime exceptions
- rollback procedure to last known-good deploy

## Current blocker

If Cloudflare auth is missing locally, live production cannot be inspected or redeployed from this machine until credentials are added.
