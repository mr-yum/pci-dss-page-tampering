# Changelog

Notable changes, grouped per release. Every release tag `vX.Y.Z` ships the
browser agent bundle, the collector package, the inventory entry snippet, and
the Terraform modules together at that tag, so a user-facing change to any of
them lands with an entry under Unreleased in the same pull request.

## [Unreleased]

### Fixed

- A required `content-security-policy` is no longer reported missing on a redirect response: CSP presence is now checked only on OK responses, the same responses CSP values are captured from, so a canonicalising 308 (trailing slash, `http` → `https`) cannot raise a false alarm. Other required headers, including HSTS, are still checked on redirects.

### Added

- Payment page scoping: mark the workflow step that runs on the card-entry page with `paymentPage: true`, and the run alerts on and inventories only the payment page's SPA context — the browser document that page lives in, including anything an earlier client-side route loaded into it. Only earlier pages the payment page replaced — pages that never rendered a payment path, were never current at or after it, and were not a failed render that the monitor's own reload recovery replaced with an in-scope page — are recorded in the auditor report as `outside_payment` and never alerted on; the payment page, every page after it (a card-form reload, a 3-D Secure redirect, a confirmation page) and any failed render of the payment page stay in scope. Scope follows Chrome's own document boundary, so an application that drops the full page load before its payment page has the earlier scripts alerted on rather than hidden; anything that cannot be attributed stays in scope. Workflows without the marker behave exactly as before. Auditor report schema 1.4.0 adds `scope` to rows and `paymentScope` (page chain, payment-only counts, and `resolved: false` when a marked payment page could not be identified) to targets.
- Datadog observability option for the RUM collector: new `infra/observability-datadog` Terraform module mirroring the four CloudWatch alarm families plus the canary dead-man's switch as Datadog monitors (metrics flow CloudWatch → Datadog; the ingest path keeps zero vendor SDKs), and a `create_alarms` toggle on `collector-core` (default `true`) to disable the CloudWatch alarms when the monitors live in Datadog.
- Real-user script monitoring (feature 011): browser RUM agent with SRI-pinned release bundles, collector ingest Lambda (beacons and CSP violation reports), RUM comparison mode with dedicated alert categories, canary interlock, and Terraform modules for the collector stack.
- Release workflow publishing versioned artefacts on every `v*.*.*` tag: agent bundle with SHA-256 and SRI string, collector package with SHA-256, and a ready-to-paste inventory entry snippet.
