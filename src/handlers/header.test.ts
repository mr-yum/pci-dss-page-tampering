/**
 * headerResponseHandler Unit Tests
 *
 * Locks in the post-host-tracking behaviour: each CSP directive is keyed by
 * value, then by the set of originating hosts. Same directive seen from two
 * different hosts must show up as two entries in the host set (this is the
 * primary signal HostMatcher and the alert UI exist for).
 */

import type { HTTPResponse } from 'puppeteer'

import type { HeaderDetectionSummary } from '../types/header'
import { headerResponseHandler } from './header'

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

  it('captures the originating host alongside CSP directives', async () => {
    await headerResponseHandler(mockResponse('https://m.stripe.network/something.js', { 'content-security-policy': "default-src 'self'; object-src 'none'" }), summary)

    const csp = summary.get('content-security-policy')!
    expect(csp).toBeDefined()
    expect(csp.get("default-src 'self'")).toEqual(new Set(['m.stripe.network']))
    expect(csp.get("object-src 'none'")).toEqual(new Set(['m.stripe.network']))
  })

  it('records two hosts when the same directive arrives from two responses', async () => {
    await headerResponseHandler(mockResponse('https://m.stripe.network/a.js', { 'content-security-policy': "default-src 'self'" }), summary)
    await headerResponseHandler(mockResponse('https://hcaptcha.com/api.js', { 'content-security-policy': "default-src 'self'" }), summary)

    expect(summary.get('content-security-policy')!.get("default-src 'self'")).toEqual(new Set(['m.stripe.network', 'hcaptcha.com']))
  })

  it('keeps directive deduplication within a single host', async () => {
    await headerResponseHandler(mockResponse('https://m.stripe.network/a.js', { 'content-security-policy': "default-src 'self'" }), summary)
    await headerResponseHandler(mockResponse('https://m.stripe.network/b.js', { 'content-security-policy': "default-src 'self'" }), summary)

    expect(summary.get('content-security-policy')!.get("default-src 'self'")).toEqual(new Set(['m.stripe.network']))
  })

  it('stores an empty-string host when response.url() is not a parseable URL', async () => {
    await headerResponseHandler(mockResponse('not a url', { 'content-security-policy': "default-src 'self'" }), summary)

    expect(summary.get('content-security-policy')!.get("default-src 'self'")).toEqual(new Set(['']))
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
