/**
 * helpers.js
 * General-purpose formatting and utility functions shared across every page.
 */

const Helpers = {
  /** Format a number as currency using the user's chosen currency (Settings). */
  formatCurrency(amount, currency = null) {
    const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
    const code = currency || settings.currency || 'USD';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
      }).format(amount);
    } catch (err) {
      return `${code} ${amount.toFixed(2)}`;
    }
  },

  /** Currency symbol for a given (or the saved) currency code. */
  currencySymbol(currency = null) {
    const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
    const code = currency || settings.currency || 'USD';
    const symbols = { USD: '$', EUR: '\u20ac', GBP: '\u00a3', SGD: 'S$', INR: '\u20b9', JPY: '\u00a5', AUD: 'A$' };
    return symbols[code] || '';
  },

  /**
   * Compact currency string for tight summary UI — e.g. widgets that show
   * several figures side by side (a "Wealth" overview card, small stat
   * chips) where a full formatCurrency() value would wrap or crowd the
   * layout. INR uses Indian units (K / L / Cr); every other supported
   * currency uses Western short-scale units (K / M / B). Trims to at most
   * two decimal places and drops trailing zeros (4.10L -> "4.1L",
   * 4.00L -> "4L") so whole numbers don't show a pointless ".00".
   */
  formatCompactCurrency(amount, currency = null) {
    const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
    const code = currency || settings.currency || 'USD';
    const symbol = this.currencySymbol(code);
    const sign = amount < 0 ? '-' : '';
    const abs = Math.abs(amount);

    const trim = (n) => {
      let str = n.toFixed(2);
      if (str.endsWith('00')) str = str.slice(0, -3);
      else if (str.endsWith('0')) str = str.slice(0, -1);
      return str;
    };

    let unit = '';
    let scaled = abs;
    if (code === 'INR') {
      if (abs >= 1e7) { scaled = abs / 1e7; unit = 'Cr'; }
      else if (abs >= 1e5) { scaled = abs / 1e5; unit = 'L'; }
      else if (abs >= 1e3) { scaled = abs / 1e3; unit = 'K'; }
    } else if (abs >= 1e9) { scaled = abs / 1e9; unit = 'B'; }
    else if (abs >= 1e6) { scaled = abs / 1e6; unit = 'M'; }
    else if (abs >= 1e3) { scaled = abs / 1e3; unit = 'K'; }

    const numStr = unit ? trim(scaled) : Math.round(scaled).toLocaleString();
    return `${sign}${symbol}${numStr}${unit}`;
  },

  /** Split a currency string into whole + cents for the animated hero display. */
  splitCurrencyParts(amount) {
    const formatted = this.formatCurrency(amount);
    const match = formatted.match(/^(\D*[\d,]+)(\.\d+)?$/);
    if (!match) return { whole: formatted, cents: '' };
    return { whole: match[1], cents: match[2] || '' };
  },

  /** Human date, e.g. "Tuesday, 28 July 2026". */
  formatFullDate(date = new Date()) {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  },

  /** Short date, e.g. "28 Jul". */
  formatShortDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
  },

  /** Short date with year, e.g. "28 Jul 2026". Use anywhere entries can span
   *  multiple years (purchase/trade history) so rows from different years
   *  aren't visually indistinguishable. */
  formatShortDateWithYear(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  /** Greeting that changes with the time of day. */
  timeGreeting(name = '') {
    const hour = new Date().getHours();
    let greeting = 'Good evening';
    if (hour < 12) greeting = 'Good morning';
    else if (hour < 18) greeting = 'Good afternoon';
    return name ? `${greeting}, ${name}` : greeting;
  },

  /** Animate a number counting up to `end` inside `el`, formatted as currency. */
  animateCounter(el, end, { duration = 900, currency = true } = {}) {
    if (!el) return;
    const start = 0;
    const startTime = performance.now();
    const step = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const value = start + (end - start) * eased;
      el.textContent = currency ? Helpers.formatCurrency(value) : Math.round(value).toLocaleString();
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },

  /** Simple unique id generator, good enough for local-only data. */
  uid() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  },

  /** Clamp a number between min and max. */
  clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  },

  /** Sum an array of transactions by `type` ('income' | 'expense') for the current calendar month. */
  sumThisMonth(transactions, type) {
    const now = new Date();
    return transactions
      .filter((t) => {
        const d = new Date(t.date);
        return t.type === type && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, t) => sum + t.amount, 0);
  },

  /** Debounce helper for search inputs. */
  debounce(fn, wait = 250) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  },

  /** Escapes a value for safe insertion into innerHTML. Every page relies
   *  on this single copy instead of its own local version — keeps XSS
   *  protection consistent and means new pages get it for free. */
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str === null || str === undefined ? '' : String(str);
    return div.innerHTML;
  },

  /**
   * Wires a text input to a lightweight suggestion dropdown (a sibling
   * <ul>) built from a live list of strings. Suggestions only appear once
   * at least `minChars` characters are typed AND something in the pool
   * actually contains that text — deliberately not "show everything
   * stored" on focus, since with more than a few names/villages on file
   * that turns into noise instead of a shortcut. Used for the Moi
   * name/village fields (moi.js, and the quick Moi entry forms in
   * investments.js and loans.js).
   * @param {HTMLInputElement} input
   * @param {HTMLElement} list - the <ul> the suggestions render into
   * @param {() => string[]} getOptions - returns the current pool of values
   * @param {number} [minChars]
   */
  bindTextSuggest(input, list, getOptions, minChars = 3) {
    if (!input || !list) return;

    const renderSuggestions = () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < minChars) {
        list.style.display = 'none';
        list.innerHTML = '';
        return;
      }
      const matches = getOptions().filter((opt) => opt.toLowerCase().includes(q)).slice(0, 8);
      if (!matches.length) {
        list.style.display = 'none';
        list.innerHTML = '';
        return;
      }
      list.innerHTML = matches.map((m) => `<li data-suggest-value="${Helpers.escapeHtml(m)}">${Helpers.escapeHtml(m)}</li>`).join('');
      list.style.display = 'block';
      list.querySelectorAll('[data-suggest-value]').forEach((li) => {
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = li.getAttribute('data-suggest-value');
          list.style.display = 'none';
          list.innerHTML = '';
        });
      });
    };

    input.addEventListener('input', renderSuggestions);
    input.addEventListener('focus', renderSuggestions);
    input.addEventListener('blur', () => {
      setTimeout(() => { list.style.display = 'none'; }, 100);
    });
  },
};

window.Helpers = Helpers;
