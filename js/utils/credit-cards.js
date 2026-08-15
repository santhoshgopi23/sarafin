/**
 * credit-cards.js (utils)
 * CRUD for the `creditCards` storage key. Each card is
 * { id, name, limit, used, dueDate, minPayment }. Available credit and
 * utilization % are always derived, never stored, so they can't drift.
 */

const CreditCards = {
  all() {
    return window.Storage.get(window.STORAGE_KEYS.CREDIT_CARDS, []);
  },

  add(card) {
    const list = this.all();
    const record = { id: Helpers.uid(), used: 0, ...card };
    list.push(record);
    window.Storage.set(window.STORAGE_KEYS.CREDIT_CARDS, list);
    return record;
  },

  update(id, changes) {
    const list = this.all();
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...changes };
    window.Storage.set(window.STORAGE_KEYS.CREDIT_CARDS, list);
    return list[idx];
  },

  remove(id) {
    const list = this.all().filter((c) => c.id !== id);
    window.Storage.set(window.STORAGE_KEYS.CREDIT_CARDS, list);
  },

  get(id) {
    return this.all().find((c) => c.id === id) || null;
  },

  available(card) {
    return Math.max(0, card.limit - card.used);
  },

  utilization(card) {
    return card.limit > 0 ? Helpers.clamp((card.used / card.limit) * 100, 0, 999) : 0;
  },
};

window.CreditCards = CreditCards;
