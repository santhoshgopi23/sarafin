/**
 * app.js
 * Boots the parts of the app shared by every page: seeding demo data on
 * first run, applying the saved theme, wiring the sidebar/topbar, and the
 * global search box. Page-specific logic (e.g. dashboard.js) runs after
 * this and can assume Storage is ready.
 */

document.addEventListener('DOMContentLoaded', () => {
  if (typeof seedDemoData === 'function') seedDemoData();

  Theme.init();
  Sidebar.init();
  if (window.SubTabs) SubTabs.init();
  initTopbar();
  initGlobalSearch();
});

function initTopbar() {
  const settings = window.Storage.get(window.STORAGE_KEYS.SETTINGS, {});
  const greetingEl = document.querySelector('[data-greeting]');
  const dateEl = document.querySelector('[data-fulldate]');

  if (greetingEl) greetingEl.textContent = Helpers.timeGreeting(settings.userName);
  if (dateEl) dateEl.textContent = Helpers.formatFullDate();

  const notifBtn = document.querySelector('[data-notif-toggle]');
  if (notifBtn) {
    notifBtn.addEventListener('click', () => {
      Toast.show('No new notifications right now.', 'info');
    });
  }
}

function initGlobalSearch() {
  const input = document.querySelector('[data-global-search]');
  if (!input) return;

  const wrap = input.closest('.search') || input.parentElement;
  const results = document.createElement('div');
  results.className = 'search__results';
  results.setAttribute('data-global-search-results', '');
  results.style.display = 'none';
  wrap.appendChild(results);

  const transactions = window.Storage.get(window.STORAGE_KEYS.TRANSACTIONS, []);

  const closeResults = () => { results.style.display = 'none'; };

  const runSearch = Helpers.debounce((term) => {
    if (!term.trim()) { closeResults(); return; }
    const matches = transactions.filter((t) =>
      `${t.title} ${t.category}`.toLowerCase().includes(term.toLowerCase())
    );
    const shown = matches.slice(0, 6);

    if (shown.length === 0) {
      results.innerHTML = `<div class="search__results-empty">No transactions match "${term}"</div>`;
    } else {
      results.innerHTML = shown
        .map((t) => {
          const isIncome = t.type === 'income';
          return `
            <div class="search__result">
              <span>${Helpers.escapeHtml(t.title || t.category)}</span>
              <span class="search__result-meta" style="color:${isIncome ? 'var(--color-accent)' : 'var(--color-negative)'}">
                ${isIncome ? '+' : '-'}${Helpers.formatCurrency(t.amount)}
              </span>
            </div>`;
        })
        .join('') + (matches.length > shown.length
          ? `<div class="search__results-more">+${matches.length - shown.length} more match${matches.length - shown.length === 1 ? '' : 'es'} — refine your search to narrow it down</div>`
          : '');
    }
    results.style.display = '';
  }, 300);

  input.addEventListener('input', (e) => runSearch(e.target.value));
  input.addEventListener('focus', () => { if (input.value.trim()) runSearch(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeResults();
      input.blur();
    }
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) closeResults();
  });
}
