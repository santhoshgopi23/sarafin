/**
 * zerodha-dividend-import.js
 * Imports a Zerodha Console "Dividends" export (columns: Symbol, Ex-date,
 * Qty, Dividend per share, Total dividend) into the Dividends log,
 * matched against your existing holdings by symbol/name.
 *
 * Like the tradebook, this is usually downloaded one financial year at a
 * time, so it asks which year to save before committing, and only
 * replaces previously-imported Zerodha dividends for *that* year —
 * everything else is left untouched.
 *
 * Flow:
 *   const parsed = ZerodhaDividendImport.parse(fileText);
 *   const preview = ZerodhaDividendImport.buildPreview(parsed, year);
 *   ZerodhaDividendImport.commit(preview);
 */

const ZerodhaDividendImport = (() => {

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
     Parse — reads the flat dividends table (one payout per row).
  ───────────────────────────────────────── */
  function parse(text) {
    const rows = parseRawRows(text).filter((r) => r.some((c) => c !== ''));
    if (rows.length < 2) {
      return { dividends: [], years: [], errors: ["Couldn't find any rows in this file."] };
    }

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (name) => header.indexOf(name);
    const symbolIdx = idx('symbol');
    const dateIdx = idx('ex-date');
    const qtyIdx = idx('qty');
    const totalIdx = idx('total dividend');

    if (symbolIdx === -1 || dateIdx === -1 || totalIdx === -1) {
      return {
        dividends: [], years: [],
        errors: ["This doesn't look like a Zerodha dividends export (expected columns like Symbol, Ex-date, Total dividend). Export 'Dividends' from Zerodha Console as CSV and try again."],
      };
    }

    const dividends = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const symbol = (r[symbolIdx] || '').trim();
      const date = (r[dateIdx] || '').trim();
      const amount = parseNum(r[totalIdx]);
      if (!symbol || !date || !Number.isFinite(amount) || amount <= 0) continue;

      const year = (date.match(/^\d{4}/) || [null])[0];
      if (!year) continue;

      dividends.push({
        symbol,
        date,
        year,
        quantity: qtyIdx !== -1 && Number.isFinite(parseNum(r[qtyIdx])) ? parseNum(r[qtyIdx]) : null,
        amount,
      });
    }

    const years = Array.from(new Set(dividends.map((d) => d.year))).sort();

    return {
      dividends,
      years,
      errors: dividends.length === 0
        ? ["Couldn't find any dividends in this file. Export 'Dividends' from Zerodha Console as CSV and try again."]
        : [],
    };
  }

  /* ─────────────────────────────────────────
     Preview — filters to the chosen year and matches each payout to an
     existing holding by symbol/name (Zerodha's dividend export has no
     ISIN column). Unmatched rows are skipped on commit since a dividend
     has to be attached to a tracked holding.
  ───────────────────────────────────────── */
  function cleanSymbol(raw) {
    return String(raw || '')
      .toUpperCase()
      .replace(/[#*]+$/, '')
      .replace(/-(BE|BZ|SM|ST|N[0-9])$/, '')
      .trim();
  }

  /** True if a holding counts as a Mutual Fund (see the fuller explanation in zerodha-tradebook-import.js's _isMfHolding — kept in sync here). */
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

  /**
   * Normalizes a Mutual Fund scheme name for fuzzy matching (see the same
   * function in zerodha-tradebook-import.js for the full rationale) —
   * strips "GROWTH"/"IDCW"/plan-suffix noise and all spacing/hyphen
   * differences so e.g. "...MID CAP 250... - DIRECT PLAN - GROWTH" and
   * "...MIDCAP 250... - DIRECT PLAN" resolve to the same key. Only used
   * as a fallback against holdings that are themselves Mutual Funds.
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

  function buildPreview(parsed, year) {
    const rows0 = parsed.dividends.filter((d) => d.year === year);

    const holdings = window.Investments ? window.Investments.all() : [];
    const byName = new Map();
    const byFuzzyMfName = new Map();
    const byId = new Map();
    holdings.forEach((h) => {
      if (h.name) byName.set(cleanSymbol(h.name), h);
      if (h.name && _isMfHolding(h)) byFuzzyMfName.set(normalizeMfName(h.name), h);
      byId.set(h.id, h);
    });

    const rows = rows0.map((d) => {
      const cleanedSymbol = cleanSymbol(d.symbol);
      let match = byName.get(cleanedSymbol) || null;
      // Fuzzy fallback for Mutual Fund scheme names (handles "GROWTH"/
      // "DIRECT PLAN"/spacing differences).
      if (!match) {
        match = byFuzzyMfName.get(normalizeMfName(d.symbol)) || null;
      }
      // Fall back to a manually-saved name mapping (see zerodha-symbol-aliases.js)
      // for CSV names that don't line up with the holding's name.
      if (!match && window.ZerodhaSymbolAliases) {
        const aliasHoldingId = window.ZerodhaSymbolAliases.resolve(cleanedSymbol);
        if (aliasHoldingId) match = byId.get(aliasHoldingId) || null;
      }
      return {
        ...d,
        holdingId: match ? match.id : null,
        holdingName: match ? match.name : d.symbol,
        holdingType: match ? match.type : null,
      };
    });

    return {
      year,
      rows,
      years: parsed.years,
      counts: {
        total: rows.length,
        matched: rows.filter((r) => r.holdingId).length,
        unmatched: rows.filter((r) => !r.holdingId).length,
      },
      totalAmount: rows.reduce((s, r) => s + r.amount, 0),
      errors: parsed.errors,
    };
  }

  /* ─────────────────────────────────────────
     Commit — deletes any Zerodha-tagged dividends previously saved for
     this exact year, then writes the fresh set. Other years and
     non-Zerodha dividend entries are untouched.

     A payout that doesn't match any currently-tracked holding (usually
     because the stock was fully sold and isn't a holding anymore) is
     still saved, just tagged `closed: true` with `holdingId: null` — it
     shows up under "Closed Positions" instead of being attached to a
     holding.
  ───────────────────────────────────────── */
  function commit(preview) {
    const existing = window.Dividends ? window.Dividends.all() : [];
    const kept = existing.filter((d) => !(d.source === 'zerodha' && d.year === preview.year));
    window.Storage.set(window.STORAGE_KEYS.DIVIDENDS, kept);

    let added = 0;
    let closed = 0;

    preview.rows.forEach((r) => {
      window.Dividends.add({
        holdingId: r.holdingId || null,
        holdingName: r.holdingName,
        holdingType: r.holdingType || null,
        quantity: r.quantity,
        amount: r.amount,
        date: r.date,
        notes: 'Imported from Zerodha',
        source: 'zerodha',
        year: preview.year,
        closed: !r.holdingId,
      });
      if (r.holdingId) added++; else closed++;
    });

    return { added, skipped: closed, closed };
  }

  /** Every year that currently has Zerodha-tagged dividends saved, most recent first. */
  function importedYears() {
    const all = window.Dividends ? window.Dividends.all() : [];
    const years = new Set(all.filter((d) => d.source === 'zerodha' && d.year).map((d) => d.year));
    return Array.from(years).sort().reverse();
  }

  /** Removes every Zerodha-tagged dividend saved for one year — other years and manual entries are untouched. */
  function deleteYear(year) {
    const existing = window.Dividends ? window.Dividends.all() : [];
    const kept = existing.filter((d) => !(d.source === 'zerodha' && d.year === year));
    const removed = existing.length - kept.length;
    window.Storage.set(window.STORAGE_KEYS.DIVIDENDS, kept);
    return { removed };
  }

  /** Zerodha dividends that never matched a tracked holding (closed/sold-out positions), grouped by stock symbol. */
  function closedPositions() {
    const all = (window.Dividends ? window.Dividends.all() : []).filter((d) => d.source === 'zerodha' && d.closed);
    const byName = new Map();
    all.forEach((d) => {
      const key = (d.holdingName || 'Unknown').toUpperCase();
      if (!byName.has(key)) byName.set(key, { holdingName: d.holdingName, entries: [], totalAmount: 0 });
      const g = byName.get(key);
      g.entries.push(d);
      g.totalAmount += Number(d.amount) || 0;
    });
    const groups = Array.from(byName.values());
    groups.forEach((g) => g.entries.sort((a, b) => new Date(b.date) - new Date(a.date)));
    groups.sort((a, b) => b.totalAmount - a.totalAmount);
    return groups;
  }

  /**
   * Re-tries matching for every currently "Closed Position" (unmatched)
   * Zerodha dividend against today's holdings + name mappings, without
   * needing the CSV re-uploaded. Call this right after saving a Name
   * Mapping so previously-unmatched payouts sync immediately: any that
   * now resolve are re-attached to the mapped holding in place; anything
   * that still doesn't resolve is left as a closed position.
   */
  function resolveUnmatched() {
    const all = window.Dividends ? window.Dividends.all() : [];
    const pending = all.filter((d) => d.source === 'zerodha' && d.closed);
    if (pending.length === 0) return { resolved: 0, remaining: 0 };

    const holdings = window.Investments ? window.Investments.all() : [];
    const byName = new Map();
    const byFuzzyMfName = new Map();
    const byId = new Map();
    holdings.forEach((h) => {
      if (h.name) byName.set(cleanSymbol(h.name), h);
      if (h.name && _isMfHolding(h)) byFuzzyMfName.set(normalizeMfName(h.name), h);
      byId.set(h.id, h);
    });

    let resolved = 0;
    pending.forEach((d) => {
      const rawSymbol = d.holdingName || '';
      const cleanedSymbol = cleanSymbol(rawSymbol);
      let match = byName.get(cleanedSymbol) || null;
      if (!match) match = byFuzzyMfName.get(normalizeMfName(rawSymbol)) || null;
      if (!match && window.ZerodhaSymbolAliases) {
        const aliasHoldingId = window.ZerodhaSymbolAliases.resolve(cleanedSymbol);
        if (aliasHoldingId) match = byId.get(aliasHoldingId) || null;
      }
      if (match) {
        window.Dividends.update(d.id, {
          holdingId: match.id,
          holdingName: match.name,
          holdingType: match.type || null,
          closed: false,
        });
        resolved++;
      }
    });

    return { resolved, remaining: pending.length - resolved };
  }

  /**
   * Aggregated dividend totals for the chart on the Dividends tab.
   * granularity 'year' → one bar per calendar year, across everything ever
   * imported. granularity 'month' → one bar per month within a single
   * `year` (defaults to the most recent year with data).
   */
  function chartData(granularity, year) {
    const all = (window.Dividends ? window.Dividends.all() : []).filter((d) => d.source === 'zerodha');

    if (granularity === 'month') {
      const years = Array.from(new Set(all.map((d) => String(new Date(d.date).getFullYear())))).sort();
      const targetYear = year || years[years.length - 1] || String(new Date().getFullYear());
      const totals = Array(12).fill(0);
      all.forEach((d) => {
        const dt = new Date(d.date);
        if (String(dt.getFullYear()) !== targetYear) return;
        totals[dt.getMonth()] += Number(d.amount) || 0;
      });
      const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return { labels, values: totals, years, year: targetYear };
    }

    const byYear = new Map();
    all.forEach((d) => {
      const y = String(new Date(d.date).getFullYear());
      byYear.set(y, (byYear.get(y) || 0) + (Number(d.amount) || 0));
    });
    const labels = Array.from(byYear.keys()).sort();
    const values = labels.map((y) => byYear.get(y));
    return { labels, values, years: labels };
  }

  return { parse, buildPreview, commit, importedYears, deleteYear, closedPositions, chartData, resolveUnmatched };
})();

window.ZerodhaDividendImport = ZerodhaDividendImport;
