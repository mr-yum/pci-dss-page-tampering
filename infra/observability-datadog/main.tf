# Datadog monitors mirroring collector-core's CloudWatch alarms (alarms.tf),
# reading the same metrics after they flow CloudWatch → Datadog. Emission stays
# CloudWatch — see README.md for why this module exists at all and what the
# Metric Streams prerequisite buys the timing-sensitive monitors.
#
# Runbook one-liners in the messages mirror docs/rum/IMPLEMENTATION.md step 7.

locals {
  # CloudWatch → Datadog naming for custom-namespace metrics arriving via the
  # AWS integration / Metric Streams: "aws." + the namespace lowercased with
  # every character outside [a-z0-9] replaced by an underscore (Datadog metric
  # names admit only ASCII alphanumerics, underscores and periods — anything
  # else is converted to an underscore). "rum/rum" → "aws.rum_rum". Datadog
  # does not formally document the custom-namespace case, so the derivation is
  # overridable — verify in Metrics Explorer (README) and set
  # custom_metric_prefix if your metrics landed under a different name.
  custom_metric_prefix = coalesce(
    var.custom_metric_prefix,
    "aws.${replace(lower(var.metric_namespace), "/[^a-z0-9]/", "_")}",
  )

  # Sev-2, per IMPLEMENTATION.md step 7: none of these pages in the night on
  # its own, and none is a next-sprint ticket either.
  priority = 2
}

# (a) Queue age — comparator drain stalled.
# Mirrors: aws_cloudwatch_metric_alarm.queue_age (Maximum, > hours * 3600).
resource "datadog_monitor" "queue_age" {
  name    = "${var.name_prefix}-novel-observations-age"
  type    = "query alert"
  message = <<-EOT
    Oldest novel-observations message older than ${var.queue_age_alarm_hours}h — the comparator drain is stalled.

    Runbook: is the hourly rum-compare workflow running, and can it still assume the comparator role (gha_role_arn)? See docs/rum/IMPLEMENTATION.md step 7.

    Notify: ${var.notification_handle}
  EOT

  query = "max(${var.short_evaluation_window}):max:aws.sqs.approximate_age_of_oldest_message{queuename:${var.queue_name}} > ${var.queue_age_alarm_hours * 3600}"

  monitor_thresholds {
    critical = var.queue_age_alarm_hours * 3600
  }

  # Mirrors treat_missing_data = "notBreaching": an idle queue reports zero
  # age, and gaps here are a metrics-delivery concern, not a drain signal.
  notify_no_data      = false
  require_full_window = false
  evaluation_delay    = var.evaluation_delay_seconds
  priority            = local.priority
  tags                = var.tags
}

# (b) Per-target beacon-volume anomaly — the suppression tripwire (11.6.1).
# Mirrors: aws_cloudwatch_metric_alarm.beacon_volume (ANOMALY_DETECTION_BAND
# width 2, hourly Sum per TargetId, missing data breaching). Silence IS the
# signal: an attacker who strips the agent to blind the monitor produces no
# datapoints, so NO DATA must notify exactly like an anomaly.
resource "datadog_monitor" "beacon_volume" {
  for_each = toset(var.target_ids)

  name    = "${var.name_prefix}-beacon-volume-${each.value}"
  type    = "query alert"
  message = <<-EOT
    Beacon volume for target ${each.value} is outside its anomaly band — or has stopped arriving entirely (NO DATA notifies by design: silence is the suppression signal).

    Runbook: view source on the target page — is the agent tag still there, and does the CSP still allow the collector endpoint? See docs/rum/IMPLEMENTATION.md step 7.

    Notify: ${var.notification_handle}
  EOT

  query = "avg(${var.volume_evaluation_window}):anomalies(sum:${local.custom_metric_prefix}.rum_beacons_accepted{targetid:${lower(each.value)}}, 'agile', ${var.volume_anomaly_deviations}, direction='both', alert_window='${var.volume_trigger_window}') >= 1"

  monitor_thresholds {
    critical = 1
  }

  monitor_threshold_windows {
    trigger_window  = var.volume_trigger_window
    recovery_window = var.volume_trigger_window
  }

  # Mirrors treat_missing_data = "breaching".
  notify_no_data      = true
  no_data_timeframe   = var.volume_no_data_minutes
  require_full_window = false
  evaluation_delay    = var.evaluation_delay_seconds
  priority            = local.priority
  tags                = var.tags
}

# (c) Ingest Lambda error rate — beacons are being lost.
# Mirrors: aws_cloudwatch_metric_alarm.lambda_errors
# (IF(invocations > 0, 100 * errors / invocations, 0) > 5).
resource "datadog_monitor" "lambda_error_rate" {
  name    = "${var.name_prefix}-ingest-error-rate"
  type    = "query alert"
  message = <<-EOT
    Ingest Lambda error rate above ${var.lambda_error_rate_percent}% — beacons are being lost.

    Runbook: check the ingest Lambda logs; a schema drift between a newer agent and an older ingest zip is the usual cause of a sudden step change. See docs/rum/IMPLEMENTATION.md step 7.

    Notify: ${var.notification_handle}
  EOT

  query = "sum(${var.short_evaluation_window}):100 * sum:aws.lambda.errors{functionname:${var.lambda_function_name}}.as_count() / sum:aws.lambda.invocations{functionname:${var.lambda_function_name}}.as_count() > ${var.lambda_error_rate_percent}"

  monitor_thresholds {
    critical = var.lambda_error_rate_percent
  }

  # Mirrors the CloudWatch expression's zero-invocations guard: no invocations
  # means no ratio, and that gap must not page (notBreaching).
  notify_no_data      = false
  require_full_window = false
  evaluation_delay    = var.evaluation_delay_seconds
  priority            = local.priority
  tags                = var.tags
}

# (d) DLQ depth — an observation failed evaluation three times.
# Mirrors: aws_cloudwatch_metric_alarm.dlq_depth (Maximum visible > 0).
resource "datadog_monitor" "dlq_depth" {
  name    = "${var.name_prefix}-novel-observations-dlq"
  type    = "query alert"
  message = <<-EOT
    The novel-observations DLQ is non-empty — an observation failed evaluation three times and needs manual replay. Never ignore.

    Runbook: pull the message, replay it locally against the comparator, and fix forward; the raw beacon is also in the archive. See docs/rum/IMPLEMENTATION.md step 7.

    Notify: ${var.notification_handle}
  EOT

  query = "max(${var.short_evaluation_window}):max:aws.sqs.approximate_number_of_messages_visible{queuename:${var.dlq_name}} > 0"

  monitor_thresholds {
    critical = 0
  }

  # Mirrors treat_missing_data = "notBreaching".
  notify_no_data      = false
  require_full_window = false
  evaluation_delay    = var.evaluation_delay_seconds
  priority            = local.priority
  tags                = var.tags
}

# (e) Canary dead-man's switch — the whole path is down, including the
# workflows not running at all. Mirrors the aws_cloudwatch_metric_alarm
# "rum-canary-silent" from docs/rum/canary-workflow.md (Sum < 1 over 1h,
# 2 evaluation periods, missing data breaching). The heartbeat metric only
# exists while post → ingest → first sighting → drain → alert → assertion all
# work, so absence covers every failure mode; NO DATA is the primary trigger.
resource "datadog_monitor" "canary_silent" {
  count = var.canary_metric != null ? 1 : 0

  name    = "${var.name_prefix}-canary-silent"
  type    = "query alert"
  message = <<-EOT
    The RUM canary heartbeat has stopped — the whole real-user observation path is down, including the possibility that the workflows are not running at all.

    Runbook: work the step 8 walk-back list in docs/rum/IMPLEMENTATION.md (post → ingest → first sighting → drain → alert → assertion).

    Notify: ${var.notification_handle}
  EOT

  query = "sum(last_${var.canary_no_data_minutes}m):sum:${local.custom_metric_prefix}.${var.canary_metric}{targetid:${lower(var.canary_target_id)}} < 1"

  monitor_thresholds {
    critical = 1
  }

  # Mirrors treat_missing_data = "breaching": the dead-man's switch exists to
  # fire on silence.
  notify_no_data      = true
  no_data_timeframe   = var.canary_no_data_minutes
  require_full_window = false
  evaluation_delay    = var.evaluation_delay_seconds
  priority            = local.priority
  tags                = var.tags
}
