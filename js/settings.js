/**
 * settings.js
 * Powers settings.html. Reads/writes the `settings` storage key directly
 * (currency, language, userName) and provides whole-app data management:
 * export/backup (JSON download), import/restore (JSON upload), and a
 * guarded "delete everything" action.
 */

document.addEventListener('DOMContentLoaded', () => {
  loadSettingsIntoForm();
  bindProfileForm();
  bindMarketDataForm();
  bindThemeRadios();
  bindExport();
  bindImport();
  bindCsvImport();
  bindDeleteAll();
});

function getSettings() {
  return window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
}

function saveSettings(changes) {
  const current = getSettings();
  const merged = { ...current, ...changes };
  window.Storage.set(window.STORAGE_KEYS.SETTINGS, merged);
  return merged;
}

/* ---------------- Profile / preferences form ---------------- */

function loadSettingsIntoForm() {
  const settings = getSettings();
  setValue('[data-form-username]', settings.userName || '');
  setValue('[data-form-currency]', settings.currency || 'USD');
  setValue('[data-form-language]', settings.language || 'en');
  setValue('[data-form-alphavantage-key]', settings.alphaVantageKey || '');
  setValue('[data-form-groww-token]', settings.growwAccessToken || '');
  setValue('[data-form-market-provider]', settings.marketDataProvider || 'yahoo');
  toggleProviderFields(settings.marketDataProvider || 'yahoo');

  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const radio = document.querySelector(`[data-theme-radio][value="${theme}"]`);
  if (radio) radio.checked = true;
}

function bindProfileForm() {
  const form = document.querySelector('[data-settings-form]');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const userName = form.querySelector('[data-form-username]').value.trim();
    const currency = form.querySelector('[data-form-currency]').value;
    const language = form.querySelector('[data-form-language]').value;

    saveSettings({ userName, currency, language });
    Toast.show('Settings saved.');
  });
}

function toggleProviderFields(provider) {
  document.querySelectorAll('[data-provider-fields]').forEach((el) => {
    el.style.display = el.dataset.providerFields === provider ? '' : 'none';
  });
}

function bindMarketDataForm() {
  const form = document.querySelector('[data-market-data-form]');
  if (!form) return;

  const providerSelect = form.querySelector('[data-form-market-provider]');
  if (providerSelect) {
    providerSelect.addEventListener('change', () => toggleProviderFields(providerSelect.value));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const marketDataProvider = providerSelect ? providerSelect.value : 'yahoo';
    const alphaVantageKey = form.querySelector('[data-form-alphavantage-key]').value.trim();
    const growwAccessToken = form.querySelector('[data-form-groww-token]').value.trim();
    saveSettings({ marketDataProvider, alphaVantageKey, growwAccessToken });
    Toast.show('Market data settings saved.');
  });
}

function bindThemeRadios() {
  document.querySelectorAll('[data-theme-radio]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) Theme.apply(radio.value);
      saveSettings({ theme: radio.value });
    });
  });
}

/* ---------------- Export / Backup ---------------- */

function collectAllData() {
  const K = window.STORAGE_KEYS;
  const data = {};
  Object.values(K).forEach((key) => {
    data[key] = window.Storage.get(key, null);
  });
  data._exportedAt = new Date().toISOString();
  data._app = 'Ledger';
  return data;
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function bindExport() {
  const exportBtn = document.querySelector('[data-export-data]');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      downloadJSON(collectAllData(), `ledger-export-${new Date().toISOString().slice(0, 10)}.json`);
      Toast.show('Data exported.');
    });
  }

  const backupBtn = document.querySelector('[data-backup-data]');
  if (backupBtn) {
    backupBtn.addEventListener('click', () => {
      downloadJSON(collectAllData(), `ledger-backup-${new Date().toISOString().slice(0, 10)}.json`);
      Toast.show('Backup created and downloaded.');
    });
  }
}

/* ---------------- Import / Restore ---------------- */

function bindImport() {
  ['[data-import-data]', '[data-restore-data]'].forEach((selector) => {
    const input = document.querySelector(selector);
    if (!input) return;
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          restoreData(data);
          Toast.show('Data restored. Reloading…');
          setTimeout(() => window.location.reload(), 900);
        } catch (err) {
          Toast.show('That file could not be read as a valid Ledger export.', 'error');
        }
      };
      reader.readAsText(file);
      input.value = '';
    });
  });
}

function restoreData(data) {
  const K = window.STORAGE_KEYS;
  Object.values(K).forEach((key) => {
    if (data[key] !== undefined && data[key] !== null) {
      window.Storage.set(key, data[key]);
    }
  });
}

/* ---------------- Import CSV (other expense trackers) ---------------- */

let _csvPreview = null; // holds the pending preview between file-select and confirm

function bindCsvImport() {
  const input = document.querySelector('[data-import-csv]');
  if (input) {
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const { headers, rows } = CsvImport.parse(reader.result);
          const mapped = CsvImport.mapRows(rows, headers);

          if (!mapped.cols.ok) {
            Toast.show(mapped.errors[0] || 'Could not read that CSV.', 'error');
            return;
          }

          _csvPreview = CsvImport.buildPreview(mapped);
          renderCsvPreview(_csvPreview);
          Modal.open('#csvImportModal');
        } catch (err) {
          console.error(err);
          Toast.show('That file could not be read as CSV.', 'error');
        }
      };
      reader.readAsText(file);
      input.value = '';
    });
  }

  const confirmBtn = document.querySelector('[data-csv-confirm-import]');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (!_csvPreview || _csvPreview.counts.toImport === 0) {
        Modal.close('#csvImportModal');
        return;
      }
      const count = CsvImport.commit(_csvPreview);
      _csvPreview = null;
      Modal.close('#csvImportModal');
      Toast.show(`Imported ${count} transaction${count === 1 ? '' : 's'}. Reloading…`);
      setTimeout(() => window.location.reload(), 900);
    });
  }
}

function renderCsvPreview(preview) {
  const body = document.querySelector('[data-csv-preview-body]');
  if (!body) return;

  const fmt = (n) => Helpers.formatCurrency(n);
  const list = (items, emptyLabel) =>
    items.length ? items.map((i) => `<span class="chip tone-info" style="margin:2px;">${escapeHtml(i)}</span>`).join('') : `<em style="color: var(--color-text-muted, #8b8fa3);">${emptyLabel}</em>`;

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
  // Delegates to the single shared implementation in helpers.js.
  return Helpers.escapeHtml(str);
}

/* ---------------- Delete all data ---------------- */

function bindDeleteAll() {
  const btn = document.querySelector('[data-delete-all]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const confirmed = window.confirm(
      'This permanently deletes every account, transaction, budget, goal, card, and investment stored in this browser. This cannot be undone. Continue?'
    );
    if (!confirmed) return;

    const typed = window.prompt('Type DELETE to confirm.');
    if (typed !== 'DELETE') {
      Toast.show('Deletion cancelled.', 'info');
      return;
    }

    window.Storage.clearAll();
    Toast.show('All data deleted. Reloading…', 'info');
    setTimeout(() => window.location.reload(), 900);
  });
}

/* ---------------- Helpers ---------------- */

function setValue(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.value = value;
}
