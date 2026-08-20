output "function_url" {
  description = "Ingest Lambda Function URL — origin for the edge module."
  value       = aws_lambda_function_url.ingest.function_url
}

output "queue_url" {
  description = "URL of the novel-observations SQS queue."
  value       = aws_sqs_queue.novel_observations.url
}

output "queue_arn" {
  description = "ARN of the novel-observations SQS queue."
  value       = aws_sqs_queue.novel_observations.arn
}

output "dlq_arn" {
  description = "ARN of the novel-observations dead-letter queue."
  value       = aws_sqs_queue.dlq.arn
}

output "gha_role_arn" {
  description = "ARN of the OIDC-federated role the comparator workflow assumes."
  value       = aws_iam_role.gha.arn
}

output "novelty_table_name" {
  description = "Name of the DynamoDB novelty table."
  value       = aws_dynamodb_table.novelty.name
}

output "archive_bucket" {
  description = "Name of the S3 beacon archive bucket."
  value       = aws_s3_bucket.archive.bucket
}

output "sns_topic_arn" {
  description = "ARN of the SNS topic receiving collector alarms."
  value       = local.sns_topic_arn
}

output "metric_namespace" {
  description = "CloudWatch namespace for all collector metrics."
  value       = local.metric_namespace
}
