# Feature Specification: Real-User Script Surveillance (RUM Collector)

**Feature Branch**: `011-real-user-script`
**Created**: 2026-08-20
**Status**: Draft
**Input**: User description: "Real-user script surveillance (RUM collector): extend the PCI DSS 6.4.3/11.6.1 page-tampering system with continuous observation from real customer sessions, complementing the daily synthetic Puppeteer monitor which remains the authoritative control."

Full design rationale and decision log: Notion page "2026-08-20 PCI-DSS RUM beacon" (blueprint with §7 decision log; all previously open decisions resolved 2026-08-20).

## Clarifications

### Session 2026-08-20

- Q: What uniquely identifies a distinct observation for novelty purposes? → A: Target + script identity (URL for external, content fingerprint for inline) + initiator host; a known script re-injected by a new initiator re-alerts. Route is triage context, never identity.
- Q: How long is the rolling novelty window before an absent script's return counts as a new first sighting? → A: 90 days.
- Q: How are the permanent canary's expected alerts kept out of the security channel? → A: A dedicated canary target id in the origin map whose alerts route to the ops/monitoring channel; the full real pipeline is exercised with no suppression mechanism in the alert path.
- Q: When does the CSP-violation alert category start alerting, given real-user CSP reports are noisy (extension-injected scripts)? → A: Collected, archived, and counted from phase 1; alerting activates in phase 4 once thresholds are tuned against the observed baseline.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Unknown-script tripwire on production (Priority: P1)

A security responder is alerted, within roughly an hour, when any real customer session on a production payment application loads a script that is not in the authorised inventory. The alert carries enough context to triage without reproduction: where the script came from, which application route first surfaced it, how many sessions have seen it, and when it was first observed.

**Why this priority**: This is the core value of the feature. The daily synthetic monitor only sees what a controlled browser sees; cloaked, geo-targeted, and session-sampled skimming attacks are invisible to it. An unknown script origin appearing in real production traffic is the highest-signal indicator of an e-skimming attack, and alerting on it alone is a viable MVP.

**Independent Test**: Send a fixture beacon describing a deliberately uninventoried script URL from an allowed production origin; assert an alert for the new "uninventoried script observed in real traffic" category arrives within one comparison cycle, carrying prevalence and first-seen-route context.

**Acceptance Scenarios**:

1. **Given** a production application page with the monitoring agent installed and an inventory that does not list `https://evil.example/x.js`, **When** a real session loads that script and the session's report reaches the collector, **Then** a detection alert is raised within one hourly comparison cycle naming the script URL, the target, the first-seen route, and the number of sessions that observed it.
2. **Given** a script that matches an authorised inventory entry, **When** real sessions observe it repeatedly, **Then** no alert is raised and only prevalence counters advance.
3. **Given** a report from a web origin not present in the configured origin mapping, **When** it reaches the collector, **Then** it is counted in operational metrics and discarded without being stored or evaluated.
4. **Given** the same unknown script observed by thousands of sessions in the same window, **Then** exactly one first-sighting is evaluated and alerted, and later sightings only update prevalence.

---

### User Story 2 - Inline script content verification (Priority: P2)

The system verifies inline scripts observed in real sessions against the inventory's content rules, so a tampered inline script (changed bytes, injected payload) in real traffic is flagged even when its name is unremarkable.

**Why this priority**: Inline injection is the other half of the e-skimming pattern. Unlike external scripts, inline content is fully readable in the page, so real-user observation can carry content fingerprints and be held to the same authorisation semantics the synthetic monitor uses.

**Independent Test**: Send a fixture beacon with an inline-script observation whose content fingerprint does not satisfy the identified inventory entry's authorisation; assert a "mismatched script observed in real traffic" alert with the failure reason.

**Acceptance Scenarios**:

1. **Given** an inline script whose fingerprint (hash, length, anchored head/tail excerpts) matches an authorised entry, **When** it is evaluated, **Then** it is recorded as authorised with no alert.
2. **Given** an inline script identified by an inventory entry whose authorisation the observed content fails, **Then** a mismatch alert is raised carrying the matcher context and failure reason.
3. **Given** an inline script too large for client-side hashing, **When** it is reported with the fallback fingerprint (length plus head and tail excerpts) and flagged oversize, **Then** it is still evaluated and never silently dropped.
4. **Given** an inventory entry with existing 64-character anchored content matchers, **When** evaluated against the 128-character head/tail excerpts, **Then** the entry matches exactly as it would against full content (head is a strict content prefix, tail a strict suffix).

---

### User Story 3 - Staging real usage feeds the inventory (Priority: P3)

New scripts observed in real staging sessions automatically become pending inventory candidates: a pull request proposing an explicitly unauthorised entry, which a person must review, justify, and approve, exactly as with the existing synthetic inventory pass.

**Why this priority**: Real staging usage (QA, internal testing) exercises paths the scripted synthetic workflows never reach — error paths, experiment arms, region-specific payment methods. Capturing those before they hit production reduces both compliance gaps and production alert noise. It depends on the observation pipeline from P1/P2 being in place.

**Independent Test**: Send a fixture beacon for a novel script from an allowed staging origin; assert a pull request is opened against the inventory repository proposing a pending (`authorised: false`) entry, and that no environment treats the script as authorised until a person approves.

**Acceptance Scenarios**:

1. **Given** a novel script observed on a staging origin, **When** the hourly evaluation runs, **Then** a pull request proposing a pending, unauthorised inventory entry is opened for human review.
2. **Given** the same novel script observed again before the entry is approved, **Then** no duplicate candidate entry or pull request is produced.
3. **Given** a script observed on a staging origin and authorised only for staging (target-type-scoped entry), **When** the same script later appears on a production origin, **Then** it alerts as unknown in production.
4. **Given** any observation from any environment, **Then** the automated system never marks anything authorised; authorisation only ever happens through human-approved inventory changes.

---

### User Story 4 - The monitor notices its own defeat (Priority: P4)

Operators are alerted when the surveillance itself is degraded: when a page's reporting volume drops abnormally (agent suppressed or removed), when queued observations stop being evaluated (pipeline stalled), or when the deployed agent differs from its inventoried, hash-pinned release. A permanent canary continuously proves the whole path end-to-end.

**Why this priority**: The agent runs inside the environment it monitors, so an attacker who owns the page can silence it. Without these interlocks, silence is indistinguishable from health. They harden the value delivered by P1–P3 rather than delivering standalone value, hence P4.

**Independent Test**: Stop sending beacons for one target and assert the volume-anomaly alarm fires; let queued observations age past the threshold and assert the staleness alarm fires; alter the agent bytes on a monitored page and assert the daily synthetic run flags it.

**Acceptance Scenarios**:

1. **Given** a target whose beacon volume drops abnormally against its own baseline, **Then** an alarm reaches the security channel identifying the target.
2. **Given** queued observations older than three hours (two missed hourly cycles), **Then** a staleness alarm fires.
3. **Given** the monitoring agent script on any monitored page, **When** the daily synthetic run executes, **Then** it verifies the agent is present and byte-identical to its inventoried hash, and alerts otherwise.
4. **Given** the permanent canary (a deliberately uninventoried fixture observation sent on a schedule against the dedicated canary target), **Then** the expected alert arrives in the ops/monitoring channel within one comparison cycle, no canary alert ever reaches the security channel, and the canary's absence itself raises an alarm.

---

### User Story 5 - An external adopter deploys the reference implementation (Priority: P5)

An engineer outside our organisation deploys the collector from this public repository alone: instantiate the infrastructure modules (choosing a CloudFront or Cloudflare edge), embed the released agent with its published integrity hash, add the agent and collector endpoint to their own inventory, schedule the comparison job in their inventory repository, and verify end-to-end with the documented canary — following a shipped implementation guide, with no values or knowledge private to us required.

**Why this priority**: Open-sourcing the reference implementation is a deliberate deliverable, and our own internal instance consumes the same published modules, which is what keeps them exercised. It is last in priority because it packages the capability rather than creating it.

**Independent Test**: Follow the implementation guide against a fresh cloud account using only repository contents and released artefacts; achieve a passing canary within the guide's steps.

**Acceptance Scenarios**:

1. **Given** the repository's runnable examples (fictional domain values only), **When** an adopter applies them with their own values, **Then** a working collector results with either edge choice, with no networking (VPC) prerequisites.
2. **Given** a released version tag, **Then** the agent artefact, its integrity (SRI) string, a ready-to-paste inventory entry, the collector code artefact, and the infrastructure modules are all consumable at that single tag.
3. **Given** the implementation guide, **Then** its steps are in true dependency order and each step provides copy-paste material.

---

### Edge Cases

- **Forged beacons**: the reporting endpoint is public and unauthenticated by nature (pages cannot hold secrets). Forged reports can only add noise, never suppress signal; alerts carry prevalence so triage can weigh single-source noise, and edge rate limiting bounds volume abuse.
- **Weak or old clients**: when client-side hashing is unavailable or content exceeds the hashing ceiling, observations degrade to the length-plus-excerpts fingerprint and are flagged, never silently dropped. Degraded clients produce coarser observations, not no observations.
- **Duplicate delivery**: session-level deduplication plus first-sighting semantics make repeated or retried reports idempotent; re-processing a report never produces duplicate alerts or duplicate candidate entries.
- **Poison messages**: an observation that passes ingest validation but breaks evaluation is retried a bounded number of times, then parked in a dead-letter queue that alarms, without wedging the pipeline.
- **Scheduler outage or drift**: the hourly job is best-effort; queued observations wait durably, and the three-hour staleness alarm converts silent scheduler failure into an operator page.
- **Workflow-scoped inventory entries**: real sessions carry no orchestration-assigned workflow identifier, so entries gated solely by workflow matching fail secure (evaluate as unknown) against real-user observations. Accepted for v1 and documented; RUM-visible entries should key on name, host, content, or target type.
- **Script disappears then returns**: the novelty window is a rolling 90 days; a script absent from traffic beyond that re-alerts on return rather than staying trusted forever.
- **Session ends abruptly** (tab killed, device offline): reports flush at page-hide; observations from a session whose final flush never arrives are lost, which is acceptable — coverage is statistical across sessions, and the volume alarm catches systematic loss.
- **First site-wide rollout**: routes never covered by the payment-scoped inventory will surface a one-time wave of staging candidate entries; this is expected behaviour to be planned for, not noise to be suppressed.
- **Browser-extension noise**: user-installed extensions inject scripts and trigger CSP violations that are indistinguishable client-side from attacks; prevalence context (a script in 0.1% of sessions from scattered sources reads differently from one in 30%) is the triage tool, and CSP-violation alerting stays off until phase 4 for this reason.

## Requirements _(mandatory)_

### Functional Requirements

**Observation (browser agent)**

- **FR-001**: The system MUST observe, from within real user sessions, every script the application loads or creates on every page and route of the application (site-wide, session-long, surviving client-side route changes), including externally fetched scripts, inline scripts added during execution, and content-security-policy violations reported by the browser.
- **FR-002**: Each observation MUST carry only metadata: script URL or identity, a content hash when computable, content length with anchored 128-character head and 128-character tail excerpts (head a strict content prefix, tail a strict suffix), the inserting script's URL when attributable, the application route active at capture, and a timestamp. The report format MUST be structurally incapable of carrying cardholder data, form input, or customer identifiers; the only session identifier is a random value minted per session.
- **FR-003**: The agent MUST NOT delay or degrade the page: observation callbacks only capture and enqueue; all processing is deferred to idle time; reports are transmitted at session end without blocking navigation. The agent MUST measure and report its own processing overhead and drop count.
- **FR-004**: The agent MUST deduplicate observations within a session before processing, cap each report at 24 observations and 32 KB (splitting across reports as needed), and degrade to the length-plus-excerpts fingerprint (flagged oversize) when content exceeds the 512 KB hashing ceiling or hashing is unavailable.
- **FR-005**: The agent MUST be configurable by the embedding page only for the collector endpoint; one released artefact MUST serve every adopter without rebuild.

**Collection**

- **FR-006**: The collector MUST validate every report against a strict shared schema (unknown fields rejected, size caps enforced) and MUST always respond with an empty acknowledgement that reveals nothing about validation outcome.
- **FR-007**: The collector MUST determine each observation's target and pass (inventory for staging origins, detection for production origins) exclusively from the request's web origin against an operator-configured mapping; reports from unmapped origins MUST be counted and discarded, never stored. The page is never trusted to declare its own environment.
- **FR-008**: Every accepted report MUST be preserved verbatim in an encrypted, access-controlled archive with a one-year retention default, serving as the audit evidence record and the replay source for re-evaluation.
- **FR-009**: The collector MUST evaluate novelty within a rolling 90-day window keyed on target + script identity (URL for external scripts, content fingerprint for inline scripts) + initiator host, so that a known script re-injected by a new initiator counts as a new first sighting. First sightings are queued durably for comparison; repeat sightings update prevalence counters (session count, first and last seen) without re-queueing. The route is recorded as triage context and never forms part of the novelty identity.
- **FR-010**: Ingress MUST pass through an edge layer providing rate limiting, size caps, and transport security, with the collector accepting only traffic authenticated as coming from its own edge via an edge-injected shared secret. Both a CloudFront-based and a Cloudflare-based edge MUST be supported, and the constraint that forces CloudFront onto the shared-secret mechanism (OAC-signed POSTs require a client-supplied payload hash that `sendBeacon` cannot send) MUST be documented.

**Comparison and routing**

- **FR-011**: Queued first-sightings MUST be compared, on an hourly schedule run from the inventory repository under its existing credential model, against the canonical inventory at a recorded version, using the same identification and authorisation rules as the synthetic monitor. Every decision MUST be traceable to the inventory version it was judged against.
- **FR-012**: Observations from the detection pass MUST only ever produce alerts (new categories for: uninventoried script in real traffic, known script with unauthorised content in real traffic, and CSP violation reported from real traffic), each carrying prevalence and first-seen-route context. CSP-violation observations are collected, archived, and counted from phase 1, but their alert category activates only in phase 4, after thresholds are tuned against the observed baseline (real-user CSP reports carry heavy browser-extension noise). Observations from the inventory pass MUST feed the existing candidate flow: pending, explicitly unauthorised entries proposed via pull request for human review. The automated system MUST NOT authorise anything in any environment.
- **FR-013**: External scripts observed in real sessions MUST be evaluated by identity only (their content is not readable in the client): an unknown URL or host alerts; a known URL whose content cannot be verified is recorded without alerting. Inline scripts MUST be held to full content authorisation via their fingerprints, failing secure when unverifiable.
- **FR-014**: Queued observations MUST be removed only after their outcome is routed; observations that repeatedly fail evaluation MUST be parked in a dead-letter store that alarms.

**Self-protection and operations**

- **FR-015**: The system MUST alarm operators on: queued observations older than three hours, abnormal drops in per-target report volume, elevated collector error rates, and any dead-lettered observation.
- **FR-016**: The monitoring agent MUST itself be inventoried and hash-pinned; the daily synthetic run MUST verify its presence and integrity on monitored pages. A permanent scheduled canary MUST prove the full path (report → evaluation → alert) through a dedicated canary target in the origin mapping whose alerts route to the ops/monitoring channel — the real pipeline with no suppression mechanism, and the security channel stays clean. The canary's silence MUST itself alarm.

**Packaging and adoption**

- **FR-017**: All components MUST ship open-source in this repository: agent, collector, deployable infrastructure definitions (an edge-agnostic core plus one module per supported edge, creating no VPC resources as a versioned compatibility contract, with every estate-owned dependency injectable and self-contained defaults), runnable examples using fictional domains only, and an implementation guide in dependency order.
- **FR-018**: Each release tag MUST provide, together: the agent artefact with its integrity (SRI) string and a ready-to-paste inventory entry, the collector artefact with checksum, and the infrastructure modules at the same version.
- **FR-019**: The new execution mode and its parameters MUST be documented as additional rows in the existing README command-line tables.

### Key Entities

- **Observation**: one script or CSP event seen in a real session — identity (URL or content fingerprint), route, initiator, timestamp, session reference; the atom of the whole pipeline.
- **Report (beacon)**: a batch of up to 24 observations from one session, schema-validated at ingress; the unit of transport and of archival.
- **Origin mapping**: operator configuration binding each web origin to a target and a pass (inventory or detection); the sole authority on environment identity.
- **First sighting**: the first occurrence of a distinct observation identity (target + script URL or content fingerprint + initiator host) within the rolling novelty window; the only thing ever evaluated against the inventory.
- **Prevalence record**: per distinct observation: session count, first seen, last seen, first-seen route; context attached to every alert.
- **Evidence archive**: verbatim, encrypted store of every accepted report, retained one year; the auditor's record and the replay source.
- **Detection alert**: the security-team notification for a real-traffic violation, carrying matcher context, prevalence, route, and the inventory version judged against.
- **Inventory candidate**: a proposed pending (unauthorised) inventory entry originating from a staging observation, delivered as a pull request for human decision.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An unknown script first observed in production real-user traffic produces a security alert within 90 minutes of the observation reaching the collector, in at least 99% of hourly cycles over a month.
- **SC-002**: 100% of application routes are covered by observation in every session where the application shell loads — verified by route-tagged observations spanning the full route map.
- **SC-003**: The agent's own telemetry shows at most 5 ms of main-thread processing per session at the 95th percentile on low-end devices, and page navigation timings on instrumented pages are statistically unchanged after rollout.
- **SC-004**: No report accepted by the collector can contain cardholder data, form input, or customer identity: demonstrated by schema construction (only hashes, bounded excerpts, URLs, counts) and confirmed by review of a production traffic sample.
- **SC-005**: Every alert and every recorded decision names the exact inventory version it was judged against, and every accepted report is retrievable verbatim from the evidence archive for one year.
- **SC-006**: Suppression of reporting on any single target is alarmed within 24 hours (volume anomaly), and tampering with the agent on a monitored page is flagged by the next daily synthetic run.
- **SC-007**: Duplicate observations across sessions produce zero duplicate alerts and zero duplicate inventory candidates over a month of production traffic.
- **SC-008**: An engineer with no access to our private configuration deploys a working collector (passing the documented canary) from the public repository and its guide within one working day.
- **SC-009**: The permanent canary passes in at least 99% of cycles per month, and every canary failure produces an operator alarm.

## Assumptions

- **Resolved design decisions (2026-08-20)** carried from the blueprint's decision log: real-user surveillance is a tripwire and the synthetic monitor remains the authoritative 11.6.1 control; one collector serves both environments with pass identity from the origin mapping; hourly comparison from the inventory repository's scheduler is the accepted cadence (worst case ~60–90 minutes); inline matching is snippet-only at 128-character head/tail (no full-content option); evidence retention is one year; command-line documentation stays in the README tables.
- Delivery follows four phases (unknown-origin tripwire → inline content pipeline → staging-to-inventory candidates → self-protection interlocks), mapping to user stories P1 → P2 → P3 → P4, each independently shippable.
- Real sessions carry no workflow identifier in v1; inventory entries intended to match real-user observations key on name, host, content, or target type.
- The first site-wide rollout will produce a one-time wave of staging inventory candidates from routes the payment-scoped inventory never covered; the review workload is planned for, not treated as a defect.
- The internal deployment consumes the same published modules and artefacts as any external adopter (wrapper composes, never rewrites), which is what keeps the reference implementation exercised.
