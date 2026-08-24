resource "aws_iam_openid_connect_provider" "github" {
  count = var.github_oidc_provider_arn == null ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  tags           = var.tags
}

data "aws_iam_policy_document" "gha_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.oidc_subject_claims
    }
  }
}

resource "aws_iam_role" "gha" {
  name               = "${var.name_prefix}-gha-comparator"
  assume_role_policy = data.aws_iam_policy_document.gha_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "gha" {
  statement {
    sid = "QueueConsume"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.novel_observations.arn]
  }

  # GetMetricData supports neither resource-level scoping nor the namespace
  # condition key; PutMetricData gets the namespace bound.
  statement {
    sid       = "MetricsRead"
    actions   = ["cloudwatch:GetMetricData"]
    resources = ["*"]
  }

  statement {
    sid       = "MetricsWrite"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = [local.metric_namespace]
    }
  }
}

resource "aws_iam_role_policy" "gha" {
  name   = "comparator"
  role   = aws_iam_role.gha.id
  policy = data.aws_iam_policy_document.gha.json
}
