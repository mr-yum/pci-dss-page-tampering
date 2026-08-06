/**
 * Unit tests for the JSON source-position scanner.
 *
 * Assertions are self-verifying wherever possible: rather than hand-counting a
 * line and column into a magic number, `expectPointsAt` reads the document at
 * the reported position and checks the text found there. A hand-counted
 * expectation that is wrong in the same way the implementation is wrong proves
 * nothing.
 *
 * @see ./json-position.ts
 */

import { readFileSync } from 'fs'
import { join } from 'path'

import { buildJsonPositionIndex, decodeJsonPointerSegment, encodeJsonPointerSegment, type JsonPositionIndex, resolveJsonPointer, toJsonPointer } from './json-position.js'

describe('json-position', () => {
  /** Compare only the leading `expected.length` characters, so failures print a readable diff. */
  const expectStartsWith = (found: string, expected: string): void => {
    expect(found.slice(0, expected.length)).toBe(expected)
  }

  /** Assert the indexed position for `pointer` lands on text starting with `expected`. */
  const expectPointsAt = (text: string, index: JsonPositionIndex, pointer: string, expected: string): void => {
    const position = index.get(pointer)

    expect(position).toBeDefined()

    const lines = text.split(/\r\n|\r|\n/u)
    const line = lines[position!.line - 1]

    expect(line).toBeDefined()
    expectStartsWith(line!.slice(position!.column - 1), expected)
  }

  describe('encodeJsonPointerSegment', () => {
    it('escapes ~ before / so a slash-derived ~1 is not re-escaped', () => {
      expect(encodeJsonPointerSegment('a/b')).toBe('a~1b')
      expect(encodeJsonPointerSegment('a~b')).toBe('a~0b')
      expect(encodeJsonPointerSegment('~/')).toBe('~0~1')
      expect(encodeJsonPointerSegment('plain')).toBe('plain')
    })

    it('round-trips through decodeJsonPointerSegment', () => {
      for (const segment of ['a/b', 'a~b', '~/', '~1', '~0', 'plain', '']) {
        expect(decodeJsonPointerSegment(encodeJsonPointerSegment(segment))).toBe(segment)
      }
    })
  })

  describe('toJsonPointer', () => {
    it('builds the root pointer from an empty path', () => {
      expect(toJsonPointer([])).toBe('')
    })

    it('joins and escapes segments', () => {
      expect(toJsonPointer(['scripts', 7, 'authoriseWith', 'hashes', 2])).toBe('/scripts/7/authoriseWith/hashes/2')
      expect(toJsonPointer(['a/b', 'c~d'])).toBe('/a~1b/c~0d')
    })
  })

  describe('resolveJsonPointer', () => {
    const document = { scripts: [{ name: 'first' }, { name: 'second' }], 'a/b': 1, 'c~d': 2, nested: { flag: false, nothing: null } }

    it('returns the root for the empty pointer', () => {
      expect(resolveJsonPointer(document, '')).toBe(document)
    })

    it('walks objects and arrays', () => {
      expect(resolveJsonPointer(document, '/scripts/1/name')).toBe('second')
      expect(resolveJsonPointer(document, '/nested/flag')).toBe(false)
      expect(resolveJsonPointer(document, '/nested/nothing')).toBeNull()
    })

    it('decodes escaped segments', () => {
      expect(resolveJsonPointer(document, '/a~1b')).toBe(1)
      expect(resolveJsonPointer(document, '/c~0d')).toBe(2)
    })

    it('returns undefined for unreachable or malformed pointers', () => {
      expect(resolveJsonPointer(document, 'scripts')).toBeUndefined()
      expect(resolveJsonPointer(document, '/scripts/9')).toBeUndefined()
      expect(resolveJsonPointer(document, '/scripts/01')).toBeUndefined()
      expect(resolveJsonPointer(document, '/scripts/-1')).toBeUndefined()
      expect(resolveJsonPointer(document, '/missing/deeper')).toBeUndefined()
      expect(resolveJsonPointer(document, '/nested/flag/deeper')).toBeUndefined()
    })

    it('does not resolve inherited properties', () => {
      expect(resolveJsonPointer(document, '/constructor')).toBeUndefined()
      expect(resolveJsonPointer(document, '/__proto__')).toBeUndefined()
    })
  })

  describe('buildJsonPositionIndex', () => {
    it('records the root at line 1, column 1', () => {
      expect(buildJsonPositionIndex('{"a":1}').get('')).toEqual({ line: 1, column: 1 })
    })

    it('positions values in a pretty-printed document', () => {
      const text = ['{', '  "scripts": [', '    {', '      "identifyWith": {', '        "nameMatcher": "^https://example\\\\.com/a\\\\.js$"', '      }', '    }', '  ]', '}'].join('\n')
      const index = buildJsonPositionIndex(text)

      // `  "scripts": [` — two spaces, a 9-character key, a colon and a space.
      expect(index.get('/scripts')).toEqual({ line: 2, column: 14 })
      expect(index.get('/scripts/0')).toEqual({ line: 3, column: 5 })
      expect(index.get('/scripts/0/identifyWith')).toEqual({ line: 4, column: 23 })
      expectPointsAt(text, index, '/scripts', '[')
      expectPointsAt(text, index, '/scripts/0', '{')
      expectPointsAt(text, index, '/scripts/0/identifyWith', '{')
      expectPointsAt(text, index, '/scripts/0/identifyWith/nameMatcher', '"^https://example')
    })

    it('positions every value of a minified document on line 1 at increasing columns', () => {
      const text = '{"a":1,"b":[2,3],"c":{"d":"x"}}'
      const index = buildJsonPositionIndex(text)

      for (const position of index.values()) expect(position.line).toBe(1)

      expectPointsAt(text, index, '/a', '1')
      expectPointsAt(text, index, '/b', '[2,3]')
      expectPointsAt(text, index, '/b/1', '3')
      expectPointsAt(text, index, '/c/d', '"x"')
      expect(index.get('/b/0')!.column).toBeLessThan(index.get('/b/1')!.column)
    })

    it('counts a tab as a single column', () => {
      const text = '{\n\t"a": 1,\n\t\t"b": 2\n}'
      const index = buildJsonPositionIndex(text)

      // One tab, `"a"`, a colon and a space put the value at column 7 — a tab
      // is one column, not a stop, so the report matches a plain text editor.
      expect(index.get('/a')).toEqual({ line: 2, column: 7 })
      expect(index.get('/b')).toEqual({ line: 3, column: 8 })
      expectPointsAt(text, index, '/a', '1')
      expectPointsAt(text, index, '/b', '2')
    })

    it('does not terminate a string early on an escaped quote', () => {
      const text = '{"a":"he said \\"hi\\"","b":1}'
      const index = buildJsonPositionIndex(text)

      expectPointsAt(text, index, '/b', '1')
    })

    it('handles a trailing escaped backslash before the closing quote', () => {
      const text = '{"a":"ends with \\\\","b":2}'
      const index = buildJsonPositionIndex(text)

      expect(JSON.parse(text).a).toBe('ends with \\')
      expectPointsAt(text, index, '/b', '2')
    })

    it('does not advance the line counter for a \\u escape that spells a newline', () => {
      const text = '{"a":"x\\u000Ay","b":3}'
      const index = buildJsonPositionIndex(text)

      expect(index.get('/b')!.line).toBe(1)
      expectPointsAt(text, index, '/b', '3')
    })

    it('uses the decoded key as the pointer segment', () => {
      const text = '{"a\\u002Fb":1,"p/q":2,"x~y":3,"~/":4}'
      const index = buildJsonPositionIndex(text)

      expectPointsAt(text, index, '/a~1b', '1')
      expectPointsAt(text, index, '/p~1q', '2')
      expectPointsAt(text, index, '/x~0y', '3')
      expectPointsAt(text, index, '/~0~1', '4')
    })

    it('indexes nested empty containers without inventing children', () => {
      const text = '{"a":{},"b":[],"c":[[]],"d":{"e":{}}}'
      const index = buildJsonPositionIndex(text)

      for (const pointer of ['/a', '/b', '/c', '/c/0', '/d', '/d/e']) expect(index.has(pointer)).toBe(true)
      for (const pointer of ['/a/0', '/b/0', '/c/0/0', '/d/e/0']) expect(index.has(pointer)).toBe(false)
    })

    it('treats CRLF as one line break', () => {
      const text = '{\r\n  "a": 1\r\n}'
      const index = buildJsonPositionIndex(text)

      expect(index.get('/a')).toEqual({ line: 2, column: 8 })
    })

    it('treats a lone CR as one line break', () => {
      const text = '{\r  "a": 1\r}'
      const index = buildJsonPositionIndex(text)

      expect(index.get('/a')).toEqual({ line: 2, column: 8 })
    })

    it('reports identical positions with and without a BOM', () => {
      const bom = String.fromCharCode(0xfeff)
      const text = '{\n  "a": 1\n}'
      const withoutBom = buildJsonPositionIndex(text)
      const withBom = buildJsonPositionIndex(bom + text)

      expect(withBom.get('')).toEqual(withoutBom.get(''))
      expect(withBom.get('/a')).toEqual(withoutBom.get('/a'))
    })

    it('resolves a duplicate key to the last occurrence, matching JSON.parse', () => {
      const text = '{"a":1,\n"a":2}'
      const index = buildJsonPositionIndex(text)

      expect(JSON.parse(text).a).toBe(2)
      expect(index.get('/a')!.line).toBe(2)
      expectPointsAt(text, index, '/a', '2')
    })

    it('positions every scalar form', () => {
      const text = '{"neg":-1.5e+10,"zero":0,"exp":1e5,"frac":0.25,"yes":true,"no":false,"nil":null}'
      const index = buildJsonPositionIndex(text)

      expectPointsAt(text, index, '/neg', '-1.5e+10')
      expectPointsAt(text, index, '/zero', '0')
      expectPointsAt(text, index, '/exp', '1e5')
      expectPointsAt(text, index, '/frac', '0.25')
      expectPointsAt(text, index, '/yes', 'true')
      expectPointsAt(text, index, '/no', 'false')
      expectPointsAt(text, index, '/nil', 'null')
    })

    it('indexes array elements beyond index 9 without zero padding', () => {
      const text = `[${Array.from({ length: 13 }, (_, element) => element).join(',')}]`
      const index = buildJsonPositionIndex(text)

      expectPointsAt(text, index, '/12', '12')
      expect(index.has('/012')).toBe(false)
    })

    it('tolerates whitespace in every legal position', () => {
      const text = '\n\t {\n  "a"\n  :\n  [\n    1\n    ,\n    2\n  ]\n }\n\n'
      const index = buildJsonPositionIndex(text)

      expectPointsAt(text, index, '/a', '[')
      expectPointsAt(text, index, '/a/1', '2')
    })

    it('indexes deeply nested composite matchers', () => {
      const depth = 12
      const text = `${'{"andMatcher":['.repeat(depth)}1${']}'.repeat(depth)}`
      const index = buildJsonPositionIndex(text)
      const deepest = toJsonPointer(Array.from({ length: depth }, () => ['andMatcher', 0]).flat())

      expectPointsAt(text, index, deepest, '1')
    })

    it('rejects nesting beyond the depth cap instead of overflowing the stack', () => {
      const depth = 400

      expect(() => buildJsonPositionIndex(`${'['.repeat(depth)}1${']'.repeat(depth)}`)).toThrow(/nesting deeper than/u)
    })

    it.each([
      ['trailing comma in an object', '{"a":1,}'],
      ['trailing comma in an array', '[1,]'],
      ['unquoted key', '{a:1}'],
      ['single-quoted string', "{'a':1}"],
      ['leading zero', '{"a":01}'],
      ['bare decimal point', '{"a":1.}'],
      ['missing exponent digits', '{"a":1e}'],
      ['unterminated string', '{"a":"x}'],
      ['unterminated object', '{"a":1'],
      ['invalid escape', '{"a":"\\q"}'],
      ['raw control character in string', '{"a":"x\ny"}'],
      ['trailing content', '{"a":1} {}'],
      ['empty input', ''],
    ])('rejects %s', (_description, text) => {
      expect(() => buildJsonPositionIndex(text)).toThrow(/Invalid JSON at line \d+, column \d+/u)
    })

    it('reports the failure position in the error message', () => {
      expect(() => buildJsonPositionIndex('{\n  "a": 1,\n}')).toThrow(/line 3, column 1/u)
    })
  })

  describe('against the complex-example inventory fixture', () => {
    const text = readFileSync(join(__dirname, '..', '..', 'test', 'integration', 'complex-example.json'), 'utf8')
    const parsed: unknown = JSON.parse(text)
    const index = buildJsonPositionIndex(text)
    const lines = text.split('\n')

    it('indexes exactly the pointers an independent walk produces', () => {
      const expected = new Set<string>()
      const walk = (value: unknown, pointer: string): void => {
        expected.add(pointer)

        if (Array.isArray(value)) value.forEach((child, element) => walk(child, `${pointer}/${element}`))
        else if (typeof value === 'object' && value !== null) for (const [key, child] of Object.entries(value)) walk(child, `${pointer}/${encodeJsonPointerSegment(key)}`)
      }

      walk(parsed, '')

      expect([...index.keys()].sort()).toEqual([...expected].sort())
    })

    it('positions every value on a token consistent with its parsed type', () => {
      for (const [pointer, position] of index) {
        const value = resolveJsonPointer(parsed, pointer)
        const found = lines[position.line - 1]!.slice(position.column - 1)

        if (Array.isArray(value)) expectStartsWith(found, '[')
        else if (value === null) expectStartsWith(found, 'null')
        else if (typeof value === 'object') expectStartsWith(found, '{')
        else if (typeof value === 'string') expectStartsWith(found, '"')
        else if (typeof value === 'boolean') expectStartsWith(found, String(value))
        else expect(found).toMatch(/^-?\d/u)
      }
    })

    it('points a hash entry at its opening brace', () => {
      const hashPointers = [...index.keys()].filter((pointer) => /^\/scripts\/\d+\/authoriseWith\/hashes\/\d+$/u.test(pointer))

      expect(hashPointers.length).toBeGreaterThan(0)

      for (const pointer of hashPointers) expectPointsAt(text, index, pointer, '{')
    })
  })
})
