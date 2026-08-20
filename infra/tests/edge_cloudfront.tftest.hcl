# edge-cloudfront contract tests: input validation, variable-derived WAF
# settings, the shared-secret origin header, and the all-or-none custom-domain
# trio. Mocked AWS providers (default + us-east-1 alias): no credentials, no
# API calls.

mock_provider "aws" {
  override_during = plan
}

mock_provider "aws" {
  alias           = "us_east_1"
  override_during = plan
}

variables {
  name_prefix         = "tst"
  origin_function_url = "https://mock0000000000000000000000000.lambda-url.eu-west-1.on.aws/"
  edge_shared_secret  = "correct-horse-battery-staple"
}

run "rejects_non_https_origin" {
  command = plan

  module {
    source = "../edge-cloudfront"
  }

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  variables {
    origin_function_url = "http://insecure.example.com/"
  }

  expect_failures = [var.origin_function_url]
}

# The shared secret is required: an empty value would leave the Function URL
# open to direct traffic (pairs with collector-core edge_auth "shared_secret").
run "rejects_empty_edge_shared_secret" {
  command = plan

  module {
    source = "../edge-cloudfront"
  }

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  variables {
    edge_shared_secret = ""
  }

  expect_failures = [var.edge_shared_secret]
}

run "rejects_partial_custom_domain_trio" {
  command = plan

  module {
    source = "../edge-cloudfront"
  }

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  # domain_name without acm_certificate_arn / route53_zone_id must trip the
  # distribution's all-or-none precondition.
  variables {
    domain_name = "collect.example.com"
  }

  expect_failures = [aws_cloudfront_distribution.collector]
}

run "defaults_drive_waf" {
  command = plan

  module {
    source = "../edge-cloudfront"
  }

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  # waf_rate_limit default 300 req / 5 min / IP. `rule` is a set, so search it.
  assert {
    condition     = anytrue([for r in aws_wafv2_web_acl.collector.rule : try(r.statement[0].rate_based_statement[0].limit == 300, false)])
    error_message = "waf_rate_limit default (300) must drive the rate-based rule limit."
  }

  # max_body_kb default 32 → 32 KiB size constraint within the KB_32
  # inspection tier, blocking oversize bodies.
  assert {
    condition     = anytrue([for r in aws_wafv2_web_acl.collector.rule : try(r.statement[0].size_constraint_statement[0].size == 32 * 1024, false)])
    error_message = "max_body_kb default (32) must drive the body size constraint (32768 bytes)."
  }

  assert {
    condition     = aws_wafv2_web_acl.collector.association_config[0].request_body[0].cloudfront[0].default_size_inspection_limit == "KB_32"
    error_message = "The WAF body inspection tier must be the smallest tier covering max_body_kb (KB_32 for the default)."
  }

  # Origin authentication: the distribution must plan the shared-secret
  # origin header (OAC is unusable — sendBeacon cannot send the
  # x-amz-content-sha256 that OAC-signed POSTs require).
  assert {
    condition = anytrue([
      for o in aws_cloudfront_distribution.collector.origin :
      anytrue([for h in o.custom_header : h.name == "x-collector-edge-key"])
    ])
    error_message = "The origin must carry the x-collector-edge-key custom header (shared-secret edge authentication)."
  }

  # No caching, ever: beacons must pass through. The behaviour must be wired
  # to Managed-CachingDisabled, referenced in the module by its documented
  # global constant id, so the plan value is real — not a mock artefact.
  assert {
    condition     = aws_cloudfront_distribution.collector.default_cache_behavior[0].cache_policy_id == "658327ea-f89d-4fab-a63d-7e88639e58f6"
    error_message = "The default cache behaviour must use the Managed-CachingDisabled policy (658327ea-f89d-4fab-a63d-7e88639e58f6)."
  }

  assert {
    condition     = aws_cloudfront_distribution.collector.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https"
    error_message = "Viewers must be forced onto HTTPS."
  }
}
