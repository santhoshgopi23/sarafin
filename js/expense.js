/**
 * expense.js
 * Powers expense.html: renders the list/stats/chart from Storage, and
 * handles the add/edit modal form, delete, search+filter, CSV export,
 * the Weekly/Monthly/Yearly/Custom period filter, and the "Show All"
 * transactions popup.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const state = {
  editingId: null,
  filters: { term: '', category: 'all', tag: 'all' },
  period: 'monthly',
  periodMonth: new Date().getMonth(),
  periodYear: new Date().getFullYear(),
  selectedTags: [],
  avgMode: 'monthly', // toggled by the Avg box's small switch button
  calendarMonth: new Date().getMonth(), // daily-spending calendar popup
  calendarYear: new Date().getFullYear(),
  categoryBox: '__top__', // which category the 4th stat box is showing the total for
  currency: 'INR', // currency the Amount field is currently entered in (Add/Edit form)
};

// Independent filter state for the "Show All" popup.
const allState = { term: '', category: 'all', tag: 'all', from: '', to: '' };

const PREVIEW_COUNT = 5;

document.addEventListener('DOMContentLoaded', () => {
  Modal.bindTriggers();
  populateCategorySelect();
  populateAccountSelect();
  populateTagFilterSelect();
  populatePeriodMonthYearSelects();
  populateCategoryBoxSelect();
  initTagSearchPicker();
  initTitleSuggestPicker();
  bindFilterBar();
  bindPeriodTabs();
  bindShowAllModal();
  bindAvgToggle();
  bindDailyCalendar();
  bindCategoryBox();
  bindCurrencyToggle();
  bindForm();
  bindExport();
  if (window.CsvImportUI) CsvImportUI.init({ onImported: handleCsvImported });
  applyPeriodFromQueryString();
  render();
});

/** If arriving from the Reports page with ?from=&to= (e.g. clicking the
 *  Expense stat card for a selected month), switch straight to the Custom
 *  period with that exact range pre-filled, so this page opens already
 *  showing that period's expenses instead of defaulting to "This Month". */
function applyPeriodFromQueryString() {
  const params = new URLSearchParams(window.location.search);
  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to) return;

  state.period = 'custom';
  document.querySelectorAll('[data-period-tab]').forEach((b) => b.classList.toggle('is-active-tab', b.dataset.periodTab === 'custom'));

  const monthSelect = document.querySelector('[data-period-month]');
  const yearSelect = document.querySelector('[data-period-year]');
  const fromInput = document.querySelector('[data-period-from]');
  const toInput = document.querySelector('[data-period-to]');
  if (monthSelect) monthSelect.style.display = 'none';
  if (yearSelect) yearSelect.style.display = 'none';
  if (fromInput) { fromInput.style.display = ''; fromInput.value = from; }
  if (toInput) { toInput.style.display = ''; toInput.value = to; }
}

/** Re-sync everything derived from storage after a CSV import adds
 *  transactions and possibly new categories/accounts/tags. */
function handleCsvImported() {
  populateCategorySelect();
  populateAccountSelect();
  populateTagFilterSelect();
  populatePeriodMonthYearSelects();
  populateCategoryBoxSelect();
  render();
}

/* ---------------- Period range (Weekly / Monthly / Yearly / Custom) ---------------- */

function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - day + (day === 0 ? -6 : 1));
  return date;
}

function getPeriodRange() {
  const now = new Date();

  if (state.period === 'weekly') {
    const start = startOfWeek(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999);
    return { start, end, label: 'This Week' };
  }

  if (state.period === 'yearly') {
    const y = state.periodYear;
    return { start: new Date(y, 0, 1), end: new Date(y, 11, 31, 23, 59, 59), label: String(y) };
  }

  if (state.period === 'lifetime') {
    return { start: new Date(0), end: new Date(8640000000000000), label: 'Lifetime' };
  }

  if (state.period === 'custom') {
    const fromVal = document.querySelector('[data-period-from]')?.value;
    const toVal = document.querySelector('[data-period-to]')?.value;
    const start = fromVal ? new Date(`${fromVal}T00:00:00`) : new Date(0);
    const end = toVal ? new Date(`${toVal}T23:59:59`) : new Date(8640000000000000);
    const label = fromVal && toVal ? `${fromVal} \u2013 ${toVal}` : 'Custom Range';
    return { start, end, label };
  }

  // monthly
  const y = state.periodYear;
  const m = state.periodMonth;
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0, 23, 59, 59);
  return { start, end, label: `${MONTH_NAMES[m]} ${y}` };
}

function inRange(dateStr, range) {
  const d = new Date(dateStr);
  return d >= range.start && d <= range.end;
}

function populatePeriodMonthYearSelects() {
  const monthSelect = document.querySelector('[data-period-month]');
  const yearSelect = document.querySelector('[data-period-year]');
  if (monthSelect) {
    monthSelect.innerHTML = MONTH_NAMES.map((name, i) => `<option value="${i}">${name}</option>`).join('');
    monthSelect.value = state.periodMonth;
  }
  if (yearSelect) {
    const allExpenses = Transactions.byType('expense');
    const years = new Set(allExpenses.map((t) => new Date(t.date).getFullYear()));
    years.add(new Date().getFullYear());
    const sorted = [...years].sort((a, b) => b - a);
    yearSelect.innerHTML = sorted.map((y) => `<option value="${y}">${y}</option>`).join('');
    yearSelect.value = state.periodYear;
  }
}

function bindPeriodTabs() {
  document.querySelectorAll('[data-period-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.period = btn.dataset.periodTab;
      document.querySelectorAll('[data-period-tab]').forEach((b) => b.classList.remove('is-active-tab'));
      btn.classList.add('is-active-tab');

      const monthSelect = document.querySelector('[data-period-month]');
      const yearSelect = document.querySelector('[data-period-year]');
      const fromInput = document.querySelector('[data-period-from]');
      const toInput = document.querySelector('[data-period-to]');

      if (monthSelect) monthSelect.style.display = state.period === 'monthly' ? '' : 'none';
      if (yearSelect) yearSelect.style.display = (state.period === 'monthly' || state.period === 'yearly') ? '' : 'none';
      if (fromInput) fromInput.style.display = state.period === 'custom' ? '' : 'none';
      if (toInput) toInput.style.display = state.period === 'custom' ? '' : 'none';

      if (state.period === 'custom' && fromInput && !fromInput.value) {
        const today = new Date().toISOString().slice(0, 10);
        fromInput.value = today;
        toInput.value = today;
      }
      render();
    });
  });

  const monthSelect = document.querySelector('[data-period-month]');
  const yearSelect = document.querySelector('[data-period-year]');
  if (monthSelect) monthSelect.addEventListener('change', (e) => { state.periodMonth = Number(e.target.value); render(); });
  if (yearSelect) yearSelect.addEventListener('change', (e) => { state.periodYear = Number(e.target.value); render(); });
  ['[data-period-from]', '[data-period-to]'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.addEventListener('change', () => render());
  });
}

/* ---------------- Core render ---------------- */

function getFilteredExpenses() {
  const expenses = Transactions.byType('expense');
  const range = getPeriodRange();
  const byPeriod = expenses.filter((t) => inRange(t.date, range));
  return Transactions.filterList(byPeriod, state.filters).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function render() {
  const filtered = getFilteredExpenses();
  const range = getPeriodRange();
  setText('[data-period-label]', range.label);
  renderStats(filtered);
  renderList(filtered);
  renderChart(filtered);
  renderAvgBox();
  renderTodayBox();
}

function renderStats(filtered) {
  const total = Transactions.total(filtered);
  const byCategory = Transactions.sumByCategory(filtered);
  const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];

  setText('[data-total-expense]', Helpers.formatCurrency(total));
  setText('[data-expense-count]', `${filtered.length} transaction${filtered.length === 1 ? '' : 's'}`);
  renderCategoryBox(byCategory, topCategory);
}

/* ---------------- Category box (small select — pick a category, see its total) ---------------- */

function populateCategoryBoxSelect() {
  const select = document.querySelector('[data-category-box-select]');
  if (!select) return;
  const categories = Categories.listFor('expense');
  select.innerHTML = '<option value="__top__">Top Category</option>' +
    categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  select.value = categories.includes(state.categoryBox) || state.categoryBox === '__top__' ? state.categoryBox : '__top__';
}

function bindCategoryBox() {
  const select = document.querySelector('[data-category-box-select]');
  if (!select) return;
  select.addEventListener('change', (e) => {
    state.categoryBox = e.target.value;
    render();
  });
}

/** Renders the 4th stat box's value/sub-label. `byCategory` and `topCategory`
 *  are derived from the currently filtered (period + search/tag) transactions,
 *  so this box always reflects whatever the Filters section is set to. */
function renderCategoryBox(byCategory, topCategory) {
  const valueEl = document.querySelector('[data-category-box-value]');
  const subEl = document.querySelector('[data-category-box-sub]');
  if (!valueEl) return;

  if (state.categoryBox === '__top__') {
    valueEl.textContent = topCategory ? Helpers.formatCurrency(topCategory[1]) : Helpers.formatCurrency(0);
    if (subEl) subEl.textContent = topCategory ? topCategory[0] : 'No transactions yet';
  } else {
    const amt = byCategory[state.categoryBox] || 0;
    valueEl.textContent = Helpers.formatCurrency(amt);
    if (subEl) subEl.textContent = amt > 0 ? state.categoryBox : `No ${state.categoryBox} in this period`;
  }
}

/* ---------------- Avg box (Monthly / Yearly toggle) ---------------- */

function computeAverages() {
  const all = Transactions.byType('expense');
  if (all.length === 0) return { monthly: 0, yearly: 0, monthCount: 0, yearCount: 0 };

  const monthSet = new Set();
  const yearSet = new Set();
  let total = 0;
  all.forEach((t) => {
    const d = new Date(t.date);
    monthSet.add(`${d.getFullYear()}-${d.getMonth()}`);
    yearSet.add(d.getFullYear());
    total += t.amount;
  });

  return {
    monthly: total / monthSet.size,
    yearly: total / yearSet.size,
    monthCount: monthSet.size,
    yearCount: yearSet.size,
  };
}

function renderAvgBox() {
  const { monthly, yearly, monthCount, yearCount } = computeAverages();
  const label = document.querySelector('[data-avg-label]');
  const value = document.querySelector('[data-avg-value]');
  const sub = document.querySelector('[data-avg-sub]');

  if (state.avgMode === 'yearly') {
    if (label) label.textContent = 'Yearly Avg';
    if (value) value.textContent = Helpers.formatCurrency(yearly);
    if (sub) sub.textContent = yearCount ? `Across ${yearCount} year${yearCount === 1 ? '' : 's'}` : 'No data yet';
  } else {
    if (label) label.textContent = 'Monthly Avg';
    if (value) value.textContent = Helpers.formatCurrency(monthly);
    if (sub) sub.textContent = monthCount ? `Across ${monthCount} month${monthCount === 1 ? '' : 's'}` : 'No data yet';
  }
}

function bindAvgToggle() {
  const btn = document.querySelector('[data-avg-toggle]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.avgMode = state.avgMode === 'monthly' ? 'yearly' : 'monthly';
    renderAvgBox();
  });
}

/* ---------------- Today box + daily spending calendar ---------------- */

function renderTodayBox() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const total = Transactions.byType('expense')
    .filter((t) => t.date === todayStr)
    .reduce((sum, t) => sum + t.amount, 0);
  setText('[data-today-expense]', Helpers.formatCurrency(total));
}

function bindDailyCalendar() {
  const box = document.querySelector('[data-today-box]');
  if (box) {
    box.addEventListener('click', openDailyCalendar);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDailyCalendar();
      }
    });
  }

  const prev = document.querySelector('[data-cal-prev]');
  const next = document.querySelector('[data-cal-next]');
  if (prev) prev.addEventListener('click', () => shiftCalendarMonth(-1));
  if (next) next.addEventListener('click', () => shiftCalendarMonth(1));
}

function openDailyCalendar() {
  const now = new Date();
  state.calendarMonth = now.getMonth();
  state.calendarYear = now.getFullYear();
  Modal.open('#dailyCalendarModal');
  renderDailyCalendar();
}

function shiftCalendarMonth(delta) {
  state.calendarMonth += delta;
  if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear -= 1; }
  if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear += 1; }
  renderDailyCalendar();
}

function renderDailyCalendar() {
  const grid = document.querySelector('[data-cal-grid]');
  const title = document.querySelector('[data-calendar-title]');
  const totalEl = document.querySelector('[data-cal-total]');
  if (!grid) return;

  const y = state.calendarYear;
  const m = state.calendarMonth;
  if (title) title.textContent = `Daily Spending — ${MONTH_NAMES[m]} ${y}`;

  const monthExpenses = Transactions.byType('expense').filter((t) => {
    const d = new Date(t.date);
    return d.getFullYear() === y && d.getMonth() === m;
  });

  const byDay = {};
  let monthTotal = 0;
  monthExpenses.forEach((t) => {
    const day = new Date(t.date).getDate();
    byDay[day] = (byDay[day] || 0) + t.amount;
    monthTotal += t.amount;
  });
  if (totalEl) totalEl.textContent = Helpers.formatCurrency(monthTotal);

  const firstWeekday = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);
  const weekdayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  let html = weekdayLabels.map((w) => `<span class="exp-cal__weekday">${w}</span>`).join('');
  for (let i = 0; i < firstWeekday; i += 1) {
    html += '<div class="exp-cal__day exp-cal__day--empty"></div>';
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const amt = byDay[d] || 0;
    const classes = ['exp-cal__day'];
    if (amt > 0) classes.push('exp-cal__day--spent');
    if (iso === todayStr) classes.push('exp-cal__day--today');
    html += `
      <div class="${classes.join(' ')}">
        <span class="exp-cal__daynum">${d}</span>
        ${amt > 0 ? `<span class="exp-cal__amount">${Helpers.formatCurrency(amt)}</span>` : ''}
      </div>`;
  }
  grid.innerHTML = html;
}

function renderList(filtered) {
  const list = document.querySelector('[data-expense-list]');
  if (!list) return;

  if (filtered.length === 0) {
    list.innerHTML = `
      <li class="empty-state">
        <i class="fa-solid fa-receipt"></i>
        No expenses match your filters yet.
      </li>`;
  } else {
    const preview = filtered.slice(0, PREVIEW_COUNT);
    list.innerHTML = preview.map((t) => rowTemplate(t)).join('');
    bindRowActions(list, render);
  }

  const wrap = document.querySelector('[data-expense-show-all-wrap]');
  if (wrap) wrap.style.display = filtered.length > PREVIEW_COUNT ? 'flex' : 'none';
  setText('[data-expense-total-count]', String(filtered.length));
}

/** Shared row markup used by both the "Recent" list and the "Show All" popup list. */
function rowTemplate(t) {
  const meta = Categories.metaFor('expense', t.category);
  const receiptChip = t.receipt
    ? `<span class="receipt-chip"><i class="fa-solid fa-paperclip"></i> Receipt</span>`
    : '';
  const sgdNote = t.originalCurrency === 'SGD'
    ? `<span class="receipt-chip" title="Converted from Singapore Dollars">S$${Number(t.originalAmount).toFixed(2)} @ ${t.exchangeRate}</span>`
    : '';
  return `
    <li class="list-row" data-id="${t.id}">
      <span class="chip chip--icon" style="width:38px;height:38px;background:${meta.color};"><i class="fa-solid ${meta.icon}"></i></span>
      <div class="list-row__meta">
        <p class="list-row__title">${escapeHtml(t.title || t.category)}</p>
        <p class="list-row__sub">${t.category} · ${Helpers.formatShortDate(t.date)} ${receiptChip} ${sgdNote}</p>
        ${renderTagBadges(t)}
      </div>
      <span class="list-row__amount num" style="color: var(--color-negative);">-${Helpers.formatCurrency(t.amount)}</span>
      <div class="row-actions">
        <button data-edit aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
        <button data-delete class="danger" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
      </div>
    </li>`;
}

/** Wire up edit/delete buttons for a rendered row list. `afterAction` re-renders the caller's view. */
function bindRowActions(listEl, afterAction) {
  listEl.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(btn.closest('.list-row').dataset.id));
  });
  listEl.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.closest('.list-row').dataset.id, afterAction));
  });
}

let expenseChart = null;
function renderChart(filtered) {
  const canvas = document.getElementById('expenseCategoryChart');
  if (!canvas || typeof Chart === 'undefined') return;
  ChartTheme.applyDefaults();

  const byCategory = Transactions.sumByCategory(filtered);
  const labels = Object.keys(byCategory);
  const values = Object.values(byCategory);

  if (expenseChart) expenseChart.destroy();
  expenseChart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: ChartTheme.palette, borderWidth: 0 }] },
    options: ChartTheme.doughnutOptions(),
  });

  const legend = document.querySelector('[data-category-legend]');
  if (legend) {
    legend.innerHTML = labels
      .map((label, i) => `
        <span class="legend-item">
          <span class="legend-swatch" style="background:${ChartTheme.palette[i % ChartTheme.palette.length]}"></span>${label}
        </span>`)
      .join('') || '<span class="legend-item">No expenses yet</span>';
  }
}

/* ---------------- Filters (search / category / tag) ---------------- */

function bindFilterBar() {
  const search = document.querySelector('[data-expense-search]');
  const category = document.querySelector('[data-filter-category]');
  const tag = document.querySelector('[data-filter-tag]');

  if (search) {
    search.addEventListener('input', Helpers.debounce((e) => {
      state.filters.term = e.target.value;
      render();
    }, 250));
  }
  if (category) {
    category.addEventListener('change', (e) => {
      state.filters.category = e.target.value;
      render();
    });
  }
  if (tag) {
    tag.addEventListener('change', (e) => {
      state.filters.tag = e.target.value;
      render();
    });
  }
}

function populateTagFilterSelect() {
  const tags = Tags.all();
  const options = '<option value="all">All Tags</option>' +
    tags.map((tg) => `<option value="${tg.id}">${escapeHtml(tg.name)}</option>`).join('');
  document.querySelectorAll('[data-filter-tag], [data-all-tag]').forEach((select) => {
    select.innerHTML = options;
  });
}

/* ---------------- Tag search picker (Add/Edit modal) ---------------- */

function initTagSearchPicker() {
  const input = document.querySelector('[data-tag-search-input]');
  const dropdown = document.querySelector('[data-tag-suggestions]');
  if (!input || !dropdown) return;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      dropdown.classList.remove('is-open');
      dropdown.innerHTML = '';
      return;
    }
    const matches = Tags.all().filter((tg) => !state.selectedTags.includes(tg.id) && tg.name.toLowerCase().includes(q));
    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="tag-search__empty">No matching tags</div>';
    } else {
      dropdown.innerHTML = matches.slice(0, 8).map((tg) => `
        <button type="button" class="tag-search__suggestion" data-tag-id="${tg.id}">
          <span class="tag-pill__dot" style="background:${tg.color};"></span>${escapeHtml(tg.name)}
        </button>`).join('');
    }
    dropdown.classList.add('is-open');
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) dropdown.classList.add('is-open');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dropdown.classList.remove('is-open');
    if (e.key === 'Backspace' && !input.value && state.selectedTags.length) {
      state.selectedTags.pop();
      renderTagChips();
    }
  });

  dropdown.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tag-id]');
    if (!btn) return;
    const id = btn.dataset.tagId;
    if (!state.selectedTags.includes(id)) state.selectedTags.push(id);
    input.value = '';
    dropdown.classList.remove('is-open');
    dropdown.innerHTML = '';
    renderTagChips();
    input.focus();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-form-tags]')) dropdown.classList.remove('is-open');
  });
}

/** As the person types a Title, suggest titles used on previous expenses that
 *  contain what's typed so far, so re-typing the same thing shows a pick list. */
function initTitleSuggestPicker() {
  const input = document.querySelector('[data-form-title]');
  const dropdown = document.querySelector('[data-title-suggestions]');
  if (!input || !dropdown) return;

  function previousTitles(query) {
    const q = query.trim().toLowerCase();
    if (q.length < 3) return [];
    const seen = new Set();
    const titles = [];
    // Most recent first, so recently used titles surface first.
    Transactions.all()
      .filter((t) => t.type === 'expense' && t.title)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .forEach((t) => {
        const key = t.title.toLowerCase();
        if (key === q) return; // don't suggest an exact match of what's already typed
        if (key.includes(q) && !seen.has(key)) {
          seen.add(key);
          titles.push(t.title);
        }
      });
    return titles.slice(0, 6);
  }

  function renderSuggestions() {
    const matches = previousTitles(input.value);
    if (matches.length === 0) {
      dropdown.classList.remove('is-open');
      dropdown.innerHTML = '';
      return;
    }
    dropdown.innerHTML = matches.map((title) => `
      <button type="button" class="title-suggest__item" data-title-choice="${escapeAttrExp(title)}">
        <i class="fa-solid fa-clock-rotate-left"></i> ${escapeHtml(title)}
      </button>`).join('');
    dropdown.classList.add('is-open');
  }

  input.addEventListener('input', renderSuggestions);
  input.addEventListener('focus', renderSuggestions);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dropdown.classList.remove('is-open');
  });

  dropdown.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-title-choice]');
    if (!btn) return;
    input.value = btn.getAttribute('data-title-choice');
    dropdown.classList.remove('is-open');
    dropdown.innerHTML = '';
    input.focus();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.title-suggest')) dropdown.classList.remove('is-open');
  });
}

function escapeAttrExp(str) {
  // Delegates to the single shared implementation in helpers.js.
  return Helpers.escapeHtml(str);
}

/** Reflect state.selectedTags as removable chips, and disable the search box if no tags exist yet. */
function renderTagChips() {
  const chips = document.querySelector('[data-tag-chips]');
  const input = document.querySelector('[data-tag-search-input]');
  if (!chips) return;

  const tags = Tags.byIds(state.selectedTags);
  chips.innerHTML = tags.map((tg) => `
    <span class="tag-chip" style="background:${Tags.rgba(tg.color, 0.18)};border-color:${tg.color};color:${tg.color};">
      <span class="tag-pill__dot" style="background:${tg.color};"></span>${escapeHtml(tg.name)}
      <button type="button" class="tag-chip__remove" data-remove-tag="${tg.id}" aria-label="Remove ${escapeHtml(tg.name)}"><i class="fa-solid fa-xmark"></i></button>
    </span>`).join('');

  chips.querySelectorAll('[data-remove-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedTags = state.selectedTags.filter((id) => id !== btn.dataset.removeTag);
      renderTagChips();
    });
  });

  if (input) {
    const hasTags = Tags.all().length > 0;
    input.disabled = !hasTags;
    input.placeholder = hasTags ? 'Search tags to add…' : 'No tags yet — create one on the Tags page';
  }
}

/** Small colored pills shown under a transaction's title/date line. */
function renderTagBadges(t) {
  const tags = Tags.byIds(t.tags || []);
  if (tags.length === 0) return '';
  return `<div class="list-row__tags">${tags
    .map((tg) => `<span class="tag-badge" style="background:${Tags.rgba(tg.color, 0.15)};color:${tg.color};"><span class="tag-badge__dot" style="background:${tg.color};"></span>${escapeHtml(tg.name)}</span>`)
    .join('')}</div>`;
}

function populateCategorySelect() {
  const categories = Categories.listFor('expense');
  document.querySelectorAll('[data-filter-category], [data-form-category], [data-all-category]').forEach((select) => {
    const includeAll = select.hasAttribute('data-filter-category') || select.hasAttribute('data-all-category');
    select.innerHTML =
      (includeAll ? '<option value="all">All Categories</option>' : '') +
      categories.map((c) => `<option value="${c}">${c}</option>`).join('');
    if (select.hasAttribute('data-form-category') && window.CategoryPicker) {
      CategoryPicker.enhance(select, 'expense');
    }
  });
}

function populateAccountSelect() {
  const select = document.querySelector('[data-form-account]');
  if (!select) return;
  const accounts = window.Storage.get(window.STORAGE_KEYS.ACCOUNTS, []);
  select.innerHTML = accounts.map((a) => `<option value="${a.id}">${a.name}</option>`).join('');
}

/* ---------------- "Show All" popup ---------------- */

function bindShowAllModal() {
  const openBtn = document.querySelector('[data-expense-show-all]');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      // Start the popup from the current page filters/period for context.
      allState.term = state.filters.term;
      allState.category = state.filters.category;
      allState.tag = state.filters.tag;
      const range = getPeriodRange();
      allState.from = state.period === 'custom' ? (document.querySelector('[data-period-from]')?.value || '') : (range.start > new Date(0) ? range.start.toISOString().slice(0, 10) : '');
      allState.to = state.period === 'custom' ? (document.querySelector('[data-period-to]')?.value || '') : '';

      syncAllFilterInputs();
      Modal.open('#expenseAllModal');
      renderAllModalList();
    });
  }

  const search = document.querySelector('[data-all-search]');
  const category = document.querySelector('[data-all-category]');
  const tag = document.querySelector('[data-all-tag]');
  const from = document.querySelector('[data-all-from]');
  const to = document.querySelector('[data-all-to]');

  if (search) search.addEventListener('input', Helpers.debounce((e) => { allState.term = e.target.value; renderAllModalList(); }, 250));
  if (category) category.addEventListener('change', (e) => { allState.category = e.target.value; renderAllModalList(); });
  if (tag) tag.addEventListener('change', (e) => { allState.tag = e.target.value; renderAllModalList(); });
  if (from) from.addEventListener('change', (e) => { allState.from = e.target.value; renderAllModalList(); });
  if (to) to.addEventListener('change', (e) => { allState.to = e.target.value; renderAllModalList(); });
}

function syncAllFilterInputs() {
  const search = document.querySelector('[data-all-search]');
  const category = document.querySelector('[data-all-category]');
  const tag = document.querySelector('[data-all-tag]');
  const from = document.querySelector('[data-all-from]');
  const to = document.querySelector('[data-all-to]');
  if (search) search.value = allState.term;
  if (category) category.value = allState.category;
  if (tag) tag.value = allState.tag;
  if (from) from.value = allState.from;
  if (to) to.value = allState.to;
}

function getAllModalExpenses() {
  const expenses = Transactions.byType('expense');
  const filtered = Transactions.filterList(expenses, { term: allState.term, category: allState.category, tag: allState.tag });
  return filtered
    .filter((t) => {
      if (allState.from && t.date < allState.from) return false;
      if (allState.to && t.date > allState.to) return false;
      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function renderAllModalList() {
  const list = document.querySelector('[data-all-list]');
  if (!list) return;
  const rows = getAllModalExpenses();

  setText('[data-all-count]', `${rows.length} transaction${rows.length === 1 ? '' : 's'}`);

  if (rows.length === 0) {
    list.innerHTML = `
      <li class="empty-state">
        <i class="fa-solid fa-receipt"></i>
        No expenses match these filters.
      </li>`;
    return;
  }

  list.innerHTML = rows.map((t) => rowTemplate(t)).join('');
  bindRowActions(list, () => { renderAllModalList(); render(); });
}

/* ---------------- Add / Edit form ---------------- */

function bindForm() {
  const form = document.querySelector('[data-expense-form]');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSubmit(form);
  });

  const addBtn = document.querySelector('[data-add-expense-btn]');
  if (addBtn) {
    addBtn.addEventListener('click', () => openAddModal());
  }

  const receiptInput = document.querySelector('[data-form-receipt]');
  if (receiptInput) {
    receiptInput.addEventListener('change', () => {
      const label = document.querySelector('[data-receipt-filename]');
      if (label) label.textContent = receiptInput.files[0] ? receiptInput.files[0].name : 'No file chosen';
    });
  }
}

/* ---------------- SGD ⇄ Rupees currency toggle (Add/Edit modal) ---------------- */

function getStoredSgdRate() {
  const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
  return settings.sgdToInrRate || null;
}

function saveSgdRate(rate) {
  const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
  window.Storage.set(window.STORAGE_KEYS.SETTINGS, { ...settings, sgdToInrRate: rate });
}

/** Prompts for "1 SGD = ? INR". Returns the rate, or null if cancelled/invalid. */
function promptForRate() {
  const existing = getStoredSgdRate();
  const answer = window.prompt(
    existing
      ? `Current rate: 1 SGD = ₹${existing}. Enter the new rate for 1 SGD (in rupees):`
      : "What's today's rate? Enter how many rupees 1 SGD is worth:",
    existing || ''
  );
  if (answer === null) return null; // user hit Cancel
  const rate = parseFloat(answer);
  if (!rate || rate <= 0) {
    Toast.show('Please enter a valid exchange rate.', 'error');
    return null;
  }
  saveSgdRate(rate);
  Toast.show(`Saved: 1 SGD = ₹${rate}. This won't be asked again until you change it.`, 'info');
  return rate;
}

function bindCurrencyToggle() {
  document.querySelectorAll('[data-currency-btn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const currency = btn.dataset.currencyBtn;
      if (currency === 'SGD') {
        const rate = getStoredSgdRate() || promptForRate();
        if (!rate) return; // no rate available — stay on Rupees
      }
      state.currency = currency;
      syncCurrencyUI();
    });
  });

  const changeRateBtn = document.querySelector('[data-change-rate]');
  if (changeRateBtn) {
    changeRateBtn.addEventListener('click', () => {
      const rate = promptForRate();
      if (rate) syncCurrencyUI();
    });
  }
}

function syncCurrencyUI() {
  document.querySelectorAll('[data-currency-btn]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.currencyBtn === state.currency);
  });
  const hint = document.querySelector('[data-currency-hint]');
  const changeRateBtn = document.querySelector('[data-change-rate]');

  if (state.currency === 'SGD') {
    const rate = getStoredSgdRate();
    if (hint) {
      hint.style.display = '';
      hint.textContent = rate ? `Converts at 1 SGD = ₹${rate} → saved in rupees.` : 'No rate set yet.';
    }
    if (changeRateBtn) changeRateBtn.style.display = '';
  } else {
    if (hint) hint.style.display = 'none';
    if (changeRateBtn) changeRateBtn.style.display = 'none';
  }
}

function openAddModal() {
  state.editingId = null;
  state.selectedTags = [];
  state.currency = 'INR';
  const form = document.querySelector('[data-expense-form]');
  form.reset();
  document.querySelector('[data-form-date]').value = new Date().toISOString().slice(0, 10);
  document.querySelector('[data-modal-title]').textContent = 'Add Expense';
  document.querySelector('[data-receipt-filename]').textContent = 'No file chosen';
  renderTagChips();
  syncCurrencyUI();
  if (window.CategoryPicker) CategoryPicker.enhance(document.querySelector('[data-form-category]'), 'expense');
  Modal.open('#expenseModal');
}

function openEditModal(id) {
  const record = Transactions.get(id);
  if (!record) return;
  state.editingId = id;
  state.selectedTags = [...(record.tags || [])];

  document.querySelector('[data-modal-title]').textContent = 'Edit Expense';
  document.querySelector('[data-form-title]').value = record.title;
  document.querySelector('[data-form-category]').value = record.category;
  document.querySelector('[data-form-date]').value = record.date;
  if (document.querySelector('[data-form-account]')) {
    document.querySelector('[data-form-account]').value = record.account || '';
  }

  // If this expense was originally entered in SGD, re-open the form in SGD
  // showing the original SGD figure; otherwise show the saved rupee amount.
  if (record.originalCurrency === 'SGD' && record.originalAmount != null) {
    state.currency = 'SGD';
    document.querySelector('[data-form-amount]').value = record.originalAmount;
  } else {
    state.currency = 'INR';
    document.querySelector('[data-form-amount]').value = record.amount;
  }
  syncCurrencyUI();

  document.querySelector('[data-receipt-filename]').textContent = record.receipt ? 'Receipt attached' : 'No file chosen';
  renderTagChips();
  if (window.CategoryPicker) CategoryPicker.enhance(document.querySelector('[data-form-category]'), 'expense');

  Modal.open('#expenseModal');
}

function handleSubmit(form) {
  const title = form.querySelector('[data-form-title]').value.trim();
  const enteredAmount = parseFloat(form.querySelector('[data-form-amount]').value);
  const category = form.querySelector('[data-form-category]').value;
  const date = form.querySelector('[data-form-date]').value;
  const account = form.querySelector('[data-form-account]').value;
  const receiptFile = form.querySelector('[data-form-receipt]').files[0];

  if (!category || !enteredAmount || enteredAmount <= 0 || !date) {
    Toast.show('Please choose a category, a positive amount, and a date.', 'error');
    return;
  }

  // Convert to rupees if the amount was entered in SGD; rupees save as-is.
  let amount = enteredAmount;
  let originalAmount = null;
  let originalCurrency = null;
  let exchangeRate = null;

  if (state.currency === 'SGD') {
    const rate = getStoredSgdRate();
    if (!rate) {
      Toast.show('Please set the SGD → Rupee rate first.', 'error');
      return;
    }
    originalAmount = enteredAmount;
    originalCurrency = 'SGD';
    exchangeRate = rate;
    amount = Math.round(enteredAmount * rate * 100) / 100;
  }

  const previous = state.editingId ? Transactions.get(state.editingId) : null;

  const save = (receiptDataUrl) => {
    const payload = {
      type: 'expense', title, amount, category, date, account, tags: [...state.selectedTags],
      originalAmount, originalCurrency, exchangeRate,
    };
    if (receiptDataUrl) payload.receipt = receiptDataUrl;

    if (state.editingId) {
      Transactions.update(state.editingId, payload);
      // Reverse the old entry's effect on its account, then apply the new one.
      if (previous) Accounts.adjustBalance(previous.account, previous.amount);
      Accounts.adjustBalance(account, -amount);
      Toast.show('Expense updated.');
    } else {
      Transactions.add(payload);
      Accounts.adjustBalance(account, -amount);
      Toast.show('Expense added.');
    }
    Modal.close('#expenseModal');
    populateAccountSelect();
    populatePeriodMonthYearSelects();
    render();
    if (document.querySelector('#expenseAllModal')?.classList.contains('is-open')) renderAllModalList();
  };

  if (receiptFile) {
    const reader = new FileReader();
    reader.onload = () => save(reader.result);
    reader.readAsDataURL(receiptFile);
  } else {
    save(null);
  }
}

function handleDelete(id, afterAction) {
  const record = Transactions.get(id);
  if (!record) return;
  if (!window.confirm(`Delete "${record.title || record.category}"? This can't be undone.`)) return;
  Transactions.remove(id);
  Accounts.adjustBalance(record.account, record.amount);
  Toast.show('Expense deleted.', 'info');
  populateAccountSelect();
  if (afterAction) afterAction();
}

/* ---------------- Export ---------------- */

function bindExport() {
  const oldBtn = document.querySelector('[data-export-csv]');
  if (oldBtn) {
    const wrap = document.createElement('div');
    wrap.id = 'expenseExportContainer';
    oldBtn.replaceWith(wrap);
  }

  const COLS = [
    { label:'Date',     value: r => Helpers.formatShortDate(r.date) },
    { label:'Title',    key:'title' },
    { label:'Category', key:'category' },
    { label:'Amount',   value: r => Helpers.formatCurrency(r.amount), align:'right' },
    { label:'Account',  key:'account' },
    { label:'Notes',    value: r => r.notes||'' },
  ];

  // Columns for the PDF: mirrors a clean bank-statement layout —
  // Date · Title · Category · Amount · Account.
  const STATEMENT_COLS = [
    { label:'Date',     value: r => Helpers.formatShortDate(r.date), width: 24 },
    { label:'Title',    value: r => r.title || 'Not specified' },
    { label:'Category', key:'category' },
    { label:'Amount',   value: r => Helpers.formatCurrency(r.amount), align:'right', prefix:'-', emphasis: true, negative: () => true, width: 32 },
    { label:'Account',  value: r => r.account || '—' },
  ];

  function buildCategoryBreakdown(rows) {
    const sums = Transactions.sumByCategory(rows);
    const total = Object.values(sums).reduce((s, v) => s + v, 0);
    const spending = Object.entries(sums)
      .sort((a, b) => b[1] - a[1])
      .map(([label, amt]) => {
        const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
        return { label, value: `${pct}%   -   ${Helpers.formatCurrency(amt)}` };
      });
    return { transactionCount: rows.length, spending, income: [] };
  }

  Exporter.buildDropdown('expenseExportContainer',
    () => {
      const rows = getFilteredExpenses();
      Exporter.csv(rows, COLS, 'ledger-expenses');
    },
    () => {
      const rows = getFilteredExpenses();
      const total = rows.reduce((s,t)=>s+t.amount,0);
      const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
      Exporter.pdf({
        title:'Expense Report', period:'Filtered view', userName: settings.userName || '',
        summaryCards:[
          {label:'Total Expenses', value:Helpers.formatCurrency(total), negative: true},
          {label:'Transactions',   value:String(rows.length)},
        ],
        tables:[{title:'Expense Transactions', hideTitle:true, columns:STATEMENT_COLS, rows}],
        categoryBreakdown: buildCategoryBreakdown(rows),
        filename:'ledger-expenses',
      });
    }
  );
}

/* ---------------- Helpers ---------------- */

function setText(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}

function escapeHtml(str) {
  // Delegates to the single shared implementation in helpers.js.
  return Helpers.escapeHtml(str);
}
