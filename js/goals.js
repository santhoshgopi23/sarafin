/**
 * goals.js (page)
 * Powers goals.html: renders goal cards with an SVG progress ring (progress
 * measured against the inflation-adjusted target), handles add/edit/delete,
 * a per-goal "Add Entry" modal (amount + date + where), and a "History"
 * modal listing every entry ever logged against a goal.
 */

const state = { editingId: null, entryGoalId: null, historyGoalId: null };
const CIRCLE_RADIUS = 50;
const CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

document.addEventListener('DOMContentLoaded', () => {
  Modal.bindTriggers();
  bindGoalForm();
  bindEntryForm();
  bindTargetPreview();
  render();
});

function render() {
  const goals = Goals.all();
  renderSummary(goals);
  renderGrid(goals);
}

function renderSummary(goals) {
  const totalTarget = goals.reduce((sum, g) => sum + g.target, 0);
  const totalSaved = goals.reduce((sum, g) => sum + g.saved, 0);
  const monthlyNeeded = goals.reduce((sum, g) => sum + Goals.monthlyNeeded(g), 0);
  const achieved = goals.filter((g) => g.saved >= g.target && g.target > 0).length;

  setText('[data-total-target]', Helpers.formatCurrency(totalTarget));
  setText('[data-total-saved]', Helpers.formatCurrency(totalSaved));
  setText('[data-monthly-needed]', Helpers.formatCurrency(monthlyNeeded));
  setText('[data-goals-achieved]', `${achieved} of ${goals.length}`);
}

function renderGrid(goals) {
  const grid = document.querySelector('[data-goals-grid]');
  if (!grid) return;

  if (goals.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i class="fa-solid fa-bullseye"></i>
        No savings goals yet. Create one to start tracking progress.
      </div>`;
    return;
  }

  grid.innerHTML = goals
    .map((g) => {
      const pct = g.target > 0 ? Helpers.clamp((g.saved / g.target) * 100, 0, 100) : 0;
      const offset = CIRCUMFERENCE * (1 - pct / 100);
      const remaining = Math.max(0, g.target - g.saved);
      const achieved = g.saved >= g.target && g.target > 0;
      const daysLeft = Math.ceil((new Date(g.targetDate) - new Date()) / (1000 * 60 * 60 * 24));
      const dateLabel = daysLeft >= 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'Target date passed';
      const ringColor = achieved ? '#fbbf24' : '#34d399';
      const monthly = Goals.monthlyNeeded(g);
      const entryCount = (g.entries || []).length;
      const avgReturn = Goals.avgReturnRate(g);

      return `
        <div class="glass card goal-card" data-id="${g.id}">
          <div class="row-actions" style="justify-content:flex-end; margin-bottom: var(--sp-2);">
            <button data-edit aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
            <button data-delete class="danger" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
          </div>

          <div class="goal-card__ring-wrap">
            <svg viewBox="0 0 120 120" class="goal-card__ring">
              <circle cx="60" cy="60" r="${CIRCLE_RADIUS}" class="goal-card__ring-track" />
              <circle cx="60" cy="60" r="${CIRCLE_RADIUS}" class="goal-card__ring-fill"
                stroke="${ringColor}"
                stroke-dasharray="${CIRCUMFERENCE}"
                stroke-dashoffset="${offset}" />
            </svg>
            <div class="goal-card__ring-center">
              <span class="goal-card__pct">${Math.round(pct)}%</span>
              ${achieved ? '<span class="badge badge--gold" style="margin-top:4px;"><i class="fa-solid fa-trophy"></i> Achieved</span>' : ''}
            </div>
          </div>

          <h3 style="text-align:center; margin: var(--sp-3) 0 2px;">${escapeHtml(g.name)}</h3>
          <p style="text-align:center; font-size: var(--fs-xs); color: var(--color-text-faint); margin-bottom: var(--sp-3);">${dateLabel} &middot; ${g.inflationRate || 0}%/yr inflation${avgReturn > 0 ? ` &middot; ${avgReturn.toFixed(1)}%/yr return` : ''}</p>

          <div style="display:flex; justify-content:space-between; font-size: var(--fs-sm); margin-bottom: var(--sp-1);">
            <span class="num" style="color: var(--color-accent);">${Helpers.formatCurrency(g.saved)} saved</span>
            <span class="num" style="color: var(--color-text-faint);">of ${Helpers.formatCurrency(g.target)}</span>
          </div>
          <div class="progress" style="margin-bottom: var(--sp-2);">
            <div class="progress__fill" style="width:${pct}%; background:${achieved ? 'var(--gradient-gold)' : 'var(--gradient-accent)'};"></div>
          </div>

          <div class="goal-card__meta-row" style="margin-bottom: var(--sp-3);">
            <span>Today's cost: ${Helpers.formatCurrency(g.presentValue)}</span>
            ${!achieved ? `<span>${Helpers.formatCurrency(monthly)}/mo needed</span>` : ''}
          </div>

          ${achieved
            ? `<span class="badge badge--gold" style="width:100%; justify-content:center; padding:10px; margin-bottom: var(--sp-3);"><i class="fa-solid fa-champagne-glasses"></i> Goal complete!</span>`
            : `<div class="goal-card__meta-row" style="margin-bottom: var(--sp-1);"><span></span><span>${Helpers.formatCurrency(remaining)} to go</span></div>`
          }

          <div class="goal-card__actions">
            <button class="btn btn--primary" data-add-entry><i class="fa-solid fa-plus"></i> Add Entry</button>
            <button class="btn btn--ghost" data-history><i class="fa-solid fa-clock-rotate-left"></i> History (${entryCount})</button>
          </div>
        </div>`;
    })
    .join('');

  grid.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(btn.closest('[data-id]').dataset.id));
  });
  grid.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.closest('[data-id]').dataset.id));
  });
  grid.querySelectorAll('[data-add-entry]').forEach((btn) => {
    btn.addEventListener('click', () => openEntryModal(btn.closest('[data-id]').dataset.id));
  });
  grid.querySelectorAll('[data-history]').forEach((btn) => {
    btn.addEventListener('click', () => openHistoryModal(btn.closest('[data-id]').dataset.id));
  });
}

/* ---------------- Add / Edit goal ---------------- */

function bindGoalForm() {
  const form = document.querySelector('[data-goal-form]');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSubmit(form);
  });

  const addBtn = document.querySelector('[data-add-goal-btn]');
  if (addBtn) addBtn.addEventListener('click', () => openAddModal());
}

/** Live-updates the "future target" preview line as the user types present value / date / inflation. */
function bindTargetPreview() {
  const inputs = ['[data-form-present-value]', '[data-form-date]', '[data-form-inflation]'];
  inputs.forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.addEventListener('input', updateTargetPreview);
  });
}

function updateTargetPreview() {
  const preview = document.querySelector('[data-target-preview]');
  if (!preview) return;

  const presentValue = parseFloat(document.querySelector('[data-form-present-value]').value);
  const targetDate = document.querySelector('[data-form-date]').value;
  const inflation = parseFloat(document.querySelector('[data-form-inflation]').value) || 0;

  if (!presentValue || !targetDate) {
    preview.textContent = '';
    return;
  }

  const years = Goals.yearsUntil(targetDate);
  const future = Goals.inflateAmount(presentValue, inflation, years);
  preview.textContent = `≈ ${Helpers.formatCurrency(future)} needed by target date (adjusted for ${inflation}%/yr inflation over ${years.toFixed(1)} yrs)`;
}

function openAddModal() {
  state.editingId = null;
  const form = document.querySelector('[data-goal-form]');
  form.reset();
  document.querySelector('[data-modal-title]').textContent = 'New Savings Goal';
  document.querySelector('[data-form-initial-date]').value = new Date().toISOString().slice(0, 10);
  toggleInitialAmountFields(true);
  document.querySelector('[data-target-preview]').textContent = '';
  Modal.open('#goalModal');
}

function openEditModal(id) {
  const record = Goals.get(id);
  if (!record) return;
  state.editingId = id;

  document.querySelector('[data-modal-title]').textContent = 'Edit Goal';
  document.querySelector('[data-form-name]').value = record.name;
  document.querySelector('[data-form-present-value]').value = record.presentValue;
  document.querySelector('[data-form-date]').value = record.targetDate;
  document.querySelector('[data-form-inflation]').value = record.inflationRate;
  toggleInitialAmountFields(false);
  updateTargetPreview();

  Modal.open('#goalModal');
}

/** Initial-amount fields only make sense when creating a brand-new goal. */
function toggleInitialAmountFields(show) {
  const rows = [
    document.querySelector('[data-initial-amount-row]'),
    document.querySelector('[data-initial-where-row]'),
  ];
  rows.forEach((row) => {
    if (row) row.style.display = show ? '' : 'none';
  });
}

function handleSubmit(form) {
  const name = form.querySelector('[data-form-name]').value.trim();
  const presentValue = parseFloat(form.querySelector('[data-form-present-value]').value);
  const targetDate = form.querySelector('[data-form-date]').value;
  const inflationRate = parseFloat(form.querySelector('[data-form-inflation]').value) || 0;

  if (!name || !presentValue || presentValue <= 0 || !targetDate) {
    Toast.show('Please fill in a goal name, a positive amount, and a target date.', 'error');
    return;
  }

  if (state.editingId) {
    Goals.update(state.editingId, { name, presentValue, targetDate, inflationRate });
    Toast.show('Goal updated.');
  } else {
    const initialAmount = parseFloat(form.querySelector('[data-form-initial-amount]').value) || 0;
    const initialDate = form.querySelector('[data-form-initial-date]').value;
    const initialWhere = form.querySelector('[data-form-initial-where]').value.trim();
    const initialReturnRate = parseFloat(form.querySelector('[data-form-initial-return-rate]').value) || 0;

    if (initialAmount > 0 && !initialWhere) {
      Toast.show('Please say where the initial amount is saved.', 'error');
      return;
    }

    Goals.add({ name, presentValue, targetDate, inflationRate, initialAmount, initialDate, initialWhere, initialReturnRate });
    Toast.show('Goal created.');
  }
  Modal.close('#goalModal');
  render();
}

function handleDelete(id) {
  const record = Goals.get(id);
  if (!record) return;
  if (!window.confirm(`Delete the "${record.name}" goal? This can't be undone.`)) return;
  Goals.remove(id);
  Toast.show('Goal deleted.', 'info');
  render();
}

/* ---------------- Add Entry ---------------- */

function bindEntryForm() {
  const form = document.querySelector('[data-entry-form]');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const amount = parseFloat(form.querySelector('[data-entry-amount]').value);
    const date = form.querySelector('[data-entry-date]').value;
    const where = form.querySelector('[data-entry-where]').value.trim();
    const returnRate = parseFloat(form.querySelector('[data-entry-return-rate]').value) || 0;

    if (!amount || amount <= 0 || !date || !where) {
      Toast.show('Please fill in an amount, date, and where it was saved.', 'error');
      return;
    }

    const updated = Goals.addEntry(state.entryGoalId, { amount, date, where, returnRate });
    Modal.close('#entryModal');
    form.reset();
    if (updated && updated.saved >= updated.target) {
      Toast.show(`🎉 "${updated.name}" goal achieved!`, 'success');
    } else {
      Toast.show('Entry added.');
    }
    render();
  });
}

function openEntryModal(id) {
  const record = Goals.get(id);
  if (!record) return;
  state.entryGoalId = id;
  document.querySelector('[data-entry-goal-name]').textContent = record.name;
  const form = document.querySelector('[data-entry-form]');
  form.reset();
  form.querySelector('[data-entry-date]').value = new Date().toISOString().slice(0, 10);
  Modal.open('#entryModal');
}

/* ---------------- History ---------------- */

function openHistoryModal(id) {
  const record = Goals.get(id);
  if (!record) return;
  state.historyGoalId = id;
  document.querySelector('[data-history-goal-name]').textContent = record.name;
  renderHistoryList(record);
  Modal.open('#historyModal');
}

function renderHistoryList(record) {
  const list = document.querySelector('[data-history-list]');
  if (!list) return;

  const entries = [...(record.entries || [])].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (entries.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-clock-rotate-left"></i>
        No entries yet. Add funds to start a history.
      </div>`;
    return;
  }

  list.innerHTML = entries
    .map(
      (e) => `
        <div class="history-row" data-entry-id="${e.id}">
          <div class="history-row__meta">
            <p class="history-row__where">${escapeHtml(e.where || 'Unspecified')}${e.returnRate ? ` <span style="color: var(--color-profit); font-weight:600;">&middot; ${e.returnRate}%/yr</span>` : ''}</p>
            <p class="history-row__date">${Helpers.formatShortDate(e.date)}${e.note ? ' &middot; ' + escapeHtml(e.note) : ''}</p>
          </div>
          <span class="history-row__amount">+${Helpers.formatCurrency(e.amount)}</span>
          <button class="btn--icon danger" data-remove-entry aria-label="Remove entry"><i class="fa-solid fa-trash"></i></button>
        </div>`
    )
    .join('');

  list.querySelectorAll('[data-remove-entry]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('[data-entry-id]');
      const entryId = row.dataset.entryId;
      if (!window.confirm('Remove this entry from the history?')) return;
      const updated = Goals.removeEntry(state.historyGoalId, entryId);
      if (updated) {
        renderHistoryList(updated);
        render();
      }
    });
  });
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
