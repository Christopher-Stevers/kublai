variable "account_id" {
  type    = string
  default = "337658133209"
}
variable "region" {
  type    = string
  default = "us-east-2"
}
variable "notification_email" {
  type        = string
  description = "Receives operational alerts; confirm the SNS subscription after apply."
  validation {
    condition     = can(regex("^[^@ ]+@[^@ ]+\\.[^@ ]+$", var.notification_email))
    error_message = "Supply an operator email address."
  }
}
variable "database_instance_class" {
  type    = string
  default = "db.t4g.micro"
  validation {
    condition     = contains(["db.t4g.micro", "db.t4g.small", "db.t4g.medium"], var.database_instance_class)
    error_message = "Choose micro, small or medium."
  }
}
variable "ami_id" {
  type        = string
  default     = null
  description = "Pin the first deployed AMI before later applies to avoid unintended host replacement."
}
variable "postgres_version" {
  type        = string
  default     = null
  description = "Optional PostgreSQL 16 minor version. Null selects the latest supported 16 release."
  validation {
    condition     = var.postgres_version == null ? true : can(regex("^16\\.[0-9]+$", var.postgres_version))
    error_message = "Use a PostgreSQL 16 minor version."
  }
}

variable "monthly_budget_usd" {
  type        = number
  default     = 50
  description = "ForemanHQ tagged-resource budget alert threshold; does not cap spending."
  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "Budget must be positive."
  }
}
