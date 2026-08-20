output "collector_endpoint" {
  description = "HTTPS collector endpoint for the page's CSP connect-src and the agent's data-collector."
  value       = "https://${var.record_name}"
}
