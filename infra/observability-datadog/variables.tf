variable "name_prefix" {
  description = "Prefix applied to monitor names, mirroring collector-core's alarm names (\"<name_prefix>-novel-observations-age\" and friends) so the two estates read as one."
  type        = string
  default     = "rum"
}

variable "metric_namespace" {
  description = "collector-core's metric_namespace output (\"<name_prefix>/rum\", e.g. \"rum/rum\"). Used to derive the Datadog name prefix the collector's custom metrics arrive under via CloudWatch Metric Streams — see custom_metric_prefix."
  type        = string

  validation {
    condition     = length(var.metric_namespace) > 0
    error_message = "metric_namespace must not be empty."
  }
}

variable "custom_metric_prefix" {
  description = "Override for the Datadog metric-name prefix of the collector's custom metrics. When null (default) it is derived from metric_namespace by the CloudWatch → Datadog convention: \"aws.\" + the namespace lowercased with every non-alphanumeric character replaced by an underscore (\"rum/rum\" → \"aws.rum_rum\"). Datadog does not formally document this sanitisation for custom namespaces and conventions drift — verify the streamed metric's actual name in Metrics Explorer (see README) and set this if it differs."
  type        = string
  default     = null
}

variable "queue_name" {
  description = "Name (not ARN) of the novel-observations SQS queue, as it appears in the queuename tag of aws.sqs.* metrics."
  type        = string
}

variable "dlq_name" {
  description = "Name (not ARN) of the novel-observations dead-letter queue, as it appears in the queuename tag of aws.sqs.* metrics."
  type        = string
}

variable "lambda_function_name" {
  description = "Name of the ingest Lambda function, as it appears in the functionname tag of aws.lambda.* metrics."
  type        = string
}

variable "target_ids" {
  description = "Distinct target ids from collector-core's origin_targets map. One beacon-volume anomaly monitor is created per id, scoped by the targetid tag (the TargetId CloudWatch dimension, lowercased on arrival in Datadog)."
  type        = list(string)

  validation {
    condition     = length(var.target_ids) > 0
    error_message = "target_ids must list at least one target id — the beacon-volume tripwire is the alarm that matters for 11.6.1."
  }
}

variable "notification_handle" {
  description = "Datadog notification handle appended to every monitor message (e.g. \"@slack-ops-channel\", \"@pagerduty-rum\")."
  type        = string

  validation {
    condition     = startswith(var.notification_handle, "@")
    error_message = "notification_handle must be a Datadog @-handle (e.g. \"@slack-ops-channel\")."
  }
}

variable "queue_age_alarm_hours" {
  description = "Monitor threshold, in hours, for the age of the oldest unconsumed novel-observations message. Mirrors collector-core's queue_age_alarm_hours."
  type        = number
  default     = 3
}

variable "lambda_error_rate_percent" {
  description = "Ingest Lambda error-rate threshold, in percent. Mirrors collector-core's 5% CloudWatch alarm."
  type        = number
  default     = 5
}

variable "canary_metric" {
  description = "Metric name of the canary heartbeat emitted by the inventory repository's rum-canary workflow (docs/rum/canary-workflow.md). Set to null to omit the dead-man monitor when the canary is not deployed."
  type        = string
  default     = "rum_canary_passed"
}

variable "canary_target_id" {
  description = "targetid tag value the canary heartbeat is emitted under (the TargetId dimension of the put-metric-data call in docs/rum/canary-workflow.md)."
  type        = string
  default     = "canary"
}

variable "volume_evaluation_window" {
  description = "Datadog query window the beacon-volume anomaly monitor evaluates over."
  type        = string
  default     = "last_4h"
}

variable "volume_trigger_window" {
  description = "How long beacon volume must sit outside its anomaly band before the monitor triggers (also the recovery window). Mirrors the CloudWatch alarm's 2 × 1h evaluation periods loosely; last_1h keeps the tripwire responsive."
  type        = string
  default     = "last_1h"
}

variable "volume_anomaly_deviations" {
  description = "Width of the anomaly band in deviations. Mirrors the CloudWatch ANOMALY_DETECTION_BAND(m1, 2) band width."
  type        = number
  default     = 2
}

variable "volume_no_data_minutes" {
  description = "Minutes without any beacon-volume datapoints for a target before the monitor notifies NO DATA. Missing data is the suppression signal — an attacker who strips the agent silences the metric, so silence must page. Default 120 mirrors the CloudWatch alarm's two breaching 1h periods."
  type        = number
  default     = 120
}

variable "canary_no_data_minutes" {
  description = "Minutes without a canary heartbeat before the dead-man monitor notifies NO DATA. The heartbeat is hourly; 120 tolerates one missed/slow cycle and pages on the second, matching docs/rum/canary-workflow.md."
  type        = number
  default     = 120
}

variable "threshold_evaluation_window" {
  description = "Datadog query window for the single-period threshold monitors (queue age, DLQ depth). last_5m mirrors the CloudWatch alarms' one 5-minute evaluation period, so a recovered transient breach stops paging within ~5 minutes rather than being retained by a longer max() window."
  type        = string
  default     = "last_5m"
}

variable "error_rate_evaluation_window" {
  description = "Datadog query window for the Lambda error-rate monitor. Datadog metric monitors have no M-of-N evaluation, so a single traffic-weighted last_15m window approximates CloudWatch's 3×5-minute periods with 2-to-alarm: both require elevated errors sustained across the same span; the Datadog form smooths a single bad 5-minute burst slightly more. Documented in the README as a conscious semantic difference, not parity."
  type        = string
  default     = "last_15m"
}

variable "evaluation_delay_seconds" {
  description = "Seconds to delay monitor evaluation so late-arriving CloudWatch datapoints are not read as gaps. 300 suits Metric Streams (~2-3 min end-to-end); raise to 900 if you are stuck on API polling."
  type        = number
  default     = 300
}

variable "tags" {
  description = "Datadog tags (\"key:value\" strings) applied to every monitor."
  type        = list(string)
  default     = []
}
