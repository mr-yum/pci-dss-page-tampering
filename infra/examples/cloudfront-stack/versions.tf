terraform {
  # The modules themselves require only >= 1.7, but this example's test suite
  # uses `override_during = plan` in mock_provider blocks, which needs >= 1.11.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
