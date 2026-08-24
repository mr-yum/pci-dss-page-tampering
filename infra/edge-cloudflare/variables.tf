variable "origin_function_url" {
  description = "collector-core function_url output (e.g. \"https://abc.lambda-url.ap-southeast-2.on.aws/\"). Requires core edge_auth.mode = \"shared_secret\"."
  type        = string

  validation {
    condition     = can(regex("^https://[^/]+", var.origin_function_url))
    error_message = "origin_function_url must be an https:// URL."
  }
}

variable "zone_id" {
  description = "Cloudflare zone the collector record and rulesets are created in."
  type        = string
}

variable "record_name" {
  description = "Fully qualified collector hostname within the zone (e.g. \"collect.example.com\")."
  type        = string
}

variable "edge_shared_secret" {
  description = "Shared secret injected as x-collector-edge-key; must equal collector-core's edge_auth.secret."
  type        = string
  sensitive   = true
}

variable "rate_limit_rpm" {
  description = "Rate limit: requests per minute per IP before mitigation blocks."
  type        = number
  default     = 60

  validation {
    condition     = var.rate_limit_rpm >= 1
    error_message = "rate_limit_rpm must be at least 1."
  }
}
