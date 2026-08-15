/**
 * datepicker.js
 * Progressively enhances every <input type="date"> on the page with a
 * custom-styled calendar dropdown instead of the browser's native popup.
 *
 * The original <input> stays in the DOM untouched (same id, data-*
 * attributes, and ISO `value`), so no other page script needs to change —
 * it's just made visually invisible while a styled trigger + floating
 * calendar panel drive it. Programmatic `input.value = '...'` assignments,
 * `form.reset()`, and existing `display: none/''` toggling (used for the
 * "Custom Range" filters) all continue to work.
 */
(function () {
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  let openState = null; // { input, panel, trigger, onReposition }

  function pad(n) { return String(n).padStart(2, '0'); }

  function isoToDate(iso) {
    if (!iso || typeof iso !== 'string') return null;
    const parts = iso.split('-').map(Number);
    if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return null;
    const [y, m, d] = parts;
    return new Date(y, m - 1, d);
  }

  function dateToIso(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatDisplay(iso) {
    const d = isoToDate(iso);
    if (!d) return '';
    return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
  }

  function enhance(input) {
    if (input.dataset.dpEnhanced) return;
    input.dataset.dpEnhanced = 'true';

    const isSmall = input.classList.contains('input-sm');

    const wrap = document.createElement('span');
    wrap.className = 'dp-wrap' + (isSmall ? ' dp-wrap--sm' : '');
    wrap.style.display = input.style.display === 'none' ? 'none' : '';

    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.classList.add('dp-native-input');
    input.setAttribute('tabindex', '-1');
    input.setAttribute('aria-hidden', 'true');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dp-trigger' + (isSmall ? ' dp-trigger--sm' : '');
    trigger.innerHTML = `<span class="dp-trigger__label"></span><i class="fa-solid fa-calendar-days dp-trigger__icon"></i>`;
    trigger.disabled = !!input.disabled;
    wrap.appendChild(trigger);

    const label = trigger.querySelector('.dp-trigger__label');

    function syncLabel() {
      const display = formatDisplay(input.value);
      label.textContent = display || (input.placeholder || 'Select date');
      label.classList.toggle('dp-trigger__label--placeholder', !display);
    }
    syncLabel();

    // Keep the trigger label in sync with programmatic `.value =` assignments
    // (pages do this a lot, e.g. pre-filling a form when opening an edit modal).
    const nativeDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return nativeDesc.get.call(input); },
      set(v) { nativeDesc.set.call(input, v); syncLabel(); },
    });

    // form.reset() resets the underlying element directly (bypassing the
    // property override above), so re-sync on the next tick after a reset.
    if (input.form) {
      input.form.addEventListener('reset', () => setTimeout(syncLabel, 0));
    }

    // Pages toggle the *native* input's display (e.g. showing/hiding the
    // "Custom Range" date fields) — mirror that onto our wrapper.
    const styleObserver = new MutationObserver(() => {
      wrap.style.display = input.style.display === 'none' ? 'none' : '';
    });
    styleObserver.observe(input, { attributes: true, attributeFilter: ['style'] });

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (input.disabled) return;
      if (openState && openState.input === input) {
        closePanel();
        return;
      }
      openPanel(input, trigger);
    });
  }

  function openPanel(input, trigger) {
    closePanel();

    const panel = document.createElement('div');
    panel.className = 'dp-panel';
    document.body.appendChild(panel);
    trigger.classList.add('is-active');

    const base = isoToDate(input.value) || new Date();
    let viewYear = base.getFullYear();
    let viewMonth = base.getMonth();

    function renderPanel() {
      const selectedIso = input.value || '';
      const todayIso = dateToIso(new Date());
      const first = new Date(viewYear, viewMonth, 1);
      const startOffset = first.getDay();
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

      let cells = '';
      for (let i = 0; i < startOffset; i++) cells += `<span class="dp-day dp-day--empty"></span>`;
      for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`;
        const cls = ['dp-day'];
        if (iso === selectedIso) cls.push('dp-day--selected');
        if (iso === todayIso) cls.push('dp-day--today');
        cells += `<button type="button" class="${cls.join(' ')}" data-iso="${iso}">${d}</button>`;
      }

      panel.innerHTML = `
        <div class="dp-panel__header">
          <button type="button" class="dp-nav" data-nav="-1" aria-label="Previous month"><i class="fa-solid fa-chevron-left"></i></button>
          <span class="dp-panel__title">${MONTH_NAMES[viewMonth]} ${viewYear}</span>
          <button type="button" class="dp-nav" data-nav="1" aria-label="Next month"><i class="fa-solid fa-chevron-right"></i></button>
        </div>
        <div class="dp-weekdays">${WEEKDAY_LABELS.map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="dp-days">${cells}</div>
        <div class="dp-panel__footer">
          <button type="button" class="dp-footer-btn" data-action="clear">Clear</button>
          <button type="button" class="dp-footer-btn dp-footer-btn--accent" data-action="today">Today</button>
        </div>`;

      panel.querySelector('[data-nav="-1"]').addEventListener('click', () => shiftMonth(-1));
      panel.querySelector('[data-nav="1"]').addEventListener('click', () => shiftMonth(1));
      panel.querySelectorAll('.dp-day[data-iso]').forEach((btn) => {
        btn.addEventListener('click', () => pick(btn.dataset.iso));
      });
      panel.querySelector('[data-action="clear"]').addEventListener('click', () => pick(''));
      panel.querySelector('[data-action="today"]').addEventListener('click', () => pick(dateToIso(new Date())));

      requestAnimationFrame(() => positionPanel(panel, trigger));
    }

    function shiftMonth(delta) {
      viewMonth += delta;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      renderPanel();
    }

    function pick(iso) {
      input.value = iso; // goes through the overridden setter -> label updates
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      closePanel();
    }

    renderPanel();
    positionPanel(panel, trigger);
    requestAnimationFrame(() => panel.classList.add('is-open'));

    const onReposition = () => positionPanel(panel, trigger);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    document.addEventListener('mousedown', onOutsideClick, true);

    openState = { input, panel, trigger, onReposition };
  }

  function positionPanel(panel, trigger) {
    const rect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    let top = rect.bottom + 8;
    let left = rect.left;
    if (left + panelRect.width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - panelRect.width - 12);
    if (top + panelRect.height > window.innerHeight - 12) top = Math.max(12, rect.top - panelRect.height - 8);
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }

  function onOutsideClick(e) {
    if (!openState) return;
    if (openState.panel.contains(e.target) || openState.trigger.contains(e.target)) return;
    closePanel();
  }

  function closePanel() {
    if (!openState) return;
    document.removeEventListener('mousedown', onOutsideClick, true);
    window.removeEventListener('resize', openState.onReposition);
    window.removeEventListener('scroll', openState.onReposition, true);
    openState.trigger.classList.remove('is-active');
    openState.panel.remove();
    openState = null;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openState) {
      e.stopPropagation();
      closePanel();
    }
  }, true);

  function enhanceAll(root) {
    (root || document).querySelectorAll('input[type="date"]').forEach(enhance);
  }

  document.addEventListener('DOMContentLoaded', () => enhanceAll());

  // Exposed so pages that inject date inputs dynamically (or modals built
  // at runtime) can enhance new nodes on demand.
  window.DatePicker = { enhanceAll };
})();
