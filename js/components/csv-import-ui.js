/**
 * csv-import-ui.js
 * Reusable "Import CSV" button + preview-modal wiring, shared by any page
 * that includes the standard markup block (see expense.html / income.html):
 *   - a file input matching  [data-import-csv]
 *   - a modal  #csvImportModal  with [data-csv-preview-body] and [data-csv-confirm-import]
 *
 * Depends on CsvImport (utils/csv-import.js), Modal, Toast, and Helpers
 * already being loaded on the page.
 *
 * Usage:
 *   CsvImportUI.init({ onImported: (count) => { ...refresh the page's UI... } });
 */
const CsvImportUI = (() => {
  let _preview = null;
  let _bound = false; // guard against double-binding if init() is called twice

  function init(options = {}) {
    const { onImported } = options;
    const input = document.querySelector('[data-import-csv]');
    const confirmBtn = document.querySelector('[data-csv-confirm-import]');
    if (!input || !confirmBtn) return; // this page doesn't have the import UI
    if (_bound) return;
    _bound = true;

    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const { headers, rows } = CsvImport.parse(reader.result);

          if (headers.length === 0) {
            Toast.show('That file looks empty — nothing to import.', 'error');
            return;
          }

          const mapped = CsvImport.mapRows(rows, headers);

          if (!mapped.cols.ok) {
            Toast.show(mapped.errors[0] || 'Could not find both a Date and an Amount column in that CSV.', 'error');
            return;
          }

          _preview = CsvImport.buildPreview(mapped);
          renderPreview(_preview);
          Modal.open('#csvImportModal');
        } catch (err) {
          console.error(err);
          Toast.show('That file could not be read as CSV.', 'error');
        } finally {
          input.value = ''; // always reset so re-selecting the same file re-fires "change"
        }
      };
      reader.onerror = () => {
        Toast.show('That file could not be read.', 'error');
        input.value = '';
      };
      reader.readAsText(file);
    });

    confirmBtn.addEventListener('click', () => {
      if (!_preview || _preview.counts.toImport === 0) {
        Modal.close('#csvImportModal');
        return;
      }
      const count = CsvImport.commit(_preview);
      _preview = null;
      Modal.close('#csvImportModal');
      Toast.show(`Imported ${count} transaction${count === 1 ? '' : 's'}.`);
      if (typeof onImported === 'function') onImported(count);
    });
  }

  function renderPreview(preview) {
    const body = document.querySelector('[data-csv-preview-body]');
    if (!body) return;

    const fmt = (n) => Helpers.formatCurrency(n);
    const list = (items, emptyLabel) =>
      items.length
        ? items.map((i) => `<span class="chip tone-info" style="margin:2px;">${escapeHtml(i)}</span>`).join('')
        : `<em style="color: var(--color-text-muted, #8b8fa3);">${emptyLabel}</em>`;

    body.innerHTML = `
      <div class="field-row" style="text-align:center;">
        <div class="field"><strong style="font-size:1.4rem;">${preview.counts.toImport}</strong><br><small>To import</small></div>
        <div class="field"><strong style="font-size:1.4rem;">${preview.counts.duplicates}</strong><br><small>Duplicates skipped</small></div>
        <div class="field"><strong style="font-size:1.4rem;">${preview.counts.skipped}</strong><br><small>Rows skipped</small></div>
      </div>

      ${preview.dateRange ? `<p>Date range: <strong>${preview.dateRange.from}</strong> to <strong>${preview.dateRange.to}</strong></p>` : ''}

      <p>Income: <strong style="color: var(--color-accent, #16a34a);">${fmt(preview.totals.income)}</strong>
         &nbsp;·&nbsp; Expenses: <strong style="color: var(--color-negative, #dc2626);">${fmt(preview.totals.expense)}</strong></p>

      <div>
        <label style="display:block; margin-bottom:4px;"><small>New categories to create</small></label>
        ${list(preview.newCategories, 'None — all match existing categories')}
      </div>
      <div>
        <label style="display:block; margin-bottom:4px;"><small>New accounts to create</small></label>
        ${list(preview.newAccounts, 'None — all match existing accounts')}
      </div>
      <div>
        <label style="display:block; margin-bottom:4px;"><small>New tags to create</small></label>
        ${list(preview.newTags, 'None')}
      </div>

      ${preview.counts.toImport === 0 ? '<p style="color: var(--color-negative, #dc2626);">Nothing new to import — every row already exists or could not be read.</p>' : ''}
    `;

    const confirmBtn = document.querySelector('[data-csv-confirm-import]');
    if (confirmBtn) confirmBtn.disabled = preview.counts.toImport === 0;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { init };
})();

window.CsvImportUI = CsvImportUI;
