/**
 * networth.js
 * Net Worth = Total Assets − Total Liabilities.
 *   Assets:      cash & bank account balances, investment values,
 *                money you've lent out (still owed to you).
 *   Liabilities: loans/debts you've borrowed, outstanding credit card
 *                balances.
 * This month's income/expense cash flow is shown alongside for context
 * but is intentionally NOT added into the net worth math — it's a
 * separate log (see reports.html); net worth reflects your account
 * balances directly.
 */

// Tracks the live Chart.js instances so a re-render always destroys the
// previous instance before creating a new one on the same <canvas> —
// Chart.js throws "Canvas is already in use" otherwise.
let networthTrendChart = null;
let networthAssetsChart = null;
let networthLiabChart = null;

document.addEventListener('DOMContentLoaded', () => {
  renderNetWorthPage(true);

  // Safety net for the Moi "Include in Net Worth" toggle (and any other
  // localStorage change): if this tab was already open when the setting
  // was flipped on the Moi page, or in another tab, recompute as soon as
  // this tab is looked at again — the numbers only refresh on their own
  // via a fresh page load otherwise.
  window.addEventListener('storage', (e) => {
    if (!e.key || e.key.startsWith('ledger:')) renderNetWorthPage(false);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renderNetWorthPage(false);
  });
});

/** @param {boolean} isInitialLoad - only (re)binds the export dropdown and
 *  records a history snapshot on the real page load; the storage/visibility
 *  listeners above call this again just to refresh the numbers, not to
 *  re-bind click handlers or add duplicate history entries. */
function renderNetWorthPage(isInitialLoad) {
  const accounts = Accounts.all();
  const investments = Investments.all();
  const lentLoans = Loans.byDirection('lent');
  const borrowedLoans = Loans.byDirection('borrowed');
  const creditCards = CreditCards.all();
  const transactions = Transactions.all();

  // Moi only counts toward Net Worth when the user opts in from the
  // checkbox on the Moi page (Moi.setIncludedInNetWorth). Given → Asset,
  // Received/Taken → Liability.
  const moiIncluded = !!(window.Moi && Moi.includedInNetWorth());
  const totalMoiGiven = moiIncluded ? Moi.givenTotal() : 0;
  const totalMoiTaken = moiIncluded ? Moi.takenTotal() : 0;

  const totalCash = accounts.reduce((sum, a) => sum + a.balance, 0);
  const totalInvestments = investments.reduce((sum, i) => sum + i.value, 0);
  const totalLent = lentLoans.reduce((sum, l) => sum + l.remainingBalance, 0);
  const totalAssets = totalCash + totalInvestments + totalLent + totalMoiGiven;

  const totalLoans = borrowedLoans.reduce((sum, l) => sum + l.remainingBalance, 0);
  const totalCreditCards = creditCards.reduce((sum, c) => sum + c.used, 0);
  const totalLiabilities = totalLoans + totalCreditCards + totalMoiTaken;

  const netWorth = totalAssets - totalLiabilities;
  const history = isInitialLoad
    ? NetWorthHistory.record(netWorth, totalAssets, totalLiabilities)
    : NetWorthHistory.all();

  renderHero(totalAssets, totalLiabilities, netWorth);
  renderCashFlow(transactions);
  renderStatCards(totalCash, totalInvestments, totalLoans, totalLent);
  renderTrendChart(history);
  renderCharts({ totalCash, totalInvestments, totalLent, totalLoans, totalCreditCards, totalMoiGiven, totalMoiTaken });
  renderDetailLists({
    accounts, investments, lentLoans, borrowedLoans, creditCards, totalAssets, totalLiabilities,
    moiIncluded, totalMoiGiven, totalMoiTaken,
  });

  if (isInitialLoad) {
    bindExport({
      accounts, investments, lentLoans, borrowedLoans, creditCards, transactions,
      totalCash, totalInvestments, totalLent, totalAssets,
      totalLoans, totalCreditCards, totalLiabilities, netWorth,
      moiIncluded, totalMoiGiven, totalMoiTaken,
    });
  }
}

function renderHero(totalAssets, totalLiabilities, netWorth) {
  setText('[data-networth-value]', Helpers.formatCurrency(netWorth));
  setText('[data-mini-assets]', Helpers.formatCurrency(totalAssets));
  setText('[data-mini-liabilities]', Helpers.formatCurrency(totalLiabilities));
  setText('[data-label-assets]', Helpers.formatCurrency(totalAssets));
  setText('[data-label-liabilities]', Helpers.formatCurrency(totalLiabilities));

  const ratio = totalAssets > 0 ? (totalLiabilities / totalAssets) * 100 : 0;
  setText('[data-mini-ratio]', `${ratio.toFixed(0)}%`);

  const total = totalAssets + totalLiabilities;
  const assetsPct = total > 0 ? (totalAssets / total) * 100 : 50;
  const liabilitiesPct = 100 - assetsPct;
  const assetsBar = document.querySelector('[data-bar-assets]');
  const liabilitiesBar = document.querySelector('[data-bar-liabilities]');
  if (assetsBar) assetsBar.style.width = `${assetsPct}%`;
  if (liabilitiesBar) liabilitiesBar.style.width = `${liabilitiesPct}%`;

  const valueEl = document.querySelector('[data-networth-value]');
  if (valueEl) valueEl.style.color = netWorth < 0 ? 'var(--color-negative)' : '';
}

function renderCashFlow(transactions) {
  const income = Helpers.sumThisMonth(transactions, 'income');
  const expense = Helpers.sumThisMonth(transactions, 'expense');
  const net = income - expense;

  setText('[data-cashflow-income]', `+${Helpers.formatCurrency(income)}`);
  setText('[data-cashflow-expense]', `-${Helpers.formatCurrency(expense)}`);
  const netEl = document.querySelector('[data-cashflow-net]');
  if (netEl) {
    netEl.textContent = `${net >= 0 ? '+' : '-'}${Helpers.formatCurrency(Math.abs(net))}`;
    netEl.style.color = net >= 0 ? 'var(--color-accent)' : 'var(--color-negative)';
  }
}

function renderStatCards(totalCash, totalInvestments, totalLoans, totalLent) {
  setText('[data-stat-cash]', Helpers.formatCurrency(totalCash));
  setText('[data-stat-investments]', Helpers.formatCurrency(totalInvestments));
  setText('[data-stat-loans]', Helpers.formatCurrency(totalLoans));
  setText('[data-stat-lent]', Helpers.formatCurrency(totalLent));
}

/**
 * Line chart of net worth over time, built from the snapshots
 * NetWorthHistory records on each visit to this page. With fewer than two
 * points there's no trend to draw yet, so a friendly note is shown instead.
 */
function renderTrendChart(history) {
  const canvas = document.getElementById('netWorthTrendChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const sub = document.querySelector('[data-networth-trend-sub]');

  if (history.length < 2) {
    if (sub) sub.textContent = `Starting point recorded today: ${Helpers.formatCurrency(history[0]?.netWorth || 0)}. Check back as you keep updating your accounts.`;
    renderEmptyChart(canvas, "Come back after a few days to see your net worth trend build up.");
    return;
  }

  ChartTheme.applyDefaults();

  const first = history[0];
  const last = history[history.length - 1];
  const change = last.netWorth - first.netWorth;
  const changePct = first.netWorth !== 0 ? (change / Math.abs(first.netWorth)) * 100 : 0;
  const up = change >= 0;
  const lineColor = up ? '#34d399' : '#f87171';

  if (sub) {
    sub.innerHTML = `<span style="color:${lineColor}; font-weight:600;">${up ? '+' : '-'}${Helpers.formatCurrency(Math.abs(change))} (${up ? '+' : ''}${changePct.toFixed(1)}%)</span> since ${Helpers.formatShortDate(first.date)}`;
  }

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight || 260);
  gradient.addColorStop(0, up ? 'rgba(52,211,153,0.28)' : 'rgba(248,113,113,0.28)');
  gradient.addColorStop(1, up ? 'rgba(52,211,153,0)' : 'rgba(248,113,113,0)');

  if (networthTrendChart) networthTrendChart.destroy();
  networthTrendChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: history.map((s) => Helpers.formatShortDate(s.date)),
      datasets: [{
        label: 'Net Worth',
        data: history.map((s) => s.netWorth),
        borderColor: lineColor,
        backgroundColor: gradient,
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: lineColor,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
      }],
    },
    options: {
      ...ChartTheme.lineOptions(),
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `Net Worth: ${Helpers.formatCurrency(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: {
          grid: { color: ChartTheme.gridColor() },
          border: { display: false },
          ticks: { callback: (v) => Helpers.formatCurrency(v) },
        },
      },
    },
  });
}

function renderCharts({ totalCash, totalInvestments, totalLent, totalLoans, totalCreditCards, totalMoiGiven = 0, totalMoiTaken = 0 }) {
  if (typeof Chart === 'undefined') return;
  ChartTheme.applyDefaults();

  const assetLabels = ['Cash & Bank', 'Investments', 'Money Lent Out'];
  const assetValues = [totalCash, totalInvestments, totalLent];
  const assetPalette = ['#34d399', '#a78bfa', '#60a5fa'];
  if (totalMoiGiven > 0) {
    assetLabels.push('Moi Given');
    assetValues.push(totalMoiGiven);
    assetPalette.push('#f472b6');
  }

  const assetsCanvas = document.getElementById('assetsChart');
  if (assetsCanvas) {
    if (assetValues.every((v) => v === 0)) {
      renderEmptyChart(assetsCanvas, 'No assets added yet');
    } else {
      if (networthAssetsChart) networthAssetsChart.destroy();
      networthAssetsChart = new Chart(assetsCanvas, {
        type: 'doughnut',
        data: { labels: assetLabels, datasets: [{ data: assetValues, backgroundColor: assetPalette, borderWidth: 0 }] },
        options: ChartTheme.doughnutOptions(),
      });
      renderLegend('[data-assets-legend]', assetLabels, assetPalette);
    }
  }

  const liabLabels = ['Loans & Debts', 'Credit Card Balances'];
  const liabValues = [totalLoans, totalCreditCards];
  const liabPalette = ['#f87171', '#fbbf24'];
  if (totalMoiTaken > 0) {
    liabLabels.push('Moi Received');
    liabValues.push(totalMoiTaken);
    liabPalette.push('#fb923c');
  }

  const liabCanvas = document.getElementById('liabilitiesChart');
  if (liabCanvas) {
    if (liabValues.every((v) => v === 0)) {
      renderEmptyChart(liabCanvas, 'No liabilities — debt free!');
    } else {
      if (networthLiabChart) networthLiabChart.destroy();
      networthLiabChart = new Chart(liabCanvas, {
        type: 'doughnut',
        data: { labels: liabLabels, datasets: [{ data: liabValues, backgroundColor: liabPalette, borderWidth: 0 }] },
        options: ChartTheme.doughnutOptions(),
      });
      renderLegend('[data-liabilities-legend]', liabLabels, liabPalette);
    }
  }
}

function renderEmptyChart(canvas, message) {
  const wrap = canvas.closest('.chart-panel__canvas-wrap');
  if (wrap) wrap.innerHTML = `<p style="text-align:center; color: var(--color-text-faint); padding-top: var(--sp-5);">${message}</p>`;
}

function renderLegend(selector, labels, palette) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.innerHTML = labels
    .map((label, i) => `
      <span class="legend-item">
        <span class="legend-swatch" style="background:${palette[i % palette.length]}"></span>${label}
      </span>`)
    .join('');
}

const state = {
  // Investments collapsed by default since that list tends to be long;
  // the rest default open since they're usually short.
  expandedGroups: { cash: true, investments: false, lent: true, moigiven: true, loans: true, creditcards: true, moitaken: true },
};

function renderDetailLists({
  accounts, investments, lentLoans, borrowedLoans, creditCards, totalAssets, totalLiabilities,
  moiIncluded = false, totalMoiGiven = 0, totalMoiTaken = 0,
}) {
  setText('[data-assets-total]', Helpers.formatCurrency(totalAssets));
  setText('[data-liabilities-total]', Helpers.formatCurrency(totalLiabilities));

  const assetsList = document.querySelector('[data-assets-list]');
  if (assetsList) {
    assetsList.innerHTML =
      groupBlock('cash', 'Cash & Bank Accounts', accounts,
        accounts.length
          ? accounts.map((a) => rowItem(AccountTypeMeta[a.type]?.icon || 'fa-wallet', AccountTypeMeta[a.type]?.tone || 'tone-info', a.name, AccountTypeMeta[a.type]?.label || a.type, a.balance, 'var(--color-accent)', { type: 'account', id: a.id })).join('')
          : `<li class="breakdown-empty">No accounts added yet — <a href="accounts.html">add one</a>.</li>`) +
      groupBlock('investments', 'Investments', investments,
        investments.length
          ? investments.map((i) => rowItem(InvestmentTypeMeta[i.type]?.icon || 'fa-coins', InvestmentTypeMeta[i.type]?.tone || 'tone-info', i.name, i.type, i.value, 'var(--color-accent)', { type: 'investment', id: i.id })).join('')
          : `<li class="breakdown-empty">No investments added yet — <a href="accounts.html">add one</a>.</li>`) +
      groupBlock('lent', 'Money Lent Out', lentLoans.filter((l) => !Loans.isPaidOff(l)),
        lentLoans.filter((l) => !Loans.isPaidOff(l)).length
          ? lentLoans.filter((l) => !Loans.isPaidOff(l)).map((l) => rowItem('fa-hand-holding-dollar', 'tone-info', l.name || l.counterparty, l.counterparty || 'Lent', l.remainingBalance, 'var(--color-accent)', { type: 'lentLoan', id: l.id })).join('')
          : `<li class="breakdown-empty">No money lent out — <a href="loans.html">track one</a>.</li>`) +
      (moiIncluded
        ? groupBlock('moigiven', 'Moi Given', Moi.given(),
            Moi.given().length
              ? Moi.given().map((m) => rowItem('fa-hand-holding-heart', 'tone-info', m.name, m.village || 'Moi Given', Number(m.amount) || 0, 'var(--color-accent)')).join('')
              : `<li class="breakdown-empty">No Moi given yet — <a href="moi.html">add one</a>.</li>`)
        : '');
    bindGroupToggles(assetsList);
    bindDeleteButtons(assetsList);
  }

  const liabList = document.querySelector('[data-liabilities-list]');
  if (liabList) {
    liabList.innerHTML =
      groupBlock('loans', 'Loans & Debts', borrowedLoans.filter((l) => !Loans.isPaidOff(l)),
        borrowedLoans.filter((l) => !Loans.isPaidOff(l)).length
          ? borrowedLoans.filter((l) => !Loans.isPaidOff(l)).map((l) => rowItem('fa-hand-holding-dollar', 'tone-negative', l.name || l.counterparty, l.counterparty || 'Borrowed', l.remainingBalance, 'var(--color-negative)', { type: 'borrowedLoan', id: l.id })).join('')
          : `<li class="breakdown-empty">No loans on record — <a href="loans.html">add one</a>.</li>`) +
      groupBlock('creditcards', 'Credit Card Balances', creditCards,
        creditCards.length
          ? creditCards.map((c) => rowItem('fa-credit-card', 'tone-gold', c.name, `Used of ${Helpers.formatCurrency(c.limit)}`, c.used, 'var(--color-negative)', { type: 'creditcard', id: c.id })).join('')
          : `<li class="breakdown-empty">No credit cards on record — <a href="loans.html">add one</a>.</li>`) +
      (moiIncluded
        ? groupBlock('moitaken', 'Moi Received', Moi.taken(),
            Moi.taken().length
              ? Moi.taken().map((m) => rowItem('fa-hand-holding-dollar', 'tone-negative', m.name, m.village || 'Moi Received', Number(m.amount) || 0, 'var(--color-negative)')).join('')
              : `<li class="breakdown-empty">No Moi received yet — <a href="moi.html">add one</a>.</li>`)
        : '');
    bindGroupToggles(liabList);
    bindDeleteButtons(liabList);
  }
}

/** A collapsible group: header (label + count + chevron) that toggles a
 * nested row-list. State persists across re-renders via `state.expandedGroups`. */
function groupBlock(key, label, items, rowsHtml) {
  const expanded = !!state.expandedGroups[key];
  return `
    <div class="breakdown-group" data-group="${key}">
      <button type="button" class="breakdown-group__header" data-group-toggle>
        <span class="collapse-arrow ${expanded ? '' : 'is-collapsed'}"><i class="fa-solid fa-chevron-down"></i></span>
        <span class="breakdown-group__label">${escapeHtml(label)} <span class="breakdown-group__count">(${items.length})</span></span>
      </button>
      <ul class="row-list" style="${expanded ? '' : 'display:none;'}">${rowsHtml}</ul>
    </div>`;
}

function bindGroupToggles(container) {
  container.querySelectorAll('[data-group]').forEach((groupEl) => {
    const key = groupEl.dataset.group;
    const btn = groupEl.querySelector('[data-group-toggle]');
    const list = groupEl.querySelector('.row-list');
    const arrow = groupEl.querySelector('.collapse-arrow');
    if (!btn || !list) return;
    btn.addEventListener('click', () => {
      state.expandedGroups[key] = !state.expandedGroups[key];
      list.style.display = state.expandedGroups[key] ? '' : 'none';
      if (arrow) arrow.classList.toggle('is-collapsed', !state.expandedGroups[key]);
    });
  });
}

/** Delete straight from the Net Worth breakdown — no need to hop to
 * Accounts/Loans just to remove a line item. Closed loans are skipped
 * (kept in Liabilities → Closed Loans for their history, same rule as
 * the Loans page itself). Reloads after a successful delete so every
 * total, chart, and list on the page recomputes cleanly. */
function bindDeleteButtons(container) {
  container.querySelectorAll('[data-nw-delete]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const { nwType: type, nwId: id, nwName: name } = btn.dataset;
      handleNetworthDelete(type, id, name);
    });
  });
}

function handleNetworthDelete(type, id, name) {
  const labels = {
    account: 'account', investment: 'investment',
    lentLoan: 'lending record', borrowedLoan: 'loan', creditcard: 'credit card',
  };

  if (type === 'lentLoan' || type === 'borrowedLoan') {
    const record = Loans.get(id);
    if (record && Loans.isPaidOff(record)) {
      Toast.show("Closed loans aren't deleted here — they're kept on the Liabilities page under Closed Loans.", 'info');
      return;
    }
  }

  if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;

  if (type === 'account') Accounts.remove(id);
  else if (type === 'investment') Investments.remove(id);
  else if (type === 'lentLoan' || type === 'borrowedLoan') Loans.remove(id);
  else if (type === 'creditcard') CreditCards.remove(id);
  else return;

  Toast.show(`${labels[type] || 'Item'} deleted.`, 'info');
  window.location.reload();
}

function rowItem(icon, tone, title, sub, amount, color, del) {
  const deleteBtn = del
    ? `<div class="row-actions"><button type="button" class="danger" aria-label="Delete" title="Delete" data-nw-delete data-nw-type="${del.type}" data-nw-id="${del.id}" data-nw-name="${escapeHtml(title)}"><i class="fa-solid fa-trash"></i></button></div>`
    : '';
  return `
    <li class="list-row">
      <span class="chip ${tone}" style="width:38px;height:38px;"><i class="fa-solid ${icon}"></i></span>
      <div class="list-row__meta">
        <p class="list-row__title">${escapeHtml(title)}</p>
        <p class="list-row__sub">${escapeHtml(sub)}</p>
      </div>
      <span class="list-row__amount num" style="color:${color};">${Helpers.formatCurrency(amount)}</span>
      ${deleteBtn}
    </li>`;
}

function setText(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}

function escapeHtml(str) {
  // Delegates to the single shared implementation in helpers.js.
  return Helpers.escapeHtml(str);
}

/* ────────────────────────────────────────────
   Export — Total Financial Status Report
   A single statement that rolls up every asset and liability line item
   on this page (accounts, investments, money lent, loans/debts, credit
   cards) plus this month's cash flow, so the CSV/PDF genuinely mirrors
   "your total finance status" rather than just the headline number.
──────────────────────────────────────────── */
function bindExport(data) {
  if (!document.getElementById('networthExportContainer')) return;
  Exporter.buildDropdown('networthExportContainer',
    () => exportNetWorthCsv(data),
    () => exportNetWorthPdf(data),
  );
}

/** One flat, spreadsheet-friendly line-item list — every account,
 *  investment, lending record, loan/debt and credit card, tagged with
 *  which side of the balance sheet it sits on. */
function netWorthLineItems(data) {
  const { accounts, investments, lentLoans, borrowedLoans, creditCards, moiIncluded } = data;
  const rows = [];

  accounts.forEach((a) => rows.push({
    side: 'Asset', group: 'Cash & Bank', name: a.name,
    detail: AccountTypeMeta[a.type]?.label || a.type, amount: a.balance,
  }));
  investments.forEach((i) => rows.push({
    side: 'Asset', group: 'Investments', name: i.name,
    detail: i.type, amount: i.value,
  }));
  lentLoans.filter((l) => !Loans.isPaidOff(l)).forEach((l) => rows.push({
    side: 'Asset', group: 'Money Lent Out', name: l.name || l.counterparty,
    detail: l.counterparty ? `Owed by ${l.counterparty}` : 'Money lent', amount: l.remainingBalance,
  }));
  borrowedLoans.filter((l) => !Loans.isPaidOff(l)).forEach((l) => rows.push({
    side: 'Liability', group: 'Loans & Debts', name: l.name || l.counterparty,
    detail: l.type || (l.counterparty ? `Owed to ${l.counterparty}` : 'Loan'), amount: l.remainingBalance,
  }));
  creditCards.forEach((c) => rows.push({
    side: 'Liability', group: 'Credit Card Balances', name: c.name,
    detail: `Used of ${Helpers.formatCurrency(c.limit)} limit`, amount: c.used,
  }));

  if (moiIncluded && window.Moi) {
    Moi.given().forEach((m) => rows.push({
      side: 'Asset', group: 'Moi Given', name: m.name,
      detail: m.village || 'Moi', amount: Number(m.amount) || 0,
    }));
    Moi.taken().forEach((m) => rows.push({
      side: 'Liability', group: 'Moi Received', name: m.name,
      detail: m.village || 'Moi', amount: Number(m.amount) || 0,
    }));
  }

  return rows;
}

function netWorthCsvColumns() {
  return [
    { label: 'Side', key: 'side' },
    { label: 'Category', key: 'group' },
    { label: 'Name', key: 'name' },
    { label: 'Detail', key: 'detail' },
    { label: 'Amount', value: (r) => Helpers.formatCurrency(r.amount) },
  ];
}

function exportNetWorthCsv(data) {
  const rows = netWorthLineItems(data);
  Exporter.csv(rows, netWorthCsvColumns(), `ledger-networth-${new Date().toISOString().slice(0, 10)}`);
}

/** PDF columns shared by every line-item table below: Name, Detail, Amount. */
function netWorthPdfColumns() {
  return [
    { label: 'Name', key: 'name', width: 80 },
    { label: 'Detail', key: 'detail' },
    { label: 'Amount', value: (r) => Helpers.formatCurrency(r.amount), align: 'right', width: 34 },
  ];
}

function exportNetWorthPdf(data) {
  const {
    accounts, investments, lentLoans, borrowedLoans, creditCards, transactions,
    totalCash, totalInvestments, totalLent, totalAssets,
    totalLoans, totalCreditCards, totalLiabilities, netWorth,
  } = data;

  const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
  const ratio = totalAssets > 0 ? Math.round((totalLiabilities / totalAssets) * 100) : 0;

  const income = Helpers.sumThisMonth(transactions, 'income');
  const expense = Helpers.sumThisMonth(transactions, 'expense');
  const netCashFlow = income - expense;

  const activeLent = lentLoans.filter((l) => !Loans.isPaidOff(l));
  const activeBorrowed = borrowedLoans.filter((l) => !Loans.isPaidOff(l));

  const rows = (list) => list; // readability alias for autotable row sources

  const tables = [
    {
      title: 'Assets Composition',
      columns: [
        { label: 'Category', key: 'group', width: 90 },
        { label: 'Amount', value: (r) => Helpers.formatCurrency(r.amount), align: 'right', width: 40 },
        { label: '% of Assets', value: (r) => (totalAssets > 0 ? `${Math.round((r.amount / totalAssets) * 100)}%` : '0%'), align: 'right', width: 30 },
      ],
      rows: [
        { group: 'Cash & Bank', amount: totalCash },
        { group: 'Investments', amount: totalInvestments },
        { group: 'Money Lent Out', amount: totalLent },
      ].filter((r) => r.amount > 0),
    },
    {
      title: 'Liabilities Composition',
      columns: [
        { label: 'Category', key: 'group', width: 90 },
        { label: 'Amount', value: (r) => Helpers.formatCurrency(r.amount), align: 'right', width: 40 },
        { label: '% of Liabilities', value: (r) => (totalLiabilities > 0 ? `${Math.round((r.amount / totalLiabilities) * 100)}%` : '0%'), align: 'right', width: 30 },
      ],
      rows: [
        { group: 'Loans & Debts', amount: totalLoans },
        { group: 'Credit Card Balances', amount: totalCreditCards },
      ].filter((r) => r.amount > 0),
    },
    {
      title: 'Cash & Bank Accounts',
      columns: [
        { label: 'Name', key: 'name', width: 80 },
        { label: 'Type', value: (a) => AccountTypeMeta[a.type]?.label || a.type },
        { label: 'Balance', value: (a) => Helpers.formatCurrency(a.balance), align: 'right', width: 34 },
      ],
      rows: rows(accounts),
    },
    {
      title: 'Investments',
      columns: [
        { label: 'Name', key: 'name', width: 80 },
        { label: 'Type', key: 'type' },
        { label: 'Current Value', value: (i) => Helpers.formatCurrency(i.value), align: 'right', width: 34 },
      ],
      rows: rows(investments),
    },
    {
      title: 'Money Lent Out',
      columns: [
        { label: 'Name', key: 'name', width: 70 },
        { label: 'Owed By', value: (l) => l.counterparty || '\u2014' },
        { label: 'Outstanding', value: (l) => Helpers.formatCurrency(l.remainingBalance), align: 'right', width: 34 },
      ],
      rows: rows(activeLent),
    },
    {
      title: 'Loans & Debts',
      columns: [
        { label: 'Name', key: 'name', width: 60 },
        { label: 'Type', value: (l) => l.type || 'Loan' },
        { label: 'Owed To', value: (l) => l.counterparty || '\u2014' },
        { label: 'Interest', value: (l) => (l.interestRate ? `${l.interestRate}%` : '\u2014'), align: 'right', width: 20 },
        { label: 'Balance', value: (l) => Helpers.formatCurrency(l.remainingBalance), align: 'right', width: 30 },
      ],
      rows: rows(activeBorrowed),
    },
    {
      title: 'Credit Card Balances',
      columns: [
        { label: 'Card', key: 'name', width: 60 },
        { label: 'Limit', value: (c) => Helpers.formatCurrency(c.limit), align: 'right', width: 34 },
        { label: 'Used', value: (c) => Helpers.formatCurrency(c.used), align: 'right', width: 34 },
        { label: 'Available', value: (c) => Helpers.formatCurrency(Math.max(0, c.limit - c.used)), align: 'right', width: 34 },
      ],
      rows: rows(creditCards),
    },
    {
      title: "This Month's Cash Flow",
      columns: [
        { label: 'Item', key: 'label', width: 90 },
        { label: 'Amount', value: (r) => Helpers.formatCurrency(r.amount), align: 'right', width: 40 },
      ],
      rows: [
        { label: 'Income', amount: income },
        { label: 'Expenses', amount: expense },
        { label: 'Net Savings', amount: netCashFlow },
      ],
    },
  ];

  Exporter.pdf({
    title: 'Total Financial Status Report',
    subtitle: 'Net Worth Statement \u00b7 Assets \u00b7 Liabilities \u00b7 Cash Flow',
    userName: settings.userName || '',
    summaryCards: [
      { label: 'Net Worth', value: Helpers.formatCurrency(netWorth), negative: netWorth < 0 },
      { label: 'Total Assets', value: Helpers.formatCurrency(totalAssets) },
      { label: 'Total Liabilities', value: Helpers.formatCurrency(totalLiabilities), negative: totalLiabilities > 0 },
      { label: 'Debt-to-Asset Ratio', value: `${ratio}%` },
    ],
    tables,
    filename: `ledger-total-financial-status-${new Date().toISOString().slice(0, 10)}`,
  });
}
