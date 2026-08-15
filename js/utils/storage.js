/**
 * storage.js
 * Thin wrapper around localStorage so the rest of the app never touches
 * `window.localStorage` directly. Centralizing this here means swapping in
 * Firebase Firestore later (Phase 12) only requires rewriting this file.
 */

const STORAGE_PREFIX = 'ledger:';

const Storage = {
  /**
   * Read a value from localStorage and parse it as JSON.
   * @param {string} key
   * @param {*} fallback - value returned if the key doesn't exist yet
   */
  get(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      console.error(`Storage.get failed for "${key}"`, err);
      return fallback;
    }
  },

  /**
   * Write a value to localStorage as JSON.
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.error(`Storage.set failed for "${key}"`, err);
      return false;
    }
  },

  remove(key) {
    window.localStorage.removeItem(STORAGE_PREFIX + key);
  },

  /** Remove every key this app owns (used by Settings > Delete All Data). */
  clearAll() {
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(STORAGE_PREFIX))
      .forEach((k) => window.localStorage.removeItem(k));
  },

  /**
   * Seed a key with default data only if it doesn't already exist.
   * Called once on first load so the dashboard never looks empty.
   */
  seedIfEmpty(key, defaultValue) {
    if (window.localStorage.getItem(STORAGE_PREFIX + key) === null) {
      this.set(key, defaultValue);
    }
  },
};

// Storage keys used across the app — kept in one place to avoid typos.
const KEYS = {
  ACCOUNTS: 'accounts',
  TRANSACTIONS: 'transactions',
  CREDIT_CARDS: 'creditCards',
  LOANS: 'loans',
  BUDGETS: 'budgets',
  GOALS: 'goals',
  TAGS: 'tags',
  CATEGORIES: 'categories',
  BILLS: 'bills',
  INVESTMENTS: 'investments',
  INVESTMENT_LOTS: 'investmentLots',
  TRADEBOOK_UNMATCHED: 'zerodhaTradebookUnmatched',
  TRADEBOOK_ACTIVITY_UPDATED: 'zerodhaTradebookActivityUpdated',
  TRADEBOOK_CURRENT_UPDATED: 'zerodhaTradebookCurrentUpdated',
  TRADEBOOK_CLOSED_UPDATED: 'zerodhaTradebookClosedUpdated',
  // Mutual Fund trade book — kept fully separate from the Equity trade book above.
  TRADEBOOK_UNMATCHED_MF: 'zerodhaTradebookUnmatchedMf',
  TRADEBOOK_ACTIVITY_UPDATED_MF: 'zerodhaTradebookActivityUpdatedMf',
  TRADEBOOK_CURRENT_UPDATED_MF: 'zerodhaTradebookCurrentUpdatedMf',
  TRADEBOOK_CLOSED_UPDATED_MF: 'zerodhaTradebookClosedUpdatedMf',
  DIVIDENDS: 'investmentDividends',
  // Manual Zerodha CSV-name → holding mappings (Trade Book + Dividends share this).
  ZD_SYMBOL_ALIASES: 'zerodhaSymbolAliases',
  NET_WORTH_HISTORY: 'netWorthHistory',
  SETTINGS: 'settings',
  ALLOCATION_TARGETS: 'allocationTargets',
};

window.Storage = Storage;
window.STORAGE_KEYS = KEYS;
