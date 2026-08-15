/**
 * zerodha-tradebook-import.js
 * Imports a Zerodha Console "Tradebook" export (columns: symbol, isin,
 * trade_date, exchange, segment, series, trade_type, auction, quantity,
 * price, trade_id, order_id, order_execution_time) as purchase/sale
 * history (HoldingLots) against your existing holdings.
 *
 * Equity trades and Mutual Fund trades are two entirely separate trade
 * books — every function here takes a `segment` argument ('equity' or
 * 'mf', defaults to 'equity') and keeps its saved data, unmatched list
 * and "last updated" stamp fully apart from the other segment. Equity
 * trades only ever match holdings that aren't Mutual Funds; MF trades
 * only ever match holdings whose type is a Mutual Fund.
 *
 * Unlike the holdings import, a tradebook file is usually downloaded one
 * financial year at a time, so this asks which year to save before
 * committing, and only replaces previously-imported trades for *that*
 * year (within the same segment) — other years and the other segment
 * are left untouched.
 *
 * A trade that matches a holding you currently hold is saved as a lot
 * against that holding (Stock/Fund History). A trade that doesn't match
 * any holding is never dropped — it's kept in a separate "unmatched
 * trades" list shown on the Trade Book tab, so you can review it (Keep)
 * and remove it once you're done (Clear).
 *
 * Flow:
 *   const parsed = ZerodhaTradebookImport.parse(fileText, segment);
 *   const preview = ZerodhaTradebookImport.buildPreview(parsed, year, segment);
 *   ZerodhaTradebookImport.commit(preview, segment);
 */

const ZerodhaTradebookImport = (() => {

  function _source(segment) {
    return segment === 'mf' ? 'zerodha-mf' : 'zerodha';
  }

  function _unmatchedKey(segment) {
    return segment === 'mf' ? window.STORAGE_KEYS.TRADEBOOK_UNMATCHED_MF : window.STORAGE_KEYS.TRADEBOOK_UNMATCHED;
  }

  /**
   * True if a holding counts as a Mutual Fund for trade-matching purposes.
   * Checking the type string alone ("...includes('mutual fund')") missed
   * funds you've categorized under Gold/Commodities in the app (e.g. a
   * Gold ETF FoF is structurally a mutual fund but its `type` here is
   * "Gold"/"Digital Gold / Silver", not "Mutual Funds") — those got
   * silently excluded from MF-segment matching entirely, so no ISIN,
   * name, fuzzy, or alias mapping could ever reach them. Instead, this
   * treats anything NOT a directly-exchange-traded equity instrument
   * (stocks, ETFs, REIT/InvIT, ESOP) as MF-segment eligible, which is a
   * much closer match to what actually shows up in a Coin (MF) tradebook.
   */
  function _isMfHolding(h) {
    if (!h || !h.type) return false;
    const t = String(h.type).toLowerCase();
    if (t.includes('mutual fund')) return true;
    const equityLikeTypes = [
      'stocks', 'direct stocks', 'etf', 'equity etfs', 'debt etfs', 'esop',
      'reit', 'invit', 'property',
    ];
    return !equityLikeTypes.includes(t);
  }

  function parseRawRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += c;
        }
        continue;
      }
      if (c === '"') { inQuotes = true; continue; }
      if (c === ',') { row.push(field); field = ''; continue; }
      if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; continue; }
      field += c;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

    return rows.map((r) => r.map((cell) => cell.trim()));
  }

  function parseNum(raw) {
    if (raw === undefined || raw === null) return NaN;
    const cleaned = String(raw).replace(/,/g, '').trim();
    if (cleaned === '' || cleaned === '-') return NaN;
    return parseFloat(cleaned);
  }

  /* ─────────────────────────────────────────
     Parse — reads the flat tradebook table. Every row is one executed
     trade; we don't collapse partial fills into one line, so History
     shows exactly what Zerodha recorded. Equity and Coin (mutual fund)
     tradebook exports share the same column layout, so one parser
     handles both — `segment` only changes the error copy shown.
  ───────────────────────────────────────── */
  function parse(text, segment) {
    const seg = segment === 'mf' ? 'mf' : 'equity';
    const kind = seg === 'mf' ? 'Coin (mutual fund)' : 'equity';
    const rows = parseRawRows(text).filter((r) => r.some((c) => c !== ''));
    if (rows.length < 2) {
      return { trades: [], years: [], errors: ["Couldn't find any rows in this file."] };
    }

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (name) => header.indexOf(name);
    const symbolIdx = idx('symbol');
    const isinIdx = idx('isin');
    const dateIdx = idx('trade_date');
    const typeIdx = idx('trade_type');
    const qtyIdx = idx('quantity');
    const priceIdx = idx('price');
    const exchangeIdx = idx('exchange');
    const orderIdIdx = idx('order_id');
    const tradeIdIdx = idx('trade_id');
    const timeIdx = idx('order_execution_time');

    if (symbolIdx === -1 || dateIdx === -1 || qtyIdx === -1 || priceIdx === -1) {
      return {
        trades: [], years: [],
        errors: [`This doesn't look like a Zerodha ${kind} tradebook export (expected columns like symbol, trade_date, quantity, price). Export "Tradebook" from Zerodha Console as CSV and try again.`],
      };
    }

    const trades = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const symbol = (r[symbolIdx] || '').trim();
      const date = (r[dateIdx] || '').trim();
      const quantity = parseNum(r[qtyIdx]);
      const price = parseNum(r[priceIdx]);
      if (!symbol || !date || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0) continue;

      const year = (date.match(/^\d{4}/) || [null])[0];
      if (!year) continue;

      trades.push({
        symbol,
        isin: isinIdx !== -1 ? (r[isinIdx] || '').trim() : '',
        date,
        year,
        type: typeIdx !== -1 && (r[typeIdx] || '').trim().toLowerCase() === 'sell' ? 'sell' : 'buy',
        quantity,
        price,
        exchange: exchangeIdx !== -1 ? (r[exchangeIdx] || '').trim().toUpperCase() : '',
        orderId: orderIdIdx !== -1 ? (r[orderIdIdx] || '').trim() : '',
        tradeId: tradeIdIdx !== -1 ? (r[tradeIdIdx] || '').trim() : '',
        time: timeIdx !== -1 ? (r[timeIdx] || '').trim() : '',
      });
    }

    const years = Array.from(new Set(trades.map((t) => t.year))).sort();

    return {
      trades,
      years,
      errors: trades.length === 0
        ? [`Couldn't find any trades in this file. Export "Tradebook" from Zerodha Console as CSV and try again.`]
        : [],
    };
  }

  /**
   * Normalizes a trading symbol for matching: uppercases, strips trailing
   * "#"/"*" footnote markers Zerodha sometimes appends, and strips NSE
   * series suffixes like "-BE"/"-BZ"/"-SM" that show up in tradebook
   * exports but not in the Holdings symbol column.
   */
  function cleanSymbol(raw) {
    return String(raw || '')
      .toUpperCase()
      .replace(/[#*]+$/, '')
      .replace(/-(BE|BZ|SM|ST|N[0-9])$/, '')
      .trim();
  }

  /**
   * Normalizes a Mutual Fund scheme name for fuzzy matching. Zerodha's
   * tradebook symbol column and a hand-typed/holdings-statement fund name
   * are almost never byte-identical for the same scheme — the tradebook
   * always appends "GROWTH", writes "MID CAP" as two words where the
   * holdings statement writes "MIDCAP", and varies hyphen placement
   * around "DIRECT PLAN". None of that changes which scheme it is, so
   * this strips it all down to a bare, space-free token before comparing:
   *   "EDELWEISS NIFTY LARGE MID CAP 250 INDEX FUND - DIRECT PLAN - GROWTH"
   *   "EDELWEISS NIFTY LARGE MIDCAP 250 INDEX FUND - DIRECT PLAN"
   * both become "EDELWEISSNIFTYLARGEMIDCAP250INDEXFUNDDIRECT".
   * Used only as a fallback within the 'mf' segment — never for equities,
   * where cleanSymbol's exact match is precise enough and safer.
   */
  function normalizeMfName(raw) {
    return String(raw || '')
      .toUpperCase()
      .replace(/[-–—]/g, ' ')
      .replace(/\bDIRECT PLAN\b/g, 'DIRECT')
      .replace(/\bREGULAR PLAN\b/g, 'REGULAR')
      .replace(/\b(GROWTH|IDCW|DIVIDEND|PAYOUT|REINVESTMENT)\b/g, '')
      .replace(/[^A-Z0-9 ]/g, ' ')
      .replace(/\s+/g, '')
      .trim();
  }

  /* ─────────────────────────────────────────
     Preview — filters to the chosen year and matches each trade to an
     existing holding by ISIN first, falling back to exact symbol/name,
     then (Mutual Funds only) a fuzzy scheme-name match that shrugs off
     Zerodha's "GROWTH"/"DIRECT PLAN"/spacing noise, then a manually-saved
     alias. Only holdings that belong to the same segment are eligible: an
     Equity import can never match a Mutual Fund holding, and a Mutual
     Fund import can never match an Equity/ETF/Stocks holding. Trades for
     instruments you don't currently hold as a tracked asset (in that
     segment) are reported as unmatched — they're still saved on commit,
     just kept in the Trade Book tab's own "Closed Trades" list instead
     of a holding's History, since there's no holding to attach them to.
  ───────────────────────────────────────── */
  function buildPreview(parsed, year, segment) {
    const seg = segment === 'mf' ? 'mf' : 'equity';
    const rows0 = parsed.trades.filter((t) => t.year === year);

    const allHoldings = window.Investments ? window.Investments.all() : [];
    const holdings = allHoldings.filter((h) => (seg === 'mf' ? _isMfHolding(h) : !_isMfHolding(h)));
    const byIsin = new Map();
    const byName = new Map();
    const byFuzzyName = new Map();
    const byId = new Map();
    holdings.forEach((h) => {
      if (h.isin) byIsin.set(h.isin, h);
      if (h.name) byName.set(cleanSymbol(h.name), h);
      if (seg === 'mf' && h.name) byFuzzyName.set(normalizeMfName(h.name), h);
      byId.set(h.id, h);
    });

    const rows = rows0.map((t) => {
      const symbol = cleanSymbol(t.symbol);
      let match = (t.isin && byIsin.get(t.isin)) || byName.get(symbol) || null;
      // Mutual Funds only: fuzzy scheme-name match (handles "GROWTH"/
      // "DIRECT PLAN"/spacing differences between the tradebook and how
      // the fund's name is stored on the holding).
      if (!match && seg === 'mf') {
        match = byFuzzyName.get(normalizeMfName(t.symbol)) || null;
      }
      // Fall back to a manually-saved name mapping (see zerodha-symbol-aliases.js)
      // for CSV names that don't line up with the holding's name/ISIN.
      if (!match && window.ZerodhaSymbolAliases) {
        const aliasHoldingId = window.ZerodhaSymbolAliases.resolve(symbol);
        if (aliasHoldingId) match = byId.get(aliasHoldingId) || null;
      }
      return { ...t, holdingId: match ? match.id : null, holdingName: match ? match.name : t.symbol };
    });
    return {
      year,
      segment: seg,
      rows,
      years: parsed.years,
      counts: {
        total: rows.length,
        matched: rows.filter((r) => r.holdingId).length,
        unmatched: rows.filter((r) => !r.holdingId).length,
      },
      errors: parsed.errors,
    };
  }

  function unmatchedAll(segment) {
    return window.Storage.get(_unmatchedKey(segment), []);
  }

  /* ─────────────────────────────────────────
     Commit — deletes any Zerodha-tagged lots previously saved for this
     exact year *and segment*, then writes the fresh set as new lots (buy
     or sell) on each matched holding. A trade that doesn't match any
     currently-tracked holding is *not* dropped — it's saved into that
     segment's "unmatched trades" list for the same year, shown under
     "Closed Trades" (Keep) with a way to clear it out (Clear) once
     you've reviewed it. Other years, the other segment, and non-Zerodha
     lots/unmatched trades are untouched.
  ───────────────────────────────────────── */
  function commit(preview, segment) {
    const seg = segment === 'mf' ? 'mf' : 'equity';
    const source = _source(seg);

    const existingLots = window.HoldingLots ? window.HoldingLots.all() : [];
    const keptLots = existingLots.filter((l) => !(l.source === source && l.year === preview.year));
    window.Storage.set(window.STORAGE_KEYS.INVESTMENT_LOTS, keptLots);

    const unmatchedKey = _unmatchedKey(seg);
    const existingUnmatched = unmatchedAll(seg);
    const keptUnmatched = existingUnmatched.filter((u) => u.year !== preview.year);

    let added = 0;
    let skipped = 0;
    const newUnmatched = [];

    preview.rows.forEach((r) => {
      if (!r.holdingId) {
        newUnmatched.push({
          id: Helpers.uid(),
          symbol: r.symbol,
          isin: r.isin || '',
          date: r.date,
          quantity: r.quantity,
          price: r.price,
          type: r.type,
          source,
          year: preview.year,
          exchange: r.exchange || '',
          orderId: r.orderId || '',
          tradeId: r.tradeId || '',
          time: r.time || '',
        });
        skipped++;
        return;
      }
      window.HoldingLots.add({
        holdingId: r.holdingId,
        date: r.date,
        quantity: r.quantity,
        price: r.price,
        type: r.type,
        source,
        year: preview.year,
        exchange: r.exchange || '',
        orderId: r.orderId || '',
        tradeId: r.tradeId || '',
        time: r.time || '',
      });
      added++;
    });

    window.Storage.set(unmatchedKey, [...keptUnmatched, ...newUnmatched]);

    return { added, skipped };
  }

  /**
   * Re-tries matching for every currently-kept "Closed Trade" (unmatched)
   * in a segment against today's holdings + name mappings, without
   * needing the CSV re-uploaded. Call this right after saving a Name
   * Mapping (or adding a new holding) so previously-unmatched trades sync
   * immediately: any that now resolve are written as HoldingLots against
   * the mapped holding and removed from the unmatched list; anything that
   * still doesn't resolve is left in place untouched.
   */
  function resolveUnmatched(segment) {
    const seg = segment === 'mf' ? 'mf' : 'equity';
    const source = _source(seg);
    const unmatchedKey = _unmatchedKey(seg);
    const pending = unmatchedAll(seg);
    if (pending.length === 0) return { resolved: 0, remaining: 0 };

    const allHoldings = window.Investments ? window.Investments.all() : [];
    const holdings = allHoldings.filter((h) => (seg === 'mf' ? _isMfHolding(h) : !_isMfHolding(h)));
    const byIsin = new Map();
    const byName = new Map();
    const byFuzzyName = new Map();
    const byId = new Map();
    holdings.forEach((h) => {
      if (h.isin) byIsin.set(h.isin, h);
      if (h.name) byName.set(cleanSymbol(h.name), h);
      if (seg === 'mf' && h.name) byFuzzyName.set(normalizeMfName(h.name), h);
      byId.set(h.id, h);
    });

    const stillUnmatched = [];
    let resolved = 0;

    pending.forEach((u) => {
      const symbol = cleanSymbol(u.symbol);
      let match = (u.isin && byIsin.get(u.isin)) || byName.get(symbol) || null;
      if (!match && seg === 'mf') match = byFuzzyName.get(normalizeMfName(u.symbol)) || null;
      if (!match && window.ZerodhaSymbolAliases) {
        const aliasHoldingId = window.ZerodhaSymbolAliases.resolve(symbol);
        if (aliasHoldingId) match = byId.get(aliasHoldingId) || null;
      }

      if (match) {
        window.HoldingLots.add({
          holdingId: match.id,
          date: u.date,
          quantity: u.quantity,
          price: u.price,
          type: u.type,
          source,
          year: u.year,
          exchange: u.exchange || '',
          orderId: u.orderId || '',
          tradeId: u.tradeId || '',
          time: u.time || '',
        });
        resolved++;
      } else {
        stillUnmatched.push(u);
      }
    });

    window.Storage.set(unmatchedKey, stillUnmatched);
    return { resolved, remaining: stillUnmatched.length };
  }

  /** Every year that currently has trade history saved for this segment (matched or kept-unmatched), most recent first — powers the "Trade Books By Year" list. */
  function importedYears(segment) {
    const seg = segment === 'mf' ? 'mf' : 'equity';
    const source = _source(seg);
    const lots = window.HoldingLots ? window.HoldingLots.all() : [];
    const years = new Set(lots.filter((l) => l.source === source && l.year).map((l) => l.year));
    unmatchedAll(seg).forEach((u) => { if (u.year) years.add(u.year); });
    return Array.from(years).sort().reverse();
  }

  /** Removes every trade saved for one year within one segment — matched history and unmatched/kept trades alike — other years and the other segment are untouched. */
  function deleteYear(year, segment) {
    const seg = segment === 'mf' ? 'mf' : 'equity';
    const source = _source(seg);

    const existing = window.HoldingLots ? window.HoldingLots.all() : [];
    const kept = existing.filter((l) => !(l.source === source && l.year === year));
    const removedLots = existing.length - kept.length;
    window.Storage.set(window.STORAGE_KEYS.INVESTMENT_LOTS, kept);

    const unmatchedKey = _unmatchedKey(seg);
    const existingUnmatched = unmatchedAll(seg);
    const keptUnmatched = existingUnmatched.filter((u) => u.year !== year);
    const removedUnmatched = existingUnmatched.length - keptUnmatched.length;
    window.Storage.set(unmatchedKey, keptUnmatched);

    return { removed: removedLots + removedUnmatched };
  }

  /**
   * Trades that never matched a tracked holding in this segment, grouped
   * by symbol — the "Closed Trades" list: kept so nothing from an import
   * is ever silently lost, until you clear it. An optional {from, to}
   * range (either end optional, "YYYY-MM-DD") limits which trades are
   * included in each group.
   */
  function unmatchedTrades(range, segment) {
    const seg = segment === 'mf' ? 'mf' : 'equity';
    const all = unmatchedAll(seg).filter((t) => inRange(t.date, range && range.from, range && range.to));
    const bySymbol = new Map();
    all.forEach((t) => {
      const key = (t.symbol || 'Unknown').toUpperCase();
      if (!bySymbol.has(key)) bySymbol.set(key, { symbol: t.symbol, trades: [] });
      bySymbol.get(key).trades.push(t);
    });
    const groups = Array.from(bySymbol.values());
    groups.forEach((g) => g.trades.sort((a, b) => new Date(b.date) - new Date(a.date)));
    groups.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return groups;
  }

  /** True if a "YYYY-MM-DD"-ish dateStr falls within [from, to] — either end is optional. */
  function inRange(dateStr, from, to) {
    if (!from && !to) return true;
    const t = new Date(dateStr).getTime();
    if (Number.isNaN(t)) return true;
    if (from && t < new Date(from).getTime()) return false;
    if (to && t > new Date(to).getTime() + 86399999) return false; // include the whole "to" day
    return true;
  }

  /**
   * Every trade in this segment — matched to a holding (Current Trades)
   * or not (Closed Trades) — as one flat list, oldest first. Powers the
   * calendar heatmap and anything else that needs to look across both
   * at once.
   */
  function allTrades(segment) {
    const seg = segment === 'mf' ? 'mf' : 'equity';
    const source = _source(seg);
    const lots = (window.HoldingLots ? window.HoldingLots.all() : []).filter((l) => l.source === source);
    const holdings = window.Investments ? window.Investments.all() : [];
    const byId = new Map(holdings.map((h) => [h.id, h]));

    const matched = lots.map((l) => ({
      id: l.id,
      date: l.date,
      year: l.year,
      type: l.type,
      quantity: l.quantity,
      price: l.price,
      name: (byId.get(l.holdingId) || {}).name || 'Unknown holding',
      holdingId: l.holdingId,
      exchange: l.exchange || '',
      orderId: l.orderId || '',
      tradeId: l.tradeId || '',
      time: l.time || '',
      closed: false,
    }));

    const unmatched = unmatchedAll(seg).map((u) => ({
      id: u.id,
      date: u.date,
      year: u.year,
      type: u.type,
      quantity: u.quantity,
      price: u.price,
      name: u.symbol,
      exchange: u.exchange || '',
      orderId: u.orderId || '',
      tradeId: u.tradeId || '',
      time: u.time || '',
      closed: true,
    }));

    return [...matched, ...unmatched].sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  /** Removes a single kept-but-unmatched trade by id ("Clear" on one row) from one segment. */
  function removeUnmatched(id, segment) {
    const seg = segment === 'mf' ? 'mf' : 'equity';
    const key = _unmatchedKey(seg);
    const kept = unmatchedAll(seg).filter((u) => u.id !== id);
    window.Storage.set(key, kept);
  }

  /** Clears every kept-but-unmatched trade across all years, for one segment ("Clear All"). */
  function clearAllUnmatched(segment) {
    const seg = segment === 'mf' ? 'mf' : 'equity';
    const key = _unmatchedKey(seg);
    const removed = unmatchedAll(seg).length;
    window.Storage.set(key, []);
    return { removed };
  }

  /**
   * Consolidated per-stock/fund trade history built from every lot saved
   * so far in this segment (across all imported years), joined back to
   * the holding it belongs to. Only trades that matched a currently-
   * tracked holding ever become lots (see commit() above), so closed/
   * unmatched positions never appear here. An optional {from, to} range
   * (either end optional, "YYYY-MM-DD") limits which trades are included.
   */
  function stockHistory(range, segment) {
    const seg = segment === 'mf' ? 'mf' : 'equity';
    const source = _source(seg);
    const lots = (window.HoldingLots ? window.HoldingLots.all() : [])
      .filter((l) => l.source === source && inRange(l.date, range && range.from, range && range.to));
    const holdings = window.Investments ? window.Investments.all() : [];
    const byId = new Map(holdings.map((h) => [h.id, h]));

    const byHolding = new Map();
    lots.forEach((l) => {
      const holding = byId.get(l.holdingId);
      const name = holding ? holding.name : 'Unknown holding';
      if (!byHolding.has(l.holdingId)) {
        byHolding.set(l.holdingId, { holdingId: l.holdingId, holdingName: name, trades: [] });
      }
      byHolding.get(l.holdingId).trades.push(l);
    });

    const groups = Array.from(byHolding.values());
    groups.forEach((g) => g.trades.sort((a, b) => new Date(b.date) - new Date(a.date)));
    groups.sort((a, b) => a.holdingName.localeCompare(b.holdingName));
    return groups;
  }

  return {
    parse, buildPreview, commit, importedYears, deleteYear, stockHistory,
    unmatchedTrades, removeUnmatched, clearAllUnmatched, allTrades, resolveUnmatched,
  };
})();

window.ZerodhaTradebookImport = ZerodhaTradebookImport;
