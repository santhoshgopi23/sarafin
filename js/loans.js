(function () {
/**
 * loans.js (page)
 * Powers loans.html: two tabs — "Loans (Borrowed)" and "Money Lent" —
 * sharing one CRUD modal (direction is set by which tab's Add button was
 * clicked), a "Log Payment" modal for recording a payment made (borrowed)
 * or a repayment received (lent), and a full-page Loan Detail view with
 * payment history, an Add Log shortcut, and a per-loan export.
 *
 * Currency: loans can be entered in INR (no conversion), SGD, or USD.
 * Foreign-currency amounts are converted to rupees at save time using a
 * rate the user is asked for once and which is then remembered (same
 * pattern as the SGD toggle on the Income/Expense forms) — everything
 * everywhere else in the app (cards, totals, exports) always shows the
 * rupee value.
 *
 * Closed loans (remainingBalance reaches 0) are never deleted — they move
 * into a separate "Closed Loans" section and stay clickable to show their
 * full start-to-close history.
 */

const state = { tab: 'borrowed', editingId: null, payingId: null, paymentCurrency: 'INR', selectedLoanType: null, currency: 'INR', closedExpanded: false, detailId: null };

/** Loan types offered in step 1 of "Add Loan" — borrowed loans only. Purely descriptive metadata (icon + label) stored on the record as `type`; doesn't change how balances/payments work. */
const LoanTypes = [
  { label: 'Home Loan', icon: 'fa-house' },
  { label: 'Vehicle Loan', icon: 'fa-car' },
  { label: 'Personal Loan', icon: 'fa-user' },
  { label: 'Education Loan', icon: 'fa-graduation-cap' },
  { label: 'Credit Card', icon: 'fa-credit-card' },
  { label: 'Gold Loan', icon: 'fa-coins' },
  { label: 'Business Loan', icon: 'fa-briefcase' },
  { label: 'Friends / Family', icon: 'fa-users' },
  { label: 'Other', icon: 'fa-ellipsis' },
  { label: 'Moi', icon: 'fa-hand-holding-heart', isMoiHandoff: true },
];

document.addEventListener('DOMContentLoaded', () => {
  Modal.bindTriggers();
  bindTabs();
  bindLoanForm();
  bindPaymentForm();
  bindClosedToggle();
  bindDetailActions();
  bindExport();
  render();
});

function bindTabs() {
  document.querySelectorAll('[data-loan-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = btn.getAttribute('data-loan-tab');
      document.querySelectorAll('[data-loan-tab]').forEach((b) => b.classList.remove('is-active-tab'));
      btn.classList.add('is-active-tab');
      document.querySelector('[data-add-loan-btn]').textContent = state.tab === 'borrowed' ? 'Add Loan' : 'Add Money Lent';
      render();
    });
  });
}

function render() {
  const all = Loans.byDirection(state.tab);
  const active = all.filter((l) => !Loans.isPaidOff(l));
  const closed = all.filter((l) => Loans.isPaidOff(l));
  // Totals only reflect what's still active — a closed loan's principal
  // and paid-off amount stop counting here the moment it's closed; its
  // numbers live on in the Closed Loans section instead.
  renderSummary(active);
  renderGrid(active);
  renderClosedGrid(closed);
}

function renderSummary(loans) {
  const totalPrincipal = loans.reduce((sum, l) => sum + l.principal, 0);
  const totalRemaining = loans.reduce((sum, l) => sum + l.remainingBalance, 0);
  const totalPaid = totalPrincipal - totalRemaining;

  const remainingLabel = state.tab === 'borrowed' ? 'Total Owed' : 'Total Outstanding';
  const paidLabel = state.tab === 'borrowed' ? 'Total Paid Off' : 'Total Repaid';

  setText('[data-summary-remaining-label]', remainingLabel);
  setText('[data-summary-paid-label]', paidLabel);
  setText('[data-total-principal]', Helpers.formatCurrency(totalPrincipal));
  setText('[data-total-remaining]', Helpers.formatCurrency(totalRemaining));
  setText('[data-total-paid]', Helpers.formatCurrency(totalPaid));
}

function loanCardIcon(l) {
  const typeMeta = state.tab === 'borrowed' ? LoanTypes.find((t) => t.label === l.type) : null;
  return typeMeta ? typeMeta.icon : (state.tab === 'borrowed' ? 'fa-building-columns' : 'fa-hand-holding-dollar');
}

function renderGrid(loans) {
  const grid = document.querySelector('[data-loans-grid]');
  if (!grid) return;

  if (loans.length === 0) {
    const emptyText = state.tab === 'borrowed'
      ? 'No loans on file. Add one to start tracking payments.'
      : 'No money lent on file. Add one to start tracking repayments.';
    grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><i class="fa-solid fa-hand-holding-dollar"></i>${emptyText}</div>`;
    return;
  }

  grid.innerHTML = loans
    .map((l) => {
      const pct = Loans.percentPaid(l);
      const schedule = Loans.upcomingSchedule(l, 3);
      const counterpartyLabel = state.tab === 'borrowed' ? 'Lender' : 'Borrower';
      const cardIcon = loanCardIcon(l);
      const isYearly = l.repaymentType === 'yearly';

      const scheduleHtml = schedule.length
        ? schedule.map((s) => `
            <div style="display:flex; justify-content:space-between; font-size: var(--fs-xs); padding: 6px 0; border-bottom: 1px solid var(--color-surface-border);">
              <span style="color: var(--color-text-faint);">${Helpers.formatShortDate(s.date)}</span>
              <span class="num">${Helpers.formatCurrency(s.amount)}</span>
            </div>`).join('')
        : `<p style="font-size: var(--fs-xs); color: var(--color-text-faint); margin:0;">Paid off — no more scheduled payments.</p>`;

      return `
        <div class="glass card loan-card" data-id="${l.id}">
          <div class="card__header">
            <div style="display:flex; align-items:center; gap: var(--sp-3);">
              <span class="chip ${state.tab === 'borrowed' ? 'tone-negative' : 'tone-accent'}" style="width:42px;height:42px;">
                <i class="fa-solid ${cardIcon}"></i>
              </span>
              <div>
                <h3 style="margin:0; font-size: var(--fs-md);">${escapeHtml(l.name)}</h3>
                <span style="font-size: var(--fs-xs); color: var(--color-text-faint);">${counterpartyLabel}: ${escapeHtml(l.counterparty || '—')}</span>
              </div>
            </div>
            <div class="row-actions">
              <button data-edit aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
              <button data-delete class="danger" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>

          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom: var(--sp-3);">
            <span class="badge badge--info">${isYearly ? 'Yearly Payback' : 'EMI (Monthly)'}</span>
            ${l.originalCurrency ? `<span class="badge badge--gold" title="Originally ${l.originalCurrency} ${Number(l.originalPrincipal).toFixed(2)} @ ${l.exchangeRate}">${l.originalCurrency} → ₹</span>` : ''}
          </div>

          <div class="progress" style="margin-bottom: 6px;">
            <div class="progress__fill" style="width:${pct}%;"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size: var(--fs-xs); color: var(--color-text-faint); margin-bottom: var(--sp-3);">
            <span>${pct.toFixed(0)}% ${state.tab === 'borrowed' ? 'paid off' : 'repaid'}</span>
            <span class="num">${Helpers.formatCurrency(l.remainingBalance)} of ${Helpers.formatCurrency(l.principal)}</span>
          </div>

          <div class="hero-balance__row" style="margin-top:0; padding-top: var(--sp-3);">
            <div class="hero-balance__mini">
              <span class="hero-balance__mini-label">${isYearly ? 'Yearly Payment' : 'EMI'}</span>
              <span class="hero-balance__mini-value num" style="font-size: var(--fs-sm);">${Helpers.formatCurrency(l.emi || 0)}</span>
            </div>
            <div class="hero-balance__mini">
              <span class="hero-balance__mini-label">Interest Rate</span>
              <span class="hero-balance__mini-value" style="font-size: var(--fs-sm);">${l.interestRate || 0}%</span>
            </div>
            <div class="hero-balance__mini">
              <span class="hero-balance__mini-label">${isYearly ? 'Years Left' : 'Months Left'}</span>
              <span class="hero-balance__mini-value" style="font-size: var(--fs-sm);">${l.remainingMonths || 0}</span>
            </div>
          </div>

          <div style="margin-top: var(--sp-4);">
            <span style="font-size: var(--fs-xs); font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color: var(--color-text-faint);">Payment Schedule</span>
            <div style="margin-top: var(--sp-2);">${scheduleHtml}</div>
          </div>

          <button class="btn btn--primary" style="width:100%; justify-content:center; margin-top: var(--sp-4);" data-log-payment>
            <i class="fa-solid fa-money-check-dollar"></i> ${state.tab === 'borrowed' ? 'Log Payment' : 'Log Repayment Received'}
          </button>
        </div>`;
    })
    .join('');

  grid.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openEditModal(btn.closest('[data-id]').dataset.id); });
  });
  grid.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); handleDelete(btn.closest('[data-id]').dataset.id); });
  });
  grid.querySelectorAll('[data-log-payment]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openPaymentModal(btn.closest('[data-id]').dataset.id); });
  });
  grid.querySelectorAll('[data-id]').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit], [data-delete], [data-log-payment]')) return;
      openDetail(card.dataset.id);
    });
  });
}

/* ---------------- Closed Loans ---------------- */

function bindClosedToggle() {
  const btn = document.querySelector('[data-closed-toggle]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.closedExpanded = !state.closedExpanded;
    updateClosedVisibility();
  });
}

function updateClosedVisibility() {
  const grid = document.querySelector('[data-closed-loans-grid]');
  const arrow = document.querySelector('[data-closed-arrow]');
  if (grid) grid.style.display = state.closedExpanded ? '' : 'none';
  if (arrow) arrow.classList.toggle('is-collapsed', !state.closedExpanded);
}

function renderClosedGrid(loans) {
  const grid = document.querySelector('[data-closed-loans-grid]');
  const countEl = document.querySelector('[data-closed-count]');
  if (countEl) countEl.textContent = `(${loans.length})`;
  if (!grid) return;

  if (loans.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><i class="fa-solid fa-box-archive"></i>No closed loans yet — paid-off loans will show up here, kept for their history.</div>`;
    return;
  }

  grid.innerHTML = loans
    .map((l) => {
      const cardIcon = loanCardIcon(l);
      return `
        <div class="glass card loan-card loan-card--closed" data-id="${l.id}">
          <div class="card__header">
            <div style="display:flex; align-items:center; gap: var(--sp-3);">
              <span class="chip" style="width:42px;height:42px; background: var(--color-surface-strong); color: var(--color-text-faint);">
                <i class="fa-solid ${cardIcon}"></i>
              </span>
              <div>
                <h3 style="margin:0; font-size: var(--fs-md);">${escapeHtml(l.name)}</h3>
                <span style="font-size: var(--fs-xs); color: var(--color-text-faint);">Closed ${l.closedDate ? Helpers.formatShortDate(l.closedDate) : '—'}</span>
              </div>
            </div>
            <span class="badge badge--positive"><i class="fa-solid fa-circle-check"></i> Paid off</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size: var(--fs-xs); color: var(--color-text-faint);">
            <span>Principal</span>
            <span class="num">${Helpers.formatCurrency(l.principal)}</span>
          </div>
        </div>`;
    })
    .join('');

  grid.querySelectorAll('[data-id]').forEach((card) => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

/* ---------------- Add / Edit ---------------- */

function showLoanStep(step) {
  document.querySelectorAll('[data-loan-step]').forEach((el) => {
    el.hidden = el.getAttribute('data-loan-step') !== step;
  });
}

function renderLoanTypeGrid() {
  const grid = document.querySelector('[data-loan-type-grid]');
  if (!grid) return;
  grid.innerHTML = LoanTypes.map((t) => `
    <button type="button" class="type-card" data-loan-type="${escapeHtml(t.label)}">
      <i class="fa-solid ${t.icon}"></i>
      <span class="type-card__label">${escapeHtml(t.label)}</span>
    </button>`).join('');
  grid.querySelectorAll('[data-loan-type]').forEach((btn) => {
    btn.addEventListener('click', () => selectLoanType(btn.getAttribute('data-loan-type')));
  });
}

function selectLoanType(label) {
  const typeDef = LoanTypes.find((t) => t.label === label);
  if (typeDef && typeDef.isMoiHandoff) {
    openMoiStep();
    return;
  }

  state.selectedLoanType = label;
  const verb = state.editingId ? 'Edit' : 'Add';
  document.querySelector('#loanModal [data-modal-title]').textContent = `${verb} Loan: ${label}`;
  const nameField = document.querySelector('#loanModal [data-form-name]');
  if (!nameField.value) nameField.value = label === 'Other' ? '' : label;
  showLoanStep('details');
  setTimeout(() => nameField.focus(), 50);
}

/* ---------------- Moi Received quick entry (inline, no navigation) ---------------- */

function openMoiStep() {
  document.querySelector('#loanModal [data-modal-title]').textContent = 'Add Moi Received';

  const nameEl = document.querySelector('[data-form-moi-name]');
  const villageEl = document.querySelector('[data-form-moi-village]');
  const amountEl = document.querySelector('[data-form-moi-amount]');
  const dateEl = document.querySelector('[data-form-moi-date]');
  const funcEl = document.querySelector('[data-form-moi-function]');
  const customField = document.querySelector('[data-loan-moi-custom-function-field]');
  const customEl = document.querySelector('[data-form-moi-function-custom]');
  const notesEl = document.querySelector('[data-form-moi-notes]');

  if (nameEl) nameEl.value = '';
  if (villageEl) villageEl.value = '';
  if (amountEl) amountEl.value = '';
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
  if (customEl) customEl.value = '';
  if (customField) customField.style.display = 'none';

  if (funcEl && window.Moi) {
    funcEl.innerHTML = Moi.FUNCTIONS.map((f) => `<option value="${f}">${f}</option>`).join('');
  }
  if (notesEl) notesEl.value = '';

  showLoanStep('moi');
  setTimeout(() => { if (nameEl) nameEl.focus(); }, 50);
}

function bindMoiQuickForm() {
  const funcEl = document.querySelector('[data-form-moi-function]');
  const customField = document.querySelector('[data-loan-moi-custom-function-field]');
  if (funcEl && customField) {
    funcEl.addEventListener('change', () => {
      const isOther = funcEl.value === 'Other';
      customField.style.display = isOther ? '' : 'none';
      if (isOther) document.querySelector('[data-form-moi-function-custom]').focus();
    });
  }

  // Name/village suggestions: only once 3+ characters are typed and
  // something on file actually matches — not every stored name/village
  // dumped on focus. Bound once here (not per modal-open) since the
  // options list is fetched live from Moi.names()/villages() each time.
  if (window.Moi) {
    Helpers.bindTextSuggest(
      document.querySelector('[data-form-moi-name]'),
      document.querySelector('[data-moi-name-suggestions]'),
      () => Moi.names(),
    );
    Helpers.bindTextSuggest(
      document.querySelector('[data-form-moi-village]'),
      document.querySelector('[data-moi-village-suggestions]'),
      () => Moi.villages(),
    );
  }

  const saveBtn = document.querySelector('[data-loan-moi-save]');
  if (!saveBtn) return;
  saveBtn.addEventListener('click', () => {
    const name = (document.querySelector('[data-form-moi-name]').value || '').trim();
    const village = (document.querySelector('[data-form-moi-village]').value || '').trim();
    const amount = Number(document.querySelector('[data-form-moi-amount]').value);
    const date = document.querySelector('[data-form-moi-date]').value;
    const selectVal = document.querySelector('[data-form-moi-function]').value;
    const customVal = (document.querySelector('[data-form-moi-function-custom]').value || '').trim();
    const notes = (document.querySelector('[data-form-moi-notes]').value || '').trim();

    if (!name || !amount || amount <= 0 || !date) {
      Toast.show('Please fill in name, amount, and date.', 'warning');
      return;
    }

    const finalFunction = selectVal === 'Other' && customVal ? customVal : selectVal;

    Moi.add({ direction: 'taken', name, village, amount, date, function: finalFunction, notes });
    Toast.show('Moi entry added.', 'success');
    Modal.close('#loanModal');
  });
}

function bindLoanForm() {
  const form = document.querySelector('[data-loan-form]');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSubmit(form);
  });

  renderLoanTypeGrid();
  bindCurrencyToggle();
  bindRepaymentTypeToggle();

  document.querySelectorAll('[data-loan-back-to-type]').forEach((backToType) => {
    backToType.addEventListener('click', () => showLoanStep('type'));
  });

  bindMoiQuickForm();

  const addBtn = document.querySelector('[data-add-loan-btn]');
  if (addBtn) addBtn.addEventListener('click', () => openAddModal());
}

function openAddModal() {
  state.editingId = null;
  state.selectedLoanType = null;
  state.currency = 'INR';
  const form = document.querySelector('[data-loan-form]');
  form.reset();
  document.querySelector('[data-form-startdate]').value = new Date().toISOString().slice(0, 10);
  document.querySelector('[data-form-repayment-type]').value = 'emi';
  syncCurrencyUI();
  syncRepaymentTypeUI();

  const isBorrowed = state.tab === 'borrowed';
  document.querySelector('#loanModal [data-modal-title]').textContent = isBorrowed ? 'Add Loan' : 'Add Money Lent';
  document.querySelector('[data-form-counterparty-label]').textContent = isBorrowed ? 'Lender' : 'Borrower';
  document.querySelector('#loanModal [data-form-name]').setAttribute('placeholder', isBorrowed ? 'e.g. Car Loan' : 'e.g. Personal Loan to Sam');

  if (isBorrowed) {
    showLoanStep('type');
  } else {
    // Loan-type categories (Home, Vehicle, Personal…) only make sense for money you owe —
    // money lent skips straight to the details form, same as before.
    showLoanStep('details');
  }
  Modal.open('#loanModal');
}

function openEditModal(id) {
  const record = Loans.get(id);
  if (!record) return;
  state.editingId = id;
  state.selectedLoanType = record.type || null;
  const isBorrowed = record.direction === 'borrowed';

  document.querySelector('#loanModal [data-modal-title]').textContent = isBorrowed && record.type
    ? `Edit Loan: ${record.type}`
    : (isBorrowed ? 'Edit Loan' : 'Edit Money Lent');
  document.querySelector('[data-form-counterparty-label]').textContent = isBorrowed ? 'Lender' : 'Borrower';
  document.querySelector('#loanModal [data-form-name]').value = record.name;
  document.querySelector('[data-form-counterparty]').value = record.counterparty || '';

  // Reopen in the currency the loan was originally entered in, so editing
  // shows the same figures the person typed — not the converted rupees.
  if (record.originalCurrency && record.exchangeRate) {
    state.currency = record.originalCurrency;
    document.querySelector('[data-form-principal]').value = record.originalPrincipal;
    document.querySelector('[data-form-remaining]').value = round2(record.remainingBalance / record.exchangeRate);
    document.querySelector('[data-form-emi]').value = round2((record.emi || 0) / record.exchangeRate);
  } else {
    state.currency = 'INR';
    document.querySelector('[data-form-principal]').value = record.principal;
    document.querySelector('[data-form-remaining]').value = record.remainingBalance;
    document.querySelector('[data-form-emi]').value = record.emi || 0;
  }
  syncCurrencyUI();

  document.querySelector('[data-form-interest]').value = record.interestRate || 0;
  document.querySelector('[data-form-repayment-type]').value = record.repaymentType === 'yearly' ? 'yearly' : 'emi';
  syncRepaymentTypeUI();
  document.querySelector('[data-form-months]').value = record.remainingMonths || 0;
  document.querySelector('[data-form-startdate]').value = record.startDate || '';
  document.querySelector('#loanModal [data-form-duedate]').value = record.nextDueDate || '';

  showLoanStep('details');
  Modal.open('#loanModal');
}

function handleSubmit(form) {
  const name = form.querySelector('[data-form-name]').value.trim();
  const counterparty = form.querySelector('[data-form-counterparty]').value.trim();
  const enteredPrincipal = parseFloat(form.querySelector('[data-form-principal]').value);
  const remainingInput = form.querySelector('[data-form-remaining]').value;
  const interestRate = parseFloat(form.querySelector('[data-form-interest]').value) || 0;
  const enteredEmi = parseFloat(form.querySelector('[data-form-emi]').value) || 0;
  const remainingMonths = parseInt(form.querySelector('[data-form-months]').value, 10) || 0;
  const startDate = form.querySelector('[data-form-startdate]').value;
  const nextDueDate = form.querySelector('[data-form-duedate]').value;
  const repaymentType = form.querySelector('[data-form-repayment-type]').value === 'yearly' ? 'yearly' : 'emi';

  if (!name || !enteredPrincipal || enteredPrincipal <= 0) {
    Toast.show('Please fill in a name and a positive loan amount.', 'error');
    return;
  }

  const enteredRemaining = remainingInput === '' ? enteredPrincipal : parseFloat(remainingInput);

  let principal = enteredPrincipal;
  let remainingBalance = enteredRemaining;
  let emi = enteredEmi;
  let originalPrincipal = null;
  let originalCurrency = null;
  let exchangeRate = null;

  if (state.currency !== 'INR') {
    const rate = getStoredRate(state.currency);
    if (!rate) {
      Toast.show(`Please set the ${state.currency} → Rupee rate first.`, 'error');
      return;
    }
    originalPrincipal = enteredPrincipal;
    originalCurrency = state.currency;
    exchangeRate = rate;
    principal = round2(enteredPrincipal * rate);
    remainingBalance = round2(enteredRemaining * rate);
    emi = round2(enteredEmi * rate);
  }

  const payload = {
    direction: state.tab,
    name, counterparty, principal, remainingBalance,
    interestRate, emi, repaymentType, remainingMonths, startDate, nextDueDate,
    originalPrincipal, originalCurrency, exchangeRate,
  };
  if (state.tab === 'borrowed' && state.selectedLoanType) {
    payload.type = state.selectedLoanType;
  }

  if (state.editingId) {
    Loans.update(state.editingId, payload);
    Toast.show('Updated.');
  } else {
    Loans.add(payload);
    Toast.show(state.tab === 'borrowed' ? 'Loan added.' : 'Lending record added.');
  }
  Modal.close('#loanModal');
  render();
}

function handleDelete(id) {
  const record = Loans.get(id);
  if (!record) return;
  if (Loans.isPaidOff(record)) {
    Toast.show("Closed loans aren't deleted — they're kept in Closed Loans for their history.", 'info');
    return;
  }
  if (!window.confirm(`Remove "${record.name}"? This can't be undone.`)) return;
  Loans.remove(id);
  Toast.show('Removed.', 'info');
  render();
}

/* ---------------- Currency toggle (Add/Edit Loan modal) ---------------- */

function getStoredRate(currency) {
  const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
  return currency === 'USD' ? (settings.usdToInrRate || null) : (settings.sgdToInrRate || null);
}

function saveStoredRate(currency, rate) {
  const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
  const key = currency === 'USD' ? 'usdToInrRate' : 'sgdToInrRate';
  window.Storage.set(window.STORAGE_KEYS.SETTINGS, { ...settings, [key]: rate });
}

/** Prompts for "1 <currency> = ? INR". Returns the rate, or null if cancelled/invalid. */
function promptForRate(currency) {
  const existing = getStoredRate(currency);
  const answer = window.prompt(
    existing
      ? `Current rate: 1 ${currency} = ₹${existing}. Enter the new rate for 1 ${currency} (in rupees):`
      : `What's today's rate? Enter how many rupees 1 ${currency} is worth:`,
    existing || ''
  );
  if (answer === null) return null; // user hit Cancel
  const rate = parseFloat(answer);
  if (!rate || rate <= 0) {
    Toast.show('Please enter a valid exchange rate.', 'error');
    return null;
  }
  saveStoredRate(currency, rate);
  Toast.show(`Saved: 1 ${currency} = ₹${rate}. This won't be asked again until you change it.`, 'info');
  return rate;
}

function bindCurrencyToggle() {
  document.querySelectorAll('#loanModal [data-currency-btn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const currency = btn.dataset.currencyBtn;
      if (currency !== 'INR') {
        const rate = getStoredRate(currency) || promptForRate(currency);
        if (!rate) return; // no rate available — stay on the current currency
      }
      state.currency = currency;
      syncCurrencyUI();
    });
  });

  const changeRateBtn = document.querySelector('#loanModal [data-change-rate]');
  if (changeRateBtn) {
    changeRateBtn.addEventListener('click', () => {
      const rate = promptForRate(state.currency);
      if (rate) syncCurrencyUI();
    });
  }
}

function syncCurrencyUI() {
  document.querySelectorAll('#loanModal [data-currency-btn]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.currencyBtn === state.currency);
  });
  const hint = document.querySelector('#loanModal [data-currency-hint]');
  const changeRateBtn = document.querySelector('#loanModal [data-change-rate]');

  if (state.currency !== 'INR') {
    const rate = getStoredRate(state.currency);
    if (hint) {
      hint.style.display = '';
      hint.textContent = rate ? `Converts at 1 ${state.currency} = ₹${rate} → saved in rupees.` : 'No rate set yet.';
    }
    if (changeRateBtn) changeRateBtn.style.display = '';
  } else {
    if (hint) hint.style.display = 'none';
    if (changeRateBtn) changeRateBtn.style.display = 'none';
  }
}

/* ---------------- Repayment type toggle (Add/Edit Loan modal) ---------------- */

function bindRepaymentTypeToggle() {
  const sel = document.querySelector('[data-form-repayment-type]');
  if (!sel) return;
  sel.addEventListener('change', syncRepaymentTypeUI);
}

function syncRepaymentTypeUI() {
  const sel = document.querySelector('[data-form-repayment-type]');
  const isYearly = sel && sel.value === 'yearly';
  const emiLabel = document.querySelector('[data-form-emi-label]');
  const monthsLabel = document.querySelector('[data-form-months-label]');
  if (emiLabel) emiLabel.textContent = isYearly ? 'Yearly Payment Amount' : 'EMI / Installment';
  if (monthsLabel) monthsLabel.textContent = isYearly ? 'Remaining Years' : 'Remaining Months';
}

/* ---------------- Log payment ---------------- */

function bindPaymentForm() {
  const form = document.querySelector('[data-loan-payment-form]');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const record = Loans.get(state.payingId);
    if (!record) return;

    let amount = parseFloat(form.querySelector('[data-loan-payment-amount]').value);
    const date = form.querySelector('[data-loan-payment-date]').value || new Date().toISOString().slice(0, 10);
    const notes = form.querySelector('[data-loan-payment-notes]').value.trim();

    if (!amount || amount <= 0) {
      Toast.show('Enter a positive amount.', 'error');
      return;
    }

    // Loan was originally entered in SGD/USD and this log entry is in that
    // same foreign currency — convert to rupees before saving, same as the
    // loan amount itself, so the balance always stays in rupees.
    if (record.originalCurrency && state.paymentCurrency === record.originalCurrency) {
      const rate = getStoredRate(record.originalCurrency) || promptForRate(record.originalCurrency);
      if (!rate) return;
      amount = round2(amount * rate);
    }

    const updated = Loans.applyPayment(state.payingId, { amount, date, notes });
    Modal.close('#loanPaymentModal');
    form.reset();
    if (updated && Loans.isPaidOff(updated)) {
      Toast.show(`🎉 "${updated.name}" is fully paid off and moved to Closed Loans!`);
    } else {
      Toast.show('Payment logged.');
    }
    render();
    if (updated && document.querySelector('#loanDetailModal')?.classList.contains('is-open') && state.detailId === updated.id) {
      renderDetail(updated);
    }
  });
}

function openPaymentModal(id) {
  const record = Loans.get(id);
  if (!record) return;
  state.payingId = id;
  state.paymentCurrency = 'INR';
  document.querySelector('[data-loan-payment-name]').textContent = record.name;
  const form = document.querySelector('[data-loan-payment-form]');
  form.reset();
  document.querySelector('[data-loan-payment-amount]').value = record.emi || '';
  document.querySelector('[data-loan-payment-date]').value = new Date().toISOString().slice(0, 10);
  syncPaymentCurrencyUI(record);
  Modal.open('#loanPaymentModal');
}

/** Only shown when the loan itself was entered in SGD/USD — offers a
 * choice between that same currency and INR for this one log entry,
 * exactly like the currency toggle on the Add Loan form. */
function syncPaymentCurrencyUI(record) {
  const wrap = document.querySelector('[data-payment-currency-wrap]');
  const toggle = document.querySelector('[data-payment-currency-toggle]');
  const hint = document.querySelector('[data-payment-currency-hint]');
  if (!wrap || !toggle) return;

  if (!record.originalCurrency) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';

  const symbol = record.originalCurrency === 'USD' ? '$' : 'S$';
  toggle.innerHTML = `
    <button type="button" data-payment-currency-btn="${record.originalCurrency}" class="${state.paymentCurrency === record.originalCurrency ? 'is-active' : ''}">${symbol} ${record.originalCurrency}</button>
    <button type="button" data-payment-currency-btn="INR" class="${state.paymentCurrency === 'INR' ? 'is-active' : ''}">₹ INR</button>`;

  toggle.querySelectorAll('[data-payment-currency-btn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.paymentCurrency = btn.dataset.paymentCurrencyBtn;
      syncPaymentCurrencyUI(record);
    });
  });

  if (hint) {
    if (state.paymentCurrency !== 'INR') {
      const rate = getStoredRate(state.paymentCurrency);
      hint.style.display = '';
      hint.textContent = rate ? `Converts at 1 ${state.paymentCurrency} = ₹${rate} → saved in rupees.` : "No rate set yet — you'll be asked when you save.";
    } else {
      hint.style.display = 'none';
    }
  }
}

/* ---------------- Loan detail view ---------------- */

function bindDetailActions() {
  const addLogBtn = document.querySelector('[data-detail-add-log-btn]');
  if (addLogBtn) addLogBtn.addEventListener('click', () => { if (state.detailId) openPaymentModal(state.detailId); });
}

function openDetail(id) {
  const record = Loans.get(id);
  if (!record) return;
  state.detailId = id;
  renderDetail(record);
  Modal.open('#loanDetailModal');
}

function renderDetail(record) {
  const isBorrowed = record.direction === 'borrowed';
  const counterpartyLabel = isBorrowed ? 'Lender' : 'Borrower';
  const closed = Loans.isPaidOff(record);
  const isYearly = record.repaymentType === 'yearly';
  const paidSoFar = Loans.paidOffAmount(record);

  setText('[data-detail-name]', record.name);
  setText('[data-detail-subtitle]', `${counterpartyLabel}: ${record.counterparty || '—'}`);

  const badges = [];
  badges.push(`<span class="badge badge--info">${escapeHtml(record.type || (isBorrowed ? 'Loan' : 'Money Lent'))}</span>`);
  badges.push(`<span class="badge badge--info">${isYearly ? 'Yearly Payback' : 'EMI (Monthly)'}</span>`);
  if (record.originalCurrency) {
    badges.push(`<span class="badge badge--gold">Originally ${record.originalCurrency} ${Number(record.originalPrincipal).toFixed(2)} @ ${record.exchangeRate} → ₹</span>`);
  }
  badges.push(closed
    ? `<span class="badge badge--positive"><i class="fa-solid fa-circle-check"></i> Closed${record.closedDate ? ' · ' + Helpers.formatShortDate(record.closedDate) : ''}</span>`
    : `<span class="badge badge--negative"><i class="fa-solid fa-circle-notch"></i> Active</span>`);
  const badgesEl = document.querySelector('[data-detail-badges]');
  if (badgesEl) badgesEl.innerHTML = badges.join('');

  const pct = Loans.percentPaid(record);
  const fill = document.querySelector('[data-detail-progress-fill]');
  if (fill) fill.style.width = pct + '%';
  const progressLabel = document.querySelector('[data-detail-progress-label]');
  if (progressLabel) {
    progressLabel.innerHTML = `<span>${pct.toFixed(0)}% ${isBorrowed ? 'paid off' : 'repaid'}</span><span class="num">${Helpers.formatCurrency(record.remainingBalance)} of ${Helpers.formatCurrency(record.principal)}</span>`;
  }

  // Every field the person could want, spelled out with a plain label —
  // not a handful of abbreviated mini-stats.
  const info = [
    { label: counterpartyLabel, value: record.counterparty || '—' },
    { label: 'Loan Type', value: record.type || (isBorrowed ? 'Loan' : 'Money Lent') },
    { label: 'Loan Initial Amount', value: Helpers.formatCurrency(record.principal) },
    record.originalCurrency ? { label: 'Original Amount Entered', value: `${record.originalCurrency} ${Number(record.originalPrincipal).toFixed(2)}` } : null,
    record.originalCurrency ? { label: 'Exchange Rate Used', value: `1 ${record.originalCurrency} = ₹${record.exchangeRate}` } : null,
    { label: 'Interest Rate', value: `${record.interestRate || 0}%` },
    { label: 'Repayment Type', value: isYearly ? 'Yearly Payback' : 'EMI (Monthly)' },
    { label: isYearly ? 'Yearly Payment Amount' : 'EMI / Installment', value: Helpers.formatCurrency(record.emi || 0) },
    { label: isYearly ? 'Years Remaining' : 'Months Remaining', value: String(record.remainingMonths || 0) },
    { label: 'Amount Paid So Far', value: Helpers.formatCurrency(paidSoFar) },
    { label: 'Remaining Balance', value: Helpers.formatCurrency(record.remainingBalance) },
    { label: 'Loan Initial Date', value: record.startDate ? Helpers.formatShortDate(record.startDate) : '—' },
    closed
      ? { label: 'Closed Date', value: record.closedDate ? Helpers.formatShortDate(record.closedDate) : '—' }
      : { label: 'Next Due Date', value: record.nextDueDate ? Helpers.formatShortDate(record.nextDueDate) : '—' },
    { label: 'Status', value: closed ? 'Closed' : 'Active' },
  ].filter(Boolean);

  const infoEl = document.querySelector('[data-detail-info-grid]');
  if (infoEl) {
    infoEl.innerHTML = info.map((i) => `
      <div class="detail-grid__item">
        <span class="detail-grid__label">${escapeHtml(i.label)}</span>
        <span class="detail-grid__value">${escapeHtml(String(i.value))}</span>
      </div>`).join('');
  }

  renderDetailHistory(record);
  bindDetailExport(record);

  const addLogBtn = document.querySelector('[data-detail-add-log-btn]');
  if (addLogBtn) addLogBtn.style.display = closed ? 'none' : '';
}

function renderDetailHistory(record) {
  const list = document.querySelector('[data-detail-history-list]');
  if (!list) return;
  const payments = (record.payments || []).slice().reverse();
  if (payments.length === 0) {
    list.innerHTML = `<li class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i>No payments logged yet.</li>`;
    return;
  }
  list.innerHTML = payments.map((p) => `
    <li class="list-row" data-payment-id="${p.id}">
      <div class="list-row__meta">
        <p class="list-row__title">${Helpers.formatShortDate(p.date)}</p>
        ${p.notes ? `<p class="list-row__sub">${escapeHtml(p.notes)}</p>` : ''}
      </div>
      <div style="display:flex; align-items:center; gap: var(--sp-3);">
        <div class="list-row__amount num">${Helpers.formatCurrency(p.amount)}</div>
        <div class="row-actions">
          <button type="button" data-delete-payment class="danger" aria-label="Delete this log" title="Delete this log">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    </li>`).join('');

  list.querySelectorAll('[data-delete-payment]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const li = btn.closest('[data-payment-id]');
      if (li) handleDeletePayment(record.id, li.dataset.paymentId);
    });
  });
}

function handleDeletePayment(loanId, paymentId) {
  if (!window.confirm('Delete this logged payment? The amount will be added back to the outstanding balance.')) return;
  const updated = Loans.removePayment(loanId, paymentId);
  if (!updated) return;
  Toast.show('Payment log deleted.', 'info');
  render();
  if (document.querySelector('#loanDetailModal')?.classList.contains('is-open') && state.detailId === loanId) {
    renderDetail(updated);
  }
}

/* ---------------- Export ---------------- */

/** Every detail worth knowing about a loan, denormalized one row per payment
 * (or a single blank-payment row if it has none) — who gave/received it,
 * the interest rate, the original loan amount, every date, and the full
 * history — used by both the global export and the per-loan export. */
function loanDetailRows(record) {
  const base = {
    direction: record.direction === 'borrowed' ? 'Borrowed' : 'Lent',
    type: record.type || '',
    name: record.name,
    counterparty: record.counterparty || '',
    currency: record.originalCurrency || 'INR',
    originalAmount: record.originalCurrency ? record.originalPrincipal : record.principal,
    exchangeRate: record.exchangeRate || '',
    principalInr: record.principal,
    interestRate: record.interestRate || 0,
    repaymentType: record.repaymentType === 'yearly' ? 'Yearly' : 'EMI (Monthly)',
    installmentAmount: record.emi || 0,
    paidSoFarInr: Loans.paidOffAmount(record),
    remainingInr: record.remainingBalance,
    startDate: record.startDate || '',
    status: Loans.isPaidOff(record) ? 'Closed' : 'Active',
    closedDate: record.closedDate || '',
  };
  const payments = record.payments || [];
  if (payments.length === 0) return [{ ...base, paymentDate: '', paymentAmount: '', paymentNotes: '' }];
  return payments.map((p) => ({ ...base, paymentDate: p.date, paymentAmount: p.amount, paymentNotes: p.notes || '' }));
}

function loanExportColumns() {
  return [
    { label: 'Direction', key: 'direction' },
    { label: 'Type', key: 'type' },
    { label: 'Name', key: 'name' },
    { label: 'Lender / Borrower', key: 'counterparty' },
    { label: 'Currency', key: 'currency' },
    { label: 'Original Amount', key: 'originalAmount' },
    { label: 'Exchange Rate', key: 'exchangeRate' },
    { label: 'Loan Initial Amount (INR)', key: 'principalInr' },
    { label: 'Interest %', key: 'interestRate' },
    { label: 'Repayment Type', key: 'repaymentType' },
    { label: 'Installment Amount (INR)', key: 'installmentAmount' },
    { label: 'Paid So Far (INR)', key: 'paidSoFarInr' },
    { label: 'Remaining (INR)', key: 'remainingInr' },
    { label: 'Loan Initial Date', key: 'startDate' },
    { label: 'Status', key: 'status' },
    { label: 'Closed Date', key: 'closedDate' },
    { label: 'Payment Date', key: 'paymentDate' },
    { label: 'Payment Amount', key: 'paymentAmount' },
    { label: 'Payment Notes', key: 'paymentNotes' },
  ];
}

function loanSummaryColumns() {
  return [
    { label: 'Name', key: 'name' },
    { label: 'Lender / Borrower', key: 'counterparty' },
    { label: 'Loan Initial Amount', value: (r) => Helpers.formatCurrency(r.principal) },
    { label: 'Interest %', value: (r) => `${r.interestRate || 0}%` },
    { label: 'Repayment', value: (r) => (r.repaymentType === 'yearly' ? 'Yearly' : 'EMI') },
    { label: 'Paid So Far', value: (r) => Helpers.formatCurrency(Loans.paidOffAmount(r)) },
    { label: 'Remaining', value: (r) => Helpers.formatCurrency(r.remainingBalance) },
    { label: 'Status', value: (r) => (Loans.isPaidOff(r) ? 'Closed' : 'Active') },
  ];
}

/** Active (non-closed) borrowed loans, bucketed into one group per
 *  LoanTypes entry (Home Loan, Vehicle Loan, Personal Loan, …), in that
 *  same order — each becomes its own titled section in the PDF. Types
 *  with no active loans are skipped entirely rather than shown empty. */
function activeLoanSectionsByType(activeBorrowed) {
  return LoanTypes
    .map((t) => ({ title: t.label, rows: activeBorrowed.filter((l) => (l.type || 'Other') === t.label) }))
    .filter((s) => s.rows.length > 0);
}

/** Months (and years) between a loan's start date and its closed date —
 *  used only in the closure summary at the end of the report. */
function loanClosureDuration(loan) {
  if (!loan.startDate || !loan.closedDate) return '\u2014';
  const start = new Date(loan.startDate);
  const end = new Date(loan.closedDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '\u2014';
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  months = Math.max(0, months);
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${rem} mo`;
  if (rem === 0) return `${years} yr`;
  return `${years} yr ${rem} mo`;
}

/** Flat "Closed Loans" listing — every closed loan, borrowed and lent
 *  together, no per-type sub-sections (a Type column identifies each
 *  instead), most recently closed first. */
function closedLoansColumns() {
  return [
    { label: 'Name', key: 'name', width: 32 },
    { label: 'Type', value: (l) => l.type || (l.direction === 'borrowed' ? 'Loan' : 'Money Lent'), width: 26 },
    { label: 'Direction', value: (l) => (l.direction === 'borrowed' ? 'Borrowed' : 'Lent'), width: 20 },
    { label: 'Lender / Borrower', value: (l) => l.counterparty || '\u2014', width: 28 },
    { label: 'Loan Amount', value: (l) => Helpers.formatCurrency(l.principal), align: 'right', width: 26 },
    { label: 'Closed On', value: (l) => (l.closedDate ? Helpers.formatShortDateWithYear(l.closedDate) : '\u2014'), align: 'right', width: 24 },
  ];
}

/** Bottom-of-report closure summary — how each closed loan actually got
 *  paid off: total paid, number of payments, how long it took. */
function loanClosureColumns() {
  return [
    { label: 'Name', key: 'name', width: 30 },
    { label: 'Type', value: (l) => l.type || (l.direction === 'borrowed' ? 'Loan' : 'Money Lent'), width: 24 },
    { label: 'Total Paid', value: (l) => Helpers.formatCurrency(Loans.paidOffAmount(l)), align: 'right', width: 24 },
    { label: 'Payments', value: (l) => String((l.payments || []).length), align: 'right', width: 16 },
    { label: 'Duration', value: (l) => loanClosureDuration(l), align: 'right', width: 20 },
    { label: 'Closed On', value: (l) => (l.closedDate ? Helpers.formatShortDateWithYear(l.closedDate) : '\u2014'), align: 'right', width: 22 },
  ];
}

function bindExport() {
  Exporter.buildDropdown('loansExportContainer',
    () => Exporter.csv(Loans.all().flatMap(loanDetailRows), loanExportColumns(), 'loans-and-lending-full-details'),
    () => {
      const activeBorrowed = Loans.activeByDirection('borrowed');
      const activeLent = Loans.activeByDirection('lent');
      const closedAll = [...Loans.closedByDirection('borrowed'), ...Loans.closedByDirection('lent')]
        .sort((a, b) => new Date(b.closedDate || 0) - new Date(a.closedDate || 0));

      const totalBorrowed = activeBorrowed.reduce((s, l) => s + l.principal, 0);
      const balanceOwed = activeBorrowed.reduce((s, l) => s + l.remainingBalance, 0);
      const totalLent = activeLent.reduce((s, l) => s + l.principal, 0);
      const outstanding = activeLent.reduce((s, l) => s + l.remainingBalance, 0);

      const tables = [
        ...activeLoanSectionsByType(activeBorrowed).map((s) => ({
          title: s.title, columns: loanSummaryColumns(), rows: s.rows,
        })),
        { title: 'Money Lent', columns: loanSummaryColumns(), rows: activeLent },
        { title: 'Closed Loans', columns: closedLoansColumns(), rows: closedAll },
        { title: 'Loan Closure Summary', columns: loanClosureColumns(), rows: closedAll },
      ];

      Exporter.pdf({
        title: 'Loans & Lending Report',
        subtitle: 'Overview \u00b7 Current Loans by Type \u00b7 Closed Loans',
        summaryCards: [
          { label: 'Total Borrowed', value: Helpers.formatCurrency(totalBorrowed) },
          { label: 'Balance Owed', value: Helpers.formatCurrency(balanceOwed) },
          { label: 'Total Lent', value: Helpers.formatCurrency(totalLent) },
          { label: 'Outstanding', value: Helpers.formatCurrency(outstanding) },
        ],
        tables,
        filename: 'loans-and-lending-report',
      });
    },
  );
}

/** Per-loan export, rebuilt every time the detail page renders so the CSV/PDF
 * choice is scoped to whichever loan is currently open. Includes the full
 * loan detail (who it's with, interest, initial amount, dates…) alongside
 * the payment history — not history alone. */
function bindDetailExport(record) {
  if (!document.getElementById('loanDetailExportContainer')) return;
  Exporter.buildDropdown('loanDetailExportContainer',
    () => Exporter.csv(loanDetailRows(record), loanExportColumns(), `${slugify(record.name)}-full-details`),
    () => {
      const counterpartyLabel = record.direction === 'borrowed' ? 'Lender' : 'Borrower';
      Exporter.pdf({
        title: `${record.name} — Loan Details`,
        subtitle: record.counterparty ? `${counterpartyLabel}: ${record.counterparty}` : '',
        summaryCards: [
          { label: 'Loan Initial Amount', value: Helpers.formatCurrency(record.principal) },
          { label: 'Amount Paid So Far', value: Helpers.formatCurrency(Loans.paidOffAmount(record)) },
          { label: 'Remaining Balance', value: Helpers.formatCurrency(record.remainingBalance) },
          { label: 'Interest Rate', value: `${record.interestRate || 0}%` },
        ],
        tables: [
          {
            title: 'Loan Details',
            columns: [
              { label: counterpartyLabel, key: 'counterparty' },
              { label: 'Currency', key: 'currency' },
              { label: 'Original Amount', key: 'originalAmount' },
              { label: 'Exchange Rate', key: 'exchangeRate' },
              { label: 'Repayment Type', key: 'repaymentType' },
              { label: 'Installment', value: (r) => Helpers.formatCurrency(r.installmentAmount) },
              { label: 'Loan Initial Date', value: (r) => (r.startDate ? Helpers.formatShortDate(r.startDate) : '—') },
              { label: 'Status', value: (r) => (r.status === 'Closed' ? `Closed${r.closedDate ? ' (' + Helpers.formatShortDate(r.closedDate) + ')' : ''}` : 'Active') },
            ],
            rows: [loanDetailRows(record)[0]],
          },
          {
            title: 'Payment History',
            columns: [
              { label: 'Date', value: (p) => Helpers.formatShortDate(p.date) },
              { label: 'Amount', value: (p) => Helpers.formatCurrency(p.amount) },
              { label: 'Notes', key: 'notes' },
            ],
            rows: record.payments || [],
          },
        ],
        filename: `${slugify(record.name)}-full-details`,
      });
    },
  );
}

function slugify(name) {
  return (name || 'loan').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'loan';
}

/* ---------------- Helpers ---------------- */

function setText(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function escapeHtml(str) {
  // Delegates to the single shared implementation in helpers.js.
  return Helpers.escapeHtml(str);
}

})();
