variable "origin_function_url" {
  description = "collector-core function_url output (e.g. \"https://abc.lambda-url.ap-southeast-2.on.aws/\"). Requires core edge_auth.mode = \"shared_secret\"."
  type        = string

  validation {
    condition     = can(regex("^https://[^/]+", var.origin_function_url))
    error_message = "origin_function_url must be an https:// URL."
  }
}

variable "edge_shared_secret" {
  description = "Shared secret injected as the x-collector-edge-key origin header; must equal collector-core's edge_auth.secret."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.edge_shared_secret) > 0
    error_message = "edge_shared_secret must not be empty — without it the Function URL is open to direct traffic."
  }
}

variable "name_prefix" {
  description = "Prefix for all resource names."
  type        = string
}

variable "tags" {
  description = "Tags applied to all taggable resources."
  type        = map(string)
  default     = {}
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN (us-east-1) for the custom domain. Set together with route53_zone_id and domain_name, or leave all null."
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = "Route53 hosted zone for the custom domain alias record. Set together with acm_certificate_arn and domain_name, or leave all null."
  type        = string
  default     = null
}

variable "domain_name" {
  description = "Custom domain for the collector endpoint. Set together with acm_certificate_arn and route53_zone_id, or leave all null."
  type        = string
  default     = null
}

variable "waf_rate_limit" {
  description = "WAF rate-based rule limit: requests per 5 minutes per IP."
  type        = number
  default     = 300

  validation {
    condition     = var.waf_rate_limit >= 10
    error_message = "waf_rate_limit must be at least 10 (WAFv2 rate-based statement minimum)."
  }
}

variable "max_body_kb" {
  description = "Maximum accepted request body size in KB; larger bodies are blocked at the edge."
  type        = number
  default     = 32

  validation {
    condition     = var.max_body_kb > 0 && var.max_body_kb <= 64 && floor(var.max_body_kb) == var.max_body_kb
    error_message = "max_body_kb must be a whole number between 1 and 64 (WAFv2 CloudFront body inspection cap)."
  }
}
