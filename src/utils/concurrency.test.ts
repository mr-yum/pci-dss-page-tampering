import { mapGroupsSequentially } from './concurrency.js'

type Deferred = { promise: Promise<void>; resolve: () => void }

function deferred(): Deferred {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('mapGroupsSequentially', () => {
  it('does not overlap items within or across groups', async () => {
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

    const execution = mapGroupsSequentially(
      groups,
      (group) => group.items,
      async (group, item) => {
        const key = `${group.id}-${item}` as keyof typeof gates
        started.push(key)
        await gates[key].promise
        return key
      },
    )

    expect(started).toEqual(['a-1'])

    gates['a-1'].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(['a-1', 'a-2'])

    gates['a-2'].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(['a-1', 'a-2', 'b-1'])

    gates['b-1'].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(['a-1', 'a-2', 'b-1', 'b-2'])

    gates['b-2'].resolve()
    await expect(execution).resolves.toEqual({
      results: [
        ['a-1', 'a-2'],
        ['b-1', 'b-2'],
      ],
      failures: [],
    })
  })

  it('continues later items and groups and returns the failures beside the results', async () => {
    const started: string[] = []
    const firstError = new Error('first failed')
    const secondError = new Error('second failed')

    const execution = mapGroupsSequentially(
      [
        { id: 'a', items: ['1', '2'] },
        { id: 'b', items: ['1', '2'] },
      ],
      (group) => group.items,
      async (group, item) => {
        const key = `${group.id}-${item}`
        started.push(key)
        if (key === 'a-1') throw firstError
        if (key === 'b-1') throw secondError
        return key
      },
    )

    const outcome = await execution

    expect(started).toEqual(['a-1', 'a-2', 'b-1', 'b-2'])
    // Groups keep their position even when an item in them failed, so callers
    // can still pair results with their inputs by index.
    expect(outcome.results).toEqual([['a-2'], ['b-2']])
    expect(outcome.failures).toEqual([
      { group: { id: 'a', items: ['1', '2'] }, item: '1', error: firstError },
      { group: { id: 'b', items: ['1', '2'] }, item: '1', error: secondError },
    ])
  })

  it('returns an empty group when every item in it failed, keeping later groups intact', async () => {
    const outcome = await mapGroupsSequentially(
      [
        { id: 'a', items: ['1'] },
        { id: 'b', items: ['1'] },
      ],
      (group) => group.items,
      async (group, item) => {
        if (group.id === 'a') throw new Error(`${group.id}-${item} failed`)
        return `${group.id}-${item}`
      },
    )

    expect(outcome.results).toEqual([[], ['b-1']])
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0]?.group.id).toBe('a')
  })
})
