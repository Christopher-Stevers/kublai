# CLAUDE.md - ForemenHQ

ForemenHQ is a Next.js/React/TypeScript app for job material lists, supplier parts, quotes, orders, and offline/PWA field workflows.

## Commands

Use Corepack because `pnpm` may not be directly on PATH in WSL.

- Install deps: `corepack pnpm install`
- Typecheck: `corepack pnpm typecheck`
- Build: `corepack pnpm build`
- Dev server: `corepack pnpm dev`
- Drizzle migration generate: `corepack pnpm db:generate`
- Drizzle migrate: `corepack pnpm db:migrate`

## Current sync direction

Tim wants Replicache to handle syncing.

Do not continue expanding the old custom Dexie/outbox sync design unless explicitly asked. For editable/shared material-list data, the intended path is:

- UI reads from Replicache subscriptions/local store.
- User actions call Replicache mutators.
- Mutators apply local optimistic changes instantly.
- Replicache handles mutation log, retry, ordering, push/pull, and rebasing.
- Postgres remains the server-side durable database.
- Server push endpoints apply mutations idempotently and advance per-client `lastMutationId`.
- Server pull endpoints return patches plus cookies/version state.

Dexie can remain for unrelated cache/offline helper data during migration, but avoid having Dexie, React state, and Replicache all compete as source-of-truth for material-list records.

## Important product rules

- Quote/order generation is online-only unless Tim reverses that decision.
- Foremen can generate quotes/orders.
- Workers and beta testers must not delete jobs/material lists/suppliers/parts or generate quotes/orders.
- BDS import descriptions should stay blank/customizable where possible; generated former descriptions belong in aliases.

## Coding notes

- Keep changes small and typecheck before claiming success.
- Prefer server-side permission checks plus UI disable/hide states.
- Avoid service-worker caching of API mutation/sync traffic.
- For sync bugs, prove no queue/mutation growth without a user action.
