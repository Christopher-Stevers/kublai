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
on the encrypted volume. It does not apply schema migrations automatically.
The CI role is scoped to this ECR repository and this EC2 instance. Code on the
two trusted branches can administer that host; protect branch writes accordingly.
Remove the feature branch from the IAM trust after merging and cutover.

## Fresh launch prerequisites

The owner selected a fresh AWS database and uploads directory. Data from Tim's
computer will be imported later as a separate operation.

1. Apply `ci.tf` with the existing Terraform backend/state. Do not create a
   second copy of the infrastructure. Keep production.tfvars and state private.
2. Create separate migration-owner and runtime PostgreSQL credentials, initialize
   the schema, and grant runtime table/sequence privileges. Verify TLS to RDS.
3. Store Docker-compatible KEY=value runtime settings in the SecureString
   `/foremanhq/app-env`. Required: DATABASE_URL, CLERK_SECRET_KEY,
   STRIPE_SECRET_KEY and the actual NEXT_PUBLIC values baked into the image.
   Configure webhook keys, SMTP, document editor, push and other integrations
   that will be used. Never use SKIP_ENV_VALIDATION at runtime.
4. Resolve drawing-worker deployment before calling this production ready:
   `run-detect-worker.sh` requires delegated cgroup v2 and a 4 GiB worker ceiling.
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
