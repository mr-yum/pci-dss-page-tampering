import type { Inventory, InventoryHeaderInfo } from '../../types/inventory/model.js'
import { createMatcher } from '../../types/matcher/matcher-factory.js'
import type { TargetDetection, TargetInventory } from '../../types/target.js'
import { inventoryHeaderInfoToRawInventoryHeaderInfo, rawInventoryHeaderInfoToInventoryHeaderInfo } from '../../utils/inventory.js'
import { createLogger } from '../../utils/logger.js'
import { HeaderComparisonService } from './header.js'

describe('HeaderComparisonService required headers', () => {
  const target: TargetDetection = {
    type: 'detection',
    url: 'https://pay.example.com/checkout',
    workflow: { fileName: 'workflow.json', definition: { steps: [] } },
    logger: createLogger('header-test'),
  }

  const requiredHeader: InventoryHeaderInfo = {
    identifyWith: createMatcher({
      andMatcher: [{ headerNameMatcher: '^strict-transport-security$' }, { hostMatcher: '^pay\\.example\\.com$' }],
    }),
    authoriseWith: {
      matcher: createMatcher({ contentMatcher: '^max-age=31536000; includesubdomains$' }),
      authorisationInfo: { description: 'Required HSTS policy', authorised: true, date: new Date('2026-07-28T00:00:00.000Z') },
    },
    requiredOn: ['document'],
  }

  const inventory: Inventory = {
    fileName: 'target.json',
    target: { inventory: { ...target, type: 'inventory' } as TargetInventory, detection: target },
    alerts: {
      inventory: { newScriptIdentified: { destination: 'x' }, newHeaderIdentified: { destination: 'x' } },
      detection: { newScriptDetected: { destination: 'x' }, scriptMismatchDetected: { destination: 'x' }, newHeaderDetected: { destination: 'x' } },
      successNotification: { destination: 'x' },
    },
    scripts: [],
    headers: [requiredHeader],
  }

  it('reports an in-scope required header that is absent', async () => {
    const results = await new HeaderComparisonService().compare(target, inventory, {
      headers: new Map(),
      responses: [{ url: target.url, resourceType: 'document', headerNames: new Set() }],
    })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      type: 'missing_required_header',
      headerName: 'strict-transport-security',
      url: target.url,
      resourceType: 'document',
    })
  })

  // Regression: detectedHeaderToMatchable omitted targetType, so a
  // targetTypeMatcher inside authoriseWith could never authorise.
  it('authorises a header value only on the pass its entry is scoped to', async () => {
    const scoped: InventoryHeaderInfo = {
      identifyWith: createMatcher({ headerNameMatcher: '^strict-transport-security$' }),
      authoriseWith: {
        matcher: createMatcher({ targetTypeMatcher: '^inventory$' }),
        authorisationInfo: { description: 'Staging-only acceptance', authorised: true, date: new Date('2026-08-18T00:00:00.000Z') },
      },
    }
    const summary = {
      headers: new Map([['strict-transport-security', new Map([['max-age=0', new Set([target.url])]])]]),
      responses: [],
    }

    const onInventory = await new HeaderComparisonService().compare({ ...target, type: 'inventory' as const }, { ...inventory, headers: [scoped] }, summary as any)
    const onDetection = await new HeaderComparisonService().compare({ ...target, type: 'detection' as const }, { ...inventory, headers: [scoped] }, summary as any)

    expect(onInventory.map((r) => r.type)).toEqual(['authorized_header'])
    expect(onDetection.map((r) => r.type)).toEqual(['known_header_unauthorised_content'])
  })

  it('scopes required header presence checks to the current pass', async () => {
    const passHeader: InventoryHeaderInfo = {
      ...requiredHeader,
      identifyWith: createMatcher({
        andMatcher: [{ targetTypeMatcher: '^detection$' }, { headerNameMatcher: '^strict-transport-security$' }, { hostMatcher: '^pay\\.example\\.com$' }],
      }),
    }
    const summary = {
      headers: new Map(),
      responses: [{ url: target.url, resourceType: 'document' as const, headerNames: new Set<string>() }],
    }

    const onDetection = await new HeaderComparisonService().compare({ ...target, type: 'detection' as const }, { ...inventory, headers: [passHeader] }, summary)
    const onInventory = await new HeaderComparisonService().compare({ ...target, type: 'inventory' as const }, { ...inventory, headers: [passHeader] }, summary)

    expect(onDetection.map((result) => result.type)).toEqual(['missing_required_header'])
    expect(onInventory).toEqual([])
  })

  it('scopes required header presence checks to the current workflow', async () => {
    const workflowTarget = { ...target, workflowId: 'workflow-a' }
    const workflowHeader: InventoryHeaderInfo = {
      ...requiredHeader,
      identifyWith: createMatcher({
        andMatcher: [{ workflowMatcher: '^workflow-a$' }, { headerNameMatcher: '^strict-transport-security$' }, { hostMatcher: '^pay\\.example\\.com$' }],
      }),
    }
    const summary = {
      headers: new Map(),
      responses: [{ url: target.url, resourceType: 'document' as const, headerNames: new Set<string>() }],
    }

    const workflowAResults = await new HeaderComparisonService().compare(workflowTarget, { ...inventory, headers: [workflowHeader] }, summary)
    const workflowBResults = await new HeaderComparisonService().compare({ ...workflowTarget, workflowId: 'workflow-b' }, { ...inventory, headers: [workflowHeader] }, summary)

    expect(workflowAResults.map((result) => result.type)).toEqual(['missing_required_header'])
    expect(workflowBResults).toEqual([])
  })

  it('normalizes inventory-authored header-name casing for required checks', async () => {
    const uppercaseEntry: InventoryHeaderInfo = {
      ...requiredHeader,
      identifyWith: createMatcher({
        andMatcher: [{ headerNameMatcher: '^Strict-Transport-Security$' }, { hostMatcher: '^pay\\.example\\.com$' }],
      }),
    }
    const results = await new HeaderComparisonService().compare(
      target,
      { ...inventory, headers: [uppercaseEntry] },
      {
        headers: new Map(),
        responses: [{ url: target.url, resourceType: 'document', headerNames: new Set() }],
      },
    )

    expect(results[0]).toMatchObject({ type: 'missing_required_header', headerName: 'strict-transport-security' })
  })

  it('does not report a required header when it was observed on the same response', async () => {
    const results = await new HeaderComparisonService().compare(target, inventory, {
      headers: new Map([['strict-transport-security', new Map([['max-age=31536000; includesubdomains', new Set([target.url])]])]]),
      responses: [{ url: target.url, resourceType: 'document', headerNames: new Set(['strict-transport-security']) }],
    })

    expect(results.map((result) => result.type)).toEqual(['authorized_header'])
  })

  it('does not require a document-only header on a script response', async () => {
    const results = await new HeaderComparisonService().compare(target, inventory, {
      headers: new Map(),
      responses: [{ url: 'https://pay.example.com/app.js', resourceType: 'script', headerNames: new Set() }],
    })

    expect(results).toEqual([])
  })

  it('reports a later response that drops a required header at the same URL', async () => {
    const results = await new HeaderComparisonService().compare(target, inventory, {
      headers: new Map([['strict-transport-security', new Map([['max-age=31536000; includesubdomains', new Set([target.url])]])]]),
      responses: [
        { url: target.url, resourceType: 'document', headerNames: new Set(['strict-transport-security']) },
        { url: target.url, resourceType: 'document', headerNames: new Set() },
      ],
    })

    expect(results.map((result) => result.type)).toEqual(['authorized_header', 'missing_required_header'])
  })

  it('redacts query parameters when logging a missing required header', async () => {
    const responseUrl = `${target.url}?token=super-secret#payment`
    const logSpy = jest.spyOn(target.logger, 'log').mockImplementation()

    await new HeaderComparisonService().compare(target, inventory, {
      headers: new Map(),
      responses: [{ url: responseUrl, resourceType: 'document', headerNames: new Set() }],
    })

    const output = logSpy.mock.calls.flat().join(' ')
    expect(output).toContain(target.url)
    expect(output).not.toContain('super-secret')
    expect(output).not.toContain('token=')
    logSpy.mockRestore()
  })

  it('preserves requiredOn through inventory serialization', () => {
    const raw = inventoryHeaderInfoToRawInventoryHeaderInfo(
      rawInventoryHeaderInfoToInventoryHeaderInfo({
        identifyWith: { headerNameMatcher: '^x-frame-options$' },
        authoriseWith: {
          contentMatcher: '^DENY$',
          authorisationInfo: { description: 'clickjacking policy', authorised: true, date: '2026-07-28T00:00:00.000Z' },
        },
        requiredOn: ['document'],
      }),
    )

    expect(raw.requiredOn).toEqual(['document'])
  })
})

describe('HeaderComparisonService empty-value fail-secure gate', () => {
  const target: TargetDetection = {
    type: 'detection',
    url: 'https://checkout.example/pay',
    workflow: { fileName: 'workflow.json', definition: { steps: [] } },
    logger: createLogger('header-empty-test'),
  }

  // A provenance-only composite authoriser: authorises on host alone, ignoring
  // content. This is the shape the branch-review flagged — after composites
  // became pure delegation (evidence-aware), only the header path's own gate
  // stops it authorising an emptied CSP from the trusted host.
  const provenanceOnlyCsp: InventoryHeaderInfo = {
    identifyWith: createMatcher({ headerNameMatcher: '^content-security-policy$' }),
    authoriseWith: {
      matcher: createMatcher({ orMatcher: [{ hostMatcher: '^checkout\\.example$' }] }),
      authorisationInfo: { description: 'CSP trusted from the checkout host', authorised: true, date: new Date('2026-08-21T00:00:00.000Z') },
    },
  }

  const inventory: Inventory = {
    fileName: 'target.json',
    target: { inventory: { ...target, type: 'inventory' } as TargetInventory, detection: target },
    alerts: {
      inventory: { newScriptIdentified: { destination: 'x' }, newHeaderIdentified: { destination: 'x' } },
      detection: { newScriptDetected: { destination: 'x' }, scriptMismatchDetected: { destination: 'x' }, newHeaderDetected: { destination: 'x' }, headerMismatchDetected: { destination: 'x' } },
      successNotification: { destination: 'x' },
    },
    scripts: [],
    headers: [provenanceOnlyCsp],
  }

  it('fails secure on an emptied CSP a provenance-only composite would otherwise authorise', async () => {
    const results = await new HeaderComparisonService().compare(target, inventory, {
      headers: new Map([['content-security-policy', new Map([['', new Set([target.url])]])]]),
      responses: [],
    })

    expect(results.map((r) => r.type)).toEqual(['known_header_unauthorised_content'])
    expect(results[0]).toMatchObject({ failureReason: 'header value is empty' })
  })

  it('still authorises the same header when its value is non-empty', async () => {
    const results = await new HeaderComparisonService().compare(target, inventory, {
      headers: new Map([['content-security-policy', new Map([["default-src 'self'", new Set([target.url])]])]]),
      responses: [],
    })

    expect(results.map((r) => r.type)).toEqual(['authorized_header'])
  })

  it('treats a whitespace-only value as empty', async () => {
    const results = await new HeaderComparisonService().compare(target, inventory, {
      headers: new Map([['content-security-policy', new Map([['   ', new Set([target.url])]])]]),
      responses: [],
    })

    expect(results.map((r) => r.type)).toEqual(['known_header_unauthorised_content'])
  })
})
