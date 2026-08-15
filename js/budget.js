/**
 * budget.js
 * Powers budget.html. Budgets themselves are just { category, limit } —
 * "spent" is always computed live here from this month's expense
 * transactions, so it can never drift out of sync with the Expense Tracker.
 */

const state = { editingId: null };

document.addEventListener('DOMContentLoaded', () => {
  Modal.bindTriggers();
  bindForm();
  render();
});

function spentThisMonthByCategory(category) {
  const now = new Date();
  return Transactions.byType('expense')
    .filter((t) => {
      const d = new Date(t.date);
      return t.category === category && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((sum, t) => sum + t.amount, 0);
}

function render() {
  const budgets = Budgets.all();
  const rows = budgets.map((b) => ({ ...b, spent: spentThisMonthByCategory(b.category) }));

  renderSummary(rows);
  renderGrid(rows);
  warnIfOverBudget(rows);
}

function renderSummary(rows) {
  const totalLimit = rows.reduce((sum, r) => sum + r.limit, 0);
  const totalSpent = rows.reduce((sum, r) => sum + r.spent, 0);
  const totalRemaining = totalLimit - totalSpent;

  setText('[data-total-budget]', Helpers.formatCurrency(totalLimit));
  setText('[data-total-spent]', Helpers.formatCurrency(totalSpent));
  setText('[data-total-remaining]', Helpers.formatCurrency(totalRemaining));

  const remainingEl = document.querySelector('[data-total-remaining]');
  if (remainingEl) remainingEl.style.color = totalRemaining < 0 ? 'var(--color-negative)' : 'var(--color-text)';
}

function renderGrid(rows) {
  const grid = document.querySelector('[data-budget-grid]');
  if (!grid) return;

  if (rows.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i class="fa-solid fa-scale-balanced"></i>
        No budgets set yet. Add one to start tracking limits per category.
      </div>`;
    return;
  }

  grid.innerHTML = rows
    .map((r) => {
      const meta = Categories.metaFor('expense', r.category);
      const pct = r.limit > 0 ? (r.spent / r.limit) * 100 : 0;
      const remaining = r.limit - r.spent;
      let fillClass = '';
      let badge = `<span class="badge badge--positive">On track</span>`;
      if (pct >= 100) {
        fillClass = 'progress__fill--over';
        badge = `<span class="badge badge--negative">Over budget</span>`;
      } else if (pct >= 80) {
        fillClass = 'progress__fill--warn';
        badge = `<span class="badge badge--gold">Almost there</span>`;
      }

      return `
        <div class="glass card" data-id="${r.id}">
          <div class="card__header">
            <div style="display:flex; align-items:center; gap: var(--sp-3);">
              <span class="chip chip--icon" style="width:38px;height:38px;background:${meta.color};"><i class="fa-solid ${meta.icon}"></i></span>
              <div>
                <h3 style="margin:0; font-size: var(--fs-md);">${Helpers.escapeHtml(r.category)}</h3>
                ${badge}
              </div>
            </div>
            <div class="row-actions">
              <button data-edit aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
              <button data-delete class="danger" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>

          <div class="progress"><div class="progress__fill ${fillClass}" style="width:${Helpers.clamp(pct, 0, 100)}%"></div></div>

          <div style="display:flex; justify-content:space-between; margin-top: var(--sp-3); font-size: var(--fs-sm);">
            <span class="num" style="color: var(--color-text-muted);">${Helpers.formatCurrency(r.spent)} spent</span>
            <span class="num" style="color: var(--color-text-faint);">of ${Helpers.formatCurrency(r.limit)}</span>
          </div>
          <div style="margin-top: 4px; font-size: var(--fs-xs); color: ${remaining < 0 ? 'var(--color-negative)' : 'var(--color-text-faint)'};">
            ${remaining < 0 ? `${Helpers.formatCurrency(Math.abs(remaining))} over limit` : `${Helpers.formatCurrency(remaining)} remaining`}
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
}

function warnIfOverBudget(rows) {
  const over = rows.filter((r) => r.limit > 0 && r.spent > r.limit);
  if (over.length > 0 && !state._warned) {
    Toast.show(`${over.length} categor${over.length === 1 ? 'y is' : 'ies are'} over budget this month.`, 'error');
    state._warned = true;
  }
}

/* ---------------- Add / Edit form ---------------- */

function bindForm() {
  const form = document.querySelector('[data-budget-form]');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSubmit(form);
  });

  const addBtn = document.querySelector('[data-add-budget-btn]');
  if (addBtn) addBtn.addEventListener('click', () => openAddModal());
}

function populateCategorySelect(currentCategory = null) {
  const select = document.querySelector('[data-form-category]');
  if (!select) return;
  const all = Categories.listFor('expense');
  const available = all.filter((c) => !Budgets.hasCategory(c, state.editingId) || c === currentCategory);
  select.innerHTML = available.map((c) => `<option value="${c}">${c}</option>`).join('');
  if (currentCategory) select.value = currentCategory;
  if (window.CategoryPicker) CategoryPicker.enhance(select, 'expense');
}

function openAddModal() {
  state.editingId = null;
  const form = document.querySelector('[data-budget-form]');
  form.reset();
  document.querySelector('[data-modal-title]').textContent = 'Add Budget';
  populateCategorySelect();

  if (document.querySelector('[data-form-category]').options.length === 0) {
    Toast.show('Every category already has a budget. Edit an existing one instead.', 'info');
    return;
  }
  Modal.open('#budgetModal');
}

function openEditModal(id) {
  const record = Budgets.get(id);
  if (!record) return;
  state.editingId = id;

  document.querySelector('[data-modal-title]').textContent = 'Edit Budget';
  populateCategorySelect(record.category);
  document.querySelector('[data-form-limit]').value = record.limit;

  Modal.open('#budgetModal');
}

function handleSubmit(form) {
  const category = form.querySelector('[data-form-category]').value;
  const limit = parseFloat(form.querySelector('[data-form-limit]').value);

  if (!category || !limit || limit <= 0) {
    Toast.show('Please choose a category and a positive limit.', 'error');
    return;
  }

  if (state.editingId) {
    Budgets.update(state.editingId, { category, limit });
    Toast.show('Budget updated.');
  } else {
    Budgets.add({ category, limit });
    Toast.show('Budget added.');
  }
  Modal.close('#budgetModal');
  render();
}

function handleDelete(id) {
  const record = Budgets.get(id);
  if (!record) return;
  if (!window.confirm(`Remove the budget for "${record.category}"?`)) return;
  Budgets.remove(id);
  Toast.show('Budget removed.', 'info');
  render();
}

/* ---------------- Helpers ---------------- */

function setText(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}
