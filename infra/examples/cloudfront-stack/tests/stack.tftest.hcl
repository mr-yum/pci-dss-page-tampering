# CloudFront example tests (contracts/terraform-modules.md §Test obligations):
# the composition plans cleanly with mocked providers, its outputs are wired to
# the right modules, an empty shared secret is rejected, and the documented
# edge_auth pairing holds — this example runs collector-core in
# "shared_secret" mode, which yields an open (NONE) Function URL gated by the
# CloudFront-injected x-collector-edge-key origin header. (OAC + AWS_IAM is
# not usable for beacon traffic: OAC-signed POSTs require a client-supplied
# x-amz-content-sha256 header, which navigator.sendBeacon cannot set.)
# No credentials, no API calls; run with:
#   terraform -chdir=infra/examples/cloudfront-stack init -backend=false
#   terraform -chdir=infra/examples/cloudfront-stack test

mock_provider "aws" {
  override_during = plan

  # The AWS provider client-side validates IAM policy JSON; the auto-generated
  # mock string is not JSON, so give the data source a well-formed document.
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }

  # Known-at-plan values for the attributes the example's outputs re-export,
  # so output wiring is assertable at plan time.
  mock_resource "aws_lambda_function_url" {
    defaults = {
      function_url = "https://mock0000000000000000000000000.lambda-url.eu-west-1.on.aws/"
    }
  }

  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      domain_name    = "mock1234567890.cloudfront.net"
      hosted_zone_id = "Z2FDTNDATAQYW2"
    }
  }

  mock_resource "aws_sqs_queue" {
    defaults = {
      arn = "arn:aws:sqs:eu-west-1:111111111111:mock-queue"
      url = "https://sqs.eu-west-1.amazonaws.com/111111111111/mock-queue"
    }
  }

  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::111111111111:role/mock-role"
    }
  }
}

mock_provider "aws" {
  alias           = "us_east_1"
  override_during = plan
}

variables {
  edge_shared_secret = "correct-horse-battery-staple"

  # The example's default points at the real build output
  # (dist/collector/ingest.zip); tests must run without a prior build step.
  lambda_package = "../../tests/fixtures/placeholder.zip"
}

run "stack_plans_and_wires_outputs" {
  command = plan

  # collector_endpoint comes from edge-cloudfront: https://<distribution domain>.
  assert {
    condition     = output.collector_endpoint == "https://mock1234567890.cloudfront.net"
    error_message = "collector_endpoint must re-export edge-cloudfront's endpoint (the distribution domain when no custom domain is set)."
  }

  # gha_role_arn and queue_url come from collector-core.
  assert {
    condition     = output.gha_role_arn == "arn:aws:iam::111111111111:role/mock-role"
    error_message = "gha_role_arn must re-export collector-core's OIDC-federated role ARN."
  }

  assert {
    condition     = output.queue_url == "https://sqs.eu-west-1.amazonaws.com/111111111111/mock-queue"
    error_message = "queue_url must re-export collector-core's novel-observations queue URL."
  }
}

# The shared secret is the only thing keeping direct-to-Function-URL traffic
# out; an empty value must be rejected before any plan.
run "rejects_empty_shared_secret" {
  command = plan

  variables {
    edge_shared_secret = ""
  }

  expect_failures = [var.edge_shared_secret]
}

# The documented pairing for this stack: the distribution injects the
# x-collector-edge-key origin header, so core must run in "shared_secret"
# mode, yielding an open (NONE) Function URL whose handler verifies the
# secret. Asserted against collector-core directly (test assertions cannot
# reach into a child module's resources) with the exact edge_auth shape the
# example passes.
run "core_pairing_shared_secret" {
  command = plan

  module {
    source = "../../collector-core"
  }

  variables {
    name_prefix         = "tst"
    github_repo         = "example-org/script-inventory"
    oidc_subject_claims = ["repo:example-org/script-inventory:ref:refs/heads/main"]
    origin_targets = [
      {
        origin      = "https://checkout.example.com"
        target_id   = "1.0"
        target_type = "detection"
      },
    ]
    edge_auth = {
      mode   = "shared_secret"
      secret = "correct-horse-battery-staple"
    }
  }

  assert {
    condition     = aws_lambda_function_url.ingest.authorization_type == "NONE"
    error_message = "The CloudFront stack pairs with a shared-secret core: the Function URL must be NONE (the handler verifies x-collector-edge-key)."
  }
}
