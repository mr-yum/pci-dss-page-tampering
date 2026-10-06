import { z } from 'zod'

import { RESPONSE_RESOURCE_TYPES } from '../header.js'
import { INITIATOR_CHAIN_MAX_DEPTH, INLINE_SCRIPT_NAME_PREFIX } from '../initiator-chain.js'
import { createMatcher } from '../matcher/matcher-factory.js'
import { OrMatcher } from '../matcher/or-matcher.js'
import { TARGET_TYPES } from '../target.js'
import type { RawTargetDetection, RawTargetInventory } from '../target/raw.js'
import { SHA256HashSchema } from '../zod.js'
import { MatcherConfigSchema } from './matcher-config-schema.js'
import type { AlertDestination, AlertDetection, AlertInventory, AlertRum, AuthorizeWithConfig, InventoryAlert, InventoryAuthorisationInfo, InventoryScriptHashInfo } from './model.js'
import type { RawAuthorizeWithConfig, RawInventory, RawInventoryHeaderInfo, RawInventoryScriptInfo, RawInventoryTarget, RawInventoryWorkflow } from './raw.js'

export const AlertDestinationSchema: z.ZodType<AlertDestination> = z.object({
  destination: z.string().min(1, 'Alert destination cannot be empty'),
})

export const AlertInventorySchema: z.ZodType<AlertInventory> = z.object({
  newScriptIdentified: AlertDestinationSchema,
  newHeaderIdentified: AlertDestinationSchema,
})

export const AlertDetectionSchema: z.ZodType<AlertDetection> = z.object({
  newScriptDetected: AlertDestinationSchema,
  scriptMismatchDetected: AlertDestinationSchema,
  newHeaderDetected: AlertDestinationSchema,
  headerMismatchDetected: AlertDestinationSchema.optional(),
  missingHeaderDetected: AlertDestinationSchema.optional(),
  missingScriptDetected: AlertDestinationSchema.optional(),
})

/**
 * Destinations for the `rum_*` alert categories (feature 011). Every key is
 * optional so existing inventories parse unchanged. The two script categories
 * fall back to the analogous synthetic detection destination at resolution
 * time; `cspViolationReported` never falls back — the category is opt-in per
 * target (T035): configuring the destination IS the activation switch, and
 * omitting it keeps CSP violations recorded-only (extension noise would flood
 * the header channels if the generic fallback chain applied).
 */
export const AlertRumSchema: z.ZodType<AlertRum> = z.object({
  uninventoriedScriptDetected: AlertDestinationSchema.optional(),
  mismatchedScriptDetected: AlertDestinationSchema.optional(),
  cspViolationReported: AlertDestinationSchema.optional(),
  cspViolationReportedMinSessions: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Prevalence floor for rum_csp_violation_reported: alert only when the observed session count meets this value. ' +
        'Honest limitation: first-sighting queue messages carry no live session counters, so the available prevalence at drain time is always 1 — ' +
        'a value of 1 (or omitting the field) alerts on first sighting, while any value above 1 gates every first sighting to recorded-only and ' +
        'defers alerting to operator-driven re-evaluation of the archived counters. There is deliberately no collector-side re-enqueue when ' +
        'counters later cross the threshold; that is the future refinement if thresholds prove needed.',
    ),
})

export const InventoryAlertSchema: z.ZodType<InventoryAlert> = z.object({
  inventory: AlertInventorySchema,
  detection: AlertDetectionSchema,
  rum: AlertRumSchema.optional(),
  successNotification: AlertDestinationSchema,
})

/**
 * Base schema for a Target.
 * This is used to build the more specific target types.
 * Corresponds to `Target`.
 */
const TargetSchema = z.object({
  type: z.enum(['inventory', 'detection']),
  name: z.string().optional(),
  url: z.url(),
})

/**
 * Schema for an Inventory Target.
 * It intersects the base TargetSchema and refines the 'type' literal.
 * Corresponds to `RawTargetInventory`.
 */
export const RawTargetInventorySchema = TargetSchema.extend({
  type: z.literal('inventory'),
  workflow: z.string(),
}) satisfies z.ZodType<RawTargetInventory>

/**
 * Schema for a Detection Target.
 * It intersects the base TargetSchema and refines the 'type' literal.
 * Corresponds to `RawTargetDetection`.
 */
export const RawTargetDetectionSchema = TargetSchema.extend({
  type: z.literal('detection'),
  workflow: z.string(),
}) satisfies z.ZodType<RawTargetDetection>

/**
 * Schema for script authorisation details.
 * Corresponds to `InventoryAuthorisationInfo`.
 */
export const InventoryAuthorisationInfoSchema: z.ZodType<InventoryAuthorisationInfo> = z.object({
  description: z.string(),
  authorised: z.boolean(),
  date: z.coerce.date(),
})

/**
 * Schema for a script hash and its timestamp.
 * Corresponds to `InventoryScriptHashInfo`.
 */
export const InventoryScriptHashInfoSchema: z.ZodType<InventoryScriptHashInfo> = z.object({
  timestamp: z.coerce.date(),
  hash: SHA256HashSchema,
})

/**
 * Schema for authorization info in raw (JSON-serializable) format.
 * Used for nested authorization metadata within RawAuthorizeWithConfig.
 */
export const InventoryAuthorisationInfoRawSchema = z.object({
  description: z.string().min(1),
  authorised: z.boolean(),
  date: z.string().datetime(),
})

/**
 * Schema for the composite authorization structure in raw (JSON-serializable) format.
 * Combines matcher configuration with authorization metadata as siblings.
 *
 * Supports two syntaxes:
 * 1. Single matcher: { nameMatcher: "...", authorisationInfo: {...} }
 * 2. Array syntax (FR-006): [{ contentMatcher: "...", authorisationInfo: {...} }, { contentMatcher: "...", authorisationInfo: {...} }]
 *    - Array syntax is syntactic sugar for OrMatcher
 *    - Each array element must have its own authorisationInfo
 *    - Automatically converted to OrMatcher during inventory loading
 *
 * Corresponds to `RawAuthorizeWithConfig`.
 */
export const RawAuthorizeWithConfigSchema = z.union([
  // Single matcher (existing)
  z.intersection(
    MatcherConfigSchema,
    z.object({
      authorisationInfo: InventoryAuthorisationInfoRawSchema,
    }),
  ),

  // Array of matchers (NEW - syntactic sugar for OR, FR-006)
  // Each element is a matcher config with its own authorisationInfo
  z
    .array(
      z.intersection(
        MatcherConfigSchema,
        z.object({
          authorisationInfo: InventoryAuthorisationInfoRawSchema,
        }),
      ),
    )
    .min(1, 'authoriseWith array must contain at least 1 matcher'),
])

/**
 * Schema for information about an inventory script.
 * Corresponds to `RawInventoryScriptInfo`.
 *
 * Updated schema (Phase 3):
 * - Replaces nameMatcher/contentMatcher/hashes with identifyWith/authoriseWith
 * - authoriseWith uses RawAuthorizeWithConfigSchema (matcher config + authorization metadata)
 * - Old schema format is rejected (no backward compatibility per clarification Q4)
 */
/** True when a matcher config (or any nested composite child) is a headerNameMatcher. */
function containsHeaderNameMatcher(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false
  if (Array.isArray(config)) return config.some(containsHeaderNameMatcher)

  const node = config as Record<string, unknown>

  if ('headerNameMatcher' in node) return true

  return containsHeaderNameMatcher(node['orMatcher']) || containsHeaderNameMatcher(node['andMatcher'])
}

/**
 * Matchers that judge a loaded script on its own evidence: its URL (as `name`
 * for an external script, and `url`/host), its content or its hash. Everything
 * else in a guard is either run metadata every script in the run shares
 * (`workflowMatcher`, `targetTypeMatcher`) or evidence `ownEvidence` drops
 * before the guard runs (`initiatorHostMatcher`), so it cannot tell one load
 * from another.
 */
const OWN_EVIDENCE_MATCHERS = ['nameMatcher', 'urlMatcher', 'hostMatcher', 'contentMatcher', 'hashes'] as const

/**
 * True when a `loadsMatching` config can only admit a load on the load's own
 * evidence: a leaf must be an own-evidence matcher, every alternative of an OR
 * (or array) must be, and at least one conjunct of an AND must be.
 */
function constrainsOwnEvidence(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false
  if (Array.isArray(config)) return config.length > 0 && config.every(constrainsOwnEvidence)
  const node = config as Record<string, unknown>
  if (Array.isArray(node['orMatcher'])) return constrainsOwnEvidence(node['orMatcher'])
  if (Array.isArray(node['andMatcher'])) return node['andMatcher'].some(constrainsOwnEvidence)
  return OWN_EVIDENCE_MATCHERS.some((key) => key in node)
}

/** Names an inline script can carry, for probing whether a guard pattern would admit one. */
const INLINE_NAME_PROBES = [INLINE_SCRIPT_NAME_PREFIX, `${INLINE_SCRIPT_NAME_PREFIX}id_not_found`, `${INLINE_SCRIPT_NAME_PREFIX}boot#k1-1`]

/** The `nameMatcher` patterns in a guard that would admit an inline script's name. */
function inlineAdmittingNamePatterns(config: unknown): string[] {
  if (typeof config !== 'object' || config === null) return []
  if (Array.isArray(config)) return config.flatMap(inlineAdmittingNamePatterns)
  const node = config as Record<string, unknown>
  const own = node['nameMatcher']
  const admits = (pattern: string): boolean => {
    if (/inline_script/i.test(pattern)) return true
    try {
      const regex = new RegExp(pattern)
      return INLINE_NAME_PROBES.some((probe) => regex.test(probe))
    } catch {
      return false // reported by the matcher schema
    }
  }
  return [...(typeof own === 'string' && admits(own) ? [own] : []), ...inlineAdmittingNamePatterns(node['orMatcher']), ...inlineAdmittingNamePatterns(node['andMatcher'])]
}

export const RawInventoryScriptInfoSchema: z.ZodType<RawInventoryScriptInfo> = z
  .object({
    identifyWith: MatcherConfigSchema,
    authoriseWith: RawAuthorizeWithConfigSchema,
    // Passes on which some detected script must be identified by this entry —
    // absence yields a MissingRequiredScript alert. Unlike the header
    // requiredOn, no identifyWith restriction is needed: presence is tested
    // against real detected scripts (which carry name, content, hash, url), so
    // every matcher type evaluates with its normal semantics.
    requiredOn: z.array(z.enum(TARGET_TYPES)).min(1).optional(),
    // Trust grant: scripts this entry's script loads inherit its authorisation
    // (see LoadGrant in model.ts and the transitive-trust section of AGENTS.md).
    authorisesLoads: z.enum(['direct', 'transitive']).optional(),
    maxDepth: z.number().int().min(1).max(INITIATOR_CHAIN_MAX_DEPTH).optional(),
    loadsMatching: MatcherConfigSchema.optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.authorisesLoads === undefined) {
      for (const field of ['maxDepth', 'loadsMatching'] as const) {
        if (entry[field] !== undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} only applies to an entry that declares authorisesLoads.` })
        }
      }
    } else {
      if (entry.authorisesLoads === 'direct' && entry.maxDepth !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxDepth'], message: 'maxDepth only applies to authorisesLoads: "transitive" — a direct grant covers exactly the scripts this entry\'s script inserted itself.' })
      }
      // A grant is a statement about an authorised script. An entry that is not
      // authorised never authorises anything (the comparison skips it), so a
      // grant on it can only be a mistake — or a grant waiting to switch on
      // silently the day someone flips `authorised`. Refuse it outright.
      const entryInfo = Array.isArray(entry.authoriseWith) ? entry.authoriseWith[0]?.authorisationInfo : entry.authoriseWith.authorisationInfo
      if (entryInfo?.authorised !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['authorisesLoads'],
          message: 'authorisesLoads requires an authorised entry (authoriseWith.authorisationInfo.authorised: true): only a script this entry authorised can vouch for what it loads.',
        })
      }
      // Required: chain evidence comes partly from the page itself (an
      // attribution shim in the page's own world, and call stacks whose frame
      // URLs `//# sourceURL` can rename), so the one unforgeable check on a
      // load — its own URL — must always be made. Name hosts that serve only
      // the vendor's own code.
      if (entry.loadsMatching === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['loadsMatching'],
          message:
            "authorisesLoads requires loadsMatching: a matcher on the loaded script (e.g. a nameMatcher naming the vendor hosts that serve only its own code). Chain evidence can be influenced by code running on the page; the load's own URL cannot.",
        })
      }
      if (entry.loadsMatching !== undefined && containsHeaderNameMatcher(entry.loadsMatching)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['loadsMatching'], message: 'headerNameMatcher is not valid in loadsMatching: it guards script URLs, which are case-sensitive. Use nameMatcher.' })
      }
      // A guard must judge the load itself. workflowMatcher/targetTypeMatcher
      // match run metadata every script shares, and initiatorHostMatcher
      // reads evidence the guard never sees, so a guard made of those alone
      // (or an OR with such an alternative) admits — or refuses — every load
      // alike.
      if (entry.loadsMatching !== undefined && !containsHeaderNameMatcher(entry.loadsMatching) && !constrainsOwnEvidence(entry.loadsMatching)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['loadsMatching'],
          message: `loadsMatching must judge the loaded script on its own evidence: every alternative needs a ${OWN_EVIDENCE_MATCHERS.join('/')} (an andMatcher needs at least one such conjunct). workflowMatcher and targetTypeMatcher match every script in the run alike, and initiatorHostMatcher is not shown to the guard.`,
        })
      }
      // An inline load never inherits (the comparison refuses it whatever the
      // guard says), so a guard written to admit inline names says something
      // the monitor will not do. Refuse it rather than let it read as working.
      const inlinePatterns = entry.loadsMatching === undefined ? [] : inlineAdmittingNamePatterns(entry.loadsMatching)
      if (inlinePatterns.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['loadsMatching'],
          message: `loadsMatching must not admit inline scripts (${inlinePatterns.map((pattern) => `nameMatcher "${pattern}"`).join(', ')}): an inline load never inherits, because its name and chain are page-controlled evidence. Authorise an inline script with its own entry on its content or hash, and anchor guard patterns to the vendor's own origin (e.g. "^https://js\\.vendor\\.example/").`,
        })
      }
    }

    // HeaderNameMatcher matches case-insensitively (RFC 7230 header names).
    // Script names are URLs, where case is significant — identifying a script
    // entry case-insensitively would let a case-variant URL reach the entry's
    // authorisation matcher. Reject at the boundary rather than trusting every
    // downstream consumer to remember the distinction.
    for (const [field, config] of [
      ['identifyWith', entry.identifyWith],
      ['authoriseWith', entry.authoriseWith],
    ] as const) {
      if (containsHeaderNameMatcher(config)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'headerNameMatcher is not valid in a script entry: header names match case-insensitively, but script URLs are case-sensitive. Use nameMatcher.',
        })
      }
    }
  })

/**
 * Schema for the inventory target, including its workflow.
 * Corresponds to `RawInventoryTarget`.
 */
const WorkflowIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, 'Workflow id must start with a lowercase letter or number and contain only lowercase letters, numbers, dots, underscores, or hyphens')

export const RawInventoryWorkflowSchema: z.ZodType<RawInventoryWorkflow> = z.object({
  id: WorkflowIdSchema,
  inventory: RawTargetInventorySchema,
  detection: RawTargetDetectionSchema,
})

export const RawInventoryTargetSchema: z.ZodType<RawInventoryTarget> = z.union([
  z
    .object({
      inventory: RawTargetInventorySchema,
      detection: RawTargetDetectionSchema,
    })
    .strict(),
  z
    .object({
      workflows: z.array(RawInventoryWorkflowSchema).min(1, 'target.workflows must contain at least one workflow'),
    })
    .strict()
    .superRefine((target, context) => {
      const seen = new Set<string>()
      target.workflows.forEach((workflow, index) => {
        if (seen.has(workflow.id)) {
          context.addIssue({
            code: 'custom',
            path: ['workflows', index, 'id'],
            message: `Workflow id '${workflow.id}' must be unique within an inventory`,
          })
        }
        seen.add(workflow.id)
      })
    }),
])

/**
 * Schema for information about an inventory header.
 * Corresponds to `RawInventoryHeaderInfo`.
 *
 * Updated schema (Phase 5 - US3):
 * - Uses identifyWith/authoriseWith matcher-based structure (aligned with scripts)
 * - authoriseWith uses RawAuthorizeWithConfigSchema (matcher config + authorization metadata)
 * - Replaces old nameMatcher/contentMatcher RegExp structure
 */
export const RawInventoryHeaderInfoSchema: z.ZodType<RawInventoryHeaderInfo> = z
  .object({
    identifyWith: MatcherConfigSchema,
    authoriseWith: RawAuthorizeWithConfigSchema,
    requiredOn: z.array(z.enum(RESPONSE_RESOURCE_TYPES)).min(1).optional(),
  })
  .superRefine((entry, context) => {
    if (entry.requiredOn === undefined) return

    const exactHeaderNames = (matcher: any): string[] => {
      if ('headerNameMatcher' in matcher) {
        const match = /^\^([a-z0-9-]+)\$$/i.exec(matcher.headerNameMatcher)
        return match?.[1] ? [match[1].toLowerCase()] : []
      }
      if ('andMatcher' in matcher) return matcher.andMatcher.flatMap(exactHeaderNames)
      return []
    }

    const unsupportedPresenceMatchers = (matcher: any): string[] => {
      if ('headerNameMatcher' in matcher || 'hostMatcher' in matcher || 'urlMatcher' in matcher || 'workflowMatcher' in matcher || 'targetTypeMatcher' in matcher) return []
      if ('andMatcher' in matcher) return matcher.andMatcher.flatMap(unsupportedPresenceMatchers)
      if ('contentMatcher' in matcher) return ['contentMatcher']
      if ('nameMatcher' in matcher) return ['nameMatcher']
      if ('hashes' in matcher) return ['hashes']
      if ('orMatcher' in matcher) return ['orMatcher']
      return ['unknown matcher']
    }

    if (exactHeaderNames(entry.identifyWith).length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['identifyWith'],
        message: 'A requiredOn header entry must contain exactly one anchored headerNameMatcher such as "^strict-transport-security$".',
      })
    }

    const unsupported = unsupportedPresenceMatchers(entry.identifyWith)
    if (unsupported.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['identifyWith'],
        message: `A requiredOn header entry can identify responses only with headerNameMatcher, hostMatcher, urlMatcher, workflowMatcher, targetTypeMatcher, and andMatcher; unsupported: ${[...new Set(unsupported)].join(', ')}.`,
      })
    }
  })

/**
 * Schema for the complete inventory.
 * This is the top-level schema.
 * Corresponds to `RawInventory`.
 */
export const RawInventorySchema: z.ZodType<RawInventory> = z.object({
  target: RawInventoryTargetSchema,
  alerts: InventoryAlertSchema,
  scripts: z.array(RawInventoryScriptInfoSchema),
  headers: z.array(RawInventoryHeaderInfoSchema),
})

/**
 * Processes RawAuthorizeWithConfig to convert array syntax to OrMatcher.
 *
 * Handles two cases:
 * 1. Single matcher: Returns AuthorizeWithConfig with matcher and authorisationInfo
 * 2. Array syntax (FR-006): Converts array to OrMatcher automatically
 *    - Each array element becomes a child matcher with its own authorisationInfo preserved
 *    - AuthorisationMatcher design ensures metadata is preserved exactly as specified
 *    - Uses first element's authorisationInfo as the top-level authorization metadata
 *
 * @param rawConfig - Raw authorization configuration (single matcher or array)
 * @returns AuthorizeWithConfig with Matcher instance(s)
 */
export function processAuthorizeWith(rawConfig: RawAuthorizeWithConfig): AuthorizeWithConfig {
  if (Array.isArray(rawConfig)) {
    // Array syntax: Convert to OrMatcher (FR-006)
    // Each array element must have authorisationInfo (validated by Zod schema)
    //
    // With AuthorisationMatcher design, each child preserves its own authorisationInfo
    // The OrMatcher itself does NOT have authorisationInfo (to preserve array syntax on serialization)
    const children = rawConfig.map((element) => createMatcher(element as any))

    // Use first element's authorisationInfo as the AuthorizeWithConfig's authorisationInfo
    // This is separate from the matcher's authorisationInfo
    const firstElementInfo = rawConfig[0].authorisationInfo

    return {
      matcher: new OrMatcher(children), // No authorisationInfo on the matcher itself
      authorisationInfo: {
        description: firstElementInfo.description,
        authorised: firstElementInfo.authorised,
        date: new Date(firstElementInfo.date),
      },
    }
  } else {
    // Single matcher (existing path)
    const { authorisationInfo, ...matcherConfig } = rawConfig

    return {
      matcher: createMatcher(matcherConfig),
      authorisationInfo: {
        description: authorisationInfo.description,
        authorised: authorisationInfo.authorised,
        date: new Date(authorisationInfo.date),
      },
    }
  }
}
