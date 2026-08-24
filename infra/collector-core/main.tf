locals {
  metric_namespace = "${var.name_prefix}/rum"
  target_ids       = toset(distinct([for t in var.origin_targets : t.target_id]))

  kms_key_arn       = var.kms_key_arn != null ? var.kms_key_arn : aws_kms_key.this[0].arn
  sns_topic_arn     = var.alert_sns_topic_arn != null ? var.alert_sns_topic_arn : aws_sns_topic.alerts[0].arn
  oidc_provider_arn = var.github_oidc_provider_arn != null ? var.github_oidc_provider_arn : aws_iam_openid_connect_provider.github[0].arn

  # No permissive fallback: the subject allowlist is a required, explicit
  # operator decision. See variable "oidc_subject_claims".
  oidc_subject_claims = var.oidc_subject_claims
}

resource "aws_kms_key" "this" {
  count = var.kms_key_arn == null ? 1 : 0

  description         = "${var.name_prefix} RUM collector encryption at rest"
  enable_key_rotation = true
  tags                = var.tags
}

resource "aws_kms_alias" "this" {
  count = var.kms_key_arn == null ? 1 : 0

  name          = "alias/${var.name_prefix}-collector"
  target_key_id = aws_kms_key.this[0].key_id
}

resource "aws_sns_topic" "alerts" {
  count = var.alert_sns_topic_arn == null ? 1 : 0

  name = "${var.name_prefix}-collector-alerts"
  tags = var.tags
}
