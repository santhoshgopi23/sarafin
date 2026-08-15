(function () {
/**
 * credit-cards.js (page)
 * Powers credit-cards.html: renders each card as a physical-card-styled
 * panel with utilization, due date, and minimum payment, plus add/edit/
 * delete and a "Log Payment" action that reduces the used balance.
 */

const state = { editingId: null, payingId: null };

document.addEventListener('DOMContentLoaded', () => {
  Modal.bindTriggers();
  bindCardForm();
  bindPaymentForm();
  render();
});

function render() {
  const cards = CreditCards.all();
  renderSummary(cards);
  renderGrid(cards);
}

function renderSummary(cards) {
  const totalLimit = cards.reduce((sum, c) => sum + c.limit, 0);
  const totalUsed = cards.reduce((sum, c) => sum + c.used, 0);
  const totalAvailable = totalLimit - totalUsed;
  const overallUtilization = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;

  setText('[data-total-limit]', Helpers.formatCurrency(totalLimit));
  setText('[data-total-used]', Helpers.formatCurrency(totalUsed));
  setText('[data-total-available]', Helpers.formatCurrency(totalAvailable));
  setText('[data-overall-utilization]', `${overallUtilization.toFixed(0)}% utilized`);
}

function renderGrid(cards) {
  const grid = document.querySelector('[data-cards-grid]');
  if (!grid) return;

  if (cards.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i class="fa-solid fa-credit-card"></i>
        No credit cards yet. Add one to track limits and due dates.
      </div>`;
    return;
  }

  grid.innerHTML = cards
    .map((c) => {
      const pct = CreditCards.utilization(c);
      const available = CreditCards.available(c);
      let fillClass = '';
      if (pct >= 90) fillClass = 'progress__fill--over';
      else if (pct >= 60) fillClass = 'progress__fill--warn';

      const due = new Date(c.dueDate);
      const dueLabel = due.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });

      return `
        <div class="glass card credit-card-panel" data-id="${c.id}">
          <div class="credit-card-panel__top">
            <div>
              <span class="card__title" style="display:block;">${escapeHtml(c.name)}</span>
              <span class="stat-card__value num" style="font-size: var(--fs-lg); margin-top:4px;">${Helpers.formatCurrency(c.used)} used</span>
            </div>
            <div class="row-actions">
              <button data-edit aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
              <button data-delete class="danger" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>

          <div class="progress" style="margin: var(--sp-3) 0 6px;">
            <div class="progress__fill ${fillClass}" style="width:${Helpers.clamp(pct, 0, 100)}%"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size: var(--fs-xs); color: var(--color-text-faint); margin-bottom: var(--sp-4);">
            <span>${pct.toFixed(0)}% utilization</span>
            <span class="num">${Helpers.formatCurrency(available)} available of ${Helpers.formatCurrency(c.limit)}</span>
          </div>

          <div class="hero-balance__row" style="margin-top:0; padding-top: var(--sp-3);">
            <div class="hero-balance__mini">
              <span class="hero-balance__mini-label">Payment due</span>
              <span class="hero-balance__mini-value" style="font-size: var(--fs-sm);">${dueLabel}</span>
            </div>
            <div class="hero-balance__mini">
              <span class="hero-balance__mini-label">Minimum payment</span>
              <span class="hero-balance__mini-value num" style="font-size: var(--fs-sm);">${Helpers.formatCurrency(c.minPayment)}</span>
            </div>
          </div>

          <button class="btn btn--primary" style="width:100%; justify-content:center; margin-top: var(--sp-4);" data-log-payment>
            <i class="fa-solid fa-money-check-dollar"></i> Log Payment
          </button>
        </div>`;
    })
    .join('');

  grid.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(btn.closest('[data-id]').dataset.id));
  });
  grid.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.closest('[data-id]').dataset.id));
  });
  grid.querySelectorAll('[data-log-payment]').forEach((btn) => {
    btn.addEventListener('click', () => openPaymentModal(btn.closest('[data-id]').dataset.id));
  });
}

/* ---------------- Add / Edit ---------------- */

function bindCardForm() {
  const form = document.querySelector('[data-card-form]');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSubmit(form);
  });

  const addBtn = document.querySelector('[data-add-card-btn]');
  if (addBtn) addBtn.addEventListener('click', () => openAddModal());
}

function openAddModal() {
  state.editingId = null;
  const form = document.querySelector('[data-card-form]');
  form.reset();
  document.querySelector('#cardModal [data-modal-title]').textContent = 'Add Credit Card';
  Modal.open('#cardModal');
}

function openEditModal(id) {
  const record = CreditCards.get(id);
  if (!record) return;
  state.editingId = id;

  document.querySelector('#cardModal [data-modal-title]').textContent = 'Edit Credit Card';
  document.querySelector('#cardModal [data-form-name]').value = record.name;
  document.querySelector('[data-form-limit]').value = record.limit;
  document.querySelector('[data-form-used]').value = record.used;
  document.querySelector('#cardModal [data-form-duedate]').value = record.dueDate;
  document.querySelector('[data-form-minpayment]').value = record.minPayment;

  Modal.open('#cardModal');
}

function handleSubmit(form) {
  const name = form.querySelector('[data-form-name]').value.trim();
  const limit = parseFloat(form.querySelector('[data-form-limit]').value);
  const used = parseFloat(form.querySelector('[data-form-used]').value) || 0;
  const dueDate = form.querySelector('[data-form-duedate]').value;
  const minPayment = parseFloat(form.querySelector('[data-form-minpayment]').value) || 0;

  if (!name || !limit || limit <= 0 || !dueDate) {
    Toast.show('Please fill in a name, a positive limit, and a due date.', 'error');
    return;
  }

  const payload = { name, limit, used, dueDate, minPayment };
  if (state.editingId) {
    CreditCards.update(state.editingId, payload);
    Toast.show('Card updated.');
  } else {
    CreditCards.add(payload);
    Toast.show('Card added.');
  }
  Modal.close('#cardModal');
  render();
}

function handleDelete(id) {
  const record = CreditCards.get(id);
  if (!record) return;
  if (!window.confirm(`Remove "${record.name}"?`)) return;
  CreditCards.remove(id);
  Toast.show('Card removed.', 'info');
  render();
}

/* ---------------- Log payment ---------------- */

function bindPaymentForm() {
  const form = document.querySelector('[data-payment-form]');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseFloat(form.querySelector('[data-payment-amount]').value);
    const record = CreditCards.get(state.payingId);
    if (!record) return;

    if (!amount || amount <= 0) {
      Toast.show('Enter a positive payment amount.', 'error');
      return;
    }
    const newUsed = Math.max(0, record.used - amount);
    CreditCards.update(state.payingId, { used: newUsed });
    Modal.close('#paymentModal');
    form.reset();
    Toast.show('Payment logged.');
    render();
  });
}

function openPaymentModal(id) {
  const record = CreditCards.get(id);
  if (!record) return;
  state.payingId = id;
  document.querySelector('[data-payment-card-name]').textContent = record.name;
  document.querySelector('[data-payment-form]').reset();
  Modal.open('#paymentModal');
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

})();
