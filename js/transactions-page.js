/**
 * transactions-page.js
 * Standalone "All Transactions" page reached from the dashboard's
 * "View all" link. Shows every transaction with the same Month / Year /
 * All Time / Custom period filter used on the dashboard, plus type,
 * category, and text search filters, and a paginated table.
 */

const txnPageState = { period: 'all', from: null, to: null };
const TXN_PAGE_SIZE = 15;
let txnPage = 1;
let txnFiltered = [];

document.addEventListener('DOMContentLoaded', () => {
  populateCategoryFilter();
  bindFilters();
  render();
});

function populateCategoryFilter() {
  const select = document.getElementById('txnCategoryFilter');
  if (!select) return;
  const categories = [...new Set(Transactions.all().map((t) => t.category))].sort();
  select.innerHTML = '<option value="all">All categories</option>'
    + categories.map((c) => `<option value="${Helpers.escapeHtml(c)}">${Helpers.escapeHtml(c)}</option>`).join('');
}

function bindFilters() {
  const tabs = document.querySelector('[data-txn-period-tabs]');
  const fromInput = document.getElementById('txnFrom');
  const toInput = document.getElementById('txnTo');

  if (tabs) {
    tabs.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        tabs.querySelectorAll('button').forEach((b) => b.classList.remove('is-active-tab'));
        btn.classList.add('is-active-tab');
        txnPageState.period = btn.dataset.txnPeriod;

        const isCustom = txnPageState.period === 'custom';
        fromInput.style.display = isCustom ? '' : 'none';
        toInput.style.display = isCustom ? '' : 'none';
        if (isCustom && !fromInput.value) {
          const today = new Date();
          const monthAgo = new Date();
          monthAgo.setDate(today.getDate() - 30);
          fromInput.value = monthAgo.toISOString().slice(0, 10);
          toInput.value = today.toISOString().slice(0, 10);
          txnPageState.from = fromInput.value;
          txnPageState.to = toInput.value;
        }
        txnPage = 1;
        render();
      });
    });
  }

  [fromInput, toInput].forEach((input) => {
    if (!input) return;
    input.addEventListener('change', () => {
      txnPageState.from = fromInput.value;
      txnPageState.to = toInput.value;
      if (fromInput.value && toInput.value) { txnPage = 1; render(); }
    });
  });

  document.getElementById('txnTypeFilter').addEventListener('change', () => { txnPage = 1; render(); });
  document.getElementById('txnCategoryFilter').addEventListener('change', () => { txnPage = 1; render(); });
  document.getElementById('txnSearch').addEventListener('input', Helpers.debounce(() => { txnPage = 1; render(); }, 200));
}

/** Same period semantics as the dashboard's filters — Month / Year /
 *  All Time / Custom — resolved to a concrete date range. */
function getPeriodRange(state, transactions) {
  const now = new Date();

  if (state.period === 'month') {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999) };
  }
  if (state.period === 'year') {
    return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999) };
  }
  if (state.period === 'custom') {
    const from = state.from ? new Date(`${state.from}T00:00:00`) : null;
    const to = state.to ? new Date(`${state.to}T23:59:59`) : null;
    if (!from || !to || isNaN(from) || isNaN(to)) return { start: null, end: null };
    return { start: from, end: to };
  }
  // all
  if (!transactions.length) return { start: new Date(0), end: now };
  const dates = transactions.map((t) => new Date(t.date));
  return { start: new Date(Math.min(...dates)), end: now };
}

function render() {
  const all = Transactions.all();
  const range = getPeriodRange(txnPageState, all);
  const type = document.getElementById('txnTypeFilter').value;
  const category = document.getElementById('txnCategoryFilter').value;
  const term = document.getElementById('txnSearch').value.toLowerCase().trim();

  txnFiltered = all
    .filter((t) => !range.start || !range.end || (new Date(t.date) >= range.start && new Date(t.date) <= range.end))
    .filter((t) => type === 'all' || t.type === type)
    .filter((t) => category === 'all' || t.category === category)
    .filter((t) => !term || `${t.title} ${t.category}`.toLowerCase().includes(term))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  renderSummary(txnFiltered);
  renderTablePage();
}

function renderSummary(txns) {
  const totalIn = txns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalOut = txns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const net = totalIn - totalOut;

  setText('[data-txn-total-in]', Helpers.formatCurrency(totalIn));
  setText('[data-txn-total-out]', Helpers.formatCurrency(totalOut));
  setText('[data-txn-total-net]', Helpers.formatCurrency(net));

  const netEl = document.querySelector('[data-txn-total-net]');
  if (netEl) netEl.style.color = net >= 0 ? 'var(--color-accent)' : 'var(--color-negative)';
}

function renderTablePage() {
  const tbody = document.getElementById('txnTableBody');
  const pag = document.getElementById('txnPagination');
  if (!tbody) return;

  const total = txnFiltered.length;
  const pages = Math.ceil(total / TXN_PAGE_SIZE) || 1;
  txnPage = Math.min(txnPage, pages);

  const slice = txnFiltered.slice((txnPage - 1) * TXN_PAGE_SIZE, txnPage * TXN_PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:var(--sp-5);color:var(--color-text-muted);">No transactions found.</td></tr>`;
    pag.innerHTML = '';
    return;
  }

  tbody.innerHTML = slice
    .map((t) => {
      const color = t.type === 'income' ? 'var(--color-accent)' : 'var(--color-negative)';
      const sign = t.type === 'income' ? '+' : '-';
      return `<tr>
        <td>${Helpers.formatShortDate(t.date)}</td>
        <td>${Helpers.escapeHtml(t.title)}</td>
        <td>${Helpers.escapeHtml(t.category)}</td>
        <td><span class="chip ${t.type === 'income' ? 'tone-accent' : 'tone-negative'}" style="font-size:11px;padding:2px 8px;">${t.type}</span></td>
        <td style="text-align:right;font-family:var(--font-mono);color:${color};">${sign}${Helpers.formatCurrency(t.amount)}</td>
      </tr>`;
    })
    .join('');

  pag.innerHTML = `
    <span>Showing ${(txnPage - 1) * TXN_PAGE_SIZE + 1}–${Math.min(txnPage * TXN_PAGE_SIZE, total)} of ${total}</span>
    <div style="display:flex;gap:var(--sp-2);">
      <button class="btn btn--ghost" style="padding:4px 10px;font-size:12px;" ${txnPage <= 1 ? 'disabled' : ''} onclick="changeTxnPage(-1)">‹ Prev</button>
      <button class="btn btn--ghost" style="padding:4px 10px;font-size:12px;" ${txnPage >= pages ? 'disabled' : ''} onclick="changeTxnPage(1)">Next ›</button>
    </div>`;
}

function changeTxnPage(dir) { txnPage += dir; renderTablePage(); }
window.changeTxnPage = changeTxnPage;

function setText(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}
