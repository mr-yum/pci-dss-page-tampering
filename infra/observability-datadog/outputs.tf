output "custom_metric_prefix" {
  description = "Datadog metric-name prefix the monitors read the collector's custom metrics under — derived from metric_namespace unless overridden. Verify it against Metrics Explorer (README) before trusting the volume tripwire."
  value       = local.custom_metric_prefix
}

output "monitor_ids" {
  description = "IDs of every created monitor, keyed by role (beacon-volume monitors keyed by target id; canary_silent absent when canary_metric is null)."
  value = merge(
    {
      queue_age         = datadog_monitor.queue_age.id
      lambda_error_rate = datadog_monitor.lambda_error_rate.id
      dlq_depth         = datadog_monitor.dlq_depth.id
    },
    { for id, m in datadog_monitor.beacon_volume : "beacon_volume_${id}" => m.id },
    var.canary_metric != null ? { canary_silent = datadog_monitor.canary_silent[0].id } : {},
  )
}
