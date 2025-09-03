# PCI DSS Page Tampering

To run local GitHub Actions for testing:

Ensure you have a `.env.secrets` file:

```
# .env.secrets
INVENTORY_REPO_PAT=<PAT secret>
NPMRC_RO_FILE=<copy all of .npmrc content, remember to include newlines>
```

```bash
act push --container-architecture linux/amd64 --secret-file .env.secrets
```
