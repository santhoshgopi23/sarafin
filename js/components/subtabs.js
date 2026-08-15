/**
 * subtabs.js
 * Renders the "sub pages" tab row under the topbar (the Assets /
 * Liabilities / Net Worth / Allocation style bar) for the current
 * page's nav group. Pages that are the only page in their group (e.g.
 * Settings) get no tab row. No HTML edits needed per-page — this
 * inserts itself right after `.topbar`.
 */

const SubTabs = {
  init() {
    if (!window.Nav) return;
    const header = document.querySelector('.topbar');
    if (!header) return;

    const { group, page } = window.Nav.current();
    if (!group || group.pages.length < 2) return; // nothing to switch between

    const tabsHtml = group.pages
      .map((p) => {
        const isActive = page && p.id === page.id;
        return `<a class="page-tabs__link${isActive ? ' is-active' : ''}" href="${p.href}">
          <i class="fa-solid ${p.icon}"></i> ${p.label}
        </a>`;
      })
      .join('');

    header.insertAdjacentHTML(
      'afterend',
      `<div class="page-tabs">${tabsHtml}</div>`
    );
  },
};

window.SubTabs = SubTabs;
