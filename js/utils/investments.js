/**
 * investments.js (utils)
 * CRUD for the `investments` storage key. Each holding is
 * { id, name, type, value, costBasis }. Profit/loss is always derived
 * (value - costBasis), never stored.
 *
 * Stocks (type === 'Stocks') can optionally be linked to a live NSE/BSE
 * ticker for real market prices, adding: { symbol, exchangeLabel, quantity,
 * avgPrice, lastPriceUpdate }. When linked, `value` is derived as
 * quantity × live price and `costBasis` as quantity × avgPrice, kept in
 * sync by MarketData.getQuote() + Investments.applyLivePrice().
 */


const InvestmentTypeMeta = {
  // Equity
  Stocks: { icon: 'fa-chart-line', tone: 'tone-info' },
  'Direct Stocks': { icon: 'fa-chart-line', tone: 'tone-info' },
  ETF: { icon: 'fa-layer-group', tone: 'tone-accent' },
  'Equity ETFs': { icon: 'fa-layer-group', tone: 'tone-accent' },
  'Mutual Funds': { icon: 'fa-sitemap', tone: 'tone-violet' },
  'Equity Mutual Funds': { icon: 'fa-sitemap', tone: 'tone-violet' },
  'Hybrid Mutual Funds': { icon: 'fa-shuffle', tone: 'tone-violet' },
  'Arbitrage Funds': { icon: 'fa-arrows-left-right', tone: 'tone-violet' },
  ESOP: { icon: 'fa-handshake', tone: 'tone-info' },

  // Debt — Fixed Deposits & Deposits
  FD: { icon: 'fa-piggy-bank', tone: 'tone-violet' },
  'Bank Fixed Deposit (FD)': { icon: 'fa-piggy-bank', tone: 'tone-violet' },
  'Corporate Fixed Deposit (FD)': { icon: 'fa-piggy-bank', tone: 'tone-violet' },
  'Recurring Deposit (RD)': { icon: 'fa-calendar-check', tone: 'tone-violet' },

  // Debt — Bonds
  'Government Bonds': { icon: 'fa-landmark', tone: 'tone-violet' },
  'Corporate Bonds': { icon: 'fa-file-contract', tone: 'tone-violet' },
  'Tax-Free Bonds': { icon: 'fa-receipt', tone: 'tone-violet' },
  'Sovereign Gold Bonds': { icon: 'fa-coins', tone: 'tone-gold' },

  // Debt — Government Schemes
  CPF: { icon: 'fa-building-columns', tone: 'tone-info' },
  EPF: { icon: 'fa-building-columns', tone: 'tone-info' },
  PPF: { icon: 'fa-building-columns', tone: 'tone-info' },
  SSY: { icon: 'fa-child-reaching', tone: 'tone-info' },
  'Government Savings Scheme': { icon: 'fa-building-columns', tone: 'tone-info' },

  // Debt — Mutual Funds / ETFs
  'Debt Mutual Funds': { icon: 'fa-sitemap', tone: 'tone-violet' },
  'Debt ETFs': { icon: 'fa-layer-group', tone: 'tone-violet' },

  // Real Estate
  Property: { icon: 'fa-house', tone: 'tone-gold' },
  REIT: { icon: 'fa-city', tone: 'tone-gold' },
  InvIT: { icon: 'fa-road', tone: 'tone-gold' },

  // Commodity
  Gold: { icon: 'fa-coins', tone: 'tone-gold' },
  'Physical Gold': { icon: 'fa-coins', tone: 'tone-gold' },
  'Physical Silver': { icon: 'fa-certificate', tone: 'tone-gold' },
  'Digital Gold / Silver': { icon: 'fa-coins', tone: 'tone-gold' },

  // Crypto
  Crypto: { icon: 'fa-bitcoin-sign', tone: 'tone-gold' },
  'Crypto Tokens / Coins': { icon: 'fa-bitcoin-sign', tone: 'tone-gold' },
  'Crypto ETFs': { icon: 'fa-layer-group', tone: 'tone-gold' },

  // Others
  'Foreign Investment': { icon: 'fa-earth-americas', tone: 'tone-accent' },
  'Other Assets': { icon: 'fa-box', tone: 'tone-info' },
};

const Investments = {
  all() {
    return window.Storage.get(window.STORAGE_KEYS.INVESTMENTS, []);
  },

  add(inv) {
    const list = this.all();
    const record = { id: Helpers.uid(), date: new Date().toISOString().slice(0, 10), ...inv };
    list.push(record);
    window.Storage.set(window.STORAGE_KEYS.INVESTMENTS, list);
    return record;
  },

  update(id, changes) {
    const list = this.all();
    const idx = list.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...changes };
    window.Storage.set(window.STORAGE_KEYS.INVESTMENTS, list);
    return list[idx];
  },

  remove(id) {
    const list = this.all().filter((i) => i.id !== id);
    window.Storage.set(window.STORAGE_KEYS.INVESTMENTS, list);
  },

  get(id) {
    return this.all().find((i) => i.id === id) || null;
  },

  profitLoss(inv) {
    return inv.value - inv.costBasis;
  },

  profitLossPct(inv) {
    return inv.costBasis > 0 ? ((inv.value - inv.costBasis) / inv.costBasis) * 100 : 0;
  },

  typeMeta(type) {
    return InvestmentTypeMeta[type] || { icon: 'fa-coins', tone: 'tone-info' };
  },

  /** True if this holding is linked to a live NSE/BSE ticker. */
  isLive(inv) {
    return (inv.type === 'Stocks' || inv.type === 'Direct Stocks') && !!inv.symbol && !!inv.quantity;
  },

  /** True if this holding tracks quantity × price/unit (live-linked or manual quantity mode). */
  hasUnits(inv) {
    return !!inv.quantity && inv.quantity > 0;
  },

  /** Current price per unit, whichever mode this holding uses. Null if not unit-tracked. */
  unitPrice(inv) {
    if (!this.hasUnits(inv)) return null;
    if (this.isLive(inv)) return typeof inv.lastPrice === 'number' ? inv.lastPrice : null;
    return typeof inv.currentPrice === 'number' ? inv.currentPrice : null;
  },

  /**
   * Today's change for a holding, in currency and percent. Only available
   * for live-linked holdings where the provider returned a previous close
   * (Alpha Vantage does, Groww's LTP endpoint doesn't). Returns null when
   * unknown, so callers can render "—" instead of a misleading 0.
   */
  dayChange(inv) {
    if (typeof inv.dayChangeAmt !== 'number' || typeof inv.dayChangePct !== 'number') return null;
    return { amt: inv.dayChangeAmt, pct: inv.dayChangePct };
  },

  /** Sum of known day changes across holdings; hasData is false if none had one. */
  totalDayPL(holdings) {
    const known = holdings.filter((i) => typeof i.dayChangeAmt === 'number');
    const amt = known.reduce((sum, i) => sum + i.dayChangeAmt, 0);
    return { amt, hasData: known.length > 0 };
  },

  /**
   * Refetch the live price for a linked holding and update its stored
   * value/costBasis/lastPriceUpdate in place. Throws if the fetch fails
   * (caller decides how to surface that, e.g. via Toast).
   */
  async refreshLivePrice(id) {
    const record = this.get(id);
    if (!record || !this.isLive(record)) return record;

    // Use whichever provider this holding was linked under (falls back to
    // the currently-active provider for older records saved before this
    // field existed), so switching the default provider in Settings later
    // doesn't break existing links.
    const { price, previousClose } = await window.MarketData.getQuoteDetailed(record.symbol, record.provider);

    const dayChangeAmt = previousClose ? (price - previousClose) * record.quantity : null;
    const dayChangePct = previousClose ? ((price - previousClose) / previousClose) * 100 : null;

    return this.update(id, {
      value: price * record.quantity,
      costBasis: record.avgPrice * record.quantity,
      lastPrice: price,
      lastPriceUpdate: new Date().toISOString(),
      dayChangeAmt,
      dayChangePct,
    });
  },

  /** Refresh every linked stock holding, one at a time (Alpha Vantage free tier is rate-limited). */
  async refreshAllLivePrices({ onProgress } = {}) {
    const holdings = this.all().filter((i) => this.isLive(i));
    const results = { updated: 0, failed: [] };
    for (const holding of holdings) {
      try {
        await this.refreshLivePrice(holding.id);
        results.updated += 1;
      } catch (err) {
        results.failed.push({ holding, err });
      }
      if (onProgress) onProgress(results, holding);
    }
    return results;
  },

  /**
   * Amount invested (cost basis) grouped by calendar month, based on each
   * holding's entry `date`. Returns the last `monthsBack` months in
   * chronological order, e.g. [{ key:'2026-03', label:'Mar 2026', amount:12000 }, ...],
   * so the "monthly investment" bar chart always has a fixed, readable window.
   */
  monthlySeries(holdings, monthsBack = 6) {
    const now = new Date();
    const buckets = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        amount: 0,
      });
    }
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
    holdings.forEach((inv) => {
      if (!inv.date) return;
      const d = new Date(inv.date);
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (byKey[key]) byKey[key].amount += inv.costBasis;
    });
    return buckets;
  },

  /** Total invested (cost basis) for holdings entered in the current calendar month. */
  investedThisMonth(holdings) {
    const now = new Date();
    return holdings
      .filter((i) => {
        if (!i.date) return false;
        const d = new Date(i.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, i) => sum + i.costBasis, 0);
  },

  /**
   * Cumulative "how my investing has grown" series — built from actual
   * purchase history (HoldingLots: each buy adds, each sell subtracts,
   * quantity × price at the time), falling back to a holding's own entry
   * date + cost basis for value-only holdings that have no lot history
   * (FDs, property, gold entered as a lump value, etc). Events are
   * bucketed by month and run as a cumulative total (floored at 0), so
   * the line rises on buys and drops on sells.
   *
   * Deliberately principal-only: this tracks net capital invested, never
   * current market value or returns — that's what makes it "growth of
   * investment" rather than a P&L chart. Returns [] when there's no
   * dated history to plot yet.
   */
  growthSeries(holdings) {
    const events = [];

    holdings.forEach((inv) => {
      const lots = (typeof HoldingLots !== 'undefined') ? HoldingLots.forHolding(inv.id) : [];
      if (lots.length > 0) {
        lots.forEach((lot) => {
          const amount = (Number(lot.quantity) || 0) * (Number(lot.price) || 0);
          if (!lot.date || amount <= 0) return;
          // Sell lots reduce invested capital; buy lots add to it.
          events.push({ date: lot.date, amount: lot.type === 'sell' ? -amount : amount });
        });
      } else if (inv.date && inv.costBasis > 0) {
        events.push({ date: inv.date, amount: inv.costBasis });
      }
    });

    if (events.length === 0) return [];

    const byMonth = {};
    events.forEach((e) => {
      const d = new Date(e.date);
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth[key] = (byMonth[key] || 0) + e.amount;
    });

    const sortedKeys = Object.keys(byMonth).sort();
    let running = 0;
    return sortedKeys.map((key) => {
      running = Math.max(0, running + byMonth[key]);
      const [y, m] = key.split('-').map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      return { key, label, invested: Math.round(running * 100) / 100 };
    });
  },
};

/**
 * Dividends — a lightweight record of dividend/interest payouts received
 * against an existing holding. Each entry is
 * { id, holdingId, holdingName, holdingType, amount, date, notes }.
 * `holdingName`/`holdingType` are copied at entry time so the history
 * still reads correctly even if the holding is later renamed or removed.
 */
/**
 * HoldingLots — purchase history for a holding: each time you buy in
 * (the original purchase, or a later "Add Entry"), a lot is recorded as
 * { id, holdingId, date, quantity, price }. Purely additive/view-only —
 * the holding's aggregate quantity/avgPrice/costBasis/value are still the
 * source of truth for calculations; lots are just the audit trail behind
 * "History" in the holding detail popup.
 */
const HoldingLots = {
  all() {
    return window.Storage.get(window.STORAGE_KEYS.INVESTMENT_LOTS, []);
  },

  add(lot) {
    const list = this.all();
    const record = { id: Helpers.uid(), ...lot };
    list.push(record);
    window.Storage.set(window.STORAGE_KEYS.INVESTMENT_LOTS, list);
    return record;
  },

  forHolding(holdingId) {
    return this.all()
      .filter((l) => l.holdingId === holdingId)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  remove(id) {
    const list = this.all().filter((l) => l.id !== id);
    window.Storage.set(window.STORAGE_KEYS.INVESTMENT_LOTS, list);
  },

  get(id) {
    return this.all().find((l) => l.id === id) || null;
  },

  earliestDate(holdingId) {
    const lots = this.forHolding(holdingId);
    if (lots.length === 0) return null;
    return lots.reduce((min, l) => (new Date(l.date) < new Date(min) ? l.date : min), lots[0].date);
  },
};

const Dividends = {
  all() {
    return window.Storage.get(window.STORAGE_KEYS.DIVIDENDS, []);
  },

  add(div) {
    const list = this.all();
    const record = { id: Helpers.uid(), date: new Date().toISOString().slice(0, 10), ...div };
    list.push(record);
    window.Storage.set(window.STORAGE_KEYS.DIVIDENDS, list);
    return record;
  },

  update(id, changes) {
    const list = this.all();
    const idx = list.findIndex((d) => d.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...changes };
    window.Storage.set(window.STORAGE_KEYS.DIVIDENDS, list);
    return list[idx];
  },

  remove(id) {
    const list = this.all().filter((d) => d.id !== id);
    window.Storage.set(window.STORAGE_KEYS.DIVIDENDS, list);
  },

  get(id) {
    return this.all().find((d) => d.id === id) || null;
  },

  totalAll(list = this.all()) {
    return list.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  },

  totalThisMonth(list = this.all()) {
    const now = new Date();
    return list
      .filter((d) => {
        const dt = new Date(d.date);
        return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
      })
      .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  },

  totalThisYear(list = this.all()) {
    const now = new Date();
    return list
      .filter((d) => new Date(d.date).getFullYear() === now.getFullYear())
      .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  },
};

window.Investments = Investments;
window.InvestmentTypeMeta = InvestmentTypeMeta;
window.Dividends = Dividends;
window.HoldingLots = HoldingLots;
