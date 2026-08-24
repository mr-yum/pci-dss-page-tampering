locals {
  origin_host   = regex("^https://([^/]+)", var.origin_function_url)[0]
  origin_id     = "${var.name_prefix}-collector-origin"
  custom_domain = var.domain_name != null

  # WAFv2 only inspects CloudFront bodies up to a fixed tier (16/32/48/64 KB);
  # pick the smallest tier covering max_body_kb so the size rule sees the
  # whole body, and treat anything beyond the tier as oversize (MATCH → block).
  body_inspection_limit = (
    var.max_body_kb <= 16 ? "KB_16" :
    var.max_body_kb <= 32 ? "KB_32" :
    var.max_body_kb <= 48 ? "KB_48" : "KB_64"
  )

  # AWS-managed CloudFront policies, referenced by their documented global
  # constant ids (identical in every account/partition — see the CloudFront
  # developer guide's managed-policy tables): never cache beacon responses;
  # forward everything except Host (a Lambda Function URL origin requires its
  # own host header). Constants keep the plan deterministic and assertable.
  caching_disabled_cache_policy_id                = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingDisabled
  all_viewer_except_host_origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # Managed-AllViewerExceptHostHeader
}

resource "aws_wafv2_web_acl" "collector" {
  provider = aws.us_east_1

  name  = "${var.name_prefix}-collector"
  scope = "CLOUDFRONT"
  tags  = var.tags

  default_action {
    allow {}
  }

  association_config {
    request_body {
      cloudfront {
        default_size_inspection_limit = local.body_inspection_limit
      }
    }
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-collector-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "body-size-limit"
    priority = 2

    action {
      block {}
    }

    statement {
      size_constraint_statement {
        comparison_operator = "GT"
        size                = var.max_body_kb * 1024

        field_to_match {
          body {
            oversize_handling = "MATCH"
          }
        }

        text_transformation {
          priority = 0
          type     = "NONE"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-collector-body-size"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-collector-waf"
    sampled_requests_enabled   = true
  }
}

resource "aws_cloudfront_distribution" "collector" {
  comment         = "${var.name_prefix} collector edge"
  enabled         = true
  is_ipv6_enabled = true
  web_acl_id      = aws_wafv2_web_acl.collector.arn
  aliases         = local.custom_domain ? [var.domain_name] : []
  tags            = var.tags

  origin {
    domain_name = local.origin_host
    origin_id   = local.origin_id

    # Shared-secret origin authentication, same pattern as edge-cloudflare:
    # the origin drops any request missing this header, so traffic cannot
    # bypass the distribution (and the WAF in front of it). Origin Access
    # Control is NOT usable here: for OAC-signed POST/PUT requests AWS
    # requires the CLIENT to send x-amz-content-sha256, and
    # navigator.sendBeacon cannot set headers — with OAC + AWS_IAM every
    # beacon would be rejected at the Function URL.
    custom_header {
      name  = "x-collector-edge-key"
      value = var.edge_shared_secret
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id         = local.origin_id
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = local.caching_disabled_cache_policy_id
    origin_request_policy_id = local.all_viewer_except_host_origin_request_policy_id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.custom_domain ? null : true
    acm_certificate_arn            = var.acm_certificate_arn
    ssl_support_method             = local.custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.custom_domain ? "TLSv1.2_2021" : null
  }

  lifecycle {
    # required_version 1.7 predates cross-variable input validation, so the
    # all-or-none custom-domain check lives here instead of on the variables.
    precondition {
      condition = (
        (var.acm_certificate_arn == null) == (var.domain_name == null) &&
        (var.route53_zone_id == null) == (var.domain_name == null)
      )
      error_message = "acm_certificate_arn, route53_zone_id, and domain_name must all be set together or all be null."
    }
  }
}

resource "aws_route53_record" "collector" {
  for_each = local.custom_domain ? toset(["A", "AAAA"]) : toset([])

  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = each.value

  alias {
    name                   = aws_cloudfront_distribution.collector.domain_name
    zone_id                = aws_cloudfront_distribution.collector.hosted_zone_id
    evaluate_target_health = false
  }
}
