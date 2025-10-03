# PCI DSS Page Tampering

Ensure you have a `.env.secrets` file:

```
# .env.secrets
INVENTORY_REPO_PAT=<PAT secret>
NPMRC_RO_FILE=<copy all of .npmrc content, remember to include newlines>
```

To run independently for testing:

```bash
source .env.secrets
SLACK_OAUTH_TOKEN=$SLACK_OAUTH_TOKEN INVENTORY_REPO_PAT=$INVENTORY_REPO_PAT npm run start
```

If you want to use a different script inventory branch for testing:
```
source .env.secrets
GIT_UPDATED_SCRIPTS_BRANCH_NAME=<branch name for pushing script updates> SLACK_OAUTH_TOKEN=$SLACK_OAUTH_TOKEN INVENTORY_REPO_PAT=$INVENTORY_REPO_PAT npm run start
```


To run local GitHub Actions for testing:

```bash
act push --container-architecture linux/amd64 --secret-file .env.secrets
```
