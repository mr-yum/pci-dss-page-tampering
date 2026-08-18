/**
 * headerResponseHandler Unit Tests
 *
 * Locks in the post-host-tracking behaviour: each CSP directive is keyed by
 * value, then by the set of originating response URLs. Same directive seen
 * from two different URLs must show up as two entries in the URL set —
 * HostMatcher / UrlMatcher use this provenance to discriminate.
 */

import type { HTTPResponse } from 'puppeteer'

import type { HeaderDetectionSummary } from '../types/header.js'
import { createMatcher } from '../types/matcher/matcher-factory.js'
import { headerResponseHandler } from './header.js'

const mockResponse = (url: string, headers: Record<string, string>, ok = true): HTTPResponse =>
  ({
    ok: () => ok,
    url: () => url,
    headers: () => headers,
    request: () => ({ resourceType: () => 'document' }),
  }) as unknown as HTTPResponse

describe('headerResponseHandler', () => {
  let summary: HeaderDetectionSummary['headers']

  beforeEach(() => {
    summary = new Map()
  })

  // Regression: identifiesHeaderAndOrigin built its matchable without a target
  // type, so a targetTypeMatcher inside an entry's identifyWith failed secure
  // here and the header was never captured from a third-party origin at all --
  // which reads as "clean" downstream rather than "not monitored".
  it('captures a third-party header whose entry is scoped to the current pass', async () => {
    const entry = {
      identifyWith: createMatcher({
        andMatcher: [{ headerNameMatcher: '^strict-transport-security$' }, { hostMatcher: '^pay\\.provider\\.example$' }, { targetTypeMatcher: '^detection$' }],
      }),
    } as any

    const capture = async (targetType: string) => {
      const headers: HeaderDetectionSummary['headers'] = new Map()
      await headerResponseHandler(mockResponse('https://pay.provider.example/charge', { 'strict-transport-security': 'max-age=31536000' }), headers, [], 'https://shop.example.test/checkout', [entry], 'default', targetType)
      return headers
    }

    expect([...(await capture('detection')).keys()]).toEqual(['strict-transport-security'])
    // Scoped to detection, so the inventory pass must not treat it as tracked.
    expect([...(await capture('inventory')).keys()]).toEqual([])
  })

  it('captures the originating response URL alongside CSP directives', async () => {
    await headerResponseHandler(mockResponse('https://m.stripe.network/something.js', { 'content-security-policy': "default-src 'self'; object-src 'none'" }), summary)

    const csp = summary.get('content-security-policy')!
    expect(csp).toBeDefined()
    expect(csp.get("default-src 'self'")).toEqual(new Set(['https://m.stripe.network/something.js']))
    expect(csp.get("object-src 'none'")).toEqual(new Set(['https://m.stripe.network/something.js']))
  })

  it('canonicalises CSP directive names and ordering', async () => {
    await headerResponseHandler(mockResponse('https://example.com', { 'content-security-policy': "OBJECT-SRC 'none'; DEFAULT-SRC 'self'" }), summary)

    expect([...summary.get('content-security-policy')!.keys()]).toEqual(["default-src 'self'", "object-src 'none'"])
  })

  it('records two URLs when the same directive arrives from two responses', async () => {
    await headerResponseHandler(mockResponse('https://m.stripe.network/a.js', { 'content-security-policy': "default-src 'self'" }), summary)
    await headerResponseHandler(mockResponse('https://hcaptcha.com/api.js', { 'content-security-policy': "default-src 'self'" }), summary)

    expect(summary.get('content-security-policy')!.get("default-src 'self'")).toEqual(new Set(['https://m.stripe.network/a.js', 'https://hcaptcha.com/api.js']))
  })

  it('distinguishes responses from the same host but different paths', async () => {
    await headerResponseHandler(mockResponse('https://m.stripe.network/a.js', { 'content-security-policy': "default-src 'self'" }), summary)
    await headerResponseHandler(mockResponse('https://m.stripe.network/b.js', { 'content-security-policy': "default-src 'self'" }), summary)

    expect(summary.get('content-security-policy')!.get("default-src 'self'")).toEqual(new Set(['https://m.stripe.network/a.js', 'https://m.stripe.network/b.js']))
  })

  it('dedupes when an identical URL arrives twice', async () => {
    await headerResponseHandler(mockResponse('https://m.stripe.network/a.js', { 'content-security-policy': "default-src 'self'" }), summary)
    await headerResponseHandler(mockResponse('https://m.stripe.network/a.js', { 'content-security-policy': "default-src 'self'" }), summary)

    expect(summary.get('content-security-policy')!.get("default-src 'self'")).toEqual(new Set(['https://m.stripe.network/a.js']))
  })

  it('still stores the raw response.url() string when it is not a parseable URL (matchers fail-secure later)', async () => {
    await headerResponseHandler(mockResponse('not a url', { 'content-security-policy': "default-src 'self'" }), summary)

    expect(summary.get('content-security-policy')!.get("default-src 'self'")).toEqual(new Set(['not a url']))
  })

  it('captures and canonicalises supported security headers', async () => {
    await headerResponseHandler(mockResponse('https://example.com', { 'x-frame-options': 'DENY' }), summary)

    expect(summary.get('x-frame-options')!.get('DENY')).toEqual(new Set(['https://example.com']))
  })

  it('captures headers on redirects and other non-ok responses', async () => {
    await headerResponseHandler(mockResponse('https://example.com', { 'strict-transport-security': 'includeSubDomains; max-age="031536000"' }, false), summary)

    expect(summary.get('strict-transport-security')!.get('max-age=31536000; includesubdomains')).toEqual(new Set(['https://example.com']))
  })

  it('preserves the established CSP scope by ignoring non-ok responses', async () => {
    await headerResponseHandler(mockResponse('https://example.com/redirect', { 'content-security-policy': "default-src 'none'" }, false), summary)

    expect(summary.has('content-security-policy')).toBe(false)
  })

  it('redacts cookie values and dynamic expiry timestamps before storing observations', async () => {
    await headerResponseHandler(
      mockResponse('https://example.com/login', {
        'set-cookie': 'session=super-secret-token; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Wed, 09 Jun 2099 10:18:14 GMT\n preference=also-secret; Path=/',
      }),
      summary,
    )

    const cookies = [...summary.get('set-cookie')!.keys()]
    expect(cookies).toEqual(['cookie=session; empty=false; expires=future; httponly=true; path=/; samesite=lax; secure=true', 'cookie=preference; empty=false; path=/'])
    expect(JSON.stringify(cookies)).not.toContain('super-secret-token')
    expect(JSON.stringify(cookies)).not.toContain('also-secret')
    expect(JSON.stringify(cookies)).not.toContain('2099')
  })

  it('retains cookie expiry semantics without retaining timestamps', async () => {
    await headerResponseHandler(
      mockResponse('https://example.com/login', {
        'set-cookie': 'session=secret; Path=/; Expires=Wed, 09 Jun 2099 10:18:14 GMT\n session=secret; Path=/; Expires=Sat, 01 Jan 2000 00:00:00 GMT',
      }),
      summary,
    )

    expect([...summary.get('set-cookie')!.keys()]).toEqual(['cookie=session; empty=false; expires=future; path=/', 'cookie=session; empty=false; expires=expired; path=/'])
  })

  it('classifies cookie expiry relative to the response date', async () => {
    await headerResponseHandler(
      mockResponse('https://example.com/login', {
        date: 'Wed, 01 Jan 2025 00:00:00 GMT',
        'set-cookie': 'persistent=secret; Expires=Thu, 01 Jan 2026 00:00:00 GMT\n deletion=secret; Expires=Mon, 01 Jan 2024 00:00:00 GMT',
      }),
      summary,
    )

    expect([...summary.get('set-cookie')!.keys()]).toEqual(['cookie=persistent; empty=false; expires=future', 'cookie=deletion; empty=false; expires=expired'])
  })

  it('limits non-CSP production capture to the target host and relevant resource types', async () => {
    const responses: NonNullable<HeaderDetectionSummary['responses']> = []
    await headerResponseHandler(mockResponse('https://third-party.example/script.js', { 'strict-transport-security': 'max-age=31536000' }), summary, responses, 'https://pay.example.com')

    expect(summary.size).toBe(0)
    expect(responses).toEqual([
      {
        url: 'https://third-party.example/script.js',
        resourceType: 'document',
        headerNames: new Set(['strict-transport-security']),
      },
    ])
  })

  it('captures an explicitly inventoried third-party header', async () => {
    const inventoryHeader = {
      identifyWith: createMatcher({ andMatcher: [{ headerNameMatcher: '^strict-transport-security$' }, { hostMatcher: '^third-party\\.example$' }] }),
      authoriseWith: {
        matcher: createMatcher({ contentMatcher: '^max-age=31536000$' }),
        authorisationInfo: { description: 'approved third party', authorised: true, date: new Date() },
      },
    }
    await headerResponseHandler(mockResponse('https://third-party.example/frame', { 'strict-transport-security': 'max-age=31536000' }), summary, [], 'https://pay.example.com', [inventoryHeader])

    expect(summary.get('strict-transport-security')!.get('max-age=31536000')).toEqual(new Set(['https://third-party.example/frame']))
  })

  it('captures changed third-party content when name and origin are inventoried', async () => {
    const inventoryHeader = {
      identifyWith: createMatcher({
        andMatcher: [{ headerNameMatcher: '^x-frame-options$' }, { contentMatcher: '^DENY$' }, { hostMatcher: '^third-party\\.example$' }],
      }),
      authoriseWith: {
        matcher: createMatcher({ contentMatcher: '^DENY$' }),
        authorisationInfo: { description: 'approved third party', authorised: true, date: new Date() },
      },
    }
    await headerResponseHandler(mockResponse('https://third-party.example/frame', { 'x-frame-options': 'SAMEORIGIN' }), summary, [], 'https://pay.example.com', [inventoryHeader])

    expect(summary.get('x-frame-options')!.get('SAMEORIGIN')).toEqual(new Set(['https://third-party.example/frame']))
  })
})
