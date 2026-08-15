/**
 * zerodha-symbol-aliases.js
 * Manual name mapping between a name that shows up in a Zerodha Trade
 * Book / Dividends CSV export and one of your tracked holdings, for the
 * cases where automatic matching (by ISIN, then by cleaned name) misses
 * because Zerodha spells it differently — e.g. the holding is named
 * "PGINVIT" but the tradebook's symbol column says "PGINVIT-IV".
 *
 * One shared list is used as a fallback by both ZerodhaTradebookImport
 * and ZerodhaDividendImport — add, edit, or delete a mapping from either
 * the Trade Book or the Dividends tab and it applies to both, on the
 * next upload. It never touches trades/dividends already imported.
 *
 * Flow:
 *   ZerodhaSymbolAliases.add({ holdingId, holdingName, alias });
 *   ZerodhaSymbolAliases.resolve(cleanedSymbol) -> holdingId | null
 */

const ZerodhaSymbolAliases = (() => {

  function normalize(raw) {
    return String(raw || '').toUpperCase().trim();
  }

  function all() {
    return window.Storage.get(window.STORAGE_KEYS.ZD_SYMBOL_ALIASES, []);
  }

  /** Adds a mapping (or silently replaces an existing one with the same alias text). */
  function add({ holdingId, holdingName, alias }) {
    const clean = normalize(alias);
    if (!holdingId || !clean) return null;
    const list = all().filter((a) => normalize(a.alias) !== clean);
    const entry = {
      id: window.Helpers.uid(),
      holdingId,
      holdingName: holdingName || '',
      alias: clean,
      createdAt: new Date().toISOString(),
    };
    list.push(entry);
    window.Storage.set(window.STORAGE_KEYS.ZD_SYMBOL_ALIASES, list);
    return entry;
  }

  /** Edits an existing mapping's holding and/or alias text. */
  function update(id, { holdingId, holdingName, alias }) {
    const clean = normalize(alias);
    if (!clean) return null;
    const list = all();
    const idx = list.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    // If another mapping already uses this exact alias text, it's replaced.
    const dupeIdx = list.findIndex((a) => a.id !== id && normalize(a.alias) === clean);
    if (dupeIdx !== -1) list.splice(dupeIdx, 1);
    const i = list.findIndex((a) => a.id === id);
    list[i] = { ...list[i], holdingId, holdingName: holdingName || '', alias: clean };
    window.Storage.set(window.STORAGE_KEYS.ZD_SYMBOL_ALIASES, list);
    return list[i];
  }

  function remove(id) {
    const list = all().filter((a) => a.id !== id);
    window.Storage.set(window.STORAGE_KEYS.ZD_SYMBOL_ALIASES, list);
  }

  /** Returns the mapped holdingId for a cleaned/normalized CSV symbol, or null. */
  function resolve(cleanedSymbol) {
    const clean = normalize(cleanedSymbol);
    if (!clean) return null;
    const found = all().find((a) => normalize(a.alias) === clean);
    return found ? found.holdingId : null;
  }

  return { all, add, update, remove, resolve, normalize };
})();

window.ZerodhaSymbolAliases = ZerodhaSymbolAliases;
