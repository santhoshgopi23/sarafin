/**
 * tags.js
 * Single source of truth for tag CRUD + the color palette. Income and
 * expense entries store a `tags` array of tag ids; this file is the only
 * place that reads/writes the `tags` storage key, mirroring the pattern
 * used by categories.js and goals's own util file.
 */

const Tags = {
  PALETTE: [
    '#34d399', // accent green
    '#60a5fa', // info blue
    '#fbbf24', // gold
    '#a78bfa', // violet
    '#f87171', // negative red
    '#22d3ee', // cyan
    '#f472b6', // pink
    '#fb923c', // orange
    '#94a3b8', // slate
    '#4ade80', // lime
  ],

  all() {
    return window.Storage.get(window.STORAGE_KEYS.TAGS, []);
  },

  get(id) {
    return this.all().find((t) => t.id === id) || null;
  },

  /** Resolve an array of tag ids into tag objects, silently dropping any that no longer exist. */
  byIds(ids = []) {
    const all = this.all();
    return ids.map((id) => all.find((t) => t.id === id)).filter(Boolean);
  },

  add({ name, color }) {
    const list = this.all();
    const trimmed = (name || '').trim();
    const record = { id: Helpers.uid(), name: trimmed, color: color || this.PALETTE[list.length % this.PALETTE.length] };
    list.push(record);
    window.Storage.set(window.STORAGE_KEYS.TAGS, list);
    return record;
  },

  update(id, changes) {
    const list = this.all();
    const idx = list.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...changes };
    window.Storage.set(window.STORAGE_KEYS.TAGS, list);
    return list[idx];
  },

  /** Delete a tag and strip it out of every transaction that referenced it. */
  remove(id) {
    const list = this.all().filter((t) => t.id !== id);
    window.Storage.set(window.STORAGE_KEYS.TAGS, list);

    if (window.Transactions) {
      const affected = Transactions.all().filter((t) => (t.tags || []).includes(id));
      affected.forEach((t) => {
        Transactions.update(t.id, { tags: t.tags.filter((tagId) => tagId !== id) });
      });
    }
  },

  /** How many transactions currently use this tag. */
  usageCount(id) {
    if (!window.Transactions) return 0;
    return Transactions.all().filter((t) => (t.tags || []).includes(id)).length;
  },

  /** Convert a hex color + alpha into an rgba() string for pill backgrounds. */
  rgba(hex, alpha = 1) {
    const clean = (hex || '#60a5fa').replace('#', '');
    const bigint = parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  },
};

window.Tags = Tags;
