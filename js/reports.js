/**
 * reports.js — Enhanced reports page
 * Features: period tabs, month navigator, 4 stat cards, insights,
 * 4 charts, paginated transaction table, export (CSV/PDF/Word).
 */

const state = {
  period: 'monthly',
  monthOffset: 0,   // 0 = current month, -1 = last month, etc.
};

const TXN_PAGE_SIZE = 15;
let txnPage = 1;
let txnFiltered = [];

document.addEventListener('DOMContentLoaded', () => {
  bindPeriodTabs();
  bindMonthNav();
  bindTxnFilters();
  bindStatCardNav();
  buildExportDropdown();
  applyPeriodFromQuery();
  render();
});

/* Honor ?period=<tab> on load (e.g. dashboard's "View all" link opens
   straight to the Lifetime tab so it actually shows every transaction,
   not just the current month). Falls back to the default 'monthly'
   state silently if the param is missing or unrecognized. */
function applyPeriodFromQuery() {
  const requested = new URLSearchParams(window.location.search).get('period');
  const tabBtn = requested && document.querySelector(`[data-period-tab="${requested}"]`);
  if (tabBtn) tabBtn.click();
}

/* ────────────────────────────────────────────
   Stat card navigation (click a summary card to jump to that page,
   carrying the currently selected period along as ?from=&to= so the
   target page opens already filtered to the same window.)
──────────────────────────────────────────── */
function bindStatCardNav() {
  document.querySelectorAll('[data-report-nav]').forEach((card) => {
    const go = () => {
      const base = card.dataset.reportNav;
      const range = getCurrentRange(state.period);
      const from = range.start.toISOString().slice(0, 10);
      const to = range.end.toISOString().slice(0, 10);
      window.location.href = `${base}?from=${from}&to=${to}`;
    };
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
  });
}

/* ────────────────────────────────────────────
   Period tabs
──────────────────────────────────────────── */
function bindPeriodTabs() {
  document.querySelectorAll('[data-period-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.period = btn.dataset.periodTab;
      state.monthOffset = 0;
      document.querySelectorAll('[data-period-tab]').forEach(b => b.classList.remove('is-active-tab'));
      btn.classList.add('is-active-tab');
      document.getElementById('monthNav').style.display = state.period === 'monthly' ? 'flex' : 'none';

      const isCustom = state.period === 'custom';
      const fromInput = document.querySelector('[data-period-custom-from]');
      const toInput = document.querySelector('[data-period-custom-to]');
      if (fromInput) fromInput.style.display = isCustom ? '' : 'none';
      if (toInput) toInput.style.display = isCustom ? '' : 'none';
      if (isCustom && fromInput && !fromInput.value) {
        const today = new Date().toISOString().slice(0, 10);
        fromInput.value = today;
        toInput.value = today;
      }
      render();
    });
  });

  ['[data-period-custom-from]', '[data-period-custom-to]'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.addEventListener('change', () => render());
  });
}

/* ────────────────────────────────────────────
   Month navigator
──────────────────────────────────────────── */
function bindMonthNav() {
  document.getElementById('prevMonth').addEventListener('click', () => { state.monthOffset--; render(); });
  document.getElementById('nextMonth').addEventListener('click', () => {
    if (state.monthOffset < 0) { state.monthOffset++; render(); }
  });
  // Hide next button when at current month
  updateMonthNav();
}

function updateMonthNav() {
  const nav = document.getElementById('monthNav');
  const label = document.getElementById('monthNavLabel');
  const nextBtn = document.getElementById('nextMonth');

  const d = getMonthDate();
  label.textContent = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  nextBtn.disabled = state.monthOffset >= 0;
  nextBtn.style.opacity = state.monthOffset >= 0 ? '0.3' : '1';
  nav.style.display = state.period === 'monthly' ? 'flex' : 'none';
}

function getMonthDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + state.monthOffset, 1);
}

/* ────────────────────────────────────────────
   Main render
──────────────────────────────────────────── */
function render() {
  updateMonthNav();
  const all = Transactions.all();
  const range = getCurrentRange(state.period);
  const currentTxns = all.filter(t => inRange(t.date, range));

  setText('[data-period-label]', range.label);

  renderSummary(currentTxns, range);
  renderInsights(currentTxns, all);
  renderComparisonChart(all);
  renderTrendChart(all);
  renderCategoryChart(currentTxns);
  renderIncomeChart(currentTxns);
  renderInvestmentGrowthChart();
  renderTopList(currentTxns, 'expense', 'topExpensesList');
  renderTopList(currentTxns, 'income', 'topIncomeList');
  renderTxnTable(currentTxns);
}

/* ────────────────────────────────────────────
   Date range helpers
──────────────────────────────────────────── */
function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - day + (day === 0 ? -6 : 1));
  return date;
}

function getCurrentRange(period) {
  const now = new Date();
  if (period === 'daily') {
    const start = new Date(now); start.setHours(0,0,0,0);
    const end   = new Date(now); end.setHours(23,59,59,999);
    return { start, end, label: 'Today', days: 1 };
  }
  if (period === 'weekly') {
    const start = startOfWeek(now); start.setHours(0,0,0,0);
    const end   = new Date(start); end.setDate(end.getDate()+6); end.setHours(23,59,59,999);
    return { start, end, label: 'This Week', days: 7 };
  }
  if (period === 'yearly') {
    return { start: new Date(now.getFullYear(),0,1), end: new Date(now.getFullYear(),11,31,23,59,59), label: 'This Year', days: 365 };
  }
  if (period === 'lifetime') {
    const earliest = Transactions.all().reduce((min, t) => {
      const d = new Date(t.date);
      return (!min || d < min) ? d : min;
    }, null) || new Date(now.getFullYear(), 0, 1);
    const days = Math.max(1, Math.round((now - earliest) / 86400000) + 1);
    return { start: new Date(0), end: new Date(8640000000000000), label: 'Lifetime', days };
  }
  if (period === 'custom') {
    const fromVal = document.querySelector('[data-period-custom-from]')?.value;
    const toVal = document.querySelector('[data-period-custom-to]')?.value;
    const start = fromVal ? new Date(`${fromVal}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = toVal ? new Date(`${toVal}T23:59:59`) : new Date(now);
    const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
    const label = fromVal && toVal
      ? `${start.toLocaleDateString('en-US', { day: '2-digit', month: 'short' })} \u2013 ${end.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}`
      : 'Custom Range';
    return { start, end, label, days };
  }
  // monthly with offset
  const d = getMonthDate();
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end   = new Date(d.getFullYear(), d.getMonth()+1, 0, 23,59,59);
  const label = state.monthOffset === 0 ? 'This Month'
              : state.monthOffset === -1 ? 'Last Month'
              : d.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const days  = end.getDate();
  return { start, end, label, days };
}

function inRange(dateStr, range) {
  const d = new Date(dateStr);
  return d >= range.start && d <= range.end;
}

function getBuckets(period) {
  const now = new Date();
  const buckets = [];
  if (period === 'daily') {
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate()-i);
      const start = new Date(d); start.setHours(0,0,0,0);
      const end   = new Date(d); end.setHours(23,59,59,999);
      buckets.push({ label: d.toLocaleDateString('en-US',{weekday:'short'}), start, end });
    }
  } else if (period === 'weekly') {
    for (let i = 7; i >= 0; i--) {
      const start = startOfWeek(new Date(now)); start.setDate(start.getDate()-i*7); start.setHours(0,0,0,0);
      const end   = new Date(start); end.setDate(end.getDate()+6); end.setHours(23,59,59,999);
      buckets.push({ label: `${start.getDate()}/${start.getMonth()+1}`, start, end });
    }
  } else if (period === 'yearly') {
    for (let i = 4; i >= 0; i--) {
      const year = now.getFullYear()-i;
      buckets.push({ label: String(year), start: new Date(year,0,1), end: new Date(year,11,31,23,59,59) });
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      buckets.push({ label: d.toLocaleDateString('en-US',{month:'short'}), start: new Date(d.getFullYear(),d.getMonth(),1), end: new Date(d.getFullYear(),d.getMonth()+1,0,23,59,59) });
    }
  }
  return buckets;
}

/* ────────────────────────────────────────────
   Summary cards
──────────────────────────────────────────── */
function renderSummary(txns, range) {
  const income  = txns.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const expense = txns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const net     = income - expense;
  const rate    = income > 0 ? Math.round((net/income)*100) : 0;
  const incomeTxns  = txns.filter(t=>t.type==='income');
  const expenseTxns = txns.filter(t=>t.type==='expense');

  const { total: investment, count: investmentCount } = investmentAmountInRange(range);

  setText('[data-period-income]',  Helpers.formatCurrency(income));
  setText('[data-period-expense]', Helpers.formatCurrency(expense));
  setText('[data-period-net]',     Helpers.formatCurrency(net));
  setText('[data-period-investment]', Helpers.formatCurrency(investment));
  setText('[data-income-txn-count]',  `${incomeTxns.length} transaction${incomeTxns.length!==1?'s':''}`);
  setText('[data-expense-txn-count]', `${expenseTxns.length} transaction${expenseTxns.length!==1?'s':''}`);
  setText('[data-savings-rate]',   `Savings rate: ${rate}%`);
  setText('[data-investment-txn-count]', `${investmentCount} purchase${investmentCount!==1?'s':''} made`);

  const netEl = document.querySelector('[data-period-net]');
  if (netEl) netEl.style.color = net >= 0 ? 'var(--color-accent)' : 'var(--color-negative)';
}

/** Investment amount actually put in during a date range — built from real
 *  purchase history (HoldingLots: quantity × price at time of buy, so a
 *  later top-up on an old holding counts in the month it happened), with
 *  value-only holdings (no lot history) falling back to their entry date
 *  and cost basis. Dividends are never included — this is principal
 *  invested only, matching the Investment Growth chart. */
function investmentAmountInRange(range) {
  const holdings = Investments.all();
  let total = 0;
  let count = 0;

  holdings.forEach((inv) => {
    const lots = (typeof HoldingLots !== 'undefined') ? HoldingLots.forHolding(inv.id) : [];
    if (lots.length > 0) {
      lots.forEach((lot) => {
        if (lot.date && inRange(lot.date, range)) {
          const amount = (Number(lot.quantity) || 0) * (Number(lot.price) || 0);
          if (amount > 0) { total += amount; count += 1; }
        }
      });
    } else if (inv.date && inRange(inv.date, range) && inv.costBasis > 0) {
      total += inv.costBasis;
      count += 1;
    }
  });

  return { total, count };
}

/* ────────────────────────────────────────────
   Insights
──────────────────────────────────────────── */
function renderInsights(txns, all) {
  const grid = document.getElementById('insightGrid');
  if (!grid) return;

  const income  = txns.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const expense = txns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);

  // Top expense category
  const byCat = Transactions.sumByCategory(txns.filter(t=>t.type==='expense'));
  const topCat = Object.entries(byCat).sort((a,b)=>b[1]-a[1])[0];

  // Largest single expense
  const biggestExpense = txns.filter(t=>t.type==='expense').sort((a,b)=>b.amount-a.amount)[0];

  // Savings rate
  const rate = income > 0 ? Math.round((income-expense)/income*100) : 0;
  const rateColor = rate >= 20 ? '#34d399' : rate >= 10 ? '#fbbf24' : '#f87171';

  // Avg transaction
  const expTxns = txns.filter(t=>t.type==='expense');
  const avgTxn  = expTxns.length > 0 ? expTxns.reduce((s,t)=>s+t.amount,0)/expTxns.length : 0;

  // Most frequent day
  const dayCount = {};
  txns.filter(t=>t.type==='expense').forEach(t => {
    const day = new Date(t.date).toLocaleDateString('en-US',{weekday:'long'});
    dayCount[day] = (dayCount[day]||0) + 1;
  });
  const busyDay = Object.entries(dayCount).sort((a,b)=>b[1]-a[1])[0];

  grid.innerHTML = [
    {
      icon: 'fa-fire', bg: 'rgba(248,113,113,0.12)', color: '#f87171',
      label: 'Top Spending Category',
      value: topCat ? topCat[0] : '—',
      note: topCat ? Helpers.formatCurrency(topCat[1]) : 'No expenses yet',
    },
    {
      icon: 'fa-arrow-up-right-dots', bg: 'rgba(52,211,153,0.12)', color: '#34d399',
      label: 'Savings Rate',
      value: `${rate}%`,
      note: rate >= 20 ? '🎉 Excellent saving!' : rate >= 10 ? 'Good — aim for 20%' : 'Consider cutting expenses',
    },
    {
      icon: 'fa-receipt', bg: 'rgba(96,165,250,0.12)', color: '#60a5fa',
      label: 'Largest Single Expense',
      value: biggestExpense ? Helpers.formatCurrency(biggestExpense.amount) : '—',
      note: biggestExpense ? biggestExpense.title : 'No expenses yet',
    },
    {
      icon: 'fa-calculator', bg: 'rgba(251,191,36,0.12)', color: '#fbbf24',
      label: 'Avg Transaction Size',
      value: Helpers.formatCurrency(avgTxn),
      note: `Across ${expTxns.length} expense${expTxns.length!==1?'s':''}`,
    },
    {
      icon: 'fa-calendar-week', bg: 'rgba(167,139,250,0.12)', color: '#a78bfa',
      label: 'Busiest Spending Day',
      value: busyDay ? busyDay[0] : '—',
      note: busyDay ? `${busyDay[1]} transaction${busyDay[1]!==1?'s':''}` : 'No data',
    },
    {
      icon: 'fa-scale-balanced', bg: 'rgba(34,211,238,0.12)', color: '#22d3ee',
      label: 'Income vs Expense Ratio',
      value: expense > 0 ? `${(income/expense).toFixed(2)}x` : '—',
      note: income > expense ? 'Income exceeds expenses ✓' : 'Expenses exceed income ⚠',
    },
  ].map(c => `
    <div class="insight-card">
      <div class="insight-card__icon" style="background:${c.bg}; color:${c.color};">
        <i class="fa-solid ${c.icon}"></i>
      </div>
      <div class="insight-card__body">
        <div class="insight-card__label">${c.label}</div>
        <div class="insight-card__value" style="color:${c.color};">${c.value}</div>
        <div class="insight-card__note">${escHtml(c.note)}</div>
      </div>
    </div>`).join('');
}

/* ────────────────────────────────────────────
   Charts
──────────────────────────────────────────── */
let compChart=null, trendChart=null, catChart=null, incChart=null;

function sumInBucket(all, b, type) {
  return all.filter(t=>t.type===type&&inRange(t.date,b)).reduce((s,t)=>s+t.amount,0);
}

function renderComparisonChart(all) {
  const canvas = document.getElementById('comparisonChart');
  if (!canvas || typeof Chart==='undefined') return;
  ChartTheme.applyDefaults();
  const buckets = getBuckets(state.period);
  if (compChart) compChart.destroy();
  compChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: buckets.map(b=>b.label),
      datasets: [
        { label:'Income',  data: buckets.map(b=>sumInBucket(all,b,'income')),  backgroundColor:'#34d399', borderRadius:6, maxBarThickness:20 },
        { label:'Expense', data: buckets.map(b=>sumInBucket(all,b,'expense')), backgroundColor:'#f87171', borderRadius:6, maxBarThickness:20 },
      ],
    },
    options: { ...ChartTheme.lineOptions(), plugins: { ...ChartTheme.lineOptions().plugins, legend: { display:true, labels:{ color:'#8d97ab', font:{size:11} } } } },
  });
}

function renderTrendChart(all) {
  const canvas = document.getElementById('trendChart');
  if (!canvas || typeof Chart==='undefined') return;
  ChartTheme.applyDefaults();
  const buckets = getBuckets(state.period);
  const netData = buckets.map(b=>sumInBucket(all,b,'income')-sumInBucket(all,b,'expense'));
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: buckets.map(b=>b.label),
      datasets: [{
        label:'Net Savings', data: netData,
        borderColor:'#22d3ee', backgroundColor:'rgba(34,211,238,0.1)',
        fill:true, tension:0.4, pointRadius:3, pointBackgroundColor:'#22d3ee',
      }],
    },
    options: ChartTheme.lineOptions(),
  });
}

function renderCategoryChart(txns) {
  const canvas = document.getElementById('categoryChart');
  if (!canvas || typeof Chart==='undefined') return;
  ChartTheme.applyDefaults();
  const byCat  = Transactions.sumByCategory(txns.filter(t=>t.type==='expense'));
  const labels = Object.keys(byCat);
  const values = Object.values(byCat);
  if (catChart) catChart.destroy();
  catChart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data:values, backgroundColor:ChartTheme.palette, borderWidth:0, hoverOffset:6 }] },
    options: { responsive:true, maintainAspectRatio:false, cutout:'65%', plugins:{ legend:{ display:false } } },
  });
  const legend = document.querySelector('[data-category-legend]');
  if (legend) legend.innerHTML = labels.map((l,i)=>`
    <span class="legend-item">
      <span class="legend-swatch" style="background:${ChartTheme.palette[i%ChartTheme.palette.length]};"></span>${l}
      <span class="legend-item__amount">${Helpers.formatCurrency(byCat[l])}</span>
    </span>`).join('') || '<span class="legend-item">No expenses</span>';
}

function renderIncomeChart(txns) {
  const canvas = document.getElementById('incomeChart');
  if (!canvas || typeof Chart==='undefined') return;
  ChartTheme.applyDefaults();
  const byCat  = Transactions.sumByCategory(txns.filter(t=>t.type==='income'));
  const labels = Object.keys(byCat);
  const values = Object.values(byCat);
  if (incChart) incChart.destroy();
  incChart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data:values, backgroundColor:['#34d399','#22d3ee','#60a5fa','#a78bfa','#fbbf24','#fb923c'], borderWidth:0, hoverOffset:6 }] },
    options: { responsive:true, maintainAspectRatio:false, cutout:'65%', plugins:{ legend:{ display:false } } },
  });
  const legend = document.querySelector('[data-income-legend]');
  const pal = ['#34d399','#22d3ee','#60a5fa','#a78bfa','#fbbf24','#fb923c'];
  if (legend) legend.innerHTML = labels.map((l,i)=>`
    <span class="legend-item">
      <span class="legend-swatch" style="background:${pal[i%pal.length]};"></span>${l}
      <span class="legend-item__amount">${Helpers.formatCurrency(byCat[l])}</span>
    </span>`).join('') || '<span class="legend-item">No income</span>';
}

/* ────────────────────────────────────────────
   Investment growth (cumulative, invested-only) — same data source and
   logic as the Assets page chart, so the two stay in sync.
──────────────────────────────────────────── */
let reportInvestmentGrowthChart = null;
function renderInvestmentGrowthChart() {
  const canvas = document.getElementById('reportInvestmentGrowthChart');
  if (!canvas || typeof Investments === 'undefined') return;

  const holdings = Investments.all();
  const series = Investments.growthSeries(holdings);
  const sub = document.querySelector('[data-report-investment-growth-sub]');

  if (series.length === 0) {
    if (sub) sub.textContent = 'Add an investment to start tracking how your invested capital grows over time.';
    const wrap = canvas.closest('.chart-panel__canvas-wrap');
    if (wrap) wrap.innerHTML = '<p style="text-align:center; color: var(--color-text-faint); padding-top: var(--sp-5);">No purchase history yet.</p>';
    return;
  }

  if (typeof Chart === 'undefined') return;
  ChartTheme.applyDefaults();

  const total = series[series.length - 1].invested;
  if (sub) {
    sub.innerHTML = `<span style="color: var(--color-accent); font-weight:600;">${Helpers.formatCurrency(total)}</span> invested to date \u00b7 amount only, returns not included`;
  }

  if (reportInvestmentGrowthChart) reportInvestmentGrowthChart.destroy();

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight || 220);
  gradient.addColorStop(0, 'rgba(167,139,250,0.28)');
  gradient.addColorStop(1, 'rgba(167,139,250,0)');

  reportInvestmentGrowthChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: series.map((s) => s.label),
      datasets: [{
        label: 'Invested',
        data: series.map((s) => s.invested),
        borderColor: '#a78bfa',
        backgroundColor: gradient,
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: '#a78bfa',
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `Invested: ${Helpers.formatCurrency(ctx.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: {
          grid: { color: ChartTheme.gridColor() },
          border: { display: false },
          ticks: { callback: (v) => Helpers.formatCurrency(v).replace(/\.00$/, '') },
        },
      },
    },
  });
}

/* ────────────────────────────────────────────
   Top lists with progress bars
──────────────────────────────────────────── */
function renderTopList(txns, type, elId) {
  const list = document.getElementById(elId);
  if (!list) return;
  const top = txns.filter(t=>t.type===type).sort((a,b)=>b.amount-a.amount).slice(0,6);
  if (top.length===0) { list.innerHTML=`<li style="padding:var(--sp-4);color:var(--color-text-muted);font-size:var(--fs-sm);">Nothing in this period.</li>`; return; }
  const max = top[0].amount;
  const color = type==='income' ? 'var(--color-accent)' : 'var(--color-negative)';
  list.innerHTML = top.map(t => {
    const meta = Categories.metaFor(type, t.category);
    const pct  = Math.round((t.amount/max)*100);
    return `<li class="list-row">
      <span class="chip chip--icon" style="width:32px;height:32px;flex-shrink:0;background:${meta.color};"><i class="fa-solid ${meta.icon}"></i></span>
      <div class="list-row__meta">
        <p class="list-row__title">${escHtml(t.title || t.category)}</p>
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
          <div class="list-row__bar-wrap"><div class="list-row__bar" style="width:${pct}%;background:${color};"></div></div>
          <span style="font-size:10px;color:var(--color-text-faint);min-width:30px;">${pct}%</span>
        </div>
      </div>
      <span class="list-row__amount" style="color:${color};">${Helpers.formatCurrency(t.amount)}</span>
    </li>`;
  }).join('');
}

/* ────────────────────────────────────────────
   Transaction table with pagination
──────────────────────────────────────────── */
function bindTxnFilters() {
  document.getElementById('txnTypeFilter').addEventListener('change', () => { txnPage=1; applyTxnFilters(); });
  document.getElementById('txnSearch').addEventListener('input', Helpers.debounce(() => { txnPage=1; applyTxnFilters(); }, 200));
}

function applyTxnFilters() {
  const range = getCurrentRange(state.period);
  const all   = Transactions.all().filter(t=>inRange(t.date,range));
  const type  = document.getElementById('txnTypeFilter').value;
  const term  = document.getElementById('txnSearch').value.toLowerCase().trim();

  txnFiltered = all
    .filter(t => type==='all' || t.type===type)
    .filter(t => !term || t.title.toLowerCase().includes(term) || t.category.toLowerCase().includes(term))
    .sort((a,b)=>new Date(b.date)-new Date(a.date));

  renderTxnTablePage();
}

function renderTxnTable(txns) {
  txnFiltered = [...txns].sort((a,b)=>new Date(b.date)-new Date(a.date));
  txnPage = 1;
  renderTxnTablePage();
}

function renderTxnTablePage() {
  const tbody = document.getElementById('txnTableBody');
  const pag   = document.getElementById('txnPagination');
  if (!tbody) return;

  const total = txnFiltered.length;
  const pages = Math.ceil(total/TXN_PAGE_SIZE) || 1;
  txnPage = Math.min(txnPage, pages);

  const slice = txnFiltered.slice((txnPage-1)*TXN_PAGE_SIZE, txnPage*TXN_PAGE_SIZE);

  if (slice.length===0) {
    tbody.innerHTML=`<tr><td colspan="5" style="text-align:center;padding:var(--sp-5);color:var(--color-text-muted);">No transactions found.</td></tr>`;
    pag.innerHTML='';
    return;
  }

  tbody.innerHTML = slice.map(t=>{
    const color = t.type==='income'?'var(--color-accent)':'var(--color-negative)';
    const sign  = t.type==='income'?'+':'-';
    return `<tr>
      <td>${Helpers.formatShortDate(t.date)}</td>
      <td>${escHtml(t.title)}</td>
      <td>${escHtml(t.category)}</td>
      <td><span class="chip ${t.type==='income'?'tone-accent':'tone-negative'}" style="font-size:11px;padding:2px 8px;">${t.type}</span></td>
      <td style="text-align:right;font-family:var(--font-mono);color:${color};">${sign}${Helpers.formatCurrency(t.amount)}</td>
    </tr>`;
  }).join('');

  pag.innerHTML = `
    <span>Showing ${(txnPage-1)*TXN_PAGE_SIZE+1}–${Math.min(txnPage*TXN_PAGE_SIZE,total)} of ${total}</span>
    <div style="display:flex;gap:var(--sp-2);">
      <button class="btn btn--ghost" style="padding:4px 10px;font-size:12px;" ${txnPage<=1?'disabled':''} onclick="changeTxnPage(-1)">‹ Prev</button>
      <button class="btn btn--ghost" style="padding:4px 10px;font-size:12px;" ${txnPage>=pages?'disabled':''} onclick="changeTxnPage(1)">Next ›</button>
    </div>`;
}

function changeTxnPage(dir) { txnPage += dir; renderTxnTablePage(); }
window.changeTxnPage = changeTxnPage;

/* ────────────────────────────────────────────
   Export
──────────────────────────────────────────── */
function buildExportDropdown() {
  Exporter.buildDropdown('reportExportContainer', exportCsv, exportPdf);
}

function getExportData() {
  const range = getCurrentRange(state.period);
  const txns  = Transactions.all().filter(t=>inRange(t.date,range)).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const income  = txns.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const expense = txns.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const net     = income - expense;
  const rate    = income > 0 ? Math.round(net/income*100) : 0;
  return { txns, income, expense, net, rate, range };
}

const TXN_COLS = [
  { label:'Date',     value: r => Helpers.formatShortDate(r.date) },
  { label:'Title',    key: 'title' },
  { label:'Category', key: 'category' },
  { label:'Type',     key: 'type' },
  { label:'Amount',   value: r => Helpers.formatCurrency(r.amount), align:'right' },
  { label:'Notes',    value: r => r.notes || '' },
];

const TXN_PDF_COLS = [
  { label:'Date',     value: r => Helpers.formatShortDate(r.date), width: 22 },
  { label:'Title',    key: 'title' },
  { label:'Category', key: 'category' },
  { label:'Amount',   value: r => Helpers.formatCurrency(r.amount), align:'right', emphasis: true, negative: r => r.type === 'expense', width: 32 },
];

function exportCsv() {
  const { txns, range } = getExportData();
  Exporter.csv(txns, TXN_COLS, `ledger-report-${range.label.replace(/\s+/g,'-').toLowerCase()}`);
}

function exportPdf() {
  const { txns, income, expense, net, rate, range } = getExportData();
  const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
  Exporter.pdf({
    title: 'Financial Report',
    subtitle: `Period: ${range.label}`,
    period: range.label,
    userName: settings.userName || '',
    summaryCards: [
      { label:'Total Income',   value: Helpers.formatCurrency(income) },
      { label:'Total Expenses', value: Helpers.formatCurrency(expense), negative: true },
      { label:'Net Savings',    value: Helpers.formatCurrency(net), negative: net < 0 },
      { label:'Savings Rate',   value: `${rate}%` },
    ],
    tables: [{ title:'All Transactions', columns: TXN_PDF_COLS, rows: txns }],
    categoryBreakdown: buildCategoryBreakdown(txns),
    filename: `ledger-report-${range.label.replace(/\s+/g,'-').toLowerCase()}`,
  });
}

/** Per-category share (%) and total amount, for both expense and income
 *  sides — shown as a two-column block right under the summary strip. */
function buildCategoryBreakdown(txns) {
  const expenseRows = txns.filter(t => t.type === 'expense');
  const incomeRows  = txns.filter(t => t.type === 'income');

  const toBreakdownList = (rows) => {
    const sums  = Transactions.sumByCategory(rows);
    const total = Object.values(sums).reduce((s, v) => s + v, 0);
    return Object.entries(sums)
      .sort((a, b) => b[1] - a[1])
      .map(([label, amt]) => {
        const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
        return { label, value: `${pct}%   -   ${Helpers.formatCurrency(amt)}` };
      });
  };

  return {
    transactionCount: txns.length,
    spending: toBreakdownList(expenseRows),
    income: toBreakdownList(incomeRows),
  };
}

/* ────────────────────────────────────────────
   Helpers
──────────────────────────────────────────── */
function setText(sel, text) { const el=document.querySelector(sel); if(el) el.textContent=text; }
function escHtml(str) { return Helpers.escapeHtml(str); }
