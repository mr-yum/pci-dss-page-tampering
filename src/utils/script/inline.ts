/**
 * Shared fallback name for inline scripts whose `<script>` element carries no
 * `id` attribute (those are named `inline_script/<id>`).
 *
 * Many distinct scripts carry this name at once, so it must never be used to
 * *identify* a script in the inventory — `InventoryService.addNewScript`
 * generates an anchored content-snippet matcher for these (combined with the
 * initiator host when the initiator URL is available) instead of a name
 * matcher.
 *
 * Until 2026-11 the tool also gave a few framework- and vendor-emitted
 * snippets (Cloudflare's JavaScript Detections bootstrap, Next.js flight data,
 * React's streaming runtime) names of their own from patterns in this file.
 * Those patterns lived in code, so when a vendor changed its snippet only a
 * tool release could follow it. Snippets like these are identified by content
 * in the inventory now, through shared matcher definitions
 * (`shared/matchers.json`, see `../matcher-ref.ts`), where an inventory pull
 * request can change them.
 */
export const UNIDENTIFIED_INLINE_SCRIPT_ID = 'inline_script/id_not_found'
