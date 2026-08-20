# Terraform test suites

Mocked-provider `terraform test` suites for the three modules and both examples (contracts/terraform-modules.md §Test obligations). No credentials, no API calls, no applies: every run is `command = plan` against `mock_provider` blocks. The modules themselves require Terraform >= 1.7, but this harness root and both example roots pin `required_version = ">= 1.11"` because their suites use `override_during = plan`, which needs >= 1.11.

## Layout

`terraform test` discovers `*.tftest.hcl` in the configuration directory (or its `tests/` subdirectory), so the suites live in two places:

- **`infra/tests/`** (this directory) — a resource-less harness root whose run blocks target each module via `module { source = "../<module>" }` overrides:
  - `collector_core.tftest.hcl` — input validation, defaults, alarms, `edge_auth` → Function URL pairing
  - `edge_cloudfront.tftest.hcl` — input validation (including the required shared secret), custom-domain trio precondition, WAF defaults, shared-secret origin header, CachingDisabled cache policy
  - `edge_cloudflare.tftest.hcl` — input validation, proxied record, rate limit, header injection, endpoint output
- **`infra/examples/<stack>/tests/stack.tftest.hcl`** — each example's composition test, run from the example directory so the example itself is the configuration under test.

This keeps the module directories free of test scaffolding while still exercising all three modules and both examples.

## Invocation (CI runs exactly this — `.github/workflows/infra.yml`)

```bash
terraform -chdir=infra/tests init -backend=false
terraform -chdir=infra/tests test

terraform -chdir=infra/examples/cloudfront-stack init -backend=false
terraform -chdir=infra/examples/cloudfront-stack test

terraform -chdir=infra/examples/cloudflare-stack init -backend=false
terraform -chdir=infra/examples/cloudflare-stack test

infra/tests/no-vpc-check.sh
```

`init -backend=false` downloads provider schemas (mock providers still need the real schema) — network access to the registry, but no cloud credentials.

## Self-containment: `fixtures/placeholder.zip`

`collector-core`'s `lambda_package` default points at `dist/collector/ingest.zip`, which only exists after `npm run build:collector` — and `filebase64sha256()` fails at plan when the file is missing. Every suite therefore pins `lambda_package` to `fixtures/placeholder.zip` (a checked-in zip containing an empty `ingest.mjs`), so `terraform test` needs no prior build step.

## Coverage vs the contract's test obligations

1. **Required inputs / validation** — `collector_core.tftest.hcl` asserts (via `expect_failures`): invalid `target_type`, invalid `edge_auth.mode`, `shared_secret` mode without a secret. Edge suites assert: non-HTTPS `origin_function_url` (both), empty `edge_shared_secret` (cloudfront module), partial custom-domain trio (cloudfront), zero `rate_limit_rpm` (cloudflare). Both examples reject an empty `edge_shared_secret`.
   _Gap_: a run that simply omits a required variable is a hard error `terraform test` cannot `expect_failures` on — that guarantee is Terraform core behaviour, not assertable per-run.
2. **Edge/`edge_auth` pairing** — pairing is semantic (core cannot know which edge fronts it), so it is asserted where it is observable: each example's suite plans the full composition with its documented mode and asserts `aws_lambda_function_url.ingest.authorization_type` (`NONE` for both stacks — both edges inject the shared-secret header the handler verifies) via a `module`-override run against collector-core with the exact `edge_auth` shape the example passes — test assertions cannot reach into a child module's resources. `collector_core.tftest.hcl` asserts both mode → authorization mappings independently (`aws_iam` → `AWS_IAM` stays covered there for SigV4-capable, non-beacon consumers), and `edge_cloudfront.tftest.hcl` asserts the distribution plans the `x-collector-edge-key` origin header.
3. **No-VPC contract** — `no-vpc-check.sh` greps all Terraform sources under `infra/` for `aws_vpc` / `aws_subnet` / `aws_security_group` resource declarations and exits non-zero on a match. A plan-level tftest assertion is not practical: run assertions evaluate expressions against named values and cannot enumerate "all resource types in this plan", so absence of a type is not expressible.
4. **Alarm presence** — `collector_core.tftest.hcl` asserts the queue-age alarm (threshold `queue_age_alarm_hours * 3600`), DLQ alarm (`> 0`), Lambda error-rate alarm (5%), and exactly one beacon-volume anomaly alarm per distinct `target_id` (keyed set from `for_each`).
5. **Output wiring** — both example suites assert `collector_endpoint`, `gha_role_arn`, and `queue_url` at plan time. Computed values are made known at plan by pinning them in `mock_resource` defaults with `override_during = plan` (Function URL, distribution domain, role ARN, queue URL); the Cloudflare endpoint is config-derived (`https://<record_name>`) and needs no mock.

## Known plan-time gaps (deliberate, not vacuous assertions)

- **Mocked values are fabricated**: assertions on mocked computed attributes (mock ARNs, mock domain names) prove _wiring_ — that an output re-exports the right module's attribute — not real AWS/Cloudflare values. Real endpoint reachability is apply-time only (quickstart §6 canary).
- **Anomaly band maths**: the beacon-volume alarm's `ANOMALY_DETECTION_BAND` behaviour is a CloudWatch runtime property; tests assert the alarm exists per target with the band expression wired, nothing more.
- **Missing-required-variable failures** (obligation 1 gap above) are enforced by Terraform core, not asserted per-run.

## Housekeeping

- `.terraform/` directories and `.terraform.lock.hcl` files generated by `init` in `infra/tests/` and the examples are consumer-side artefacts — do not commit them.
- The module directories keep their own lock files where already present.
