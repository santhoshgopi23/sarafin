/**
 * category-picker.js
 * Upgrades every <select data-form-category> into a colorful icon-grid
 * picker (matching the app's "Select Category" reference design) while
 * keeping the underlying <select> as the source of truth, so no other
 * code (form submit handlers, populateCategorySelect, edit pre-fill)
 * needs to change — they keep reading/writing select.value as before.
 *
 * On top of picking, the same modal lets the user:
 *  - type a brand-new category name and give it a logo (icon) + circle
 *    color, then use it right away
 *  - customize the logo/color of any existing category (built-in or
 *    user-added) via the small pencil button on each tile
 * This works identically for both expense and income selects.
 *
 * Usage: CategoryPicker.enhance(selectEl, 'expense' | 'income')
 * Call again after the select's options change (e.g. after
 * populateCategorySelect) to refresh the grid.
 */

const CategoryPicker = (() => {
  let modalEl = null;
  let activeSelect = null;
  let activeType = 'expense';
  let editingCategory = null; // name of category being customized, or null when adding new
  let editorIcon = '';
  let editorColor = '';

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'modal-backdrop';
    modalEl.id = 'categoryPickerModal';
    modalEl.innerHTML = `
      <div class="modal category-picker__modal">
        <div class="category-picker__header">
          <h3 data-category-title>Select Category</h3>
          <button type="button" class="category-picker__close" aria-label="Close">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div data-category-browse>
          <div class="category-picker__grid" data-category-grid></div>
          <div class="category-picker__footer">
            <button type="button" class="category-picker__add-btn" data-category-add-new>
              <i class="fa-solid fa-plus"></i> Add new category
            </button>
          </div>
        </div>

        <form data-category-editor class="category-picker__editor" hidden>
          <div class="category-picker__editor-preview">
            <span class="category-picker__icon category-picker__icon--lg" data-editor-preview-icon><i class="fa-solid fa-circle-dollar-to-slot"></i></span>
          </div>

          <div class="field" data-editor-name-field>
            <label for="categoryNewName">Category Name</label>
            <input id="categoryNewName" type="text" placeholder="e.g. Pet Care" maxlength="24" data-editor-name />
          </div>

          <div class="field">
            <label>Logo</label>
            <div class="category-picker__icon-grid" data-editor-icons></div>
          </div>

          <div class="field">
            <label>Circle Color</label>
            <div class="color-swatches" data-editor-colors></div>
          </div>

          <div class="form-actions">
            <button type="button" class="btn btn--ghost" style="color: var(--color-negative); margin-right: auto;" data-editor-delete hidden><i class="fa-solid fa-trash"></i> Delete</button>
            <button type="button" class="btn btn--ghost" data-editor-cancel>Cancel</button>
            <button type="submit" class="btn btn--primary" data-editor-save><i class="fa-solid fa-check"></i> Save Category</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modalEl);

    modalEl.querySelector('.category-picker__close').addEventListener('click', () => Modal.close(modalEl));
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) Modal.close(modalEl); });

    modalEl.querySelector('[data-category-add-new]').addEventListener('click', () => openEditor(null));
    modalEl.querySelector('[data-editor-cancel]').addEventListener('click', () => closeEditor());
    modalEl.querySelector('[data-category-editor]').addEventListener('submit', onEditorSubmit);
    modalEl.querySelector('[data-editor-delete]').addEventListener('click', onDeleteCategory);

    return modalEl;
  }

  function renderGrid(select) {
    const grid = modalEl.querySelector('[data-category-grid]');
    const names = Array.from(select.options).map((o) => o.value).filter(Boolean);
    const current = select.value;
    grid.innerHTML = names.map((name) => {
      const meta = Categories.metaFor(activeType, name);
      const selected = name === current ? ' is-selected' : '';
      return `
        <div class="category-picker__item${selected}" data-category-value="${escapeAttr(name)}">
          <button type="button" class="category-picker__edit-btn" data-category-edit="${escapeAttr(name)}" aria-label="Customize ${escapeAttr(name)}">
            <i class="fa-solid fa-pen"></i>
          </button>
          <span class="category-picker__icon" style="background:color-mix(in srgb, ${meta.color} 18%, white); color:${meta.color};"><i class="fa-solid ${meta.icon}"></i></span>
          <span>${escapeAttr(name)}</span>
        </div>`;
    }).join('');

    grid.querySelectorAll('[data-category-value]').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('[data-category-edit]')) return;
        const value = item.getAttribute('data-category-value');
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        updateTrigger(select);
        Modal.close(modalEl);
      });
    });

    grid.querySelectorAll('[data-category-edit]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditor(btn.getAttribute('data-category-edit'));
      });
    });
  }

  function renderIconChoices() {
    const wrap = modalEl.querySelector('[data-editor-icons]');
    wrap.innerHTML = Categories.ICONS.map((icon) => `
      <button type="button" class="icon-swatch${icon === editorIcon ? ' is-selected' : ''}" data-icon-choice="${icon}" aria-label="${icon}">
        <i class="fa-solid ${icon}"></i>
      </button>`).join('');
    wrap.querySelectorAll('[data-icon-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        editorIcon = btn.getAttribute('data-icon-choice');
        wrap.querySelectorAll('.icon-swatch').forEach((b) => b.classList.toggle('is-selected', b === btn));
        updateEditorPreview();
      });
    });
  }

  function renderColorChoices() {
    const wrap = modalEl.querySelector('[data-editor-colors]');
    wrap.innerHTML = Categories.PALETTE.map((color) => `
      <span class="color-swatch${color === editorColor ? ' is-selected' : ''}" style="background:${color};" data-color-choice="${color}"></span>`).join('');
    wrap.querySelectorAll('[data-color-choice]').forEach((el) => {
      el.addEventListener('click', () => {
        editorColor = el.getAttribute('data-color-choice');
        wrap.querySelectorAll('.color-swatch').forEach((s) => s.classList.toggle('is-selected', s === el));
        updateEditorPreview();
      });
    });
  }

  function updateEditorPreview() {
    const preview = modalEl.querySelector('[data-editor-preview-icon]');
    preview.style.background = editorColor || '#64748b';
    preview.querySelector('i').className = `fa-solid ${editorIcon || 'fa-circle-dollar-to-slot'}`;
  }

  function openEditor(categoryName) {
    editingCategory = categoryName;
    const isNew = !categoryName;
    const meta = isNew
      ? { icon: Categories.ICONS[0], color: Categories.PALETTE[0] }
      : Categories.metaFor(activeType, categoryName);
    editorIcon = meta.icon;
    editorColor = meta.color;

    modalEl.querySelector('[data-category-title]').textContent = isNew ? 'Add New Category' : `Customize "${categoryName}"`;
    modalEl.querySelector('[data-category-browse]').hidden = true;
    const form = modalEl.querySelector('[data-category-editor]');
    form.hidden = false;

    const nameField = modalEl.querySelector('[data-editor-name-field]');
    const nameInput = modalEl.querySelector('[data-editor-name]');
    if (isNew) {
      nameField.hidden = false;
      nameInput.value = '';
      nameInput.required = true;
    } else {
      nameField.hidden = true;
      nameInput.required = false;
    }

    const deleteBtn = modalEl.querySelector('[data-editor-delete]');
    deleteBtn.hidden = isNew || !Categories.isCustom(activeType, categoryName);

    renderIconChoices();
    renderColorChoices();
    updateEditorPreview();

    if (isNew) setTimeout(() => nameInput.focus(), 0);
  }

  function closeEditor() {
    editingCategory = null;
    if (!modalEl) return;
    modalEl.querySelector('[data-category-editor]').hidden = true;
    modalEl.querySelector('[data-category-browse]').hidden = false;
    modalEl.querySelector('[data-category-title]').textContent = 'Select Category';
  }

  function onEditorSubmit(e) {
    e.preventDefault();
    const isNew = !editingCategory;

    if (isNew) {
      const nameInput = modalEl.querySelector('[data-editor-name]');
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }

      const added = Categories.add(activeType, name, { icon: editorIcon, color: editorColor });
      if (!added) {
        if (window.Toast) Toast.show('That category already exists', 'error');
        return;
      }
      applyNewCategoryToSelect(added);
      if (window.Toast) Toast.show(`Added "${added}" category`, 'success');
    } else {
      Categories.update(activeType, editingCategory, { icon: editorIcon, color: editorColor });
      if (window.Toast) Toast.show(`Updated "${editingCategory}"`, 'success');
    }

    closeEditor();
    renderGrid(activeSelect);
    updateTrigger(activeSelect);
  }

  /** After adding a brand-new category, make sure the open select has it as an option and select it. */
  function applyNewCategoryToSelect(name) {
    if (!activeSelect) return;
    const hasOption = Array.from(activeSelect.options).some((o) => o.value === name);
    if (!hasOption) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      activeSelect.appendChild(opt);
    }
    activeSelect.value = name;
    activeSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function onDeleteCategory() {
    if (!editingCategory) return;
    if (!Categories.isCustom(activeType, editingCategory)) return; // built-ins can only be re-styled

    if (!window.confirm(`Delete "${editingCategory}"? Existing expenses/income already using it keep the name, but it will no longer appear as a pick.`)) return;

    const removedName = editingCategory;
    Categories.remove(activeType, removedName);

    removeOptionFromSelect(removedName);
    if (window.Toast) Toast.show(`Deleted "${removedName}" category`, 'info');

    closeEditor();
    renderGrid(activeSelect);
    updateTrigger(activeSelect);
  }

  /** Drop a deleted category's <option> from the live select; if it was the
   *  selected value, fall back to whatever option is now first. */
  function removeOptionFromSelect(name) {
    if (!activeSelect) return;
    const opt = Array.from(activeSelect.options).find((o) => o.value === name);
    if (opt) opt.remove();
    if (activeSelect.value !== name && Array.from(activeSelect.options).some((o) => o.value === activeSelect.value)) return;
    if (activeSelect.options.length) {
      activeSelect.value = activeSelect.options[0].value;
      activeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function updateTrigger(select) {
    const trigger = select.__categoryTrigger;
    if (!trigger) return;
    const type = select.__categoryType || 'expense';
    const value = select.value || (select.options[0] && select.options[0].value) || '';
    if (!value) {
      trigger.querySelector('.category-picker__trigger-label').textContent = 'No categories available';
      return;
    }
    const meta = Categories.metaFor(type, value);
    trigger.querySelector('.category-picker__trigger-icon').style.background = meta.color;
    trigger.querySelector('.category-picker__trigger-icon i').className = `fa-solid ${meta.icon}`;
    trigger.querySelector('.category-picker__trigger-label').textContent = value || 'Select category';
  }

  function enhance(select, type = 'expense') {
    if (!select) return;
    select.__categoryType = type;

    let trigger = select.__categoryTrigger;
    if (!trigger) {
      trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'category-picker__trigger';
      trigger.innerHTML = `
        <span class="category-picker__trigger-icon"><i class="fa-solid fa-circle"></i></span>
        <span class="category-picker__trigger-label">Select category</span>
        <i class="fa-solid fa-chevron-down"></i>`;
      select.style.display = 'none';
      select.insertAdjacentElement('afterend', trigger);
      select.__categoryTrigger = trigger;

      trigger.addEventListener('click', () => {
        activeSelect = select;
        activeType = select.__categoryType || 'expense';
        ensureModal();
        closeEditor();
        renderGrid(select);
        Modal.open(modalEl);
      });

      select.addEventListener('change', () => updateTrigger(select));
    }

    updateTrigger(select);
  }

  function escapeAttr(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { enhance };
})();

window.CategoryPicker = CategoryPicker;
