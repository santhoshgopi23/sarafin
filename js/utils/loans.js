/**
 * loans.js (utils)
 * CRUD for the `loans` storage key. A single record shape covers both
 * directions via `direction`:
 *   - 'borrowed' — a loan you owe (bank, car loan, personal loan, etc.)
 *   - 'lent'     — money you've lent to someone else
 *
 * Each record:
 *   { id, direction, name, counterparty, type, principal, remainingBalance,
 *     interestRate, emi, repaymentType ('emi' | 'yearly'), remainingMonths,
 *     startDate, nextDueDate, closedDate,
 *     currency/originalPrincipal/exchangeRate — set only when the loan was
 *       entered in a foreign currency (SGD/USD) and converted to rupees,
 *     payments: [{ id, amount, date, notes }, …] — the full payment log }
 *
 * % paid and "paid off" status are always derived from remainingBalance
 * vs principal — never stored separately, so they can't drift. A loan
 * that reaches 0 balance is never deleted automatically; it just becomes
 * "closed" (closedDate gets set) and the page keeps it around, with its
 * full payment history, in a separate Closed Loans list.
 */

const Loans = {
  all() {
    return window.Storage.get(window.STORAGE_KEYS.LOANS, []);
  },

  byDirection(direction) {
    return this.all().filter((l) => l.direction === direction);
  },

  activeByDirection(direction) {
    return this.byDirection(direction).filter((l) => !this.isPaidOff(l));
  },

  closedByDirection(direction) {
    return this.byDirection(direction).filter((l) => this.isPaidOff(l));
  },

  add(loan) {
    const list = this.all();
    const record = { id: Helpers.uid(), payments: [], ...loan };
    if (record.remainingBalance === undefined) record.remainingBalance = record.principal;
    if (record.remainingBalance <= 0 && !record.closedDate) {
      record.closedDate = new Date().toISOString().slice(0, 10);
    }
    list.push(record);
    window.Storage.set(window.STORAGE_KEYS.LOANS, list);
    return record;
  },

  /** Generic update. Also keeps `closedDate` in sync with the balance: set
   * it the moment a loan first reaches 0, and clear it again if a later
   * edit brings the balance back above 0 (e.g. correcting a typo). */
  update(id, changes) {
    const list = this.all();
    const idx = list.findIndex((l) => l.id === id);
    if (idx === -1) return null;
    const merged = { ...list[idx], ...changes };

    if (merged.remainingBalance <= 0 && !merged.closedDate) {
      merged.closedDate = (changes && changes.date) || new Date().toISOString().slice(0, 10);
    } else if (merged.remainingBalance > 0 && merged.closedDate) {
      merged.closedDate = null;
    }

    list[idx] = merged;
    window.Storage.set(window.STORAGE_KEYS.LOANS, list);
    return list[idx];
  },

  /** Loans are only ever removed while still active — a closed loan is kept
   * for its history and the UI doesn't offer a delete control for it. */
  remove(id) {
    const list = this.all().filter((l) => l.id !== id);
    window.Storage.set(window.STORAGE_KEYS.LOANS, list);
  },

  get(id) {
    return this.all().find((l) => l.id === id) || null;
  },

  /**
   * Log a payment (borrowed: you pay down; lent: they repay you).
   * Accepts either a plain number (legacy) or { amount, date, notes }.
   * Reduces balance, appends to the payment history, advances the next
   * due date by one repayment period (1 month for EMI, 12 for yearly),
   * and decrements the remaining installment count. Clamped at 0.
   */
  applyPayment(id, entry) {
    const record = this.get(id);
    if (!record) return null;

    const amount = typeof entry === 'number' ? entry : Number(entry.amount);
    const date = (entry && typeof entry === 'object' && entry.date) || new Date().toISOString().slice(0, 10);
    const notes = (entry && typeof entry === 'object' && entry.notes) || '';

    const remainingBalance = Math.max(0, record.remainingBalance - amount);
    const step = record.repaymentType === 'yearly' ? 12 : 1;
    const remainingMonths = Math.max(0, (record.remainingMonths || 0) - step);
    const payments = [...(record.payments || []), { id: Helpers.uid(), amount, date, notes }];

    let nextDueDate = record.nextDueDate;
    if (remainingBalance > 0 && record.nextDueDate) {
      const d = new Date(record.nextDueDate);
      d.setMonth(d.getMonth() + step);
      nextDueDate = d.toISOString().slice(0, 10);
    }

    return this.update(id, { remainingBalance, remainingMonths, nextDueDate, payments, date });
  },

  payments(id) {
    const record = this.get(id);
    return record ? (record.payments || []) : [];
  },

  /** Deletes one logged payment and recomputes the balance from scratch
   * (principal minus whatever payments remain) rather than trying to
   * reverse just that entry's effect — so it's correct no matter which
   * payment in the history gets deleted. remainingMonths/nextDueDate are
   * left as-is (they're an informational schedule estimate, not derived
   * reversibly); if the balance moves back above 0, `update()` re-opens
   * the loan automatically. */
  removePayment(id, paymentId) {
    const record = this.get(id);
    if (!record) return null;
    const payments = (record.payments || []).filter((p) => p.id !== paymentId);
    const paidTotal = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const remainingBalance = Math.max(0, Math.round((record.principal - paidTotal) * 100) / 100);
    return this.update(id, { payments, remainingBalance });
  },

  paidOffAmount(loan) {
    return Math.max(0, loan.principal - loan.remainingBalance);
  },

  percentPaid(loan) {
    return loan.principal > 0 ? Helpers.clamp((this.paidOffAmount(loan) / loan.principal) * 100, 0, 100) : 0;
  },

  isPaidOff(loan) {
    return loan.remainingBalance <= 0;
  },

  /** A simple projected schedule of the next `count` payments (date + amount),
   * spaced monthly for EMI loans or yearly for yearly-repayment loans. Display only. */
  upcomingSchedule(loan, count = 3) {
    const schedule = [];
    let balance = loan.remainingBalance;
    let date = loan.nextDueDate ? new Date(loan.nextDueDate) : new Date();
    const step = loan.repaymentType === 'yearly' ? 12 : 1;

    for (let i = 0; i < count && balance > 0; i++) {
      const amount = Math.min(loan.emi || balance, balance);
      schedule.push({ date: date.toISOString().slice(0, 10), amount });
      balance -= amount;
      date = new Date(date);
      date.setMonth(date.getMonth() + step);
    }
    return schedule;
  },
};

window.Loans = Loans;
