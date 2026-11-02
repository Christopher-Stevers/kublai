# ForemanHQ on AWS

Dedicated application EC2 and private RDS PostgreSQL for ForemanHQ (`kublai`).
Adapted from [Hello Any World's shared EC2 infrastructure](https://github.com/Christopher-Stevers/hello-any-world/tree/main/infra/terraform), with separate resources and state. This root provisions infrastructure; it does not deploy an app image, migrate existing data, or change live DNS.

## Architecture and approved database choice

- Account `337658133209`, Ohio (`us-east-2`), dedicated VPC.
- `t3a.small` app host, standard CPU credits, encrypted 20 GiB root disk, Elastic IP. Public ports 80/443 only; use SSM for administration. IMDSv2 is required; container metadata access is restricted.
- PostgreSQL 16 on **Single-AZ `db.t4g.micro`**, selected November 2, 2026. 20 GiB gp3, encrypted, autoscaling up to 100 GiB. Private subnets in two AZs satisfy the subnet-group requirement; this is still one database instance, with no automatic standby failover. The DB shares the app host's AZ to avoid ordinary cross-AZ database traffic.
- Port 5432 accepts connections only from the app security group. TLS is required. Use the AWS RDS CA bundle and certificate verification in clients.
- Seven days of automated database backups/PITR, deletion protection, required final snapshot, retained automated backups. Major upgrades are explicit; minor upgrades use the maintenance window. Paid RDS Extended Support enrollment is disabled.
- AWS manages the administrator password in Secrets Manager. Terraform never reads it. The app host cannot read that administrator secret. Create a separate least-privilege runtime database role; run migrations with a separate owner role.
- ForemanHQ drawings/documents/chat files need a separate encrypted 20 GiB EBS volume, mounted at `/srv/foremanhq`. Bind `/srv/foremanhq/uploads` into the application's `uploads` directory and Caddy state into `/srv/foremanhq/caddy`. UID 1000 owns uploads. Never store uploaded files only in an image/container writable layer.
- Daily AWS Backup EBS snapshots retained 30 days cover uploads. These are crash-consistent, not transactionally coordinated with RDS. Database/file recovery must reconcile the chosen recovery times. Same-account/region backups do not protect against account loss. Perform a restore drill before relying on them.
- ECR immutable image tags with scanning, host/RDS alarms, email SNS notifications, and a configurable $50 tagged-resource budget alert. Activate the `Project` cost-allocation tag in Billing; tag activation is an account-wide prerequisite for the filtered budget to count costs. Alerts do not cap spending.

The RDS Ohio public price list published October 29, 2026 lists $0.016/hour for micro plus $0.115/GB-month gp3. At 730 hours and 20 GB this is **$13.98/month for database compute/storage**. This excludes EC2, IPv4, EBS uploads/root disks, EBS snapshots, Secrets Manager, monitoring, traffic, surplus RDS CPU credits, excess backup storage, and tax. No promotional credits are assumed. Storage autoscaling can increase charges and cannot shrink storage in place.

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

After first apply, set `ami_id` in private tfvars from `terraform output -raw ami_id`. Otherwise a newer Amazon Linux image can propose a host replacement on a later plan. Review every replacement. Quiesce uploads and unmount the data disk before replacing the host; never force-detach it. Database deletion requires deliberately removing both Terraform and AWS deletion protections and choosing a unique final snapshot name.

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
