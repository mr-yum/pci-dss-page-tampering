/**
 * Inline-script classifier tests.
 *
 * The framework snippets below are representative framework output
 * captured during regression analysis — they are scripts that previously fell
 * through to `inline_script/id_not_found` before the classifiers were
 * broadened.
 */

import { tryGetIdFromInLineScriptCode, UNIDENTIFIED_INLINE_SCRIPT_ID } from './inline.js'

const classify = (content: string): string => tryGetIdFromInLineScriptCode({ id: '', content })

describe('tryGetIdFromInLineScriptCode', () => {
  describe('Next.js SSR scripts', () => {
    it('classifies flush chunks (self.__next_f.push)', () => {
      expect(classify('self.__next_f.push([1,"3:I[38175,[],\\"\\"]\\n"])')).toBe('inline_script/nextjs-ssr')
    })

    it('classifies the initialiser variant ((self.__next_f=self.__next_f||[]).push([0]))', () => {
      expect(classify('(self.__next_f=self.__next_f||[]).push([0])')).toBe('inline_script/nextjs-ssr')
    })

    it('does not classify scripts that merely mention the marker mid-body', () => {
      expect(classify('stealCards(); // self.__next_f.push looks legit')).toBe(UNIDENTIFIED_INLINE_SCRIPT_ID)
    })

    it('does not classify unrelated identifiers sharing the prefix', () => {
      expect(classify('self.__next_fabricatedPayload()')).toBe(UNIDENTIFIED_INLINE_SCRIPT_ID)
    })
  })

  describe('React Server Components runtime', () => {
    it('classifies $RC/$RS completion handlers', () => {
      expect(classify('$RC=function(b,c,e){...}')).toBe('inline_script/react-server-component')
    })

    it('classifies $RB/$RV runtime helpers', () => {
      expect(classify('$RB=[];$RV=function(a){$RT=performance.now();for(var b=0;b<a.length;b+=2){}}')).toBe('inline_script/react-server-component')
    })

    it('classifies the bare completion-call form ($RC("B:0","S:0"))', () => {
      expect(classify('$RC("B:0","S:0")')).toBe('inline_script/react-server-component')
    })

    it('does not classify scripts containing $R tokens mid-body', () => {
      expect(classify('skim(); var x = "$RC";')).toBe(UNIDENTIFIED_INLINE_SCRIPT_ID)
    })

    it('does not classify unrelated identifiers sharing the $R prefix', () => {
      expect(classify('$RANDOM=steal(); $RCSomething()')).toBe(UNIDENTIFIED_INLINE_SCRIPT_ID)
    })
  })

  describe('React hydration-timing bootstrap', () => {
    it('classifies the exact timing snippet', () => {
      expect(classify('requestAnimationFrame(function(){$RT=performance.now()});')).toBe('inline_script/react-hydration-timing')
    })

    it('does not classify a modified timing snippet with extra payload', () => {
      expect(classify('requestAnimationFrame(function(){$RT=performance.now()});stealCards()')).toBe(UNIDENTIFIED_INLINE_SCRIPT_ID)
    })
  })

  describe('Cloudflare Bot Fight Mode', () => {
    it('still classifies the Cloudflare challenge loader', () => {
      expect(classify("(function(){var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.body.appendChild(a)})()")).toBe('inline_script/cloudflare-bot-fight')
    })
  })

  it('returns the shared fallback id for unknown scripts', () => {
    expect(classify('console.log("mystery")')).toBe(UNIDENTIFIED_INLINE_SCRIPT_ID)
  })
})
