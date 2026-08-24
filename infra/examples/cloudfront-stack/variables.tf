variable "name_prefix" {
  description = "Prefix applied to the names of all created resources."
  type        = string
  default     = "rum-example"
}

variable "github_repo" {
  description = "GitHub repository (org/repo) whose Actions workflows may assume the comparator role."
  type        = string
  default     = "example-org/script-inventory"
}

variable "origin_targets" {
  description = "Origins allowed to send beacons, mapped to inventory target ids and the pass they belong to."
  type = list(object({
    origin      = string
    target_id   = string
    target_type = string
  }))
  default = [
    {
      # Staging checkout — feeds the inventory (baseline) pass.
      origin      = "https://checkout.staging.example.com"
      target_id   = "1.0"
      target_type = "inventory"
    },
    {
      # Production checkout — feeds the detection pass.
      origin      = "https://checkout.example.com"
      target_id   = "1.0"
      target_type = "detection"
    },
    {
      # Canary deployment of the same checkout, monitored as its own target.
      origin      = "https://canary.checkout.example.test"
      target_id   = "1.0-canary"
      target_type = "detection"
    },
  ]
}

variable "edge_shared_secret" {
  description = "Shared secret injected by CloudFront as the x-collector-edge-key origin header and verified by the ingest Lambda. Must be non-empty; generate a long random value and rotate edge + core together."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.edge_shared_secret) > 0
    error_message = "edge_shared_secret must not be empty — without it the Function URL is open to direct traffic."
  }
}

variable "lambda_package" {
  description = "Path to the built ingest Lambda zip (run `npm run build:collector` first)."
  type        = string
  default     = "../../../dist/collector/ingest.zip"
}
