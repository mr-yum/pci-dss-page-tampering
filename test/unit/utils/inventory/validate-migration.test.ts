/**
 * Unit tests for validate-migration.ts composite matcher support
 *
 * Validates that the migration script correctly detects and reports
 * composite matcher usage (orMatcher, andMatcher) in inventory entries.
 */

import { detectCompositeMatchers, validateInventory } from '../../../../src/utils/inventory/validate-migration'

describe('validate-migration composite matcher support', () => {
  describe('detectCompositeMatchers', () => {
    it('should detect orMatcher in scripts.identifyWith', () => {
      const inventory = {
        scripts: [
          {
            identifyWith: {
              orMatcher: [{ nameMatcher: 'pattern1' }, { nameMatcher: 'pattern2' }],
            },
            authoriseWith: {
              matcher: { contentMatcher: 'content' },
              authorisationInfo: {
                description: 'Test script',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        headers: [],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const messages = detectCompositeMatchers(inventory)
      expect(messages).toContain('ℹ️  Found orMatcher in scripts.identifyWith (multi-alternative identification)')
    })

    it('should detect andMatcher in scripts.identifyWith', () => {
      const inventory = {
        scripts: [
          {
            identifyWith: {
              andMatcher: [{ nameMatcher: 'pattern1' }, { contentMatcher: 'pattern2' }],
            },
            authoriseWith: {
              matcher: { contentMatcher: 'content' },
              authorisationInfo: {
                description: 'Test script',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        headers: [],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const messages = detectCompositeMatchers(inventory)
      expect(messages).toContain('ℹ️  Found andMatcher in scripts.identifyWith (multi-condition identification)')
    })

    it('should detect orMatcher in scripts.authoriseWith.matcher', () => {
      const inventory = {
        scripts: [
          {
            identifyWith: { nameMatcher: 'test' },
            authoriseWith: {
              matcher: {
                orMatcher: [{ contentMatcher: 'pattern1' }, { contentMatcher: 'pattern2' }],
              },
              authorisationInfo: {
                description: 'Test script',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        headers: [],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const messages = detectCompositeMatchers(inventory)
      expect(messages).toContain('ℹ️  Found orMatcher in scripts.authoriseWith.matcher (alternative authorization policies)')
    })

    it('should detect andMatcher in scripts.authoriseWith.matcher', () => {
      const inventory = {
        scripts: [
          {
            identifyWith: { nameMatcher: 'test' },
            authoriseWith: {
              matcher: {
                andMatcher: [{ contentMatcher: 'pattern1' }, { contentMatcher: 'pattern2' }],
              },
              authorisationInfo: {
                description: 'Test script',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        headers: [],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const messages = detectCompositeMatchers(inventory)
      expect(messages).toContain('ℹ️  Found andMatcher in scripts.authoriseWith.matcher (multi-condition authorization)')
    })

    it('should detect orMatcher in headers.identifyWith', () => {
      const inventory = {
        scripts: [],
        headers: [
          {
            identifyWith: {
              orMatcher: [{ headerNameMatcher: 'content-security-policy' }, { headerNameMatcher: 'x-content-security-policy' }],
            },
            authoriseWith: {
              matcher: { contentMatcher: 'default-src' },
              authorisationInfo: {
                description: 'Test header',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const messages = detectCompositeMatchers(inventory)
      expect(messages).toContain('ℹ️  Found orMatcher in headers.identifyWith (multi-alternative identification)')
    })

    it('should detect andMatcher in headers.authoriseWith.matcher', () => {
      const inventory = {
        scripts: [],
        headers: [
          {
            identifyWith: { headerNameMatcher: 'content-security-policy' },
            authoriseWith: {
              matcher: {
                andMatcher: [{ contentMatcher: 'default-src https:' }, { contentMatcher: 'script-src https:' }],
              },
              authorisationInfo: {
                description: 'CSP with multiple required directives',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const messages = detectCompositeMatchers(inventory)
      expect(messages).toContain('ℹ️  Found andMatcher in headers.authoriseWith.matcher (multi-condition authorization)')
    })

    it('should detect multiple composite matcher types in same inventory', () => {
      const inventory = {
        scripts: [
          {
            identifyWith: {
              orMatcher: [{ nameMatcher: 'pattern1' }, { nameMatcher: 'pattern2' }],
            },
            authoriseWith: {
              matcher: { contentMatcher: 'content' },
              authorisationInfo: {
                description: 'Test script',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        headers: [
          {
            identifyWith: { headerNameMatcher: 'content-security-policy' },
            authoriseWith: {
              matcher: {
                andMatcher: [{ contentMatcher: 'default-src' }, { contentMatcher: 'script-src' }],
              },
              authorisationInfo: {
                description: 'Test header',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const messages = detectCompositeMatchers(inventory)
      expect(messages).toContain('ℹ️  Found orMatcher in scripts.identifyWith (multi-alternative identification)')
      expect(messages).toContain('ℹ️  Found andMatcher in headers.authoriseWith.matcher (multi-condition authorization)')
      expect(messages.length).toBe(2)
    })

    it('should return empty array for inventory without composite matchers', () => {
      const inventory = {
        scripts: [
          {
            identifyWith: { nameMatcher: 'simple-pattern' },
            authoriseWith: {
              matcher: { contentMatcher: 'content' },
              authorisationInfo: {
                description: 'Simple script',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        headers: [],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const messages = detectCompositeMatchers(inventory)
      expect(messages).toEqual([])
    })

    it('should return empty array for null inventory', () => {
      const messages = detectCompositeMatchers(null)
      expect(messages).toEqual([])
    })

    it('should return empty array for undefined inventory', () => {
      const messages = detectCompositeMatchers(undefined)
      expect(messages).toEqual([])
    })

    it('should deduplicate identical messages', () => {
      const inventory = {
        scripts: [
          {
            identifyWith: {
              orMatcher: [{ nameMatcher: 'pattern1' }, { nameMatcher: 'pattern2' }],
            },
            authoriseWith: {
              matcher: { contentMatcher: 'content' },
              authorisationInfo: {
                description: 'First script',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
          {
            identifyWith: {
              orMatcher: [{ nameMatcher: 'pattern3' }, { nameMatcher: 'pattern4' }],
            },
            authoriseWith: {
              matcher: { contentMatcher: 'content' },
              authorisationInfo: {
                description: 'Second script',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        headers: [],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const messages = detectCompositeMatchers(inventory)
      // Should only have one message despite two orMatcher usages
      expect(messages).toEqual(['ℹ️  Found orMatcher in scripts.identifyWith (multi-alternative identification)'])
    })
  })

  describe('validateInventory with composite matchers', () => {
    it('should accept valid orMatcher in authoriseWith.matcher', () => {
      const inventory = {
        scripts: [
          {
            identifyWith: { nameMatcher: 'test' },
            authoriseWith: {
              matcher: {
                orMatcher: [{ contentMatcher: 'pattern1' }, { contentMatcher: 'pattern2' }],
              },
              authorisationInfo: {
                description: 'Test script',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        headers: [],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const result = validateInventory(inventory)
      expect(result.success).toBe(true)
    })

    it('should accept valid andMatcher in authoriseWith.matcher', () => {
      const inventory = {
        scripts: [],
        headers: [
          {
            identifyWith: { headerNameMatcher: 'content-security-policy' },
            authoriseWith: {
              matcher: {
                andMatcher: [{ contentMatcher: 'default-src https:' }, { contentMatcher: 'script-src https:' }],
              },
              authorisationInfo: {
                description: 'CSP with required directives',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const result = validateInventory(inventory)
      expect(result.success).toBe(true)
    })

    it('should reject orMatcher with empty array', () => {
      const inventory = {
        scripts: [
          {
            identifyWith: { nameMatcher: 'test' },
            authoriseWith: {
              matcher: {
                orMatcher: [], // Invalid: empty array
              },
              authorisationInfo: {
                description: 'Test script',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        headers: [],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const result = validateInventory(inventory)
      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.some((err) => err.includes('Array must contain at least 1 element(s)'))).toBe(true)
    })

    it('should reject andMatcher with empty array', () => {
      const inventory = {
        scripts: [],
        headers: [
          {
            identifyWith: { headerNameMatcher: 'content-security-policy' },
            authoriseWith: {
              matcher: {
                andMatcher: [], // Invalid: empty array
              },
              authorisationInfo: {
                description: 'CSP header',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const result = validateInventory(inventory)
      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.some((err) => err.includes('Array must contain at least 1 element(s)'))).toBe(true)
    })

    it('should accept nested composite matchers', () => {
      const inventory = {
        scripts: [],
        headers: [
          {
            identifyWith: { headerNameMatcher: 'content-security-policy' },
            authoriseWith: {
              matcher: {
                orMatcher: [
                  {
                    andMatcher: [{ contentMatcher: 'default-src https:' }, { contentMatcher: 'script-src https:' }],
                  },
                  {
                    andMatcher: [{ contentMatcher: 'default-src' }, { contentMatcher: 'script-src' }],
                  },
                ],
              },
              authorisationInfo: {
                description: 'Nested composite matcher',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const result = validateInventory(inventory)
      expect(result.success).toBe(true)
    })

    it('should accept composite matchers with nested authorisationInfo', () => {
      const inventory = {
        scripts: [],
        headers: [
          {
            identifyWith: { headerNameMatcher: 'content-security-policy' },
            authoriseWith: {
              matcher: {
                andMatcher: [
                  {
                    contentMatcher: 'default-src https:',
                    authorisationInfo: {
                      description: 'Default-src directive required',
                      authorised: true,
                      date: '2025-10-24T00:00:00.000Z',
                    },
                  },
                  {
                    contentMatcher: 'script-src https:',
                    authorisationInfo: {
                      description: 'Script-src directive required',
                      authorised: true,
                      date: '2025-10-24T00:00:00.000Z',
                    },
                  },
                ],
              },
              authorisationInfo: {
                description: 'CSP with multiple required directives',
                authorised: true,
                date: '2025-10-24T00:00:00.000Z',
              },
            },
          },
        ],
        alerts: {},
        target: {
          inventory: 'https://example.com',
          detection: 'https://example.com',
        },
      }

      const result = validateInventory(inventory)
      expect(result.success).toBe(true)
    })
  })
})
