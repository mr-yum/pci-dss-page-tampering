/**
 * Run groups concurrently while processing each group's items in order.
 *
 * This is useful when items in one group share constrained external resources,
 * while independent groups can safely make progress at the same time.
 */
export async function mapConcurrentGroupsSequentially<TGroup, TItem, TResult>(groups: readonly TGroup[], getItems: (group: TGroup) => readonly TItem[], mapper: (group: TGroup, item: TItem) => Promise<TResult>): Promise<TResult[][]> {
  return Promise.all(
    groups.map(async (group) => {
      const results: TResult[] = []
      for (const item of getItems(group)) results.push(await mapper(group, item))
      return results
    }),
  )
}
