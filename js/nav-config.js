/**
 * nav-config.js
 * Single source of truth for the app's navigation.
 *
 * The sidebar only ever shows one link per GROUP (its `landing` page) —
 * individual pages inside a group are no longer listed in the sidebar.
 * Instead, any page that belongs to a group with more than one page
 * renders a horizontal "sub tabs" bar under the topbar (see
 * assets/js/components/subtabs.js) so you can jump between the pages
 * in that section without the sidebar getting cluttered.
 */

const NAV_GROUPS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: 'fa-chart-pie',
    pages: [
      { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'fa-chart-pie' },
      { id: 'reports', label: 'Reports', href: 'reports.html', icon: 'fa-file-lines' },
      { id: 'assistant', label: 'AI Assistant', href: 'assistant.html', icon: 'fa-robot' },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    icon: 'fa-sack-dollar',
    pages: [
      { id: 'income', label: 'Income', href: 'income.html', icon: 'fa-arrow-trend-up' },
      { id: 'expense', label: 'Expenses', href: 'expense.html', icon: 'fa-arrow-trend-down' },
      { id: 'budget', label: 'Budget', href: 'budget.html', icon: 'fa-scale-balanced' },
      { id: 'goals', label: 'Goals', href: 'goals.html', icon: 'fa-bullseye' },
      { id: 'tags', label: 'Tags', href: 'tags.html', icon: 'fa-tag' },
    ],
  },
  {
    id: 'networth',
    label: 'Wealth',
    icon: 'fa-scale-balanced',
    pages: [
      // Assets = cash/bank accounts + investments, combined on one page.
      { id: 'accounts', label: 'Assets', href: 'accounts.html', icon: 'fa-building-columns' },
      // Liabilities = loans/lending + credit cards, combined on one page.
      { id: 'loans', label: 'Liabilities', href: 'loans.html', icon: 'fa-hand-holding-dollar' },
      { id: 'networth', label: 'Net Worth', href: 'networth.html', icon: 'fa-scale-balanced' },
      { id: 'allocation', label: 'Allocation', href: 'allocation.html', icon: 'fa-chart-pie' },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    icon: 'fa-toolbox',
    pages: [
      { id: 'calculators', label: 'Calculators', href: 'calculators.html', icon: 'fa-calculator' },
    ],
  },
];

// Rendered on its own, under the sidebar footer — never gets sub tabs.
const NAV_STANDALONE = { id: 'settings', label: 'Settings', href: 'settings.html', icon: 'fa-gear' };

const Nav = {
  groups: NAV_GROUPS,
  standalone: NAV_STANDALONE,

  currentFile() {
    return window.location.pathname.split('/').pop() || 'dashboard.html';
  },

  /** Finds { group, page } for whatever file we're currently on. */
  current() {
    const file = this.currentFile();
    for (const group of NAV_GROUPS) {
      const page = group.pages.find((p) => p.href === file);
      if (page) return { group, page };
    }
    if (NAV_STANDALONE.href === file) return { group: null, page: NAV_STANDALONE };
    return { group: null, page: null };
  },
};

window.NAV_GROUPS = NAV_GROUPS;
window.NAV_STANDALONE = NAV_STANDALONE;
window.Nav = Nav;
