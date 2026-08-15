/**
 * transactions.js
 * All reads/writes to the `transactions` storage key go through here so
 * expense.html, income.html, budget.html, and reports.html stay in sync
 * and never duplicate CRUD logic.
 */

const Transactions = {
  all() {
    return window.Storage.get(window.STORAGE_KEYS.TRANSACTIONS, []);
  },

  byType(type) {
    return this.all().filter((t) => t.type === type);
  },

  add(transaction) {
    const list = this.all();
    const record = { id: Helpers.uid(), ...transaction };
    list.push(record);
    window.Storage.set(window.STORAGE_KEYS.TRANSACTIONS, list);
    return record;
  },

  update(id, changes) {
    const list = this.all();
    const idx = list.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...changes };
    window.Storage.set(window.STORAGE_KEYS.TRANSACTIONS, list);
    return list[idx];
  },

  remove(id) {
    const list = this.all().filter((t) => t.id !== id);
    window.Storage.set(window.STORAGE_KEYS.TRANSACTIONS, list);
  },

  get(id) {
    return this.all().find((t) => t.id === id) || null;
  },

  /** Filter a list of transactions by search term, category, month ('all' or 0-11), and tag id ('all' or a tag id). */
  filterList(list, { term = '', category = 'all', month = 'all', tag = 'all' } = {}) {
    return list.filter((t) => {
      const matchesTerm = !term || `${t.title} ${t.category}`.toLowerCase().includes(term.toLowerCase());
      const matchesCategory = category === 'all' || t.category === category;
      const matchesMonth = month === 'all' || new Date(t.date).getMonth() === Number(month);
      const matchesTag = tag === 'all' || (t.tags || []).includes(tag);
      return matchesTerm && matchesCategory && matchesMonth && matchesTag;
    });
  },

  sumByCategory(list) {
    const totals = {};
    list.forEach((t) => {
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    });
    return totals;
  },

  total(list) {
    return list.reduce((sum, t) => sum + t.amount, 0);
  },

  /** Trigger a CSV file download for the given list of transactions. */
  exportCSV(list, filename = 'transactions.csv') {
    const header = ['Date', 'Title', 'Category', 'Amount', 'Account'];
    const rows = list.map((t) => [t.date, t.title, t.category, t.amount.toFixed(2), t.account || '']);
    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

function csvEscape(value) {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

window.Transactions = Transactions;
