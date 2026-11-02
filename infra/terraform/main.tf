terraform {
  required_version = ">= 1.10, < 2.0"
  backend "s3" {}
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}
provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags {
    tags = { Project = "foremanhq", Environment = "production", ManagedBy = "Terraform" }
  }
}
data "aws_availability_zones" "available" { state = "available" }
data "aws_ssm_parameter" "ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}
data "aws_rds_engine_version" "postgres" {
  engine  = "postgres"
  version = "16"
  latest  = true
}
resource "aws_vpc" "app" {
  cidr_block           = "10.65.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
}
resource "aws_internet_gateway" "app" { vpc_id = aws_vpc.app.id }
resource "aws_subnet" "web" {
  vpc_id                  = aws_vpc.app.id
  cidr_block              = "10.65.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
}
resource "aws_subnet" "database" {
  count                   = 2
  vpc_id                  = aws_vpc.app.id
  cidr_block              = "10.65.${count.index + 10}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = false
}
resource "aws_route_table" "web" {
  vpc_id = aws_vpc.app.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.app.id
  }
}
resource "aws_route_table_association" "web" {
  subnet_id      = aws_subnet.web.id
  route_table_id = aws_route_table.web.id
}
resource "aws_route_table" "database" {
  vpc_id = aws_vpc.app.id
  route  = []
}
resource "aws_route_table_association" "database" {
  count          = 2
  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.database.id
}
resource "aws_security_group" "web" {
  name_prefix = "foremanhq-web-"
  description = "HTTP and HTTPS only; administration through SSM"
  vpc_id      = aws_vpc.app.id
}
resource "aws_vpc_security_group_ingress_rule" "web" {
  for_each          = toset(["80", "443"])
  security_group_id = aws_security_group.web.id
  ip_protocol       = "tcp"
  from_port         = tonumber(each.key)
  to_port           = tonumber(each.key)
  cidr_ipv4         = "0.0.0.0/0"
}
resource "aws_vpc_security_group_egress_rule" "web" {
  security_group_id = aws_security_group.web.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
resource "aws_security_group" "database" {
  name_prefix = "foremanhq-db-"
  description = "PostgreSQL only from the ForemanHQ application host"
  vpc_id      = aws_vpc.app.id
}
resource "aws_vpc_security_group_ingress_rule" "postgres" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.web.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
resource "aws_db_subnet_group" "app" {
  name       = "foremanhq"
  subnet_ids = aws_subnet.database[*].id
}
resource "aws_db_parameter_group" "app" {
  name_prefix = "foremanhq-pg16-"
  family      = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  lifecycle { create_before_destroy = true }
}
resource "aws_db_instance" "app" {
  identifier                      = "foremanhq"
  engine                          = "postgres"
  engine_version                  = var.postgres_version != null ? var.postgres_version : data.aws_rds_engine_version.postgres.version
  engine_lifecycle_support        = "open-source-rds-extended-support-disabled"
  instance_class                  = var.database_instance_class
  allocated_storage               = 20
  max_allocated_storage           = 100
  storage_type                    = "gp3"
  storage_encrypted               = true
  db_name                         = "kublai"
  username                        = "foreman_admin"
  manage_master_user_password     = true
  db_subnet_group_name            = aws_db_subnet_group.app.name
  vpc_security_group_ids          = [aws_security_group.database.id]
  parameter_group_name            = aws_db_parameter_group.app.name
  publicly_accessible             = false
  multi_az                        = false
  availability_zone               = aws_subnet.web.availability_zone
  backup_retention_period         = 7
  backup_window                   = "07:00-08:00"
  maintenance_window              = "sun:08:00-sun:09:00"
  auto_minor_version_upgrade      = true
  allow_major_version_upgrade     = false
  apply_immediately               = false
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "foremanhq-final"
  delete_automated_backups        = false
  copy_tags_to_snapshot           = true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  lifecycle { prevent_destroy = true }
}
resource "aws_ecr_repository" "app" {
  name                 = "foremanhq"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
  lifecycle { prevent_destroy = true }
}
resource "aws_iam_role" "host" {
  name = "foremanhq-host"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_role_policy" "host" {
  role = aws_iam_role.host.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"], Resource = aws_ecr_repository.app.arn },
    { Effect = "Allow", Action = ["ssm:GetParameter"], Resource = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/foremanhq/app-env" },
    # Managed SSM core includes parameter reads; this explicit deny narrows them.
    { Effect = "Deny", Action = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"], NotResource = "arn:aws:ssm:${var.region}:${var.account_id}:parameter/foremanhq/app-env" }
  ] })
}
resource "aws_iam_instance_profile" "host" { role = aws_iam_role.host.name }
resource "aws_instance" "web" {
  ami                         = var.ami_id != null ? var.ami_id : nonsensitive(data.aws_ssm_parameter.ami.value)
  instance_type               = var.app_instance_type
  subnet_id                   = aws_subnet.web.id
  vpc_security_group_ids      = [aws_security_group.web.id]
  iam_instance_profile        = aws_iam_instance_profile.host.name
  user_data                   = templatefile("${path.module}/bootstrap.sh.tftpl", { volume_id = aws_ebs_volume.uploads.id })
  user_data_replace_on_change = true
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }
  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }
  credit_specification { cpu_credits = "standard" }
  tags       = { Name = "foremanhq" }
  depends_on = [aws_route_table_association.web, aws_iam_role_policy_attachment.ssm, aws_iam_role_policy.host]
}
resource "aws_eip" "web" {
  domain     = "vpc"
  instance   = aws_instance.web.id
  depends_on = [aws_internet_gateway.app]
}
resource "aws_sns_topic" "alerts" { name = "foremanhq-alerts" }
resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.notification_email
}
resource "aws_cloudwatch_metric_alarm" "host" {
  alarm_name          = "foremanhq-host-unhealthy"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed"
  dimensions          = { InstanceId = aws_instance.web.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
resource "aws_cloudwatch_metric_alarm" "database" {
  for_each = {
    storage = { metric = "FreeStorageSpace", threshold = 5368709120, comparison = "LessThanThreshold" }
    memory  = { metric = "FreeableMemory", threshold = 104857600, comparison = "LessThanThreshold" }
    cpu     = { metric = "CPUUtilization", threshold = 80, comparison = "GreaterThanThreshold" }
  }
  alarm_name          = "foremanhq-db-${each.key}"
  namespace           = "AWS/RDS"
  metric_name         = each.value.metric
  dimensions          = { DBInstanceIdentifier = aws_db_instance.app.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = each.value.comparison
  threshold           = each.value.threshold
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# Current ForemanHQ also stores documents and drawings on disk. RDS does not
# protect those files; preserve their volume independently of the app instance.
resource "aws_ebs_volume" "uploads" {
  availability_zone = aws_subnet.web.availability_zone
  type              = "gp3"
  size              = 20
  encrypted         = true
  tags              = { Name = "foremanhq-uploads" }
  lifecycle { prevent_destroy = true }
}
resource "aws_volume_attachment" "uploads" {
  device_name  = "/dev/sdf"
  volume_id    = aws_ebs_volume.uploads.id
  instance_id  = aws_instance.web.id
  force_detach = false
}
resource "aws_backup_vault" "uploads" {
  name = "foremanhq-uploads"
  lifecycle { prevent_destroy = true }
}
resource "aws_iam_role" "backup" {
  name = "foremanhq-backup"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "backup.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}
resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}
resource "aws_backup_plan" "uploads" {
  name = "foremanhq-uploads-daily"
  rule {
    rule_name         = "daily-uploads"
    target_vault_name = aws_backup_vault.uploads.name
    schedule          = "cron(0 6 * * ? *)"
    lifecycle { delete_after = 30 }
  }
}
resource "aws_backup_selection" "uploads" {
  name         = "foremanhq-uploads"
  plan_id      = aws_backup_plan.uploads.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = [aws_ebs_volume.uploads.arn]
  depends_on   = [aws_iam_role_policy_attachment.backup]
}

resource "aws_budgets_budget" "app" {
  name         = "foremanhq-monthly"
  budget_type  = "COST"
  time_unit    = "MONTHLY"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Project$foremanhq"]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.notification_email]
  }
}
