output "collector_endpoint" {
  description = "HTTPS collector endpoint for the page's CSP connect-src and the agent's data-collector."
  value       = module.edge_cloudfront.collector_endpoint
}

output "gha_role_arn" {
  description = "ARN of the OIDC-federated role the comparator workflow assumes."
  value       = module.collector_core.gha_role_arn
}

output "queue_url" {
  description = "URL of the novel-observations SQS queue the comparator drains."
  value       = module.collector_core.queue_url
}
