/**
 * theme.js
 * Handles dark/light mode. The theme is stored inside `settings.theme`
 * so it is shared with the Settings page (Phase 10).
 */

const Theme = {
  init() {
    const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
    const saved = settings.theme || 'dark';
    this.apply(saved);

    const toggle = document.querySelector('[data-theme-toggle]');
    if (toggle) {
      toggle.addEventListener('click', () => this.toggle());
    }
  },

  apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const toggle = document.querySelector('[data-theme-toggle] i');
    if (toggle) {
      toggle.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    }
    // Let any page with live Chart.js instances (dashboard, reports, etc.)
    // know the palette changed so they can redraw with the new colors —
    // Chart.js bakes grid/text colors into each chart at creation time,
    // so flipping Chart.defaults alone doesn't repaint existing charts.
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  },

  toggle() {
    const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    this.apply(next);
    const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
    settings.theme = next;
    window.Storage.set(window.STORAGE_KEYS.SETTINGS, settings);
  },
};

window.Theme = Theme;
