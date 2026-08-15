/**
 * allocation.js
 * Powers allocation.html:
 *   1. "Your Target Allocation Plan" — an editable % for each investment
 *      type (Stocks, ETF, Mutual Funds, Gold, Crypto, FD, CPF, EPF,
 *      Foreign Investment), saved to Storage under ALLOCATION_TARGETS.
 *   2. "Current Allocation" — a doughnut chart + legend built from real
 *      holdings (assets/js/utils/investments.js), grouped by type.
 *   3. "Target vs Actual" — for every type you hold or have a target for,
 *      shows the gap between target% and actual%, and tells you whether
 *      to Add money or Reduce/take money out to get back on plan.
 *
 * The chart/table/banner always reflect the last *saved* target so the
 * flow matches "set your plan → see the chart → get suggestions" instead
 * of suggestions shifting under you while you're still typing.
 */

const ALLOC_TYPES = Object.keys(window.InvestmentTypeMeta || {});
const ALLOC_REBALANCE_THRESHOLD = 5;  // percentage points — banner "needs rebalancing" count
const ALLOC_ON_TRACK_THRESHOLD = 2;   // percentage points — table "On track" label

const allocState = {
  draftTargets: {}, // what's currently in the input boxes (unsaved)
};

document.addEventListener('DOMContentLoaded', () => {
  allocState.draftTargets = { ...loadSavedTargets() };
  renderTargetForm();
  bindTargetFormActions();
  bindTargetModal();
  Modal.bindTriggers();
  renderAll();
});

/* ---------------- Storage ---------------- */

function loadSavedTargets() {
  return window.Storage.get(window.STORAGE_KEYS.ALLOCATION_TARGETS, {});
}

function saveTargets(targets) {
  window.Storage.set(window.STORAGE_KEYS.ALLOCATION_TARGETS, targets);
}

/* ---------------- Target allocation form (the "ask") ---------------- */

function renderTargetForm() {
  const wrap = document.querySelector('[data-alloc-target-form]');
  if (!wrap) return;

  wrap.innerHTML = ALLOC_TYPES.map((type) => {
    const meta = window.InvestmentTypeMeta[type];
    const val = allocState.draftTargets[type] || 0;
    return `
      <div class="alloc-target-row" data-type="${escapeHtml(type)}">
        <span class="alloc-target-row__icon chip ${meta.tone}"><i class="fa-solid ${meta.icon}"></i></span>
        <span class="alloc-target-row__label">${escapeHtml(type)}</span>
        <div class="alloc-target-row__input-wrap">
          <input type="number" min="0" max="100" step="0.5" value="${val || ''}" placeholder="0" data-alloc-input aria-label="Target percent for ${escapeHtml(type)}" />
          <span>%</span>
        </div>
      </div>`;
  }).join('');

  wrap.querySelectorAll('[data-alloc-input]').forEach((input) => {
    // Keep each field's own ceiling in sync with what's left of the 100%
    // budget, so the browser's own up/down controls can't overshoot either.
    const type = input.closest('[data-type]').dataset.type;
    const othersSum = ALLOC_TYPES.filter((t) => t !== type).reduce((s, t) => s + (allocState.draftTargets[t] || 0), 0);
    input.max = Math.max(0, Math.round((100 - othersSum) * 10) / 10);

    input.addEventListener('input', () => {
      const num = parseFloat(input.value);
      const othersSum = ALLOC_TYPES.filter((t) => t !== type).reduce((s, t) => s + (allocState.draftTargets[t] || 0), 0);
      const remaining = Math.max(0, Math.round((100 - othersSum) * 10) / 10);
      const clamped = isNaN(num) ? 0 : Math.max(0, Math.min(remaining, num));

      allocState.draftTargets[type] = clamped;
      if (clamped !== num) input.value = clamped || '';

      // Every other field's ceiling shrinks/grows as this one changes.
      wrap.querySelectorAll('[data-alloc-input]').forEach((otherInput) => {
        const otherType = otherInput.closest('[data-type]').dataset.type;
        if (otherType === type) return;
        const sumExcludingOther = ALLOC_TYPES.filter((t) => t !== otherType).reduce((s, t) => s + (allocState.draftTargets[t] || 0), 0);
        otherInput.max = Math.max(0, Math.round((100 - sumExcludingOther) * 10) / 10);
      });

      updateTargetTotal();
    });
  });

  updateTargetTotal();
}

function updateTargetTotal() {
  const el = document.querySelector('[data-alloc-target-total]');
  if (!el) return;
  const total = ALLOC_TYPES.reduce((sum, t) => sum + (allocState.draftTargets[t] || 0), 0);
  const rounded = Math.round(total * 10) / 10;
  el.textContent = `${rounded}%`;
  el.classList.toggle('is-balanced', Math.abs(total - 100) < 0.5);
  el.classList.toggle('is-off', Math.abs(total - 100) >= 0.5 && total > 0);

  const remainingEl = document.querySelector('[data-alloc-target-remaining]');
  if (remainingEl) {
    const remaining = Math.max(0, Math.round((100 - total) * 10) / 10);
    remainingEl.textContent = total > 100 ? '0% left' : `${remaining}% left`;
  }
}

function bindTargetModal() {
  // Nothing extra to wire — Modal.bindTriggers() handles open/close via
  // [data-modal-open]/[data-modal-close], and the form already reflects
  // allocState.draftTargets whenever it's rendered.
}

/* ---------------- Compact summary (shown on the page instead of the full form) ---------------- */

function renderTargetSummary(savedTargets) {
  const el = document.querySelector('[data-alloc-target-summary]');
  if (!el) return;

  const types = ALLOC_TYPES.filter((t) => (savedTargets[t] || 0) > 0);

  if (types.length === 0) {
    el.innerHTML = `<p style="color: var(--color-text-faint); margin: var(--sp-2) 0 0;">No target set yet — click "Edit Target Allocation" to plan your split.</p>`;
    return;
  }

  el.innerHTML = `
    <div style="display:flex; flex-wrap:wrap; gap: var(--sp-2); margin-top: var(--sp-2);">
      ${types
        .map((t) => {
          const meta = window.InvestmentTypeMeta[t];
          return `<span class="chip ${meta.tone}" style="font-weight:600;">
            <i class="fa-solid ${meta.icon}"></i> ${escapeHtml(t)} · ${(savedTargets[t] || 0).toFixed(1)}%
          </span>`;
        })
        .join('')}
    </div>`;
}

function bindTargetFormActions() {
  const saveBtn = document.querySelector('[data-alloc-save]');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const total = ALLOC_TYPES.reduce((sum, t) => sum + (allocState.draftTargets[t] || 0), 0);
      if (total === 0) {
        Toast.show('Set at least one category before saving.', 'error');
        return;
      }
      if (Math.abs(total - 100) >= 0.5) {
        Toast.show(`Your target should add up to 100% — it's currently ${Math.round(total * 10) / 10}%.`, 'error');
        return;
      }
      saveTargets(allocState.draftTargets);
      Toast.show('Target allocation saved.');
      Modal.close('#targetAllocModal');
      renderAll();
    });
  }

  const resetBtn = document.querySelector('[data-alloc-reset]');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      allocState.draftTargets = { ...loadSavedTargets() };
      renderTargetForm();
      Toast.show('Reverted to your last saved allocation.', 'info');
    });
  }
}

/* ---------------- Shared data ---------------- */

function currentValueByType(holdings) {
  const map = {};
  holdings.forEach((h) => {
    map[h.type] = (map[h.type] || 0) + (h.value || 0);
  });
  return map;
}

function hasAnyTarget(targets) {
  return ALLOC_TYPES.some((t) => (targets[t] || 0) > 0);
}

/* ---------------- Orchestrator ---------------- */

function renderAll() {
  const holdings = window.Investments ? window.Investments.all() : [];
  const byType = currentValueByType(holdings);
  const totalValue = Object.values(byType).reduce((s, v) => s + v, 0);
  const savedTargets = loadSavedTargets();

  renderBanner({ holdings, byType, totalValue, savedTargets });
  renderTargetSummary(savedTargets);
  renderCurrentAllocation({ byType, totalValue });
  renderRebalanceTable({ byType, totalValue, savedTargets });
}

/* ---------------- Banner ---------------- */

function renderBanner({ holdings, byType, totalValue, savedTargets }) {
  const el = document.querySelector('[data-alloc-banner]');
  if (!el) return;

  if (holdings.length === 0) {
    el.innerHTML = `
      <div class="alloc-banner alloc-banner--info">
        <i class="fa-solid fa-circle-info"></i>
        <span>You don't have any investments logged yet. <a href="accounts.html" style="color:inherit; text-decoration:underline;">Add some on the Assets page</a>, then come back to plan your allocation.</span>
      </div>`;
    return;
  }

  if (!hasAnyTarget(savedTargets)) {
    el.innerHTML = `
      <div class="alloc-banner alloc-banner--info">
        <i class="fa-solid fa-circle-info"></i>
        <span>Set your target allocation below to get personalized rebalancing suggestions.</span>
      </div>`;
    return;
  }

  const visibleTypes = ALLOC_TYPES.filter((t) => (byType[t] || 0) > 0 || (savedTargets[t] || 0) > 0);
  const offCount = visibleTypes.filter((t) => {
    const actualPct = totalValue > 0 ? ((byType[t] || 0) / totalValue) * 100 : 0;
    const targetPct = savedTargets[t] || 0;
    return Math.abs(actualPct - targetPct) > ALLOC_REBALANCE_THRESHOLD;
  }).length;

  if (offCount > 0) {
    el.innerHTML = `
      <div class="alloc-banner alloc-banner--warning">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>Needs rebalancing — ${offCount} categor${offCount === 1 ? 'y is' : 'ies are'} off by more than ${ALLOC_REBALANCE_THRESHOLD}%</span>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="alloc-banner alloc-banner--ok">
        <i class="fa-solid fa-circle-check"></i>
        <span>Your portfolio is within ${ALLOC_REBALANCE_THRESHOLD}% of target across every category. Nice and balanced.</span>
      </div>`;
  }
}

/* ---------------- Current allocation (donut + legend) ---------------- */

let currentAllocChart = null;

function renderCurrentAllocation({ byType, totalValue }) {
  const body = document.querySelector('[data-alloc-current-body]');
  if (!body) return;

  const types = ALLOC_TYPES.filter((t) => (byType[t] || 0) > 0);

  if (types.length === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-chart-pie"></i>
        No holdings yet — add investments to see your current allocation here.
      </div>`;
    if (currentAllocChart) { currentAllocChart.destroy(); currentAllocChart = null; }
    return;
  }

  body.innerHTML = `
    <div style="display:flex; gap: var(--sp-5); align-items:center; flex-wrap:wrap;">
      <div class="alloc-donut-wrap" style="flex:0 0 220px; width:220px;">
        <canvas id="allocCurrentChart"></canvas>
        <div class="alloc-donut-center">
          <div class="alloc-donut-center__value">${Helpers.formatCurrency(totalValue)}</div>
          <div class="alloc-donut-center__label">Total</div>
        </div>
      </div>
      <div class="alloc-legend" style="flex:1; min-width:220px;" data-alloc-legend></div>
    </div>`;

  const canvas = document.getElementById('allocCurrentChart');
  const values = types.map((t) => byType[t]);

  if (canvas && typeof Chart !== 'undefined') {
    ChartTheme.applyDefaults();
    if (currentAllocChart) currentAllocChart.destroy();
    currentAllocChart = new Chart(canvas, {
      type: 'doughnut',
      data: { labels: types, datasets: [{ data: values, backgroundColor: ChartTheme.palette, borderWidth: 0 }] },
      options: ChartTheme.doughnutOptions(),
    });
  }

  const legend = document.querySelector('[data-alloc-legend]');
  if (legend) {
    legend.innerHTML = types
      .map((t, i) => {
        const val = byType[t];
        const pct = totalValue > 0 ? ((val / totalValue) * 100).toFixed(1) : '0.0';
        return `
          <div class="alloc-legend__row">
            <span class="alloc-legend__dot" style="background:${ChartTheme.palette[i % ChartTheme.palette.length]};"></span>
            <span class="alloc-legend__label">${escapeHtml(t)}</span>
            <span class="alloc-legend__pct">${pct}%</span>
            <span class="alloc-legend__amt">${Helpers.formatCurrency(val)}</span>
          </div>`;
      })
      .join('');
  }
}

/* ---------------- Target vs Actual table ---------------- */

function renderRebalanceTable({ byType, totalValue, savedTargets }) {
  const tbody = document.querySelector('[data-alloc-table-body]');
  if (!tbody) return;

  const types = ALLOC_TYPES.filter((t) => (byType[t] || 0) > 0 || (savedTargets[t] || 0) > 0);
  const targetsSet = hasAnyTarget(savedTargets);

  if (types.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Add investments and set a target allocation to see this comparison.</td></tr>`;
    return;
  }

  tbody.innerHTML = types
    .map((t) => {
      const meta = window.InvestmentTypeMeta[t];
      const curVal = byType[t] || 0;
      const actualPct = totalValue > 0 ? (curVal / totalValue) * 100 : 0;
      const targetPct = savedTargets[t] || 0;
      const tgtVal = (totalValue * targetPct) / 100;
      const gap = actualPct - targetPct;
      const gapAbs = Math.abs(gap);

      let gapTone = 'tone-accent';
      if (gapAbs >= 20) gapTone = 'tone-negative';
      else if (gapAbs >= ALLOC_REBALANCE_THRESHOLD) gapTone = 'tone-gold';

      let action;
      if (!targetsSet) {
        action = `<span style="color: var(--color-text-faint);">Set a target above</span>`;
      } else if (gapAbs <= ALLOC_ON_TRACK_THRESHOLD) {
        action = `<span style="color: var(--color-profit); font-weight:600;"><i class="fa-solid fa-circle-check"></i> On track</span>`;
      } else if (gap < 0) {
        action = `<span style="color: var(--color-info); font-weight:600;">Add ${Helpers.formatCurrency(Math.abs(tgtVal - curVal))}</span>`;
      } else {
        action = `<span style="color: var(--color-gold); font-weight:600;">Reduce ${Helpers.formatCurrency(Math.abs(tgtVal - curVal))}</span>`;
      }

      return `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap: var(--sp-2);">
              <span class="chip ${meta.tone}" style="width:28px; height:28px;"><i class="fa-solid ${meta.icon}"></i></span>
              <span style="font-weight:600;">${escapeHtml(t)}</span>
            </div>
          </td>
          <td class="text-right">${actualPct.toFixed(1)}%</td>
          <td class="text-right">${Helpers.formatCurrency(curVal)}</td>
          <td class="text-right">${targetsSet ? `${targetPct.toFixed(1)}%` : '—'}</td>
          <td class="text-right">${targetsSet ? Helpers.formatCurrency(tgtVal) : '—'}</td>
          <td class="text-right"><span class="chip ${targetsSet ? gapTone : ''}" style="font-family: var(--font-mono);">${targetsSet ? `${gap >= 0 ? '+' : ''}${gap.toFixed(1)}%` : '—'}</span></td>
          <td class="text-right">${action}</td>
        </tr>`;
    })
    .join('');
}

/* ---------------- Helpers ---------------- */

function escapeHtml(str) {
  // Delegates to the single shared implementation in helpers.js.
  return Helpers.escapeHtml(str);
}
