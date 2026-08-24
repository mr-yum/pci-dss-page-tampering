# collector-core contract tests (contracts/terraform-modules.md §Test obligations):
# input validation, defaults, alarm presence, and edge_auth → Function URL
# authorization pairing. Mocked AWS provider: no credentials, no API calls.
# `override_during = plan` makes mocked computed attributes known at plan time
# so plan-level assertions can see them.

mock_provider "aws" {
  override_during = plan

  # The AWS provider client-side validates IAM policy JSON; the auto-generated
  # mock string is not JSON, so give the data source a well-formed document.
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }

  # Known-at-plan queue ARN so the redrive_policy JSON (which embeds the DLQ
  # ARN) is assertable at plan time.
  mock_resource "aws_sqs_queue" {
    defaults = {
      arn = "arn:aws:sqs:eu-west-1:111111111111:mock-queue"
    }
  }
}

variables {
  name_prefix         = "tst"
  github_repo         = "example-org/script-inventory"
  lambda_package      = "./fixtures/placeholder.zip"
  oidc_subject_claims = ["repo:example-org/script-inventory:ref:refs/heads/main"]

  origin_targets = [
    {
      origin      = "https://checkout.staging.example.com"
      target_id   = "1.0"
      target_type = "inventory"
    },
    {
      origin      = "https://checkout.example.com"
      target_id   = "1.0"
      target_type = "detection"
    },
    {
      origin      = "https://canary.checkout.example.test"
      target_id   = "1.0-canary"
      target_type = "detection"
    },
  ]

  edge_auth = {
    mode = "aws_iam"
  }
}

# --- Input validation -------------------------------------------------------

run "rejects_invalid_target_type" {
  command = plan

  module {
    source = "../collector-core"
  }

  variables {
    origin_targets = [
      {
        origin      = "https://checkout.example.com"
        target_id   = "1.0"
        target_type = "production" # not inventory|detection
      },
    ]
  }

  expect_failures = [var.origin_targets]
}

run "rejects_empty_oidc_subject_claims" {
  command = plan

  module {
    source = "../collector-core"
  }

  variables {
    oidc_subject_claims = []
  }

  expect_failures = [var.oidc_subject_claims]
}

# The subject allowlist is REQUIRED (no permissive fallback exists), and the
# supplied list must feed the trust policy condition verbatim. The mocked
# aws_iam_policy_document overrides its rendered `json`, so we assert on the
# data source's configured statement input instead.
run "oidc_subject_claims_feed_trust_policy" {
  command = plan

  module {
    source = "../collector-core"
  }

  variables {
    oidc_subject_claims = ["repo:example-org/script-inventory:ref:refs/heads/main"]
  }

  assert {
    condition = contains([
      for c in data.aws_iam_policy_document.gha_assume.statement[0].condition :
      c.variable if c.test == "StringLike"
    ], "token.actions.githubusercontent.com:sub")
    error_message = "The comparator role trust policy must gate the OIDC subject with StringLike."
  }

  assert {
    condition = anytrue([
      for c in data.aws_iam_policy_document.gha_assume.statement[0].condition :
      contains(tolist(c.values), "repo:example-org/script-inventory:ref:refs/heads/main")
      if c.variable == "token.actions.githubusercontent.com:sub"
    ])
    error_message = "oidc_subject_claims must feed the trust policy's subject condition values."
  }
}

run "rejects_invalid_edge_auth_mode" {
  command = plan

  module {
    source = "../collector-core"
  }

  variables {
    edge_auth = {
      mode = "mtls" # not aws_iam|shared_secret
    }
  }

  expect_failures = [var.edge_auth]
}

run "rejects_shared_secret_mode_without_secret" {
  command = plan

  module {
    source = "../collector-core"
  }

  variables {
    edge_auth = {
      mode = "shared_secret"
    }
  }

  expect_failures = [var.edge_auth]
}

# --- Defaults, alarms, and aws_iam pairing ----------------------------------

run "defaults_alarms_and_aws_iam_pairing" {
  command = plan

  module {
    source = "../collector-core"
  }

  # archive_retention_days default 365 → S3 lifecycle expiration.
  assert {
    condition     = aws_s3_bucket_lifecycle_configuration.archive.rule[0].expiration[0].days == 365
    error_message = "archive_retention_days default (365) must drive the S3 lifecycle expiration."
  }

  # novelty_ttl_days default 90 → ingest Lambda env.
  assert {
    condition     = aws_lambda_function.ingest.environment[0].variables["NOVELTY_TTL_DAYS"] == "90"
    error_message = "novelty_ttl_days default (90) must reach the ingest Lambda's NOVELTY_TTL_DAYS env var."
  }

  # DynamoDB TTL is enabled so novelty records actually expire.
  assert {
    condition     = aws_dynamodb_table.novelty.ttl[0].enabled == true
    error_message = "The novelty table must have TTL enabled."
  }

  # queue_age_alarm_hours default 3 → alarm threshold in seconds.
  assert {
    condition     = aws_cloudwatch_metric_alarm.queue_age.threshold == 3 * 3600
    error_message = "queue_age_alarm_hours default (3) must drive the queue-age alarm threshold (10800s)."
  }

  # DLQ alarm fires on any visible message.
  assert {
    condition     = aws_cloudwatch_metric_alarm.dlq_depth.threshold == 0
    error_message = "The DLQ alarm must fire as soon as the DLQ is non-empty (threshold 0, GreaterThanThreshold)."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.dlq_depth.comparison_operator == "GreaterThanThreshold"
    error_message = "The DLQ alarm must use GreaterThanThreshold."
  }

  # Lambda error-rate alarm exists.
  assert {
    condition     = aws_cloudwatch_metric_alarm.lambda_errors.threshold == 5
    error_message = "The ingest Lambda error-rate alarm must fire above 5%."
  }

  # One anomaly alarm per distinct target_id (3 entries, 2 distinct ids).
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.beacon_volume) == 2
    error_message = "Exactly one beacon-volume anomaly alarm per distinct target_id is required."
  }

  assert {
    condition     = alltrue([for id in ["1.0", "1.0-canary"] : contains(keys(aws_cloudwatch_metric_alarm.beacon_volume), id)])
    error_message = "Beacon-volume anomaly alarms must be keyed by the distinct target ids."
  }

  # Queue redrive: three delivery attempts before the DLQ.
  assert {
    condition     = jsondecode(aws_sqs_queue.novel_observations.redrive_policy).maxReceiveCount == 3
    error_message = "The novel-observations queue must redrive to the DLQ after 3 receives."
  }

  # edge_auth.mode = "aws_iam" → Function URL requires SigV4. Neither provided
  # edge module uses this mode (sendBeacon cannot satisfy OAC-signed POSTs);
  # it remains valid for SigV4-capable, non-beacon consumers.
  assert {
    condition     = aws_lambda_function_url.ingest.authorization_type == "AWS_IAM"
    error_message = "edge_auth.mode \"aws_iam\" must produce a Function URL with authorization_type AWS_IAM."
  }
}

# --- shared_secret pairing --------------------------------------------------

run "shared_secret_mode_opens_function_url" {
  command = plan

  module {
    source = "../collector-core"
  }

  variables {
    edge_auth = {
      mode   = "shared_secret"
      secret = "correct-horse-battery-staple"
    }
  }

  # NONE is correct here: the edge-injected x-collector-edge-key header is the
  # gate, verified by the Lambda itself (pairing for both provided edges).
  assert {
    condition     = aws_lambda_function_url.ingest.authorization_type == "NONE"
    error_message = "edge_auth.mode \"shared_secret\" must produce a Function URL with authorization_type NONE."
  }

  assert {
    condition     = aws_lambda_function.ingest.environment[0].variables["EDGE_AUTH_MODE"] == "shared_secret"
    error_message = "The ingest Lambda must be told it runs in shared_secret mode."
  }
}
