resource "aws_cloudwatch_log_group" "ingest" {
  name              = "/aws/lambda/${var.name_prefix}-ingest"
  retention_in_days = 30
  tags              = var.tags
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ingest" {
  name               = "${var.name_prefix}-ingest"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "ingest" {
  statement {
    sid       = "ArchivePut"
    actions   = ["firehose:PutRecord"]
    resources = [aws_kinesis_firehose_delivery_stream.archive.arn]
  }

  statement {
    sid = "NoveltyWrite"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]
    resources = [aws_dynamodb_table.novelty.arn]
  }

  statement {
    sid       = "QueueSend"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.novel_observations.arn]
  }

  statement {
    sid = "Encrypt"
    actions = [
      "kms:Encrypt",
      "kms:GenerateDataKey",
      # Decrypt is needed at cold start to read the KMS-encrypted environment
      # (kms_key_arn on the function; EDGE_SHARED_SECRET lives there).
      "kms:Decrypt",
    ]
    resources = [local.kms_key_arn]
  }

  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.ingest.arn}:*"]
  }

  # PutMetricData supports no resource-level scoping; the namespace condition
  # key is the tightest available bound (collector-ingest.md metrics obligation).
  statement {
    sid       = "Metrics"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = [local.metric_namespace]
    }
  }
}

resource "aws_iam_role_policy" "ingest" {
  name   = "ingest"
  role   = aws_iam_role.ingest.id
  policy = data.aws_iam_policy_document.ingest.json
}

resource "aws_lambda_function" "ingest" {
  function_name    = "${var.name_prefix}-ingest"
  role             = aws_iam_role.ingest.arn
  runtime          = "nodejs24.x"
  handler          = "ingest.handler"
  architectures    = ["arm64"]
  filename         = var.lambda_package
  source_code_hash = filebase64sha256(var.lambda_package)
  memory_size      = 256
  timeout          = 15

  # Encrypt environment variables at rest with the module's key rather than
  # the AWS-managed default: EDGE_SHARED_SECRET lives in the environment.
  kms_key_arn = local.kms_key_arn

  environment {
    variables = merge(
      {
        ORIGIN_TARGETS   = jsonencode(var.origin_targets)
        EDGE_AUTH_MODE   = var.edge_auth.mode
        FIREHOSE_STREAM  = aws_kinesis_firehose_delivery_stream.archive.name
        NOVELTY_TABLE    = aws_dynamodb_table.novelty.name
        QUEUE_URL        = aws_sqs_queue.novel_observations.url
        NOVELTY_TTL_DAYS = tostring(var.novelty_ttl_days)
        METRIC_NAMESPACE = local.metric_namespace
      },
      var.edge_auth.mode == "shared_secret" ? { EDGE_SHARED_SECRET = var.edge_auth.secret } : {}
    )
  }

  tags = var.tags

  depends_on = [aws_cloudwatch_log_group.ingest]
}

resource "aws_lambda_function_url" "ingest" {
  function_name      = aws_lambda_function.ingest.function_name
  authorization_type = var.edge_auth.mode == "aws_iam" ? "AWS_IAM" : "NONE"
}
