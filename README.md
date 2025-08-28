# PCI DSS Page Tampering

To run local GitHub Actions for testing:

Ensure you have a ``.env.secrets`` file:

```
# .env.secrets
NPM_TOKEN=<copy from .npmrc>
CODEARTIFACT_SCOPE=<copy from .npmrc>
CODEARTIFACT_TOKEN=<copy from .npmrc>
CODEARTIFACT_REGISTRY=<copy from .npmrc, without https prefix!>
```

```bash
act push --container-architecture linux/amd64 --secret-file .env.secrets
```

