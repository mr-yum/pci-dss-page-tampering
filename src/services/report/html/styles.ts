/**
 * Inline stylesheet for the auditor report.
 *
 * No webfonts, no images, no external anything — the page has to open from a
 * downloaded CI artefact with no network. Status is conveyed by text *and*
 * colour so it survives greyscale printing and colour-vision differences, and
 * `<details>` disclosure is forced open for print so a print-to-PDF handed to
 * an assessor is complete.
 */

export const REPORT_STYLES = `
:root {
  --bg: #ffffff; --fg: #1a1d21; --muted: #5a6470; --border: #d6dbe1; --surface: #f6f8fa;
  --ok: #16653a; --ok-bg: #e4f3ea; --warn: #8a5300; --warn-bg: #fdf1dc;
  --bad: #a11b2b; --bad-bg: #fbe6e8; --info: #1f4e8c; --info-bg: #e6eefb;
  --accent: #1f4e8c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171a; --fg: #e8ebee; --muted: #a3adb8; --border: #333a42; --surface: #1c2126;
    --ok: #6cd39a; --ok-bg: #10331f; --warn: #f0be6a; --warn-bg: #3a2c10;
    --bad: #f2929e; --bad-bg: #3d1a20; --info: #8db4ea; --info-bg: #16273f;
    --accent: #8db4ea;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0 1.25rem 4rem; background: var(--bg); color: var(--fg);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
main { max-width: 1400px; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 1.5rem 0 0.25rem; }
h2 { font-size: 1.15rem; margin: 2.5rem 0 0.5rem; padding-top: 0.5rem; border-top: 2px solid var(--border); }
h3 { font-size: 1rem; margin: 1.5rem 0 0.5rem; color: var(--muted); }
a { color: var(--accent); }
code, .mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 0.85em; }
.sub { color: var(--muted); margin: 0 0 1rem; }

.banner { padding: 0.75rem 1rem; border-radius: 6px; margin: 1rem 0; border: 1px solid; }
.banner-warn { background: var(--warn-bg); border-color: var(--warn); color: var(--warn); font-weight: 600; }

.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 0.5rem 1.5rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 1rem; }
.meta div { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.meta dt, .meta .k { color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em; }
.meta .v { overflow-wrap: anywhere; }

.chips { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1rem 0; }
.chip { border: 1px solid var(--border); border-radius: 999px; padding: 0.3rem 0.8rem; background: var(--surface); }
.chip strong { font-variant-numeric: tabular-nums; }

.toolbar { position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--border); padding: 0.75rem 0; display: flex; flex-wrap: wrap; gap: 0.75rem 1.25rem; align-items: center; }
.toolbar label { display: inline-flex; align-items: center; gap: 0.35rem; }
.toolbar input[type="search"] { padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--fg); min-width: 16rem; }
.toolbar button { padding: 0.4rem 0.8rem; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--fg); cursor: pointer; }
.toolbar button:hover { border-color: var(--accent); }
.count { color: var(--muted); }

.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 6px; }
table { border-collapse: collapse; width: 100%; }
caption { text-align: left; padding: 0.6rem 0.75rem; font-weight: 600; background: var(--surface); border-bottom: 1px solid var(--border); }
th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); vertical-align: top; }
th { background: var(--surface); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); white-space: nowrap; }
tbody tr:last-child td { border-bottom: none; }
td.name { max-width: 32rem; overflow-wrap: anywhere; }
td.src { white-space: nowrap; }

.badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.78rem; font-weight: 700; white-space: nowrap; border: 1px solid; }
.badge-authorised { background: var(--ok-bg); color: var(--ok); border-color: var(--ok); }
.badge-unauthorised_content { background: var(--bad-bg); color: var(--bad); border-color: var(--bad); }
.badge-unknown { background: var(--bad-bg); color: var(--bad); border-color: var(--bad); }
.badge-missing_required { background: var(--warn-bg); color: var(--warn); border-color: var(--warn); }
.badge-failed { background: var(--bad-bg); color: var(--bad); border-color: var(--bad); }
.badge-completed { background: var(--ok-bg); color: var(--ok); border-color: var(--ok); }

details { margin-top: 0.35rem; }
summary { cursor: pointer; color: var(--accent); font-size: 0.85rem; }
details pre { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 0.6rem; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0.4rem 0 0; }
dl.kv { margin: 0.4rem 0 0; display: grid; grid-template-columns: max-content 1fr; gap: 0.15rem 0.75rem; }
dl.kv dt { color: var(--muted); }
dl.kv dd { margin: 0; overflow-wrap: anywhere; }

:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
[hidden] { display: none !important; }
.notes { margin-top: 3rem; color: var(--muted); font-size: 0.87rem; }
.nav { margin: 1rem 0; }
.nav ul { margin: 0.35rem 0 0; padding-left: 1.2rem; }

@media print {
  .toolbar, .nav { display: none; }
  details > *:not(summary) { display: block !important; }
  details { break-inside: avoid; }
  body { padding: 0; }
}
`
