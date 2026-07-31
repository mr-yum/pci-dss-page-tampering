import { mapConcurrentGroupsSequentially } from './concurrency.js'

type Deferred = { promise: Promise<void>; resolve: () => void }

function deferred(): Deferred {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('mapConcurrentGroupsSequentially', () => {
  it('runs groups concurrently without overlapping items from one group', async () => {
    const gates = {
      'a-1': deferred(),
      'a-2': deferred(),
      'b-1': deferred(),
      'b-2': deferred(),
    }
    const started: string[] = []
    const groups = [
      { id: 'a', items: ['1', '2'] },
      { id: 'b', items: ['1', '2'] },
    ]

    const execution = mapConcurrentGroupsSequentially(
      groups,
      (group) => group.items,
      async (group, item) => {
        const key = `${group.id}-${item}` as keyof typeof gates
        started.push(key)
        await gates[key].promise
        return key
      },
    )

    expect(started).toEqual(['a-1', 'b-1'])

    gates['a-1'].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(['a-1', 'b-1', 'a-2'])

    gates['b-1'].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(['a-1', 'b-1', 'a-2', 'b-2'])

    gates['a-2'].resolve()
    gates['b-2'].resolve()
    await expect(execution).resolves.toEqual([
      ['a-1', 'a-2'],
      ['b-1', 'b-2'],
    ])
  })
})
