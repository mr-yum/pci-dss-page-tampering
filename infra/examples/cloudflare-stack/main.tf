# Cloudflare edge stack: collector-core behind a proxied Cloudflare record.
# Pairing: Cloudflare cannot SigV4-sign origin requests, so collector-core
# MUST run with edge_auth.mode = "shared_secret" — Cloudflare injects the
# x-collector-edge-key header and the ingest Lambda rejects any request
# carrying the wrong (or no) secret.

# Default region and credentials come from the environment (AWS_REGION / AWS_PROFILE).
provider "aws" {}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

module "collector_core" {
  source = "../../collector-core"

  name_prefix    = var.name_prefix
  github_repo    = var.github_repo
  origin_targets = var.origin_targets
  lambda_package = var.lambda_package

  edge_auth = {
    mode   = "shared_secret"
    secret = var.edge_shared_secret
  }
}

module "edge_cloudflare" {
  source = "../../edge-cloudflare"

  origin_function_url = module.collector_core.function_url
  zone_id             = var.zone_id
  record_name         = var.record_name
  edge_shared_secret  = var.edge_shared_secret
}
