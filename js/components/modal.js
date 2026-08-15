/**
 * modal.js
 * Generic modal open/close behavior. Pages build their own modal markup
 * (see expense.html) and just call Modal.open('#modalId') / Modal.close(...).
 */

const Modal = {
  _zCounter: 600,

  open(selector) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return;
    this._zCounter += 2;
    el.style.zIndex = this._zCounter;
    el.classList.add('is-open');
    el.style.display = 'grid';
    const firstInput = el.querySelector('input, select, textarea');
    if (firstInput) firstInput.focus();
    document.addEventListener('keydown', this._escHandler);
    this._current = el;
  },

  close(selector) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector || this._current;
    if (!el) return;
    el.classList.remove('is-open');
    el.style.display = 'none';
    el.style.zIndex = '';
    document.removeEventListener('keydown', this._escHandler);
  },

  _escHandler(e) {
    if (e.key === 'Escape') Modal.close();
  },

  /** Wire up every element with [data-modal-open]/[data-modal-close] on the page. */
  bindTriggers() {
    document.querySelectorAll('[data-modal-open]').forEach((btn) => {
      btn.addEventListener('click', () => Modal.open(btn.getAttribute('data-modal-open')));
    });
    document.querySelectorAll('[data-modal-close]').forEach((btn) => {
      btn.addEventListener('click', () => Modal.close(btn.closest('.modal-backdrop')));
    });
    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) Modal.close(backdrop);
      });
    });
  },
};

window.Modal = Modal;
