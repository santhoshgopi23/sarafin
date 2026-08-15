/**
 * categories.js
 * Single source of truth for category lists, icons, and colors so every
 * page (expense, income, budget, reports, exports) stays visually
 * consistent. Each category now carries a solid `color` (used for the
 * round icon chips in-app and the icon dots in PDF/Word exports) plus a
 * legacy `tone` class kept for any spot still using the translucent chip.
 */

const Categories = {
  expense: {
    Food:                { icon: 'fa-utensils',           color: '#f5a623', tone: 'tone-gold' },
    'Snacks & Drinks':   { icon: 'fa-mug-hot',             color: '#0f6b4a', tone: 'tone-accent' },
    Transport:           { icon: 'fa-car',                 color: '#2f6fed', tone: 'tone-info' },
    Travel:              { icon: 'fa-plane',                color: '#7e3ff2', tone: 'tone-violet' },
    Rent:                { icon: 'fa-house',                color: '#1c1c1c', tone: 'tone-negative' },
    Shopping:            { icon: 'fa-bag-shopping',         color: '#2563eb', tone: 'tone-negative' },
    'Personal Care':     { icon: 'fa-spa',                  color: '#ea580c', tone: 'tone-gold' },
    Entertainment:       { icon: 'fa-film',                 color: '#16a34a', tone: 'tone-violet' },
    Medical:             { icon: 'fa-briefcase-medical',    color: '#4b5563', tone: 'tone-negative' },
    Insurance:           { icon: 'fa-shield-halved',        color: '#2f5fa8', tone: 'tone-info' },
    Utilities:           { icon: 'fa-bolt',                 color: '#7a1f2b', tone: 'tone-info' },
    Gadgets:             { icon: 'fa-plug',                 color: '#262626', tone: 'tone-info' },
    Investment:          { icon: 'fa-chart-line',           color: '#15803d', tone: 'tone-violet' },
    Education:           { icon: 'fa-graduation-cap',       color: '#111827', tone: 'tone-gold' },
    'Gifts & Donation':  { icon: 'fa-gift',                 color: '#16a34a', tone: 'tone-accent' },
    Others:              { icon: 'fa-ellipsis',             color: '#0f4c4c', tone: 'tone-info' },
  },
  income: {
    Salary:      { icon: 'fa-briefcase',            color: '#16a34a', tone: 'tone-accent' },
    Bonus:       { icon: 'fa-gift',                 color: '#f59e0b', tone: 'tone-accent' },
    Freelance:   { icon: 'fa-laptop-code',          color: '#2563eb', tone: 'tone-accent' },
    Business:    { icon: 'fa-store',                color: '#7c3aed', tone: 'tone-accent' },
    Investment:  { icon: 'fa-chart-line',           color: '#15803d', tone: 'tone-violet' },
    Other:       { icon: 'fa-circle-dollar-to-slot', color: '#64748b', tone: 'tone-accent' },
  },

  /**
   * Curated icon choices offered in the "pick a logo" grid when a user
   * adds a new category or customizes an existing one. Kept fairly broad
   * so most real-world categories (income or expense) have a sensible fit.
   */
  ICONS: [
    'fa-utensils', 'fa-mug-hot', 'fa-car', 'fa-plane', 'fa-house',
    'fa-bag-shopping', 'fa-spa', 'fa-film', 'fa-briefcase-medical', 'fa-shield-halved',
    'fa-bolt', 'fa-plug', 'fa-chart-line', 'fa-graduation-cap', 'fa-gift',
    'fa-ellipsis', 'fa-briefcase', 'fa-laptop-code', 'fa-store', 'fa-circle-dollar-to-slot',
    'fa-cart-shopping', 'fa-dumbbell', 'fa-paw', 'fa-baby', 'fa-book',
    'fa-mobile-screen', 'fa-wifi', 'fa-gas-pump', 'fa-train', 'fa-bus',
    'fa-wrench', 'fa-hammer', 'fa-screwdriver-wrench', 'fa-glass-cheers', 'fa-champagne-glasses',
    'fa-shirt', 'fa-ring', 'fa-tooth', 'fa-pills', 'fa-hand-holding-heart',
    'fa-piggy-bank', 'fa-coins', 'fa-wallet', 'fa-credit-card', 'fa-hand-holding-dollar',
    'fa-building', 'fa-users', 'fa-child', 'fa-dog', 'fa-cat',
    'fa-tv', 'fa-gamepad', 'fa-music', 'fa-camera', 'fa-palette',
    'fa-tree', 'fa-umbrella-beach', 'fa-suitcase', 'fa-star', 'fa-circle',
  ],

  /** Color swatch choices offered for the circle behind the category icon. */
  PALETTE: [
    '#f5a623', '#0f6b4a', '#2f6fed', '#7e3ff2', '#1c1c1c',
    '#2563eb', '#ea580c', '#16a34a', '#4b5563', '#2f5fa8',
    '#7a1f2b', '#262626', '#15803d', '#111827', '#dc2626',
    '#0f4c4c', '#f59e0b', '#7c3aed', '#64748b', '#0891b2',
    '#be185d', '#65a30d', '#9333ea', '#0d9488', '#c2410c',
  ],

  /** Custom categories + icon/color overrides live in Storage, keyed by type. */
  _store() {
    return window.Storage.get(window.STORAGE_KEYS.CATEGORIES, { expense: {}, income: {} });
  },

  _save(data) {
    window.Storage.set(window.STORAGE_KEYS.CATEGORIES, data);
  },

  _defaults(type) {
    return type === 'income' ? this.income : this.expense;
  },

  /** Every category name for a type: built-ins first, then user-added ones. */
  listFor(type) {
    const defaults = Object.keys(this._defaults(type));
    const custom = this._store()[type] || {};
    const added = Object.keys(custom).filter((name) => !(name in this._defaults(type)));
    return [...defaults, ...added];
  },

  /** Icon/color/tone for a category — a stored override wins over the built-in default. */
  metaFor(type, category) {
    const defaults = this._defaults(type);
    const custom = (this._store()[type] || {})[category];
    const base = defaults[category] || { icon: 'fa-circle-dollar-to-slot', color: '#64748b', tone: 'tone-info' };
    return custom ? { ...base, ...custom } : base;
  },

  /** True if this category was added by the user (as opposed to a built-in). */
  isCustom(type, category) {
    return !(category in this._defaults(type));
  },

  /**
   * Add a brand-new category the user typed in. Returns the trimmed name,
   * or null if the name is blank or already exists (case-insensitively).
   */
  add(type, name, { icon, color } = {}) {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;

    const existing = this.listFor(type);
    if (existing.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return null;

    const data = this._store();
    data[type] = data[type] || {};
    const palette = this.PALETTE;
    data[type][trimmed] = {
      icon: icon || this.ICONS[existing.length % this.ICONS.length],
      color: color || palette[existing.length % palette.length],
      tone: 'tone-info',
    };
    this._save(data);
    return trimmed;
  },

  /** Customize the logo (icon) and/or circle color of any category, built-in or custom. */
  update(type, category, { icon, color } = {}) {
    if (!category) return null;
    const data = this._store();
    data[type] = data[type] || {};
    const current = this.metaFor(type, category);
    data[type][category] = {
      ...current,
      ...(icon ? { icon } : {}),
      ...(color ? { color } : {}),
    };
    this._save(data);
    return this.metaFor(type, category);
  },

  /** Remove a user-added category (built-in categories can't be deleted, only re-styled). */
  remove(type, category) {
    if (!this.isCustom(type, category)) return false;
    const data = this._store();
    if (data[type]) {
      delete data[type][category];
      this._save(data);
    }
    return true;
  },
};

window.Categories = Categories;
