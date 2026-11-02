# ForemanHQ on AWS

Dedicated application EC2 and private RDS PostgreSQL for ForemanHQ (`kublai`).
Adapted from [Hello Any World's shared EC2 infrastructure](https://github.com/Christopher-Stevers/hello-any-world/tree/main/infra/terraform), with separate resources and state. This root provisions infrastructure and the Route 53 zone. GitHub Actions builds and deploys the app; Drizzle applies versioned database migrations.

## Deployment record — November 2, 2026

Provisioned in account `337658133209`, Ohio, from this Terraform root:

- EC2 `i-04896ee80d2ebcdf7`, Elastic IP `3.150.51.3`.
- RDS `foremanhq`, PostgreSQL 16.15, `db.t4g.micro`, endpoint `foremanhq.cz02cicyidl6.us-east-2.rds.amazonaws.com`.
- ECR `337658133209.dkr.ecr.us-east-2.amazonaws.com/foremanhq`.
- Encrypted uploads volume `vol-0fdeccd520df32390` mounted at `/srv/foremanhq`.

Verified: Terraform created 40 resources; EC2 cloud-init completed; Docker, Compose and SSM are active; the uploads mount and Docker mount dependency are present; RDS is available, private and encrypted, with parameters in sync and a latest-restorable timestamp. A host-to-RDS connection verified the server certificate using the AWS CA bundle and negotiated TLS 1.3. The initial AWS Backup upload-volume job completed successfully. The `Project` cost-allocation tag was activated for billing.

The app is deployed to `https://aws.foremanhq.ca` from `ci/foremanhq-aws`, based on the October 21 integration. The main domain continues serving Vercel. Route 53 delegation is live and Clerk reports the primary domain verified. Separate AWS Clerk and Stripe webhook endpoints use signing secrets in encrypted SSM configuration.

Still outstanding before production cutover: signed-in acceptance testing, representative drawing/uploads, recovery drills, and confirmation of the SNS email subscription. This is a fresh database; Tim's test data will be imported separately when requested.

## Architecture and approved database choice

- Account `337658133209`, Ohio (`us-east-2`), dedicated VPC.
- `t3a.medium` (4 GiB) app host, standard CPU credits, encrypted 20 GiB root disk, Elastic IP. Public ports 80/443 only; use SSM for administration. IMDSv2 is required; container metadata access is restricted.
- PostgreSQL 16 on **Single-AZ `db.t4g.micro`**, selected November 2, 2026. 20 GiB gp3, encrypted, autoscaling up to 100 GiB. Private subnets in two AZs satisfy the subnet-group requirement; this is still one database instance, with no automatic standby failover. The DB shares the app host's AZ to avoid ordinary cross-AZ database traffic.
- Port 5432 accepts connections only from the app security group. TLS is required. Use the AWS RDS CA bundle and certificate verification in clients.
- Seven days of automated database backups/PITR, deletion protection, required final snapshot, retained automated backups. Major upgrades are explicit; minor upgrades use the maintenance window. Paid RDS Extended Support enrollment is disabled.
- AWS manages the administrator password in Secrets Manager. Terraform never reads it. The app host cannot read that administrator secret. Create a separate least-privilege runtime database role; run migrations with a separate owner role.
- ForemanHQ drawings/documents/chat files need a separate encrypted 20 GiB EBS volume, mounted at `/srv/foremanhq`. Bind `/srv/foremanhq/uploads` into the application's `uploads` directory and Caddy state into `/srv/foremanhq/caddy`. UID 1000 owns uploads. Never store uploaded files only in an image/container writable layer.
- Daily AWS Backup EBS snapshots retained 30 days cover uploads. These are crash-consistent, not transactionally coordinated with RDS. Database/file recovery must reconcile the chosen recovery times. Same-account/region backups do not protect against account loss. Perform a restore drill before relying on them.
- ECR immutable image tags with scanning, host/RDS alarms, email SNS notifications, and a configurable $50 tagged-resource budget alert. Activate the `Project` cost-allocation tag in Billing; tag activation is an account-wide prerequisite for the filtered budget to count costs. Alerts do not cap spending.

The RDS Ohio public price list published October 29, 2026 lists $0.016/hour for micro plus $0.115/GB-month gp3. At 730 hours and 20 GB this is **$13.98/month for database compute/storage**. This excludes EC2, IPv4, EBS uploads/root disks, EBS snapshots, Secrets Manager, monitoring, traffic, surplus RDS CPU credits, excess backup storage, and tax. No promotional credits are assumed. Storage autoscaling can increase charges and cannot shrink storage in place.

At light usage, the current complete stack is approximately **$50–55/month before tax**, using a 730-hour month: EC2 $27.45, RDS compute/storage $13.98, 40 GiB EC2 gp3 disks $3.20, public IPv4 $3.65, Route 53 approximately $0.50 plus queries, and approximately $1–5 for backups, monitoring, secrets, and image storage. This is incremental to existing hosting and excludes heavy traffic/CPU-credit use. AWS rates were checked November 2, 2026.

The app host uses 4 GiB RAM. The web process has a 1 GiB cgroup limit, drawing workers share a 2 GiB ceiling and are serialized, and the container is capped at 3200 MiB. The host deployer delegates only the container's own workers subtree; no Docker socket, privileged container, or host-wide writable cgroup mount is exposed. A systemd service recreates the container and delegation after a restart.

## Initialize and review

Terraform 1.10+ and AWS CLI v2 are required. Provider versions and checksums are committed. Use temporary AWS credentials; the existing `haw-terraform` profile currently delegates to `haw-bootstrap`. Prefer a scoped assumed role for ongoing operations.

```sh
aws login --profile haw-bootstrap
export AWS_PROFILE=haw-terraform
aws sts get-caller-identity  # must be account 337658133209
cd infra/terraform
terraform init -backend-config=backend.hcl.example
cp production.example.tfvars production.tfvars
# Replace operator@example.com with the actual operator email.
terraform plan -var-file=production.tfvars -out=production.tfplan
terraform show production.tfplan
terraform apply production.tfplan
```

The existing encrypted/versioned Hello Any World state bucket is reused under a **new key** `foremanhq/terraform.tfstate`; do not initialize this root with the shared-EC2 key. This root does not adopt, modify, or destroy the existing demo host. Confirm the bucket exists and access is scoped correctly before apply. Do not commit state, saved plans, private tfvars, app environment files, or credentials.

The default `ami_id` is pinned to the first deployed image, `ami-02dae70ab25064279`. Setting it to null follows the latest Amazon Linux image and can propose a host replacement on a later plan. Review every replacement. Quiesce uploads and unmount the data disk before replacing the host; never force-detach it. Database deletion requires deliberately removing both Terraform and AWS deletion protections and choosing a unique final snapshot name.

## App release and cutover work

The AWS release branch is `ci/foremanhq-aws` and PR #7 targets `foremanhq-integration-2026-10-21`. Do not deploy the older default branch by accident or silently merge the integration PR.

1. Push reviewed changes to the AWS branch. `.github/workflows/aws.yml` runs lint, typechecking, regression tests, Terraform checks, and fresh/repeated Drizzle migrations including organization-boundary checks.
2. With repository variables `AWS_RELEASE_READY=true` and `AWS_DEPLOY_ENABLED=true`, CI builds off-host, publishes an immutable ECR image, and calls `infra/aws/send-deploy.py` using GitHub OIDC. Public Clerk/Stripe keys are build inputs; secrets never enter build arguments.
3. `deploy.sh` fetches `/foremanhq/migration-env` and runs `pnpm db:migrate:aws`'s underlying migration script before starting the candidate. The app receives only `/foremanhq/app-env`. Database roles are `foreman_owner` for migrations and `foreman_app` for runtime. Never use `db:push` or destructive reseeding for deployment.
4. The candidate must pass the app/database healthcheck. The deployer then updates the root-owned environment/image files and restarts `foremanhq.service`; a failed healthcheck restores the previous image/configuration when present. Schema migrations are not automatically reversed.
5. `run-service.sh` and `start-container.sh` recreate the Docker container and bounded cgroup delegation on service/host restart. Caddy serves HTTPS and persistent uploads are mounted from EBS.
6. Use `docker exec foremanhq node scripts/check-health.mjs` through SSM for health. `docker exec foremanhq node infra/aws/verify-clerk.mjs` verifies signed user events and removes its synthetic user; this command is restricted to the AWS acceptance hostname.
7. Test real login, organization membership, uploads/downloads, drawing processing, invitations and billing. No real payment is required for webhook signature checks. Inspect backup jobs and perform recovery drills.
8. After acceptance, change the Terraform-managed apex/www records to AWS and update Caddy and application callback URLs together. Keep the former deployment and original webhooks available during the transition; retire redundant AWS-preview webhook destinations deliberately to avoid duplicate delivery.

Namecheap remains the registrar. The Route 53 zone in `dns.tf` currently preserves Vercel apex/wildcard routing and Clerk records, while `aws.foremanhq.ca` points to the dedicated Elastic IP. See `DNS-MIGRATION.md` for delegation and rollback details.

## Validation

```sh
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
terraform test
bash -n bootstrap.sh.tftpl
```

Mock tests check the approved size, private database configuration, recovery protection, IMDS requirements, ingress ports, private subnet routes, and encrypted persistent uploads. They do not prove AWS permissions, service availability, boot success, application compatibility, restore success, or live pricing totals. A real plan and deployment validation remain necessary.

## Integration lint baseline

The AWS release branch starts from integration commit `e8b3ba10cf3ddccce9860878845ae6abe181f473`. Its inherited lint baseline was stale: 291 additional errors already existed in that integration source. `eslint-baseline.json` now records the 1676 existing errors by file, rule, message and count. This records debt; it does not fix those application errors or disable rules. `pnpm lint` rejects additions and `pnpm lint:strict` exposes all debt. When the baseline was refreshed, application source was unchanged from that integration commit except the equivalent SQL `0` default required for Drizzle snapshot generation.

## Production cutover and billing flag

`production_on_aws=true` routes the apex and explicit www record to the app EIP; false restores the prior Vercel apex and removes the www override. Caddy redirects the apex to `https://www.foremanhq.ca` and continues serving the AWS acceptance hostname. Set `FOREMANHQ_PUBLIC_URL` and `NEXT_PUBLIC_APP_URL` to the canonical www URL in encrypted SSM runtime configuration at cutover.

`STRIPE_CHECKOUT_ENABLED=false` disables new paid subscriptions on the server and pricing page. Set it to the exact value `true` and redeploy only after accepting the billing flow. Existing subscription status and billing-portal access remain available. Webhooks continue syncing while checkout is off. Primary signing secrets belong to the AWS preview endpoints; optional `CLERK_WEBHOOK_SECRET_SECONDARY` and `STRIPE_WEBHOOK_SECRET_SECONDARY` accept the original production endpoints during transition without rotating the originals.
