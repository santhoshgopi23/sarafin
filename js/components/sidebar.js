/**
 * sidebar.js
 * Renders the sidebar from nav-config.js (one link per group — the
 * individual pages inside a group live in the sub tabs bar instead,
 * see components/subtabs.js), marks the active group, and handles the
 * mobile hamburger toggle for the off-canvas sidebar (tablet widths).
 *
 * On phone widths the sidebar/hamburger are hidden entirely (see
 * assets/css/mobile.css) in favor of a fixed bottom tab bar, which this
 * file also builds — from the exact same nav-config.js — so the two
 * navs can never drift out of sync.
 */

const Sidebar = {
  init() {
    this.render();
    this.bindMobileToggle();
    this.renderBottomNav();
  },

  render() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || !window.Nav) return;

    const { group: activeGroup, page: activePage } = window.Nav.current();

    const groupsHtml = window.Nav.groups
      .map((group) => {
        const isActive = activeGroup && activeGroup.id === group.id;
        const href = group.pages[0].href;
        return `<a class="nav-link${isActive ? ' is-active' : ''}" href="${href}" data-group="${group.id}">
          <i class="fa-solid ${group.icon}"></i> ${group.label}
        </a>`;
      })
      .join('');

    const standalone = window.Nav.standalone;
    const standaloneIsActive = !activeGroup && activePage && activePage.id === standalone.id;

    sidebar.innerHTML = `
      <div class="sidebar__brand">
        <div class="sidebar__brand-mark">$</div>
        <div>
          <div class="sidebar__brand-name">Ledger</div>
          <div class="sidebar__brand-tag">Personal Finance</div>
        </div>
      </div>

      <nav class="nav-group">
        ${groupsHtml}
      </nav>

      <div class="sidebar__footer">
        <a class="nav-link${standaloneIsActive ? ' is-active' : ''}" href="${standalone.href}">
          <i class="fa-solid ${standalone.icon}"></i> ${standalone.label}
        </a>
      </div>
    `;
  },

  /** Fixed bottom tab bar shown only at phone widths (see mobile.css).
   *  One tab per nav group + Settings — mirrors the sidebar's structure,
   *  just laid out for a thumb instead of a cursor. */
  renderBottomNav() {
    if (!window.Nav) return;
    if (document.querySelector('.bottom-nav')) return; // already built (e.g. re-init)

    const { group: activeGroup, page: activePage } = window.Nav.current();
    const standalone = window.Nav.standalone;
    const standaloneIsActive = !activeGroup && activePage && activePage.id === standalone.id;

    const tabsHtml = window.Nav.groups
      .map((group) => {
        const isActive = activeGroup && activeGroup.id === group.id;
        const href = group.pages[0].href;
        return `<a class="bottom-nav__link${isActive ? ' is-active' : ''}" href="${href}" data-group="${group.id}">
          <i class="fa-solid ${group.icon}"></i><span>${group.label}</span>
        </a>`;
      })
      .join('');

    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    nav.setAttribute('aria-label', 'Primary');
    nav.innerHTML = `
      ${tabsHtml}
      <a class="bottom-nav__link${standaloneIsActive ? ' is-active' : ''}" href="${standalone.href}">
        <i class="fa-solid ${standalone.icon}"></i><span>${standalone.label}</span>
      </a>
    `;
    document.body.appendChild(nav);
  },

  bindMobileToggle() {
    const toggleBtn = document.querySelector('[data-mobile-nav-toggle]');
    const sidebar = document.querySelector('.sidebar');
    if (!toggleBtn || !sidebar) return;

    toggleBtn.addEventListener('click', () => sidebar.classList.toggle('is-open'));

    // Close the sidebar when a link is tapped on mobile.
    sidebar.querySelectorAll('.nav-link').forEach((link) => {
      link.addEventListener('click', () => sidebar.classList.remove('is-open'));
    });

    // Close when tapping outside the sidebar.
    document.addEventListener('click', (e) => {
      if (!sidebar.classList.contains('is-open')) return;
      if (sidebar.contains(e.target) || toggleBtn.contains(e.target)) return;
      sidebar.classList.remove('is-open');
    });
  },
};

window.Sidebar = Sidebar;
