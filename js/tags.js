/**
 * tags.js
 * Powers tags.html: lists every tag as a card with its usage count, and
 * handles the New/Edit Tag modal (name + color) and delete (which also
 * strips the tag off any transaction that used it — see Tags.remove).
 */

const state = {
  editingId: null,
  selectedColor: Tags.PALETTE[0],
};

document.addEventListener('DOMContentLoaded', () => {
  Modal.bindTriggers();
  bindForm();
  render();
});

function render() {
  renderStats();
  renderGrid();
}

function renderStats() {
  const tags = Tags.all();
  const transactions = Transactions.all();
  const taggedCount = transactions.filter((t) => (t.tags || []).length > 0).length;

  const counts = tags.map((t) => ({ tag: t, count: Tags.usageCount(t.id) }));
  const top = counts.sort((a, b) => b.count - a.count)[0];

  setText('[data-total-tags]', String(tags.length));
  setText('[data-tagged-count]', String(taggedCount));
  setText('[data-top-tag]', top && top.count > 0 ? top.tag.name : '—');
}

function renderGrid() {
  const grid = document.querySelector('[data-tags-grid]');
  if (!grid) return;

  const tags = Tags.all();

  if (tags.length === 0) {
    grid.innerHTML = `
      <div class="glass card empty-state" style="grid-column: 1 / -1;">
        <i class="fa-solid fa-tags"></i>
        No tags yet. Create your first tag to start labeling income & expense entries.
      </div>`;
    return;
  }

  grid.innerHTML = tags
    .map((tag) => {
      const count = Tags.usageCount(tag.id);
      return `
        <div class="glass card card--interactive tag-card" data-id="${tag.id}" style="cursor:pointer;">
          <span class="tag-card__dot" style="background:${tag.color};"></span>
          <div class="tag-card__meta">
            <p class="tag-card__name">${escapeHtml(tag.name)}</p>
            <p class="tag-card__count">${count} ${count === 1 ? 'entry' : 'entries'}</p>
          </div>
          <div class="row-actions">
            <button data-edit aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
            <button data-delete class="danger" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>`;
    })
    .join('');

  grid.querySelectorAll('.tag-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit]') || e.target.closest('[data-delete]')) return;
      openDetailModal(card.dataset.id);
    });
  });
  grid.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(btn.closest('.tag-card').dataset.id));
  });
  grid.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.closest('.tag-card').dataset.id));
  });

  const addBtn = document.querySelector('[data-add-tag-btn]');
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = 'true';
    addBtn.addEventListener('click', () => openAddModal());
  }
}

/* ---------------- Add / Edit form ---------------- */

function bindForm() {
  const form = document.querySelector('[data-tag-form]');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSubmit(form);
  });

  const addBtn = document.querySelector('[data-add-tag-btn]');
  if (addBtn) {
    addBtn.dataset.bound = 'true';
    addBtn.addEventListener('click', () => openAddModal());
  }
}

function renderColorSwatches() {
  const wrap = document.querySelector('[data-color-swatches]');
  if (!wrap) return;

  wrap.innerHTML = Tags.PALETTE
    .map((color) => `<span class="color-swatch${color === state.selectedColor ? ' is-selected' : ''}" data-color="${color}" style="background:${color};"></span>`)
    .join('');

  wrap.querySelectorAll('.color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      state.selectedColor = swatch.dataset.color;
      renderColorSwatches();
    });
  });
}

function openAddModal() {
  state.editingId = null;
  state.selectedColor = Tags.PALETTE[Tags.all().length % Tags.PALETTE.length];
  const form = document.querySelector('[data-tag-form]');
  form.reset();
  document.querySelector('[data-modal-title]').textContent = 'New Tag';
  renderColorSwatches();
  Modal.open('#tagModal');
}

function openEditModal(id) {
  const tag = Tags.get(id);
  if (!tag) return;
  state.editingId = id;
  state.selectedColor = tag.color;

  document.querySelector('[data-modal-title]').textContent = 'Edit Tag';
  document.querySelector('[data-form-name]').value = tag.name;
  renderColorSwatches();

  Modal.open('#tagModal');
}

function handleSubmit(form) {
  const name = form.querySelector('[data-form-name]').value.trim();

  if (!name) {
    Toast.show('Please give the tag a name.', 'error');
    return;
  }

  const duplicate = Tags.all().find((t) => t.name.toLowerCase() === name.toLowerCase() && t.id !== state.editingId);
  if (duplicate) {
    Toast.show('A tag with that name already exists.', 'error');
    return;
  }

  if (state.editingId) {
    Tags.update(state.editingId, { name, color: state.selectedColor });
    Toast.show('Tag updated.');
  } else {
    Tags.add({ name, color: state.selectedColor });
    Toast.show('Tag created.');
  }

  Modal.close('#tagModal');
  render();
}

function handleDelete(id) {
  const tag = Tags.get(id);
  if (!tag) return;
  const count = Tags.usageCount(id);
  const warning = count > 0
    ? `Delete "${tag.name}"? It will be removed from ${count} tagged ${count === 1 ? 'entry' : 'entries'}. This can't be undone.`
    : `Delete "${tag.name}"? This can't be undone.`;
  if (!window.confirm(warning)) return;

  Tags.remove(id);
  Toast.show('Tag deleted.', 'info');
  render();
}

/* ---------------- Tag detail (all transactions under this tag) ---------------- */

function openDetailModal(id) {
  const tag = Tags.get(id);
  if (!tag) return;

  const transactions = Transactions.all()
    .filter((t) => (t.tags || []).includes(id))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  document.querySelector('[data-detail-dot]').style.background = tag.color;
  document.querySelector('[data-detail-name]').textContent = tag.name;

  const incomeTotal = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenseTotal = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  setText('[data-detail-income-total]', `+${Helpers.formatCurrency(incomeTotal)} income`);
  setText('[data-detail-expense-total]', `-${Helpers.formatCurrency(expenseTotal)} expenses`);

  const list = document.querySelector('[data-detail-list]');
  if (transactions.length === 0) {
    list.innerHTML = `
      <li class="empty-state">
        <i class="fa-solid fa-tag"></i>
        No transactions use this tag yet.
      </li>`;
  } else {
    list.innerHTML = transactions
      .map((t) => {
        const meta = Categories.metaFor(t.type, t.category);
        const isIncome = t.type === 'income';
        return `
          <li class="list-row">
            <span class="chip chip--icon" style="width:38px;height:38px;background:${meta.color};"><i class="fa-solid ${meta.icon}"></i></span>
            <div class="list-row__meta">
              <p class="list-row__title">${escapeHtml(t.title || t.category)}</p>
              <p class="list-row__sub">${t.category} · ${Helpers.formatShortDate(t.date)}</p>
            </div>
            <span class="list-row__amount num" style="color: ${isIncome ? 'var(--color-accent)' : 'var(--color-negative)'};">${isIncome ? '+' : '-'}${Helpers.formatCurrency(t.amount)}</span>
          </li>`;
      })
      .join('');
  }

  Modal.open('#tagDetailModal');
}

/* ---------------- Helpers ---------------- */

function setText(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}

function escapeHtml(str) {
  // Delegates to the single shared implementation in helpers.js.
  return Helpers.escapeHtml(str);
}
