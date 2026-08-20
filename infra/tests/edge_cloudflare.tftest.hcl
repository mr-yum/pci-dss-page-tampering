# edge-cloudflare contract tests: input validation, the proxied record (every
# request must traverse Cloudflare for rate limiting + header injection), the
# variable-derived rate limit, and the endpoint output. Mocked Cloudflare
# provider: no credentials, no API calls.

mock_provider "cloudflare" {
  override_during = plan
}

variables {
  origin_function_url = "https://mock0000000000000000000000000.lambda-url.eu-west-1.on.aws/"
  zone_id             = "0123456789abcdef0123456789abcdef"
  record_name         = "collect.example.com"
  edge_shared_secret  = "correct-horse-battery-staple"
}

run "rejects_non_https_origin" {
  command = plan

  module {
    source = "../edge-cloudflare"
  }

  variables {
    origin_function_url = "http://insecure.example.com/"
  }

  expect_failures = [var.origin_function_url]
}

run "rejects_zero_rate_limit" {
  command = plan

  module {
    source = "../edge-cloudflare"
  }

  variables {
    rate_limit_rpm = 0
  }

  expect_failures = [var.rate_limit_rpm]
}

run "record_rulesets_and_endpoint" {
  command = plan

  module {
    source = "../edge-cloudflare"
  }

  # Proxied, or the rate limit and header injection never see the traffic.
  assert {
    condition     = cloudflare_dns_record.collector.proxied == true
    error_message = "The collector record must be proxied so every request traverses Cloudflare."
  }

  # CNAME to the Function URL host, derived from origin_function_url.
  assert {
    condition     = cloudflare_dns_record.collector.content == "mock0000000000000000000000000.lambda-url.eu-west-1.on.aws"
    error_message = "The record must point at the Function URL's host."
  }

  # rate_limit_rpm default 60 → ruleset requests_per_period over a 60s period.
  assert {
    condition     = cloudflare_ruleset.rate_limit.rules[0].ratelimit.requests_per_period == 60
    error_message = "rate_limit_rpm default (60) must drive the rate-limit ruleset."
  }

  assert {
    condition     = cloudflare_ruleset.rate_limit.rules[0].ratelimit.period == 60
    error_message = "The rate-limit period must be one minute."
  }

  # The transform rule injects the shared secret on collector-host requests.
  assert {
    condition     = cloudflare_ruleset.edge_key.rules[0].action_parameters.headers["x-collector-edge-key"].value == "correct-horse-battery-staple"
    error_message = "The transform rule must inject edge_shared_secret as x-collector-edge-key."
  }

  # Endpoint is https://<record_name>, fully known at plan.
  assert {
    condition     = output.collector_endpoint == "https://collect.example.com"
    error_message = "collector_endpoint must be https://<record_name>."
  }
}
