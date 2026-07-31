/**
 * Process groups and every item within them in deterministic sequence.
 * Browser payment integrations are resource-intensive enough that otherwise
 * independent groups can still starve each other's hosted frames.
 */
export async function mapGroupsSequentially<TGroup, TItem, TResult>(groups: readonly TGroup[], getItems: (group: TGroup) => readonly TItem[], mapper: (group: TGroup, item: TItem) => Promise<TResult>): Promise<TResult[][]> {
  const groupResults: TResult[][] = []
  const errors: unknown[] = []
  for (const group of groups) {
    const results: TResult[] = []
    for (const item of getItems(group)) {
      try {
        results.push(await mapper(group, item))
      } catch (error) {
        errors.push(error)
      }
    }
    groupResults.push(results)
  }
  if (errors.length > 0) throw new AggregateError(errors, `${errors.length} sequential workflow execution(s) failed`)
  return groupResults
}
