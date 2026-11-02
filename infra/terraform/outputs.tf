output "instance_id" { value = aws_instance.web.id }
output "ami_id" { value = aws_instance.web.ami }
output "public_ip" { value = aws_eip.web.public_ip }
output "database_endpoint" { value = aws_db_instance.app.address }
output "database_admin_secret_arn" { value = aws_db_instance.app.master_user_secret[0].secret_arn }
output "image_repository" { value = aws_ecr_repository.app.repository_url }
