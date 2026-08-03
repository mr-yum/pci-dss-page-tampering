export type WorkflowActionType = {
  type: 'click' | 'input' | 'escape' | 'navigate' | 'clickPopup' | 'totp'
  value?: string | undefined
  // Name of a TOTP seed supplied at runtime via --totp-seed <name>=<seed>.
  // The seed itself must never appear in workflow files (they live in Git).
  seedRef?: string | undefined
  delay?: number | undefined
  waitForNavigation?: true | undefined
  // For click actions, wait for a response whose URL matches this regular
  // expression. Deserialized workflows require an anchored HTTPS origin.
  waitForResponse?: string | undefined
  // Optional timeout for waitForResponse. Omit to use the page default.
  waitForResponseTimeout?: number | undefined
  // Optional request method and response statuses that must also match.
  waitForResponseMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | undefined
  waitForResponseStatuses?: number[] | undefined
  // Optional regular expression that must match the completed response body.
  waitForResponseBody?: string | undefined
  // Optional bounded settling time after the action and its completion signals.
  postActionDelay?: number | undefined
  // For a later workflow step, reload the current page once when its target
  // does not appear within the short recovery window. No action is replayed.
  reloadOnMissingTarget?: true | undefined
  steps?: WorkflowStep[] | undefined
}

export type WorkflowWaitForDefinition = {
  type: 'div' | 'button' | 'input' | 'href' | 'h2' | 'h3' | 'span' | 'testid' | 'aria'
  identifier: string
}

export type WorkflowStep = {
  description: string
  // Once this step begins, a failed workflow attempt is no longer safe to
  // replay from the start. Clicks that waitForResponse are boundaries
  // automatically; use this for other side-effecting actions.
  retryBoundary?: true | undefined
  // When set, resolve the step inside the first child frame whose URL matches
  // this regular expression. Omit it to act on the top-level page.
  frameUrl?: string | undefined
  waitFor: WorkflowWaitForDefinition[]
  action: WorkflowActionType
}

export type WorkflowRetryPolicy = {
  // Total attempts, including the first one. Legacy workflows default to one
  // attempt so missing boundary metadata cannot enable unsafe replay.
  maxAttempts?: number | undefined
  // Delay before the second attempt; later delays use linear backoff.
  backoffMs?: number | undefined
}

export type WorkflowDefinition = {
  steps: WorkflowStep[]
  retry?: WorkflowRetryPolicy | undefined
}

export type Workflow = {
  fileName: string
  definition: WorkflowDefinition
}
