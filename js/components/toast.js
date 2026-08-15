/**
 * toast.js
 * Minimal toast notification system, styled Sonner-style (icon + message
 * card). Call Toast.show('Saved changes', 'success').
 */

const Toast = {
  ensureStack() {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    return stack;
  },

  show(message, variant = 'success', duration = 3200) {
    const stack = this.ensureStack();
    const variantClass = variant === 'error' ? 'toast--error' : variant === 'info' ? 'toast--info' : 'toast--success';
    const icon = variant === 'error' ? 'fa-circle-xmark' : variant === 'info' ? 'fa-circle-info' : 'fa-circle-check';

    const toast = document.createElement('div');
    toast.className = `toast ${variantClass}`.trim();

    const iconEl = document.createElement('span');
    iconEl.className = 'toast__icon';
    iconEl.innerHTML = `<i class="fa-solid ${icon}"></i>`;

    const msgEl = document.createElement('span');
    msgEl.className = 'toast__message';
    msgEl.textContent = message;

    toast.appendChild(iconEl);
    toast.appendChild(msgEl);
    stack.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 200ms ease-out';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  },
};

window.Toast = Toast;
