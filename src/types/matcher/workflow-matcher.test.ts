import { WorkflowMatcher } from './workflow-matcher.js'

const make = (workflowId?: string) => ({
  name: 'resource',
  content: 'content',
  ...(workflowId !== undefined ? { workflowId } : {}),
})

describe('WorkflowMatcher', () => {
  it('identifies matching workflow ids', () => {
    const matcher = new WorkflowMatcher('^(workflow-a|workflow-b)$')

    expect(matcher.identify(make('workflow-a'))).toBe(true)
    expect(matcher.identify(make('workflow-b'))).toBe(true)
    expect(matcher.identify(make('other'))).toBe(false)
  })

  it('fails secure when the workflow id is missing or empty', () => {
    const matcher = new WorkflowMatcher('.*')

    expect(matcher.identify(make())).toBe(false)
    expect(matcher.identify(make(''))).toBe(false)
    expect(matcher.authorize(make())).toEqual({ authorized: false, reason: 'workflow id is missing or empty' })
  })

  it('returns matcher metadata on authorization', () => {
    const authorisationInfo = {
      description: 'Workflow A',
      authorised: true,
      date: new Date('2026-07-28T00:00:00.000Z'),
    }
    const result = new WorkflowMatcher('^workflow-a$', authorisationInfo).authorize(make('workflow-a'))

    expect(result).toEqual({ authorized: true, metadataPath: [authorisationInfo] })
  })

  it('denies a matching workflow when its authorization metadata is denied', () => {
    const authorisationInfo = {
      description: 'Workflow disabled',
      authorised: false,
      date: new Date('2026-07-28T00:00:00.000Z'),
    }

    expect(new WorkflowMatcher('^workflow-a$', authorisationInfo).authorize(make('workflow-a'))).toEqual({
      authorized: false,
      reason: 'Top-level authorization denied: Workflow disabled',
      metadataPath: [authorisationInfo],
    })
  })

  it('exposes its type, pattern, and description', () => {
    const matcher = new WorkflowMatcher('^workflow-b$')

    expect(matcher.getType()).toBe('workflow')
    expect(matcher.getPattern()).toBe('^workflow-b$')
    expect(matcher.getDescription()).toBe('workflow:/^workflow-b$/')
  })
})
