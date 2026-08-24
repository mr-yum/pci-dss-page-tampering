variable "origin_targets" {
  description = "Origin-to-target mapping: exact scheme+host[+port] origins mapped to canonical inventory target ids and the pass they belong to. Sole authority on environment identity for the ingest Lambda."
  type = list(object({
    origin      = string
    target_id   = string
    target_type = string
  }))

  validation {
    condition     = alltrue([for t in var.origin_targets : contains(["inventory", "detection"], t.target_type)])
    error_message = "Each origin_targets entry must have target_type \"inventory\" or \"detection\"."
  }
}

variable "name_prefix" {
  description = "Prefix applied to the names of all created resources."
  type        = string
}

variable "tags" {
  description = "Tags applied to all created resources that support tagging."
  type        = map(string)
  default     = {}
}

variable "kms_key_arn" {
  description = "ARN of an existing KMS key for encryption at rest. When null, the module creates a key and alias."
  type        = string
  default     = null
}

variable "alert_sns_topic_arn" {
  description = "ARN of an existing SNS topic for CloudWatch alarm notifications. When null, the module creates one."
  type        = string
  default     = null
}

variable "github_oidc_provider_arn" {
  description = "ARN of an existing GitHub Actions OIDC provider (one per account). When null, the module creates the provider."
  type        = string
  default     = null
}

# SECURITY: matched with StringLike in the trust policy. The repository is
# embedded in the claims themselves (e.g. ["repo:ORG/REPO:ref:refs/heads/main"]
# for the scheduled run on the default branch, or an environment claim
# ["repo:ORG/REPO:environment:production"], or a reusable-workflow claim) —
# there is deliberately no separate repo variable and no permissive fallback.
variable "oidc_subject_claims" {
  description = "OIDC token subject (`sub`) claims allowed to assume the comparator role, matched with StringLike. Required with no default: this role can consume and delete security observations, so the trust boundary must be an explicit operator decision. Use your comparator workflow's exact subject (e.g. \"repo:ORG/REPO:ref:refs/heads/main\", or an environment/reusable-workflow claim); a broad claim like \"repo:ORG/REPO:*\" trusts every ref/tag/PR/environment subject in the repo — legal, but a conscious choice you must write down."
  type        = list(string)

  validation {
    condition     = length(var.oidc_subject_claims) > 0
    error_message = "oidc_subject_claims must be a non-empty list of GitHub OIDC subject claims."
  }
}

variable "edge_auth" {
  description = "Edge-to-origin authentication: mode \"shared_secret\" (the edge injects the x-collector-edge-key header; secret required — used by both provided edge modules) or \"aws_iam\" (SigV4-signed callers; not usable behind the provided edges, since sendBeacon POSTs cannot carry the x-amz-content-sha256 header OAC signing requires)."
  type = object({
    mode   = string
    secret = optional(string, null)
  })
  sensitive = true

  validation {
    condition     = contains(["aws_iam", "shared_secret"], var.edge_auth.mode)
    error_message = "edge_auth.mode must be \"aws_iam\" or \"shared_secret\"."
  }

  validation {
    condition     = var.edge_auth.mode != "shared_secret" || (var.edge_auth.secret != null && var.edge_auth.secret != "")
    error_message = "edge_auth.secret is required when edge_auth.mode is \"shared_secret\"."
  }
}

variable "archive_retention_days" {
  description = "Days to retain verbatim beacons in the S3 archive before lifecycle expiration."
  type        = number
  default     = 365
}

variable "novelty_ttl_days" {
  description = "Days after last sighting before a novelty record expires, making a returning script a fresh first sighting."
  type        = number
  default     = 90
}

variable "queue_age_alarm_hours" {
  description = "Alarm threshold, in hours, for the age of the oldest unconsumed novel-observations message."
  type        = number
  default     = 3
}

variable "lambda_package" {
  description = "Path to the released ingest Lambda deployment zip."
  type        = string
  default     = "../../dist/collector/ingest.zip"
}
