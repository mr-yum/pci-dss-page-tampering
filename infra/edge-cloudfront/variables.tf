variable "origin_function_url" {
  description = "collector-core function_url output (e.g. \"https://abc.lambda-url.ap-southeast-2.on.aws/\"). Requires core edge_auth.mode = \"shared_secret\"."
  type        = string

  # Pinned to the Lambda Function URL shape rather than any HTTPS host:
  # CloudFront injects edge_shared_secret as a custom header to whatever origin
  # host is parsed from this URL, so a misconfigured origin would receive (and
  # could replay) the secret. Constraining the shape keeps the secret bound to a
  # genuine Function URL.
  validation {
    condition     = can(regex("^https://[a-z0-9]+\\.lambda-url\\.[a-z0-9-]+\\.on\\.aws/?$", var.origin_function_url))
    error_message = "origin_function_url must be a Lambda Function URL: https://<id>.lambda-url.<region>.on.aws/ (no path)."
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

  # CloudFront viewer certificates must live in us-east-1 regardless of the
  # distribution's own provider region; a cert from any other region is rejected
  # only at apply time, so fail fast here.
  validation {
    condition     = var.acm_certificate_arn == null || can(regex("^arn:aws:acm:us-east-1:[0-9]{12}:certificate/.+$", var.acm_certificate_arn))
    error_message = "acm_certificate_arn must be a us-east-1 ACM certificate ARN (arn:aws:acm:us-east-1:<account>:certificate/<id>) — CloudFront viewer certs must be in us-east-1."
  }
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
