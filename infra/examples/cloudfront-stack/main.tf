# CloudFront edge stack: collector-core behind a CloudFront distribution.
# Pairing: the distribution injects the x-collector-edge-key origin header,
# so collector-core MUST run with edge_auth.mode = "shared_secret" and the
# same secret — the ingest Lambda rejects any request carrying the wrong
# (or no) secret. OAC + AWS_IAM is not usable for beacon traffic: OAC-signed
# POSTs require the client to send x-amz-content-sha256, which
# navigator.sendBeacon cannot set (see infra/edge-cloudfront/README.md).

# Default region comes from the environment (AWS_REGION / AWS_PROFILE).
provider "aws" {}

# CloudFront-scoped WAFv2 web ACLs only exist in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

module "collector_core" {
  source = "../../collector-core"

  name_prefix    = var.name_prefix
  origin_targets = var.origin_targets
  lambda_package = var.lambda_package

  # Required trust boundary: only the comparator workflow on the default
  # branch of the inventory repo may assume the queue-consumer role. Widen
  # deliberately (environment/reusable-workflow claims) if your scheduler
  # runs elsewhere.
  oidc_subject_claims = ["repo:${var.github_repo}:ref:refs/heads/main"]

  edge_auth = {
    mode   = "shared_secret"
    secret = var.edge_shared_secret
  }
}

module "edge_cloudfront" {
  source = "../../edge-cloudfront"

  name_prefix         = var.name_prefix
  origin_function_url = module.collector_core.function_url
  edge_shared_secret  = var.edge_shared_secret

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}
