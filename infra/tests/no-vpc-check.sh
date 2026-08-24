#!/usr/bin/env bash
# No-VPC contract guard (contracts/terraform-modules.md, shared rules):
# no module under infra/ may create VPC resources. Removal of this guarantee
# is a breaking change requiring a major version.
#
# terraform test cannot assert the absence of a resource type across a plan,
# so this source-level guard backs the contract's no-VPC test obligation.
# Exits non-zero if any Terraform source under infra/ declares an aws_vpc,
# aws_subnet, or aws_security_group resource.
#
# The line-based grep is sound (no HCL parser needed) because CI gates on
# `terraform fmt -check -recursive infra/`, and fmt normalises every resource
# declaration onto a single `resource "type" "name" {` line — a declaration
# split across lines cannot reach this check unformatted.
set -euo pipefail

infra_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

matches=$(grep -rnE 'resource[[:space:]]+"aws_(vpc|subnet|security_group)"' \
  --include='*.tf' --include='*.tftest.hcl' "$infra_dir" || true)

if [[ -n "$matches" ]]; then
  echo "no-vpc-check FAILED: VPC-class resources found under infra/ (contract forbids them):" >&2
  echo "$matches" >&2
  exit 1
fi

echo "no-vpc-check OK: no aws_vpc / aws_subnet / aws_security_group resources under infra/"
