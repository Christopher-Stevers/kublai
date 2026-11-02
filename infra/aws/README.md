# ForemanHQ AWS release

Work starts on `ci/foremanhq-aws`, based on the October 21 integration revision.
Terraform lives in `infra/terraform`; this branch includes the infrastructure PR.
Existing Vercel production and DNS remain unchanged until explicit cutover.

## Pipeline

`.github/workflows/aws.yml` checks TypeScript, the existing lint baseline,
reliability tests, Terraform formatting/validation/mock tests, then builds the
Node 22 Docker image. Pull requests never authenticate to AWS or deploy.

Set repository variables `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to the actual public configuration (and
`NEXT_PUBLIC_DEXIE_CLOUD_DATABASE_URL` if used). Set `AWS_RELEASE_READY=true`
only once these are correct. Subsequent branch pushes publish immutable images
to ECR using GitHub OIDC; no permanent AWS keys are stored in GitHub.
Without this switch, synthetic public keys are used solely for build validation,
and the image is not published or deployed.

Set `AWS_DEPLOY_ENABLED=true` after the launch prerequisites below pass.
A branch push then deploys its exact image digest to the dedicated EC2 through
SSM. The script first checks a candidate against RDS, then replaces the active
container and rolls back the container on healthcheck failure. Uploads persist
on the encrypted volume. It runs the committed Drizzle migrations with separate owner credentials before starting the candidate.
The CI role is scoped to this ECR repository and this EC2 instance. Code on the
two trusted branches can administer that host; protect branch writes accordingly.
Remove the feature branch from the IAM trust after merging and cutover.

## Fresh launch prerequisites

The owner selected a fresh AWS database and uploads directory. Data from Tim's
computer will be imported later as a separate operation.

1. Apply `ci.tf` with the existing Terraform backend/state. Do not create a
   second copy of the infrastructure. Keep production.tfvars and state private.
2. Create separate migration-owner and runtime PostgreSQL credentials. Store
   DATABASE_MIGRATION_URL in SecureString `/foremanhq/migration-env`. The
   deployment runs `pnpm db:migrate:aws`, which applies committed migrations and
   grants runtime table/sequence privileges. RDS TLS certificate checks are required.
3. Store Docker-compatible KEY=value runtime settings in the SecureString
   `/foremanhq/app-env`. Required: DATABASE_URL, CLERK_SECRET_KEY,
   STRIPE_SECRET_KEY and the actual NEXT_PUBLIC values baked into the image.
   Configure webhook keys, SMTP, document editor, push and other integrations
   that will be used. Never use SKIP_ENV_VALIDATION at runtime.
4. Resolve drawing-worker deployment before calling this production ready:
   `run-detect-worker.sh` requires delegated cgroup v2 and a 2 GiB worker ceiling.
   The current unprivileged Docker container cannot create those cgroups and the
   approved t3a.small has only 2 GiB RAM. Do not grant privileged Docker access
   as a workaround. Ordinary app health does not validate drawing detection.
5. Configure HTTPS reverse proxy to localhost:3000, preserving uploads and
   proxy storage. Verify login, organization setup, uploads/downloads, drawing
   processing and billing/webhooks with the correct domain and provider keys.
6. After acceptance, merge the integration and infrastructure/release changes
   into development, enable AWS deployment there, switch production DNS and
   webhook destinations, and disconnect the old Vercel auto-deployment. Keep
   the old site available until DNS and smoke tests pass. Branch CI does not
   disconnect the existing hosting integration by itself.

Container rollback preserves its previous runtime configuration. Database
changes require their own backwards-compatible migration/restore plan; restoring
an old image does not reverse a schema change. The health endpoint verifies DB
connectivity, not schema completeness. Deploying on a single host includes a
brief restart interruption.

## Durable schema workflow

This repository uses **Drizzle ORM**, not Prisma. The fresh AWS database has a
committed baseline in `drizzle-aws/` including SQL, snapshot and migration journal.
The legacy `drizzle/` history remains available for existing developer databases;
do not apply the AWS baseline to Tim's populated database.

- Change `src/server/db/schema.ts`, then run `pnpm db:generate:aws`.
- Review and commit the generated SQL, snapshot and journal with the app change.
- CI provisions PostgreSQL 16 and runs `pnpm db:migrate:aws` twice to verify fresh
  initialization and repeatability. Deployments run the same command against RDS.
- `pnpm db:studio:aws` opens Drizzle Studio with DATABASE_MIGRATION_URL configured;
  access private RDS through an SSM tunnel. Do not expose Studio publicly.
- Routine deployments never use `db:push` or reset the database. Migration owner
  credentials are supplied only to the short-lived migration container.
- Use backwards-compatible migrations: a container rollback cannot undo SQL.

The initial baseline places unique indexes before dependent foreign keys to work
around Drizzle 0.31 export ordering. The schema's BigInt default uses SQL `0` so
Drizzle can serialize its snapshot. Both changes were verified on fresh RDS.
RDS was initialized through this committed migration and a second run completed
without schema changes on 2026-11-02. Its ledger is `drizzle_aws.__drizzle_migrations`.

## DNS and HTTPS

Vercel currently hosts authoritative DNS. `aws.foremanhq.ca` has an A record
pointing to `3.150.51.3`; the apex and www remain on Vercel. Run
`bash infra/aws/configure-host.sh` on the EC2 via SSM to configure the dedicated
Docker network and Caddy HTTPS proxy. The file is safe to re-run.
Production cutover must update the proxy's hostnames, verify Clerk domains and
webhooks, then change apex/www DNS to AWS and disconnect Vercel Git deployment.
