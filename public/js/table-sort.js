// table-sort.js — generic column sort for .ls-table
// Click a <th> to sort asc; click again to sort desc.

(function () {
  const ARROW = { asc: ' ↑', desc: ' ↓' };

  function sortTable(th) {
    const table = th.closest('table');
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const thList = [...th.closest('tr').querySelectorAll('th')];
    const colIdx = thList.indexOf(th);

    // Determine direction
    const isAsc = th.dataset.sortDir !== 'asc';
    th.dataset.sortDir = isAsc ? 'asc' : 'desc';

    // Reset other headers
    thList.forEach((h, i) => {
      if (i !== colIdx) {
        delete h.dataset.sortDir;
        h.textContent = h.textContent.replace(/ [↑↓]$/, '');
      }
    });
    // Update arrow
    th.textContent = th.textContent.replace(/ [↑↓]$/, '') + (isAsc ? ARROW.asc : ARROW.desc);

    // Sort rows
    const rows = [...tbody.querySelectorAll('tr')];
    if (rows.length <= 1) return; // skip if empty/single

    rows.sort((a, b) => {
      const cellA = a.cells[colIdx];
      const cellB = b.cells[colIdx];
      if (!cellA || !cellB) return 0;
      const vA = cellA.textContent.trim();
      const vB = cellB.textContent.trim();

      // Numeric sort?
      const nA = parseFloat(vA.replace(/[^0-9.-]/g, ''));
      const nB = parseFloat(vB.replace(/[^0-9.-]/g, ''));
      if (!isNaN(nA) && !isNaN(nB)) {
        return isAsc ? nA - nB : nB - nA;
      }
      return isAsc ? vA.localeCompare(vB, 'ko') : vB.localeCompare(vA, 'ko');
    });

    rows.forEach(r => tbody.appendChild(r));
  }

  function initSortable(root) {
    (root || document).querySelectorAll('.ls-table thead th, .st-table thead th').forEach(th => {
      if (th.dataset.sortInit) return; // prevent double-init
      th.dataset.sortInit = '1';
      th.style.cursor = 'pointer';
      th.style.userSelect = 'none';
      th.addEventListener('click', () => sortTable(th));
    });
  }

  // Initial init
  document.addEventListener('DOMContentLoaded', () => initSortable());

  // Re-init after dynamic table rendering (call window.initTableSort() from JS)
  window.initTableSort = initSortable;
})();
