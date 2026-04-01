/**
 * Generate help text for CLI usage
 * Displays parameter documentation, defaults, and examples
 *
 * @returns Formatted help text string
 */
export function generateHelpText(): string {
  return `
PCI DSS Page Tampering Detection System
Command-Line Interface

USAGE:
  npm start -- [OPTIONS]

REQUIRED PARAMETERS:
  --repo <URL>              Git repository URL for inventory storage
                           Supports: https:// (with authentication) or file:// (local)
                           Example: https://github.com/org/script-inventory
                           Example: file:///local/path/test-inventory

  --git-token <TOKEN>       Git authentication token (Personal Access Token)
                           Required for HTTPS repositories
                           Not used for file:// repositories

OPTIONAL PARAMETERS:
  --mode <MODE>            Execution mode (default: all)
                           Values: inventory, detection, all
                           - inventory: Update baseline inventory (writes to Git)
                           - detection: Monitor against inventory (read-only)
                           - all: Run inventory first, then detection sequentially

  --target <NAME>          Target configuration name to process
                           Default: process all targets in inventory
                           Example: 1.0, 2.0, production

  --slack-token <TOKEN>    Slack OAuth token for alert notifications
                           If omitted, alerts will be logged to console

  --inventory-branch <NAME> Git branch for inventory operations
                           Default: inventory-updates

  --detection-branch <NAME> Git branch for detection operations
                           Default: main

  --git-user-name <NAME>   Git committer name for inventory updates
                           Default: PCI DSS Page Tampering Bot

  --git-user-email <EMAIL> Git committer email for inventory updates
                           Default: noreply@example.com

  --help, -h               Display this help message and exit

EXIT CODES:
  0    Success - all workflows completed successfully
  1    Validation error - invalid CLI arguments or configuration
  2    Execution error - Git, network, or workflow failure

EXAMPLES:

  1. Build Pipeline Integration (inventory mode, specific target):
     npm start -- \\
       --mode inventory \\
       --target 1.0 \\
       --repo https://github.com/org/inventory \\
       --git-token ghp_abc123xyz \\
       --slack-token xoxb-slack-token

  2. Scheduled Monitoring (default mode 'all'):
     npm start -- \\
       --repo https://github.com/org/inventory \\
       --git-token ghp_abc123xyz \\
       --slack-token xoxb-slack-token

  3. On-Demand Detection (specific target, custom branch):
     npm start -- \\
       --mode detection \\
       --target 2.0 \\
       --detection-branch release/v2.0 \\
       --repo https://github.com/org/inventory \\
       --git-token ghp_abc123xyz

  4. Local Testing (file:// protocol, console logging):
     npm start -- \\
       --repo file:///Users/dev/test-inventory \\
       --git-token dummy

  5. Feature Branch Testing (custom inventory branch):
     npm start -- \\
       --mode inventory \\
       --inventory-branch feature/new-inventory \\
       --repo https://github.com/org/inventory \\
       --git-token ghp_abc123xyz

WORKFLOW BEHAVIOR:

  Inventory Mode (--mode inventory):
  - Executes Puppeteer workflows to capture scripts and headers
  - Compares findings against existing inventory
  - Updates inventory files with newly discovered resources
  - Pushes changes to Git repository (--inventory-branch)
  - Alerts on unidentified resources requiring authorization

  Detection Mode (--mode detection):
  - Executes Puppeteer workflows to capture scripts and headers
  - Compares findings against existing inventory (read-only)
  - Alerts on uninventoried or hash-mismatched resources
  - Never modifies inventory repository

  All Mode (--mode all, default):
  - Runs inventory workflow first, then detection workflow
  - If inventory fails, detection is skipped (fail-fast)
  - Useful for scheduled monitoring jobs

ALERTING BEHAVIOR:

  With --slack-token:
  - Alerts sent to Slack channels configured in inventory JSON files
  - Categories: new_inventory_script_identified, uninventoried_script_detected,
    mismatched_script_detected

  Without --slack-token:
  - Alerts logged to console (stdout)
  - Useful for local development and testing

For more information, see README.md or visit:
https://github.com/mr-yum/pci-dss-page-tampering
`.trim()
}

/**
 * Display help text to stdout
 */
export function displayHelp(): void {
  console.log(generateHelpText())
}
