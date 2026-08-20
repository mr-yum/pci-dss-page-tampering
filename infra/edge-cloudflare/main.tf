locals {
  origin_host     = regex("^https://([^/]+)", var.origin_function_url)[0]
  host_expression = "(http.host eq \"${var.record_name}\")"
}

# Proxied so every request traverses Cloudflare (rate limiting + transform
# rule). TLS to the Function URL's public certificate relies on the zone's
# Full (Strict) SSL mode — a zone-level setting this module cannot manage.
resource "cloudflare_dns_record" "collector" {
  zone_id = var.zone_id
  name    = var.record_name
  type    = "CNAME"
  content = local.origin_host
  proxied = true
  ttl     = 1 # 1 = automatic; required for proxied records
  comment = "Collector edge for real-user script monitoring"
}

# Zones allow a single entrypoint ruleset per phase, so this claims the
# zone's http_ratelimit phase (see README).
resource "cloudflare_ruleset" "rate_limit" {
  zone_id = var.zone_id
  name    = "collector-rate-limit"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules = [{
    description = "Block IPs exceeding ${var.rate_limit_rpm} requests per minute to the collector"
    expression  = local.host_expression
    action      = "block"
    enabled     = true

    ratelimit = {
      characteristics     = ["ip.src", "cf.colo.id"]
      period              = 60
      requests_per_period = var.rate_limit_rpm
      mitigation_timeout  = 60
    }
  }]
}

# Injects the edge key on requests to the collector host so the origin can
# reject traffic that bypassed Cloudflare. Claims the zone's
# http_request_late_transform phase (see README).
resource "cloudflare_ruleset" "edge_key" {
  zone_id = var.zone_id
  name    = "collector-edge-key"
  kind    = "zone"
  phase   = "http_request_late_transform"

  rules = [{
    description = "Inject x-collector-edge-key on collector requests"
    expression  = local.host_expression
    action      = "rewrite"
    enabled     = true

    action_parameters = {
      headers = {
        "x-collector-edge-key" = {
          operation = "set"
          value     = var.edge_shared_secret
        }
      }
    }
  }]
}
