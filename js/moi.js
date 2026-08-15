/**
 * moi.js
 * Drives moi.html — two independent sections, Moi Given (asset) and
 * Moi Taken (liability), each with its own totals, table, and
 * Add/Edit entry page. Both sides share the same simple form:
 * Name, Village, Amount, Date, Function (suggestions + custom), Notes.
 */

let editingId = null;

/** Live filter/search state, shared across both the Given and Taken tables. */
const filterState = { name: '', village: '', func: 'all', from: '', to: '' };

/** Sort state, shared across the Given and Taken tables (and, partially, Combined). */
const sortState = { by: 'date', dir: 'desc' };

document.addEventListener('DOMContentLoaded', () => {
  populateFunctionSelect();
  populateFilterFunctionSelect();
  renderAll();
  bindAddButtons();
  bindForm();
  bindFunctionSelectToggle();
  bindExport();
  bindFilters();
  bindSort();
  bindMoiTabs();
  bindNameVillageSuggest();
  bindNetWorthToggle();
  handleQueryParams();
});

/* ---------------- Include-in-Net-Worth setting ---------------- */

function bindNetWorthToggle() {
  const toggle = document.querySelector('[data-moi-networth-toggle]');
  if (!toggle || !window.Moi) return;

  toggle.checked = Moi.includedInNetWorth();

  toggle.addEventListener('change', () => {
    Moi.setIncludedInNetWorth(toggle.checked);
    Toast.show(
      toggle.checked
        ? 'Moi Given now counts as an Asset and Moi Received as a Liability in Net Worth.'
        : 'Moi removed from Net Worth totals.',
      'success',
    );
  });
}

/* ---------------- Tabs ---------------- */

let currentMoiTab = 'taken';

function bindMoiTabs() {
  const tabs = document.querySelectorAll('[data-moi-tab]');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-moi-tab');
      switchMoiTab(tab);
    });
  });
}

function switchMoiTab(tab) {
  currentMoiTab = tab;
  document.querySelectorAll('[data-moi-tab]').forEach((b) => {
    b.classList.toggle('is-active-tab', b.getAttribute('data-moi-tab') === tab);
  });
  document.querySelectorAll('[data-moi-tab-panel]').forEach((panel) => {
    panel.hidden = panel.getAttribute('data-moi-tab-panel') !== tab;
  });

  populateFilterFunctionSelect();
  filterState.func = 'all';
  const funcSelect = document.querySelector('[data-filter-function]');
  if (funcSelect) funcSelect.value = 'all';
  renderAll();
}

/* ---------------- Query params (?tab=given|taken, ?add=1) ---------------- */

function handleQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  const shouldAdd = params.get('add') === '1';

  if (tab === 'given' || tab === 'taken') {
    switchMoiTab(tab);
  }

  if (shouldAdd && (tab === 'given' || tab === 'taken')) {
    openAddModal(tab);
  }
}

/* ---------------- Filters & sort ---------------- */

/** The function filter dropdown only lists functions actually used within
 *  the currently active tab's entries — Moi Received shows only functions
 *  used in "taken" entries, Moi Given only those used in "given" entries,
 *  and Combined shows the union of both. */
function populateFilterFunctionSelect() {
  const select = document.querySelector('[data-filter-function]');
  if (!select) return;

  const entries = currentMoiTab === 'given' ? Moi.given()
    : currentMoiTab === 'taken' ? Moi.taken()
      : Moi.all();

  const funcs = [...new Set(entries.map((e) => (e.function || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  const options = funcs.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
  select.innerHTML = `<option value="all">All Functions</option>${options}`;
}

function bindFilters() {
  const nameInput = document.querySelector('[data-filter-name]');
  const villageInput = document.querySelector('[data-filter-village]');
  const funcSelect = document.querySelector('[data-filter-function]');
  const fromInput = document.querySelector('[data-filter-from]');
  const toInput = document.querySelector('[data-filter-to]');
  const clearBtn = document.querySelector('[data-filter-clear]');

  if (nameInput) nameInput.addEventListener('input', () => { filterState.name = nameInput.value.trim().toLowerCase(); renderAll(); });
  if (villageInput) villageInput.addEventListener('input', () => { filterState.village = villageInput.value.trim().toLowerCase(); renderAll(); });
  if (funcSelect) funcSelect.addEventListener('change', () => { filterState.func = funcSelect.value; renderAll(); });
  if (fromInput) fromInput.addEventListener('change', () => { filterState.from = fromInput.value; renderAll(); });
  if (toInput) toInput.addEventListener('change', () => { filterState.to = toInput.value; renderAll(); });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      filterState.name = '';
      filterState.village = '';
      filterState.func = 'all';
      filterState.from = '';
      filterState.to = '';
      if (nameInput) nameInput.value = '';
      if (villageInput) villageInput.value = '';
      if (funcSelect) funcSelect.value = 'all';
      if (fromInput) fromInput.value = '';
      if (toInput) toInput.value = '';
      renderAll();
    });
  }
}

function bindSort() {
  const sortBySelect = document.querySelector('[data-sort-by]');
  const sortDirBtn = document.querySelector('[data-sort-dir]');

  if (sortBySelect) {
    sortBySelect.value = sortState.by;
    sortBySelect.addEventListener('change', () => {
      sortState.by = sortBySelect.value;
      renderAll();
    });
  }

  if (sortDirBtn) {
    updateSortDirIcon(sortDirBtn);
    sortDirBtn.addEventListener('click', () => {
      sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      updateSortDirIcon(sortDirBtn);
      renderAll();
    });
  }
}

function updateSortDirIcon(btn) {
  const icon = btn.querySelector('i');
  if (!icon) return;
  icon.className = sortState.dir === 'asc' ? 'fa-solid fa-arrow-up-short-wide' : 'fa-solid fa-arrow-down-wide-short';
  btn.title = sortState.dir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending';
}

function hasActiveFilters() {
  return !!(filterState.name || filterState.village || (filterState.func && filterState.func !== 'all') || filterState.from || filterState.to);
}

function applyFilters(entries) {
  return entries.filter((e) => {
    if (filterState.name && !(e.name || '').toLowerCase().includes(filterState.name)) return false;
    if (filterState.village && !(e.village || '').toLowerCase().includes(filterState.village)) return false;
    if (filterState.func && filterState.func !== 'all' && e.function !== filterState.func) return false;
    if (filterState.from && e.date && e.date < filterState.from) return false;
    if (filterState.to && e.date && e.date > filterState.to) return false;
    return true;
  });
}

function sortEntries(entries) {
  const dir = sortState.dir === 'asc' ? 1 : -1;
  const copy = [...entries];
  copy.sort((a, b) => {
    let av;
    let bv;
    switch (sortState.by) {
      case 'name': av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); break;
      case 'amount': av = Number(a.amount) || 0; bv = Number(b.amount) || 0; break;
      case 'village': av = (a.village || '').toLowerCase(); bv = (b.village || '').toLowerCase(); break;
      case 'function': av = (a.function || '').toLowerCase(); bv = (b.function || '').toLowerCase(); break;
      case 'date':
      default: av = a.date ? new Date(a.date).getTime() : 0; bv = b.date ? new Date(b.date).getTime() : 0;
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  return copy;
}

/* ---------------- Rendering ---------------- */

function renderAll() {
  renderSection('given');
  renderSection('taken');
  renderCombined();
}

function renderSection(direction) {
  const allEntries = direction === 'given' ? Moi.given() : Moi.taken();
  const entries = sortEntries(applyFilters(allEntries));
  const total = entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const count = entries.length;
  const filtered = hasActiveFilters();

  const totalEl = document.querySelector(`[data-${direction}-total]`);
  const countEl = document.querySelector(`[data-${direction}-count-label]`);
  if (totalEl) totalEl.textContent = Helpers.formatCurrency(total, 'INR');
  if (countEl) countEl.textContent = filtered
    ? `${count} of ${allEntries.length} ${allEntries.length === 1 ? 'entry' : 'entries'}`
    : `${count} ${count === 1 ? 'entry' : 'entries'}`;

  const rowsEl = document.querySelector(`[data-${direction}-rows]`);
  const tableEl = document.querySelector(`[data-${direction}-table]`);
  const emptyEl = document.querySelector(`[data-${direction}-empty]`);
  if (!rowsEl) return;

  if (entries.length === 0) {
    rowsEl.innerHTML = '';
    if (tableEl) tableEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = '';
      const icon = emptyEl.querySelector('i');
      const text = emptyEl.querySelector('p');
      if (filtered && allEntries.length > 0) {
        if (icon) icon.className = 'fa-solid fa-magnifying-glass';
        if (text) text.textContent = 'No entries match your filters.';
      } else {
        if (icon) icon.className = direction === 'given' ? 'fa-solid fa-hand-holding-heart' : 'fa-solid fa-hand-holding-dollar';
        if (text) text.textContent = direction === 'given' ? 'No Moi given recorded yet.' : 'No Moi received recorded yet.';
      }
    }
    return;
  }

  if (tableEl) tableEl.style.display = '';
  if (emptyEl) emptyEl.style.display = 'none';

  rowsEl.innerHTML = entries.map((e) => `
    <tr>
      <td>${e.date ? Helpers.formatShortDateWithYear(e.date) : '\u2014'}</td>
      <td><strong>${escapeHtml(e.name || '\u2014')}</strong></td>
      <td>${escapeHtml(e.village || '\u2014')}</td>
      <td><span class="moi-function-chip">${escapeHtml(e.function || '\u2014')}</span></td>
      <td style="max-width:220px; white-space:normal; color:var(--color-text-faint); font-size:var(--fs-xs);">${escapeHtml(e.notes || '')}</td>
      <td class="text-right num" style="font-weight:600;">${Helpers.formatCurrency(Number(e.amount) || 0, 'INR')}</td>
      <td class="text-right">
        <div class="row-actions" style="justify-content:flex-end;">
          <button type="button" data-edit-id="${e.id}" data-edit-direction="${direction}" aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="danger" data-delete-id="${e.id}" data-delete-direction="${direction}" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>`).join('');

  rowsEl.querySelectorAll('[data-edit-id]').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.editId, btn.dataset.editDirection));
  });
  rowsEl.querySelectorAll('[data-delete-id]').forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.deleteId));
  });
}

/* ---------------- Combined (same name + village on both sides) ---------------- */

function sortCombinedRows(rows) {
  const dir = sortState.dir === 'asc' ? 1 : -1;
  const copy = [...rows];
  copy.sort((a, b) => {
    let av;
    let bv;
    switch (sortState.by) {
      case 'village': av = (a.village || '').toLowerCase(); bv = (b.village || '').toLowerCase(); break;
      case 'amount': av = a.givenTotal - a.takenTotal; bv = b.givenTotal - b.takenTotal; break;
      case 'name':
      default: av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase();
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  return copy;
}

function renderCombined() {
  let rows = Moi.combined();
  rows = rows.filter((r) => {
    if (filterState.name && !(r.name || '').toLowerCase().includes(filterState.name)) return false;
    if (filterState.village && !(r.village || '').toLowerCase().includes(filterState.village)) return false;
    return true;
  });
  rows = sortCombinedRows(rows);

  const rowsEl = document.querySelector('[data-combined-rows]');
  const tableEl = document.querySelector('[data-combined-table]');
  const emptyEl = document.querySelector('[data-combined-empty]');
  if (!rowsEl) return;

  if (rows.length === 0) {
    rowsEl.innerHTML = '';
    if (tableEl) tableEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }

  if (tableEl) tableEl.style.display = '';
  if (emptyEl) emptyEl.style.display = 'none';

  rowsEl.innerHTML = rows.map((r) => {
    const net = r.givenTotal - r.takenTotal;
    return `<tr>
      <td><strong>${escapeHtml(r.name || '\u2014')}</strong></td>
      <td>${escapeHtml(r.village || '\u2014')}</td>
      <td class="text-right num">${Helpers.formatCurrency(r.givenTotal, 'INR')}</td>
      <td class="text-right num">${Helpers.formatCurrency(r.takenTotal, 'INR')}</td>
      <td class="text-right num" style="font-weight:600;">${Helpers.formatCurrency(net, 'INR')}</td>
    </tr>`;
  }).join('');
}

/* ---------------- Form: function select ---------------- */

function populateFunctionSelect() {
  const select = document.querySelector('[data-form-function]');
  if (!select) return;
  select.innerHTML = Moi.FUNCTIONS.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
}

function bindFunctionSelectToggle() {
  const select = document.querySelector('[data-form-function]');
  const customField = document.querySelector('[data-custom-function-field]');
  const customInput = document.querySelector('[data-form-function-custom]');
  if (!select || !customField) return;
  select.addEventListener('change', () => {
    const isOther = select.value === 'Other';
    customField.classList.toggle('is-visible', isOther);
    if (isOther && customInput) customInput.focus();
  });
}

/* ---------------- Name / Village suggestions (3+ letters, matches only) ---------------- */

function bindNameVillageSuggest() {
  bindSuggestField(
    document.querySelector('[data-form-name]'),
    document.querySelector('[data-name-suggestions]'),
    () => Moi.names(),
  );
  bindSuggestField(
    document.querySelector('[data-form-village]'),
    document.querySelector('[data-village-suggestions]'),
    () => Moi.villages(),
  );
}

function bindSuggestField(input, list, getOptions) {
  if (!input || !list) return;

  const renderSuggestions = () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 3) {
      list.style.display = 'none';
      list.innerHTML = '';
      return;
    }
    const matches = getOptions().filter((opt) => opt.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) {
      list.style.display = 'none';
      list.innerHTML = '';
      return;
    }
    list.innerHTML = matches.map((m) => `<li data-suggest-value="${escapeHtml(m)}">${escapeHtml(m)}</li>`).join('');
    list.style.display = 'block';
    list.querySelectorAll('[data-suggest-value]').forEach((li) => {
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = li.getAttribute('data-suggest-value');
        list.style.display = 'none';
        list.innerHTML = '';
      });
    });
  };

  input.addEventListener('input', renderSuggestions);
  input.addEventListener('focus', renderSuggestions);
  input.addEventListener('blur', () => {
    setTimeout(() => { list.style.display = 'none'; }, 100);
  });
}

/* ---------------- Add / Edit modal ---------------- */

function bindAddButtons() {
  document.querySelectorAll('[data-add-btn]').forEach((btn) => {
    btn.addEventListener('click', () => openAddModal(btn.dataset.addBtn));
  });
}

function openAddModal(direction) {
  editingId = null;
  resetForm(direction);
  setModalCopy(direction, false);
  Modal.open('#moiModal');
}

function openEditModal(id, direction) {
  const entry = Moi.get(id);
  if (!entry) return;
  editingId = id;
  resetForm(direction);
  setModalCopy(direction, true);

  const form = document.querySelector('[data-moi-form]');
  form.querySelector('[data-form-id]').value = entry.id;
  form.querySelector('[data-form-name]').value = entry.name || '';
  form.querySelector('[data-form-village]').value = entry.village || '';
  form.querySelector('[data-form-amount]').value = entry.amount || '';
  form.querySelector('[data-form-date]').value = entry.date || '';

  const select = form.querySelector('[data-form-function]');
  const customField = form.querySelector('[data-custom-function-field]');
  const customInput = form.querySelector('[data-form-function-custom]');
  const isKnown = Moi.FUNCTIONS.includes(entry.function);
  if (isKnown) {
    select.value = entry.function;
    customField.classList.remove('is-visible');
  } else {
    select.value = 'Other';
    customField.classList.add('is-visible');
    if (customInput) customInput.value = entry.function || '';
  }

  form.querySelector('[data-form-notes]').value = entry.notes || '';

  Modal.open('#moiModal');
}

function resetForm(direction) {
  const form = document.querySelector('[data-moi-form]');
  if (!form) return;
  form.reset();
  form.querySelector('[data-form-id]').value = '';
  form.querySelector('[data-form-direction]').value = direction;
  form.querySelector('[data-form-date]').value = new Date().toISOString().slice(0, 10);
  document.querySelector('[data-custom-function-field]').classList.remove('is-visible');
}

function setModalCopy(direction, isEdit) {
  const title = document.querySelector('[data-modal-title]');
  const sub = document.querySelector('[data-modal-sub]');
  const label = direction === 'given' ? 'Moi Given' : 'Moi Received';
  if (title) title.textContent = `${isEdit ? 'Edit' : 'Add'} ${label}`;
  if (sub) {
    sub.textContent = direction === 'given'
      ? "Moi given at someone else's function, awaiting return"
      : 'Moi received at your own function, to be returned';
  }
}

function bindForm() {
  const form = document.querySelector('[data-moi-form]');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const direction = form.querySelector('[data-form-direction]').value;
    const name = form.querySelector('[data-form-name]').value.trim();
    const village = form.querySelector('[data-form-village]').value.trim();
    const amount = Number(form.querySelector('[data-form-amount]').value);
    const date = form.querySelector('[data-form-date]').value;
    const selectVal = form.querySelector('[data-form-function]').value;
    const customVal = form.querySelector('[data-form-function-custom]').value.trim();
    const notes = form.querySelector('[data-form-notes]').value.trim();

    if (!name || !amount || amount <= 0 || !date) {
      Toast.show('Please fill in name, amount, and date.', 'warning');
      return;
    }

    const finalFunction = selectVal === 'Other' && customVal ? customVal : selectVal;

    const payload = { direction, name, village, amount, date, function: finalFunction, notes };
    const id = form.querySelector('[data-form-id]').value;

    if (id) {
      Moi.update(id, payload);
      Toast.show('Moi entry updated.', 'success');
    } else {
      Moi.add(payload);
      Toast.show('Moi entry added.', 'success');
    }

    Modal.close('#moiModal');
    renderAll();
  });
}

function handleDelete(id) {
  const entry = Moi.get(id);
  if (!entry) return;
  if (!window.confirm(`Delete Moi entry for "${entry.name}"? This can't be undone.`)) return;
  Moi.remove(id);
  Toast.show('Moi entry deleted.', 'info');
  renderAll();
}

/* ---------------- Export ---------------- */

const MOI_PDF_COLS = [
  { label: 'Date', value: (r) => (r.date ? Helpers.formatShortDateWithYear(r.date) : '\u2014'), width: 24 },
  { label: 'Name', key: 'name' },
  { label: 'Village', value: (r) => r.village || '\u2014' },
  { label: 'Function', key: 'function' },
  { label: 'Amount', value: (r) => Helpers.formatCurrency(Number(r.amount) || 0, 'INR'), align: 'right', width: 28 },
];

const MOI_CSV_COLS = [
  { label: 'Direction', value: (r) => (r.direction === 'given' ? 'Moi Given' : 'Moi Received') },
  { label: 'Date', value: (r) => r.date || '' },
  { label: 'Name', key: 'name' },
  { label: 'Village', value: (r) => r.village || '' },
  { label: 'Function', key: 'function' },
  { label: 'Amount', value: (r) => Number(r.amount) || 0 },
  { label: 'Notes', value: (r) => r.notes || '' },
];

function bindExport() {
  Exporter.buildDropdown('moiExportContainer',
    () => Exporter.csv(Moi.all(), MOI_CSV_COLS, 'moi-given-and-taken'),
    () => {
      const given = Moi.given();
      const taken = Moi.taken();
      Exporter.pdf({
        title: 'Moi Report',
        subtitle: 'Moi Given \u00b7 Moi Taken',
        summaryCards: [
          { label: 'Total Moi Given', value: Helpers.formatCurrency(Moi.givenTotal(), 'INR') },
          { label: 'Total Moi Taken', value: Helpers.formatCurrency(Moi.takenTotal(), 'INR') },
          { label: 'Moi Given Entries', value: String(given.length) },
          { label: 'Moi Taken Entries', value: String(taken.length) },
        ],
        tables: [
          { title: 'Moi Given', columns: MOI_PDF_COLS, rows: given },
          { title: 'Moi Taken', columns: MOI_PDF_COLS, rows: taken },
        ],
        filename: 'moi-report',
      });
    },
  );
}

/* ---------------- Helpers ---------------- */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}
