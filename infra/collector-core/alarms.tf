resource "aws_cloudwatch_metric_alarm" "queue_age" {
  alarm_name          = "${var.name_prefix}-novel-observations-age"
  alarm_description   = "Oldest novel-observations message older than ${var.queue_age_alarm_hours}h — comparator drain is stalled."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.queue_age_alarm_hours * 3600
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.novel_observations.name
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]
  tags          = var.tags
}

resource "aws_cloudwatch_metric_alarm" "beacon_volume" {
  for_each = local.target_ids

  alarm_name          = "${var.name_prefix}-beacon-volume-${each.value}"
  alarm_description   = "Beacon volume for target ${each.value} outside its anomaly band — agent rollout regression or telemetry loss."
  comparison_operator = "LessThanLowerOrGreaterThanUpperThreshold"
  threshold_metric_id = "ad1"
  evaluation_periods  = 2
  treat_missing_data  = "breaching"

  metric_query {
    id          = "ad1"
    expression  = "ANOMALY_DETECTION_BAND(m1, 2)"
    label       = "rum_beacons_accepted (expected band)"
    return_data = true
  }

  metric_query {
    id          = "m1"
    return_data = true

    metric {
      namespace   = local.metric_namespace
      metric_name = "rum_beacons_accepted"
      period      = 3600
      stat        = "Sum"

      dimensions = {
        TargetId = each.value
      }
    }
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]
  tags          = var.tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${var.name_prefix}-ingest-error-rate"
  alarm_description   = "Ingest Lambda error rate above 5% — beacons are being lost."
  comparison_operator = "GreaterThanThreshold"
  threshold           = 5
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "rate"
    expression  = "IF(invocations > 0, 100 * errors / invocations, 0)"
    label       = "Error rate (%)"
    return_data = true
  }

  metric_query {
    id = "errors"

    metric {
      namespace   = "AWS/Lambda"
      metric_name = "Errors"
      period      = 300
      stat        = "Sum"

      dimensions = {
        FunctionName = aws_lambda_function.ingest.function_name
      }
    }
  }

  metric_query {
    id = "invocations"

    metric {
      namespace   = "AWS/Lambda"
      metric_name = "Invocations"
      period      = 300
      stat        = "Sum"

      dimensions = {
        FunctionName = aws_lambda_function.ingest.function_name
      }
    }
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]
  tags          = var.tags
}

resource "aws_cloudwatch_metric_alarm" "dlq_depth" {
  alarm_name          = "${var.name_prefix}-novel-observations-dlq"
  alarm_description   = "Novel-observations DLQ is non-empty — observations failed evaluation and need manual replay."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.dlq.name
  }

  alarm_actions = [local.sns_topic_arn]
  ok_actions    = [local.sns_topic_arn]
  tags          = var.tags
}
