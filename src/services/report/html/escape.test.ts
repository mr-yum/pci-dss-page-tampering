/**
 * Unit tests for the HTML escaping boundary.
 *
 * @see ./escape.ts
 */

import { escapeHtml, html, join, raw, safeHttpsHref } from './escape.js'

describe('escapeHtml', () => {
  it('escapes the OWASP character set', () => {
    expect(escapeHtml(`&<>"'/\`=`)).toBe('&amp;&lt;&gt;&quot;&#39;&#x2F;&#x60;&#x3D;')
  })

  it('neutralises a script tag', () => {
    expect(escapeHtml('<script>alert(1)</script>')).not.toContain('<script')
  })

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('https:  cdn.example.com analytics.js')).toBe('https:  cdn.example.com analytics.js')
  })

  it('escapes every occurrence, not just the first', () => {
    expect(escapeHtml('<<<')).toBe('&lt;&lt;&lt;')
  })
})

describe('html tagged template', () => {
  it('escapes interpolated strings by default', () => {
    expect(html`<p>${'<img src=x onerror=alert(1)>'}</p>`.value).toBe('<p>&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;</p>')
  })

  it('leaves the static parts of the template untouched', () => {
    expect(html`<p class="x">${'a'}</p>`.value).toBe('<p class="x">a</p>')
  })

  it('passes through values explicitly marked raw', () => {
    expect(html`<p>${raw('<b>bold</b>')}</p>`.value).toBe('<p><b>bold</b></p>')
  })

  it('renders numbers and booleans without escaping them into entities', () => {
    expect(html`<p>${42}${true}</p>`.value).toBe('<p>42true</p>')
  })

  it('renders null and undefined as nothing', () => {
    expect(html`<p>${null}${undefined}</p>`.value).toBe('<p></p>')
  })

  it('joins arrays of fragments', () => {
    // Asserted on the interpolation alone: wrapping it in a multi-line template
    // would make the expectation depend on the formatter's line breaks.
    expect(html`${[html`<li>${'<a>'}</li>`, html`<li>b</li>`]}`.value).toBe('<li>&lt;a&gt;</li><li>b</li>')
  })

  it('escapes strings inside an interpolated array', () => {
    expect(html`${['<a>', '<b>']}`.value).toBe('&lt;a&gt;&lt;b&gt;')
  })

  it('escapes a nested attacker payload that tries to close an attribute', () => {
    const payload = '" onmouseover="alert(1)'

    expect(html`<tr data-search="${payload}"></tr>`.value).not.toContain('onmouseover="alert')
  })
})

describe('join', () => {
  it('concatenates fragments without re-escaping them', () => {
    expect(join([html`<b>${'&'}</b>`, html`<i>x</i>`]).value).toBe('<b>&amp;</b><i>x</i>')
  })

  it('supports a separator', () => {
    expect(join([raw('a'), raw('b')], ', ').value).toBe('a, b')
  })
})

describe('safeHttpsHref', () => {
  it.each([['javascript:alert(1)'], ['data:text/html,<script>alert(1)</script>'], ['http://insecure.example.com'], ['file:///etc/passwd'], ['not a url'], ['']])('refuses %s', (value) => {
    expect(safeHttpsHref(value)).toBeNull()
  })

  it.each([[null], [undefined]])('refuses %s', (value) => {
    expect(safeHttpsHref(value)).toBeNull()
  })

  it('accepts an https URL', () => {
    expect(safeHttpsHref('https://github.example.com/org/inventory')).toBe('https://github.example.com/org/inventory')
  })
})
