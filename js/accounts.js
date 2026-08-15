(function () {
/**
 * accounts.js (page)
 * Powers accounts.html: renders account cards with balance and a
 * toggleable transaction list, handles add/edit/delete, and the
 * transfer-money modal.
 */

const state = { editingId: null, expandedId: null };

document.addEventListener('DOMContentLoaded', () => {
  Modal.bindTriggers();
  bindAccountForm();
  bindTransferForm();
  render();
});

function render() {
  const accounts = Accounts.all();
  renderSummary(accounts);
  renderGrid(accounts);
  populateTransferSelects(accounts);
}

function renderSummary(accounts) {
  const total = accounts.reduce((sum, a) => sum + a.balance, 0);
  setText('[data-total-balance]', Helpers.formatCurrency(total));
  setText('[data-account-count]', accounts.length);
}

function renderGrid(accounts) {
  const grid = document.querySelector('[data-accounts-grid]');
  if (!grid) return;

  if (accounts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i class="fa-solid fa-building-columns"></i>
        No accounts yet. Add one to start tracking balances.
      </div>`;
    return;
  }

  grid.innerHTML = accounts
    .map((a) => {
      const meta = Accounts.typeMeta(a.type);
      const accountTxns = Transactions.all()
        .filter((t) => t.account === a.id)
        .sort((x, y) => new Date(y.date) - new Date(x.date))
        .slice(0, 5);
      const isExpanded = state.expandedId === a.id;

      const txnListHtml = accountTxns.length
        ? accountTxns
            .map((t) => `
              <li class="list-row">
                <div class="list-row__meta">
                  <p class="list-row__title">${escapeHtml(t.title || t.category)}</p>
                  <p class="list-row__sub">${t.category} · ${Helpers.formatShortDate(t.date)}</p>
                </div>
                <span class="list-row__amount num" style="color: ${t.type === 'income' ? 'var(--color-accent)' : 'var(--color-negative)'};">
                  ${t.type === 'income' ? '+' : '-'}${Helpers.formatCurrency(t.amount)}
                </span>
              </li>`)
            .join('')
        : `<li class="empty-state" style="padding: var(--sp-4);">No transactions on this account yet.</li>`;

      return `
        <div class="glass card" data-id="${a.id}">
          <div class="card__header">
            <div style="display:flex; align-items:center; gap: var(--sp-3);">
              <span class="chip ${meta.tone}" style="width:42px;height:42px;"><i class="fa-solid ${meta.icon}"></i></span>
              <div>
                <h3 style="margin:0; font-size: var(--fs-md);">${escapeHtml(a.name)}</h3>
                <span style="font-size: var(--fs-xs); color: var(--color-text-faint);">${meta.label}</span>
              </div>
            </div>
            <div class="row-actions">
              <button data-edit aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
              <button data-delete class="danger" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>

          <div class="stat-card__value num" style="margin: var(--sp-2) 0 var(--sp-4);">${Helpers.formatCurrency(a.balance)}</div>

          <button class="btn btn--ghost" style="width:100%; justify-content:center;" data-toggle-txns>
            <i class="fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}"></i> ${isExpanded ? 'Hide' : 'View'} Transactions
          </button>

          <ul class="row-list" style="margin-top: var(--sp-3); ${isExpanded ? '' : 'display:none;'}">
            ${txnListHtml}
          </ul>
        </div>`;
    })
    .join('');

  grid.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(btn.closest('[data-id]').dataset.id));
  });
  grid.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.closest('[data-id]').dataset.id));
  });
  grid.querySelectorAll('[data-toggle-txns]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('[data-id]').dataset.id;
      state.expandedId = state.expandedId === id ? null : id;
      renderGrid(Accounts.all());
    });
  });
}

/* ---------------- Add / Edit account ---------------- */

function bindAccountForm() {
  const form = document.querySelector('[data-account-form]');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSubmit(form);
  });

  const addBtn = document.querySelector('[data-add-account-btn]');
  if (addBtn) addBtn.addEventListener('click', () => openAddModal());

  const deleteBtn = document.querySelector('[data-account-delete-btn]');
  if (deleteBtn) deleteBtn.addEventListener('click', () => {
    if (state.editingId) handleDelete(state.editingId);
  });
}

function openAddModal() {
  state.editingId = null;
  const form = document.querySelector('[data-account-form]');
  form.reset();
  document.querySelector('#accountModal [data-modal-title]').textContent = 'Add Account';
  document.querySelector('[data-form-balance]').removeAttribute('disabled');
  const deleteBtn = document.querySelector('[data-account-delete-btn]');
  if (deleteBtn) deleteBtn.hidden = true;
  Modal.open('#accountModal');
}

function openEditModal(id) {
  const record = Accounts.get(id);
  if (!record) return;
  state.editingId = id;

  document.querySelector('#accountModal [data-modal-title]').textContent = 'Edit Account';
  document.querySelector('#accountModal [data-form-name]').value = record.name;
  document.querySelector('#accountModal [data-form-type]').value = record.type;
  document.querySelector('[data-form-balance]').value = record.balance;

  const deleteBtn = document.querySelector('[data-account-delete-btn]');
  if (deleteBtn) deleteBtn.hidden = false;

  Modal.open('#accountModal');
}

function handleSubmit(form) {
  const name = form.querySelector('[data-form-name]').value.trim();
  const type = form.querySelector('[data-form-type]').value;
  const balance = parseFloat(form.querySelector('[data-form-balance]').value);

  if (!name || Number.isNaN(balance)) {
    Toast.show('Please fill in a name and a starting balance.', 'error');
    return;
  }

  if (state.editingId) {
    Accounts.update(state.editingId, { name, type, balance });
    Toast.show('Account updated.');
  } else {
    Accounts.add({ name, type, balance });
    Toast.show('Account added.');
  }
  Modal.close('#accountModal');
  render();
  if (window.AssetGroupsView) window.AssetGroupsView.refresh();
}

function handleDelete(id) {
  const record = Accounts.get(id);
  if (!record) return;
  if (!window.confirm(`Delete "${record.name}"? Its transaction history will remain but won't be linked to an account.`)) return;
  Accounts.remove(id);
  Toast.show('Account deleted.', 'info');
  Modal.close('#accountModal');
  render();
  if (window.AssetGroupsView) window.AssetGroupsView.refresh();
}

/* ---------------- Transfer money ---------------- */

function populateTransferSelects(accounts) {
  const from = document.querySelector('[data-transfer-from]');
  const to = document.querySelector('[data-transfer-to]');
  if (!from || !to) return;
  const options = accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)} (${Helpers.formatCurrency(a.balance)})</option>`).join('');
  from.innerHTML = options;
  to.innerHTML = options;
}

function bindTransferForm() {
  const btn = document.querySelector('[data-transfer-btn]');
  if (btn) btn.addEventListener('click', () => Modal.open('#transferModal'));

  const form = document.querySelector('[data-transfer-form]');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fromId = form.querySelector('[data-transfer-from]').value;
    const toId = form.querySelector('[data-transfer-to]').value;
    const amount = parseFloat(form.querySelector('[data-transfer-amount]').value);

    const result = Accounts.transfer(fromId, toId, amount);
    if (!result.ok) {
      Toast.show(result.error, 'error');
      return;
    }
    Modal.close('#transferModal');
    form.reset();
    Toast.show('Transfer complete.');
    render();
    if (window.AssetGroupsView) window.AssetGroupsView.refresh();
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

window.AccountsPageActions = { openEditModal, openAddModal, handleDelete };

})();
