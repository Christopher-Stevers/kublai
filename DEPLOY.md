# Deploy to Vercel

## Quick Deploy

1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` in project root
3. Follow prompts to link project
4. Set environment variables in Vercel dashboard
5. Deploy: `vercel --prod`

## Via GitHub

1. Push code to GitHub
2. Import project in Vercel dashboard
3. Configure environment variables
4. Deploy automatically on push

## Environment Variables

**Minimum required:**
- `DATABASE_URL` - PostgreSQL connection string
- `CLERK_SECRET_KEY` - Clerk authentication secret
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk public key
- `STRIPE_SECRET_KEY` - Stripe secret key
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - Stripe public key

**Optional:**
- `STRIPE_WEBHOOK_SECRET` - For Stripe webhooks
- `CLERK_WEBHOOK_SECRET` - For Clerk webhooks
- `NODE_ENV` - Set to `production` (defaults to `development`)

Set all required env vars in Vercel dashboard (Settings → Environment Variables).

