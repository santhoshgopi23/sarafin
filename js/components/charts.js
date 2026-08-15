/**
 * charts.js
 * Small wrapper around Chart.js so every chart in the app shares the same
 * fonts, grid styling, and color palette defined in variables.css.
 */

const ChartTheme = {
  palette: ['#34d399', '#60a5fa', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee', '#fb7185'],

  isLight() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  },

  gridColor() {
    return this.isLight() ? 'rgba(10,15,26,0.06)' : 'rgba(255,255,255,0.06)';
  },

  /** Compact currency for axis ticks — respects the user's chosen currency
   *  (Settings) instead of hardcoding "$", and drops decimals since ticks
   *  are round numbers. */
  axisCurrency(v) {
    const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
    const code = settings.currency || 'USD';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: code, maximumFractionDigits: 0,
      }).format(v);
    } catch (err) {
      return `${code} ${Math.round(v)}`;
    }
  },

  textColor() {
    return this.isLight() ? '#5b6478' : '#8d97ab';
  },

  /** Shared defaults applied once, before creating any chart. */
  applyDefaults() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = this.textColor();
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = this.isLight() ? '#ffffff' : '#151b2a';
    Chart.defaults.plugins.tooltip.titleColor = this.isLight() ? '#10131a' : '#eef1f6';
    Chart.defaults.plugins.tooltip.bodyColor = this.isLight() ? '#10131a' : '#eef1f6';
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(52,211,153,0.3)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
  },

  lineOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: { grid: { color: this.gridColor() }, border: { display: false }, ticks: { callback: (v) => this.axisCurrency(v) } },
      },
    };
  },

  doughnutOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: { legend: { display: false } },
    };
  },
};

window.ChartTheme = ChartTheme;
