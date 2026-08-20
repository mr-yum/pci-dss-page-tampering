resource "aws_sqs_queue" "dlq" {
  name                    = "${var.name_prefix}-novel-observations-dlq"
  sqs_managed_sse_enabled = true
  tags                    = var.tags
}

resource "aws_sqs_queue" "novel_observations" {
  name                       = "${var.name_prefix}-novel-observations"
  visibility_timeout_seconds = 900
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 3
  })

  tags = var.tags
}
