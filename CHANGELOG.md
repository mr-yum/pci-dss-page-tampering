# Changelog

Notable changes, grouped per release. Every release tag `vX.Y.Z` ships the
browser agent bundle, the collector package, the inventory entry snippet, and
the Terraform modules together at that tag, so a user-facing change to any of
them lands with an entry under Unreleased in the same pull request.

## [Unreleased]

### Fixed

- A required `content-security-policy` is no longer reported missing on a redirect response: CSP presence is now checked only on OK responses, the same responses CSP values are captured from, so a canonicalising 308 (trailing slash, `http` → `https`) cannot raise a false alarm. Other required headers, including HSTS, are still checked on redirects.

### Added

- Datadog observability option for the RUM collector: new `infra/observability-datadog` Terraform module mirroring the four CloudWatch alarm families plus the canary dead-man's switch as Datadog monitors (metrics flow CloudWatch → Datadog; the ingest path keeps zero vendor SDKs), and a `create_alarms` toggle on `collector-core` (default `true`) to disable the CloudWatch alarms when the monitors live in Datadog.
- Real-user script monitoring (feature 011): browser RUM agent with SRI-pinned release bundles, collector ingest Lambda (beacons and CSP violation reports), RUM comparison mode with dedicated alert categories, canary interlock, and Terraform modules for the collector stack.
- Release workflow publishing versioned artefacts on every `v*.*.*` tag: agent bundle with SHA-256 and SRI string, collector package with SHA-256, and a ready-to-paste inventory entry snippet.
