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
import { headerResponseHandler } from './header.js'

const mockResponse = (url: string, headers: Record<string, string>, ok = true): HTTPResponse =>
  ({
    ok: () => ok,
    url: () => url,
    headers: () => headers,
  }) as unknown as HTTPResponse

describe('headerResponseHandler', () => {
  let summary: HeaderDetectionSummary['headers']

  beforeEach(() => {
    summary = new Map()
  })

  it('captures the originating response URL alongside CSP directives', async () => {
    await headerResponseHandler(mockResponse('https://m.stripe.network/something.js', { 'content-security-policy': "default-src 'self'; object-src 'none'" }), summary)

    const csp = summary.get('content-security-policy')!
    expect(csp).toBeDefined()
    expect(csp.get("default-src 'self'")).toEqual(new Set(['https://m.stripe.network/something.js']))
    expect(csp.get("object-src 'none'")).toEqual(new Set(['https://m.stripe.network/something.js']))
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

  it('ignores non-CSP headers', async () => {
    await headerResponseHandler(mockResponse('https://example.com', { 'x-frame-options': 'DENY' }), summary)

    expect(summary.size).toBe(0)
  })

  it('skips responses that are not ok()', async () => {
    await headerResponseHandler(mockResponse('https://example.com', { 'content-security-policy': "default-src 'self'" }, false), summary)

    expect(summary.size).toBe(0)
  })
})
