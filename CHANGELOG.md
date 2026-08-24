# Changelog

Notable changes, grouped per release. Every release tag `vX.Y.Z` ships the
browser agent bundle, the collector package, the inventory entry snippet, and
the Terraform modules together at that tag, so a user-facing change to any of
them lands with an entry under Unreleased in the same pull request.

## [Unreleased]

### Added

- Real-user script monitoring (feature 011): browser RUM agent with SRI-pinned release bundles, collector ingest Lambda (beacons and CSP violation reports), RUM comparison mode with dedicated alert categories, canary interlock, and Terraform modules for the collector stack.
- Release workflow publishing versioned artefacts on every `v*.*.*` tag: agent bundle with SHA-256 and SRI string, collector package with SHA-256, and a ready-to-paste inventory entry snippet.
