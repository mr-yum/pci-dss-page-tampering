# Contributing

Thank you for your interest in contributing to the PCI DSS Page Tampering Detection System.

## Prerequisites

- Node.js >= 24
- npm >= 10

## Getting Started

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up git hooks:
   ```bash
   npm run setup
   ```

## Development Workflow

### Running Tests

```bash
npm run test:unit          # Unit tests
npm run test:integration   # Integration tests
```

### Code Quality Checks

```bash
npm run check:formatting   # Prettier
npm run check:linting      # ESLint
npm run check:typing       # TypeScript type checking
```

### Pre-commit Validation

Run all checks before submitting a PR:

```bash
npm run precommit
```

This runs audit, formatting, linting, type checking, and all tests.

### Auto-fixing

```bash
npm run fix:formatting     # Auto-fix formatting
npm run fix:linting        # Auto-fix lint issues
```

## Submitting Changes

1. Create a feature branch from `main`
2. Make your changes
3. Ensure `npm run precommit` passes
4. Submit a pull request with a clear description of the change

## Releases

Releases are cut by pushing a semver tag (`vX.Y.Z`). The release workflow
([.github/workflows/release.yml](.github/workflows/release.yml)) rebuilds the
agent with the tag version injected and publishes the versioned artefacts
together: the agent bundle with its SHA-256 and SRI string, the collector
package with its SHA-256, and a ready-to-paste inventory entry snippet. The
Terraform modules under `infra/` ship no separate artefact — adopters consume
them from this repository at that same tag.

**CHANGELOG discipline**: every user-facing change lands with an entry under
`## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) in the same pull request.
Cutting a release renames that section to the new version before tagging.
Because agent, collector, and Terraform modules version together at one tag,
a change to any of them belongs in the CHANGELOG.

## Reporting Issues

- **Bugs**: Open a GitHub issue with reproduction steps
- **Security vulnerabilities**: See [SECURITY.md](SECURITY.md) for responsible disclosure

## Code Style

This project uses Prettier and ESLint for consistent code style. Configuration is in `package.json` (Prettier) and `eslint.config.js` (ESLint). The pre-commit hook enforces these automatically.
