/**
 * accounts.js (utils)
 * CRUD for the `accounts` storage key. Each account is
 * { id, name, type, balance }. Transfers adjust two account balances
 * atomically and don't create transaction records (a transfer is neither
 * income nor an expense, so it stays out of those reports).
 */

const AccountTypeMeta = {
  cash: { label: 'Cash', icon: 'fa-money-bill-wave', tone: 'tone-gold' },
  checking: { label: 'Current Account', icon: 'fa-building-columns', tone: 'tone-info' },
  savings: { label: 'Savings Account', icon: 'fa-piggy-bank', tone: 'tone-accent' },
  wallet: { label: 'Wallet', icon: 'fa-wallet', tone: 'tone-violet' },
};

const Accounts = {
  all() {
    return window.Storage.get(window.STORAGE_KEYS.ACCOUNTS, []);
  },

  add(account) {
    const list = this.all();
    const record = { id: Helpers.uid(), balance: 0, ...account };
    list.push(record);
    window.Storage.set(window.STORAGE_KEYS.ACCOUNTS, list);
    return record;
  },

  update(id, changes) {
    const list = this.all();
    const idx = list.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...changes };
    window.Storage.set(window.STORAGE_KEYS.ACCOUNTS, list);
    return list[idx];
  },

  remove(id) {
    const list = this.all().filter((a) => a.id !== id);
    window.Storage.set(window.STORAGE_KEYS.ACCOUNTS, list);
  },

  get(id) {
    return this.all().find((a) => a.id === id) || null;
  },

  /** Add `delta` (can be negative) to an account's balance. Used by income/expense entries to keep account balances in sync. No-op if the account no longer exists. */
  adjustBalance(id, delta) {
    if (!id || !delta) return null;
    const account = this.get(id);
    if (!account) return null;
    return this.update(id, { balance: account.balance + delta });
  },

  /** Move `amount` from one account to another. Returns { ok, error }. */
  transfer(fromId, toId, amount) {
    if (fromId === toId) return { ok: false, error: 'Choose two different accounts.' };
    if (!amount || amount <= 0) return { ok: false, error: 'Enter a positive amount.' };

    const list = this.all();
    const from = list.find((a) => a.id === fromId);
    const to = list.find((a) => a.id === toId);
    if (!from || !to) return { ok: false, error: 'Account not found.' };
    if (from.balance < amount) return { ok: false, error: `Insufficient funds in ${from.name}.` };

    from.balance -= amount;
    to.balance += amount;
    window.Storage.set(window.STORAGE_KEYS.ACCOUNTS, list);
    return { ok: true };
  },

  typeMeta(type) {
    return AccountTypeMeta[type] || { label: type, icon: 'fa-wallet', tone: 'tone-info' };
  },
};

window.Accounts = Accounts;
window.AccountTypeMeta = AccountTypeMeta;
