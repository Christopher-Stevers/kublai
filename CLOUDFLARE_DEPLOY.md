# Cloudflare deploy

This repo is wired for Cloudflare Workers using OpenNext.

## What was added
- `@opennextjs/cloudflare`
- `wrangler`
- `open-next.config.ts`
- `wrangler.jsonc`
- package scripts:
  - `pnpm preview`
  - `pnpm deploy`
  - `pnpm cf-typegen`

## Local Cloudflare build check

```bash
SKIP_ENV_VALIDATION=1 pnpm preview
```

## Dry run deploy check

```bash
SKIP_ENV_VALIDATION=1 pnpm exec wrangler deploy --dry-run
```

## Real deploy

1. Authenticate Wrangler:
   ```bash
   pnpm exec wrangler login
   ```
2. Deploy:
   ```bash
   SKIP_ENV_VALIDATION=1 pnpm deploy
   ```

## Notes
- This app builds for Cloudflare Workers, not Pages static export.
- Real production deploy still needs proper env vars and secrets set in Cloudflare.
- The current `wrangler.jsonc` app name is `kublai`, which you can rename.
- If you attach a custom domain later, do it in the Cloudflare dashboard or with Wrangler routes.
