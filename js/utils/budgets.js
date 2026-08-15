/**
 * budgets.js
 * CRUD for the `budgets` storage key. Each budget is { id, category, limit }.
 * "Spent" is intentionally NOT stored here — it's always computed live from
 * this month's expense transactions in budget.js, so it can never go stale.
 */

const Budgets = {
  all() {
    return window.Storage.get(window.STORAGE_KEYS.BUDGETS, []);
  },

  add(budget) {
    const list = this.all();
    const record = { id: Helpers.uid(), ...budget };
    list.push(record);
    window.Storage.set(window.STORAGE_KEYS.BUDGETS, list);
    return record;
  },

  update(id, changes) {
    const list = this.all();
    const idx = list.findIndex((b) => b.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...changes };
    window.Storage.set(window.STORAGE_KEYS.BUDGETS, list);
    return list[idx];
  },

  remove(id) {
    const list = this.all().filter((b) => b.id !== id);
    window.Storage.set(window.STORAGE_KEYS.BUDGETS, list);
  },

  get(id) {
    return this.all().find((b) => b.id === id) || null;
  },

  hasCategory(category, excludingId = null) {
    return this.all().some((b) => b.category === category && b.id !== excludingId);
  },
};

window.Budgets = Budgets;
