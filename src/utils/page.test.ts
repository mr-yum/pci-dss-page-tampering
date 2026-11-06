import type { Page } from 'puppeteer'

import type { PageScriptElement } from '../types/page.js'
import { createSha256Hash } from './hash.js'
import { readPageScripts } from './page.js'
import { UNIDENTIFIED_INLINE_SCRIPT_ID } from './script/inline.js'

const pageServing = (inline: PageScriptElement[]): Page => ({ evaluate: jest.fn().mockResolvedValue({ inline, insertions: [] }) }) as unknown as Page

describe('readPageScripts: inline script names', () => {
  it('names an inline script by its element id, or the shared fallback — never by what its content looks like', async () => {
    // Snippets the tool once gave names of their own (Cloudflare's bootstrap,
    // Next.js flight data, React's runtime). Their identity is now the
    // inventory's to decide, by content, through shared matcher definitions.
    const snippets = [
      "(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);var u='/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=0123456789abcdef'})();",
      "(function(){var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.body.appendChild(a)})()",
      'self.__next_f.push([1,"0:{}"])',
      '(self.__next_f=self.__next_f||[]).push([0])',
      '$RC("B:0","S:0")',
      'requestAnimationFrame(function(){$RT=performance.now()});',
    ]
    const { inlineScripts } = await readPageScripts(pageServing([...snippets.map((content) => ({ id: '', content })), { id: 'facebookPixel', content: 'fbq("init")' }]))

    expect(inlineScripts.map((script) => (script.source.type === 'inline' ? script.source.id : script.source.type))).toEqual([...snippets.map(() => UNIDENTIFIED_INLINE_SCRIPT_ID), 'inline_script/facebookPixel'])
    expect(inlineScripts.map((script) => script.hash)).toEqual([...snippets, 'fbq("init")'].map(createSha256Hash))
  })
})
