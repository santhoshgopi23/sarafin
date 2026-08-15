(function () {
/**
 * investments.js (page)
 * Powers investments.html: a Zerodha-style portfolio summary (Invested,
 * Current Value, Day's P&L, Total P&L), a professional holdings table,
 * an allocation doughnut chart, and a by-type breakdown. Add/edit supports
 * three ways to price a holding: (1) live NSE/BSE linking for Stocks, (2)
 * generic quantity × price/unit tracking for anything else (or Stocks
 * without a live link), (3) a manual total Value/Cost Basis fallback.
 */

const state = { editingId: null, selectedSymbol: null, searchDebounce: null, expandedGroups: new Set(), expandedTypes: new Set() };

/** Asset classes shown in the Asset Overview + Asset Classes accordion, in display order. */
const ASSET_GROUPS = [
  {
    key: 'equity', label: 'Equity', icon: 'fa-arrow-trend-up', tone: 'tone-info',
    types: ['Stocks', 'ETF', 'Mutual Funds', 'Direct Stocks', 'Equity Mutual Funds', 'Hybrid Mutual Funds', 'Arbitrage Funds', 'Equity ETFs', 'ESOP'],
  },
  {
    key: 'debt', label: 'Debt', icon: 'fa-building-columns', tone: 'tone-violet',
    types: ['FD', 'CPF', 'EPF', 'Bank Fixed Deposit (FD)', 'Corporate Fixed Deposit (FD)', 'Recurring Deposit (RD)', 'Government Bonds', 'Corporate Bonds', 'Tax-Free Bonds', 'Sovereign Gold Bonds', 'PPF', 'SSY', 'Government Savings Scheme', 'Debt Mutual Funds', 'Debt ETFs'],
  },
  {
    key: 'real-estate', label: 'Real Estate', icon: 'fa-house', tone: 'tone-gold',
    types: ['Property', 'REIT', 'InvIT'],
  },
  {
    key: 'commodity', label: 'Commodity', icon: 'fa-coins', tone: 'tone-gold',
    types: ['Gold', 'Physical Gold', 'Physical Silver', 'Digital Gold / Silver'],
  },
  {
    key: 'crypto', label: 'Crypto', icon: 'fa-bitcoin-sign', tone: 'tone-violet',
    types: ['Crypto', 'Crypto Tokens / Coins', 'Crypto ETFs'],
  },
  {
    key: 'other', label: 'Others', icon: 'fa-earth-americas', tone: 'tone-accent',
    types: ['Foreign Investment', 'Other Assets'],
  },
];

/** True for any type string representing direct/live-linkable equity shares. */
function isStockType(type) {
  return type === 'Stocks' || type === 'Direct Stocks';
}

/**
 * Per-type entry-form field configuration — the labels, placeholders and
 * defaults shown in the Add/Edit Asset form and the "Add Entry" (average-in)
 * form change based on what kind of asset is being tracked, mirroring how
 * real portfolio trackers (Groww, Kuvera, INDmoney, Coin by Zerodha) ask for
 * the fields that actually make sense for that asset — e.g. weight & rate
 * per gram for physical gold, units & NAV for mutual funds, quantity &
 * price/share for stocks, principal & maturity value for fixed deposits.
 * Anything not listed falls back to DEFAULT_FIELD_CONFIG.
 */
const DEFAULT_FIELD_CONFIG = {
  qtyLabel: 'Quantity / Units',
  qtyPlaceholder: '0',
  qtyStep: 'any',
  priceLabel: 'Buy Price (per unit)',
  currentPriceLabel: 'Current Price (per unit)',
  pricePlaceholder: '0.00',
  toggleLabel: 'Track by quantity & price per unit',
  helpText: 'Invested amount and Current Value below are calculated automatically \u2014 update the current price whenever you check it, to keep P&L accurate.',
  valueLabel: 'Current Value',
  costLabel: 'Cost Basis / Invested',
  valueHelpText: 'Cost basis is what you originally paid \u2014 used to calculate profit/loss.',
  qtyMode: 'toggle', // 'toggle' = user can switch, 'forceUnits' = always unit-tracked, 'forceManual' = always lump sum, hides the toggle
  purity: null,
};

const GOLD_PURITY_OPTIONS = ['24K (999 / 99.9%)', '22K (916 / 91.6%)', '18K (750 / 75%)', 'Other / Mixed'];
const SILVER_PURITY_OPTIONS = ['999 Fine (99.9%)', '925 Sterling (92.5%)', 'Other / Mixed'];

const GOLD_WEIGHT_FIELD = {
  qtyLabel: 'Weight (grams)', qtyPlaceholder: '0.000', qtyStep: '0.001',
  priceLabel: 'Rate per gram (\u20b9) at purchase', pricePlaceholder: '0.00',
  currentPriceLabel: "Today's rate per gram (\u20b9)",
  toggleLabel: 'Track by weight & rate per gram',
  helpText: 'Invested amount and Current Value are calculated automatically from weight \u00d7 rate \u2014 update today\u2019s rate per gram whenever you check it.',
  qtyMode: 'forceUnits',
};

const UNIT_NAV_FIELD = {
  qtyLabel: 'Units', qtyPlaceholder: '0.000', qtyStep: '0.001',
  priceLabel: 'Buy NAV (\u20b9 per unit)', pricePlaceholder: '0.00',
  currentPriceLabel: 'Current NAV (\u20b9 per unit)',
  toggleLabel: 'Track by units & NAV',
  helpText: 'Invested amount and Current Value are calculated automatically from units \u00d7 NAV \u2014 update the current NAV whenever you check it.',
  qtyMode: 'forceUnits',
};

const LUMP_SUM_FIELD = {
  qtyMode: 'forceManual',
};

const INV_FIELD_CONFIG = {
  // Equity
  Stocks: { qtyLabel: 'Quantity / Shares', priceLabel: 'Buy Price (per share, \u20b9)', currentPriceLabel: 'Current Price (per share, \u20b9)', toggleLabel: 'Track by quantity & price per share', qtyStep: '1' },
  'Direct Stocks': { qtyLabel: 'Quantity / Shares', priceLabel: 'Buy Price (per share, \u20b9)', currentPriceLabel: 'Current Price (per share, \u20b9)', toggleLabel: 'Track by quantity & price per share', qtyStep: '1' },
  ETF: { qtyLabel: 'Units', priceLabel: 'Buy Price (per unit, \u20b9)', currentPriceLabel: 'Current Price (per unit, \u20b9)', toggleLabel: 'Track by units & price', qtyMode: 'forceUnits' },
  'Equity ETFs': { qtyLabel: 'Units', priceLabel: 'Buy Price (per unit, \u20b9)', currentPriceLabel: 'Current Price (per unit, \u20b9)', toggleLabel: 'Track by units & price', qtyMode: 'forceUnits' },
  'Mutual Funds': UNIT_NAV_FIELD,
  'Equity Mutual Funds': UNIT_NAV_FIELD,
  'Hybrid Mutual Funds': UNIT_NAV_FIELD,
  'Arbitrage Funds': UNIT_NAV_FIELD,
  'Debt Mutual Funds': UNIT_NAV_FIELD,
  'Debt ETFs': { qtyLabel: 'Units', priceLabel: 'Buy Price (per unit, \u20b9)', currentPriceLabel: 'Current Price (per unit, \u20b9)', toggleLabel: 'Track by units & price', qtyMode: 'forceUnits' },
  ESOP: { qtyLabel: 'Number of Shares / Options', priceLabel: 'Grant / Exercise Price (per share, \u20b9)', currentPriceLabel: 'Current FMV (per share, \u20b9)', toggleLabel: 'Track by shares & price' },

  // Debt — lump-sum deposits & government schemes
  FD: { ...LUMP_SUM_FIELD, valueLabel: 'Maturity Value (Expected)', costLabel: 'Principal Amount Invested', valueHelpText: 'Principal is what you deposited; Maturity Value is what it will be worth (or is currently worth) including accrued interest.' },
  'Bank Fixed Deposit (FD)': { ...LUMP_SUM_FIELD, valueLabel: 'Maturity Value (Expected)', costLabel: 'Principal Amount Invested', valueHelpText: 'Principal is what you deposited; Maturity Value is what it will be worth (or is currently worth) including accrued interest.' },
  'Corporate Fixed Deposit (FD)': { ...LUMP_SUM_FIELD, valueLabel: 'Maturity Value (Expected)', costLabel: 'Principal Amount Invested', valueHelpText: 'Principal is what you deposited; Maturity Value is what it will be worth (or is currently worth) including accrued interest.' },
  'Recurring Deposit (RD)': { ...LUMP_SUM_FIELD, valueLabel: 'Maturity Value (Expected)', costLabel: 'Total Deposited So Far', valueHelpText: 'Total Deposited is the sum of instalments paid so far; Maturity Value is the expected payout including interest.' },
  CPF: { ...LUMP_SUM_FIELD, valueLabel: 'Current Balance', costLabel: 'Total Contributed' },
  EPF: { ...LUMP_SUM_FIELD, valueLabel: 'Current Balance', costLabel: 'Total Contributed' },
  PPF: { ...LUMP_SUM_FIELD, valueLabel: 'Current Balance', costLabel: 'Total Contributed' },
  SSY: { ...LUMP_SUM_FIELD, valueLabel: 'Current Balance', costLabel: 'Total Contributed' },
  'Government Savings Scheme': { ...LUMP_SUM_FIELD, valueLabel: 'Current Balance', costLabel: 'Total Contributed' },

  // Debt — Bonds
  'Government Bonds': { qtyLabel: 'Number of Bonds/Units', priceLabel: 'Buy Price (per bond, \u20b9)', currentPriceLabel: 'Current Price (per bond, \u20b9)', toggleLabel: 'Track by number of bonds & price' },
  'Corporate Bonds': { qtyLabel: 'Number of Bonds/Units', priceLabel: 'Buy Price (per bond, \u20b9)', currentPriceLabel: 'Current Price (per bond, \u20b9)', toggleLabel: 'Track by number of bonds & price' },
  'Tax-Free Bonds': { qtyLabel: 'Number of Bonds/Units', priceLabel: 'Buy Price (per bond, \u20b9)', currentPriceLabel: 'Current Price (per bond, \u20b9)', toggleLabel: 'Track by number of bonds & price' },
  'Sovereign Gold Bonds': { qtyLabel: 'Quantity (grams)', qtyPlaceholder: '0.000', qtyStep: '0.001', priceLabel: 'Issue Price (\u20b9 per gram)', currentPriceLabel: "Current gold price (\u20b9 per gram)", toggleLabel: 'Track by grams & price per gram', qtyMode: 'forceUnits' },

  // Real Estate
  Property: { ...LUMP_SUM_FIELD, valueLabel: 'Current Market Value', costLabel: 'Purchase Price (incl. stamp duty/registration)' },
  REIT: { qtyLabel: 'Units', priceLabel: 'Buy Price (per unit, \u20b9)', currentPriceLabel: 'Current Price (per unit, \u20b9)', toggleLabel: 'Track by units & price', qtyMode: 'forceUnits' },
  InvIT: { qtyLabel: 'Units', priceLabel: 'Buy Price (per unit, \u20b9)', currentPriceLabel: 'Current Price (per unit, \u20b9)', toggleLabel: 'Track by units & price', qtyMode: 'forceUnits' },

  // Commodity — physical/digital gold & silver
  Gold: { ...GOLD_WEIGHT_FIELD, purity: GOLD_PURITY_OPTIONS },
  'Physical Gold': { ...GOLD_WEIGHT_FIELD, purity: GOLD_PURITY_OPTIONS },
  'Physical Silver': { ...GOLD_WEIGHT_FIELD, purity: SILVER_PURITY_OPTIONS },
  'Digital Gold / Silver': { ...GOLD_WEIGHT_FIELD, qtyStep: '0.0001', qtyPlaceholder: '0.0000', purity: GOLD_PURITY_OPTIONS },

  // Crypto
  Crypto: { qtyLabel: 'Quantity (coins/tokens)', qtyPlaceholder: '0.00000000', qtyStep: 'any', priceLabel: 'Buy Price (per coin, \u20b9)', currentPriceLabel: 'Current Price (per coin, \u20b9)', toggleLabel: 'Track by quantity & price per coin', qtyMode: 'forceUnits' },
  'Crypto Tokens / Coins': { qtyLabel: 'Quantity (coins/tokens)', qtyPlaceholder: '0.00000000', qtyStep: 'any', priceLabel: 'Buy Price (per coin, \u20b9)', currentPriceLabel: 'Current Price (per coin, \u20b9)', toggleLabel: 'Track by quantity & price per coin', qtyMode: 'forceUnits' },
  'Crypto ETFs': { qtyLabel: 'Units', priceLabel: 'Buy Price (per unit, \u20b9)', currentPriceLabel: 'Current Price (per unit, \u20b9)', toggleLabel: 'Track by units & price', qtyMode: 'forceUnits' },
};

function getFieldConfig(type) {
  return { ...DEFAULT_FIELD_CONFIG, ...(INV_FIELD_CONFIG[type] || {}) };
}

document.addEventListener('DOMContentLoaded', () => {
  Modal.bindTriggers();
  bindForm();
  bindLiveStockControls();
  bindGenQtyControls();
  bindRefreshButton();
  bindHoldingsFilters();
  bindHoldingDetail();
  bindDividendForm();
  bindDividendFilters();
  bindExportButtons();
  bindInvestmentExport();
  bindCollapsibleSections();
  renderPeriodInvestmentsBanner();
  render();
});

/** Chevron-arrow expand/collapse for the Holdings and Dividends section
 *  cards — click the arrow to hide the body, click again to bring it back. */
function bindCollapsibleSections() {
  document.querySelectorAll('[data-collapse-toggle]').forEach((btn) => {
    const key = btn.dataset.collapseToggle;
    const body = document.querySelector(`[data-collapse-body="${key}"]`);
    if (!body) return;
    btn.addEventListener('click', () => {
      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? '' : 'none';
      btn.classList.toggle('is-collapsed', !isHidden);
    });
  });
}

function render() {
  const holdings = Investments.all();
  renderSummary(holdings);
  renderAssetOverview(holdings);
  renderHoldingsTable(getFilteredHoldings(holdings));
  renderAllocationCharts(holdings);
  renderMonthlyInvestmentChart(holdings);
  renderInvestmentGrowthChart(holdings);
  renderTypeBreakdown(holdings);
  renderDividends();
  renderAssetGroups(holdings);
}

/* ---------------- Unified grouped asset list (Cash & Savings + investment categories) ---------------- */

/** True for a Zerodha "holdings statement" import lot — a single lot
 *  created for a holding's ENTIRE quantity at the moment it was first
 *  imported, as opposed to a real individual buy/sell transaction (which
 *  always carries an orderId/tradeId from the tradebook CSV). If a
 *  tradebook import later adds the real per-transaction history for the
 *  same holding, this synthetic lot becomes redundant and double-counts
 *  everything if left in — so it needs to be dropped once real
 *  transaction-level lots exist. */
function isSnapshotLot(l) {
  return l.isSnapshot === true || (l.source === 'zerodha' && !('orderId' in l));
}

/** The lots to actually use for a holding: if it has any real
 *  transaction-level lots (from a tradebook import or a manual entry),
 *  the one-off Zerodha "holdings snapshot" lot — which duplicates
 *  quantity/amount already covered by those real lots — is left out.
 *  Otherwise (no tradebook ever imported) the snapshot lot is kept as the
 *  only history available, same as before. */
function pickRelevantLots(holdingId) {
  if (!window.HoldingLots) return [];
  const raw = window.HoldingLots.forHolding(holdingId);
  const hasTransactionLots = raw.some((l) => !isSnapshotLot(l));
  return hasTransactionLots ? raw.filter((l) => !isSnapshotLot(l)) : raw;
}

const groupsState = { collapsed: new Set(), filters: {}, sort: {}, duration: {}, customRange: {}, collapsedInitDone: false };

/** Bucket a holding's held-since date into a duration filter bucket.
 *  Holdings with no known date (e.g. plain cash accounts) fall outside
 *  every specific year and only show up under "All Durations". */
function durationBucketOf(dateStr) {
  if (!dateStr) return 'unknown';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime()) || d.getTime() > Date.now()) return 'unknown';
  return String(d.getFullYear());
}

/** Distinct years (newest first) an item was actually bought in, based on
 *  its full purchase-lot history (HoldingLots) when available — so a stock
 *  bought once in 2025 and again in 2026 shows up under BOTH years, not
 *  just the year of its earliest purchase. Items with no lot history (e.g.
 *  plain cash accounts) fall back to their single held-since date. */
function yearsForItem(item) {
  const years = new Set();
  const lots = item._lots || [];
  if (lots.length) {
    lots.forEach((l) => {
      const d = new Date(l.date);
      if (!Number.isNaN(d.getTime())) years.add(String(d.getFullYear()));
    });
  } else {
    const bucket = durationBucketOf(item.heldSinceDate);
    if (bucket !== 'unknown') years.add(bucket);
  }
  return years;
}

/** Distinct years (newest first) among a group's holdings, used to build
 *  the "Filter by year" dropdown. */
function yearsHeldIn(items) {
  const years = new Set();
  items.forEach((item) => yearsForItem(item).forEach((y) => years.add(y)));
  return Array.from(years).sort((a, b) => b - a);
}

/** Given a group's full item list and the currently selected duration
 *  filter, returns the list of items to actually display — with quantity,
 *  average price, invested amount, and current value recalculated from
 *  ONLY the purchase lots that fall inside the selected period, instead
 *  of the holding's all-time totals. An item with no purchases in the
 *  selected period is left out entirely (e.g. a stock bought only in 2025
 *  won't appear when "Held in 2026" is selected, and one bought in both
 *  years will appear with just its 2026 quantity/price/amount when 2026
 *  is selected). Items with no lot history (plain cash accounts, or
 *  holdings created before lot-tracking existed) fall back to matching by
 *  their single held-since date, shown at full value, same as before. */
function periodAdjustItems(items, duration, customRange) {
  if (duration === 'all') return items;

  const inRange = (dateStr) => {
    if (!dateStr) return false;
    if (customRange.from && dateStr < customRange.from) return false;
    if (customRange.to && dateStr > customRange.to) return false;
    return true;
  };

  const result = [];
  items.forEach((item) => {
    const lots = item._lots || [];
    if (lots.length) {
      const filteredLots = lots.filter((l) => {
        if (duration === 'custom') return inRange(l.date);
        const d = new Date(l.date);
        return !Number.isNaN(d.getTime()) && String(d.getFullYear()) === duration;
      });
      if (filteredLots.length === 0) return; // nothing bought in this period

      const signed = (l) => (l.type === 'sell' ? -1 : 1);
      const periodQty = filteredLots.reduce((s, l) => s + signed(l) * (Number(l.quantity) || 0), 0);
      const periodInvested = filteredLots.reduce((s, l) => s + signed(l) * (Number(l.quantity) || 0) * (Number(l.price) || 0), 0);
      const periodAvgPrice = periodQty > 0 ? periodInvested / periodQty : periodInvested;
      let periodValue;
      if (item.hasUnits && item.currentPrice) {
        periodValue = periodQty * item.currentPrice;
      } else if (item.invested > 0) {
        periodValue = item.value * (periodInvested / item.invested);
      } else {
        periodValue = periodInvested;
      }

      result.push({
        ...item,
        quantity: periodQty,
        avgPrice: periodAvgPrice,
        invested: periodInvested,
        value: periodValue,
        isPeriodFiltered: true,
        isPartialPeriod: filteredLots.length < lots.length,
      });
    } else if (duration === 'custom') {
      if (inRange(item.heldSinceDate)) result.push(item);
    } else if (durationBucketOf(item.heldSinceDate) === duration) {
      result.push(item);
    }
  });
  return result;
}

/** Filters an asset group's rows in place (no full re-render, so the
 *  search input keeps focus while typing) by name substring, then updates
 *  that group's footer total to reflect only the currently-visible rows.
 *  Duration/year filtering is no longer done here — it's baked into which
 *  rows exist at all (see periodAdjustItems), since selecting a year needs
 *  to change each row's displayed quantity/price/amount, not just hide it. */
function applyGroupFilters(key) {
  const rowsWrap = document.querySelector(`[data-group-rows="${key}"]`);
  const noMatch = document.querySelector(`[data-group-no-match="${key}"]`);
  if (!rowsWrap) return;
  const q = (groupsState.filters[key] || '').trim().toLowerCase();
  const durationActive = !!(groupsState.duration[key] && groupsState.duration[key] !== 'all');
  const rows = rowsWrap.querySelectorAll('.asset-row');
  let visibleCount = 0;
  let sumValue = 0;
  let sumInvested = 0;
  rows.forEach((row) => {
    const show = !q || (row.dataset.search || '').includes(q);
    row.style.display = show ? '' : 'none';
    if (show) {
      visibleCount += 1;
      sumValue += parseFloat(row.dataset.value) || 0;
      sumInvested += parseFloat(row.dataset.invested) || 0;
    }
  });
  const isFiltered = !!q || durationActive;
  if (noMatch) noMatch.style.display = isFiltered && visibleCount === 0 ? '' : 'none';
  updateGroupFooterTotal(key, sumValue, sumInvested, visibleCount, rows.length, isFiltered);
}

/** Recomputes and writes a group's bottom "Total" row from whichever
 *  rows are currently visible, so it always matches the active
 *  search/duration filter instead of the group's grand total. */
function updateGroupFooterTotal(key, sumValue, sumInvested, visibleCount, totalCount, isFiltered) {
  const footer = document.querySelector(`[data-group-footer-total="${key}"]`);
  if (!footer) return;
  const pl = sumValue - sumInvested;
  const plPct = sumInvested > 0 ? (pl / sumInvested) * 100 : 0;
  const labelEl = footer.querySelector('[data-group-footer-label]');
  const valueEl = footer.querySelector('[data-group-footer-value]');
  const plEl = footer.querySelector('[data-group-footer-pl]');
  if (labelEl) labelEl.textContent = isFiltered && visibleCount !== totalCount ? `Total (${visibleCount} filtered)` : 'Total';
  if (valueEl) valueEl.textContent = Helpers.formatCurrency(sumValue);
  if (plEl) {
    plEl.textContent = `${pl >= 0 ? '+' : '-'}${Helpers.formatCurrency(Math.abs(pl))} (${pl >= 0 ? '+' : ''}${plPct.toFixed(1)}%)`;
    plEl.className = `asset-row__pl ${pl >= 0 ? 'positive' : 'negative'}`;
  }
}

/** Reorders an asset group's rows in place by the chosen sort key —
 *  moves existing DOM nodes rather than re-rendering, so filters, focus,
 *  and event bindings on each row stay intact. */
function applyGroupSort(key) {
  const rowsWrap = document.querySelector(`[data-group-rows="${key}"]`);
  if (!rowsWrap) return;
  const sortKey = groupsState.sort[key] || 'default';
  const rows = Array.from(rowsWrap.querySelectorAll('.asset-row'));

  const comparators = {
    'value-desc': (a, b) => parseFloat(b.dataset.value) - parseFloat(a.dataset.value),
    'profit-desc': (a, b) => parseFloat(b.dataset.profit) - parseFloat(a.dataset.profit),
    'profit-asc': (a, b) => parseFloat(a.dataset.profit) - parseFloat(b.dataset.profit),
    'return-desc': (a, b) => parseFloat(b.dataset.profitPct) - parseFloat(a.dataset.profitPct),
    'return-asc': (a, b) => parseFloat(a.dataset.profitPct) - parseFloat(b.dataset.profitPct),
    'name-asc': (a, b) => a.dataset.name.localeCompare(b.dataset.name),
  };
  const cmp = comparators[sortKey] || ((a, b) => parseInt(a.dataset.order, 10) - parseInt(b.dataset.order, 10));

  rows.sort(cmp);
  rows.forEach((row) => rowsWrap.appendChild(row));
}

function renderAssetGroups(holdings) {
  const container = document.querySelector('[data-asset-groups]');
  if (!container) return;

  const accounts = (typeof Accounts !== 'undefined' ? Accounts.all() : []);

  const cashGroup = {
    key: 'cash',
    label: 'Cash & Savings',
    icon: 'fa-building-columns',
    tone: 'tone-info',
    items: accounts.map((a) => ({
      id: a.id,
      kind: 'account',
      name: a.name,
      subLabel: Accounts.typeMeta(a.type).label,
      invested: a.balance,
      value: a.balance,
    })),
  };

  const invGroups = ASSET_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    icon: g.icon,
    tone: g.tone,
    items: holdings
      .filter((h) => g.types.includes(h.type))
      .map((h) => {
        const lots = pickRelevantLots(h.id);
        const earliestLotDate = lots.length
          ? lots.reduce((min, l) => (new Date(l.date) < new Date(min) ? l.date : min), lots[0].date)
          : null;
        return {
          id: h.id,
          kind: 'holding',
          name: h.name,
          subLabel: h.type + (Investments.isLive(h) ? ` \u00b7 ${h.symbol}` : ''),
          invested: h.costBasis,
          value: h.value,
          source: h.source || null,
          hasUnits: Investments.hasUnits(h),
          quantity: h.quantity || null,
          avgPrice: h.avgPrice || null,
          currentPrice: Investments.unitPrice(h),
          heldSinceDate: earliestLotDate || h.date || null,
          _lots: lots,
        };
      }),
  }));

  const groups = [cashGroup, ...invGroups].filter((g) => g.items.length > 0);

  // On the very first render, start every group collapsed so the Assets
  // page opens showing just the headers — nothing expanded until the user
  // clicks a group. Subsequent renders (after adding/editing a holding,
  // switching currency, etc.) respect whatever the user has toggled since.
  if (!groupsState.collapsedInitDone) {
    groups.forEach((g) => groupsState.collapsed.add(g.key));
    groupsState.collapsedInitDone = true;
  }

  // Total Assets summary
  const totalInvested = groups.reduce((s, g) => s + g.items.reduce((s2, i) => s2 + i.invested, 0), 0);
  const totalValue = groups.reduce((s, g) => s + g.items.reduce((s2, i) => s2 + i.value, 0), 0);
  const totalPL = totalValue - totalInvested;
  const totalPLPct = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;
  setText('[data-assets-total-invested]', Helpers.formatCurrency(totalInvested));
  setText('[data-assets-total-value]', Helpers.formatCurrency(totalValue));
  setText('[data-assets-total-pl]', `${totalPL >= 0 ? '+' : '-'}${Helpers.formatCurrency(Math.abs(totalPL))}`);
  const plPctEl = document.querySelector('[data-assets-total-pl-pct]');
  if (plPctEl) {
    plPctEl.textContent = `${totalPLPct >= 0 ? '+' : ''}${totalPLPct.toFixed(1)}%`;
    plPctEl.className = `chip ${totalPLPct >= 0 ? 'tone-accent' : 'tone-negative'}`;
  }
  const totalPlEl = document.querySelector('[data-assets-total-pl]');
  if (totalPlEl) totalPlEl.style.color = totalPL >= 0 ? 'var(--color-profit, var(--color-accent))' : 'var(--color-negative)';

  const totalItems = groups.reduce((s, g) => s + g.items.length, 0);
  setText('[data-assets-count]', `${totalItems} asset${totalItems === 1 ? '' : 's'}`);

  if (groups.length === 0) {
    container.innerHTML = `<div class="glass card empty-state"><i class="fa-solid fa-vault"></i> No assets yet. Add a cash account or an investment to get started.</div>`;
    return;
  }

  container.innerHTML = groups
    .map((g) => {
      const activeDuration = groupsState.duration[g.key] || 'all';
      const activeCustom = groupsState.customRange[g.key] || {};
      const displayItems = periodAdjustItems(g.items, activeDuration, activeCustom);

      const groupInvested = displayItems.reduce((s, i) => s + i.invested, 0);
      const groupValue = displayItems.reduce((s, i) => s + i.value, 0);
      const groupPL = groupValue - groupInvested;
      const groupPLPct = groupInvested > 0 ? (groupPL / groupInvested) * 100 : 0;
      const isCollapsed = groupsState.collapsed.has(g.key);
      const isPeriodFiltered = activeDuration !== 'all';

      const rowsHtml = displayItems
        .map((item, idx) => {
          const itemPL = item.value - item.invested;
          const itemPLPct = item.invested > 0 ? (itemPL / item.invested) * 100 : 0;
          const alloc = groupValue > 0 ? (item.value / groupValue) * 100 : 0;
          const plClass = itemPL >= 0 ? 'positive' : 'negative';
          const periodNote = item.isPeriodFiltered
            ? `<span class="asset-row__period-note">${item.isPartialPeriod ? 'Partial \u2014 ' : ''}${activeDuration === 'custom' ? 'this range' : `bought in ${activeDuration}`} only</span>`
            : '';
          const unitsMeta = item.hasUnits
            ? `<div class="asset-row__meta">
                 <span>Qty ${Number(item.quantity).toLocaleString()}</span>
                 ${item.avgPrice ? `<span>Avg ${Helpers.formatCurrency(item.avgPrice)}</span>` : ''}
                 ${item.currentPrice ? `<span>LTP ${Helpers.formatCurrency(item.currentPrice)}</span>` : ''}
                 ${periodNote}
               </div>`
            : (periodNote ? `<div class="asset-row__meta">${periodNote}</div>` : '');
          const searchText = `${item.name} ${item.subLabel || ''}`.toLowerCase();
          const durationBucket = durationBucketOf(item.heldSinceDate);
          return `
            <div class="asset-row" data-id="${item.id}" data-kind="${item.kind}" data-search="${escapeHtml(searchText)}"
                 data-order="${idx}" data-value="${item.value}" data-invested="${item.invested}" data-profit="${itemPL}" data-profit-pct="${itemPLPct}"
                 data-name="${escapeHtml(item.name.toLowerCase())}" data-duration-bucket="${durationBucket}" data-held-date="${item.heldSinceDate || ''}">
              <div>
                <span class="asset-row__title">${escapeHtml(item.name)}</span>
                ${item.source === 'zerodha' ? '<span class="zd-badge" title="Imported from Zerodha">Z</span>' : ''}
                ${unitsMeta}
              </div>
              <div class="asset-row__type">${escapeHtml(item.subLabel)}</div>
              <div class="asset-row__alloc">${alloc.toFixed(1)}%</div>
              <div class="asset-row__value">
                <span class="num">${Helpers.formatCurrency(item.value)}</span>
                <span class="asset-row__pl ${plClass}">${itemPL >= 0 ? '+' : '-'}${Helpers.formatCurrency(Math.abs(itemPL))} (${itemPL >= 0 ? '+' : ''}${itemPLPct.toFixed(1)}%)</span>
              </div>
              <div class="asset-row__chevron"><i class="fa-solid fa-chevron-right"></i></div>
            </div>`;
        })
        .join('');

      const existingSearch = groupsState.filters[g.key] || '';
      const existingSort = groupsState.sort[g.key] || 'default';
      const existingDuration = groupsState.duration[g.key] || 'all';
      const existingCustom = groupsState.customRange[g.key] || {};
      const groupYears = yearsHeldIn(g.items);
      const filterBarHtml = g.items.length > 1
        ? `<div class="asset-group__filterbar filter-bar">
             <label class="search">
               <i class="fa-solid fa-magnifying-glass"></i>
               <input type="text" placeholder="Filter by name…" data-group-search="${g.key}" value="${escapeHtml(existingSearch)}" autocomplete="off" aria-label="Filter ${escapeHtml(g.label)} by name" />
             </label>
             <select data-group-sort="${g.key}" aria-label="Sort ${escapeHtml(g.label)}">
               <option value="default" ${existingSort === 'default' ? 'selected' : ''}>Sort: Default</option>
               <option value="value-desc" ${existingSort === 'value-desc' ? 'selected' : ''}>Highest Value</option>
               <option value="profit-desc" ${existingSort === 'profit-desc' ? 'selected' : ''}>Most Profit</option>
               <option value="profit-asc" ${existingSort === 'profit-asc' ? 'selected' : ''}>Most Loss</option>
               <option value="return-desc" ${existingSort === 'return-desc' ? 'selected' : ''}>Highest Return %</option>
               <option value="return-asc" ${existingSort === 'return-asc' ? 'selected' : ''}>Lowest Return %</option>
               <option value="name-asc" ${existingSort === 'name-asc' ? 'selected' : ''}>Name A–Z</option>
             </select>
             <select data-group-duration="${g.key}" aria-label="Filter ${escapeHtml(g.label)} by holding year">
               <option value="all" ${existingDuration === 'all' ? 'selected' : ''}>All Durations</option>
               ${groupYears.map((y) => `<option value="${y}" ${existingDuration === y ? 'selected' : ''}>Held in ${y}</option>`).join('')}
               <option value="custom" ${existingDuration === 'custom' ? 'selected' : ''}>Custom range…</option>
             </select>
             <div class="asset-group__customrange" data-group-custom-range="${g.key}" style="${existingDuration === 'custom' ? '' : 'display:none;'}">
               <input type="date" data-group-custom-from="${g.key}" value="${escapeHtml(existingCustom.from || '')}" aria-label="From date" />
               <span class="asset-group__customrange-sep">to</span>
               <input type="date" data-group-custom-to="${g.key}" value="${escapeHtml(existingCustom.to || '')}" aria-label="To date" />
             </div>
           </div>`
        : '';

      return `
        <div class="glass card asset-group" data-group-key="${g.key}">
          <button type="button" class="asset-group__header ${isCollapsed ? 'is-collapsed' : ''}" data-group-toggle="${g.key}">
            <i class="fa-solid fa-chevron-down asset-group__chevron"></i>
            <span class="chip ${g.tone} asset-group__icon"><i class="fa-solid ${g.icon}"></i></span>
            <span class="asset-group__title">${escapeHtml(g.label)}</span>
            <span class="chip ${g.tone} asset-group__count">${displayItems.length}</span>
            <span class="asset-group__spacer"></span>
            <span class="asset-group__totals">
              <span class="num">${Helpers.formatCurrency(groupValue)}</span>
              <span class="${groupPL >= 0 ? 'positive' : 'negative'}">${groupPL >= 0 ? '+' : '-'}${Helpers.formatCurrency(Math.abs(groupPL))} (${groupPL >= 0 ? '+' : ''}${groupPLPct.toFixed(1)}%)</span>
            </span>
          </button>
          <div class="asset-group__body" style="${isCollapsed ? 'display:none;' : ''}">
            ${filterBarHtml}
            <div data-group-rows="${g.key}">${rowsHtml}</div>
            <div class="empty-state asset-group__no-match" data-group-no-match="${g.key}" style="${isPeriodFiltered && displayItems.length === 0 && g.items.length > 0 ? '' : 'display:none;'}">
              <i class="fa-solid fa-magnifying-glass"></i> ${isPeriodFiltered ? `Nothing was bought ${activeDuration === 'custom' ? 'in this date range' : `in ${activeDuration}`}.` : 'No holdings match this filter.'}
            </div>
            ${g.items.length > 1 ? `
            <div class="asset-group__footer-total" data-group-footer-total="${g.key}">
              <span class="asset-group__footer-total-label" data-group-footer-label>${isPeriodFiltered ? `Total (${activeDuration === 'custom' ? 'this range' : activeDuration})` : 'Total'}</span>
              <span class="asset-group__footer-total-value">
                <span class="num" data-group-footer-value>${Helpers.formatCurrency(groupValue)}</span>
                <span class="asset-row__pl ${groupPL >= 0 ? 'positive' : 'negative'}" data-group-footer-pl>${groupPL >= 0 ? '+' : '-'}${Helpers.formatCurrency(Math.abs(groupPL))} (${groupPL >= 0 ? '+' : ''}${groupPLPct.toFixed(1)}%)</span>
              </span>
            </div>` : ''}
          </div>
        </div>`;
    })
    .join('');

  container.querySelectorAll('[data-group-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.groupToggle;
      if (groupsState.collapsed.has(key)) groupsState.collapsed.delete(key);
      else groupsState.collapsed.add(key);
      renderAssetGroups(Investments.all());
    });
  });

  container.querySelectorAll('[data-group-search]').forEach((input) => {
    const key = input.dataset.groupSearch;
    input.addEventListener('input', () => {
      groupsState.filters[key] = input.value;
      applyGroupFilters(key);
    });
    // Clicking/typing in the filter shouldn't collapse the group.
    input.addEventListener('click', (e) => e.stopPropagation());
  });

  container.querySelectorAll('[data-group-duration]').forEach((select) => {
    const key = select.dataset.groupDuration;
    select.addEventListener('change', () => {
      groupsState.duration[key] = select.value;
      const rangeWrap = document.querySelector(`[data-group-custom-range="${key}"]`);
      if (rangeWrap) rangeWrap.style.display = select.value === 'custom' ? '' : 'none';
      // Duration changes the actual quantity/price/amount shown per row
      // (only that period's purchase lots), so it needs a full rebuild
      // rather than the lightweight show/hide used for the search box.
      renderAssetGroups(Investments.all());
    });
    select.addEventListener('click', (e) => e.stopPropagation());
  });

  container.querySelectorAll('[data-group-custom-from]').forEach((input) => {
    const key = input.dataset.groupCustomFrom;
    input.addEventListener('change', () => {
      groupsState.customRange[key] = { ...(groupsState.customRange[key] || {}), from: input.value };
      renderAssetGroups(Investments.all());
    });
    input.addEventListener('click', (e) => e.stopPropagation());
  });

  container.querySelectorAll('[data-group-custom-to]').forEach((input) => {
    const key = input.dataset.groupCustomTo;
    input.addEventListener('change', () => {
      groupsState.customRange[key] = { ...(groupsState.customRange[key] || {}), to: input.value };
      renderAssetGroups(Investments.all());
    });
    input.addEventListener('click', (e) => e.stopPropagation());
  });

  container.querySelectorAll('[data-group-sort]').forEach((select) => {
    const key = select.dataset.groupSort;
    select.addEventListener('change', () => {
      groupsState.sort[key] = select.value;
      applyGroupSort(key);
    });
    select.addEventListener('click', (e) => e.stopPropagation());
  });

  // Re-apply any active search filter for each group so it survives
  // re-renders (price refresh, toggling a different group, etc.) without
  // a full rebuild. Duration is already baked into which rows exist by
  // this point, so it doesn't need re-applying here.
  groups.forEach((g) => {
    if (groupsState.filters[g.key]) applyGroupFilters(g.key);
    if (groupsState.sort[g.key] && groupsState.sort[g.key] !== 'default') applyGroupSort(g.key);
  });

  container.querySelectorAll('.asset-row').forEach((row) => {
    row.addEventListener('click', () => {
      const { id, kind } = row.dataset;
      if (kind === 'holding') {
        openHoldingDetailModal(id);
      } else if (kind === 'account' && window.AccountsPageActions) {
        window.AccountsPageActions.openEditModal(id);
      }
    });
  });
}

/* ---------------- Asset Overview (Overall / Equity / Gold / Other) ---------------- */

function sumByTypes(holdings, types) {
  return holdings
    .filter((i) => types.includes(i.type))
    .reduce((sum, i) => sum + i.value, 0);
}

function renderAssetOverview(holdings) {
  const cashTotal = (typeof Accounts !== 'undefined' ? Accounts.all() : []).reduce((sum, a) => sum + a.balance, 0);
  const investedTotal = holdings.reduce((sum, i) => sum + i.value, 0);
  const overall = cashTotal + investedTotal;

  const equityGroup = ASSET_GROUPS.find((g) => g.key === 'equity');
  const equityValue = sumByTypes(holdings, equityGroup.types);
  const commodityGroup = ASSET_GROUPS.find((g) => g.key === 'commodity');
  const goldValue = sumByTypes(holdings, commodityGroup.types);

  setText('[data-overall-assets]', Helpers.formatCurrency(overall));
  setText('[data-equity-value]', Helpers.formatCurrency(equityValue));
  setText('[data-equity-pct]', overall > 0 ? `${((equityValue / overall) * 100).toFixed(0)}% of overall assets` : 'Stocks · ETF · MF');
  setText('[data-gold-value]', Helpers.formatCurrency(goldValue));
  setText('[data-gold-pct]', overall > 0 ? `${((goldValue / overall) * 100).toFixed(0)}% of overall assets` : '');

  bindOtherAssetSelect(holdings, cashTotal);
}

function bindOtherAssetSelect(holdings, cashTotal) {
  const select = document.querySelector('[data-other-asset-select]');
  if (!select) return;

  const updateValue = () => {
    const choice = select.value;
    let value = 0;
    if (choice === 'Cash') {
      value = cashTotal;
    } else if (choice === 'Retirement') {
      value = sumByTypes(holdings, ['CPF', 'EPF']);
    } else {
      value = sumByTypes(holdings, [choice]);
    }
    setText('[data-other-asset-value]', Helpers.formatCurrency(value));
  };

  if (!select.dataset.bound) {
    select.dataset.bound = 'true';
    select.addEventListener('change', updateValue);
  }
  updateValue();
}

function renderSummary(holdings) {
  const totalValue = holdings.reduce((sum, i) => sum + i.value, 0);
  const totalCost = holdings.reduce((sum, i) => sum + i.costBasis, 0);
  const totalPL = totalValue - totalCost;
  const totalPLPct = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;
  const dayPL = Investments.totalDayPL(holdings);

  setText('[data-total-invested]', Helpers.formatCurrency(totalCost));
  setText('[data-portfolio-value]', Helpers.formatCurrency(totalValue));
  setText('[data-total-pl]', `${totalPL >= 0 ? '+' : '-'}${Helpers.formatCurrency(Math.abs(totalPL))}`);
  setText('[data-total-pl-pct]', `${totalPLPct >= 0 ? '+' : ''}${totalPLPct.toFixed(1)}%`);
  setText('[data-holding-count]', holdings.length);

  const plEl = document.querySelector('[data-total-pl]');
  if (plEl) plEl.style.color = totalPL >= 0 ? 'var(--color-profit)' : 'var(--color-negative)';

  const dayPlEl = document.querySelector('[data-day-pl]');
  const dayPlPctEl = document.querySelector('[data-day-pl-pct]');
  if (dayPL.hasData) {
    const valueAtOpen = totalValue - dayPL.amt;
    const dayPct = valueAtOpen > 0 ? (dayPL.amt / valueAtOpen) * 100 : 0;
    if (dayPlEl) {
      dayPlEl.textContent = `${dayPL.amt >= 0 ? '+' : '-'}${Helpers.formatCurrency(Math.abs(dayPL.amt))}`;
      dayPlEl.style.color = dayPL.amt >= 0 ? 'var(--color-profit)' : 'var(--color-negative)';
    }
    if (dayPlPctEl) {
      dayPlPctEl.textContent = `${dayPct >= 0 ? '+' : ''}${dayPct.toFixed(2)}%`;
      dayPlPctEl.style.color = dayPL.amt >= 0 ? 'var(--color-profit)' : 'var(--color-negative)';
    }
  } else {
    if (dayPlEl) { dayPlEl.textContent = '—'; dayPlEl.style.color = 'var(--color-text-faint)'; }
    if (dayPlPctEl) { dayPlPctEl.textContent = 'Refresh live prices to see today\u2019s change'; dayPlPctEl.style.color = 'var(--color-text-faint)'; }
  }
}

/* ---------------- Holdings filters ---------------- */

function bindHoldingsFilters() {
  ['[data-holdings-search]', '[data-holdings-filter-type]', '[data-holdings-filter-pl]', '[data-holdings-sort]'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, Helpers.debounce(() => render(), 150));
  });

  const dateSelect = document.querySelector('[data-holdings-filter-date]');
  if (dateSelect) {
    dateSelect.addEventListener('change', () => {
      const isCustom = dateSelect.value === 'custom';
      document.querySelector('[data-holdings-filter-date-from]').style.display = isCustom ? '' : 'none';
      document.querySelector('[data-holdings-filter-date-to]').style.display = isCustom ? '' : 'none';
      render();
    });
  }
  ['[data-holdings-filter-date-from]', '[data-holdings-filter-date-to]'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.addEventListener('change', () => render());
  });
}

function getFilteredHoldings(holdings) {
  const search = (document.querySelector('[data-holdings-search]')?.value || '').trim().toLowerCase();
  const type = document.querySelector('[data-holdings-filter-type]')?.value || 'all';
  const plFilter = document.querySelector('[data-holdings-filter-pl]')?.value || 'all';
  const dateFilter = document.querySelector('[data-holdings-filter-date]')?.value || 'all';
  const dateFrom = document.querySelector('[data-holdings-filter-date-from]')?.value;
  const dateTo = document.querySelector('[data-holdings-filter-date-to]')?.value;

  const filtered = holdings.filter((i) => {
    if (search && !i.name.toLowerCase().includes(search)) return false;
    if (type !== 'all' && i.type !== type) return false;

    if (plFilter !== 'all') {
      const pl = Investments.profitLoss(i);
      if (plFilter === 'profit' && pl < 0) return false;
      if (plFilter === 'loss' && pl >= 0) return false;
    }

    if (dateFilter !== 'all') {
      if (!i.date) return false;
      const d = new Date(i.date);
      const now = new Date();
      if (dateFilter === 'today') {
        if (i.date !== now.toISOString().slice(0, 10)) return false;
      } else if (dateFilter === 'week') {
        const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
        if (d < weekAgo || d > now) return false;
      } else if (dateFilter === 'month') {
        if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false;
      } else if (dateFilter === 'year') {
        if (d.getFullYear() !== now.getFullYear()) return false;
      } else if (dateFilter === 'custom') {
        if (dateFrom && i.date < dateFrom) return false;
        if (dateTo && i.date > dateTo) return false;
      }
    }

    return true;
  });

  return sortHoldings(filtered, document.querySelector('[data-holdings-sort]')?.value || 'none');
}

function sortHoldings(list, sortKey) {
  const withMetrics = list.slice();
  switch (sortKey) {
    case 'profit-pct-desc':
      // Highest profit % first, across all asset types (stocks, mutual funds, etc.)
      return withMetrics.sort((a, b) => Investments.profitLossPct(b) - Investments.profitLossPct(a));
    case 'invested-desc':
      // Largest invested amount first
      return withMetrics.sort((a, b) => b.costBasis - a.costBasis);
    case 'loss-pct-desc':
      // Biggest loss % first (most negative P&L% at the top)
      return withMetrics.sort((a, b) => Investments.profitLossPct(a) - Investments.profitLossPct(b));
    default:
      return withMetrics;
  }
}

/* ---------------- Holdings table ---------------- */

function renderHoldingsTable(holdings) {
  const body = document.querySelector('[data-holdings-body]');
  const footer = document.querySelector('[data-holdings-footer]');
  if (!body) return;

  if (holdings.length === 0) {
    const hasAny = Investments.all().length > 0;
    body.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <i class="fa-solid fa-chart-line"></i>
          ${hasAny ? 'No holdings match these filters.' : 'No investments yet. Add a holding to start tracking your portfolio.'}
        </td>
      </tr>`;
    if (footer) footer.innerHTML = '';
    return;
  }

  body.innerHTML = holdings
    .map((i) => {
      const meta = Investments.typeMeta(i.type);
      const pl = Investments.profitLoss(i);
      const plPct = Investments.profitLossPct(i);
      const isGain = pl >= 0;
      const plClass = isGain ? 'holdings-table__pos' : 'holdings-table__neg';

      const hasUnits = Investments.hasUnits(i);
      const qtyCell = hasUnits ? formatQty(i.quantity) : '<span class="holdings-table__muted">\u2014</span>';

      return `
        <tr data-id="${i.id}" class="holding-row" style="cursor:pointer;">
          <td class="holdings-table__name-cell">
            <div class="holdings-table__name">
              <span class="chip ${meta.tone}" style="width:26px;height:26px;font-size:11px;flex-shrink:0;"><i class="fa-solid ${meta.icon}"></i></span>
              <span>${escapeHtml(i.name)}</span>
              ${Investments.isLive(i) ? '<span class="holdings-table__live-badge">LIVE</span>' : ''}
            </div>
            <div class="holdings-table__sub">${i.type}</div>
          </td>
          <td class="text-right">${qtyCell}</td>
          <td class="text-right">${Helpers.formatCurrency(i.costBasis)}</td>
          <td class="text-right">${Helpers.formatCurrency(i.value)}</td>
          <td class="text-right ${plClass}">${isGain ? '+' : '-'}${Helpers.formatCurrency(Math.abs(pl))} <span style="opacity:.7; font-size: 11px;">(${isGain ? '+' : ''}${plPct.toFixed(1)}%)</span></td>
          <td>
            <div class="holdings-table__actions">
              <button data-edit aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
              <button data-delete class="danger" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>`;
    })
    .join('');

  body.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(btn.closest('[data-id]').dataset.id);
    });
  });
  body.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDelete(btn.closest('[data-id]').dataset.id);
    });
  });
  body.querySelectorAll('[data-id]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openHoldingDetailModal(row.dataset.id);
    });
  });

  if (footer) {
    const totalCost = holdings.reduce((s, i) => s + i.costBasis, 0);
    const totalValue = holdings.reduce((s, i) => s + i.value, 0);
    const totalPL = totalValue - totalCost;
    const totalPLPct = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;
    const plClass = totalPL >= 0 ? 'holdings-table__pos' : 'holdings-table__neg';
    footer.innerHTML = `
      <tr>
        <td colspan="2">Total</td>
        <td class="text-right">${Helpers.formatCurrency(totalCost)}</td>
        <td class="text-right">${Helpers.formatCurrency(totalValue)}</td>
        <td class="text-right ${plClass}">${totalPL >= 0 ? '+' : '-'}${Helpers.formatCurrency(Math.abs(totalPL))} <span style="opacity:.7; font-size: 11px;">(${totalPL >= 0 ? '+' : ''}${totalPLPct.toFixed(1)}%)</span></td>
        <td></td>
      </tr>`;
  }
}

function formatQty(q) {
  if (Number.isInteger(q)) return q.toString();
  return q.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/* ---------------- Allocation charts (invested vs current) + type breakdown ---------------- */

let allocationInvestedChart = null;
let allocationCurrentChart = null;

/** Shared doughnut renderer — `metric` is 'costBasis' (Invested) or 'value' (Current). */
function renderAllocationDoughnut({ holdings, metric, canvasId, legendSelector, existingChart }) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return existingChart;
  ChartTheme.applyDefaults();

  const byType = {};
  holdings.forEach((i) => {
    byType[i.type] = (byType[i.type] || 0) + i[metric];
  });
  const labels = Object.keys(byType);
  const values = Object.values(byType);

  if (existingChart) existingChart.destroy();
  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: ChartTheme.palette, borderWidth: 0 }] },
    options: ChartTheme.doughnutOptions(),
  });

  const legend = document.querySelector(legendSelector);
  if (legend) {
    const total = values.reduce((s, v) => s + v, 0);
    legend.innerHTML = labels
      .map((label, i) => {
        const pct = total > 0 ? ((values[i] / total) * 100).toFixed(0) : 0;
        return `
          <span class="legend-item">
            <span class="legend-swatch" style="background:${ChartTheme.palette[i % ChartTheme.palette.length]}"></span>${label} \u00b7 ${pct}%
          </span>`;
      })
      .join('') || '<span class="legend-item">No holdings yet</span>';
  }
  return chart;
}

function renderAllocationCharts(holdings) {
  allocationInvestedChart = renderAllocationDoughnut({
    holdings,
    metric: 'costBasis',
    canvasId: 'allocationInvestedChart',
    legendSelector: '[data-allocation-invested-legend]',
    existingChart: allocationInvestedChart,
  });
  allocationCurrentChart = renderAllocationDoughnut({
    holdings,
    metric: 'value',
    canvasId: 'allocationCurrentChart',
    legendSelector: '[data-allocation-current-legend]',
    existingChart: allocationCurrentChart,
  });
}

/* ---------------- Monthly investment activity chart ---------------- */

let monthlyInvestmentChart = null;
function renderMonthlyInvestmentChart(holdings) {
  const canvas = document.getElementById('monthlyInvestmentChart');
  const chip = document.querySelector('[data-month-invested-chip]');
  if (chip) chip.textContent = `This month: ${Helpers.formatCurrency(Investments.investedThisMonth(holdings))}`;
  if (!canvas || typeof Chart === 'undefined') return;
  ChartTheme.applyDefaults();

  const series = Investments.monthlySeries(holdings, 6);
  if (monthlyInvestmentChart) monthlyInvestmentChart.destroy();
  monthlyInvestmentChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: series.map((s) => s.label),
      datasets: [{
        label: 'Invested',
        data: series.map((s) => s.amount),
        backgroundColor: ChartTheme.palette[1],
        borderRadius: 6,
        maxBarThickness: 40,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => Helpers.formatCurrency(ctx.parsed.y) } },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: { grid: { color: ChartTheme.gridColor() }, border: { display: false }, ticks: { callback: (v) => Helpers.formatCurrency(v).replace(/\.00$/, '') } },
      },
    },
  });
}

/* ---------------- Period-filtered investments banner (from Reports) ---------------- */

/** When arriving from Reports with ?from=&to= (a stat-card click for a
 *  selected month), shows every purchase made in that exact window —
 *  built from real buy history (HoldingLots), same principal-only source
 *  as the Investment Growth chart, so "what did I invest this month"
 *  always agrees with the number shown back on Reports. Value-only
 *  holdings with no lot history fall back to their entry date. */
function renderPeriodInvestmentsBanner() {
  const section = document.getElementById('periodInvestmentsSection');
  if (!section) return;

  const params = new URLSearchParams(window.location.search);
  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to) { section.style.display = 'none'; return; }

  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T23:59:59`);
  const holdings = Investments.all();
  const events = [];

  holdings.forEach((inv) => {
    const lots = (typeof HoldingLots !== 'undefined') ? HoldingLots.forHolding(inv.id) : [];
    if (lots.length > 0) {
      lots.forEach((lot) => {
        const d = new Date(lot.date);
        if (Number.isNaN(d.getTime()) || d < start || d > end) return;
        const amount = (Number(lot.quantity) || 0) * (Number(lot.price) || 0);
        if (amount > 0) events.push({ name: inv.name, type: inv.type, date: lot.date, quantity: lot.quantity, price: lot.price, amount });
      });
    } else if (inv.date) {
      const d = new Date(inv.date);
      if (!Number.isNaN(d.getTime()) && d >= start && d <= end && inv.costBasis > 0) {
        events.push({ name: inv.name, type: inv.type, date: inv.date, quantity: null, price: null, amount: inv.costBasis });
      }
    }
  });

  events.sort((a, b) => new Date(b.date) - new Date(a.date));

  section.style.display = '';
  const total = events.reduce((sum, e) => sum + e.amount, 0);

  const rangeEl = document.querySelector('[data-period-investments-range]');
  if (rangeEl) rangeEl.textContent = `(${Helpers.formatShortDateWithYear(from)} \u2013 ${Helpers.formatShortDateWithYear(to)})`;

  const sub = document.querySelector('[data-period-investments-sub]');
  if (sub) {
    sub.innerHTML = events.length
      ? `<span style="color: var(--color-accent); font-weight:600;">${Helpers.formatCurrency(total)}</span> invested across ${events.length} purchase${events.length !== 1 ? 's' : ''} in this period.`
      : 'No investments made in this period.';
  }

  const list = document.querySelector('[data-period-investments-list]');
  if (!list) return;
  if (events.length === 0) {
    list.innerHTML = `<p style="text-align:center; color: var(--color-text-faint); padding: var(--sp-5) 0;">No investments made in this period.</p>`;
    return;
  }
  list.innerHTML = `<ul class="row-list">${events.map((e) => `
    <li class="list-row">
      <span class="chip tone-violet" style="width:38px;height:38px;"><i class="fa-solid ${InvestmentTypeMeta[e.type]?.icon || 'fa-coins'}"></i></span>
      <div class="list-row__meta">
        <p class="list-row__title">${escapeHtml(e.name)}</p>
        <p class="list-row__sub">${escapeHtml(e.type || '')}${e.quantity ? ` \u00b7 ${e.quantity} @ ${Helpers.formatCurrency(e.price)}` : ''} \u00b7 ${Helpers.formatShortDateWithYear(e.date)}</p>
      </div>
      <span class="list-row__amount num" style="color: var(--color-accent);">${Helpers.formatCurrency(e.amount)}</span>
    </li>`).join('')}</ul>`;
}

/* ---------------- Investment growth chart (cumulative, invested-only) ---------------- */

let investmentGrowthChart = null;
function renderInvestmentGrowthChart(holdings) {
  const canvas = document.getElementById('investmentGrowthChart');
  if (!canvas) return;

  const series = Investments.growthSeries(holdings);
  const sub = document.querySelector('[data-investment-growth-sub]');

  if (series.length === 0) {
    if (sub) sub.textContent = 'Add an investment to start tracking how your invested capital grows over time.';
    const wrap = canvas.closest('.chart-panel__canvas-wrap');
    if (wrap) wrap.innerHTML = '<p style="text-align:center; color: var(--color-text-faint); padding-top: var(--sp-5);">No purchase history yet.</p>';
    return;
  }

  if (typeof Chart === 'undefined') return;
  ChartTheme.applyDefaults();

  const total = series[series.length - 1].invested;
  if (sub) {
    sub.innerHTML = `<span style="color: var(--color-accent); font-weight:600;">${Helpers.formatCurrency(total)}</span> net invested to date \u00b7 buys add, sells subtract \u00b7 returns not included`;
  }

  if (investmentGrowthChart) investmentGrowthChart.destroy();

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight || 220);
  gradient.addColorStop(0, 'rgba(167,139,250,0.28)');
  gradient.addColorStop(1, 'rgba(167,139,250,0)');

  investmentGrowthChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: series.map((s) => s.label),
      datasets: [{
        label: 'Net Invested',
        data: series.map((s) => s.invested),
        borderColor: '#a78bfa',
        backgroundColor: gradient,
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: '#a78bfa',
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `Net Invested: ${Helpers.formatCurrency(ctx.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: {
          grid: { color: ChartTheme.gridColor() },
          border: { display: false },
          ticks: { callback: (v) => Helpers.formatCurrency(v).replace(/\.00$/, '') },
        },
      },
    },
  });
}

/** Renders the Asset Classes accordion: Equity (Stocks/ETF/MF) → Gold → FD →
 *  Foreign Investment → Crypto → Retirement, each expandable via a dropdown
 *  arrow. Groups with a single underlying type drop straight down to the
 *  holdings; Equity drops down to its three sub-types, which each expand
 *  further to their holdings. Expand state persists across re-renders. */
function renderTypeBreakdown(holdings) {
  const container = document.querySelector('[data-type-breakdown]');
  if (!container) return;

  const totalValue = holdings.reduce((s, i) => s + i.value, 0);

  container.innerHTML = ASSET_GROUPS
    .map((group) => {
      const groupHoldings = holdings.filter((i) => group.types.includes(i.type));
      const value = groupHoldings.reduce((s, i) => s + i.value, 0);
      const cost = groupHoldings.reduce((s, i) => s + i.costBasis, 0);
      const pl = value - cost;
      const isGain = pl >= 0;
      const share = totalValue > 0 ? (value / totalValue) * 100 : 0;
      const isOpen = state.expandedGroups.has(group.key);

      const bodyHtml = group.types.length > 1
        ? group.types.map((type) => renderTypeRow(group.key, type, holdings)).join('')
        : renderHoldingsList(groupHoldings);

      return `
        <div class="asset-group" data-group="${group.key}">
          <button type="button" class="asset-group__header ${isOpen ? 'is-open' : ''}" data-group-toggle="${group.key}">
            <span class="chip ${group.tone} asset-group__icon"><i class="fa-solid ${group.icon}"></i></span>
            <div class="asset-group__meta">
              <p class="asset-group__title">${group.label}</p>
              <p class="asset-group__sub">${groupHoldings.length} holding${groupHoldings.length === 1 ? '' : 's'} \u00b7 ${share.toFixed(0)}% of portfolio</p>
            </div>
            <div class="asset-group__value">
              <div class="asset-group__amount num">${Helpers.formatCurrency(value)}</div>
              ${groupHoldings.length ? `<div class="asset-group__pl num" style="color: ${isGain ? 'var(--color-profit)' : 'var(--color-negative)'};">${isGain ? '+' : '-'}${Helpers.formatCurrency(Math.abs(pl))}</div>` : ''}
            </div>
            <i class="fa-solid fa-chevron-down asset-group__chevron"></i>
          </button>
          <div class="asset-group__body" data-group-body="${group.key}" style="${isOpen ? '' : 'display:none;'}">
            ${bodyHtml}
          </div>
        </div>`;
    })
    .join('');

  bindAssetClassToggles();
}

function renderTypeRow(groupKey, type, allHoldings) {
  const meta = Investments.typeMeta(type);
  const typeHoldings = allHoldings.filter((i) => i.type === type);
  const value = typeHoldings.reduce((s, i) => s + i.value, 0);
  const rowKey = `${groupKey}::${type}`;
  const isOpen = state.expandedTypes.has(rowKey);

  return `
    <div class="asset-type-row" data-type-row="${rowKey}">
      <button type="button" class="asset-type-row__header ${isOpen ? 'is-open' : ''}" data-type-toggle="${rowKey}">
        <span class="chip ${meta.tone}" style="width:26px;height:26px;font-size:11px;"><i class="fa-solid ${meta.icon}"></i></span>
        <span class="asset-type-row__label">${type} <span style="color: var(--color-text-faint); font-weight:400;">\u00b7 ${typeHoldings.length}</span></span>
        <span class="asset-type-row__amount num">${Helpers.formatCurrency(value)}</span>
        <i class="fa-solid fa-chevron-down asset-type-row__chevron"></i>
      </button>
      <div class="asset-type-row__body" data-type-body="${rowKey}" style="${isOpen ? '' : 'display:none;'}">
        ${renderHoldingsList(typeHoldings)}
      </div>
    </div>`;
}

function renderHoldingsList(holdings) {
  if (holdings.length === 0) {
    return `<div class="empty-state" style="padding: var(--sp-3);"><i class="fa-solid fa-layer-group"></i> No holdings yet.</div>`;
  }
  return holdings
    .map((i) => {
      const pl = Investments.profitLoss(i);
      const isGain = pl >= 0;
      return `
        <div class="asset-holding-row" data-holding-jump="${i.id}" style="cursor:pointer;">
          <span class="asset-holding-row__name">${escapeHtml(i.name)}</span>
          <span class="asset-holding-row__amount num" style="color: ${isGain ? 'var(--color-profit)' : 'var(--color-negative)'};">${Helpers.formatCurrency(i.value)}</span>
        </div>`;
    })
    .join('');
}

function bindAssetClassToggles() {
  document.querySelectorAll('[data-group-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.groupToggle;
      if (state.expandedGroups.has(key)) state.expandedGroups.delete(key);
      else state.expandedGroups.add(key);
      renderTypeBreakdown(Investments.all());
    });
  });
  document.querySelectorAll('[data-type-toggle]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.typeToggle;
      if (state.expandedTypes.has(key)) state.expandedTypes.delete(key);
      else state.expandedTypes.add(key);
      renderTypeBreakdown(Investments.all());
    });
  });
  document.querySelectorAll('[data-holding-jump]').forEach((row) => {
    row.addEventListener('click', () => openHoldingDetailModal(row.dataset.holdingJump));
  });
}

/* ---------------- Add / Edit form ---------------- */

/** Groups the investment types into the category → (subcategory) → type picker
 *  shown in the Add Asset modal. "Cash & Savings" has no types of its own —
 *  picking it hands off to the existing Add Account modal. Debt is the only
 *  category with a subcategory level in between. */
const InvestmentCategories = [
  {
    id: 'equity', label: 'Equity', icon: 'fa-arrow-trend-up',
    types: ['Direct Stocks', 'Equity Mutual Funds', 'Hybrid Mutual Funds', 'Arbitrage Funds', 'Equity ETFs', 'ESOP'],
  },
  {
    id: 'debt', label: 'Debt', icon: 'fa-building-columns',
    subcategories: [
      { id: 'fd-deposits', label: 'Fixed Deposits & Deposits', types: ['Bank Fixed Deposit (FD)', 'Corporate Fixed Deposit (FD)', 'Recurring Deposit (RD)'] },
      { id: 'bonds', label: 'Bonds', types: ['Government Bonds', 'Corporate Bonds', 'Tax-Free Bonds', 'Sovereign Gold Bonds'] },
      { id: 'govt-schemes', label: 'Government Schemes', types: ['PPF', 'EPF', 'SSY', 'Government Savings Scheme'] },
      { id: 'debt-mf-etf', label: 'Debt Mutual Funds / ETFs', types: ['Debt Mutual Funds', 'Debt ETFs'] },
    ],
  },
  {
    id: 'real-estate', label: 'Real Estate', icon: 'fa-house',
    types: ['Property', 'REIT', 'InvIT'],
  },
  {
    id: 'commodity', label: 'Commodity', icon: 'fa-coins',
    types: ['Physical Gold', 'Physical Silver', 'Digital Gold / Silver'],
  },
  {
    id: 'cash-savings', label: 'Cash & Savings', icon: 'fa-wallet',
    isCashHandoff: true,
    types: ['Savings Account'],
  },
  {
    id: 'crypto', label: 'Crypto', icon: 'fa-bitcoin-sign',
    types: ['Crypto Tokens / Coins', 'Crypto ETFs'],
  },
  {
    id: 'other', label: 'Others', icon: 'fa-ellipsis',
    types: ['Other Assets'],
  },
  {
    id: 'moi', label: 'Moi', icon: 'fa-hand-holding-heart',
    isMoiHandoff: true,
    types: [],
  },
];

/** Finds the category (and subcategory, if any) that owns a given type string.
 *  Used for "back" navigation and to re-derive breadcrumbs when editing. */
function findCategoryForType(type) {
  for (const cat of InvestmentCategories) {
    if (cat.types && cat.types.includes(type)) return { category: cat, subcategory: null };
    if (cat.subcategories) {
      const sub = cat.subcategories.find((s) => s.types.includes(type));
      if (sub) return { category: cat, subcategory: sub };
    }
  }
  return { category: InvestmentCategories[0], subcategory: null };
}

function invTypeLabel(type) {
  return type;
}

function showInvStep(step) {
  document.querySelectorAll('[data-inv-step]').forEach((el) => {
    el.hidden = el.getAttribute('data-inv-step') !== step;
  });
}

function renderInvCategoryGrid() {
  const grid = document.querySelector('[data-inv-category-grid]');
  if (!grid) return;
  grid.innerHTML = InvestmentCategories.map((cat) => {
    const count = cat.subcategories
      ? cat.subcategories.reduce((s, sc) => s + sc.types.length, 0)
      : cat.types.length;
    return `
    <button type="button" class="type-card" data-inv-category="${cat.id}">
      <i class="fa-solid ${cat.icon}"></i>
      <span class="type-card__label">${cat.label}</span>
      <span class="type-card__count">${cat.isCashHandoff ? 'Add account' : cat.isMoiHandoff ? 'Given & taken' : `${count} type${count > 1 ? 's' : ''}`}</span>
    </button>`;
  }).join('');
  grid.querySelectorAll('[data-inv-category]').forEach((btn) => {
    btn.addEventListener('click', () => openCategory(btn.getAttribute('data-inv-category')));
  });
}

function openCategory(categoryId) {
  const cat = InvestmentCategories.find((c) => c.id === categoryId);
  if (!cat) return;

  if (cat.isCashHandoff) {
    Modal.close('#investmentModal');
    if (window.AccountsPageActions && window.AccountsPageActions.openAddModal) {
      window.AccountsPageActions.openAddModal();
    } else {
      const addAccountBtn = document.querySelector('[data-add-account-btn]');
      if (addAccountBtn) addAccountBtn.click();
    }
    return;
  }

  if (cat.isMoiHandoff) {
    openMoiStep();
    return;
  }

  if (cat.subcategories) {
    openSubcategoryStep(cat);
  } else {
    openSubtypeStep(cat.types, cat.label);
  }
}

/* ---------------- Moi Given quick entry (inline, no navigation) ---------------- */

function openMoiStep() {
  document.querySelector('#investmentModal [data-modal-title]').textContent = 'Add Moi Given';

  const nameEl = document.querySelector('[data-form-moi-name]');
  const villageEl = document.querySelector('[data-form-moi-village]');
  const amountEl = document.querySelector('[data-form-moi-amount]');
  const dateEl = document.querySelector('[data-form-moi-date]');
  const funcEl = document.querySelector('[data-form-moi-function]');
  const customField = document.querySelector('[data-inv-moi-custom-function-field]');
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

  showInvStep('moi');
  setTimeout(() => { if (nameEl) nameEl.focus(); }, 50);
}

function bindMoiQuickForm() {
  const funcEl = document.querySelector('[data-form-moi-function]');
  const customField = document.querySelector('[data-inv-moi-custom-function-field]');
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

  const saveBtn = document.querySelector('[data-inv-moi-save]');
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

    Moi.add({ direction: 'given', name, village, amount, date, function: finalFunction, notes });
    Toast.show('Moi entry added.', 'success');
    Modal.close('#investmentModal');
  });
}

function openSubcategoryStep(cat) {
  document.querySelector('[data-inv-subcategory-heading]').textContent = cat.label;
  const grid = document.querySelector('[data-inv-subcategory-grid]');
  grid.innerHTML = cat.subcategories.map((sub) => `
    <button type="button" class="type-card" data-inv-subcategory="${sub.id}">
      <span class="type-card__label">${sub.label}</span>
      <span class="type-card__count">${sub.types.length} type${sub.types.length > 1 ? 's' : ''}</span>
    </button>`).join('');
  grid.querySelectorAll('[data-inv-subcategory]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sub = cat.subcategories.find((s) => s.id === btn.getAttribute('data-inv-subcategory'));
      if (sub) openSubtypeStep(sub.types, sub.label);
    });
  });
  showInvStep('subcategory');
}

function openSubtypeStep(types, heading) {
  document.querySelector('[data-inv-subtype-heading]').textContent = heading;
  const grid = document.querySelector('[data-inv-subtype-grid]');
  grid.innerHTML = types.map((type) => `
    <button type="button" class="subtype-chip" data-inv-subtype="${type}">${invTypeLabel(type)}</button>`).join('');
  grid.querySelectorAll('[data-inv-subtype]').forEach((btn) => {
    btn.addEventListener('click', () => selectInvestmentType(btn.getAttribute('data-inv-subtype')));
  });
  showInvStep('subtype');
}

function selectInvestmentType(type) {
  document.querySelector('#investmentModal [data-form-type]').value = type;
  const verb = state.editingId ? 'Edit' : 'Add';
  document.querySelector('#investmentModal [data-modal-title]').textContent = `${verb} Asset: ${invTypeLabel(type)}`;
  updateStockFieldsVisibility();
  resetGenQtyUI();
  showInvStep('details');
  setTimeout(() => document.querySelector('#investmentModal [data-form-name]').focus(), 50);
}

function bindForm() {
  const form = document.querySelector('[data-investment-form]');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSubmit(form);
  });

  renderInvCategoryGrid();

  document.querySelectorAll('[data-inv-back-to-category]').forEach((backToCategory) => {
    backToCategory.addEventListener('click', () => {
      document.querySelector('#investmentModal [data-modal-title]').textContent = state.editingId ? 'Edit Asset' : 'Add Asset';
      showInvStep('category');
    });
  });

  bindMoiQuickForm();

  const backToSubcategory = document.querySelector('[data-inv-back-to-subcategory]');
  if (backToSubcategory) {
    backToSubcategory.addEventListener('click', () => {
      document.querySelector('#investmentModal [data-modal-title]').textContent = state.editingId ? 'Edit Asset' : 'Add Asset';
      const currentType = document.querySelector('#investmentModal [data-form-type]').value;
      const { category } = findCategoryForType(currentType);
      if (category.subcategories) showInvStep('subcategory');
      else showInvStep('category');
    });
  }

  const backToSubtype = document.querySelector('[data-inv-back-to-subtype]');
  if (backToSubtype) {
    backToSubtype.addEventListener('click', () => {
      document.querySelector('#investmentModal [data-modal-title]').textContent = state.editingId ? 'Edit Asset' : 'Add Asset';
      const currentType = document.querySelector('#investmentModal [data-form-type]').value;
      const { category, subcategory } = findCategoryForType(currentType);
      openSubtypeStep(subcategory ? subcategory.types : category.types, subcategory ? subcategory.label : category.label);
    });
  }

  const addBtn = document.querySelector('[data-add-investment-btn]');
  if (addBtn) addBtn.addEventListener('click', () => openAddModal());
}

function updateMarketProviderNote() {
  const note = document.querySelector('[data-market-provider-note]');
  if (!note) return;
  const provider = window.MarketData.getProvider();
  const labels = {
    groww: 'Using Groww Trading API for search and prices.',
    yahoo: 'Using Yahoo Finance for search and prices.',
    alphavantage: 'Using Alpha Vantage for search and prices.',
  };
  note.textContent = labels[provider] || labels.yahoo;
}

function openAddModal() {
  state.editingId = null;
  state.selectedSymbol = null;
  const form = document.querySelector('[data-investment-form]');
  form.reset();
  document.querySelector('#investmentModal [data-modal-title]').textContent = 'Add Asset';
  document.querySelector('[data-form-date]').value = new Date().toISOString().slice(0, 10);
  resetLiveStockUI();
  updateStockFieldsVisibility();
  resetGenQtyUI();
  updateMarketProviderNote();
  showInvStep('category');
  Modal.open('#investmentModal');
}

function openEditModal(id) {
  const record = Investments.get(id);
  if (!record) return;
  state.editingId = id;
  state.selectedSymbol = null;

  document.querySelector('#investmentModal [data-modal-title]').textContent = `Edit Asset: ${invTypeLabel(record.type)}`;
  document.querySelector('#investmentModal [data-form-name]').value = record.name;
  document.querySelector('[data-form-date]').value = record.date || new Date().toISOString().slice(0, 10);
  document.querySelector('#investmentModal [data-form-type]').value = record.type;
  showInvStep('details');
  document.querySelector('[data-form-value]').value = record.value;
  document.querySelector('[data-form-costbasis]').value = record.costBasis;

  resetLiveStockUI();
  document.querySelector('[data-form-gen-quantity]').value = '';
  document.querySelector('[data-form-gen-avgprice]').value = '';
  document.querySelector('[data-form-gen-currentprice]').value = '';
  updateStockFieldsVisibility();
  updateMarketProviderNote();
  const puritySelect = document.querySelector('[data-form-purity]');
  if (puritySelect && record.purity) puritySelect.value = record.purity;

  if (Investments.isLive(record)) {
    state.selectedSymbol = { symbol: record.symbol, name: record.name };
    document.querySelector('[data-form-live-toggle]').checked = true;
    document.querySelector('[data-form-quantity]').value = record.quantity;
    document.querySelector('[data-form-avgprice]').value = record.avgPrice;
    showSelectedSymbol(record.symbol, record.lastPrice);
    toggleLiveFields(true);
    setValueFieldsEditable(false);
    updateGenQtyModeUI();
  } else if (Investments.hasUnits(record)) {
    document.querySelector('[data-form-gen-qty-toggle]').checked = true;
    document.querySelector('[data-form-gen-quantity]').value = record.quantity;
    document.querySelector('[data-form-gen-avgprice]').value = typeof record.avgPrice === 'number' ? record.avgPrice : '';
    document.querySelector('[data-form-gen-currentprice]').value = typeof record.currentPrice === 'number' ? record.currentPrice : '';
    updateGenQtyModeUI();
  } else {
    document.querySelector('[data-form-gen-qty-toggle]').checked = false;
    updateGenQtyModeUI();
  }

  Modal.open('#investmentModal');
}

function handleSubmit(form) {
  const name = form.querySelector('[data-form-name]').value.trim();
  const date = form.querySelector('[data-form-date]').value;
  const type = form.querySelector('[data-form-type]').value;
  const liveToggle = form.querySelector('[data-form-live-toggle]');
  const isLiveLink = isStockType(type) && liveToggle && liveToggle.checked;
  const genToggle = form.querySelector('[data-form-gen-qty-toggle]');
  const isGenQtyMode = !isLiveLink && genToggle && genToggle.checked;

  if (!name) {
    Toast.show('Please give this investment a name.', 'error');
    return;
  }
  if (!date) {
    Toast.show('Please select the investment date.', 'error');
    return;
  }

  let payload;

  if (isLiveLink) {
    const quantity = parseFloat(form.querySelector('[data-form-quantity]').value);
    const avgPrice = parseFloat(form.querySelector('[data-form-avgprice]').value);

    if (!state.selectedSymbol) {
      Toast.show('Search and select an NSE/BSE stock to link a live price.', 'error');
      return;
    }
    if (Number.isNaN(quantity) || quantity <= 0 || Number.isNaN(avgPrice) || avgPrice < 0) {
      Toast.show('Enter a valid quantity and average buy price.', 'error');
      return;
    }

    const lastPrice = parseFloat(form.querySelector('[data-form-value]').dataset.livePrice || '0');
    payload = {
      date,
      name,
      type,
      symbol: state.selectedSymbol.symbol,
      provider: window.MarketData.getProvider(),
      quantity,
      avgPrice,
      currentPrice: null,
      lastPrice: lastPrice || avgPrice,
      lastPriceUpdate: new Date().toISOString(),
      value: (lastPrice || avgPrice) * quantity,
      costBasis: avgPrice * quantity,
      dayChangeAmt: null,
      dayChangePct: null,
    };
  } else if (isGenQtyMode) {
    const fieldCfg = getFieldConfig(type);
    const quantity = parseFloat(form.querySelector('[data-form-gen-quantity]').value);
    const avgPrice = parseFloat(form.querySelector('[data-form-gen-avgprice]').value);
    const currentPriceRaw = form.querySelector('[data-form-gen-currentprice]').value;
    const currentPriceParsed = currentPriceRaw !== '' ? parseFloat(currentPriceRaw) : NaN;
    const purity = fieldCfg.purity ? form.querySelector('[data-form-purity]').value : null;

    if (Number.isNaN(quantity) || quantity <= 0 || Number.isNaN(avgPrice) || avgPrice < 0) {
      Toast.show(`Enter a valid ${fieldCfg.qtyLabel.toLowerCase()} and ${fieldCfg.priceLabel.toLowerCase()}.`, 'error');
      return;
    }
    const currentPrice = Number.isNaN(currentPriceParsed) ? avgPrice : currentPriceParsed;

    payload = {
      date,
      name,
      type,
      quantity,
      avgPrice,
      currentPrice,
      purity,
      value: currentPrice * quantity,
      costBasis: avgPrice * quantity,
      symbol: null,
      provider: null,
      lastPrice: null,
      lastPriceUpdate: null,
      dayChangeAmt: null,
      dayChangePct: null,
    };
  } else {
    const value = parseFloat(form.querySelector('[data-form-value]').value);
    const costBasis = parseFloat(form.querySelector('[data-form-costbasis]').value);
    if (Number.isNaN(value) || value < 0 || Number.isNaN(costBasis) || costBasis < 0) {
      Toast.show('Please fill in a current value and cost basis.', 'error');
      return;
    }
    // Clear any stale unit/live-link fields if the user switched modes on an edited holding.
    payload = {
      date,
      name,
      type,
      value,
      costBasis,
      symbol: null,
      provider: null,
      quantity: null,
      avgPrice: null,
      currentPrice: null,
      purity: null,
      lastPrice: null,
      lastPriceUpdate: null,
      dayChangeAmt: null,
      dayChangePct: null,
    };
  }

  if (state.editingId) {
    Investments.update(state.editingId, payload);
    Toast.show('Investment updated.');
  } else {
    const created = Investments.add(payload);
    if (created.quantity) {
      HoldingLots.add({ holdingId: created.id, date: created.date, quantity: created.quantity, price: created.avgPrice });
    }
    Toast.show('Investment added.');
  }
  Modal.close('#investmentModal');
  render();
}

function handleDelete(id) {
  const record = Investments.get(id);
  if (!record) return;
  if (!window.confirm(`Remove "${record.name}" from your portfolio?`)) return;
  Investments.remove(id);
  Toast.show('Investment removed.', 'info');
  render();
}

/* ---------------- Holding detail popup + Add Entry (average-in) ---------------- */

const holdingDetailState = { holdingId: null };

function bindHoldingDetail() {
  const addEntryBtn = document.querySelector('[data-add-holding-entry-btn]');
  if (addEntryBtn) {
    addEntryBtn.addEventListener('click', () => openHoldingEntryModal(holdingDetailState.holdingId));
  }

  const historyBtn = document.querySelector('[data-view-holding-history-btn]');
  if (historyBtn) {
    historyBtn.addEventListener('click', () => openHoldingHistoryModal(holdingDetailState.holdingId));
  }

  const dividendsBtn = document.querySelector('[data-view-holding-dividends-btn]');
  if (dividendsBtn) {
    dividendsBtn.addEventListener('click', () => {
      const id = holdingDetailState.holdingId;
      if (!id) return;
      const hasAny = Dividends.all().some((d) => d.holdingId === id);
      if (hasAny) {
        openDividendSummaryModal(id, getGroupedDividends());
      } else {
        openDividendModal({ holdingId: id });
      }
    });
  }

  const editBtn = document.querySelector('[data-holding-detail-edit-btn]');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      const id = holdingDetailState.holdingId;
      Modal.close('#holdingDetailModal');
      if (id) openEditModal(id);
    });
  }

  const deleteBtn = document.querySelector('[data-holding-detail-delete-btn]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      const id = holdingDetailState.holdingId;
      if (!id) return;
      const record = Investments.get(id);
      if (!record) return;
      if (!window.confirm(`Remove "${record.name}" from your portfolio?`)) return;
      Investments.remove(id);
      Toast.show('Investment removed.', 'info');
      Modal.close('#holdingDetailModal');
      render();
    });
  }

  const entryForm = document.querySelector('[data-holding-entry-form]');
  if (entryForm) {
    entryForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleHoldingEntrySubmit(entryForm);
    });
  }
}

function statBlock(label, value, cls = '') {
  return `
    <div class="glass card" style="padding: var(--sp-3) var(--sp-4);">
      <div class="card__title" style="font-size:var(--fs-xs); color:var(--color-text-muted); text-transform:uppercase; letter-spacing:0.05em;">${label}</div>
      <div class="num ${cls}" style="font-size:var(--fs-lg); font-weight:600; margin-top:2px;">${value}</div>
    </div>`;
}

function openHoldingDetailModal(id) {
  const record = Investments.get(id);
  if (!record) return;
  holdingDetailState.holdingId = id;

  const meta = Investments.typeMeta(record.type);
  document.querySelector('[data-holding-detail-title]').textContent = record.name;
  document.querySelector('[data-holding-detail-sub]').textContent =
    `${record.type}${Investments.isLive(record) ? ` \u00b7 ${record.symbol} \u00b7 LIVE` : ''}`;

  const hasUnits = Investments.hasUnits(record);
  const unitPrice = Investments.unitPrice(record);
  const pl = Investments.profitLoss(record);
  const plPct = Investments.profitLossPct(record);
  const isGain = pl >= 0;
  const plClass = isGain ? 'holdings-table__pos' : 'holdings-table__neg';
  const dayChange = Investments.dayChange(record);

  const fieldCfg = getFieldConfig(record.type);
  const blocks = [];
  if (hasUnits) {
    blocks.push(statBlock(fieldCfg.qtyLabel, formatQty(record.quantity)));
    blocks.push(statBlock(fieldCfg.priceLabel.replace(/\s*\(.*?\)/, ''), typeof record.avgPrice === 'number' ? Helpers.formatCurrency(record.avgPrice) : '\u2014'));
    blocks.push(statBlock(fieldCfg.currentPriceLabel.replace(/\s*\(.*?\)/, ''), unitPrice !== null ? Helpers.formatCurrency(unitPrice) : '\u2014'));
    blocks.push(statBlock(
      "Day's Change",
      dayChange ? `${dayChange.amt >= 0 ? '+' : ''}${dayChange.pct.toFixed(2)}%` : '\u2014',
      dayChange ? (dayChange.amt >= 0 ? 'holdings-table__pos' : 'holdings-table__neg') : ''
    ));
  }
  if (record.purity) blocks.push(statBlock('Purity', record.purity));
  blocks.push(statBlock(fieldCfg.costLabel, Helpers.formatCurrency(record.costBasis)));
  blocks.push(statBlock(fieldCfg.valueLabel, Helpers.formatCurrency(record.value)));
  blocks.push(statBlock('Profit / Loss', `${isGain ? '+' : '-'}${Helpers.formatCurrency(Math.abs(pl))}`, plClass));
  blocks.push(statBlock('P/L %', `${isGain ? '+' : ''}${plPct.toFixed(1)}%`, plClass));

  const dividendsReceived = Dividends.all()
    .filter((d) => d.holdingId === id)
    .reduce((sum, d) => sum + d.amount, 0);
  blocks.push(statBlock('Dividends Received', `+${Helpers.formatCurrency(dividendsReceived)}`, dividendsReceived > 0 ? 'holdings-table__pos' : ''));

  const cagr = computeCAGR(record, id);
  blocks.push(statBlock(
    'CAGR',
    cagr !== null ? `${cagr >= 0 ? '+' : ''}${cagr.toFixed(1)}%` : '\u2014 (too new)',
    cagr !== null ? (cagr >= 0 ? 'holdings-table__pos' : 'holdings-table__neg') : ''
  ));

  document.querySelector('[data-holding-detail-stats]').innerHTML = blocks.join('');
  Modal.open('#holdingDetailModal');
}

/** Compound Annual Growth Rate from the earliest recorded buy for this
 *  holding to today, based on cost basis vs current value. Returns null
 *  when it can't be meaningfully computed (no cost, or bought too recently
 *  to annualize without wild swings). */
function computeCAGR(record, id) {
  if (!(record.costBasis > 0) || !(record.value >= 0)) return null;
  const startDateStr = HoldingLots.earliestDate(id) || record.date;
  if (!startDateStr) return null;
  const start = new Date(startDateStr);
  if (Number.isNaN(start.getTime())) return null;
  const years = (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  if (years < (7 / 365.25)) return null; // held less than a week — annualizing would be meaningless
  const ratio = record.value / record.costBasis;
  if (ratio <= 0) return null;
  return (Math.pow(ratio, 1 / years) - 1) * 100;
}

/** "When I buy this stock" — every recorded lot for a holding, newest
 *  first. Falls back to a single synthesized entry from the holding's own
 *  quantity/avgPrice/date for holdings created before lot-tracking existed. */
function openHoldingHistoryModal(id) {
  const record = Investments.get(id);
  if (!record) return;

  document.querySelector('[data-holding-history-title]').textContent = `${record.name} \u2014 Purchase History`;

  let lots = pickRelevantLots(id);
  if (lots.length === 0 && Investments.hasUnits(record)) {
    lots = [{ date: record.date, quantity: record.quantity, price: record.avgPrice }];
  }

  const body = document.querySelector('[data-holding-history-body]');
  if (lots.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          <i class="fa-solid fa-clock-rotate-left"></i>
          No purchase history to show for this holding.
        </td>
      </tr>`;
  } else {
    body.innerHTML = lots
      .map((l) => `
        <tr>
          <td>${Helpers.formatShortDateWithYear(l.date)}</td>
          <td>${l.type === 'sell' ? '<span class="chip tone-negative">Sell</span>' : '<span class="chip tone-accent">Buy</span>'}</td>
          <td class="text-right">${formatQty(Number(l.quantity))}</td>
          <td class="text-right">${Helpers.formatCurrency(l.price)}</td>
          <td class="text-right">${Helpers.formatCurrency(Number(l.quantity) * Number(l.price))}</td>
        </tr>`)
      .join('');
  }

  Modal.open('#holdingHistoryModal');
}

function openHoldingEntryModal(id) {
  const record = Investments.get(id);
  if (!record) return;
  holdingDetailState.holdingId = id;

  const form = document.querySelector('[data-holding-entry-form]');
  form.reset();
  document.querySelector('[data-holding-entry-title]').textContent = `Add Entry \u2014 ${record.name}`;
  document.querySelector('[data-form-entry-date]').value = new Date().toISOString().slice(0, 10);

  const hasUnits = Investments.hasUnits(record);
  document.querySelector('[data-holding-entry-unit-fields]').style.display = hasUnits ? '' : 'none';
  document.querySelector('[data-holding-entry-manual-fields]').style.display = hasUnits ? 'none' : '';

  const fieldCfg = getFieldConfig(record.type);
  const unitNoun = fieldCfg.qtyLabel.replace(/\s*\(.*?\)/, '').toLowerCase();
  applyFieldLabelsForType(record.type);

  const currentNote = document.querySelector('[data-holding-entry-current]');
  const previewNote = document.querySelector('[data-holding-entry-preview]');
  if (hasUnits) {
    currentNote.textContent = `Current position: ${formatQty(record.quantity)} ${unitNoun} @ ${Helpers.formatCurrency(record.avgPrice)} avg.`;
    previewNote.textContent = `This lot will be averaged in with your existing ${unitNoun} and price.`;

    const qtyInput = document.querySelector('[data-form-entry-quantity]');
    const priceInput = document.querySelector('[data-form-entry-price]');
    const updatePreview = () => {
      const addQty = parseFloat(qtyInput.value);
      const addPrice = parseFloat(priceInput.value);
      if (Number.isNaN(addQty) || addQty <= 0 || Number.isNaN(addPrice) || addPrice < 0) {
        previewNote.textContent = `This lot will be averaged in with your existing ${unitNoun} and price.`;
        return;
      }
      const newQty = record.quantity + addQty;
      const newAvg = (record.quantity * record.avgPrice + addQty * addPrice) / newQty;
      previewNote.textContent = `New position: ${formatQty(newQty)} ${unitNoun} @ ${Helpers.formatCurrency(newAvg)} avg.`;
    };
    qtyInput.oninput = updatePreview;
    priceInput.oninput = updatePreview;
  } else {
    currentNote.textContent = `Current cost basis: ${Helpers.formatCurrency(record.costBasis)} \u00b7 Current value: ${Helpers.formatCurrency(record.value)}.`;
    previewNote.textContent = '';
  }

  Modal.open('#holdingEntryModal');
}

function handleHoldingEntrySubmit(form) {
  const id = holdingDetailState.holdingId;
  const record = Investments.get(id);
  if (!record) return;

  const date = form.querySelector('[data-form-entry-date]').value;
  if (!date) {
    Toast.show('Please select a date.', 'error');
    return;
  }

  const hasUnits = Investments.hasUnits(record);
  let payload;

  if (hasUnits) {
    const addQty = parseFloat(form.querySelector('[data-form-entry-quantity]').value);
    const addPrice = parseFloat(form.querySelector('[data-form-entry-price]').value);
    if (Number.isNaN(addQty) || addQty <= 0 || Number.isNaN(addPrice) || addPrice < 0) {
      Toast.show('Enter a valid quantity and buy price.', 'error');
      return;
    }
    const newQty = record.quantity + addQty;
    const newAvg = (record.quantity * record.avgPrice + addQty * addPrice) / newQty;
    HoldingLots.add({ holdingId: id, date, quantity: addQty, price: addPrice });

    if (Investments.isLive(record)) {
      const ltp = typeof record.lastPrice === 'number' ? record.lastPrice : newAvg;
      payload = {
        quantity: newQty,
        avgPrice: newAvg,
        costBasis: newAvg * newQty,
        value: ltp * newQty,
      };
    } else {
      const currentPrice = typeof record.currentPrice === 'number' ? record.currentPrice : newAvg;
      payload = {
        quantity: newQty,
        avgPrice: newAvg,
        currentPrice,
        costBasis: newAvg * newQty,
        value: currentPrice * newQty,
      };
    }
  } else {
    const addInvested = parseFloat(form.querySelector('[data-form-entry-invested]').value);
    const addValueRaw = form.querySelector('[data-form-entry-value]').value;
    const addValue = addValueRaw !== '' ? parseFloat(addValueRaw) : addInvested;
    if (Number.isNaN(addInvested) || addInvested <= 0) {
      Toast.show('Enter a valid amount invested.', 'error');
      return;
    }
    payload = {
      costBasis: record.costBasis + addInvested,
      value: record.value + (Number.isNaN(addValue) ? addInvested : addValue),
    };
  }

  Investments.update(id, payload);
  Toast.show('Entry added — position updated.');
  Modal.close('#holdingEntryModal');
  render();
  openHoldingDetailModal(id);
}

/* ---------------- Live stock (NSE/BSE) controls ---------------- */

function updateStockFieldsVisibility() {
  const type = document.querySelector('#investmentModal [data-form-type]').value;
  const toggleWrap = document.querySelector('[data-stock-live-toggle-wrap]');
  if (toggleWrap) toggleWrap.style.display = isStockType(type) ? '' : 'none';

  if (!isStockType(type)) {
    document.querySelector('[data-form-live-toggle]').checked = false;
    toggleLiveFields(false);
  }
  applyFieldLabelsForType(type);
  updateGenQtyModeUI();
}

/**
 * Relabels the Add/Edit Asset form to match the asset type selected —
 * e.g. "Weight (grams)" + "Rate per gram" for physical gold, "Units" +
 * "NAV" for mutual funds, "Quantity / Shares" for stocks — and shows the
 * Purity dropdown for precious metals. Called whenever the type changes.
 */
function applyFieldLabelsForType(type) {
  const cfg = getFieldConfig(type);

  const setText = (sel, text) => { const el = document.querySelector(sel); if (el) el.textContent = text; };
  const setPlaceholder = (sel, text) => { const el = document.querySelector(sel); if (el) el.placeholder = text; };
  const setStep = (sel, step) => { const el = document.querySelector(sel); if (el) el.step = step; };

  setText('[data-gen-qty-label]', cfg.qtyLabel);
  setText('[data-gen-price-label]', cfg.priceLabel);
  setText('[data-gen-currentprice-label]', cfg.currentPriceLabel);
  setText('[data-gen-qty-toggle-label]', cfg.toggleLabel);
  setText('[data-gen-qty-help]', cfg.helpText);
  setText('[data-value-label]', cfg.valueLabel);
  setText('[data-cost-label]', cfg.costLabel);
  setText('[data-manual-value-hint]', cfg.valueHelpText);

  setPlaceholder('[data-form-gen-quantity]', cfg.qtyPlaceholder);
  setPlaceholder('[data-form-gen-avgprice]', cfg.pricePlaceholder);
  setStep('[data-form-gen-quantity]', cfg.qtyStep);

  // Entry (average-in) modal mirrors the same labels.
  setText('[data-entry-qty-label]', cfg.qtyLabel);
  setText('[data-entry-price-label]', cfg.priceLabel);
  setPlaceholder('[data-form-entry-quantity]', cfg.qtyPlaceholder);
  setStep('[data-form-entry-quantity]', cfg.qtyStep);

  // Toggle visibility/lock based on qtyMode: 'forceUnits' hides the toggle and
  // locks it on; 'forceManual' hides it and locks it off; 'toggle' lets the
  // user choose (used for generic/uncommon types).
  const toggleWrap = document.querySelector('[data-gen-qty-toggle-wrap]');
  const genToggle = document.querySelector('[data-form-gen-qty-toggle]');
  if (cfg.qtyMode === 'forceUnits') {
    if (toggleWrap) toggleWrap.style.display = 'none';
    if (genToggle) genToggle.checked = true;
  } else if (cfg.qtyMode === 'forceManual') {
    if (toggleWrap) toggleWrap.style.display = 'none';
    if (genToggle) genToggle.checked = false;
  } else if (toggleWrap) {
    toggleWrap.style.display = '';
  }

  // Purity dropdown — only for physical/digital gold & silver.
  const purityField = document.querySelector('[data-purity-field]');
  const puritySelect = document.querySelector('[data-form-purity]');
  const purityLabel = document.querySelector('[data-purity-label]');
  if (cfg.purity && purityField && puritySelect) {
    purityField.style.display = '';
    purityLabel.textContent = /silver/i.test(type) ? 'Silver Purity' : 'Gold Purity';
    const current = puritySelect.value;
    puritySelect.innerHTML = cfg.purity.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    if (cfg.purity.includes(current)) puritySelect.value = current;
  } else if (purityField) {
    purityField.style.display = 'none';
  }
}

function resetLiveStockUI() {
  document.querySelector('[data-form-live-toggle]').checked = false;
  document.querySelector('[data-form-symbol-search]').value = '';
  document.querySelector('[data-symbol-results]').style.display = 'none';
  document.querySelector('[data-selected-symbol-wrap]').style.display = 'none';
  toggleLiveFields(false);
}

function toggleLiveFields(show) {
  const fieldsWrap = document.querySelector('[data-stock-live-fields]');
  if (fieldsWrap) fieldsWrap.style.display = show ? '' : 'none';
}

function setValueFieldsEditable(editable) {
  const valueInput = document.querySelector('[data-form-value]');
  const costInput = document.querySelector('[data-form-costbasis]');
  [valueInput, costInput].forEach((el) => {
    if (!el) return;
    el.readOnly = !editable;
    el.style.opacity = editable ? '1' : '0.7';
  });
}

function showSelectedSymbol(symbol, price) {
  const wrap = document.querySelector('[data-selected-symbol-wrap]');
  const label = document.querySelector('[data-selected-symbol-label]');
  const priceEl = document.querySelector('[data-selected-symbol-price]');
  const valueInput = document.querySelector('[data-form-value]');
  if (wrap) wrap.style.display = '';
  if (label) label.textContent = symbol;
  if (priceEl) priceEl.textContent = price ? Helpers.formatCurrency(price, 'INR') : '\u2014';
  if (valueInput && price) valueInput.dataset.livePrice = price;
  recalcLiveValueCost();
}

function recalcLiveValueCost() {
  const valueInput = document.querySelector('[data-form-value]');
  const costInput = document.querySelector('[data-form-costbasis]');
  const quantity = parseFloat(document.querySelector('[data-form-quantity]').value) || 0;
  const avgPrice = parseFloat(document.querySelector('[data-form-avgprice]').value) || 0;
  const livePrice = parseFloat(valueInput?.dataset.livePrice || '0') || avgPrice;

  if (valueInput) valueInput.value = (livePrice * quantity).toFixed(2);
  if (costInput) costInput.value = (avgPrice * quantity).toFixed(2);
}

function bindLiveStockControls() {
  const toggle = document.querySelector('[data-form-live-toggle]');
  if (toggle) {
    toggle.addEventListener('change', () => {
      toggleLiveFields(toggle.checked);
      setValueFieldsEditable(!toggle.checked);
      if (!toggle.checked) {
        state.selectedSymbol = null;
        resetGenQtyUI();
      } else {
        updateGenQtyModeUI();
      }
    });
  }

  const searchInput = document.querySelector('[data-form-symbol-search]');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(state.searchDebounce);
      const keyword = searchInput.value.trim();
      const resultsList = document.querySelector('[data-symbol-results]');
      if (keyword.length < 2) {
        resultsList.style.display = 'none';
        return;
      }
      state.searchDebounce = setTimeout(() => runSymbolSearch(keyword), 400);
    });
  }

  ['[data-form-quantity]', '[data-form-avgprice]'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.addEventListener('input', recalcLiveValueCost);
  });
}

async function runSymbolSearch(keyword) {
  const resultsList = document.querySelector('[data-symbol-results]');
  if (!window.MarketData.hasApiKey()) {
    resultsList.innerHTML = `<li style="padding:8px 10px; font-size:var(--fs-xs);">${window.MarketData.describeError(new Error('NO_API_KEY'))}</li>`;
    resultsList.style.display = '';
    return;
  }

  resultsList.innerHTML = `<li style="padding:8px 10px; font-size:var(--fs-xs);">Searching\u2026</li>`;
  resultsList.style.display = '';

  try {
    const matches = await window.MarketData.searchIndianSymbols(keyword);
    if (matches.length === 0) {
      resultsList.innerHTML = `<li style="padding:8px 10px; font-size:var(--fs-xs);">No Indian stocks found for "${escapeHtml(keyword)}".</li>`;
      return;
    }
    resultsList.innerHTML = matches
      .map(
        (m) => `
        <li data-symbol-option="${escapeHtml(m.symbol)}" data-symbol-name="${escapeHtml(m.name)}" style="padding:8px 10px; cursor:pointer; font-size:var(--fs-sm); border-bottom:1px solid var(--color-border, #333);">
          <strong>${escapeHtml(m.symbol)}</strong> \u2014 ${escapeHtml(m.name)}
        </li>`
      )
      .join('');
    resultsList.querySelectorAll('[data-symbol-option]').forEach((li) => {
      li.addEventListener('click', () => selectSymbol(li.dataset.symbolOption, li.dataset.symbolName));
    });
  } catch (err) {
    resultsList.innerHTML = `<li style="padding:8px 10px; font-size:var(--fs-xs);">${window.MarketData.describeError(err)}</li>`;
  }
}

async function selectSymbol(symbol, name) {
  const resultsList = document.querySelector('[data-symbol-results]');
  resultsList.style.display = 'none';
  document.querySelector('[data-form-symbol-search]').value = `${symbol} \u2014 ${name}`;
  state.selectedSymbol = { symbol, name };

  const nameInput = document.querySelector('#investmentModal [data-form-name]');
  if (!nameInput.value.trim()) nameInput.value = name;

  showSelectedSymbol(symbol, null);
  try {
    const price = await window.MarketData.getQuote(symbol);
    showSelectedSymbol(symbol, price);
  } catch (err) {
    Toast.show(window.MarketData.describeError(err), 'error');
  }
}

function bindRefreshButton() {
  const btn = document.querySelector('[data-refresh-prices-btn]');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!window.MarketData.hasApiKey()) {
      Toast.show(window.MarketData.describeError(new Error('NO_API_KEY')), 'error');
      return;
    }
    const linkedCount = Investments.all().filter((i) => Investments.isLive(i)).length;
    if (linkedCount === 0) {
      Toast.show('No live-linked stocks yet. Add one and link it to an NSE/BSE ticker.', 'info');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing\u2026';
    const result = await Investments.refreshAllLivePrices({
      onProgress: () => render(),
    });
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh Live Prices';

    if (result.failed.length === 0) {
      Toast.show(`Updated ${result.updated} live price(s).`);
    } else {
      const firstFailure = result.failed[0];
      Toast.show(
        `Updated ${result.updated}, ${result.failed.length} failed \u2014 ${window.MarketData.describeError(firstFailure.err, firstFailure.holding.provider)}`,
        'error'
      );
    }
    render();
  });
}

/* ---------------- Generic quantity & price controls ---------------- */

/** Whether this type defaults to quantity/price tracking (vs. lump-sum manual entry). */
function typeDefaultsToQtyMode(type) {
  return getFieldConfig(type).qtyMode !== 'forceManual';
}

function resetGenQtyUI() {
  const type = document.querySelector('#investmentModal [data-form-type]').value;
  const toggle = document.querySelector('[data-form-gen-qty-toggle]');
  document.querySelector('[data-form-gen-quantity]').value = '';
  document.querySelector('[data-form-gen-avgprice]').value = '';
  document.querySelector('[data-form-gen-currentprice]').value = '';
  const puritySelect = document.querySelector('[data-form-purity]');
  if (puritySelect) puritySelect.selectedIndex = 0;
  if (toggle) toggle.checked = typeDefaultsToQtyMode(type);
  applyFieldLabelsForType(type);
  updateGenQtyModeUI();
}

function updateGenQtyModeUI() {
  const type = document.querySelector('#investmentModal [data-form-type]').value;
  const liveToggle = document.querySelector('[data-form-live-toggle]');
  const isLiveLink = isStockType(type) && liveToggle && liveToggle.checked;

  const toggleWrap = document.querySelector('[data-gen-qty-toggle-wrap]');
  const genFields = document.querySelector('[data-gen-qty-fields]');
  const genToggle = document.querySelector('[data-form-gen-qty-toggle]');
  const manualHint = document.querySelector('[data-manual-value-hint]');

  if (isLiveLink) {
    // Live-linked stocks use their own quantity/avgPrice fields & live price — hide the generic block entirely.
    if (toggleWrap) toggleWrap.style.display = 'none';
    if (genFields) genFields.style.display = 'none';
    if (manualHint) manualHint.style.display = 'none';
    return;
  }

  const forcedMode = getFieldConfig(type).qtyMode;
  if (toggleWrap) toggleWrap.style.display = forcedMode === 'toggle' ? '' : 'none';
  const qtyMode = forcedMode === 'forceUnits' ? true : forcedMode === 'forceManual' ? false : !!(genToggle && genToggle.checked);
  if (genFields) genFields.style.display = qtyMode ? '' : 'none';
  if (manualHint) manualHint.style.display = qtyMode ? 'none' : '';
  setValueFieldsEditable(!qtyMode);
  if (qtyMode) recalcGenValueCost();
}

function bindGenQtyControls() {
  const toggle = document.querySelector('[data-form-gen-qty-toggle]');
  if (toggle) toggle.addEventListener('change', () => updateGenQtyModeUI());

  ['[data-form-gen-quantity]', '[data-form-gen-avgprice]', '[data-form-gen-currentprice]'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.addEventListener('input', recalcGenValueCost);
  });
}

function recalcGenValueCost() {
  const genToggle = document.querySelector('[data-form-gen-qty-toggle]');
  if (!genToggle || !genToggle.checked) return;
  const valueInput = document.querySelector('[data-form-value]');
  const costInput = document.querySelector('[data-form-costbasis]');
  const quantity = parseFloat(document.querySelector('[data-form-gen-quantity]').value) || 0;
  const avgPrice = parseFloat(document.querySelector('[data-form-gen-avgprice]').value) || 0;
  const currentPriceRaw = document.querySelector('[data-form-gen-currentprice]').value;
  const currentPrice = currentPriceRaw !== '' ? (parseFloat(currentPriceRaw) || 0) : avgPrice;

  if (valueInput) valueInput.value = (currentPrice * quantity).toFixed(2);
  if (costInput) costInput.value = (avgPrice * quantity).toFixed(2);
}

/* ---------------- Dividends ---------------- */

const dividendState = { editingId: null, selectedHoldingId: null, searchDebounce: null, detailHoldingId: null, summaryHoldingId: null };

function bindDividendForm() {
  const addBtn = document.querySelector('[data-add-dividend-btn]');
  if (addBtn) addBtn.addEventListener('click', () => openDividendModal());

  const addEntryBtn = document.querySelector('[data-add-dividend-entry-btn]');
  if (addEntryBtn) {
    addEntryBtn.addEventListener('click', () => {
      openDividendModal({ holdingId: dividendState.summaryHoldingId });
    });
  }

  const historyBtn = document.querySelector('[data-view-dividend-history-btn]');
  if (historyBtn) {
    historyBtn.addEventListener('click', () => {
      if (dividendState.summaryHoldingId) openDividendDetailModal(dividendState.summaryHoldingId, getGroupedDividends());
    });
  }

  const form = document.querySelector('[data-dividend-form]');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handleDividendSubmit(form);
    });
  }

  bindDividendHoldingSearch();

  const detailModal = document.querySelector('#dividendDetailModal');
  if (detailModal) {
    detailModal.addEventListener('click', (e) => {
      if (e.target === detailModal || e.target.closest('[data-modal-close]')) {
        dividendState.detailHoldingId = null;
      }
    });
  }

  const summaryModal = document.querySelector('#dividendSummaryModal');
  if (summaryModal) {
    summaryModal.addEventListener('click', (e) => {
      if (e.target === summaryModal || e.target.closest('[data-modal-close]')) {
        dividendState.summaryHoldingId = null;
      }
    });
  }
}

/** Type-to-search holding picker — only shows matches once the user types,
 *  rather than listing every holding up front. */
function bindDividendHoldingSearch() {
  const searchInput = document.querySelector('[data-form-dividend-holding-search]');
  const resultsList = document.querySelector('[data-dividend-holding-results]');
  if (!searchInput || !resultsList) return;

  searchInput.addEventListener('input', () => {
    clearTimeout(dividendState.searchDebounce);
    // Typing invalidates any previously selected holding until re-picked.
    dividendState.selectedHoldingId = null;
    document.querySelector('[data-form-dividend-holding]').value = '';

    const keyword = searchInput.value.trim().toLowerCase();
    if (keyword.length < 3) {
      resultsList.style.display = 'none';
      return;
    }
    dividendState.searchDebounce = setTimeout(() => runDividendHoldingSearch(keyword), 120);
  });

  searchInput.addEventListener('focus', () => {
    const keyword = searchInput.value.trim().toLowerCase();
    if (keyword.length >= 3) runDividendHoldingSearch(keyword);
  });

  document.addEventListener('click', (e) => {
    if (!resultsList.contains(e.target) && e.target !== searchInput) {
      resultsList.style.display = 'none';
    }
  });
}

function runDividendHoldingSearch(keyword) {
  const resultsList = document.querySelector('[data-dividend-holding-results]');
  const matches = Investments.all()
    .filter((h) => h.name.toLowerCase().includes(keyword))
    .slice(0, 8);

  if (matches.length === 0) {
    resultsList.innerHTML = `<li style="padding:8px 10px; font-size:var(--fs-xs); color:var(--color-text-faint);">No holdings match "${escapeHtml(keyword)}".</li>`;
    resultsList.style.display = '';
    return;
  }

  resultsList.innerHTML = matches
    .map(
      (h) => `
      <li data-holding-option="${h.id}" style="padding:8px 10px; cursor:pointer; font-size:var(--fs-sm); border-bottom:1px solid var(--color-border, #333);">
        <strong>${escapeHtml(h.name)}</strong> \u00b7 ${escapeHtml(h.type)}
      </li>`
    )
    .join('');
  resultsList.querySelectorAll('[data-holding-option]').forEach((li) => {
    li.addEventListener('click', () => selectDividendHolding(li.dataset.holdingOption));
  });
  resultsList.style.display = '';
}

function selectDividendHolding(holdingId) {
  const holding = Investments.get(holdingId);
  if (!holding) return;
  dividendState.selectedHoldingId = holdingId;
  document.querySelector('[data-form-dividend-holding]').value = holdingId;
  document.querySelector('[data-form-dividend-holding-search]').value = `${holding.name} \u00b7 ${holding.type}`;
  document.querySelector('[data-dividend-holding-results]').style.display = 'none';
}

/** Opens the Add/Edit Dividend modal.
 *  - openDividendModal() — plain add, holding picked via search.
 *  - openDividendModal({ holdingId }) — add a new payment for a holding
 *    that's already known (e.g. from that holding's history popup), so the
 *    holding search is skipped and only date/qty/amount/notes are asked.
 *  - openDividendModal({ editId }) — edit an existing payment; holding is
 *    fixed to whatever it already was, fields are pre-filled.
 */
function openDividendModal({ holdingId = null, editId = null } = {}) {
  const form = document.querySelector('[data-dividend-form]');
  form.reset();
  document.querySelector('[data-dividend-holding-results]').style.display = 'none';

  const searchWrap = document.querySelector('[data-dividend-holding-search-wrap]');
  const staticWrap = document.querySelector('[data-dividend-holding-static-wrap]');
  const searchInput = document.querySelector('[data-form-dividend-holding-search]');

  if (editId) {
    const record = Dividends.get(editId);
    if (!record) return;
    dividendState.editingId = editId;
    dividendState.selectedHoldingId = record.holdingId;

    document.querySelector('[data-dividend-modal-title]').textContent = 'Edit Dividend';
    document.querySelector('[data-form-dividend-holding]').value = record.holdingId;
    searchWrap.style.display = 'none';
    staticWrap.style.display = '';
    document.querySelector('[data-dividend-holding-static-label]').textContent = `${record.holdingName} \u00b7 ${record.holdingType || ''}`;

    document.querySelector('[data-form-dividend-quantity]').value = record.quantity ?? '';
    document.querySelector('[data-form-dividend-amount]').value = record.amount ?? '';
    document.querySelector('[data-form-dividend-date]').value = record.date || new Date().toISOString().slice(0, 10);
    document.querySelector('[data-form-dividend-notes]').value = record.notes || '';
  } else if (holdingId) {
    const holding = Investments.get(holdingId);
    if (!holding) return;
    dividendState.editingId = null;
    dividendState.selectedHoldingId = holdingId;

    document.querySelector('[data-dividend-modal-title]').textContent = `Add Dividend \u2014 ${holding.name}`;
    document.querySelector('[data-form-dividend-holding]').value = holdingId;
    searchWrap.style.display = 'none';
    staticWrap.style.display = '';
    document.querySelector('[data-dividend-holding-static-label]').textContent = `${holding.name} \u00b7 ${holding.type}`;
    document.querySelector('[data-form-dividend-date]').value = new Date().toISOString().slice(0, 10);
  } else {
    dividendState.editingId = null;
    dividendState.selectedHoldingId = null;

    document.querySelector('[data-dividend-modal-title]').textContent = 'Add Dividend';
    document.querySelector('[data-form-dividend-holding]').value = '';
    searchWrap.style.display = '';
    staticWrap.style.display = 'none';
    if (searchInput) searchInput.value = '';
    document.querySelector('[data-form-dividend-date]').value = new Date().toISOString().slice(0, 10);

    if (Investments.all().length === 0) {
      Toast.show('Add an investment first, then record dividends against it.', 'info');
      return;
    }
  }

  Modal.open('#dividendModal');
}

function handleDividendSubmit(form) {
  const holdingId = form.querySelector('[data-form-dividend-holding]').value;
  const quantityRaw = form.querySelector('[data-form-dividend-quantity]').value;
  const quantity = quantityRaw !== '' ? parseFloat(quantityRaw) : null;
  const amount = parseFloat(form.querySelector('[data-form-dividend-amount]').value);
  const date = form.querySelector('[data-form-dividend-date]').value;
  const notes = form.querySelector('[data-form-dividend-notes]').value.trim();

  const holding = Investments.get(holdingId);
  if (!holding) {
    Toast.show('Search and select which holding this dividend is from.', 'error');
    return;
  }
  if (Number.isNaN(amount) || amount <= 0) {
    Toast.show('Enter a valid dividend amount.', 'error');
    return;
  }
  if (!date) {
    Toast.show('Please select a date.', 'error');
    return;
  }

  const payload = {
    holdingId: holding.id,
    holdingName: holding.name,
    holdingType: holding.type,
    quantity: quantity !== null && !Number.isNaN(quantity) ? quantity : null,
    amount,
    date,
    notes,
  };

  const wasEditing = dividendState.editingId;
  if (wasEditing) {
    Dividends.update(wasEditing, payload);
    Toast.show('Dividend updated.');
  } else {
    Dividends.add(payload);
    Toast.show('Dividend recorded.');
  }
  dividendState.editingId = null;
  Modal.close('#dividendModal');
  renderDividends();
  renderSummary(Investments.all());

  // If we came from a holding's summary or history popup, refresh it in place.
  if (dividendState.summaryHoldingId === holding.id) {
    openDividendSummaryModal(holding.id, getGroupedDividends());
  }
  if (dividendState.detailHoldingId === holding.id) {
    openDividendDetailModal(holding.id, getGroupedDividends());
  }
}

function bindDividendFilters() {
  ['[data-dividends-search]', '[data-dividends-filter-type]', '[data-dividends-sort]'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, Helpers.debounce(() => renderDividends(), 150));
  });

  const dateSelect = document.querySelector('[data-dividends-filter-date]');
  if (dateSelect) {
    dateSelect.addEventListener('change', () => {
      const isCustom = dateSelect.value === 'custom';
      document.querySelector('[data-dividends-filter-date-from]').style.display = isCustom ? '' : 'none';
      document.querySelector('[data-dividends-filter-date-to]').style.display = isCustom ? '' : 'none';
      renderDividends();
    });
  }
  ['[data-dividends-filter-date-from]', '[data-dividends-filter-date-to]'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.addEventListener('change', () => renderDividends());
  });
}

/** Keeps the Asset Type filter dropdown in sync with whatever types you
 *  actually hold, without wiping out the user's current selection. */
function populateDividendTypeFilter() {
  const select = document.querySelector('[data-dividends-filter-type]');
  if (!select) return;
  const current = select.value || 'all';
  const types = Array.from(new Set(Investments.all().map((i) => i.type))).sort();
  select.innerHTML = `<option value="all">All Types</option>` +
    types.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  select.value = types.includes(current) ? current : 'all';
}

function filterDividendEntries() {
  const all = Dividends.all();
  const search = (document.querySelector('[data-dividends-search]')?.value || '').trim().toLowerCase();
  const typeFilter = document.querySelector('[data-dividends-filter-type]')?.value || 'all';
  const dateFilter = document.querySelector('[data-dividends-filter-date]')?.value || 'all';
  const dateFrom = document.querySelector('[data-dividends-filter-date-from]')?.value;
  const dateTo = document.querySelector('[data-dividends-filter-date-to]')?.value;

  return all.filter((d) => {
    if (search && !(`${d.holdingName} ${d.notes || ''}`.toLowerCase().includes(search))) return false;
    if (typeFilter !== 'all' && d.holdingType !== typeFilter) return false;

    if (dateFilter !== 'all') {
      const dd = new Date(d.date);
      const now = new Date();
      if (dateFilter === 'today') {
        if (d.date !== now.toISOString().slice(0, 10)) return false;
      } else if (dateFilter === 'week') {
        const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
        if (dd < weekAgo || dd > now) return false;
      } else if (dateFilter === 'month') {
        if (dd.getMonth() !== now.getMonth() || dd.getFullYear() !== now.getFullYear()) return false;
      } else if (dateFilter === 'year') {
        if (dd.getFullYear() !== now.getFullYear()) return false;
      } else if (dateFilter === 'custom') {
        if (dateFrom && d.date < dateFrom) return false;
        if (dateTo && d.date > dateTo) return false;
      }
    }
    return true;
  });
}

/** Groups every dividend payment by holding — e.g. 3 separate CUB payments
 *  of 4, 10, and 6 become a single CUB row totalling 20, with each original
 *  payment kept (date-sorted) inside the group for the detail popup. */
function groupDividendsByHolding(entries) {
  const map = new Map();
  entries.forEach((d) => {
    // Closed/unmatched positions have no holdingId — group those by name
    // instead so two different closed-out stocks don't collapse into one
    // row (they'd otherwise all share the same `null` key).
    const key = d.holdingId || `closed:${(d.holdingName || '').toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, {
        holdingId: d.holdingId,
        groupKey: key,
        holdingName: d.holdingName,
        holdingType: d.holdingType,
        closed: !d.holdingId,
        allZerodha: true,
        totalAmount: 0,
        totalQuantity: 0,
        hasQuantity: false,
        entries: [],
      });
    }
    const g = map.get(key);
    g.totalAmount += Number(d.amount) || 0;
    if (d.quantity !== null && d.quantity !== undefined && d.quantity !== '') {
      g.totalQuantity += Number(d.quantity) || 0;
      g.hasQuantity = true;
    }
    if (d.source !== 'zerodha') g.allZerodha = false;
    g.entries.push(d);
  });

  const groups = [...map.values()];
  groups.forEach((g) => {
    g.entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    g.lastDate = g.entries[0]?.date;
    g.firstDate = g.entries[g.entries.length - 1]?.date;
    g.count = g.entries.length;
  });
  return groups;
}

function sortDividendGroups(groups, sortKey) {
  switch (sortKey) {
    case 'amount-desc':
      return groups.sort((a, b) => b.totalAmount - a.totalAmount);
    case 'amount-asc':
      return groups.sort((a, b) => a.totalAmount - b.totalAmount);
    case 'quantity-desc':
      return groups.sort((a, b) => b.totalQuantity - a.totalQuantity);
    case 'date-desc':
    default:
      return groups.sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate));
  }
}

function getGroupedDividends() {
  const entries = filterDividendEntries();
  const groups = groupDividendsByHolding(entries);
  const sortKey = document.querySelector('[data-dividends-sort]')?.value || 'date-desc';
  return sortDividendGroups(groups, sortKey);
}

function renderDividends() {
  populateDividendTypeFilter();

  const all = Dividends.all();
  setText('[data-dividend-count]', all.length);
  setText('[data-dividend-total]', Helpers.formatCurrency(Dividends.totalAll(all)));
  setText('[data-dividend-month]', Helpers.formatCurrency(Dividends.totalThisMonth(all)));
  setText('[data-dividend-year]', Helpers.formatCurrency(Dividends.totalThisYear(all)));

  const groups = getGroupedDividends();
  const body = document.querySelector('[data-dividends-body]');
  const footer = document.querySelector('[data-dividends-footer]');
  if (!body) return;

  if (groups.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          <i class="fa-solid fa-sack-dollar"></i>
          ${all.length === 0 ? 'No dividends recorded yet. Add one against a holding.' : 'No dividends match these filters.'}
        </td>
      </tr>`;
    if (footer) footer.innerHTML = '';
    return;
  }

  body.innerHTML = groups
    .map((g) => `
      <tr data-group-key="${escapeHtml(g.groupKey)}" class="dividend-group-row" style="${g.closed ? '' : 'cursor:pointer;'}">
        <td>
          <div class="holdings-table__name">
            ${escapeHtml(g.holdingName)}
            ${g.allZerodha ? '<span class="chip tone-info" style="font-size:10px;">Zerodha</span>' : ''}
            ${g.closed ? '<span class="chip tone-negative" style="font-size:10px;">Closed position</span>' : ''}
          </div>
          <div class="holdings-table__sub">${escapeHtml(g.holdingType || (g.closed ? 'Not currently held' : ''))}</div>
        </td>
        <td class="text-right holdings-table__pos">+${Helpers.formatCurrency(g.totalAmount)}</td>
        <td>${Helpers.formatShortDate(g.lastDate)}</td>
        <td class="holdings-table__sub">${g.count} payment${g.count === 1 ? '' : 's'}</td>
        <td>
          <div class="holdings-table__actions">
            ${g.closed ? '' : '<button data-view-dividend-group aria-label="View history"><i class="fa-solid fa-eye"></i></button>'}
            <button data-delete-dividend-group class="danger" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>`)
    .join('');

  body.querySelectorAll('[data-group-key]').forEach((row) => {
    const g = groups.find((x) => x.groupKey === row.dataset.groupKey);
    if (!g || g.closed) return;
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // the eye icon opens the same modal anyway
      openDividendSummaryModal(g.holdingId, groups);
    });
  });
  body.querySelectorAll('[data-view-dividend-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const groupKey = btn.closest('[data-group-key]').dataset.groupKey;
      const g = groups.find((x) => x.groupKey === groupKey);
      if (g) openDividendSummaryModal(g.holdingId, groups);
    });
  });
  body.querySelectorAll('[data-delete-dividend-group]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const groupKey = btn.closest('[data-group-key]').dataset.groupKey;
      const g = groups.find((x) => x.groupKey === groupKey);
      if (!g) return;
      const label = g.count === 1 ? 'this dividend' : `all ${g.count} dividend entries`;
      if (!window.confirm(`Remove ${label} for ${g.holdingName}?`)) return;
      g.entries.forEach((entry) => Dividends.remove(entry.id));
      Toast.show('Dividend' + (g.count === 1 ? '' : 's') + ' removed.', 'info');
      renderDividends();
    });
  });

  if (footer) {
    const total = groups.reduce((s, g) => s + g.totalAmount, 0);
    footer.innerHTML = `
      <tr>
        <td>Total (filtered)</td>
        <td class="text-right holdings-table__pos">+${Helpers.formatCurrency(total)}</td>
        <td colspan="3"></td>
      </tr>`;
  }
}

/** First popup when you click a stock in Dividends — quick stats (total
 *  received, average per share, last payment). "History" drills into the
 *  date-by-date breakdown; "Add Entry" records a new payment for this stock. */
function openDividendSummaryModal(holdingId, groups) {
  const group = groups.find((g) => g.holdingId === holdingId) || (() => {
    const entries = Dividends.all().filter((d) => d.holdingId === holdingId);
    return groupDividendsByHolding(entries)[0];
  })();
  if (!group) return;

  dividendState.summaryHoldingId = holdingId;

  document.querySelector('[data-dividend-summary-title]').textContent = group.holdingName;
  document.querySelector('[data-dividend-summary-sub]').textContent = group.holdingType || '';

  const avgPerShare = group.hasQuantity && group.totalQuantity > 0 ? group.totalAmount / group.totalQuantity : null;

  const blocks = [
    statBlock('Total Dividends', `+${Helpers.formatCurrency(group.totalAmount)}`, 'holdings-table__pos'),
    statBlock('Payments', `${group.count}`),
    statBlock('Avg. Per Share', avgPerShare !== null ? Helpers.formatCurrency(avgPerShare) : '\u2014'),
    statBlock('Last Payment', Helpers.formatShortDate(group.lastDate)),
  ];

  document.querySelector('[data-dividend-summary-stats]').innerHTML = blocks.join('');
  Modal.open('#dividendSummaryModal');
}

/** Popup showing the date-by-date breakdown for one holding — "this day
 *  this much, that day that much" — with a delete option per payment. */
function openDividendDetailModal(holdingId, groups) {
  const group = groups.find((g) => g.holdingId === holdingId) || (() => {
    // Fallback if called outside the current render pass (e.g. after a delete)
    const entries = Dividends.all().filter((d) => d.holdingId === holdingId);
    return groupDividendsByHolding(entries)[0];
  })();
  if (!group) return;

  dividendState.detailHoldingId = holdingId;

  document.querySelector('[data-dividend-detail-title]').textContent = `${group.holdingName} \u2014 Dividend History`;
  document.querySelector('[data-dividend-detail-summary]').innerHTML =
    `Total received: <strong class="holdings-table__pos">+${Helpers.formatCurrency(group.totalAmount)}</strong> across ${group.count} payment${group.count === 1 ? '' : 's'}` +
    (group.hasQuantity ? ` \u00b7 Total qty: ${formatQty(group.totalQuantity)}` : '');

  renderDividendDetailBody(holdingId);
  Modal.open('#dividendDetailModal');
}

function renderDividendDetailBody(holdingId) {
  const entries = Dividends.all()
    .filter((d) => d.holdingId === holdingId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const body = document.querySelector('[data-dividend-detail-body]');
  if (!body) return;

  body.innerHTML = entries
    .map((d) => {
      const hasQty = d.quantity !== null && d.quantity !== undefined && d.quantity !== '';
      const perShare = hasQty && Number(d.quantity) > 0 ? Number(d.amount) / Number(d.quantity) : null;
      return `
      <tr data-id="${d.id}">
        <td>${Helpers.formatShortDate(d.date)}</td>
        <td class="text-right">${hasQty ? formatQty(Number(d.quantity)) : '<span class="holdings-table__muted">\u2014</span>'}</td>
        <td class="text-right">${perShare !== null ? Helpers.formatCurrency(perShare) : '<span class="holdings-table__muted">\u2014</span>'}</td>
        <td class="text-right holdings-table__pos">+${Helpers.formatCurrency(d.amount)}</td>
        <td class="holdings-table__sub">${escapeHtml(d.notes || '\u2014')}</td>
        <td>
          <div class="holdings-table__actions">
            <button data-edit-dividend-detail aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
            <button data-delete-dividend-detail class="danger" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
    })
    .join('');

  body.querySelectorAll('[data-edit-dividend-detail]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('[data-id]').dataset.id;
      openDividendModal({ editId: id });
    });
  });

  body.querySelectorAll('[data-delete-dividend-detail]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('[data-id]').dataset.id;
      const record = Dividends.get(id);
      if (!record) return;
      if (!window.confirm(`Remove this ${Helpers.formatCurrency(record.amount)} dividend from ${record.holdingName}?`)) return;
      Dividends.remove(id);
      Toast.show('Dividend removed.', 'info');
      renderDividends();
      // Refresh the popups in place; close history if that was the last payment for this holding.
      const remaining = Dividends.all().some((d) => d.holdingId === holdingId);
      if (dividendState.summaryHoldingId === holdingId) {
        if (remaining) {
          openDividendSummaryModal(holdingId, getGroupedDividends());
        } else {
          Modal.close('#dividendSummaryModal');
        }
      }
      if (remaining) {
        openDividendDetailModal(holdingId, getGroupedDividends());
      } else {
        Modal.close('#dividendDetailModal');
      }
    });
  });
}

/* ---------------- Export (CSV + PDF) ---------------- */

/* ---------------- Investments Export ----------------
   Detailed per-holding snapshot report (Name, Qty, Avg Price, Invested,
   Current Value, P/L, P/L %, Dividends Received, CAGR) — the same figures
   shown on a holding's own detail page, not its purchase-by-purchase
   trade history. Uses the shared Exporter used across the app (CSV / PDF
   dropdown) so the output matches the look of every other export.

   The PDF is laid out like a portfolio statement: an allocation summary
   up top (category, % of portfolio, value), then one section per asset
   category — Stocks, ETFs, Mutual Funds, Gold, and the rest — each with
   its own holdings table and a bold subtotal row. */

function bindInvestmentExport() {
  Exporter.buildDropdown('investmentsExportContainer', exportInvestmentsCsv, exportInvestmentsPdf);
}

/** Category order for the PDF report. Every investment `type` must land in
 *  exactly one of these — "Other Assets" is the catch-all so nothing is
 *  silently dropped if a new type is added later. */
const EXPORT_PDF_GROUPS = [
  { label: 'Stocks', types: ['Stocks', 'Direct Stocks', 'ESOP'] },
  { label: 'ETFs', types: ['ETF', 'Equity ETFs', 'Debt ETFs', 'Crypto ETFs'] },
  { label: 'Mutual Funds', types: ['Mutual Funds', 'Equity Mutual Funds', 'Debt Mutual Funds', 'Hybrid Mutual Funds', 'Arbitrage Funds'] },
  { label: 'Gold & Precious Metals', types: ['Gold', 'Physical Gold', 'Physical Silver', 'Digital Gold / Silver', 'Sovereign Gold Bonds'] },
  { label: 'Fixed Income & Deposits', types: ['FD', 'CPF', 'EPF', 'Bank Fixed Deposit (FD)', 'Corporate Fixed Deposit (FD)', 'Recurring Deposit (RD)', 'Government Bonds', 'Corporate Bonds', 'Tax-Free Bonds', 'PPF', 'SSY', 'Government Savings Scheme'] },
  { label: 'Real Estate', types: ['Property', 'REIT', 'InvIT'] },
  { label: 'Crypto', types: ['Crypto', 'Crypto Tokens / Coins'] },
  { label: 'Other Assets', types: [] }, // catch-all, filled below
];

function getInvestmentExportRows() {
  return Investments.all().map((record) => {
    const pl = Investments.profitLoss(record);
    const plPct = Investments.profitLossPct(record);
    const hasUnits = Investments.hasUnits(record);
    const unitPrice = Investments.unitPrice(record);
    const dividendsReceived = Dividends.all()
      .filter((d) => d.holdingId === record.id)
      .reduce((sum, d) => sum + d.amount, 0);
    const cagr = computeCAGR(record, record.id);
    return { ...record, pl, plPct, hasUnits, unitPrice, dividendsReceived, cagr };
  });
}

/** Buckets every row into EXPORT_PDF_GROUPS order, dropping empty
 *  categories. Anything whose `type` isn't explicitly listed falls into
 *  "Other Assets" instead of being lost. */
function groupInvestmentRowsForExport(rows) {
  const catchAllLabel = 'Other Assets';
  return EXPORT_PDF_GROUPS
    .map((g) => ({
      label: g.label,
      rows: g.label === catchAllLabel
        ? rows.filter((r) => !EXPORT_PDF_GROUPS.some((og) => og.label !== catchAllLabel && og.types.includes(r.type)))
        : rows.filter((r) => g.types.includes(r.type)),
    }))
    .filter((g) => g.rows.length > 0);
}

const INVESTMENT_CSV_COLS = [
  { label: 'Category', value: (r) => (EXPORT_PDF_GROUPS.find((g) => g.types.includes(r.type)) || { label: 'Other Assets' }).label },
  { label: 'Name', key: 'name' },
  { label: 'Type', key: 'type' },
  { label: 'Quantity', value: (r) => (r.hasUnits ? formatQty(r.quantity) : '') },
  { label: 'Avg. Price', value: (r) => (r.hasUnits && typeof r.avgPrice === 'number' ? r.avgPrice.toFixed(2) : '') },
  { label: 'Current Price', value: (r) => (r.unitPrice !== null ? r.unitPrice.toFixed(2) : '') },
  { label: 'Invested', value: (r) => r.costBasis.toFixed(2) },
  { label: 'Current Value', value: (r) => r.value.toFixed(2) },
  { label: 'P/L', value: (r) => r.pl.toFixed(2) },
  { label: 'P/L %', value: (r) => `${r.plPct.toFixed(2)}%` },
  { label: 'Dividends Received', value: (r) => r.dividendsReceived.toFixed(2) },
  { label: 'CAGR %', value: (r) => (r.cagr !== null ? r.cagr.toFixed(2) : '') },
];

const INVESTMENT_PDF_COLS = [
  { label: 'Name', key: 'name', width: 32 },
  { label: 'Qty', value: (r) => (r.hasUnits ? formatQty(r.quantity) : '\u2014'), align: 'right', width: 16 },
  { label: 'Invested', value: (r) => Helpers.formatCurrency(r.costBasis), align: 'right', width: 26 },
  { label: 'Value', value: (r) => Helpers.formatCurrency(r.value), align: 'right', width: 26 },
  { label: 'P/L', value: (r) => `${r.pl >= 0 ? '+' : '-'}${Helpers.formatCurrency(Math.abs(r.pl))}`, align: 'right', emphasis: true, negative: (r) => r.pl < 0, width: 28 },
  { label: 'P/L %', value: (r) => `${r.plPct >= 0 ? '+' : ''}${r.plPct.toFixed(1)}%`, align: 'right', negative: (r) => r.plPct < 0, width: 20 },
  { label: 'Dividends', value: (r) => Helpers.formatCurrency(r.dividendsReceived), align: 'right', width: 24 },
];

const ALLOCATION_PDF_COLS = [
  { label: 'Asset Category', key: 'label', width: 46 },
  { label: 'Holdings', value: (r) => String(r.count), align: 'right', width: 20 },
  { label: '% of Portfolio', value: (r) => `${r.pct.toFixed(1)}%`, align: 'right', emphasis: true, width: 26 },
  { label: 'Current Value', value: (r) => Helpers.formatCurrency(r.value), align: 'right', width: 30 },
];

/** Builds the total row appended to the bottom of every category's
 *  holdings table — bold, with a hairline rule above it, like a
 *  statement's subtotal line. */
function buildCategoryTotalRow(label, groupRows) {
  const costBasis = groupRows.reduce((s, r) => s + r.costBasis, 0);
  const value = groupRows.reduce((s, r) => s + r.value, 0);
  const pl = value - costBasis;
  const plPct = costBasis > 0 ? (pl / costBasis) * 100 : 0;
  const dividendsReceived = groupRows.reduce((s, r) => s + r.dividendsReceived, 0);
  return {
    name: `Total \u2014 ${label}`,
    hasUnits: false,
    costBasis,
    value,
    pl,
    plPct,
    dividendsReceived,
    __isTotalRow: true,
  };
}

function exportInvestmentsCsv() {
  const rows = getInvestmentExportRows();
  const grouped = groupInvestmentRowsForExport(rows);
  const orderedRows = grouped.flatMap((g) => g.rows);
  Exporter.csv(orderedRows, INVESTMENT_CSV_COLS, `ledger-investments-${new Date().toISOString().slice(0, 10)}`);
}

function exportInvestmentsPdf() {
  const rows = getInvestmentExportRows();
  if (rows.length === 0) {
    Toast.show('No holdings to export.', 'info');
    return;
  }
  const grouped = groupInvestmentRowsForExport(rows);

  const totalInvested = rows.reduce((s, r) => s + r.costBasis, 0);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const totalPL = totalValue - totalInvested;
  const totalPLPct = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;
  const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});

  // "Stocks 20% — ₹10,000"-style allocation summary, by current value.
  const allocationRows = grouped.map((g) => {
    const value = g.rows.reduce((s, r) => s + r.value, 0);
    return {
      label: g.label,
      count: g.rows.length,
      pct: totalValue > 0 ? (value / totalValue) * 100 : 0,
      value,
      __isTotalRow: false,
    };
  });
  allocationRows.push({
    label: 'Total Portfolio',
    count: rows.length,
    pct: 100,
    value: totalValue,
    __isTotalRow: true,
  });

  const tables = [
    { title: 'Portfolio Allocation', columns: ALLOCATION_PDF_COLS, rows: allocationRows },
    ...grouped.map((g) => ({
      title: g.label,
      columns: INVESTMENT_PDF_COLS,
      rows: [...g.rows, buildCategoryTotalRow(g.label, g.rows)],
    })),
  ];

  Exporter.pdf({
    title: 'Investment Portfolio Report',
    subtitle: `${rows.length} holding${rows.length === 1 ? '' : 's'} across ${grouped.length} categor${grouped.length === 1 ? 'y' : 'ies'}`,
    userName: settings.userName || '',
    summaryCards: [
      { label: 'Total Invested', value: Helpers.formatCurrency(totalInvested) },
      { label: 'Current Value', value: Helpers.formatCurrency(totalValue) },
      { label: 'Total P&L', value: `${totalPL >= 0 ? '+' : '-'}${Helpers.formatCurrency(Math.abs(totalPL))}`, negative: totalPL < 0 },
      { label: 'P&L %', value: `${totalPLPct >= 0 ? '+' : ''}${totalPLPct.toFixed(1)}%`, negative: totalPLPct < 0 },
    ],
    tables,
    filename: `ledger-investments-${new Date().toISOString().slice(0, 10)}`,
  });
}

function bindExportButtons() {
  const exportHoldingsCsvBtn = document.querySelector('[data-export-holdings-csv-btn]');
  if (exportHoldingsCsvBtn) exportHoldingsCsvBtn.addEventListener('click', exportHoldingsCSV);

  const exportHoldingsPdfBtn = document.querySelector('[data-export-holdings-pdf-btn]');
  if (exportHoldingsPdfBtn) exportHoldingsPdfBtn.addEventListener('click', exportHoldingsPDF);

  const exportDividendsCsvBtn = document.querySelector('[data-export-dividends-csv-btn]');
  if (exportDividendsCsvBtn) exportDividendsCsvBtn.addEventListener('click', exportDividendsCSV);

  const exportDividendsPdfBtn = document.querySelector('[data-export-dividends-pdf-btn]');
  if (exportDividendsPdfBtn) exportDividendsPdfBtn.addEventListener('click', exportDividendsPDF);
}

function exportHoldingsCSV() {
  const holdings = getFilteredHoldings(Investments.all());
  if (holdings.length === 0) {
    Toast.show('No holdings to export for the current filters.', 'info');
    return;
  }
  const headers = ['Instrument', 'Type', 'Quantity', 'Avg. Cost', 'LTP', 'Invested', 'Current Value', 'P&L', 'P&L %', 'Date'];
  const rows = holdings.map((i) => {
    const pl = Investments.profitLoss(i);
    const plPct = Investments.profitLossPct(i);
    const hasUnits = Investments.hasUnits(i);
    const unitPrice = Investments.unitPrice(i);
    return [
      i.name,
      i.type,
      hasUnits ? i.quantity : '',
      hasUnits && typeof i.avgPrice === 'number' ? i.avgPrice : '',
      unitPrice !== null ? unitPrice : '',
      i.costBasis,
      i.value,
      pl.toFixed(2),
      `${plPct.toFixed(2)}%`,
      i.date || '',
    ];
  });
  downloadCSV(headers, rows, `holdings-export-${new Date().toISOString().slice(0, 10)}.csv`);
  Toast.show('Holdings exported.');
}

function exportDividendsCSV() {
  const groups = getGroupedDividends();
  if (groups.length === 0) {
    Toast.show('No dividends to export for the current filters.', 'info');
    return;
  }
  const headers = ['Holding', 'Type', 'Total Quantity', 'Total Amount', 'Payments', 'Last Payment Date'];
  const rows = groups.map((g) => [
    g.holdingName,
    g.holdingType || '',
    g.hasQuantity ? g.totalQuantity : '',
    g.totalAmount.toFixed(2),
    g.count,
    g.lastDate || '',
  ]);
  downloadCSV(headers, rows, `dividends-export-${new Date().toISOString().slice(0, 10)}.csv`);
  Toast.show('Dividends exported.');
}

function downloadCSV(headers, rows, filename) {
  const escapeCell = (cell) => {
    const str = String(cell ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getPdfDoc() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    Toast.show('PDF export library failed to load — check your internet connection.', 'error');
    return null;
  }
  return new window.jspdf.jsPDF();
}

function downloadPdf(doc, filename) {
  doc.save(filename);
}

function exportHoldingsPDF() {
  const holdings = getFilteredHoldings(Investments.all());
  if (holdings.length === 0) {
    Toast.show('No holdings to export for the current filters.', 'info');
    return;
  }
  const doc = getPdfDoc();
  if (!doc) return;

  doc.setFontSize(14);
  doc.text('Investment Holdings', 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleDateString()}`, 14, 22);
  doc.setTextColor(0);

  const rows = holdings.map((i) => {
    const pl = Investments.profitLoss(i);
    const plPct = Investments.profitLossPct(i);
    const hasUnits = Investments.hasUnits(i);
    const unitPrice = Investments.unitPrice(i);
    return [
      i.name,
      i.type,
      hasUnits ? formatQty(i.quantity) : '\u2014',
      hasUnits && typeof i.avgPrice === 'number' ? Helpers.formatCurrency(i.avgPrice) : '\u2014',
      unitPrice !== null ? Helpers.formatCurrency(unitPrice) : '\u2014',
      Helpers.formatCurrency(i.costBasis),
      Helpers.formatCurrency(i.value),
      `${pl >= 0 ? '+' : '-'}${Helpers.formatCurrency(Math.abs(pl))}`,
      `${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%`,
    ];
  });

  doc.autoTable({
    head: [['Instrument', 'Type', 'Qty', 'Avg Cost', 'LTP', 'Invested', 'Curr. Value', 'P&L', 'P&L %']],
    body: rows,
    startY: 28,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [139, 92, 246] },
    didParseCell: (data) => {
      if (data.section === 'body' && (data.column.index === 7 || data.column.index === 8)) {
        const text = String(data.cell.raw || '');
        if (text.trim().startsWith('+')) data.cell.styles.textColor = [16, 150, 90];
        else if (text.trim().startsWith('-')) data.cell.styles.textColor = [220, 38, 38];
      }
    },
  });

  downloadPdf(doc, `holdings-export-${new Date().toISOString().slice(0, 10)}.pdf`);
  Toast.show('Holdings exported as PDF.');
}

function exportDividendsPDF() {
  const groups = getGroupedDividends();
  if (groups.length === 0) {
    Toast.show('No dividends to export for the current filters.', 'info');
    return;
  }
  const doc = getPdfDoc();
  if (!doc) return;

  doc.setFontSize(14);
  doc.text('Dividend Summary', 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleDateString()}`, 14, 22);
  doc.setTextColor(0);

  const rows = groups.map((g) => [
    g.holdingName,
    g.holdingType || '',
    g.hasQuantity ? formatQty(g.totalQuantity) : '\u2014',
    `+${Helpers.formatCurrency(g.totalAmount)}`,
    String(g.count),
    Helpers.formatShortDate(g.lastDate),
  ]);

  doc.autoTable({
    head: [['Holding', 'Type', 'Total Qty', 'Total Amount', 'Payments', 'Last Payment']],
    body: rows,
    startY: 28,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [251, 191, 36] },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 3) data.cell.styles.textColor = [16, 150, 90];
    },
  });

  downloadPdf(doc, `dividends-export-${new Date().toISOString().slice(0, 10)}.pdf`);
  Toast.show('Dividends exported as PDF.');
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

window.AssetGroupsView = { refresh: () => renderAssetGroups(Investments.all()) };

})();
