mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-2a", "us-east-2b"] }
  }
  mock_data "aws_ssm_parameter" {
    defaults = { value = "ami-0123456789abcdef0" }
  }
  mock_data "aws_rds_engine_version" {
    defaults = { version = "16.10" }
  }
}
variables {
  notification_email = "operator@example.com"
}
run "private_durable_database" {
  command = plan
  assert {
    condition     = aws_db_instance.app.instance_class == "db.t4g.micro" && !aws_db_instance.app.multi_az
    error_message = "Use the approved micro Single-AZ starting configuration."
  }
  assert {
    condition     = !aws_db_instance.app.publicly_accessible && aws_db_instance.app.storage_encrypted && aws_db_instance.app.backup_retention_period == 7
    error_message = "RDS must be private, encrypted, and retain seven days of recovery."
  }
  assert {
    condition     = aws_db_instance.app.deletion_protection && !aws_db_instance.app.skip_final_snapshot && !aws_db_instance.app.delete_automated_backups
    error_message = "Preserve final snapshots and automated backups on deletion."
  }
  assert {
    condition     = aws_db_instance.app.manage_master_user_password && aws_db_instance.app.password == null
    error_message = "Let RDS manage the admin password rather than putting it in Terraform."
  }
  assert {
    condition     = aws_instance.web.metadata_options[0].http_tokens == "required" && aws_instance.web.metadata_options[0].http_put_response_hop_limit == 1
    error_message = "Require IMDSv2 and prevent container access to host credentials."
  }
  assert {
    condition     = toset(keys(aws_vpc_security_group_ingress_rule.web)) == toset(["80", "443"]) && aws_vpc_security_group_ingress_rule.postgres.from_port == 5432
    error_message = "Only HTTP/HTTPS may be public; PostgreSQL uses its separate rule."
  }
  assert {
    condition     = length(aws_subnet.database) == 2 && length(aws_route_table.database.route) == 0
    error_message = "RDS subnet group needs two AZs with no public route."
  }
  assert {
    condition     = aws_ebs_volume.uploads.encrypted && !aws_volume_attachment.uploads.force_detach
    error_message = "Uploads need encrypted storage without forced detach."
  }
}
