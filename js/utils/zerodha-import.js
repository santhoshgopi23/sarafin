/**
 * zerodha-import.js
 * Lets a user import holdings straight from a Zerodha Console "Holdings"
 * export (Equity, Mutual Funds, or the Combined statement — all share the
 * same ragged layout: a few header/summary rows, then a table starting
 * with a "Symbol" + "ISIN" row). Settings-style flow: parse → preview →
 * commit, so accounts.js/investments.js only handles DOM + the preview modal.
 *
 * Flow:
 *   const parsed = ZerodhaImport.parse(fileText);
 *   const preview = ZerodhaImport.buildPreview(parsed);
 *   ZerodhaImport.commit(preview);
 */

const ZerodhaImport = (() => {

  /* ─────────────────────────────────────────
     Raw CSV row splitting — quote-aware, keeps every row (including short
     summary rows) since section headers have to be located by content,
     not by row 1.
  ───────────────────────────────────────── */
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

  function findCol(headerRow, names) {
    const lower = headerRow.map((h) => h.toLowerCase());
    for (const n of names) {
      const idx = lower.indexOf(n.toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  }

  function parseNum(raw) {
    if (raw === undefined || raw === null) return NaN;
    const cleaned = String(raw).replace(/,/g, '').trim();
    if (cleaned === '' || cleaned === '-') return NaN;
    return parseFloat(cleaned);
  }

  /** 'equity' | 'mutual-fund' | 'combined' | null, based on which columns this table has. */
  function classifySection(headerRow) {
    const lower = headerRow.map((h) => h.toLowerCase());
    const hasSector = lower.includes('sector');
    const hasInstrumentType = lower.includes('instrument type');
    if (hasSector && hasInstrumentType) return 'combined';
    if (hasInstrumentType) return 'mutual-fund';
    if (hasSector) return 'equity';
    return null;
  }

  /**
   * Maps a Mutual Fund's "Instrument Type" (e.g. "Equity - Flexi Cap") to
   * this app's asset type. Equity funds fold into the plain "Mutual Funds"
   * bucket rather than a separate "Equity Mutual Funds" one — the user only
   * wants Debt / Hybrid / Arbitrage split out, everything else is just
   * "Mutual Funds".
   */
  function mfType(instrumentType) {
    const t = (instrumentType || '').toLowerCase();
    if (t.includes('debt')) return 'Debt Mutual Funds';
    if (t.includes('hybrid')) return 'Hybrid Mutual Funds';
    if (t.includes('arbitrage')) return 'Arbitrage Funds';
    return 'Mutual Funds';
  }

  function equityType(sector) {
    return (sector || '').toUpperCase() === 'ETF' ? 'ETF' : 'Stocks';
  }

  /**
   * Heuristic: gold-linked instruments (Gold ETFs like GOLDBEES/GOLDIETF,
   * Sovereign Gold Bonds like SGBAUG29, gold fund-of-funds, etc.) should
   * land in the Commodity → Gold bucket, not Equity → ETF/Mutual Funds,
   * regardless of which section of the statement they came from.
   */
  function isGoldInstrument(name) {
    const n = (name || '').toUpperCase();
    return /GOLD/.test(n) || /^SGB/.test(n);
  }

  function extractStatementDate(text) {
    const m = String(text || '').match(/as on\s+(\d{4}-\d{2}-\d{2})/i);
    return m ? m[1] : new Date().toISOString().slice(0, 10);
  }

  /* ─────────────────────────────────────────
     Parse — scans every row for a "Symbol"/"ISIN" table header, then reads
     rows underneath it until a blank Symbol cell or another header ends it.
     Handles one or several tables in the same file (e.g. Equity followed
     by Mutual Funds).
  ───────────────────────────────────────── */
  function parse(text) {
    const rows = parseRawRows(text);
    const holdings = [];
    const sections = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const symbolIdx = row.findIndex((c) => c.toLowerCase() === 'symbol');
      const hasIsin = row.some((c) => c.toLowerCase() === 'isin');
      if (symbolIdx === -1 || !hasIsin) continue;

      const kind = classifySection(row);
      if (!kind) continue;

      const isinIdx = findCol(row, ['isin']);
      const sectorIdx = findCol(row, ['sector']);
      const instrTypeIdx = findCol(row, ['instrument type']);
      const qtyIdx = findCol(row, ['quantity available', 'quantity', 'net quantity']);
      const avgPriceIdx = findCol(row, ['average price', 'average cost', 'avg. cost']);
      const priceIdx = findCol(row, ['previous closing price', 'nav', 'ltp', 'last traded price']);

      if (qtyIdx === -1 || avgPriceIdx === -1) continue; // not a table we know how to read

      let count = 0;
      let j = i + 1;
      for (; j < rows.length; j++) {
        const r = rows[j];
        const name = (r[symbolIdx] || '').trim();
        if (!name) break; // blank line ends the table
        if (r.some((c) => c.toLowerCase() === 'symbol')) break; // next table's header

        const quantity = parseNum(r[qtyIdx]);
        const avgPrice = parseNum(r[avgPriceIdx]);
        const priceRaw = priceIdx !== -1 ? parseNum(r[priceIdx]) : NaN;
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(avgPrice) || avgPrice < 0) continue;
        const currentPrice = Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : avgPrice;

        const isin = isinIdx !== -1 ? (r[isinIdx] || '').trim() : '';
        const sector = sectorIdx !== -1 ? (r[sectorIdx] || '').trim() : '';
        const instrumentType = instrTypeIdx !== -1 ? (r[instrTypeIdx] || '').trim() : '';

        let type;
        if (kind === 'equity') type = equityType(sector);
        else if (kind === 'mutual-fund') type = mfType(instrumentType);
        else type = (sector && sector !== '-') ? equityType(sector) : mfType(instrumentType);

        // Gold instruments (ETF or fund) always go to the Gold bucket,
        // overriding whatever section/type they were classified as above.
        if (isGoldInstrument(name)) type = 'Gold';

        holdings.push({
          name,
          isin,
          type,
          quantity,
          avgPrice,
          currentPrice,
          value: currentPrice * quantity,
          costBasis: avgPrice * quantity,
        });
        count++;
      }

      sections.push({ kind, count });
      i = j - 1; // resume scanning right after this table
    }

    return {
      holdings,
      sections,
      statementDate: extractStatementDate(text),
      errors: holdings.length === 0
        ? ["Couldn't find a holdings table in this file. Export 'Holdings' from Zerodha Console as CSV/Excel and try again."]
        : [],
    };
  }

  /* ─────────────────────────────────────────
     Preview — matches each parsed row against an existing *Zerodha-tagged*
     investment (by ISIN, or by name+type for rows without one), so a
     repeat import updates the same holding instead of creating a
     duplicate. Only holdings this importer itself created are considered
     for matching/removal — anything you (or another app's import) entered
     by hand is never touched.

     Because a Zerodha holdings statement is always a full snapshot of your
     current portfolio, any previously-imported Zerodha holding that is
     *not* present in this new statement is treated as sold/closed and will
     be removed on commit — that's reported here as `counts.remove`.
  ───────────────────────────────────────── */
  function keyFor(isin, name, type) {
    return isin ? `isin:${isin}` : `name:${(name || '').toLowerCase()}|${type}`;
  }

  function buildPreview(parsed) {
    const existing = (window.Investments ? window.Investments.all() : [])
      .filter((inv) => inv.source === 'zerodha');
    const existingByKey = new Map();
    existing.forEach((inv) => {
      existingByKey.set(keyFor(inv.isin, inv.name, inv.type), inv);
    });

    const rows = parsed.holdings.map((h) => {
      const key = keyFor(h.isin, h.name, h.type);
      const match = existingByKey.get(key);
      return { ...h, key, matchedId: match ? match.id : null };
    });

    const newRows = rows.filter((r) => !r.matchedId);
    const updateRows = rows.filter((r) => r.matchedId);

    const newKeys = new Set(rows.map((r) => r.key));
    const removeRows = existing.filter((inv) => !newKeys.has(keyFor(inv.isin, inv.name, inv.type)));

    return {
      rows,
      removeRows,
      statementDate: parsed.statementDate,
      sections: parsed.sections,
      counts: { total: rows.length, new: newRows.length, update: updateRows.length, remove: removeRows.length },
      totals: {
        invested: rows.reduce((s, r) => s + r.costBasis, 0),
        current: rows.reduce((s, r) => s + r.value, 0),
      },
      errors: parsed.errors,
    };
  }

  /* ─────────────────────────────────────────
     Commit — writes each row to Investments (add or update, tagged
     source: 'zerodha'), logs a purchase lot for brand-new holdings so
     "History" has an audit trail, then deletes any Zerodha-tagged holding
     from before this import that didn't reappear in the new statement
     (sold/closed positions) — a new Zerodha holdings import always fully
     replaces the *previous* Zerodha snapshot, without touching holdings
     that came from anywhere else.
  ───────────────────────────────────────── */
  function commit(preview) {
    let created = 0;
    let updated = 0;

    preview.rows.forEach((r) => {
      const payload = {
        date: preview.statementDate,
        name: r.name,
        type: r.type,
        isin: r.isin || null,
        quantity: r.quantity,
        avgPrice: r.avgPrice,
        currentPrice: r.currentPrice,
        value: r.value,
        costBasis: r.costBasis,
        purity: null,
        symbol: null,
        provider: null,
        lastPrice: null,
        lastPriceUpdate: null,
        dayChangeAmt: null,
        dayChangePct: null,
        source: 'zerodha',
        _zerodhaKey: r.key,
        _zerodhaImportedAt: new Date().toISOString(),
      };

      if (r.matchedId) {
        window.Investments.update(r.matchedId, payload);
        updated++;
      } else {
        const record = window.Investments.add(payload);
        if (typeof HoldingLots !== 'undefined') {
          HoldingLots.add({ holdingId: record.id, date: record.date, quantity: record.quantity, price: record.avgPrice, type: 'buy', source: 'zerodha', isSnapshot: true });
        }
        created++;
      }
    });

    let removed = 0;
    (preview.removeRows || []).forEach((inv) => {
      window.Investments.remove(inv.id);
      removed++;
    });

    return { created, updated, removed };
  }

  /** True if any currently-tracked holding was tagged as coming from Zerodha. */
  function hasImported() {
    return (window.Investments ? window.Investments.all() : []).some((inv) => inv.source === 'zerodha');
  }

  /** Removes every Zerodha-tagged holding (used by the "Remove Zerodha holdings" action on the Zerodha page — leaves manual entries untouched). */
  function deleteAll() {
    const all = window.Investments ? window.Investments.all() : [];
    const kept = all.filter((inv) => inv.source !== 'zerodha');
    const removed = all.length - kept.length;
    window.Storage.set(window.STORAGE_KEYS.INVESTMENTS, kept);
    return { removed };
  }

  /** Removes a single Zerodha-tagged holding by id (manual cleanup from the Zerodha page's Holdings list). */
  function deleteOne(id) {
    const record = window.Investments ? window.Investments.get(id) : null;
    if (!record || record.source !== 'zerodha') return false;
    window.Investments.remove(id);
    return true;
  }

  return { parse, buildPreview, commit, hasImported, deleteAll, deleteOne };
})();

window.ZerodhaImport = ZerodhaImport;
