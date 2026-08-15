/**
 * dashboard.js
 * Reads accounts/transactions/bills/goals from Storage, computes the
 * headline numbers, and renders the dashboard: hero balance, stat cards,
 * recent transactions, upcoming bills, and the two summary charts.
 */

let dashboardCashFlowChart = null;
let dashboardExpenseBreakdownChart = null;
let dashboardIncomeBreakdownChart = null;

/** Investment `type` values grouped into the same broad asset categories
 * used on the Assets page, so the Wealth card's per-category totals line
 * up with what the user sees there. Cash & Savings (account balances) is
 * added separately since it isn't an investment type. */
const WEALTH_ASSET_GROUPS = [
  { label: 'Equity', color: '#4f8fe0', types: ['Stocks', 'ETF', 'Mutual Funds', 'Direct Stocks', 'Equity Mutual Funds', 'Hybrid Mutual Funds', 'Arbitrage Funds', 'Equity ETFs', 'ESOP'] },
  { label: 'Debt', color: '#33c07f', types: ['FD', 'CPF', 'EPF', 'Bank Fixed Deposit (FD)', 'Corporate Fixed Deposit (FD)', 'Recurring Deposit (RD)', 'Government Bonds', 'Corporate Bonds', 'Tax-Free Bonds', 'Sovereign Gold Bonds', 'PPF', 'SSY', 'Government Savings Scheme', 'Debt Mutual Funds', 'Debt ETFs'] },
  { label: 'Real Estate', color: '#f2994a', types: ['Property', 'REIT', 'InvIT'] },
  { label: 'Commodity', color: '#e0a730', types: ['Gold', 'Physical Gold', 'Physical Silver', 'Digital Gold / Silver'] },
  { label: 'Crypto', color: '#8b7cd8', types: ['Crypto', 'Crypto Tokens / Coins', 'Crypto ETFs'] },
  { label: 'Others', color: '#96979f', types: ['Foreign Investment', 'Other Assets'] },
];

// Two independent filters: one for the Cash Flow chart, one shared by the
// Expense/Income breakdown charts (mirrors the cash flow filter's options).
const cashflowState = { period: 'month', from: null, to: null };
const breakdownState = { period: 'month', from: null, to: null };

// State for the standalone Cashflow summary card (In/Out/Overspent +
// "Where it went" / "Where it came from"), independent of the Cash Flow
// chart above — its own rolling-window periods (1M/3M/6M/YTD/1Y/ALL).
const cashflowCardState = { period: '3m', from: null, to: null };

document.addEventListener('DOMContentLoaded', () => {
  const K = window.STORAGE_KEYS;
  const accounts = window.Storage.get(K.ACCOUNTS, []);
  const transactions = window.Storage.get(K.TRANSACTIONS, []);
  const bills = window.Storage.get(K.BILLS, []);
  const investments = window.Storage.get(K.INVESTMENTS, []);
  const loans = window.Storage.get(K.LOANS, []);
  const creditCards = window.Storage.get(K.CREDIT_CARDS, []);

  renderHero(accounts, transactions, investments);
  renderWealthCard(accounts, investments, loans, creditCards);
  renderCashflowCard(transactions);
  renderUpcomingBills(bills);
  renderCharts(transactions);
  bindQuickActions();
  bindWealthToggle();
  bindCashflowCardToggle();
  bindCashflowCardTabs(transactions);
  bindPillFilter(cashflowState, {
    tabsSelector: '[data-cashflow-tabs]', datasetKey: 'cashflowPeriod',
    fromId: 'cashflowFrom', toId: 'cashflowTo',
    onChange: () => renderCashFlowChart(transactions),
  });
  bindPillFilter(breakdownState, {
    tabsSelector: '[data-breakdown-tabs]', datasetKey: 'breakdownPeriod',
    fromId: 'breakdownFrom', toId: 'breakdownTo',
    onChange: () => renderBreakdownCharts(transactions),
  });

  // Redraw the charts (not just the rest of the UI) when dark/light mode
  // changes, since Chart.js needs new instances to pick up new colors.
  window.addEventListener('themechange', () => renderCharts(transactions));

  // Safety net for the Moi "Include in Net Worth" toggle: if this tab was
  // already open when the setting was flipped on the Moi page (or in
  // another tab), refresh the Wealth card as soon as this tab is looked
  // at again — otherwise it only picks it up on the next full page load.
  const refreshWealth = () => {
    const freshAccounts = window.Storage.get(K.ACCOUNTS, []);
    const freshInvestments = window.Storage.get(K.INVESTMENTS, []);
    const freshLoans = window.Storage.get(K.LOANS, []);
    const freshCreditCards = window.Storage.get(K.CREDIT_CARDS, []);
    renderHero(freshAccounts, transactions, freshInvestments);
    renderWealthCard(freshAccounts, freshInvestments, freshLoans, freshCreditCards);
  };
  window.addEventListener('storage', (e) => {
    if (!e.key || e.key.startsWith('ledger:')) refreshWealth();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshWealth();
  });
});

function renderHero(accounts, transactions, investments) {
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const netWorth = totalBalance + investments.reduce((sum, i) => sum + i.value, 0);
  const monthlyIncome = Helpers.sumThisMonth(transactions, 'income');
  const monthlyExpense = Helpers.sumThisMonth(transactions, 'expense');
  const savings = monthlyIncome - monthlyExpense;

  // Hero headline is total net worth (accounts + investments), not just
  // account balances — the account balance moved down into the mini row.
  const valueEl = document.querySelector('[data-hero-balance]');
  if (valueEl) Helpers.animateCounter(valueEl, netWorth);

  document.querySelectorAll('[data-networth-card]').forEach((el) => {
    el.textContent = Helpers.formatCurrency(netWorth);
  });

  const balanceEl = document.querySelector('[data-mini-balance]');
  if (balanceEl) balanceEl.textContent = Helpers.formatCurrency(totalBalance);

  const savingsEl = document.querySelector('[data-mini-savings]');
  if (savingsEl) savingsEl.textContent = Helpers.formatCurrency(savings);

  const accountsEl = document.querySelector('[data-mini-accounts]');
  if (accountsEl) accountsEl.textContent = accounts.length;
}

/**
 * The "Wealth" card: net worth headline, an assets-vs-liabilities split
 * bar, and the two of them broken into categories — Cash & Savings +
 * investment groups on the assets side, loan types + credit card
 * balances on the liabilities side. Each side is sorted largest-first
 * and only categories with money in them are shown, mirroring the
 * Assets/Liabilities pages' own grouping.
 */
function renderWealthCard(accounts, investments, loans, creditCards) {
  const totalCash = accounts.reduce((sum, a) => sum + a.balance, 0);

  // Moi only joins the Wealth card totals when the user has opted in from
  // the checkbox on the Moi page (Moi.setIncludedInNetWorth).
  const moiIncluded = !!(window.Moi && Moi.includedInNetWorth());
  const totalMoiGiven = moiIncluded ? Moi.givenTotal() : 0;
  const totalMoiTaken = moiIncluded ? Moi.takenTotal() : 0;

  const assetItems = [];
  if (totalCash > 0) assetItems.push({ label: 'Cash & Savings', value: totalCash, color: '#8a8d98' });
  WEALTH_ASSET_GROUPS.forEach((group) => {
    const total = investments
      .filter((i) => group.types.includes(i.type))
      .reduce((sum, i) => sum + i.value, 0);
    if (total > 0) assetItems.push({ label: group.label, value: total, color: group.color });
  });
  if (totalMoiGiven > 0) assetItems.push({ label: 'Moi Given', value: totalMoiGiven, color: '#f472b6' });
  assetItems.sort((a, b) => b.value - a.value);

  const liabItems = [];
  const loansByType = {};
  loans
    .filter((l) => l.direction === 'borrowed' && l.remainingBalance > 0)
    .forEach((l) => {
      const key = l.type || 'Other';
      loansByType[key] = (loansByType[key] || 0) + l.remainingBalance;
    });
  Object.keys(loansByType).forEach((type) => {
    liabItems.push({ label: type, value: loansByType[type], color: '#ef5a5a' });
  });
  const totalCC = creditCards.reduce((sum, c) => sum + c.used, 0);
  if (totalCC > 0) liabItems.push({ label: 'Credit Card Balances', value: totalCC, color: '#dc3d3d' });
  if (totalMoiTaken > 0) liabItems.push({ label: 'Moi Received', value: totalMoiTaken, color: '#fb923c' });
  liabItems.sort((a, b) => b.value - a.value);

  const totalAssets = assetItems.reduce((sum, i) => sum + i.value, 0);
  const totalLiabilities = liabItems.reduce((sum, i) => sum + i.value, 0);
  const netWorth = totalAssets - totalLiabilities;
  const netColor = netWorth < 0 ? 'var(--color-negative)' : 'var(--color-accent)';

  const netEl = document.querySelector('[data-wealth-net]');
  if (netEl) {
    netEl.textContent = Helpers.formatCompactCurrency(netWorth);
    netEl.style.color = netColor;
  }
  const netLabelEl = document.querySelector('[data-wealth-net-label]');
  if (netLabelEl) {
    netLabelEl.textContent = `Net ${Helpers.formatCompactCurrency(netWorth)}`;
    netLabelEl.style.color = netColor;
  }

  const total = totalAssets + totalLiabilities;
  const assetsPct = total > 0 ? (totalAssets / total) * 100 : 50;
  const liabPct = 100 - assetsPct;
  const assetsBar = document.querySelector('[data-wealth-bar-assets]');
  const liabBar = document.querySelector('[data-wealth-bar-liabilities]');
  if (assetsBar) assetsBar.style.width = `${assetsPct}%`;
  if (liabBar) liabBar.style.width = `${liabPct}%`;
  setText('[data-wealth-assets-pct]', `${assetsPct.toFixed(0)}% Assets`);
  setText('[data-wealth-liab-pct]', `${liabPct.toFixed(0)}% Liabilities`);

  setText('[data-wealth-assets-count]', assetItems.length);
  setText('[data-wealth-liabilities-count]', liabItems.length);
  setText('[data-wealth-assets-total]', Helpers.formatCompactCurrency(totalAssets));
  setText('[data-wealth-liabilities-total]', Helpers.formatCompactCurrency(totalLiabilities));

  renderWealthList('[data-wealth-assets-list]', assetItems, 'No assets added yet.');
  renderWealthList('[data-wealth-liabilities-list]', liabItems, 'No liabilities \u2014 debt free!');
}

function renderWealthList(selector, items, emptyMessage) {
  const el = document.querySelector(selector);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<p class="wealth-empty">${emptyMessage}</p>`;
    return;
  }
  const max = Math.max(...items.map((i) => i.value), 1);
  el.innerHTML = items
    .map((item) => `
      <div class="wealth-row">
        <div class="wealth-row__top">
          <span class="wealth-row__label"><span class="wealth-row__dot" style="background:${item.color};"></span>${Helpers.escapeHtml(item.label)}</span>
          <span class="wealth-row__value">${Helpers.formatCompactCurrency(item.value)}</span>
        </div>
        <div class="wealth-row__bar"><div class="wealth-row__bar-fill" style="width:${Math.max(4, (item.value / max) * 100)}%; background:${item.color};"></div></div>
      </div>`)
    .join('');
}

/** Collapse/expand the Wealth card body via its header — the whole header
 * row (not just the chevron) is the click target. */
function bindWealthToggle() {
  const btn = document.querySelector('[data-wealth-toggle]');
  const body = document.querySelector('[data-wealth-body]');
  const arrow = document.querySelector('[data-wealth-arrow]');
  if (!btn || !body) return;
  btn.addEventListener('click', () => {
    const collapsed = body.classList.toggle('is-collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    if (arrow) arrow.classList.toggle('is-collapsed', collapsed);
  });
}

/** Start-of-window date for a Cashflow card period, or null for 'all'. */
function cashflowPeriodStart(period, now = new Date()) {
  const from = new Date(now);
  switch (period) {
    case '1m': from.setMonth(from.getMonth() - 1); return from;
    case '3m': from.setMonth(from.getMonth() - 3); return from;
    case '6m': from.setMonth(from.getMonth() - 6); return from;
    case '1y': from.setFullYear(from.getFullYear() - 1); return from;
    case 'ytd': return new Date(now.getFullYear(), 0, 1);
    default: return null; // 'all'
  }
}

/**
 * The "Cashflow" card: total in vs out for a rolling period, an
 * overspent/saved flag, and two category breakdowns ("Where it went" /
 * "Where it came from") sorted largest-first with each category's share
 * of that side's total.
 */
function renderCashflowCard(transactions) {
  const period = cashflowCardState.period;
  const now = new Date();

  let periodTx;
  if (period === 'custom') {
    const from = cashflowCardState.from ? new Date(`${cashflowCardState.from}T00:00:00`) : null;
    const to = cashflowCardState.to ? new Date(`${cashflowCardState.to}T23:59:59`) : null;
    periodTx = (from && to && !isNaN(from) && !isNaN(to))
      ? transactions.filter((t) => { const d = new Date(t.date); return d >= from && d <= to; })
      : [];
  } else {
    const from = cashflowPeriodStart(period, now);
    periodTx = from
      ? transactions.filter((t) => { const d = new Date(t.date); return d >= from && d <= now; })
      : transactions;
  }

  const expenseTx = periodTx.filter((t) => t.type === 'expense');
  const incomeTx = periodTx.filter((t) => t.type === 'income');
  const totalOut = expenseTx.reduce((sum, t) => sum + t.amount, 0);
  const totalIn = incomeTx.reduce((sum, t) => sum + t.amount, 0);
  const net = totalIn - totalOut;

  setText('[data-cashflow-net]', `${net < 0 ? '-' : ''}${Helpers.formatCompactCurrency(Math.abs(net))}`);
  setText('[data-cashflow-period-badge]', period === 'custom' ? 'CUSTOM' : period.toUpperCase());
  setText('[data-cashflow-in]', Helpers.formatCompactCurrency(totalIn));
  setText('[data-cashflow-out]', Helpers.formatCompactCurrency(totalOut));

  const flagBox = document.querySelector('[data-cashflow-flag-box]');
  const flagLabel = document.querySelector('[data-cashflow-flag-label]');
  const flagValue = document.querySelector('[data-cashflow-flag-value]');
  const flagSub = document.querySelector('[data-cashflow-flag-sub]');
  if (flagBox && flagLabel && flagValue) {
    flagBox.classList.remove('cashflow-stat--flag-overspent', 'cashflow-stat--flag-saved');
    if (totalOut > totalIn) {
      flagBox.classList.add('cashflow-stat--flag-overspent');
      flagLabel.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> OVERSPENT';
      flagValue.textContent = Helpers.formatCompactCurrency(totalOut - totalIn);
      if (flagSub) flagSub.textContent = 'over income';
    } else {
      flagBox.classList.add('cashflow-stat--flag-saved');
      flagLabel.innerHTML = '<i class="fa-solid fa-piggy-bank"></i> SAVED';
      flagValue.textContent = Helpers.formatCompactCurrency(totalIn - totalOut);
      if (flagSub) flagSub.textContent = 'of income';
    }
  }

  setText('[data-cashflow-out-total]', Helpers.formatCompactCurrency(totalOut));
  setText('[data-cashflow-in-total]', Helpers.formatCompactCurrency(totalIn));

  renderCashflowList('[data-cashflow-out-list]', expenseTx, totalOut, {
    empty: 'No spending in this period.', addLabel: 'Add expense', addHref: 'expense.html',
  });
  renderCashflowList('[data-cashflow-in-list]', incomeTx, totalIn, {
    empty: 'No income in this period.', addLabel: 'Add income', addHref: 'income.html',
  });
}

function renderCashflowList(selector, txList, total, { empty, addLabel, addHref }) {
  const el = document.querySelector(selector);
  if (!el) return;

  if (!txList.length || total <= 0) {
    el.innerHTML = `
      <div class="cashflow-empty">
        <p>${empty}</p>
        <a href="${addHref}">${addLabel} &rarr;</a>
      </div>`;
    return;
  }

  const totals = {};
  txList.forEach((t) => { totals[t.category] = (totals[t.category] || 0) + t.amount; });
  const rows = Object.keys(totals)
    .map((category) => ({ category, amount: totals[category] }))
    .sort((a, b) => b.amount - a.amount);

  el.innerHTML = rows
    .map((row) => {
      const pct = total > 0 ? (row.amount / total) * 100 : 0;
      return `
        <div class="cashflow-row">
          <div class="cashflow-row__top">
            <span class="cashflow-row__label">${Helpers.escapeHtml(row.category)}</span>
            <span class="cashflow-row__value">${Helpers.formatCompactCurrency(row.amount)} <span class="cashflow-row__pct">+${pct.toFixed(0)}%</span></span>
          </div>
          <div class="cashflow-row__bar"><div class="cashflow-row__bar-fill" style="width:${Math.max(4, pct)}%;"></div></div>
        </div>`;
    })
    .join('');
}

function bindCashflowCardToggle() {
  const btn = document.querySelector('[data-cashflow-toggle]');
  const body = document.querySelector('[data-cashflow-body]');
  const arrow = document.querySelector('[data-cashflow-arrow]');
  if (!btn || !body) return;
  btn.addEventListener('click', () => {
    const collapsed = body.classList.toggle('is-collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    if (arrow) arrow.classList.toggle('is-collapsed', collapsed);
  });
}

function bindCashflowCardTabs(transactions) {
  const tabs = document.querySelectorAll('[data-cashflow-widget-tabs] [data-cf-period]');
  const datesWrap = document.querySelector('[data-cashflow-widget-dates]');
  const fromInput = document.getElementById('cashflowCardFrom');
  const toInput = document.getElementById('cashflowCardTo');

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      cashflowCardState.period = btn.dataset.cfPeriod;
      tabs.forEach((b) => b.classList.toggle('is-active-tab', b === btn));

      const isCustom = cashflowCardState.period === 'custom';
      if (datesWrap) datesWrap.style.display = isCustom ? '' : 'none';

      if (isCustom && fromInput && toInput) {
        if (!fromInput.value) {
          const today = new Date();
          const monthAgo = new Date();
          monthAgo.setDate(today.getDate() - 30);
          fromInput.value = monthAgo.toISOString().slice(0, 10);
          toInput.value = today.toISOString().slice(0, 10);
        }
        cashflowCardState.from = fromInput.value;
        cashflowCardState.to = toInput.value;
      }

      renderCashflowCard(transactions);
    });
  });

  if (fromInput && toInput) {
    [fromInput, toInput].forEach((input) => {
      input.addEventListener('change', () => {
        cashflowCardState.from = fromInput.value;
        cashflowCardState.to = toInput.value;
        if (fromInput.value && toInput.value) renderCashflowCard(transactions);
      });
    });
  }
}

function renderUpcomingBills(bills) {
  const list = document.querySelector('[data-upcoming-bills]');
  if (!list) return;

  const sorted = [...bills]
    .filter((b) => !b.paid)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const shown = sorted.slice(0, 5);
  const remaining = sorted.length - shown.length;

  list.innerHTML = shown
    .map((b) => {
      const d = new Date(b.dueDate);
      const day = d.toLocaleDateString('en-US', { day: '2-digit' });
      const month = d.toLocaleDateString('en-US', { month: 'short' });
      return `
        <li class="list-row">
          <span class="bill-date">
            <span class="bill-date__day">${day}</span>
            <span class="bill-date__month">${month}</span>
          </span>
          <div class="list-row__meta">
            <p class="list-row__title">${Helpers.escapeHtml(b.name)}</p>
            <p class="list-row__sub">${Helpers.escapeHtml(b.category)}</p>
          </div>
          <span class="list-row__amount num">${Helpers.formatCurrency(b.amount)}</span>
        </li>`;
    })
    .join('') || '<p style="padding: var(--sp-3);">No upcoming bills. You\'re all caught up.</p>';

  if (remaining > 0) {
    list.innerHTML += `<li class="list-row__more">+${remaining} more upcoming bill${remaining === 1 ? '' : 's'}</li>`;
  }
}

function renderCharts(transactions) {
  if (typeof Chart === 'undefined') return;
  ChartTheme.applyDefaults();

  renderCashFlowChart(transactions);
  renderBreakdownCharts(transactions);
}

/* ────────────────────────────────────────────
   Shared pill-tab filter binding (Month / Year / All Time / Custom) —
   used by both the Cash Flow chart and the Breakdown charts, each with
   their own independent state object.
──────────────────────────────────────────── */
function bindPillFilter(state, { tabsSelector, datasetKey, fromId, toId, onChange }) {
  const tabs = document.querySelector(tabsSelector);
  const fromInput = document.getElementById(fromId);
  const toInput = document.getElementById(toId);
  if (!tabs || !fromInput || !toInput) return;

  tabs.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.remove('is-active-tab'));
      btn.classList.add('is-active-tab');
      state.period = btn.dataset[datasetKey];

      const isCustom = state.period === 'custom';
      fromInput.style.display = isCustom ? '' : 'none';
      toInput.style.display = isCustom ? '' : 'none';
      if (isCustom && !fromInput.value) {
        const today = new Date();
        const monthAgo = new Date();
        monthAgo.setDate(today.getDate() - 30);
        fromInput.value = monthAgo.toISOString().slice(0, 10);
        toInput.value = today.toISOString().slice(0, 10);
        state.from = fromInput.value;
        state.to = toInput.value;
      }
      onChange();
    });
  });

  [fromInput, toInput].forEach((input) => {
    input.addEventListener('change', () => {
      state.from = fromInput.value;
      state.to = toInput.value;
      if (fromInput.value && toInput.value) onChange();
    });
  });
}

/** Resolves a filter state (period + optional custom from/to) into a
 *  concrete { start, end, label } date range. Shared by the cash flow
 *  chart (which further buckets the range) and the breakdown charts
 *  (which just need the range to filter transactions by). */
function getPeriodRange(state, transactions) {
  const now = new Date();

  if (state.period === 'month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
      label: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    };
  }

  if (state.period === 'year') {
    return {
      start: new Date(now.getFullYear(), 0, 1),
      end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999),
      label: String(now.getFullYear()),
    };
  }

  if (state.period === 'custom') {
    const from = state.from ? new Date(`${state.from}T00:00:00`) : null;
    const to = state.to ? new Date(`${state.to}T23:59:59`) : null;
    if (!from || !to || isNaN(from) || isNaN(to)) {
      return { start: null, end: null, label: 'Custom Range' };
    }
    return {
      start: from,
      end: to,
      label: `${from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${to.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    };
  }

  // All time — span the full transaction history (or "now" if there's none yet).
  if (!transactions.length) {
    return { start: new Date(0), end: now, label: 'All Time' };
  }
  const dates = transactions.map((t) => new Date(t.date));
  return {
    start: new Date(Math.min(...dates)),
    end: now,
    label: 'All Time',
  };
}

/* ────────────────────────────────────────────
   Cash flow chart — filterable (Month / Year / All Time / Custom)
──────────────────────────────────────────── */
function getCashflowBuckets(transactions) {
  const range = getPeriodRange(cashflowState, transactions);
  const title = `Cash Flow — ${range.label}`;
  if (!range.start || !range.end) {
    return { buckets: [], title, groupKeyFor: () => null };
  }

  const spanDays = Math.max(1, Math.round((range.end - range.start) / 86400000) + 1);

  if (spanDays <= 62) {
    // Short ranges (a month, or a short custom span) — bucket by day.
    const buckets = [];
    const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate());
    const endDay = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate());
    while (cursor <= endDay) {
      buckets.push(cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      cursor.setDate(cursor.getDate() + 1);
    }
    return {
      buckets,
      title,
      groupKeyFor: (d) => (d >= range.start && d <= range.end ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null),
    };
  }

  // Longer ranges (a year, all time, or a long custom span) — bucket by month.
  const buckets = [];
  const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  const endMonth = new Date(range.end.getFullYear(), range.end.getMonth(), 1);
  while (cursor <= endMonth) {
    buckets.push(cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return {
    buckets,
    title,
    groupKeyFor: (d) => (d >= range.start && d <= range.end ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : null),
  };
}

function renderCashFlowChart(transactions) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('cashFlowChart');
  if (!canvas) return;

  const { buckets, title, groupKeyFor } = getCashflowBuckets(transactions);
  const titleEl = document.querySelector('[data-cashflow-title]');
  if (titleEl) titleEl.textContent = title;

  const incomeByBucket = Object.fromEntries(buckets.map((b) => [b, 0]));
  const expenseByBucket = Object.fromEntries(buckets.map((b) => [b, 0]));
  transactions.forEach((t) => {
    const key = groupKeyFor(new Date(t.date));
    if (key === null || !(key in incomeByBucket)) return;
    if (t.type === 'income') incomeByBucket[key] += t.amount;
    else if (t.type === 'expense') expenseByBucket[key] += t.amount;
  });

  if (dashboardCashFlowChart) dashboardCashFlowChart.destroy();
  dashboardCashFlowChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: buckets,
      datasets: [
        { label: 'Income', data: buckets.map((b) => incomeByBucket[b]), backgroundColor: '#34d399', borderRadius: 6, maxBarThickness: 18 },
        { label: 'Expense', data: buckets.map((b) => expenseByBucket[b]), backgroundColor: '#f87171', borderRadius: 6, maxBarThickness: 18 },
      ],
    },
    options: ChartTheme.lineOptions(),
  });
}

/* ────────────────────────────────────────────
   Expense / income breakdown charts — share one filter (Month / Year /
   All Time / Custom), grouped by category, with % share in the legend.
──────────────────────────────────────────── */
function renderBreakdownCharts(transactions) {
  renderBreakdownChart(transactions, 'expense', 'expenseBreakdownChart', '[data-expense-legend]', (chart) => { dashboardExpenseBreakdownChart = chart; }, () => dashboardExpenseBreakdownChart);
  renderBreakdownChart(transactions, 'income', 'incomeBreakdownChart', '[data-income-legend]', (chart) => { dashboardIncomeBreakdownChart = chart; }, () => dashboardIncomeBreakdownChart);
}

function renderBreakdownChart(transactions, type, canvasId, legendSelector, setChart, getChart) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const range = getPeriodRange(breakdownState, transactions);
  const byCategory = {};
  if (range.start && range.end) {
    transactions
      .filter((t) => t.type === type && new Date(t.date) >= range.start && new Date(t.date) <= range.end)
      .forEach((t) => {
        byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
      });
  }
  const catLabels = Object.keys(byCategory);
  const catValues = Object.values(byCategory);

  const existing = getChart();
  if (existing) existing.destroy();
  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: catLabels,
      datasets: [{ data: catValues, backgroundColor: ChartTheme.palette, borderWidth: 0 }],
    },
    options: ChartTheme.doughnutOptions(),
  });
  setChart(chart);
  renderLegend(legendSelector, catLabels, catValues, ChartTheme.palette);
}

function renderLegend(selector, labels, values, palette) {
  const el = document.querySelector(selector);
  if (!el) return;
  if (!labels.length) {
    el.innerHTML = '<span class="legend-item">No transactions in this period.</span>';
    return;
  }
  const total = values.reduce((sum, v) => sum + v, 0);
  el.innerHTML = labels
    .map((label, i) => {
      const pct = total > 0 ? Math.round((values[i] / total) * 100) : 0;
      return `
      <span class="legend-item">
        <span class="legend-swatch" style="background:${palette[i % palette.length]}"></span>${label}
        <span class="legend-item__amount">${Helpers.formatCurrency(values[i])} · ${pct}%</span>
      </span>`;
    })
    .join('');
}

function bindQuickActions() {
  document.querySelectorAll('[data-quick-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dest = btn.getAttribute('data-quick-action');
      window.location.href = dest;
    });
  });
}

function setText(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}
