/** One item whose mapper threw, kept beside the error so callers can name it. */
export type SequentialFailure<TGroup, TItem> = {
  group: TGroup
  item: TItem
  error: unknown
}

export type SequentialOutcome<TGroup, TItem, TResult> = {
  /** Results of the items that succeeded, one array per group, in input order. */
  results: TResult[][]
  /** Items whose mapper threw, in the order they were attempted. */
  failures: SequentialFailure<TGroup, TItem>[]
}

/**
 * Process groups and every item within them in deterministic sequence.
 * Browser payment integrations are resource-intensive enough that otherwise
 * independent groups can still starve each other's hosted frames.
 *
 * Never throws for an item failure. One checkout variation timing out on a
 * staging backend must not cost the run its other variations, nor the
 * production pass that follows: the failures are returned beside the results
 * so the caller can finish the work that succeeded, report what did not, and
 * still exit non-zero.
 */
export async function mapGroupsSequentially<TGroup, TItem, TResult>(
  groups: readonly TGroup[],
  getItems: (group: TGroup) => readonly TItem[],
  mapper: (group: TGroup, item: TItem) => Promise<TResult>,
): Promise<SequentialOutcome<TGroup, TItem, TResult>> {
  const results: TResult[][] = []
  const failures: SequentialFailure<TGroup, TItem>[] = []
  for (const group of groups) {
    const groupResults: TResult[] = []
    for (const item of getItems(group)) {
      try {
        groupResults.push(await mapper(group, item))
      } catch (error) {
        failures.push({ group, item, error })
      }
    }
    results.push(groupResults)
  }
  return { results, failures }
}
