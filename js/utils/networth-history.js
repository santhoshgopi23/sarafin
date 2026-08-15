/**
 * networth-history.js (utils)
 * A lightweight historical log of net worth so the Net Worth page can chart
 * how it moves over time. Net worth itself is always derived live from
 * accounts/investments/loans/credit cards (see networth.js) — this just
 * keeps a dated snapshot each time that page is viewed, so a real trend
 * builds up the more the app gets used. Visiting again on the same day
 * updates that day's entry rather than adding a duplicate point.
 */
const NetWorthHistory = {
  all() {
    const list = window.Storage.get(window.STORAGE_KEYS.NET_WORTH_HISTORY, []);
    return [...list].sort((a, b) => new Date(a.date) - new Date(b.date));
  },

  /** Record (or overwrite) today's net worth snapshot and return the full sorted history. */
  record(netWorth, totalAssets, totalLiabilities) {
    const today = new Date().toISOString().slice(0, 10);
    const list = window.Storage.get(window.STORAGE_KEYS.NET_WORTH_HISTORY, []);
    const idx = list.findIndex((s) => s.date === today);
    const snapshot = { date: today, netWorth, totalAssets, totalLiabilities };

    if (idx === -1) list.push(snapshot);
    else list[idx] = snapshot;

    window.Storage.set(window.STORAGE_KEYS.NET_WORTH_HISTORY, list);
    return this.all();
  },
};

window.NetWorthHistory = NetWorthHistory;
