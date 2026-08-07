/**
 * The report's only inline script: filtering and disclosure controls.
 *
 * Constraints this deliberately obeys, because the page renders
 * attacker-influenced content:
 *
 * - **No untrusted data is ever interpolated into it.** It is a constant. All
 *   the data it reads comes from `data-*` attributes that already went through
 *   HTML escaping, which removes the entire `</script>`-breakout and
 *   U+2028/U+2029 class of bugs by construction.
 * - **No `innerHTML`.** Only `textContent`, `hidden` and `classList`.
 * - **Progressive enhancement.** The markup ships with everything visible; this
 *   only ever hides rows. With JavaScript disabled the document is complete.
 *
 * Because it is constant, its SHA-256 can be computed at render time and put in
 * the CSP, so the page needs no `script-src 'unsafe-inline'`.
 */

export const REPORT_SCRIPT = `
(function () {
  'use strict';
  var rows = Array.prototype.slice.call(document.querySelectorAll('tr[data-row]'));
  var statusBoxes = Array.prototype.slice.call(document.querySelectorAll('input[data-status]'));
  var kindBoxes = Array.prototype.slice.call(document.querySelectorAll('input[data-kind]'));
  var targetSelect = document.getElementById('report-target');
  var search = document.getElementById('report-search');
  var findingsOnly = document.getElementById('report-findings-only');
  var expandAll = document.getElementById('report-expand-all');
  var collapseAll = document.getElementById('report-collapse-all');
  var counter = document.getElementById('report-count');

  function checkedValues(boxes, attribute) {
    var active = {};
    boxes.forEach(function (box) { if (box.checked) active[box.getAttribute(attribute)] = true; });
    return active;
  }

  function apply() {
    var activeStatuses = checkedValues(statusBoxes, 'data-status');
    var activeKinds = checkedValues(kindBoxes, 'data-kind');
    // Empty value means every target; otherwise scope to the chosen one.
    var activeTarget = targetSelect ? targetSelect.value : '';
    var term = search && search.value ? search.value.toLowerCase().trim() : '';
    var onlyFindings = findingsOnly && findingsOnly.checked;
    var shown = 0;

    rows.forEach(function (row) {
      var status = row.getAttribute('data-status');
      var kind = row.getAttribute('data-kind');
      var haystack = row.getAttribute('data-search') || '';
      // A row without a kind (an unmatched inventory entry) is exempt from the
      // Type filter — it describes an entry, not an observed resource, so it
      // belongs to neither script bucket.
      var visible = !!activeStatuses[status] && (kind === null || !!activeKinds[kind]);
      if (visible && activeTarget && row.getAttribute('data-target') !== activeTarget) visible = false;
      if (visible && onlyFindings && status === 'authorised') visible = false;
      if (visible && term && haystack.indexOf(term) === -1) visible = false;
      row.hidden = !visible;
      if (visible) shown += 1;
    });

    // Hide a block whose every row went away, so its heading and explanation do
    // not sit above nothing.
    document.querySelectorAll('[data-block]').forEach(function (block) {
      var blockRows = Array.prototype.slice.call(block.querySelectorAll('tr[data-row]'));
      block.hidden = blockRows.length > 0 && !blockRows.some(function (row) { return !row.hidden; });
    });

    document.querySelectorAll('section[data-target]').forEach(function (section) {
      // Hide a whole target section when the switcher has scoped elsewhere, so
      // its heading and counts do not sit above an empty table.
      section.hidden = !!activeTarget && section.getAttribute('data-target') !== activeTarget;

      var any = Array.prototype.some.call(section.querySelectorAll('tr[data-row]'), function (row) { return !row.hidden; });
      section.querySelectorAll('table').forEach(function (table) {
        var bodyRows = Array.prototype.slice.call(table.querySelectorAll('tr[data-row]'));
        var visibleHere = bodyRows.some(function (row) { return !row.hidden; });
        var wrap = table.parentNode;
        if (wrap && wrap.classList && wrap.classList.contains('table-wrap')) wrap.hidden = bodyRows.length > 0 && !visibleHere;
      });
      section.classList.toggle('is-empty', !any);
    });

    if (counter) counter.textContent = 'Showing ' + shown + ' of ' + rows.length + ' rows';
  }

  // CSS cannot reliably render the contents of a closed <details> for print,
  // so open them all before printing and restore afterwards. With JS disabled
  // the reader uses Expand all, or prints after expanding manually.
  var printOpened = [];
  window.addEventListener('beforeprint', function () {
    printOpened = [];
    document.querySelectorAll('details:not([open])').forEach(function (node) { printOpened.push(node); node.open = true; });
  });
  window.addEventListener('afterprint', function () {
    printOpened.forEach(function (node) { node.open = false; });
    printOpened = [];
  });

  statusBoxes.concat(kindBoxes).forEach(function (box) { box.addEventListener('change', apply); });
  if (targetSelect) targetSelect.addEventListener('change', function () {
    apply();
    // Jump to the chosen target so the switch is visible immediately, even when
    // the previous target's rows filled the viewport. Matched by comparing the
    // attribute rather than building a selector string: a target key comes from
    // the inventory repo and need not be selector-safe.
    if (targetSelect.value) {
      Array.prototype.forEach.call(document.querySelectorAll('section[data-target]'), function (section) {
        if (section.getAttribute('data-target') === targetSelect.value) section.scrollIntoView();
      });
    }
  });
  if (search) search.addEventListener('input', apply);
  if (findingsOnly) findingsOnly.addEventListener('change', apply);
  if (expandAll) expandAll.addEventListener('click', function () {
    document.querySelectorAll('details').forEach(function (node) { node.open = true; });
  });
  if (collapseAll) collapseAll.addEventListener('click', function () {
    document.querySelectorAll('details').forEach(function (node) { node.open = false; });
  });

  apply();
})();
`
