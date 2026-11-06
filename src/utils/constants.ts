export const GIT_CLONE_PATH = './pulled_repo'
export const TARGET_DIRECTORY_NAME = 'targets'
export const WORKFLOW_DIRECTORY_NAME = 'workflows'
/** Optional: named matcher definitions target files may reference with `{ "matcherRef" }`. */
export const SHARED_DIRECTORY_NAME = 'shared'
export const SHARED_MATCHERS_FILE = `${SHARED_DIRECTORY_NAME}/matchers.json`

export const TARGET_PATH = `${GIT_CLONE_PATH}/${TARGET_DIRECTORY_NAME}`
export const WORKFLOW_PATH = `${GIT_CLONE_PATH}/${WORKFLOW_DIRECTORY_NAME}`
export const SHARED_MATCHERS_PATH = `${GIT_CLONE_PATH}/${SHARED_MATCHERS_FILE}`

export const GIT_DETECTION_SCRIPTS_BRANCH_NAME = 'main'
export const GIT_UPDATED_SCRIPTS_BRANCH_NAME = 'inventory-updates'
