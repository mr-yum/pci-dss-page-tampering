# Contributing

Thank you for your interest in contributing to the PCI DSS Page Tampering Detection System.

## Prerequisites

- Node.js >= 22
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

## Reporting Issues

- **Bugs**: Open a GitHub issue with reproduction steps
- **Security vulnerabilities**: See [SECURITY.md](SECURITY.md) for responsible disclosure

## Code Style

This project uses Prettier and ESLint for consistent code style. Configuration is in `package.json` (Prettier) and `eslint.config.js` (ESLint). The pre-commit hook enforces these automatically.
