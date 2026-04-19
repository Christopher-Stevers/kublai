# Kublai rebuild notes

Date: 2026-04-19

## What was rebuilt

- Cloned fresh from `https://github.com/Christopher-Stevers/kublai.git`
- Branch: `tim-development`
- Installed root dependencies with `corepack pnpm install`
- Installed mobile wrapper dependencies with `corepack pnpm install` in `apps/mobile`

## Recovery fixes applied

- Expanded `.env.example` to match the recovered integration shape
- Made Stripe initialization lazy in:
  - `src/app/api/webhooks/stripe/route.ts`
  - `src/server/api/routers/payment.ts`
- Updated `package.json` `check` script to use `tsc --noEmit`
- Made the Clerk provider no-op when no usable publishable key is configured, so recovery builds can complete before real auth secrets are restored

## Verification

These succeeded in Linux:

```bash
SKIP_ENV_VALIDATION=1 corepack pnpm build
SKIP_ENV_VALIDATION=1 corepack pnpm check
```

## Remaining setup for real use

You still need fresh rotated credentials for:

- Postgres
- Stripe
- Clerk
- optional GitHub OAuth
- optional Google OAuth
- optional SMTP

Then copy `.env.example` to `.env` and fill them in.
