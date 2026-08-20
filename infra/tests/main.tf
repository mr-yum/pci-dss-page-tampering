# Test harness root. Deliberately empty of resources: every run block in the
# *.tftest.hcl files in this directory targets a module under test via its
# `module { source = ... }` override, with mocked providers (no credentials,
# no API calls). See README.md for the invocation commands.

terraform {
  # The modules themselves require only >= 1.7, but this harness's suites use
  # `override_during = plan` in mock_provider blocks, which needs >= 1.11.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}
