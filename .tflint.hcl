# TFLint configuration for the Terraform sources under infra/.
#
# CI runs `tflint --recursive` from infra/ with TFLINT_CONFIG_FILE pointing at
# this file, so every module, example, and the test harness root is linted with
# the same rules (see .github/workflows/infra.yml).
#
# Only the bundled `terraform` ruleset is enabled: it is shipped inside the
# tflint binary, so `tflint --init` downloads nothing and the lint step needs no
# registry or cloud credentials. Provider-specific rulesets (tflint-ruleset-aws,
# tflint-ruleset-cloudflare) are deliberately not enabled — they pull plugins
# over the network and their deep checks want provider credentials to be useful.

config {
  # Do not descend into called modules; each directory under infra/ is linted in
  # its own right by the recursive walk.
  call_module_type = "none"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}
