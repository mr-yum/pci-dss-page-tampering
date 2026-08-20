output "collector_endpoint" {
  description = "HTTPS collector endpoint for the page's CSP connect-src and the agent's data-collector."
  value       = "https://${local.custom_domain ? var.domain_name : aws_cloudfront_distribution.collector.domain_name}"
}
