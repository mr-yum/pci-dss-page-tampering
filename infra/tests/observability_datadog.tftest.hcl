# observability-datadog contract tests: input validation, the monitor queries
# and thresholds wired from variables, the per-target for_each, the no-data
# behaviour on the two silence-is-the-signal monitors (volume tripwire and
# canary dead-man), canary omission, and the custom_metric_prefix derivation +
# override. Mocked Datadog provider: no credentials, no API calls.

mock_provider "datadog" {
  override_during = plan
}

variables {
  metric_namespace     = "rum/rum"
  queue_name           = "rum-novel-observations"
  dlq_name             = "rum-novel-observations-dlq"
  lambda_function_name = "rum-ingest"
  target_ids           = ["1.0", "1.0-canary"]
  notification_handle  = "@slack-ops-channel"
}

# --- Input validation -------------------------------------------------------

run "rejects_empty_target_ids" {
  command = plan

  module {
    source = "../observability-datadog"
  }

  variables {
    target_ids = []
  }

  expect_failures = [var.target_ids]
}

run "rejects_handle_without_at" {
  command = plan

  module {
    source = "../observability-datadog"
  }

  variables {
    notification_handle = "slack-ops-channel"
  }

  expect_failures = [var.notification_handle]
}

run "rejects_empty_metric_namespace" {
  command = plan

  module {
    source = "../observability-datadog"
  }

  variables {
    metric_namespace = ""
  }

  expect_failures = [var.metric_namespace]
}

# --- Defaults: monitors, thresholds, queries, no-data behaviour --------------

run "monitors_thresholds_and_no_data" {
  command = plan

  module {
    source = "../observability-datadog"
  }

  # metric_namespace "rum/rum" → "aws." + lowercase + non-alphanumerics → "_".
  assert {
    condition     = output.custom_metric_prefix == "aws.rum_rum"
    error_message = "custom_metric_prefix must derive \"aws.rum_rum\" from namespace \"rum/rum\"."
  }

  # (a) Queue age: threshold in seconds from queue_age_alarm_hours (default 3),
  # scoped to the queue's lowercased queuename tag.
  assert {
    condition     = datadog_monitor.queue_age.query == "max(last_5m):max:aws.sqs.approximate_age_of_oldest_message{queuename:rum-novel-observations} > 10800"
    error_message = "queue_age_alarm_hours default (3) must drive the queue-age monitor query (10800s) over the single 5-minute period CloudWatch evaluates."
  }

  assert {
    condition     = datadog_monitor.queue_age.monitor_thresholds[0].critical == "10800"
    error_message = "The queue-age monitor's critical threshold must match its query threshold."
  }

  # (b) Volume tripwire: one anomaly monitor per target id.
  assert {
    condition     = length(datadog_monitor.beacon_volume) == 2
    error_message = "Exactly one beacon-volume anomaly monitor per target id is required."
  }

  assert {
    condition     = alltrue([for id in ["1.0", "1.0-canary"] : contains(keys(datadog_monitor.beacon_volume), id)])
    error_message = "Beacon-volume monitors must be keyed by the target ids."
  }

  # Anomaly query on the streamed custom metric, scoped by targetid, band
  # width 2 (mirrors ANOMALY_DETECTION_BAND(m1, 2)), both directions.
  assert {
    condition     = datadog_monitor.beacon_volume["1.0"].query == "avg(last_4h):anomalies(sum:aws.rum_rum.rum_beacons_accepted{targetid:1.0}, 'agile', 2, direction='both', alert_window='last_1h') >= 1"
    error_message = "The volume monitor must run an anomaly query on the streamed rum_beacons_accepted metric scoped by targetid."
  }

  assert {
    condition     = datadog_monitor.beacon_volume["1.0"].monitor_threshold_windows[0].trigger_window == "last_1h"
    error_message = "Anomaly monitors require threshold windows; trigger_window must follow volume_trigger_window."
  }

  # Missing data notifies: silence IS the suppression signal.
  assert {
    condition     = datadog_monitor.beacon_volume["1.0"].notify_no_data == true
    error_message = "The volume tripwire must notify on missing data — silence is the suppression signal."
  }

  assert {
    condition     = datadog_monitor.beacon_volume["1.0"].no_data_timeframe == 120
    error_message = "volume_no_data_minutes default (120) must drive the volume monitor's no-data window."
  }

  # (c) Lambda error rate: errors/invocations*100 > threshold (default 5).
  assert {
    condition     = datadog_monitor.lambda_error_rate.query == "sum(last_15m):100 * sum:aws.lambda.errors{functionname:rum-ingest}.as_count() / sum:aws.lambda.invocations{functionname:rum-ingest}.as_count() > 5"
    error_message = "lambda_error_rate_percent default (5) must drive the error-rate query arithmetic."
  }

  assert {
    condition     = datadog_monitor.lambda_error_rate.notify_no_data == false
    error_message = "The error-rate monitor must not page on missing data (zero invocations is not an error)."
  }

  # (d) DLQ: any visible message.
  assert {
    condition     = datadog_monitor.dlq_depth.query == "max(last_5m):max:aws.sqs.approximate_number_of_messages_visible{queuename:rum-novel-observations-dlq} > 0"
    error_message = "The DLQ monitor must fire as soon as the DLQ is non-empty."
  }

  # (e) Canary dead-man: created by default, heartbeat metric under the derived
  # prefix, missing data notifies.
  assert {
    condition     = length(datadog_monitor.canary_silent) == 1
    error_message = "The canary dead-man monitor must exist when canary_metric is set (default)."
  }

  assert {
    condition     = datadog_monitor.canary_silent[0].query == "sum(last_120m):sum:aws.rum_rum.rum_canary_passed{targetid:canary} < 1"
    error_message = "The dead-man monitor must watch the rum_canary_passed heartbeat for the canary target."
  }

  assert {
    condition     = datadog_monitor.canary_silent[0].notify_no_data == true && datadog_monitor.canary_silent[0].no_data_timeframe == 120
    error_message = "The dead-man monitor must notify on missing data — absence of the heartbeat is the alert."
  }

  # Every message carries the notification handle.
  assert {
    condition = alltrue([
      for q in concat(
        [datadog_monitor.queue_age.message, datadog_monitor.lambda_error_rate.message, datadog_monitor.dlq_depth.message, datadog_monitor.canary_silent[0].message],
        [for m in datadog_monitor.beacon_volume : m.message],
      ) : strcontains(q, "@slack-ops-channel")
    ])
    error_message = "Every monitor message must include the notification handle."
  }
}

# --- Canary omission ----------------------------------------------------------

run "canary_metric_null_omits_dead_man" {
  command = plan

  module {
    source = "../observability-datadog"
  }

  variables {
    canary_metric = null
  }

  assert {
    condition     = length(datadog_monitor.canary_silent) == 0
    error_message = "canary_metric = null must omit the dead-man monitor."
  }
}

# --- Prefix override ----------------------------------------------------------

# The derivation is a convention Datadog does not formally document; the
# override is the honest escape hatch and must reach every custom-metric query.
run "custom_metric_prefix_override" {
  command = plan

  module {
    source = "../observability-datadog"
  }

  variables {
    custom_metric_prefix = "aws.rumrum"
  }

  assert {
    condition     = output.custom_metric_prefix == "aws.rumrum"
    error_message = "custom_metric_prefix must override the derived prefix."
  }

  assert {
    condition     = strcontains(datadog_monitor.beacon_volume["1.0"].query, "sum:aws.rumrum.rum_beacons_accepted{targetid:1.0}")
    error_message = "The overridden prefix must reach the volume monitor's query."
  }

  assert {
    condition     = strcontains(datadog_monitor.canary_silent[0].query, "aws.rumrum.rum_canary_passed")
    error_message = "The overridden prefix must reach the dead-man monitor's query."
  }
}
