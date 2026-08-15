/**
 * calculators.js
 * Powers calculators.html — six independent, self-contained calculators
 * (SIP, Lumpsum, Fixed Deposit, Loan EMI, CAGR, Emergency Fund) sharing
 * one tab bar. Each calculator recalculates live on input. Chart.js charts
 * are only (re)drawn when their panel is actually visible, since a canvas
 * inside a `display:none` panel has zero size.
 */

const charts = {};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof Chart !== 'undefined') ChartTheme.applyDefaults();

  bindTabs();
  bindRangeNumberPair('sipAmountRange', 'sipAmount', updateSIP);
  bindRangeNumberPair('sipReturnRange', 'sipReturn', updateSIP);
  bindRangeNumberPair('sipYearsRange', 'sipYears', updateSIP);

  bindRangeNumberPair('lumpAmountRange', 'lumpAmount', updateLumpsum);
  bindRangeNumberPair('lumpReturnRange', 'lumpReturn', updateLumpsum);
  bindRangeNumberPair('lumpYearsRange', 'lumpYears', updateLumpsum);
  bindChange('lumpCompound', updateLumpsum);

  bindRangeNumberPair('fdAmountRange', 'fdAmount', updateFD);
  bindRangeNumberPair('fdReturnRange', 'fdReturn', updateFD);
  bindRangeNumberPair('fdYearsRange', 'fdYears', updateFD);
  bindChange('fdCompound', updateFD);

  bindRangeNumberPair('emiAmountRange', 'emiAmount', updateEMI);
  bindRangeNumberPair('emiReturnRange', 'emiReturn', updateEMI);
  bindRangeNumberPair('emiYearsRange', 'emiYears', updateEMI);

  bindInput('cagrInitial', updateCAGR);
  bindInput('cagrFinal', updateCAGR);
  bindInput('cagrYears', updateCAGR);

  bindRangeNumberPair('efMonthsRange', 'efMonths', updateEmergencyFund);
  bindInput('efExpenses', updateEmergencyFund);
  bindInput('efSavings', updateEmergencyFund);

  prefillEmergencyFund();

  updateSIP();
  updateLumpsum();
  updateFD();
  updateEMI();
  updateCAGR();
  updateEmergencyFund();
});

/* ---------------- Tabs ---------------- */

function bindTabs() {
  const tabs = document.querySelectorAll('[data-calc-tab]');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.calcTab;
      tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
      document.querySelectorAll('[data-calc-panel]').forEach((panel) => {
        panel.classList.toggle('is-active', panel.dataset.calcPanel === target);
      });
      // Redraw this panel's chart now that its canvas is actually visible.
      ({ sip: updateSIP, lumpsum: updateLumpsum, fd: updateFD, emi: updateEMI, cagr: updateCAGR, emergency: updateEmergencyFund }[target] || (() => {}))();
    });
  });
}

/* ---------------- Input binding helpers ---------------- */

/** Keep a <input type="range"> and <input type="number"> in sync and call `onChange` on either. */
function bindRangeNumberPair(rangeId, numberId, onChange) {
  const range = document.getElementById(rangeId);
  const number = document.getElementById(numberId);
  if (!range || !number) return;

  range.addEventListener('input', () => {
    number.value = range.value;
    onChange();
  });
  number.addEventListener('input', () => {
    const clamped = Helpers.clamp(Number(number.value) || 0, Number(range.min), Number(range.max));
    range.value = clamped;
    onChange();
  });
}

function bindInput(id, onChange) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', onChange);
}

function bindChange(id, onChange) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', onChange);
}

function isVisible(canvas) {
  return !!(canvas && canvas.offsetParent !== null);
}

/* ---------------- SIP ---------------- */

function sipMaturity(monthly, annualRatePct, months) {
  const i = annualRatePct / 100 / 12;
  if (i === 0) return monthly * months;
  return monthly * ((Math.pow(1 + i, months) - 1) / i) * (1 + i);
}

function updateSIP() {
  const monthly = Number(document.getElementById('sipAmount').value) || 0;
  const rate = Number(document.getElementById('sipReturn').value) || 0;
  const years = Number(document.getElementById('sipYears').value) || 0;

  const months = years * 12;
  const maturity = sipMaturity(monthly, rate, months);
  const invested = monthly * months;
  const gain = maturity - invested;

  setText('[data-sip-maturity]', Helpers.formatCurrency(maturity));
  setText('[data-sip-invested]', Helpers.formatCurrency(invested));
  setText('[data-sip-gain]', Helpers.formatCurrency(gain));

  const canvas = document.getElementById('sipChart');
  if (!isVisible(canvas) || typeof Chart === 'undefined') return;

  const labels = [];
  const investedSeries = [];
  const valueSeries = [];
  for (let y = 1; y <= Math.max(years, 1); y++) {
    labels.push(`Yr ${y}`);
    investedSeries.push(monthly * y * 12);
    valueSeries.push(sipMaturity(monthly, rate, y * 12));
  }

  if (charts.sip) charts.sip.destroy();
  charts.sip = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Invested', data: investedSeries, borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.12)', fill: true, tension: 0.3, pointRadius: 0 },
        { label: 'Value', data: valueSeries, borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.15)', fill: true, tension: 0.3, pointRadius: 0 },
      ],
    },
    options: ChartTheme.lineOptions(),
  });
}

/* ---------------- Lumpsum ---------------- */

function compoundValue(principal, annualRatePct, years, freq) {
  return principal * Math.pow(1 + annualRatePct / 100 / freq, freq * years);
}

function updateLumpsum() {
  const principal = Number(document.getElementById('lumpAmount').value) || 0;
  const rate = Number(document.getElementById('lumpReturn').value) || 0;
  const years = Number(document.getElementById('lumpYears').value) || 0;
  const freq = Number(document.getElementById('lumpCompound').value) || 1;

  const maturity = compoundValue(principal, rate, years, freq);
  const gain = maturity - principal;

  setText('[data-lump-maturity]', Helpers.formatCurrency(maturity));
  setText('[data-lump-invested]', Helpers.formatCurrency(principal));
  setText('[data-lump-gain]', Helpers.formatCurrency(gain));

  const canvas = document.getElementById('lumpChart');
  if (!isVisible(canvas) || typeof Chart === 'undefined') return;

  const labels = [];
  const valueSeries = [];
  for (let y = 1; y <= Math.max(years, 1); y++) {
    labels.push(`Yr ${y}`);
    valueSeries.push(compoundValue(principal, rate, y, freq));
  }

  if (charts.lump) charts.lump.destroy();
  charts.lump = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Value', data: valueSeries, borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.15)', fill: true, tension: 0.3, pointRadius: 0 },
      ],
    },
    options: ChartTheme.lineOptions(),
  });
}

/* ---------------- Fixed Deposit ---------------- */

function updateFD() {
  const principal = Number(document.getElementById('fdAmount').value) || 0;
  const rate = Number(document.getElementById('fdReturn').value) || 0;
  const years = Number(document.getElementById('fdYears').value) || 0;
  const freq = Number(document.getElementById('fdCompound').value) || 4;

  const maturity = compoundValue(principal, rate, years, freq);
  const interest = maturity - principal;

  setText('[data-fd-maturity]', Helpers.formatCurrency(maturity));
  setText('[data-fd-principal]', Helpers.formatCurrency(principal));
  setText('[data-fd-interest]', Helpers.formatCurrency(interest));

  const canvas = document.getElementById('fdChart');
  if (!isVisible(canvas) || typeof Chart === 'undefined') return;

  const wholeYears = Math.max(Math.ceil(years), 1);
  const labels = [];
  const valueSeries = [];
  for (let y = 1; y <= wholeYears; y++) {
    const t = Math.min(y, years);
    labels.push(`Yr ${y}`);
    valueSeries.push(compoundValue(principal, rate, t, freq));
  }

  if (charts.fd) charts.fd.destroy();
  charts.fd = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Value', data: valueSeries, borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.15)', fill: true, tension: 0.3, pointRadius: 0 },
      ],
    },
    options: ChartTheme.lineOptions(),
  });
}

/* ---------------- Loan EMI ---------------- */

function updateEMI() {
  const principal = Number(document.getElementById('emiAmount').value) || 0;
  const rate = Number(document.getElementById('emiReturn').value) || 0;
  const years = Number(document.getElementById('emiYears').value) || 0;

  const i = rate / 100 / 12;
  const n = years * 12;
  let emi = 0;
  if (n > 0) {
    emi = i === 0 ? principal / n : (principal * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
  }
  const totalPayment = emi * n;
  const totalInterest = totalPayment - principal;

  setText('[data-emi-value]', Helpers.formatCurrency(emi));
  setText('[data-emi-principal]', Helpers.formatCurrency(principal));
  setText('[data-emi-interest]', Helpers.formatCurrency(totalInterest));
  setText('[data-emi-total]', Helpers.formatCurrency(totalPayment));

  const canvas = document.getElementById('emiChart');
  if (!isVisible(canvas) || typeof Chart === 'undefined') return;

  const labels = ['Principal', 'Interest'];
  const values = [principal, Math.max(totalInterest, 0)];
  const palette = ['#60a5fa', '#f87171'];

  if (charts.emi) charts.emi.destroy();
  charts.emi = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: palette, borderWidth: 0 }] },
    options: ChartTheme.doughnutOptions(),
  });

  const legend = document.querySelector('[data-emi-legend]');
  if (legend) {
    legend.innerHTML = labels
      .map((label, i2) => `<span class="legend-item"><span class="legend-swatch" style="background:${palette[i2]}"></span>${label}</span>`)
      .join('');
  }
}

/* ---------------- CAGR ---------------- */

function updateCAGR() {
  const initial = Number(document.getElementById('cagrInitial').value) || 0;
  const final = Number(document.getElementById('cagrFinal').value) || 0;
  const years = Number(document.getElementById('cagrYears').value) || 0;

  let cagr = 0;
  if (initial > 0 && years > 0) {
    cagr = (Math.pow(final / initial, 1 / years) - 1) * 100;
  }

  setText('[data-cagr-value]', `${Number.isFinite(cagr) ? cagr.toFixed(2) : '0.00'}%`);
  setText('[data-cagr-initial]', Helpers.formatCurrency(initial));
  setText('[data-cagr-final]', Helpers.formatCurrency(final));
  setText('[data-cagr-growth]', Helpers.formatCurrency(final - initial));

  const valueEl = document.querySelector('[data-cagr-value]');
  if (valueEl) valueEl.style.color = cagr < 0 ? 'var(--color-negative)' : '';
}

/* ---------------- Emergency Fund ---------------- */

function prefillEmergencyFund() {
  const transactions = typeof Transactions !== 'undefined' ? Transactions.all() : [];
  const avgExpense = averageMonthlyExpense(transactions);
  if (avgExpense !== null) {
    document.getElementById('efExpenses').value = Math.round(avgExpense);
    setText('[data-ef-expense-hint]', 'Prefilled from your average monthly spending in Expenses.');
  }

  const accounts = typeof Accounts !== 'undefined' ? Accounts.all() : [];
  const liquid = accounts.filter((a) => a.type === 'cash' || a.type === 'savings').reduce((sum, a) => sum + a.balance, 0);
  if (liquid > 0) {
    document.getElementById('efSavings').value = Math.round(liquid);
    setText('[data-ef-savings-hint]', 'Prefilled from your Cash & Savings account balances — adjust as needed.');
  }
}

function averageMonthlyExpense(transactions) {
  const byMonth = {};
  transactions
    .filter((t) => t.type === 'expense')
    .forEach((t) => {
      const d = new Date(t.date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      byMonth[key] = (byMonth[key] || 0) + t.amount;
    });
  const months = Object.values(byMonth);
  if (months.length === 0) return null;
  return months.reduce((a, b) => a + b, 0) / months.length;
}

function updateEmergencyFund() {
  const expenses = Number(document.getElementById('efExpenses').value) || 0;
  const months = Number(document.getElementById('efMonths').value) || 0;
  const savings = Number(document.getElementById('efSavings').value) || 0;

  const target = expenses * months;
  const shortfall = Math.max(0, target - savings);
  const percent = target > 0 ? Helpers.clamp((savings / target) * 100, 0, 100) : 0;

  setText('[data-ef-target]', Helpers.formatCurrency(target));
  setText('[data-ef-current]', Helpers.formatCurrency(savings));
  setText('[data-ef-shortfall]', Helpers.formatCurrency(shortfall));
  setText('[data-ef-percent]', `${percent.toFixed(0)}%`);

  const covered = document.querySelector('[data-ef-bar-covered]');
  const remaining = document.querySelector('[data-ef-bar-remaining]');
  if (covered) covered.style.width = `${percent}%`;
  if (remaining) remaining.style.width = `${100 - percent}%`;

  const verdict = document.querySelector('[data-ef-verdict]');
  if (verdict) {
    if (target === 0) {
      verdict.className = 'calc-verdict';
      verdict.textContent = 'Enter your monthly expenses to see your target.';
    } else if (percent >= 100) {
      verdict.className = 'calc-verdict calc-verdict--positive';
      verdict.textContent = `You're fully covered for ${months} month${months === 1 ? '' : 's'} of essential expenses. Nicely done.`;
    } else if (percent >= 50) {
      verdict.className = 'calc-verdict calc-verdict--positive';
      verdict.textContent = `Good progress — you're ${percent.toFixed(0)}% of the way there. ${Helpers.formatCurrency(shortfall)} more to go.`;
    } else {
      verdict.className = 'calc-verdict calc-verdict--negative';
      verdict.textContent = `You're a bit exposed right now. Aim to build this up to ${Helpers.formatCurrency(target)} over time.`;
    }
  }
}

/* ---------------- Helpers ---------------- */

function setText(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}
