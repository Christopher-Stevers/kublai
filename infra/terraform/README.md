# ForemanHQ on AWS

Dedicated application EC2 and private RDS PostgreSQL for ForemanHQ (`kublai`).
Adapted from [Hello Any World's shared EC2 infrastructure](https://github.com/Christopher-Stevers/hello-any-world/tree/main/infra/terraform), with separate resources and state. This root provisions infrastructure; it does not deploy an app image, migrate existing data, or change live DNS.

## Deployment record — November 2, 2026

Provisioned in account `337658133209`, Ohio, from this Terraform root:

- EC2 `i-04896ee80d2ebcdf7`, Elastic IP `3.150.51.3`.
- RDS `foremanhq`, PostgreSQL 16.15, `db.t4g.micro`, endpoint `foremanhq.cz02cicyidl6.us-east-2.rds.amazonaws.com`.
- ECR `337658133209.dkr.ecr.us-east-2.amazonaws.com/foremanhq`.
- Encrypted uploads volume `vol-0fdeccd520df32390` mounted at `/srv/foremanhq`.

Verified: Terraform created 40 resources; EC2 cloud-init completed; Docker, Compose and SSM are active; the uploads mount and Docker mount dependency are present; RDS is available, private and encrypted, with parameters in sync and a latest-restorable timestamp. A host-to-RDS connection verified the server certificate using the AWS CA bundle and negotiated TLS 1.3. The initial AWS Backup upload-volume job completed successfully. The `Project` cost-allocation tag was activated for billing.

Still outstanding: application deployment, source-version/cutover choice, database roles and secrets, existing-data migration, DNS/HTTPS cutover, an actual restore drill, workload/capacity checks, and operator confirmation of the SNS email subscription. These checks do not establish that ForemanHQ is serving from AWS yet.

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

At light usage, the current complete stack is approximately **$36–40/month before tax**, using a 730-hour month: EC2 $13.72, RDS compute/storage $13.98, 40 GiB EC2 gp3 disks $3.20, public IPv4 $3.65, plus approximately $1–5 for backups, monitoring, secrets, and image storage. This is incremental to existing hosting and excludes heavy traffic/CPU-credit use. AWS rates were checked November 2, 2026.

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

The default `development` branch is older than the application snapshot in open [PR #5](https://github.com/Christopher-Stevers/kublai/pull/5). The infrastructure is independent of that integration. Confirm the intended source revision before building a production image. Do not deploy the older default branch by accident or silently merge the integration PR.

1. Wait for cloud-init and `/var/lib/foremanhq/bootstrap-ready` via SSM. Confirm the uploads mount before starting containers.
2. Build an x86_64 Linux image from the selected source revision off-host, including required native PDF/CAD/room-processing dependencies and worker scripts. Public Clerk/Stripe variables are build-time Next.js inputs. Keep secret values out of build arguments/layers. Push an immutable commit tag to the output ECR repository and deploy by digest.
3. Inventory the current production database and uploads. Decide whether this is an empty launch or a migration. For a migration, rehearse a restore into RDS, validate counts and files, and establish a cutover write freeze. Do not run `db:push` against production or replace existing data with seeds.
4. Create the database application/migration roles privately through SSM connectivity. Store the production dotenv payload in SecureString SSM `/foremanhq/app-env` using the default SSM key; the host role may read only that parameter. Fetch into a root-owned file with mode 0600. Never output it in SSM logs. Use a TLS-verified RDS connection string with the runtime role, not the administrator. A custom KMS key requires a separately scoped decrypt grant.
5. Run the repo's reviewed migration chain once with the migration role. Check the current integration's migration instructions rather than assuming the older branch's schema is complete.
6. Run the application and Caddy through Docker Compose, mount uploads and certificate storage, and install a systemd service requiring the data mount. The newer app invokes worker scripts from source; a minimal Next.js standalone image may omit these and is not automatically sufficient.
7. Test a staging hostname and real auth, API access, uploads/downloads, drawings, email, payments/webhooks as configured, reboot persistence, database restore, and upload restore. Confirm SNS subscriptions and inspect alarms/backup jobs.
8. Only then move the production domain from its current hosting to the output Elastic IP, verify DNS/HTTPS, and keep the former deployment available for rollback. Database migrations and new writes may prevent simple image-only rollback.

At initial preparation, `foremanhq.ca` redirects to `www.foremanhq.ca` on Vercel. DNS records are intentionally absent from this infrastructure root until the authoritative zone and cutover are established. Once established, manage the new records in this repo too.

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

The AWS release branch starts from integration commit `e8b3ba10cf3ddccce9860878845ae6abe181f473`. Its inherited lint baseline was stale: 291 additional errors already existed in that integration source. `eslint-baseline.json` now records the 1676 existing errors by file, rule, message and count. This records debt; it does not fix those application errors or disable rules. `pnpm lint` rejects additions and `pnpm lint:strict` exposes all debt. Application source was unchanged from that integration commit except the equivalent SQL `0` default required for Drizzle snapshot generation.
