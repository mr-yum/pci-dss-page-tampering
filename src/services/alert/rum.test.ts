import type { RumAlertCategory, RumAlertContext } from '../../types/alert.js'
import type { InventoryAlert } from '../../types/inventory/model.js'
import { resolveRumAlertDestination, rumAlertContextLines, rumAlertTitle } from './rum.js'

describe('resolveRumAlertDestination', () => {
  const baseAlerts = (): InventoryAlert => ({
    inventory: {
      newScriptIdentified: { destination: 'inventory-script-channel' },
      newHeaderIdentified: { destination: 'inventory-header-channel' },
    },
    detection: {
      newScriptDetected: { destination: 'detection-script-channel' },
      scriptMismatchDetected: { destination: 'script-mismatch-channel' },
      newHeaderDetected: { destination: 'detection-header-channel' },
    },
    successNotification: { destination: 'success-channel' },
  })

  describe('per-category destinations from the rum block', () => {
    const alerts: InventoryAlert = {
      ...baseAlerts(),
      rum: {
        uninventoriedScriptDetected: { destination: 'rum-uninventoried-channel' },
        mismatchedScriptDetected: { destination: 'rum-mismatched-channel' },
        cspViolationReported: { destination: 'rum-csp-channel' },
      },
    }

    it('routes rum_uninventoried_script_detected to its configured destination', () => {
      expect(resolveRumAlertDestination(alerts, 'rum_uninventoried_script_detected')).toEqual({ destination: 'rum-uninventoried-channel' })
    })

    it('routes rum_mismatched_script_detected to its configured destination', () => {
      expect(resolveRumAlertDestination(alerts, 'rum_mismatched_script_detected')).toEqual({ destination: 'rum-mismatched-channel' })
    })

    it('routes rum_csp_violation_reported to its configured destination', () => {
      expect(resolveRumAlertDestination(alerts, 'rum_csp_violation_reported')).toEqual({ destination: 'rum-csp-channel' })
    })
  })

  describe('fallbacks when the rum block is absent', () => {
    it('falls back to detection.newScriptDetected for uninventoried scripts', () => {
      expect(resolveRumAlertDestination(baseAlerts(), 'rum_uninventoried_script_detected')).toEqual({ destination: 'detection-script-channel' })
    })

    it('falls back to detection.scriptMismatchDetected for mismatched scripts', () => {
      expect(resolveRumAlertDestination(baseAlerts(), 'rum_mismatched_script_detected')).toEqual({ destination: 'script-mismatch-channel' })
    })

    it('never falls back for rum_csp_violation_reported — the opt-in category throws without an explicit destination (T035)', () => {
      // Extension noise means an implicit activation via the header-channel
      // fallbacks would flood; routing records instead of alerting when the
      // destination is absent, so reaching the resolver is a programming error.
      const alerts = baseAlerts()
      alerts.detection.headerMismatchDetected = { destination: 'header-mismatch-channel' }
      expect(() => resolveRumAlertDestination(alerts, 'rum_csp_violation_reported')).toThrow(/opt-in via alerts\.rum\.cspViolationReported/)
    })

    it('does not fall back to detection.newHeaderDetected for CSP violations either', () => {
      expect(() => resolveRumAlertDestination(baseAlerts(), 'rum_csp_violation_reported')).toThrow(/opt-in via alerts\.rum\.cspViolationReported/)
    })
  })

  describe('partial rum block', () => {
    it('uses the configured category and falls back for the others', () => {
      const alerts: InventoryAlert = {
        ...baseAlerts(),
        rum: { mismatchedScriptDetected: { destination: 'rum-mismatched-channel' } },
      }

      expect(resolveRumAlertDestination(alerts, 'rum_mismatched_script_detected')).toEqual({ destination: 'rum-mismatched-channel' })
      expect(resolveRumAlertDestination(alerts, 'rum_uninventoried_script_detected')).toEqual({ destination: 'detection-script-channel' })
    })
  })

  it('rejects an unknown category loudly', () => {
    expect(() => resolveRumAlertDestination(baseAlerts(), 'rum_totally_made_up' as RumAlertCategory)).toThrow(/Unknown RUM alert category: rum_totally_made_up/)
  })
})

describe('rumAlertContextLines', () => {
  const context: RumAlertContext = {
    observation: {
      kind: 'inline-script',
      identity: 'inline_script/rum:abc123',
      initiator: 'https://pay.example.com/checkout',
      hash: 'a'.repeat(64),
    },
    prevalence: { first_seen: 1755600000123, last_seen: 1755600100123, sessions: 4 },
    first_route: '/checkout',
    targetType: 'detection',
    inventoryRef: 'deadbeef',
    failureReason: 'content is null or empty',
    matcherDescription: 'hash:1 authorized hash',
    metadataPath: [
      { description: 'Accept either pinned version', authorised: true, date: new Date('2026-08-01T00:00:00.000Z') },
      { description: 'Version 2 pinned hash', authorised: true, date: new Date('2026-08-01T00:00:00.000Z') },
    ],
  }

  it('carries every context field the alert contract requires', () => {
    const lines = rumAlertContextLines('rum_mismatched_script_detected', context)
    const byLabel = Object.fromEntries(lines.map((line) => [line.label, line.value]))

    expect(byLabel['Category']).toBe('rum_mismatched_script_detected')
    expect(byLabel['Identity']).toBe('inline_script/rum:abc123')
    expect(byLabel['Initiator']).toBe('https://pay.example.com/checkout')
    expect(byLabel['First Seen']).toBe(new Date(1755600000123).toISOString())
    expect(byLabel['Last Seen']).toBe(new Date(1755600100123).toISOString())
    expect(byLabel['Sessions']).toBe('4')
    expect(byLabel['First Route']).toBe('/checkout')
    expect(byLabel['Target Type']).toBe('detection')
    expect(byLabel['Inventory Ref']).toBe('deadbeef')
    expect(byLabel['Failure Reason']).toBe('content is null or empty')
    expect(byLabel['Authorisation Matcher']).toBe('hash:1 authorized hash')
    // Root → leaf, matching the comparison log's metadata-path rendering.
    expect(byLabel['Authorisation Path']).toBe('Accept either pinned version > Version 2 pinned hash')
  })

  it('omits optional evidence that the observation did not carry', () => {
    const minimal: RumAlertContext = {
      observation: { kind: 'external-script', identity: 'https://cdn.example.com/pixel.js' },
      prevalence: { first_seen: 1755600000123 },
      first_route: '/checkout',
      targetType: 'detection',
      inventoryRef: 'deadbeef',
    }

    const labels = rumAlertContextLines('rum_uninventoried_script_detected', minimal).map((line) => line.label)
    expect(labels).not.toContain('Initiator')
    expect(labels).not.toContain('Hash (client-computed SHA-256)')
    expect(labels).not.toContain('Last Seen')
    expect(labels).not.toContain('Sessions')
    expect(labels).not.toContain('Failure Reason')
    expect(labels).not.toContain('Authorisation Path')
  })
})

describe('rumAlertTitle', () => {
  it('names each category distinctly', () => {
    const titles = new Set(['rum_uninventoried_script_detected', 'rum_mismatched_script_detected', 'rum_csp_violation_reported'].map((category) => rumAlertTitle(category as RumAlertCategory)))
    expect(titles.size).toBe(3)
  })
})
