/**
 * csv-import.js
 * Lets a user import transactions from a CSV export of another expense
 * tracker (e.g. Money Manager-style apps: Date, Category, Amount, Note,
 * Type, Payment mode, To payment mode, Tags). Settings.html wires this up
 * behind an "Import CSV" button; this file only does parsing/mapping/
 * committing so settings.js stays focused on DOM + the preview modal.
 *
 * Flow:
 *   const { headers, rows } = CsvImport.parse(fileText);
 *   const mapped = CsvImport.mapRows(rows, headers);   // normalizes each row
 *   const preview = CsvImport.buildPreview(mapped);    // dedupe + counts
 *   CsvImport.commit(preview);                         // writes to storage
 */

const CsvImport = (() => {

  /* ─────────────────────────────────────────
     CSV parsing — handles quoted fields, embedded commas,
     embedded newlines inside quotes, and "" escaped quotes.
  ───────────────────────────────────────── */
  function parse(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    // Normalize line endings but keep newlines that are inside quotes intact
    // by processing character-by-character instead of splitting on \n first.
    const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

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

      if (c === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
        continue;
      }

      field += c;
    }
    // Trailing field/row (files don't always end with a newline)
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

    const cleanRows = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
    if (cleanRows.length === 0) return { headers: [], rows: [] };

    const headers = cleanRows[0].map((h) => h.trim());
    const dataRows = cleanRows.slice(1);
    return { headers, rows: dataRows };
  }

  /* ─────────────────────────────────────────
     Column detection — case-insensitive, tolerant of the common
     synonyms different apps use for the same concept.
  ───────────────────────────────────────── */
  const COLUMN_SYNONYMS = {
    date: ['date', 'transaction date', 'time'],
    category: ['category', 'category name'],
    amount: ['amount', 'value'],
    title: ['note', 'notes', 'title', 'description', 'memo'],
    type: ['type', 'transaction type'],
    account: ['payment mode', 'account', 'wallet'],
    tags: ['tags', 'tag', 'labels'],
  };

  function findColumnIndex(headers, key) {
    const lowerHeaders = headers.map((h) => h.toLowerCase());
    const synonyms = COLUMN_SYNONYMS[key];
    for (const syn of synonyms) {
      const idx = lowerHeaders.indexOf(syn);
      if (idx !== -1) return idx;
    }
    return -1;
  }

  /** True if the parsed header row has enough columns to attempt an import. */
  function detectColumns(headers) {
    const cols = {
      date: findColumnIndex(headers, 'date'),
      category: findColumnIndex(headers, 'category'),
      amount: findColumnIndex(headers, 'amount'),
      title: findColumnIndex(headers, 'title'),
      type: findColumnIndex(headers, 'type'),
      account: findColumnIndex(headers, 'account'),
      tags: findColumnIndex(headers, 'tags'),
    };
    cols.ok = cols.date !== -1 && cols.amount !== -1;
    return cols;
  }

  /** "2026-07-05 19:16" or "2026-07-05" or "07/05/2026" → "YYYY-MM-DD" (or null if unparseable). */
  function normalizeDate(raw) {
    if (!raw) return null;
    const trimmed = raw.trim();

    const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];

    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return null;
  }

  /** Guess a sensible account "type" from its name, for accounts we have to create. */
  function guessAccountType(name) {
    const n = name.toLowerCase();
    if (n.includes('cash')) return 'cash';
    if (n.includes('wallet')) return 'wallet';
    if (n.includes('saving')) return 'savings';
    return 'checking';
  }

  /* ─────────────────────────────────────────
     Row mapping — turns raw CSV rows into normalized transaction
     candidates, without touching storage yet.
  ───────────────────────────────────────── */
  function mapRows(rows, headers) {
    const cols = detectColumns(headers);
    if (!cols.ok) {
      return { cols, valid: [], skipped: rows.length, errors: ['Could not find both a Date and an Amount column in this file.'] };
    }

    const valid = [];
    let skipped = 0;

    rows.forEach((r) => {
      if (r.every((cell) => cell.trim() === '')) return; // fully blank line

      const rawDate = cols.date !== -1 ? r[cols.date] : '';
      const rawAmount = cols.amount !== -1 ? r[cols.amount] : '';
      const rawCategory = cols.category !== -1 ? (r[cols.category] || '').trim() : '';
      const rawTitle = cols.title !== -1 ? (r[cols.title] || '').trim() : '';
      const rawType = cols.type !== -1 ? (r[cols.type] || '').trim().toLowerCase() : 'expense';
      const rawAccount = cols.account !== -1 ? (r[cols.account] || '').trim() : '';
      const rawTags = cols.tags !== -1 ? (r[cols.tags] || '').trim() : '';

      const date = normalizeDate(rawDate);
      const amount = parseFloat(rawAmount);

      // Only "Expense" / "Income" rows are transactions this app tracks.
      // Rows like "Transfer" (moving money between own accounts) are skipped
      // rather than guessed at, since guessing wrong would misstate totals.
      const type = rawType === 'income' ? 'income' : rawType === 'expense' ? 'expense' : null;

      if (!date || isNaN(amount) || !type) { skipped++; return; }

      const category = rawCategory || (type === 'income' ? 'Other' : 'Others');
      const title = rawTitle || category;
      const account = rawAccount || 'Cash';
      const tags = rawTags
        ? rawTags.split(/\s+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean)
        : [];

      // Kept only for building a precise dedup key (see buildPreview) — the
      // source file often has a time-of-day even though this app's date
      // field only stores a day, so several genuinely separate transactions
      // (e.g. two petrol top-ups, three referral bonuses) can share the same
      // date/category/amount/title. Using the full raw timestamp when
      // available tells those apart instead of merging them into one.
      const rawTimestamp = rawDate.trim() || date;

      valid.push({ date, amount, type, category, title, account, tags, rawTimestamp });
    });

    return { cols, valid, skipped, errors: [] };
  }

  /* ─────────────────────────────────────────
     Preview — dedupes against what's already stored, and reports what
     new categories/accounts/tags this import would create.
  ───────────────────────────────────────── */
  function importKeyFor(row) {
    // row.rawTimestamp carries time-of-day when the source file has it, so two
    // separate same-day, same-category, same-amount transactions don't collide.
    return `${row.rawTimestamp}|${row.type}|${row.amount.toFixed(2)}|${row.title.toLowerCase()}|${row.category.toLowerCase()}`;
  }

  function buildPreview(mapped) {
    // Only dedupe against transactions this same importer previously created
    // (tagged with _importKey). Manually-entered transactions are left out of
    // this check entirely, since a coarser match there risks silently
    // dropping a legitimate manual entry that happens to look similar.
    const existing = window.Transactions ? window.Transactions.all() : [];
    const existingKeys = new Set(existing.map((t) => t._importKey).filter(Boolean));

    const seenInFile = new Set();
    const toImport = [];
    let duplicates = 0;

    mapped.valid.forEach((row) => {
      const key = importKeyFor(row);
      if (existingKeys.has(key) || seenInFile.has(key)) { duplicates++; return; }
      seenInFile.add(key);
      toImport.push(row);
    });

    const existingCategories = {
      expense: new Set((window.Categories ? window.Categories.listFor('expense') : []).map((c) => c.toLowerCase())),
      income: new Set((window.Categories ? window.Categories.listFor('income') : []).map((c) => c.toLowerCase())),
    };
    const existingAccountNames = new Set((window.Accounts ? window.Accounts.all() : []).map((a) => a.name.toLowerCase()));
    const existingTagNames = new Set((window.Tags ? window.Tags.all() : []).map((t) => t.name.toLowerCase()));

    const newCategories = new Set();
    const newAccounts = new Set();
    const newTags = new Set();
    let dateMin = null;
    let dateMax = null;
    let totalIncome = 0;
    let totalExpense = 0;

    toImport.forEach((row) => {
      if (!existingCategories[row.type].has(row.category.toLowerCase())) newCategories.add(`${row.category} (${row.type})`);
      if (!existingAccountNames.has(row.account.toLowerCase())) newAccounts.add(row.account);
      row.tags.forEach((t) => { if (!existingTagNames.has(t.toLowerCase())) newTags.add(t); });

      if (!dateMin || row.date < dateMin) dateMin = row.date;
      if (!dateMax || row.date > dateMax) dateMax = row.date;
      if (row.type === 'income') totalIncome += row.amount; else totalExpense += row.amount;
    });

    return {
      toImport,
      counts: {
        total: mapped.valid.length,
        toImport: toImport.length,
        duplicates,
        skipped: mapped.skipped,
      },
      dateRange: dateMin ? { from: dateMin, to: dateMax } : null,
      totals: { income: totalIncome, expense: totalExpense },
      newCategories: Array.from(newCategories),
      newAccounts: Array.from(newAccounts),
      newTags: Array.from(newTags),
      errors: mapped.errors,
    };
  }

  /* ─────────────────────────────────────────
     Commit — creates any missing categories/accounts/tags, then writes
     every transaction, and updates account balances by the net effect.
  ───────────────────────────────────────── */
  function commit(preview) {
    const accountIdByName = {};
    (window.Accounts.all() || []).forEach((a) => { accountIdByName[a.name.toLowerCase()] = a.id; });

    const tagIdByName = {};
    (window.Tags.all() || []).forEach((t) => { tagIdByName[t.name.toLowerCase()] = t.id; });

    const balanceDeltas = {}; // accountId -> delta

    const records = preview.toImport.map((row) => {
      // Category: Categories.add() itself no-ops (returns null) if the name
      // already exists case-insensitively, so it's safe to call unconditionally.
      window.Categories.add(row.type, row.category);

      // Account: find by name (case-insensitive) or create it.
      let accountId = accountIdByName[row.account.toLowerCase()];
      if (!accountId) {
        const created = window.Accounts.add({ name: row.account, type: guessAccountType(row.account), balance: 0 });
        accountId = created.id;
        accountIdByName[row.account.toLowerCase()] = accountId;
      }

      // Tags: find by name (case-insensitive) or create.
      const tagIds = row.tags.map((name) => {
        let id = tagIdByName[name.toLowerCase()];
        if (!id) {
          const created = window.Tags.add({ name });
          id = created.id;
          tagIdByName[name.toLowerCase()] = id;
        }
        return id;
      });

      const delta = row.type === 'income' ? row.amount : -row.amount;
      balanceDeltas[accountId] = (balanceDeltas[accountId] || 0) + delta;

      return {
        id: Helpers.uid(),
        type: row.type,
        title: row.title,
        amount: row.amount,
        category: row.category,
        date: row.date,
        account: accountId,
        tags: tagIds,
        _importKey: importKeyFor(row),
      };
    });

    // Write transactions (single write, not one per row).
    const allTransactions = window.Transactions.all().concat(records);
    window.Storage.set(window.STORAGE_KEYS.TRANSACTIONS, allTransactions);

    // Apply balance deltas (single write).
    if (Object.keys(balanceDeltas).length > 0) {
      const accounts = window.Accounts.all();
      Object.entries(balanceDeltas).forEach(([id, delta]) => {
        const acc = accounts.find((a) => a.id === id);
        if (acc) acc.balance += delta;
      });
      window.Storage.set(window.STORAGE_KEYS.ACCOUNTS, accounts);
    }

    return records.length;
  }

  return { parse, mapRows, buildPreview, commit, detectColumns, normalizeDate, guessAccountType };
})();

window.CsvImport = CsvImport;
