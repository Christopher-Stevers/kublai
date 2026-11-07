# Production and development on AWS

Pushes to `production` deploy to https://foremanhq.ca. Pushes to `development`
deploy to https://dev.foremanhq.ca. Pull requests and workflow dispatch run
validation without publishing or deploying. The AWS OIDC trust also limits the
release role to these two branches. Vercel Git deployments are disabled in
`vercel.json`; AWS is the deployment target.

Both applications run with `NODE_ENV=production` (optimized build and real
authentication), on the existing EC2 host `i-04896ee80d2ebcdf7`. Production uses
container/service `foremanhq`, Docker network `foremanhq`, and
`/srv/foremanhq/uploads`. Development uses `foremanhq-dev`, network
`foremanhq-dev`, and `/srv/foremanhq/dev/uploads`. Only Caddy joins both networks.
The apex is canonical; www and the old aws hostname redirect to it.

The existing RDS instance hosts production database `kublai` and development
`foremanhq_dev`. Each has separate schema-owner and runtime login roles. PUBLIC
CONNECT is revoked on both databases, so neither runtime can connect to the
other. Production roles are `foreman_owner`/`foreman_app`; development roles are
`foreman_dev_owner`/`foreman_dev_app`. Development has a four-connection web
pool, a 12-connection runtime role ceiling, 30-second statement/idle-transaction
timeouts, a five-second lock timeout, and 2 MiB work_mem. Production's web pool
is ten connections. Development starts empty; production data is not copied.

SSM SecureStrings `/foremanhq/app-env` and `/foremanhq/migration-env` remain
production-only. Development uses `/foremanhq/dev/app-env` and
`/foremanhq/dev/migration-env`. The development migration secret must include
`DATABASE_RUNTIME_ROLE=foreman_dev_app`. Development does not receive production
Stripe, webhook, or SMTP secrets, and checkout is disabled. Both apps use the
same Clerk identity service for this domain; user identities are shared, while
application records and uploaded files are separate. Clerk sessions therefore
can span the two subdomains. No development-mode authentication bypass is used.

## Elastic resource sharing

`foremanhq.slice` caps all app containers and migrations together at 3200 MiB
with no swap, leaving host/proxy headroom on the 4 GiB machine. Each app can use
spare memory up to that aggregate limit; RAM is not split into fixed halves.
Production has CPU shares 1024 and memory reservation 1024 MiB. Development has
CPU shares 256 and memory reservation 128 MiB. These are contention priorities,
not preallocated memory or CPU quotas. Drawing workers remain capped at 2 GiB
per app, 64 processes, and no swap. Web processes can borrow the remainder.
This shares existing capacity; it does not automatically resize EC2 or RDS.
RDS has no per-database CPU scheduler; development connection/query limits
reduce contention, but shared-instance failures and heavy I/O can affect both.

## Release and rollback

Deployments serialize with a host-wide lock, apply idempotent migrations using
owner credentials, then health-check a candidate before restarting that app.
Each service points to its own versioned helper directory, so a development
release cannot replace production's running helper scripts. Shared Caddy and
resource policy is configured only by production releases. Bootstrap that
shared configuration before the first development deployment.

On failed activation, deployment restores the previous image, runtime env, and
systemd unit for that environment. Database migrations are not rolled back;
use forward-compatible migrations and RDS point-in-time recovery when needed.
Do not promote a destructive database migration through unattended deployment.

Verify with `python3 infra/aws/test_deployment.py`, Terraform tests, typecheck,
lint, migration repeat-run checks, both HTTPS health endpoints, Docker cgroup
settings, and database-role cross-environment CONNECT checks. Database secrets
must never appear in commands, logs, repository files, or PR descriptions.
