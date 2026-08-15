/**
 * moi.js (utils)
 * Simple Moi tracker — the Tamil custom of cash gifts exchanged at family
 * functions. Two independent, separately-tracked lists:
 *
 *   "given" = Moi YOU gave at someone else's function.
 *             An ASSET — it's a social debt owed back to you.
 *   "taken" = Moi YOU received at your own function.
 *             A LIABILITY — it's a social debt you owe back.
 *
 * Storage key: 'moiEntries'. Each entry:
 * {
 *   id, direction: 'given' | 'taken',
 *   name, village, amount, date,
 *   function, notes,
 *   createdAt
 * }
 *
 * Amounts are always in ₹ (Indian Rupees) regardless of the app's global
 * currency setting, since Moi is inherently a Tamil/Indian family custom.
 */

const MOI_KEY = 'moiEntries';

/** Setting: whether Moi totals count toward Net Worth (Assets/Liabilities
 *  pages and the Dashboard Wealth card). Off by default, since Moi is a
 *  social/cultural custom rather than a formal financial obligation —
 *  the user opts in from the checkbox on the Moi page. */
const MOI_NETWORTH_KEY = 'moiIncludeInNetWorth';

/** Suggested occasions, shown as quick-pick options in the Add/Edit form.
 *  "Other" reveals a free-text field so any occasion can be recorded. */
const MOI_FUNCTIONS = [
  'Marriage',
  'Engagement',
  'Ear Piercing',
  'House Warming',
  'Puberty Function',
  'Birthday',
  'Punitha Vizha',
  'Death',
  'Other',
];

const Moi = {
  FUNCTIONS: MOI_FUNCTIONS,

  all() {
    return window.Storage.get(MOI_KEY, []);
  },

  /** All "given" entries (asset side), most recent first. */
  given() {
    return this.all()
      .filter((e) => e.direction === 'given')
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  /** All "taken" entries (liability side), most recent first. */
  taken() {
    return this.all()
      .filter((e) => e.direction === 'taken')
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  get(id) {
    return this.all().find((e) => e.id === id) || null;
  },

  add(entry) {
    const list = this.all();
    const record = {
      id: window.Helpers.uid(),
      createdAt: new Date().toISOString(),
      ...entry,
    };
    list.push(record);
    window.Storage.set(MOI_KEY, list);
    return record;
  },

  update(id, changes) {
    const list = this.all();
    const idx = list.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...changes };
    window.Storage.set(MOI_KEY, list);
    return list[idx];
  },

  remove(id) {
    window.Storage.set(MOI_KEY, this.all().filter((e) => e.id !== id));
  },

  /* ---------------- Totals ---------------- */

  givenTotal() {
    return this.given().reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  },

  takenTotal() {
    return this.taken().reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  },

  givenCount() {
    return this.given().length;
  },

  takenCount() {
    return this.taken().length;
  },

  /* ---------------- Net Worth inclusion setting ---------------- */

  /** Whether Moi Given/Taken should be added into Total Assets / Total
   *  Liabilities on the Net Worth page and Dashboard. */
  includedInNetWorth() {
    return !!window.Storage.get(MOI_NETWORTH_KEY, false);
  },

  setIncludedInNetWorth(value) {
    window.Storage.set(MOI_NETWORTH_KEY, !!value);
  },

  /* ---------------- Autocomplete helpers ---------------- */

  villages() {
    const set = new Set(this.all().map((e) => (e.village || '').trim()).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  },

  names() {
    const set = new Set(this.all().map((e) => (e.name || '').trim()).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  },

  /** People whose name + village match on BOTH sides (given and taken),
   *  matched case-insensitively on trimmed name+village. Used for the
   *  "Combined" view showing net position per person. */
  combined() {
    const keyOf = (e) => `${(e.name || '').trim().toLowerCase()}|${(e.village || '').trim().toLowerCase()}`;
    const map = new Map();

    this.given().forEach((e) => {
      if (!(e.name || '').trim()) return;
      const k = keyOf(e);
      if (!map.has(k)) map.set(k, { name: e.name, village: e.village, givenTotal: 0, givenCount: 0, takenTotal: 0, takenCount: 0 });
      const rec = map.get(k);
      rec.givenTotal += Number(e.amount) || 0;
      rec.givenCount += 1;
    });

    this.taken().forEach((e) => {
      if (!(e.name || '').trim()) return;
      const k = keyOf(e);
      if (!map.has(k)) map.set(k, { name: e.name, village: e.village, givenTotal: 0, givenCount: 0, takenTotal: 0, takenCount: 0 });
      const rec = map.get(k);
      rec.takenTotal += Number(e.amount) || 0;
      rec.takenCount += 1;
    });

    return [...map.values()].filter((r) => r.givenCount > 0 && r.takenCount > 0);
  },
};

window.Moi = Moi;
