terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
      # CloudFront-scoped WAFv2 resources only exist in us-east-1; the consumer
      # must pass an aliased us-east-1 provider alongside its default region.
      configuration_aliases = [aws.us_east_1]
    }
  }
}
