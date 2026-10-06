/**
 * MatcherConfig Zod Schema
 *
 * Validates matcher configuration from inventory JSON files.
 * Supports leaf matchers (nameMatcher, contentMatcher, hashes) and composite matchers (orMatcher, andMatcher).
 *
 * Enhanced with composite matcher support (Feature 005):
 * - orMatcher: Array of child matchers (any child matches) - FR-001
 * - andMatcher: Array of child matchers (all children match) - FR-002
 * - Recursive validation using z.lazy() for nested composites
 * - Optional authorisationInfo at composite level (FR-003, FR-004)
 *
 * @see ../matcher/matcher-factory.ts for matcher creation from validated config
 * @see ../../../specs/001-refactor-script-identification/research.md R2 and R6 for validation strategy
 * @see ../../../specs/005-enhance-the-schema/research.md for composite matcher design
 */

import { z } from 'zod'

import { INITIATOR_CHAIN_MAX_DEPTH } from '../initiator-chain.js'
import { SHA256HashSchema } from '../zod.js'

/**
 * Schema for a script hash and its timestamp.
 * Inline definition to avoid circular dependency with zod.ts
 */
const InventoryScriptHashInfoSchema = z.object({
  timestamp: z.coerce.date(),
  hash: SHA256HashSchema,
})

/**
 * Schema for authorization info in raw (JSON-serializable) format.
 * Used for composite matchers' top-level authorization metadata.
 */
const InventoryAuthorisationInfoRawSchema = z.object({
  description: z.string().min(1, 'description must not be empty'),
  authorised: z.boolean(),
  date: z.string().datetime(),
})

/**
 * Leaf matcher schemas
 *
 * All matchers (except HeaderNameMatcher) support optional authorisationInfo.
 * This enables authorization metadata to be attached at any level in the matcher tree,
 * preserving the exact structure specified in inventory files.
 */
const NameMatcherConfigSchema = z
  .object({
    nameMatcher: z.string().min(1, 'nameMatcher must not be empty'),
    authorisationInfo: InventoryAuthorisationInfoRawSchema.optional(),
  })
  .strict()

const HeaderNameMatcherConfigSchema = z
  .object({
    headerNameMatcher: z.string().min(1, 'headerNameMatcher must not be empty'),
    // No authorisationInfo - HeaderNameMatcher is only for identification, not authorization
  })
  .strict()

const ContentMatcherConfigSchema = z
  .object({
    contentMatcher: z.string().min(1, 'contentMatcher must not be empty'),
    authorisationInfo: InventoryAuthorisationInfoRawSchema.optional(),
  })
  .strict()

const HostMatcherConfigSchema = z
  .object({
    hostMatcher: z.string().min(1, 'hostMatcher must not be empty'),
    authorisationInfo: InventoryAuthorisationInfoRawSchema.optional(),
  })
  .strict()

const UrlMatcherConfigSchema = z
  .object({
    urlMatcher: z.string().min(1, 'urlMatcher must not be empty'),
    authorisationInfo: InventoryAuthorisationInfoRawSchema.optional(),
  })
  .strict()

/**
 * Two forms. The string form matches the immediate inserter's host (unchanged
 * since it was introduced). The object form with `transitive: true` matches
 * the host of any hop of the initiator chain, up to `maxDepth` hops out —
 * see InitiatorHostMatcher. `transitive` is required (and must be `true`) in
 * the object form, so the object form can never silently mean the
 * immediate-hop form. `kinds` (`script`, `document`; at least one) limits the
 * hops considered, and binds a `document` hop to the frame the script was
 * loaded into; omitted, every hop counts as before.
 */
const InitiatorHostMatcherConfigSchema = z
  .object({
    initiatorHostMatcher: z.union([
      z.string().min(1, 'initiatorHostMatcher must not be empty'),
      z
        .object({
          host: z.string().min(1, 'initiatorHostMatcher.host must not be empty'),
          transitive: z.literal(true),
          maxDepth: z.number().int().min(1).max(INITIATOR_CHAIN_MAX_DEPTH).optional(),
          kinds: z
            .array(z.enum(['script', 'document']))
            .min(1, 'initiatorHostMatcher.kinds must name at least one hop kind')
            .optional(),
        })
        .strict(),
    ]),
    authorisationInfo: InventoryAuthorisationInfoRawSchema.optional(),
  })
  .strict()

const WorkflowMatcherConfigSchema = z
  .object({
    workflowMatcher: z.string().min(1, 'workflowMatcher must not be empty'),
    authorisationInfo: InventoryAuthorisationInfoRawSchema.optional(),
  })
  .strict()

const TargetTypeMatcherConfigSchema = z
  .object({
    targetTypeMatcher: z.string().min(1, 'targetTypeMatcher must not be empty'),
    authorisationInfo: InventoryAuthorisationInfoRawSchema.optional(),
  })
  .strict()

const HashMatcherConfigSchema = z
  .object({
    hashes: z.array(InventoryScriptHashInfoSchema).min(1, 'hashes array must contain at least 1 hash'),
    authorisationInfo: InventoryAuthorisationInfoRawSchema.optional(),
  })
  .strict()

/**
 * Composite matcher schemas (new)
 *
 * Use z.lazy() to enable recursive validation of nested composites.
 * This allows unlimited nesting depth (FR-013) with natural performance degradation as boundary.
 *
 * IMPORTANT: Must use explicit type annotation (z.ZodType<any>) on MatcherConfigSchema
 * for z.lazy() to resolve circular references correctly.
 */
/**
 * Set-based Content-Security-Policy directive matcher.
 *
 * `allow` is the approved set of source expressions. An observed directive is
 * authorised when every source it carries appears in that set, regardless of
 * order — see CspDirectiveMatcher for the rationale.
 */
const CspDirectiveMatcherConfigSchema = z
  .object({
    cspDirectiveMatcher: z.object({
      directive: z
        .string()
        .trim()
        .min(1, 'cspDirectiveMatcher.directive must not be empty')
        .regex(/^[A-Za-z][A-Za-z0-9-]*$/u, 'cspDirectiveMatcher.directive must be a CSP directive name, e.g. "script-src"'),
      allow: z.array(z.string().trim().min(1, 'cspDirectiveMatcher.allow entries must not be empty')),
    }),
    authorisationInfo: InventoryAuthorisationInfoRawSchema.optional(),
  })
  .strict()

const OrMatcherConfigSchema = z
  .object({
    orMatcher: z.lazy(() => z.array(MatcherConfigSchema).min(1, 'orMatcher must contain at least 1 child')),
    authorisationInfo: InventoryAuthorisationInfoRawSchema.optional(),
  })
  .strict()

const AndMatcherConfigSchema = z
  .object({
    andMatcher: z.lazy(() => z.array(MatcherConfigSchema).min(1, 'andMatcher must contain at least 1 child')),
    authorisationInfo: InventoryAuthorisationInfoRawSchema.optional(),
  })
  .strict()

/**
 * Zod schema for MatcherConfig union type.
 *
 * Validates:
 * - Exactly one variant must be present (union enforces this)
 * - Regex patterns are syntactically valid (custom refinement)
 * - Hash arrays have at least 1 element
 * - Composite matcher arrays have at least 1 child (FR-008, FR-012)
 * - Recursive validation of nested composites
 *
 * Error messages include:
 * - Which field has the invalid regex (nameMatcher vs headerNameMatcher vs contentMatcher)
 * - The invalid pattern itself
 * - JavaScript RegExp error message
 * - Suggestion to check bracket matching and escape sequences
 * - Composite matcher validation errors (empty arrays, invalid children)
 *
 * IMPORTANT: Explicit type annotation required for z.lazy() circular reference resolution.
 */
export const MatcherConfigSchema: z.ZodType<any> = z
  .union([
    NameMatcherConfigSchema,
    HeaderNameMatcherConfigSchema,
    ContentMatcherConfigSchema,
    HostMatcherConfigSchema,
    InitiatorHostMatcherConfigSchema,
    UrlMatcherConfigSchema,
    WorkflowMatcherConfigSchema,
    TargetTypeMatcherConfigSchema,
    CspDirectiveMatcherConfigSchema,
    HashMatcherConfigSchema,
    OrMatcherConfigSchema,
    AndMatcherConfigSchema,
  ])
  .superRefine((val, ctx) => {
    // Validate regex syntax for nameMatcher
    if ('nameMatcher' in val) {
      try {
        new RegExp(val.nameMatcher)
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : 'Unknown regex error'
        ctx.addIssue({
          code: 'custom',
          message: `Invalid regex in nameMatcher: "${val.nameMatcher}". Error: ${errorMessage}. Ensure all brackets are closed and escape sequences are valid.`,
          path: ['nameMatcher'],
        })
      }
    }

    // Validate regex syntax for headerNameMatcher
    if ('headerNameMatcher' in val) {
      try {
        new RegExp(val.headerNameMatcher)
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : 'Unknown regex error'
        ctx.addIssue({
          code: 'custom',
          message: `Invalid regex in headerNameMatcher: "${val.headerNameMatcher}". Error: ${errorMessage}. Ensure all brackets are closed and escape sequences are valid.`,
          path: ['headerNameMatcher'],
        })
      }
    }

    // Validate regex syntax for contentMatcher
    if ('contentMatcher' in val) {
      try {
        new RegExp(val.contentMatcher)
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : 'Unknown regex error'
        ctx.addIssue({
          code: 'custom',
          message: `Invalid regex in contentMatcher: "${val.contentMatcher}". Error: ${errorMessage}. Ensure all brackets are closed and escape sequences are valid.`,
          path: ['contentMatcher'],
        })
      }
    }

    // Validate regex syntax for hostMatcher
    if ('hostMatcher' in val) {
      try {
        new RegExp(val.hostMatcher)
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : 'Unknown regex error'
        ctx.addIssue({
          code: 'custom',
          message: `Invalid regex in hostMatcher: "${val.hostMatcher}". Error: ${errorMessage}. Ensure all brackets are closed and escape sequences are valid.`,
          path: ['hostMatcher'],
        })
      }
    }

    if ('initiatorHostMatcher' in val) {
      // The regex lives at the top level in the string form and under `host`
      // in the transitive object form; validate whichever is present.
      const spec: string | { host: string } = val.initiatorHostMatcher
      const transitive = typeof spec !== 'string'
      const pattern = typeof spec === 'string' ? spec : spec.host
      try {
        new RegExp(pattern)
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : 'Unknown regex error'
        ctx.addIssue({
          code: 'custom',
          message: `Invalid regex in initiatorHostMatcher${transitive ? '.host' : ''}: "${pattern}". Error: ${errorMessage}. Ensure all brackets are closed and escape sequences are valid.`,
          path: transitive ? ['initiatorHostMatcher', 'host'] : ['initiatorHostMatcher'],
        })
      }
    }

    // Validate regex syntax for urlMatcher
    if ('urlMatcher' in val) {
      try {
        new RegExp(val.urlMatcher)
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : 'Unknown regex error'
        ctx.addIssue({
          code: 'custom',
          message: `Invalid regex in urlMatcher: "${val.urlMatcher}". Error: ${errorMessage}. Ensure all brackets are closed and escape sequences are valid.`,
          path: ['urlMatcher'],
        })
      }
    }

    if ('targetTypeMatcher' in val) {
      try {
        new RegExp(val.targetTypeMatcher)
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : 'Unknown regex error'
        ctx.addIssue({
          code: 'custom',
          message: `Invalid regex in targetTypeMatcher: "${val.targetTypeMatcher}". Error: ${errorMessage}. Ensure all brackets are closed and escape sequences are valid.`,
          path: ['targetTypeMatcher'],
        })
      }
    }

    if ('workflowMatcher' in val) {
      try {
        new RegExp(val.workflowMatcher)
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : 'Unknown regex error'
        ctx.addIssue({
          code: 'custom',
          message: `Invalid regex in workflowMatcher: "${val.workflowMatcher}". Error: ${errorMessage}. Ensure all brackets are closed and escape sequences are valid.`,
          path: ['workflowMatcher'],
        })
      }
    }
  })

/**
 * TypeScript type inferred from Zod schema.
 * Use this type for raw JSON data before matcher creation.
 *
 * Note: Composite matchers (orMatcher, andMatcher) are now supported.
 */
export type RawMatcherConfig = z.infer<typeof MatcherConfigSchema>
