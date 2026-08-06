/**
 * Source positions for every value inside a JSON document.
 *
 * The auditor report has to answer "which line of `targets/2.0.json` authorises
 * this script?". `JSON.parse` throws positions away, so this module re-scans the
 * original text and records, for every RFC 6901 pointer, where the value it
 * points at begins.
 *
 * Deliberately hand-rolled rather than taking a dependency: the inventory repo
 * is a supply-chain surface for a PCI control, and the whole scanner is ~150
 * lines of well-tested code.
 *
 * @see ./provenance.ts for the consumer that turns matcher positions into pointers
 */

/** 1-based line and column. Columns count UTF-16 code units, as editors do. */
export type JsonPosition = { line: number; column: number }

/** Maps every RFC 6901 pointer in a document to the position of its value. */
export type JsonPositionIndex = ReadonlyMap<string, JsonPosition>

/**
 * Maximum nesting depth. Composite matchers are documented as "typically 2-4
 * levels" and tested to 10, so this is far above any legitimate inventory while
 * still bounding recursion on a hostile file.
 */
const MAX_DEPTH = 256

const BOM = '﻿'

/** RFC 8259 insignificant whitespace. */
function isWhitespace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r'
}

function isDigit(character: string): boolean {
  return character >= '0' && character <= '9'
}

function isHexDigit(character: string): boolean {
  return isDigit(character) || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F')
}

/**
 * Escape a single JSON pointer reference token per RFC 6901 section 3.
 * `~` must be escaped before `/`, otherwise `~1` produced from `/` would be
 * re-escaped into `~01`.
 */
export function encodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/gu, '~0').replace(/\//gu, '~1')
}

/** Decode a single RFC 6901 reference token. `~1` before `~0`, mirroring the encode order. */
export function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/gu, '/').replace(/~0/gu, '~')
}

/** Build a pointer from path segments. An empty path is the root pointer, `''`. */
export function toJsonPointer(segments: readonly (string | number)[]): string {
  return segments.map((segment) => `/${encodeJsonPointerSegment(String(segment))}`).join('')
}

/**
 * Walk a parsed JSON value by pointer.
 *
 * Returns `undefined` when the pointer is unreachable — which is
 * indistinguishable from a stored `undefined`, but JSON has no `undefined`, so
 * the ambiguity cannot arise for documents this is used on.
 */
export function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root
  if (!pointer.startsWith('/')) return undefined

  let current: unknown = root

  for (const rawSegment of pointer.slice(1).split('/')) {
    const segment = decodeJsonPointerSegment(rawSegment)

    if (Array.isArray(current)) {
      // Reject `01`, `+1`, `-0` and other non-canonical index spellings.
      if (!/^(0|[1-9][0-9]*)$/u.test(segment)) return undefined
      current = current[Number(segment)]
    } else if (typeof current === 'object' && current !== null) {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
      current = (current as Record<string, unknown>)[segment]
    } else {
      return undefined
    }

    if (current === undefined) return undefined
  }

  return current
}

/**
 * Index every value in `text` by its JSON pointer.
 *
 * Each entry records the position of the *first character* of the value — the
 * `{`, `[`, `"`, digit, `-`, or the `t`/`f`/`n` of a literal. That is what an
 * auditor wants to see when they open the file at the reported line.
 *
 * @param text - Raw file contents, exactly as read (a leading BOM is tolerated)
 * @throws If `text` is not valid JSON, or nests deeper than {@link MAX_DEPTH}
 */
export function buildJsonPositionIndex(text: string): JsonPositionIndex {
  return new JsonScanner(text).scan()
}

/**
 * Single-pass recursive-descent scanner tracking (offset, line, column).
 *
 * Strict by design: the grammar is enforced rather than approximated, because a
 * scanner that resynchronises after malformed input silently reports positions
 * that belong to a different value.
 */
class JsonScanner {
  private readonly index = new Map<string, JsonPosition>()
  private offset = 0
  private line = 1
  private column = 1

  constructor(private readonly text: string) {}

  scan(): JsonPositionIndex {
    // A BOM is not part of the document. Skip it without advancing the column so
    // a BOM'd file reports the same positions as its BOM-less twin.
    if (this.text.startsWith(BOM)) this.offset = BOM.length

    this.skipWhitespace()
    this.parseValue('', 0)
    this.skipWhitespace()

    if (this.offset < this.text.length) this.fail(`unexpected trailing content ${JSON.stringify(this.peek())}`)

    return this.index
  }

  private peek(): string | undefined {
    return this.text[this.offset]
  }

  /**
   * Consume one character, maintaining line/column.
   *
   * CRLF is one line break, not two, and a lone CR also counts as one — so a
   * file with Windows line endings reports the same line numbers an editor does.
   */
  private advance(): void {
    const character = this.text[this.offset]

    if (character === '\r') {
      this.offset += this.text[this.offset + 1] === '\n' ? 2 : 1
      this.line += 1
      this.column = 1
      return
    }

    this.offset += 1

    if (character === '\n') {
      this.line += 1
      this.column = 1
    } else {
      this.column += 1
    }
  }

  private skipWhitespace(): void {
    let character = this.peek()

    while (character !== undefined && isWhitespace(character)) {
      this.advance()
      character = this.peek()
    }
  }

  private expect(character: string): void {
    if (this.peek() !== character) this.fail(`expected ${JSON.stringify(character)}`)
    this.advance()
  }

  private fail(detail: string): never {
    const found = this.peek()
    const foundText = found === undefined ? 'end of input' : JSON.stringify(found)

    throw new Error(`Invalid JSON at line ${this.line}, column ${this.column}: ${detail}, found ${foundText}`)
  }

  /** Record this value's start position, then consume it. */
  private parseValue(pointer: string, depth: number): void {
    if (depth > MAX_DEPTH) this.fail(`nesting deeper than ${MAX_DEPTH} levels`)

    // Recorded before consuming, so it points at the value's first character.
    // Duplicate keys overwrite, giving last-wins — matching JSON.parse.
    this.index.set(pointer, { line: this.line, column: this.column })

    const character = this.peek()

    switch (character) {
      case '{':
        this.parseObject(pointer, depth)
        return
      case '[':
        this.parseArray(pointer, depth)
        return
      case '"':
        this.parseString()
        return
      case 't':
        this.parseLiteral('true')
        return
      case 'f':
        this.parseLiteral('false')
        return
      case 'n':
        this.parseLiteral('null')
        return
      default:
        this.parseNumber()
    }
  }

  private parseObject(pointer: string, depth: number): void {
    this.expect('{')
    this.skipWhitespace()

    if (this.peek() === '}') {
      this.advance()
      return
    }

    for (;;) {
      this.skipWhitespace()

      // The decoded key is the pointer segment: a key written "a/b" *is*
      // the key `a/b`, whose reference token is `a~1b`.
      const key = this.parseString()

      this.skipWhitespace()
      this.expect(':')
      this.skipWhitespace()
      this.parseValue(`${pointer}/${encodeJsonPointerSegment(key)}`, depth + 1)
      this.skipWhitespace()

      const next = this.peek()

      if (next === ',') {
        this.advance()
        continue
      }
      if (next === '}') {
        this.advance()
        return
      }

      this.fail("expected ',' or '}'")
    }
  }

  private parseArray(pointer: string, depth: number): void {
    this.expect('[')
    this.skipWhitespace()

    if (this.peek() === ']') {
      this.advance()
      return
    }

    for (let elementIndex = 0; ; elementIndex += 1) {
      this.skipWhitespace()
      this.parseValue(`${pointer}/${elementIndex}`, depth + 1)
      this.skipWhitespace()

      const next = this.peek()

      if (next === ',') {
        this.advance()
        continue
      }
      if (next === ']') {
        this.advance()
        return
      }

      this.fail("expected ',' or ']'")
    }
  }

  /** Consume a string and return its decoded value. */
  private parseString(): string {
    this.expect('"')

    let value = ''

    for (;;) {
      const character = this.peek()

      if (character === undefined) this.fail('unterminated string')

      if (character === '"') {
        this.advance()
        return value
      }

      if (character === '\\') {
        this.advance()
        value += this.parseEscape()
        continue
      }

      // Raw control characters are illegal in JSON strings. Rejecting them keeps
      // the scanner honest rather than drifting from JSON.parse.
      if (character < ' ') this.fail('unescaped control character in string')

      value += character
      this.advance()
    }
  }

  private parseEscape(): string {
    const character = this.peek()

    if (character === undefined) this.fail('unterminated escape sequence')

    if (character === 'u') {
      this.advance()

      let hex = ''

      for (let digitIndex = 0; digitIndex < 4; digitIndex += 1) {
        const digit = this.peek()

        if (digit === undefined || !isHexDigit(digit)) this.fail('expected 4 hexadecimal digits after \\u')

        hex += digit
        this.advance()
      }

      // An escape never advances the line counter, even when it spells a
      // newline: the document contains only the six characters of the escape.
      return String.fromCharCode(parseInt(hex, 16))
    }

    const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
    const decoded = simple[character]

    if (decoded === undefined) this.fail(`invalid escape sequence \\${character}`)

    this.advance()

    return decoded
  }

  private parseLiteral(literal: string): void {
    if (this.text.startsWith(literal, this.offset)) {
      for (let characterIndex = 0; characterIndex < literal.length; characterIndex += 1) this.advance()
      return
    }

    this.fail(`expected ${literal}`)
  }

  /**
   * Consume a number per the JSON grammar:
   * `-? (0 | [1-9][0-9]*) ('.' [0-9]+)? ([eE] [+-]? [0-9]+)?`
   *
   * Strict rather than "advance while the character looks numeric", so malformed
   * input throws instead of leaving the position counters pointing at the wrong
   * value.
   */
  private parseNumber(): void {
    if (this.peek() === '-') this.advance()

    if (this.peek() === '0') {
      this.advance()
    } else if (this.peekIsDigit()) {
      while (this.peekIsDigit()) this.advance()
    } else {
      this.fail('expected a number')
    }

    if (this.peek() === '.') {
      this.advance()
      if (!this.peekIsDigit()) this.fail('expected a digit after the decimal point')
      while (this.peekIsDigit()) this.advance()
    }

    const exponent = this.peek()

    if (exponent === 'e' || exponent === 'E') {
      this.advance()

      const sign = this.peek()

      if (sign === '+' || sign === '-') this.advance()
      if (!this.peekIsDigit()) this.fail('expected a digit in the exponent')
      while (this.peekIsDigit()) this.advance()
    }
  }

  private peekIsDigit(): boolean {
    const character = this.peek()

    return character !== undefined && isDigit(character)
  }
}
