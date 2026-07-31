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
    await expect(execution).resolves.toEqual([
      ['a-1', 'a-2'],
      ['b-1', 'b-2'],
    ])
  })

  it('continues later items and groups before reporting collected failures', async () => {
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

    let aggregateError: AggregateError | undefined
    try {
      await execution
    } catch (error) {
      aggregateError = error as AggregateError
    }

    expect(aggregateError).toBeInstanceOf(AggregateError)
    expect(aggregateError?.message).toBe('2 sequential workflow execution(s) failed')
    expect(aggregateError?.errors).toEqual([firstError, secondError])
    expect(started).toEqual(['a-1', 'a-2', 'b-1', 'b-2'])
  })
})
