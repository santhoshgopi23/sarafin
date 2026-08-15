/**
 * zerodha.js
 * Powers zerodha.html — the dedicated Zerodha hub reached from the
 * "Zerodha" button on the Assets page. Three tabs:
 *   1. Overall Holding — upload the Holdings export, preview, save.
 *      Every save fully replaces the previous Zerodha holdings snapshot
 *      (manual/other entries are never touched).
 *   2. Trade Book — upload the Tradebook export year by year. Matched
 *      trades feed the Stock History list; each imported year can be
 *      deleted independently.
 *   3. Dividends — upload the Dividends export year by year. Matched
 *      payouts save against the holding; unmatched ones land under
 *      Closed Positions instead of being dropped.
 *
 * All the actual parse/match/replace logic lives in the shared
 * ZerodhaImport / ZerodhaTradebookImport / ZerodhaDividendImport utils —
 * this file is just the DOM glue for this page.
 */

function escapeHtml(str) {
  // Delegates to the single shared implementation in helpers.js.
  return Helpers.escapeHtml(str);
}

document.addEventListener('DOMContentLoaded', () => {
  Modal.bindTriggers();
  bindTabs();
  bindHoldingsTab();
  initTradebookTab();
  bindDividendTab();
  bindDividendChart();
  renderHoldingsTab();
  renderDividendTab();
  bindAliasSection();
  renderAliasSection();
});

/* ---------------- Tabs ---------------- */

function bindTabs() {
  document.querySelectorAll('[data-zd-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.zdTab;
      document.querySelectorAll('[data-zd-tab]').forEach((b) => b.classList.toggle('is-active', b === btn));
      document.querySelectorAll('[data-zd-panel]').forEach((p) => p.classList.toggle('is-active', p.dataset.zdPanel === key));
    });
  });
}

/* ==================================================================
   TAB 1 — Overall Holding
   ================================================================== */

let _zdHoldingsPreview = null;

function bindHoldingsTab() {
  const input = document.querySelector('[data-zd-holdings-input]');
  if (input) {
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = ZerodhaImport.parse(reader.result);
          if (parsed.errors.length) {
            Toast.show(parsed.errors[0], 'error');
            return;
          }
          _zdHoldingsPreview = ZerodhaImport.buildPreview(parsed);
          renderZdHoldingsPreview(_zdHoldingsPreview);
          Modal.open('#zdHoldingsModal');
        } catch (err) {
          console.error(err);
          Toast.show('That file could not be read as a Zerodha holdings export.', 'error');
        }
      };
      reader.readAsText(file);
      input.value = '';
    });
  }

  const confirmBtn = document.querySelector('[data-zd-holdings-confirm]');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (!_zdHoldingsPreview || (_zdHoldingsPreview.counts.total === 0 && _zdHoldingsPreview.counts.remove === 0)) {
        Modal.close('#zdHoldingsModal');
        return;
      }
      const { created, updated, removed } = ZerodhaImport.commit(_zdHoldingsPreview);
      _zdHoldingsPreview = null;
      Modal.close('#zdHoldingsModal');
      const parts = [];
      if (created) parts.push(`${created} added`);
      if (updated) parts.push(`${updated} updated`);
      if (removed) parts.push(`${removed} removed (sold/closed)`);
      Toast.show(`Holdings import complete — ${parts.join(', ') || 'nothing new'}.`);
      renderHoldingsTab();
      ZD_SEGMENTS.forEach((seg) => renderTbSegPanel(seg)); // stock history is holding-dependent
      renderDividendTab();
    });
  }
}

function renderZdHoldingsPreview(preview) {
  const body = document.querySelector('[data-zd-holdings-preview-body]');
  if (!body) return;
  const fmt = (n) => Helpers.formatCurrency(n);

  const rowsHtml = preview.rows.length
    ? `
      <div class="holdings-table-wrap">
        <table class="data-table holdings-table">
          <thead>
            <tr><th>Name</th><th>Type</th><th class="text-right">Qty.</th><th class="text-right">Avg. Price</th><th class="text-right">Value</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${preview.rows.map((r) => `
              <tr>
                <td>${escapeHtml(r.name)}</td>
                <td>${escapeHtml(r.type)}</td>
                <td class="text-right num">${r.quantity}</td>
                <td class="text-right num">${fmt(r.avgPrice)}</td>
                <td class="text-right num">${fmt(r.value)}</td>
                <td>${r.matchedId ? '<span class="chip tone-info">Update</span>' : '<span class="chip tone-accent">New</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '';

  const removedHtml = preview.counts.remove > 0
    ? `
      <div class="holdings-table-wrap">
        <table class="data-table">
          <thead><tr><th colspan="2">Will be removed — not in this statement anymore (sold/closed)</th></tr></thead>
          <tbody>
            ${preview.removeRows.map((inv) => `<tr><td>${escapeHtml(inv.name)}</td><td>${escapeHtml(inv.type)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>` : '';

  body.innerHTML = `
    <div class="zd-stat-row">
      <div><strong>${preview.counts.total}</strong><small>Holdings found</small></div>
      <div><strong>${preview.counts.new}</strong><small>New</small></div>
      <div><strong>${preview.counts.update}</strong><small>To update</small></div>
    </div>
    <p>Statement date: <strong>${preview.statementDate}</strong> &nbsp;·&nbsp; Invested: <strong>${fmt(preview.totals.invested)}</strong> &nbsp;·&nbsp; Current value: <strong>${fmt(preview.totals.current)}</strong></p>
    <p><small>This always fully replaces your previous Zerodha holdings snapshot — only Zerodha-tagged holdings are added, updated, or removed here. Manual entries are untouched.</small></p>
    ${rowsHtml}
    ${removedHtml}
    ${preview.counts.total === 0 && preview.counts.remove === 0 ? '<p style="color: var(--color-negative, #dc2626);">No holdings could be read from this file.</p>' : ''}
  `;

  const confirmBtn = document.querySelector('[data-zd-holdings-confirm]');
  if (confirmBtn) confirmBtn.disabled = (preview.counts.total === 0 && preview.counts.remove === 0);
}

function renderHoldingsTab() {
  const holdings = (window.Investments ? window.Investments.all() : []).filter((h) => h.source === 'zerodha');
  const body = document.querySelector('[data-zd-holdings-body]');
  if (!body) return;

  const invested = holdings.reduce((s, h) => s + (h.costBasis || 0), 0);
  const value = holdings.reduce((s, h) => s + (h.value || 0), 0);
  const pl = value - invested;

  setText('[data-zd-holdings-count]', holdings.length);
  setText('[data-zd-holdings-invested]', Helpers.formatCurrency(invested));
  setText('[data-zd-holdings-value]', Helpers.formatCurrency(value));
  const plEl = document.querySelector('[data-zd-holdings-pl]');
  if (plEl) {
    plEl.textContent = `${pl >= 0 ? '+' : ''}${Helpers.formatCurrency(pl)}`;
    plEl.style.color = pl >= 0 ? 'var(--color-profit, var(--color-accent))' : 'var(--color-negative)';
  }

  if (holdings.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="empty-state"><i class="fa-solid fa-layer-group"></i> No Zerodha holdings imported yet.</td></tr>`;
    return;
  }

  body.innerHTML = holdings
    .map((h) => {
      const itemPL = (h.value || 0) - (h.costBasis || 0);
      const plClass = itemPL >= 0 ? 'holdings-table__pos' : 'holdings-table__neg';
      return `
        <tr data-id="${h.id}">
          <td><div class="holdings-table__name">${escapeHtml(h.name)} <span class="chip tone-info" style="font-size:10px;">Zerodha</span></div></td>
          <td>${escapeHtml(h.type)}</td>
          <td class="text-right num">${h.quantity ?? '\u2014'}</td>
          <td class="text-right num">${h.avgPrice != null ? Helpers.formatCurrency(h.avgPrice) : '\u2014'}</td>
          <td class="text-right num">${Helpers.formatCurrency(h.value || 0)}</td>
          <td class="text-right num ${plClass}">${itemPL >= 0 ? '+' : ''}${Helpers.formatCurrency(itemPL)}</td>
          <td>
            <div class="holdings-table__actions">
              <button data-zd-delete-holding class="danger" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>`;
    })
    .join('');

  body.querySelectorAll('[data-zd-delete-holding]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('[data-id]').dataset.id;
      const record = window.Investments.get(id);
      if (!record) return;
      if (!window.confirm(`Remove "${record.name}" from your Zerodha holdings?`)) return;
      ZerodhaImport.deleteOne(id);
      Toast.show('Holding removed.', 'info');
      renderHoldingsTab();
    });
  });
}

/* ==================================================================
   TAB 2 — Trade Book
   Equity and Mutual Funds are two entirely separate trade books. Each
   gets its own "Trade Books By Year" list, its own simple 12-box year
   view (one box per month — click a month to see its days, click a
   traded day to see exactly what happened that day), its own Current
   Trades (pick a holding to see its history — nothing is dumped onto
   the page until you do) and its own Closed Trades.
   ================================================================== */

const ZD_SEGMENTS = ['equity', 'mf'];
const ZD_MAX_RANGE_DAYS = 366; // custom range can never span more than ~1 year

let _zdTradebookParsed = null;
let _zdTradebookPreview = null;
let _zdTradebookSegment = 'equity';
let _zdPendingUploadSegment = 'equity';

const _zdTbState = {
  equity: { view: 'year', from: '', to: '', heatmapYear: null },
  mf: { view: 'year', from: '', to: '', heatmapYear: null },
};

function _zdSegLabel(seg) {
  return seg === 'mf' ? 'Mutual Fund' : 'Equity';
}
function _zdHoldingLabel(seg) {
  return seg === 'mf' ? 'Fund' : 'Stock';
}

/* ---------------- Init: build both segment panels once ---------------- */

function initTradebookTab() {
  ZD_SEGMENTS.forEach((seg) => {
    const root = document.querySelector(`[data-zd-tb-seg-panel="${seg}"]`);
    if (!root) return;
    root.innerHTML = tbSegPanelHtml(seg);
    bindTbSegPanel(seg);
    renderTbSegPanel(seg);
  });

  bindTbSegTabs();
  bindTradebookUploadFlow();
}

function bindTbSegTabs() {
  document.querySelectorAll('[data-zd-tb-seg-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const seg = btn.dataset.zdTbSegTab;
      document.querySelectorAll('[data-zd-tb-seg-tab]').forEach((b) => b.classList.toggle('is-active', b === btn));
      ZD_SEGMENTS.forEach((s) => {
        const panel = document.querySelector(`[data-zd-tb-seg-panel="${s}"]`);
        if (panel) panel.style.display = s === seg ? '' : 'none';
      });
    });
  });
}

/* ---------------- Segment panel markup ---------------- */

function tbSegPanelHtml(seg) {
  const holdingLabel = _zdHoldingLabel(seg);
  return `
    <div class="glass card zd-section" style="padding: var(--sp-5);">
      <div class="zd-section__head">
        <div class="zd-section__title"><i class="fa-solid fa-calendar-days"></i> Trade Books By Year</div>
      </div>
      <div class="zd-year-list" data-zd-tradebook-years="${seg}">
        <div class="empty-state"><i class="fa-solid fa-file-invoice"></i> No trade books imported yet.</div>
      </div>
    </div>

    <div class="glass card zd-section" style="padding: var(--sp-5);">
      <div class="zd-section__head">
        <div>
          <div class="zd-section__title"><i class="fa-solid fa-calendar-check"></i> Trade Activity</div>
          <div class="zd-updated"><i class="fa-regular fa-clock"></i> <span data-zd-activity-updated="${seg}">Last updated: —</span></div>
        </div>
        <button type="button" class="btn btn--ghost" data-zd-tb-download="${seg}"><i class="fa-solid fa-download"></i> Download CSV</button>
      </div>

      <div class="zd-tb-viewtoggle">
        <label><input type="radio" name="zdTbView-${seg}" value="year" data-zd-tb-view="${seg}" checked /> Year overview — 12 boxes, one per month</label>
        <label><input type="radio" name="zdTbView-${seg}" value="range" data-zd-tb-view="${seg}" /> Custom range <small style="color:var(--color-text-faint);">(max 1 year)</small></label>
      </div>

      <div class="zd-tb-filterbar" data-zd-tb-yearbar="${seg}">
        <div class="zd-tb-field">
          <label>Year</label>
          <select data-zd-tb-heatmap-year="${seg}"></select>
        </div>
      </div>
      <div class="zd-tb-filterbar" data-zd-tb-rangebar="${seg}" style="display:none;">
        <div class="zd-tb-field zd-tb-field--range">
          <label>Date range (max 1 year)</label>
          <div style="display:flex; align-items:center; gap:6px;">
            <input type="date" data-zd-trade-from="${seg}" aria-label="From date" />
            <span style="color: var(--color-text-faint);">~</span>
            <input type="date" data-zd-trade-to="${seg}" aria-label="To date" />
          </div>
        </div>
        <button type="button" class="btn btn--primary zd-tb-apply" data-zd-trade-apply="${seg}" aria-label="Apply filters"><i class="fa-solid fa-arrow-right"></i></button>
        <button type="button" class="btn btn--ghost" data-zd-trade-range-clear="${seg}" style="height:40px; padding:0 14px;">Reset</button>
      </div>

      <div class="zd-heatmap12" data-zd-heatmap="${seg}"></div>
      <div class="empty-state" data-zd-heatmap-empty="${seg}" style="display:none;"><i class="fa-solid fa-chart-column"></i> No trades yet.</div>
    </div>

    <!-- ============ CURRENT TRADES ============ -->
    <div class="glass card zd-section" style="padding: var(--sp-5);">
      <div class="zd-section__head">
        <div>
          <div class="zd-section__title"><i class="fa-solid fa-clock-rotate-left"></i> Current Trades</div>
          <div class="zd-updated"><i class="fa-regular fa-clock"></i> <span data-zd-current-updated="${seg}">Last updated: —</span></div>
        </div>
      </div>

      <div class="zd-tb-filterbar">
        <div class="zd-tb-field zd-tb-field--grow">
          <label>${holdingLabel}</label>
          <input type="text" class="search" placeholder="Type 3+ letters to find a ${holdingLabel.toLowerCase()}…" data-zd-stock-search="${seg}" autocomplete="off" />
          <select data-zd-stock-select="${seg}" aria-label="Choose a ${holdingLabel.toLowerCase()}" style="margin-top:6px;">
            <option value="">Select a ${holdingLabel.toLowerCase()}…</option>
          </select>
        </div>
        <div class="zd-tb-field zd-tb-field--grow">
          <label>Search</label>
          <input type="text" class="search" placeholder="Search trades" data-zd-current-search="${seg}" autocomplete="off" />
        </div>
        <div class="zd-tb-field zd-tb-field--range">
          <label>Timeline</label>
          <div style="display:flex; align-items:center; gap:6px;">
            <input type="date" data-zd-current-from="${seg}" aria-label="From date" />
            <span style="color: var(--color-text-faint);">~</span>
            <input type="date" data-zd-current-to="${seg}" aria-label="To date" />
          </div>
        </div>
      </div>

      <div data-zd-stock-history="${seg}"></div>
    </div>

    <!-- ============ CLOSED TRADES ============ -->
    <div class="glass card zd-section" style="padding: var(--sp-5);">
      <div class="zd-section__head">
        <div>
          <div class="zd-section__title"><i class="fa-solid fa-box-archive"></i> Closed Trades</div>
          <div class="zd-updated"><i class="fa-regular fa-clock"></i> <span data-zd-closed-updated="${seg}">Last updated: —</span></div>
        </div>
        <button type="button" class="btn btn--ghost" data-zd-clear-unmatched="${seg}">
          <i class="fa-solid fa-broom"></i> Clear All
        </button>
      </div>

      <div class="zd-tb-filterbar">
        <div class="zd-tb-field zd-tb-field--grow">
          <label>${holdingLabel}</label>
          <input type="text" class="search" placeholder="Type 3+ letters to find a ${holdingLabel.toLowerCase()}…" data-zd-closed-stock-search="${seg}" autocomplete="off" />
          <select data-zd-closed-stock-select="${seg}" aria-label="Choose a ${holdingLabel.toLowerCase()}" style="margin-top:6px;">
            <option value="">Select a ${holdingLabel.toLowerCase()}…</option>
          </select>
        </div>
        <div class="zd-tb-field zd-tb-field--grow">
          <label>Search</label>
          <input type="text" class="search" placeholder="Search trades" data-zd-closed-search="${seg}" autocomplete="off" />
        </div>
        <div class="zd-tb-field zd-tb-field--range">
          <label>Timeline</label>
          <div style="display:flex; align-items:center; gap:6px;">
            <input type="date" data-zd-closed-from="${seg}" aria-label="From date" />
            <span style="color: var(--color-text-faint);">~</span>
            <input type="date" data-zd-closed-to="${seg}" aria-label="To date" />
          </div>
        </div>
      </div>

      <div data-zd-unmatched-trades="${seg}"></div>
    </div>
  `;
}

function renderTbSegPanel(seg) {
  renderTradebookYears(seg);
  renderTradeActivitySection(seg);
  renderStockHistory(seg);
  renderUnmatchedTrades(seg);
}

/* ==================================================================
   Import flow — asks Equity or Mutual Fund before opening the file picker
   ================================================================== */

function bindTradebookUploadFlow() {
  const uploadBtn = document.querySelector('[data-zd-tradebook-upload-btn]');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', () => Modal.open('#zdSegmentChooseModal'));
  }

  document.querySelectorAll('[data-zd-choose-seg]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _zdPendingUploadSegment = btn.dataset.zdChooseSeg === 'mf' ? 'mf' : 'equity';
      Modal.close('#zdSegmentChooseModal');
      const input = document.querySelector(`[data-zd-tradebook-input-${_zdPendingUploadSegment}]`);
      if (input) input.click();
    });
  });

  ZD_SEGMENTS.forEach((seg) => {
    const input = document.querySelector(`[data-zd-tradebook-input-${seg}]`);
    if (!input) return;
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = ZerodhaTradebookImport.parse(reader.result, seg);
          if (parsed.errors.length) {
            Toast.show(parsed.errors[0], 'error');
            return;
          }
          _zdTradebookParsed = parsed;
          _zdTradebookSegment = seg;
          const titleEl = document.querySelector('[data-zd-tradebook-modal-title]');
          if (titleEl) titleEl.textContent = `${_zdSegLabel(seg)} Trade Book Import — Preview`;
          const yearSelect = document.querySelector('[data-zd-tradebook-year]');
          if (yearSelect) {
            yearSelect.innerHTML = parsed.years.map((y) => `<option value="${y}">${y}</option>`).join('');
            yearSelect.value = parsed.years[parsed.years.length - 1];
          }
          renderZdTradebookPreview(parsed.years[parsed.years.length - 1]);
          Modal.open('#zdTradebookModal');
        } catch (err) {
          console.error(err);
          Toast.show('That file could not be read as a Zerodha tradebook export.', 'error');
        }
      };
      reader.readAsText(file);
      input.value = '';
    });
  });

  const yearSelect = document.querySelector('[data-zd-tradebook-year]');
  if (yearSelect) yearSelect.addEventListener('change', () => renderZdTradebookPreview(yearSelect.value));

  const confirmBtn = document.querySelector('[data-zd-tradebook-confirm]');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (!_zdTradebookPreview || _zdTradebookPreview.counts.total === 0) {
        Modal.close('#zdTradebookModal');
        return;
      }
      const seg = _zdTradebookSegment;
      const { added, skipped } = ZerodhaTradebookImport.commit(_zdTradebookPreview, seg);
      const year = _zdTradebookPreview.year;
      _zdTradebookPreview = null;
      _zdTradebookParsed = null;
      Modal.close('#zdTradebookModal');
      touchUpdated(_zdActivityKey(seg), `[data-zd-activity-updated="${seg}"]`);
      if (added) touchUpdated(_zdCurrentKey(seg), `[data-zd-current-updated="${seg}"]`);
      if (skipped) touchUpdated(_zdClosedKey(seg), `[data-zd-closed-updated="${seg}"]`);
      const parts = [`${added} trade${added === 1 ? '' : 's'} saved for ${year}`];
      if (skipped) parts.push(`${skipped} kept in Closed Trades (not matched to a holding)`);
      Toast.show(`${_zdSegLabel(seg)} trade book import complete — ${parts.join(', ')}.`);
      // Switch to the segment tab that was just imported so the person sees the result.
      const tabBtn = document.querySelector(`[data-zd-tb-seg-tab="${seg}"]`);
      if (tabBtn) tabBtn.click();
      renderTbSegPanel(seg);
    });
  }
}

function renderZdTradebookPreview(year) {
  if (!_zdTradebookParsed) return;
  const preview = ZerodhaTradebookImport.buildPreview(_zdTradebookParsed, year, _zdTradebookSegment);
  _zdTradebookPreview = preview;

  const holdingLabel = _zdHoldingLabel(_zdTradebookSegment);
  const body = document.querySelector('[data-zd-tradebook-preview-body]');
  if (!body) return;
  const fmt = (n) => Helpers.formatCurrency(n);

  const rowsHtml = preview.rows.length
    ? `
      <div class="holdings-table-wrap">
        <table class="data-table holdings-table">
          <thead><tr><th>Date</th><th>${holdingLabel}</th><th>Type</th><th class="text-right">Qty.</th><th class="text-right">Price</th><th>Status</th></tr></thead>
          <tbody>
            ${preview.rows.map((r) => `
              <tr>
                <td>${escapeHtml(r.date)}</td>
                <td>${escapeHtml(r.holdingName)}</td>
                <td>${r.type === 'sell' ? '<span class="chip tone-negative">Sell</span>' : '<span class="chip tone-accent">Buy</span>'}</td>
                <td class="text-right num">${r.quantity}</td>
                <td class="text-right num">${fmt(r.price)}</td>
                <td>${r.holdingId ? '<span class="chip tone-info">Matched</span>' : '<span class="chip">Not in holdings</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '';

  body.innerHTML = `
    <div class="zd-stat-row">
      <div><strong>${preview.counts.total}</strong><small>Trades for ${year}</small></div>
      <div><strong>${preview.counts.matched}</strong><small>Matched to a holding</small></div>
      <div><strong>${preview.counts.unmatched}</strong><small>Kept in Closed Trades (not matched)</small></div>
    </div>
    <p><small>Saving replaces any ${_zdSegLabel(_zdTradebookSegment)} trade history previously saved for <strong>${year}</strong> only — other years and the other trade book are untouched. Trades that don't match a holding are still saved, just kept under "Closed Trades" instead of Current Trades.</small></p>
    ${rowsHtml}
    ${preview.counts.total === 0 ? `<p style="color: var(--color-negative, #dc2626);">No trades found for ${year}.</p>` : ''}
  `;

  const confirmBtn = document.querySelector('[data-zd-tradebook-confirm]');
  if (confirmBtn) confirmBtn.disabled = preview.counts.total === 0;
}

/* ==================================================================
   Storage-key helpers (per segment)
   ================================================================== */

function _zdActivityKey(seg) {
  return seg === 'mf' ? window.STORAGE_KEYS.TRADEBOOK_ACTIVITY_UPDATED_MF : window.STORAGE_KEYS.TRADEBOOK_ACTIVITY_UPDATED;
}
function _zdCurrentKey(seg) {
  return seg === 'mf' ? window.STORAGE_KEYS.TRADEBOOK_CURRENT_UPDATED_MF : window.STORAGE_KEYS.TRADEBOOK_CURRENT_UPDATED;
}
function _zdClosedKey(seg) {
  return seg === 'mf' ? window.STORAGE_KEYS.TRADEBOOK_CLOSED_UPDATED_MF : window.STORAGE_KEYS.TRADEBOOK_CLOSED_UPDATED;
}

function touchUpdated(storageKey, selector) {
  const iso = new Date().toISOString();
  window.Storage.set(storageKey, iso);
  paintUpdatedLabel(storageKey, selector);
}

function paintUpdatedLabel(storageKey, selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.textContent = _zdFormatUpdated(window.Storage.get(storageKey, null));
}

function _zdFormatUpdated(iso) {
  if (!iso) return 'Last updated: —';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Last updated: —';
  return `Last updated: ${d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

/* ==================================================================
   Trade Books By Year (per segment)
   ================================================================== */

function renderTradebookYears(seg) {
  const wrap = document.querySelector(`[data-zd-tradebook-years="${seg}"]`);
  if (!wrap) return;
  const years = ZerodhaTradebookImport.importedYears(seg);

  if (years.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-file-invoice"></i> No ${_zdSegLabel(seg).toLowerCase()} trade books imported yet.</div>`;
    return;
  }

  const source = seg === 'mf' ? 'zerodha-mf' : 'zerodha';
  const lots = window.HoldingLots ? window.HoldingLots.all() : [];
  wrap.innerHTML = years
    .map((y) => {
      const count = lots.filter((l) => l.source === source && l.year === y).length;
      return `
        <div class="zd-year-row" data-year="${y}">
          <span class="zd-year-row__label">${y}</span>
          <span class="zd-year-row__meta">${count} trade${count === 1 ? '' : 's'} saved</span>
          <button type="button" class="btn btn--ghost" data-zd-delete-tradebook-year><i class="fa-solid fa-trash"></i> Delete</button>
        </div>`;
    })
    .join('');

  wrap.querySelectorAll('[data-zd-delete-tradebook-year]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const year = btn.closest('[data-year]').dataset.year;
      if (!window.confirm(`Delete the ${year} ${_zdSegLabel(seg).toLowerCase()} trade book? This removes its saved trade history only — other years and the other trade book are untouched.`)) return;
      const { removed } = ZerodhaTradebookImport.deleteYear(year, seg);
      touchUpdated(_zdActivityKey(seg), `[data-zd-activity-updated="${seg}"]`);
      touchUpdated(_zdCurrentKey(seg), `[data-zd-current-updated="${seg}"]`);
      touchUpdated(_zdClosedKey(seg), `[data-zd-closed-updated="${seg}"]`);
      Toast.show(`${removed} trade${removed === 1 ? '' : 's'} removed for ${year}.`, 'info');
      renderTbSegPanel(seg);
    });
  });
}

/* ==================================================================
   Trade Activity — simple 12-box year view (one box per month)
   ================================================================== */

function bindTbSegPanel(seg) {
  // View toggle: Year overview (12 boxes for a chosen year) vs Custom range (capped to 1 year).
  document.querySelectorAll(`[data-zd-tb-view="${seg}"]`).forEach((radio) => {
    radio.addEventListener('change', () => {
      _zdTbState[seg].view = radio.value;
      const yearBar = document.querySelector(`[data-zd-tb-yearbar="${seg}"]`);
      const rangeBar = document.querySelector(`[data-zd-tb-rangebar="${seg}"]`);
      if (yearBar) yearBar.style.display = radio.value === 'year' ? '' : 'none';
      if (rangeBar) rangeBar.style.display = radio.value === 'range' ? '' : 'none';
      renderTradeActivitySection(seg);
    });
  });

  const heatmapYearSelect = document.querySelector(`[data-zd-tb-heatmap-year="${seg}"]`);
  if (heatmapYearSelect) {
    heatmapYearSelect.addEventListener('change', () => {
      _zdTbState[seg].heatmapYear = heatmapYearSelect.value;
      renderTradeActivitySection(seg);
    });
  }

  const fromInput = document.querySelector(`[data-zd-trade-from="${seg}"]`);
  const toInput = document.querySelector(`[data-zd-trade-to="${seg}"]`);
  const applyBtn = document.querySelector(`[data-zd-trade-apply="${seg}"]`);
  const clearBtn = document.querySelector(`[data-zd-trade-range-clear="${seg}"]`);

  const applyRange = () => {
    let from = fromInput ? fromInput.value || '' : '';
    let to = toInput ? toInput.value || '' : '';
    if (from && to) {
      const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
      if (days > ZD_MAX_RANGE_DAYS) {
        // Custom range can't track more than one year at a time — clip it back.
        const clipped = new Date(new Date(from).getTime() + ZD_MAX_RANGE_DAYS * 86400000);
        to = clipped.toISOString().slice(0, 10);
        if (toInput) toInput.value = to;
        Toast.show('Custom range can\'t be more than 1 year — end date adjusted.', 'error');
      } else if (days < 0) {
        Toast.show('"To" date must be after "From" date.', 'error');
        return;
      }
    }
    _zdTbState[seg].from = from;
    _zdTbState[seg].to = to;
    renderTradeActivitySection(seg);
    renderStockHistory(seg);
    renderUnmatchedTrades(seg);
  };

  if (applyBtn) applyBtn.addEventListener('click', applyRange);
  if (fromInput) fromInput.addEventListener('change', applyRange);
  if (toInput) toInput.addEventListener('change', applyRange);

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      _zdTbState[seg].from = '';
      _zdTbState[seg].to = '';
      _zdTbState[seg].view = 'year';
      if (fromInput) fromInput.value = '';
      if (toInput) toInput.value = '';
      document.querySelectorAll(`[data-zd-tb-view="${seg}"]`).forEach((r) => { r.checked = r.value === 'year'; });
      const yearBar = document.querySelector(`[data-zd-tb-yearbar="${seg}"]`);
      const rangeBar = document.querySelector(`[data-zd-tb-rangebar="${seg}"]`);
      if (yearBar) yearBar.style.display = '';
      if (rangeBar) rangeBar.style.display = 'none';
      renderTradeActivitySection(seg);
      renderStockHistory(seg);
      renderUnmatchedTrades(seg);
    });
  }

  const downloadBtn = document.querySelector(`[data-zd-tb-download="${seg}"]`);
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      const rows = _zdHeatmapTrades(seg);
      if (typeof Exporter === 'undefined' || !rows.length) {
        Toast.show('No trades to download for this view.', 'error');
        return;
      }
      Exporter.csv(rows, [
        { label: 'Symbol', key: 'name' },
        { label: 'Date', value: (r) => r.date },
        { label: 'Time', value: (r) => r.time || '' },
        { label: 'Order ID', key: 'orderId' },
        { label: 'Trade ID', key: 'tradeId' },
        { label: 'Type', value: (r) => (r.type === 'sell' ? 'Sell' : 'Buy') },
        { label: 'Qty', key: 'quantity' },
        { label: 'Price', key: 'price' },
      ], seg === 'mf' ? 'mf-tradebook' : 'tradebook');
    });
  }

  // Current Trades filter bar
  const stockSelect = document.querySelector(`[data-zd-stock-select="${seg}"]`);
  if (stockSelect) stockSelect.addEventListener('change', () => renderStockHistory(seg));
  bindAssetSearchFilter(`[data-zd-stock-search="${seg}"]`, `[data-zd-stock-select="${seg}"]`);
  const curSearch = document.querySelector(`[data-zd-current-search="${seg}"]`);
  if (curSearch) curSearch.addEventListener('input', () => renderStockHistory(seg));
  const curFrom = document.querySelector(`[data-zd-current-from="${seg}"]`);
  const curTo = document.querySelector(`[data-zd-current-to="${seg}"]`);
  if (curFrom) curFrom.addEventListener('change', () => renderStockHistory(seg));
  if (curTo) curTo.addEventListener('change', () => renderStockHistory(seg));

  // Closed Trades filter bar
  const closedSelect = document.querySelector(`[data-zd-closed-stock-select="${seg}"]`);
  if (closedSelect) closedSelect.addEventListener('change', () => renderUnmatchedTrades(seg));
  bindAssetSearchFilter(`[data-zd-closed-stock-search="${seg}"]`, `[data-zd-closed-stock-select="${seg}"]`);
  const closedSearch = document.querySelector(`[data-zd-closed-search="${seg}"]`);
  if (closedSearch) closedSearch.addEventListener('input', () => renderUnmatchedTrades(seg));
  const closedFrom = document.querySelector(`[data-zd-closed-from="${seg}"]`);
  const closedTo = document.querySelector(`[data-zd-closed-to="${seg}"]`);
  if (closedFrom) closedFrom.addEventListener('change', () => renderUnmatchedTrades(seg));
  if (closedTo) closedTo.addEventListener('change', () => renderUnmatchedTrades(seg));

  const clearAllBtn = document.querySelector(`[data-zd-clear-unmatched="${seg}"]`);
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      if (!window.confirm(`Clear every closed trade in the ${_zdSegLabel(seg).toLowerCase()} trade book? Trades already matched to a holding (Current Trades) are not affected.`)) return;
      const { removed } = ZerodhaTradebookImport.clearAllUnmatched(seg);
      touchUpdated(_zdClosedKey(seg), `[data-zd-closed-updated="${seg}"]`);
      touchUpdated(_zdActivityKey(seg), `[data-zd-activity-updated="${seg}"]`);
      Toast.show(`${removed} closed trade${removed === 1 ? '' : 's'} cleared.`, 'info');
      renderTbSegPanel(seg);
    });
  }
}

/** All trades for a segment, filtered to the year-overview year or the custom range currently selected. */
function _zdHeatmapTrades(seg) {
  const state = _zdTbState[seg];
  const all = ZerodhaTradebookImport.allTrades(seg);
  if (state.view === 'range' && (state.from || state.to)) {
    return all.filter((t) => {
      if (state.from && new Date(t.date).getTime() < new Date(state.from).getTime()) return false;
      if (state.to && new Date(t.date).getTime() > new Date(state.to).getTime() + 86399999) return false;
      return true;
    });
  }
  const year = state.heatmapYear || String(new Date().getFullYear());
  return all.filter((t) => String(t.date).slice(0, 4) === String(year));
}

function _zdIntensity(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  return 3;
}

/** Populates the Year dropdown for the year-overview mode with every year that has a trade, newest first (falls back to the current year). */
function _zdPopulateHeatmapYearSelect(seg) {
  const select = document.querySelector(`[data-zd-tb-heatmap-year="${seg}"]`);
  if (!select) return;
  const all = ZerodhaTradebookImport.allTrades(seg);
  const years = Array.from(new Set(all.map((t) => String(t.date).slice(0, 4)))).sort().reverse();
  const currentYear = String(new Date().getFullYear());
  if (!years.includes(currentYear)) years.unshift(currentYear);

  const prior = _zdTbState[seg].heatmapYear;
  select.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
  const chosen = years.includes(prior) ? prior : years[0];
  select.value = chosen;
  _zdTbState[seg].heatmapYear = chosen;
}

function renderTradeActivitySection(seg) {
  paintUpdatedLabel(_zdActivityKey(seg), `[data-zd-activity-updated="${seg}"]`);
  if (_zdTbState[seg].view === 'year') _zdPopulateHeatmapYearSelect(seg);
  renderHeatmap12(seg);
}

/** Renders exactly 12 simple boxes — one per calendar month — for the chosen year (or the months covered by a custom range, which can never exceed ~12 anyway since ranges are capped at 1 year). */
function renderHeatmap12(seg) {
  const wrap = document.querySelector(`[data-zd-heatmap="${seg}"]`);
  const emptyEl = document.querySelector(`[data-zd-heatmap-empty="${seg}"]`);
  if (!wrap) return;

  const state = _zdTbState[seg];
  const trades = _zdHeatmapTrades(seg);

  let months;
  if (state.view === 'range' && (state.from || state.to)) {
    const start = state.from ? new Date(state.from) : new Date(state.to);
    const end = state.to ? new Date(state.to) : new Date(state.from);
    months = [];
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor <= last && months.length < 12) {
      months.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  } else {
    const year = Number(state.heatmapYear || new Date().getFullYear());
    months = Array.from({ length: 12 }, (_, m) => ({ year, month: m }));
  }

  if (trades.length === 0 && months.length === 12) {
    // Still show the 12 empty boxes for the year so the shape stays simple/consistent.
  }
  if (emptyEl) emptyEl.style.display = trades.length === 0 ? '' : 'none';
  wrap.style.display = '';

  const byMonth = new Map();
  trades.forEach((t) => {
    const d = new Date(t.date);
    if (Number.isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!byMonth.has(key)) byMonth.set(key, { count: 0, total: 0, trades: [] });
    const b = byMonth.get(key);
    b.count += 1;
    b.total += t.quantity * t.price;
    b.trades.push(t);
  });

  wrap.innerHTML = months.map(({ year, month }) => {
    const key = `${year}-${month}`;
    const info = byMonth.get(key);
    const level = info ? _zdIntensity(info.count) : 0;
    const label = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).toUpperCase();
    return `
      <div class="zd-heatmap12__box" data-level="${level}" data-year="${year}" data-month="${month}">
        <div class="zd-heatmap12__month">${label}</div>
        <span class="zd-heatmap12__count">${info ? info.count : 0}</span>
        <div class="zd-heatmap12__amt">${info ? Helpers.formatCurrency(info.total) : '—'}</div>
      </div>`;
  }).join('');

  wrap.querySelectorAll('[data-year][data-month]').forEach((box) => {
    if (box.dataset.level === '0') return;
    box.addEventListener('click', () => {
      openMonthModal(seg, Number(box.dataset.year), Number(box.dataset.month));
    });
  });
}

/** Month drill-down: a simple day grid for one month. Click a traded day to see exactly what happened that day. */
function openMonthModal(seg, year, month) {
  const titleEl = document.querySelector('[data-zd-month-title]');
  const subEl = document.querySelector('[data-zd-month-sub]');
  const gridEl = document.querySelector('[data-zd-month-grid]');
  const emptyEl = document.querySelector('[data-zd-month-empty]');
  if (!gridEl) return;

  const trades = _zdHeatmapTrades(seg).filter((t) => {
    const d = new Date(t.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });

  const byDate = new Map();
  trades.forEach((t) => {
    if (!byDate.has(t.date)) byDate.set(t.date, { count: 0, total: 0, trades: [] });
    const b = byDate.get(t.date);
    b.count += 1;
    b.total += t.quantity * t.price;
    b.trades.push(t);
  });

  if (titleEl) titleEl.textContent = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (subEl) subEl.textContent = `${trades.length} trade${trades.length === 1 ? '' : 's'} \u00b7 ${_zdSegLabel(seg)} trade book`;
  if (emptyEl) emptyEl.style.display = trades.length === 0 ? '' : 'none';

  const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = firstDay.getDay();

  let cells = dow.map((d) => `<div class="zd-monthgrid__dow">${d}</div>`).join('');
  for (let i = 0; i < startWeekday; i++) cells += `<div class="zd-monthgrid__day zd-monthgrid__day--blank"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const info = byDate.get(dateKey);
    if (info) {
      cells += `<div class="zd-monthgrid__day zd-monthgrid__day--traded" data-level="${_zdIntensity(info.count)}" data-date="${dateKey}" title="${escapeHtml(`${info.count} trade${info.count === 1 ? '' : 's'} \u00b7 ${Helpers.formatCurrency(info.total)}`)}">${d}</div>`;
    } else {
      cells += `<div class="zd-monthgrid__day">${d}</div>`;
    }
  }
  gridEl.innerHTML = cells;

  gridEl.querySelectorAll('[data-date]').forEach((cell) => {
    const key = cell.dataset.date;
    const info = byDate.get(key);
    if (!info) return;
    cell.addEventListener('click', () => {
      const d = new Date(key);
      openTradePeriodModal({
        label: d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }),
        trades: info.trades,
        total: info.total,
      });
    });
  });

  Modal.open('#zdMonthModal');
}

/** Shows exactly what happened on one traded day. */
function openTradePeriodModal(bucket) {
  const titleEl = document.querySelector('[data-zd-trade-period-title]');
  const subEl = document.querySelector('[data-zd-trade-period-sub]');
  const bodyEl = document.querySelector('[data-zd-trade-period-body]');
  if (!bodyEl) return;

  if (titleEl) titleEl.textContent = bucket.label;
  if (subEl) subEl.textContent = `${bucket.trades.length} trade${bucket.trades.length === 1 ? '' : 's'} \u00b7 ${Helpers.formatCurrency(bucket.total)} traded`;

  const rows = [...bucket.trades].sort((a, b) => new Date(b.date) - new Date(a.date));
  bodyEl.innerHTML = `
    <div class="holdings-table-wrap">
      <table class="data-table holdings-table">
        <thead><tr><th>Date</th><th>Holding</th><th>Type</th><th class="text-right">Qty.</th><th class="text-right">Price</th><th class="text-right">Total</th></tr></thead>
        <tbody>
          ${rows.map((t) => `
            <tr>
              <td>${Helpers.formatShortDateWithYear(t.date)}</td>
              <td>${escapeHtml(t.name)} ${t.closed ? '<span class="chip" style="font-size:10px;">Closed</span>' : ''}</td>
              <td>${t.type === 'sell' ? '<span class="chip tone-negative">Sell</span>' : '<span class="chip tone-accent">Buy</span>'}</td>
              <td class="text-right num">${t.quantity}</td>
              <td class="text-right num">${Helpers.formatCurrency(t.price)}</td>
              <td class="text-right num">${Helpers.formatCurrency(t.quantity * t.price)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  Modal.open('#zdTradePeriodModal');
}

/* ==================================================================
   Current Trades — dropdown-driven single-holding history. Nothing is
   listed until a stock/fund is picked from the dropdown.
   ================================================================== */

/**
 * Type-to-search filter for an asset/stock <select>. The select keeps
 * getting fully repopulated by its owning render function (renderStockHistory /
 * renderUnmatchedTrades) — that render function stashes the complete,
 * unfiltered option list on `selectEl._zdFullOptions` each time it runs.
 * This binder narrows the select down to matches once 3+ characters are
 * typed (expanding it into a visible multi-row suggestion list via the
 * `size` attribute), and collapses it back to a normal closed dropdown
 * with the full list restored below 3 characters.
 */
function bindAssetSearchFilter(searchSelector, selectSelector, minChars = 3) {
  const searchEl = document.querySelector(searchSelector);
  const selectEl = document.querySelector(selectSelector);
  if (!searchEl || !selectEl || searchEl.dataset.zdSearchBound) return;
  searchEl.dataset.zdSearchBound = '1';

  const renderOptions = (opts, current) => {
    selectEl.innerHTML = (selectEl._zdPlaceholder || '<option value="">Select…</option>') +
      opts.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
    selectEl.value = opts.some((o) => o.value === current) ? current : '';
  };

  searchEl.addEventListener('input', () => {
    const all = selectEl._zdFullOptions || [];
    const q = searchEl.value.trim().toLowerCase();
    const current = selectEl.value;

    if (q.length < minChars) {
      renderOptions(all, current);
      selectEl.size = 1;
      return;
    }

    const matches = all.filter((o) => o.label.toLowerCase().includes(q));
    renderOptions(matches, current);
    selectEl.size = matches.length ? Math.min(8, Math.max(2, matches.length)) : 1;
    if (!matches.length) {
      selectEl.innerHTML = '<option value="" disabled selected>No matches</option>';
    }
  });

  searchEl.addEventListener('focus', () => {
    if (searchEl.value.trim().length >= minChars) searchEl.dispatchEvent(new Event('input'));
  });

  selectEl.addEventListener('change', () => {
    selectEl.size = 1;
    if (selectEl.value) {
      const chosen = (selectEl._zdFullOptions || []).find((o) => o.value === selectEl.value);
      if (chosen) searchEl.value = chosen.label;
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target !== searchEl && e.target !== selectEl) selectEl.size = 1;
  });
}

function renderStockHistory(seg) {
  const wrap = document.querySelector(`[data-zd-stock-history="${seg}"]`);
  if (!wrap) return;

  paintUpdatedLabel(_zdCurrentKey(seg), `[data-zd-current-updated="${seg}"]`);

  const holdingLabel = _zdHoldingLabel(seg);
  const allGroups = ZerodhaTradebookImport.stockHistory(null, seg);
  const select = document.querySelector(`[data-zd-stock-select="${seg}"]`);
  let selected = '';
  if (select) {
    const current = select.value;
    select._zdPlaceholder = `<option value="">Select a ${holdingLabel.toLowerCase()}…</option>`;
    select._zdFullOptions = allGroups.map((g) => ({ value: g.holdingName, label: `${g.holdingName} (${g.trades.length})` }));
    select.innerHTML = select._zdPlaceholder + allGroups
      .map((g) => `<option value="${escapeHtml(g.holdingName)}">${escapeHtml(g.holdingName)} (${g.trades.length})</option>`).join('');
    selected = allGroups.some((g) => g.holdingName === current) ? current : '';
    select.value = selected;
  }

  if (allGroups.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i> No matched trade history yet. Import a trade book above.</div>`;
    return;
  }
  if (!selected) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-hand-pointer"></i> Pick a ${holdingLabel.toLowerCase()} above to see its trade history.</div>`;
    return;
  }

  const group = allGroups.find((g) => g.holdingName === selected);
  const searchInput = document.querySelector(`[data-zd-current-search="${seg}"]`);
  const fromInput = document.querySelector(`[data-zd-current-from="${seg}"]`);
  const toInput = document.querySelector(`[data-zd-current-to="${seg}"]`);
  const search = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const from = fromInput ? fromInput.value : '';
  const to = toInput ? toInput.value : '';

  let trades = group.trades.filter((t) => {
    if (from && new Date(t.date).getTime() < new Date(from).getTime()) return false;
    if (to && new Date(t.date).getTime() > new Date(to).getTime() + 86399999) return false;
    if (search && ![t.date, t.type, t.year].join(' ').toLowerCase().includes(search)) return false;
    return true;
  });

  if (trades.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i> No trades match this filter for ${escapeHtml(selected)}.</div>`;
    return;
  }

  wrap.innerHTML = `
    <div style="margin-bottom: var(--sp-2); font-weight:700; display:flex; align-items:center; gap:8px;">
      ${escapeHtml(selected)} <span class="chip tone-info" style="font-size:10px;">${seg === 'mf' ? 'Mutual Fund' : 'Zerodha'}</span>
    </div>
    <div class="holdings-table-wrap">
      <table class="data-table holdings-table">
        <thead><tr><th>Date</th><th>Type</th><th class="text-right">Qty.</th><th class="text-right">Price</th><th class="text-right">Total</th><th>Year</th><th></th></tr></thead>
        <tbody>
          ${trades.map((t) => `
            <tr data-id="${t.id}">
              <td>${escapeHtml(t.date)}</td>
              <td>${t.type === 'sell' ? '<span class="chip tone-negative">Sell</span>' : '<span class="chip tone-accent">Buy</span>'}</td>
              <td class="text-right num">${t.quantity}</td>
              <td class="text-right num">${Helpers.formatCurrency(t.price)}</td>
              <td class="text-right num">${Helpers.formatCurrency(t.quantity * t.price)}</td>
              <td>${escapeHtml(t.year || '')}</td>
              <td><button data-zd-delete-current-row class="danger" aria-label="Delete"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  wrap.querySelectorAll('[data-zd-delete-current-row]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('[data-id]');
      const id = row.dataset.id;
      if (!window.confirm('Delete this trade? This only removes it from your saved trade history.')) return;
      window.HoldingLots.remove(id);
      touchUpdated(_zdCurrentKey(seg), `[data-zd-current-updated="${seg}"]`);
      touchUpdated(_zdActivityKey(seg), `[data-zd-activity-updated="${seg}"]`);
      Toast.show('Trade deleted.', 'info');
      row.remove();
      renderTradebookYears(seg);
      renderTradeActivitySection(seg);
      // Re-render fully so the dropdown's trade count and empty states stay in sync.
      renderStockHistory(seg);
    });
  });
}

/* ==================================================================
   Closed Trades — dropdown-driven single-holding history. Nothing is
   listed until a stock/fund is picked from the dropdown.
   ================================================================== */

function renderUnmatchedTrades(seg) {
  const wrap = document.querySelector(`[data-zd-unmatched-trades="${seg}"]`);
  if (!wrap) return;

  paintUpdatedLabel(_zdClosedKey(seg), `[data-zd-closed-updated="${seg}"]`);

  const holdingLabel = _zdHoldingLabel(seg);
  const allGroups = ZerodhaTradebookImport.unmatchedTrades(null, seg);
  const select = document.querySelector(`[data-zd-closed-stock-select="${seg}"]`);
  let selected = '';
  if (select) {
    const current = select.value;
    select._zdPlaceholder = `<option value="">Select a ${holdingLabel.toLowerCase()}…</option>`;
    select._zdFullOptions = allGroups.map((g) => ({ value: g.symbol, label: `${g.symbol} (${g.trades.length})` }));
    select.innerHTML = select._zdPlaceholder + allGroups
      .map((g) => `<option value="${escapeHtml(g.symbol)}">${escapeHtml(g.symbol)} (${g.trades.length})</option>`).join('');
    selected = allGroups.some((g) => g.symbol === current) ? current : '';
    select.value = selected;
  }

  const clearAllBtn = document.querySelector(`[data-zd-clear-unmatched="${seg}"]`);
  if (clearAllBtn) clearAllBtn.disabled = allGroups.length === 0;

  if (allGroups.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-box-archive"></i> No closed trades. Trades that don't match a current holding will be kept here instead of dropped.</div>`;
    return;
  }
  if (!selected) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-hand-pointer"></i> Pick a ${holdingLabel.toLowerCase()} above to see its trade history.</div>`;
    return;
  }

  const group = allGroups.find((g) => g.symbol === selected);
  const searchInput = document.querySelector(`[data-zd-closed-search="${seg}"]`);
  const fromInput = document.querySelector(`[data-zd-closed-from="${seg}"]`);
  const toInput = document.querySelector(`[data-zd-closed-to="${seg}"]`);
  const search = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const from = fromInput ? fromInput.value : '';
  const to = toInput ? toInput.value : '';

  let trades = group.trades.filter((t) => {
    if (from && new Date(t.date).getTime() < new Date(from).getTime()) return false;
    if (to && new Date(t.date).getTime() > new Date(to).getTime() + 86399999) return false;
    if (search && ![t.date, t.type, t.year].join(' ').toLowerCase().includes(search)) return false;
    return true;
  });

  if (trades.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-box-archive"></i> No trades match this filter for ${escapeHtml(selected)}.</div>`;
    return;
  }

  wrap.innerHTML = `
    <div style="margin-bottom: var(--sp-2); font-weight:700; display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
      <span>${escapeHtml(selected)} <span class="chip" style="font-size:10px;">Not in holdings</span></span>
      <button type="button" class="btn btn--ghost" data-zd-map-symbol style="padding: 4px 10px; font-size: var(--fs-xs);">
        <i class="fa-solid fa-link"></i> Map to a holding
      </button>
    </div>
    <div class="holdings-table-wrap">
      <table class="data-table holdings-table">
        <thead><tr><th>Date</th><th>Type</th><th class="text-right">Qty.</th><th class="text-right">Price</th><th>Year</th><th></th></tr></thead>
        <tbody>
          ${trades.map((t) => `
            <tr data-id="${t.id}">
              <td>${escapeHtml(t.date)}</td>
              <td>${t.type === 'sell' ? '<span class="chip tone-negative">Sell</span>' : '<span class="chip tone-accent">Buy</span>'}</td>
              <td class="text-right num">${t.quantity}</td>
              <td class="text-right num">${Helpers.formatCurrency(t.price)}</td>
              <td>${escapeHtml(t.year || '')}</td>
              <td><button data-zd-clear-unmatched-row class="danger" aria-label="Delete"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  const mapBtn = wrap.querySelector('[data-zd-map-symbol]');
  if (mapBtn) mapBtn.addEventListener('click', () => openAliasModalForSymbol(selected));

  wrap.querySelectorAll('[data-zd-clear-unmatched-row]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('[data-id]');
      const id = row.dataset.id;
      ZerodhaTradebookImport.removeUnmatched(id, seg);
      touchUpdated(_zdClosedKey(seg), `[data-zd-closed-updated="${seg}"]`);
      touchUpdated(_zdActivityKey(seg), `[data-zd-activity-updated="${seg}"]`);
      Toast.show('Trade deleted.', 'info');
      row.remove();
      renderTradebookYears(seg);
      renderTradeActivitySection(seg);
      renderUnmatchedTrades(seg);
    });
  });
}

/* ==================================================================
   TAB 3 — Dividends
   ================================================================== */

let _zdDividendParsed = null;
let _zdDividendPreview = null;

function bindDividendTab() {
  const input = document.querySelector('[data-zd-dividend-input]');
  if (input) {
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = ZerodhaDividendImport.parse(reader.result);
          if (parsed.errors.length) {
            Toast.show(parsed.errors[0], 'error');
            return;
          }
          _zdDividendParsed = parsed;
          const yearSelect = document.querySelector('[data-zd-dividend-year]');
          if (yearSelect) {
            yearSelect.innerHTML = parsed.years.map((y) => `<option value="${y}">${y}</option>`).join('');
            yearSelect.value = parsed.years[parsed.years.length - 1];
          }
          renderZdDividendPreview(parsed.years[parsed.years.length - 1]);
          Modal.open('#zdDividendModal');
        } catch (err) {
          console.error(err);
          Toast.show('That file could not be read as a Zerodha dividends export.', 'error');
        }
      };
      reader.readAsText(file);
      input.value = '';
    });
  }

  const yearSelect = document.querySelector('[data-zd-dividend-year]');
  if (yearSelect) yearSelect.addEventListener('change', () => renderZdDividendPreview(yearSelect.value));

  const confirmBtn = document.querySelector('[data-zd-dividend-confirm]');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (!_zdDividendPreview || _zdDividendPreview.counts.total === 0) {
        Modal.close('#zdDividendModal');
        return;
      }
      const { added, closed } = ZerodhaDividendImport.commit(_zdDividendPreview);
      const year = _zdDividendPreview.year;
      _zdDividendPreview = null;
      _zdDividendParsed = null;
      Modal.close('#zdDividendModal');
      const parts = [`${added} dividend${added === 1 ? '' : 's'} saved for ${year}`];
      if (closed) parts.push(`${closed} moved to Closed Positions`);
      Toast.show(`Dividend import complete — ${parts.join(', ')}.`);
      renderDividendTab();
    });
  }
}

function renderZdDividendPreview(year) {
  if (!_zdDividendParsed) return;
  const preview = ZerodhaDividendImport.buildPreview(_zdDividendParsed, year);
  _zdDividendPreview = preview;

  const body = document.querySelector('[data-zd-dividend-preview-body]');
  if (!body) return;
  const fmt = (n) => Helpers.formatCurrency(n);

  const rowsHtml = preview.rows.length
    ? `
      <div class="holdings-table-wrap">
        <table class="data-table holdings-table">
          <thead><tr><th>Date</th><th>Holding</th><th class="text-right">Qty.</th><th class="text-right">Amount</th><th>Status</th></tr></thead>
          <tbody>
            ${preview.rows.map((r) => `
              <tr>
                <td>${escapeHtml(r.date)}</td>
                <td>${escapeHtml(r.holdingName)}</td>
                <td class="text-right num">${r.quantity ?? '\u2014'}</td>
                <td class="text-right num">${fmt(r.amount)}</td>
                <td>${r.holdingId ? '<span class="chip tone-info">Matched</span>' : '<span class="chip tone-negative">Closed position</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '';

  body.innerHTML = `
    <div class="zd-stat-row">
      <div><strong>${preview.counts.total}</strong><small>Dividends for ${year}</small></div>
      <div><strong>${preview.counts.matched}</strong><small>Matched to a holding</small></div>
      <div><strong>${preview.counts.unmatched}</strong><small>Closed positions</small></div>
    </div>
    <p><small>Saving replaces any Zerodha dividends previously saved for <strong>${year}</strong> only — other years and manual entries are untouched. Unmatched payouts are saved under Closed Positions, not dropped.</small></p>
    ${rowsHtml}
    ${preview.counts.total === 0 ? `<p style="color: var(--color-negative, #dc2626);">No dividends found for ${year}.</p>` : ''}
  `;

  const confirmBtn = document.querySelector('[data-zd-dividend-confirm]');
  if (confirmBtn) confirmBtn.disabled = preview.counts.total === 0;
}

function renderDividendTab() {
  renderDividendYears();
  renderClosedPositions();
  renderDividendChart();
}

function renderDividendYears() {
  const wrap = document.querySelector('[data-zd-dividend-years]');
  if (!wrap) return;
  const years = ZerodhaDividendImport.importedYears();

  if (years.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-hand-holding-dollar"></i> No dividends imported yet.</div>`;
    return;
  }

  const all = window.Dividends ? window.Dividends.all() : [];
  wrap.innerHTML = years
    .map((y) => {
      const entries = all.filter((d) => d.source === 'zerodha' && d.year === y);
      const total = entries.reduce((s, d) => s + (Number(d.amount) || 0), 0);
      return `
        <div class="zd-year-row" data-year="${y}">
          <span class="zd-year-row__label">${y}</span>
          <span class="zd-year-row__meta">${entries.length} payment${entries.length === 1 ? '' : 's'} \u00b7 ${Helpers.formatCurrency(total)}</span>
          <button type="button" class="btn btn--ghost" data-zd-delete-dividend-year><i class="fa-solid fa-trash"></i> Delete</button>
        </div>`;
    })
    .join('');

  wrap.querySelectorAll('[data-zd-delete-dividend-year]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const year = btn.closest('[data-year]').dataset.year;
      if (!window.confirm(`Delete all ${year} dividends imported from Zerodha? Other years and manual entries are untouched.`)) return;
      const { removed } = ZerodhaDividendImport.deleteYear(year);
      Toast.show(`${removed} dividend${removed === 1 ? '' : 's'} removed for ${year}.`, 'info');
      renderDividendTab();
    });
  });
}

/* ---------------- Dividend chart (Year / Month toggle) ---------------- */

let _zdDividendChart = null;
let _zdChartGranularity = 'year';

function bindDividendChart() {
  document.querySelectorAll('[data-zd-chart-granularity]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _zdChartGranularity = btn.dataset.zdChartGranularity;
      document.querySelectorAll('[data-zd-chart-granularity]').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderDividendChart();
    });
  });

  const yearSelect = document.querySelector('[data-zd-dividend-chart-year]');
  if (yearSelect) yearSelect.addEventListener('change', () => renderDividendChart());
}

function renderDividendChart() {
  const canvas = document.getElementById('zdDividendChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const yearSelect = document.querySelector('[data-zd-dividend-chart-year]');
  const selectedYear = yearSelect && yearSelect.value ? yearSelect.value : null;
  const data = ZerodhaDividendImport.chartData(_zdChartGranularity, selectedYear);

  if (yearSelect) {
    if (_zdChartGranularity === 'month') {
      yearSelect.style.display = '';
      yearSelect.innerHTML = (data.years || []).map((y) => `<option value="${y}">${y}</option>`).join('');
      yearSelect.value = data.year;
    } else {
      yearSelect.style.display = 'none';
    }
  }

  if (typeof ChartTheme !== 'undefined') ChartTheme.applyDefaults();

  if (_zdDividendChart) {
    _zdDividendChart.destroy();
    _zdDividendChart = null;
  }

  if (!data.labels.length) return;

  _zdDividendChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [{
        label: 'Dividends',
        data: data.values,
        backgroundColor: '#34d399',
        borderRadius: 6,
        maxBarThickness: 40,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => Helpers.formatCurrency(ctx.parsed.y),
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: {
          grid: { color: typeof ChartTheme !== 'undefined' ? ChartTheme.gridColor() : 'rgba(255,255,255,0.06)' },
          border: { display: false },
          ticks: { callback: (v) => Helpers.formatCurrency(v) },
        },
      },
    },
  });
}

function renderClosedPositions() {
  const wrap = document.querySelector('[data-zd-closed-positions]');
  if (!wrap) return;
  const groups = ZerodhaDividendImport.closedPositions();

  if (groups.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-box-archive"></i> No closed-position dividends. Payouts for stocks you've fully sold will show up here instead of being dropped.</div>`;
    return;
  }

  // Every date isn't shown by default — just the stock and its total.
  // Click "Show History" to expand that stock's individual payout dates.
  wrap.innerHTML = groups
    .map((g, gi) => `
      <div style="margin-bottom: var(--sp-3);" data-closed-group="${gi}">
        <div style="font-weight:700; margin-bottom: var(--sp-2); display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
          <span>${escapeHtml(g.holdingName)} <span class="chip tone-negative" style="font-size:10px;">Closed position</span> <span class="chip" style="font-size:10px;">${g.entries.length} payment${g.entries.length === 1 ? '' : 's'}</span></span>
          <span style="display:flex; align-items:center; gap: var(--sp-3);">
            <span class="num">${Helpers.formatCurrency(g.totalAmount)}</span>
            <button type="button" class="btn btn--ghost" data-zd-map-symbol style="padding: 4px 10px; font-size: var(--fs-xs);">
              <i class="fa-solid fa-link"></i> Map to a holding
            </button>
            <button type="button" class="btn btn--ghost" data-zd-toggle-closed-history style="padding: 4px 10px; font-size: var(--fs-xs);">
              <i class="fa-solid fa-clock-rotate-left"></i> Show History
            </button>
          </span>
        </div>
        <div class="holdings-table-wrap" data-closed-history style="display:none;">
          <table class="data-table holdings-table">
            <thead><tr><th>Date</th><th class="text-right">Qty.</th><th class="text-right">Amount</th><th>Year</th><th></th></tr></thead>
            <tbody>
              ${g.entries.map((d) => `
                <tr data-id="${d.id}">
                  <td>${Helpers.formatShortDate(d.date)}</td>
                  <td class="text-right num">${d.quantity ?? '\u2014'}</td>
                  <td class="text-right num">${Helpers.formatCurrency(d.amount)}</td>
                  <td>${escapeHtml(d.year || '')}</td>
                  <td><button data-zd-delete-closed-dividend class="danger" aria-label="Delete"><i class="fa-solid fa-trash"></i></button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`)
    .join('');

  wrap.querySelectorAll('[data-zd-toggle-closed-history]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.closest('[data-closed-group]');
      const historyWrap = group.querySelector('[data-closed-history]');
      const isOpen = historyWrap.style.display !== 'none';
      historyWrap.style.display = isOpen ? 'none' : '';
      btn.innerHTML = isOpen
        ? '<i class="fa-solid fa-clock-rotate-left"></i> Show History'
        : '<i class="fa-solid fa-chevron-up"></i> Hide History';
    });
  });

  wrap.querySelectorAll('[data-zd-map-symbol]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const gi = Number(btn.closest('[data-closed-group]').dataset.closedGroup);
      openAliasModalForSymbol(groups[gi].holdingName);
    });
  });

  wrap.querySelectorAll('[data-zd-delete-closed-dividend]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('[data-id]').dataset.id;
      if (!window.confirm('Remove this dividend entry?')) return;
      window.Dividends.remove(id);
      Toast.show('Dividend removed.', 'info');
      renderClosedPositions();
      renderDividendYears();
      renderDividendChart();
    });
  });
}

/* ==================================================================
   Name Matching — manual mapping between a Zerodha CSV name and a
   holding, used as a matching fallback for both Trade Book and
   Dividends imports (see zerodha-symbol-aliases.js). One shared list,
   rendered identically in both tabs.
   ================================================================== */

let _zdAliasEditingId = null;

function bindAliasSection() {
  document.querySelectorAll('[data-zd-alias-add]').forEach((btn) => {
    btn.addEventListener('click', () => openAliasModal(null));
  });

  const search = document.querySelector('[data-zd-alias-holding-search]');
  if (search) {
    search.addEventListener('input', () => populateAliasHoldingSelect(search.value));
    // Re-expand into a suggestion list on refocus if there's already a query typed.
    search.addEventListener('focus', () => populateAliasHoldingSelect(search.value));
  }

  // Clicking a suggestion locks it in: fills the search box with the
  // chosen holding's name and collapses the list back down, same as a
  // normal autocomplete.
  const select = document.querySelector('[data-zd-alias-holding-select]');
  if (select) {
    select.addEventListener('change', () => {
      if (select.value && search) {
        const h = (window.Investments ? window.Investments.all() : []).find((x) => x.id === select.value);
        if (h) search.value = h.name;
      }
      select.size = 1;
    });
  }

  const saveBtn = document.querySelector('[data-zd-alias-save]');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const selectEl = document.querySelector('[data-zd-alias-holding-select]');
      const input = document.querySelector('[data-zd-alias-input]');
      const holdingId = selectEl ? selectEl.value : '';
      const aliasText = input ? input.value.trim() : '';

      if (!holdingId) { Toast.show('Search for and choose the holding this name belongs to.', 'error'); return; }
      if (!aliasText) { Toast.show('Enter the name exactly as it appears in the CSV.', 'error'); return; }

      const holding = (window.Investments ? window.Investments.all() : []).find((h) => h.id === holdingId);
      const holdingName = holding ? holding.name : '';

      if (_zdAliasEditingId) {
        window.ZerodhaSymbolAliases.update(_zdAliasEditingId, { holdingId, holdingName, alias: aliasText });
        Toast.show('Name mapping updated.', 'info');
      } else {
        window.ZerodhaSymbolAliases.add({ holdingId, holdingName, alias: aliasText });
        Toast.show('Name mapping saved.', 'info');
      }
      Modal.close('#zdAliasModal');
      renderAliasSection();

      // Immediately re-sync: anything already imported and sitting as
      // "unmatched"/"closed position" for this exact CSV name now has a
      // mapping, so pull it into the mapped holding without needing the
      // CSV re-uploaded.
      syncMappedData();
    });
  }
}

/** Re-resolves every currently-unmatched trade/dividend against holdings + name mappings, and refreshes any visible sections. Call after any mapping change. */
function syncMappedData() {
  const eq = window.ZerodhaTradebookImport ? window.ZerodhaTradebookImport.resolveUnmatched('equity') : { resolved: 0 };
  const mf = window.ZerodhaTradebookImport ? window.ZerodhaTradebookImport.resolveUnmatched('mf') : { resolved: 0 };
  const div = window.ZerodhaDividendImport ? window.ZerodhaDividendImport.resolveUnmatched() : { resolved: 0 };
  const total = (eq.resolved || 0) + (mf.resolved || 0) + (div.resolved || 0);

  if (total > 0) {
    Toast.show(`Synced ${total} previously-unmatched ${total === 1 ? 'entry' : 'entries'} to the mapped holding.`, 'info');
  }

  renderUnmatchedTrades('equity');
  renderUnmatchedTrades('mf');
  renderClosedPositions();
  renderTradebookYears('equity');
  renderTradebookYears('mf');
  renderTradeActivitySection('equity');
  renderTradeActivitySection('mf');
  renderDividendYears();
  renderDividendChart();
}

/** Opens the mapping modal with the CSV name already filled in — used by the "Map to a holding" action on an unmatched trade/dividend group, so nothing has to be re-typed. */
function openAliasModalForSymbol(symbol) {
  openAliasModal(null);
  const input = document.querySelector('[data-zd-alias-input]');
  if (input) input.value = symbol || '';
}

function openAliasModal(alias) {
  _zdAliasEditingId = alias ? alias.id : null;

  const titleEl = document.querySelector('[data-zd-alias-modal-title]');
  if (titleEl) titleEl.textContent = alias ? 'Edit Name Mapping' : 'Add Name Mapping';

  const search = document.querySelector('[data-zd-alias-holding-search]');
  if (search) search.value = '';
  populateAliasHoldingSelect('');
  const select = document.querySelector('[data-zd-alias-holding-select]');
  if (select) select.size = 1;

  if (select) select.value = alias ? alias.holdingId : '';
  if (search && alias && alias.holdingId) {
    const h = (window.Investments ? window.Investments.all() : []).find((x) => x.id === alias.holdingId);
    if (h) search.value = h.name;
  }

  const input = document.querySelector('[data-zd-alias-input]');
  if (input) input.value = alias ? alias.alias : '';

  Modal.open('#zdAliasModal');
}

/**
 * Fills the holding <select> in the mapping modal, optionally narrowed to
 * holdings matching `query`. Once at least 3 characters are typed, the
 * select is expanded (via the `size` attribute) into a visible
 * multi-row suggestion list instead of a closed dropdown, so it behaves
 * like a search-as-you-type autocomplete rather than a picker you have
 * to click open.
 */
function populateAliasHoldingSelect(query) {
  const select = document.querySelector('[data-zd-alias-holding-select]');
  if (!select) return;
  const holdings = (window.Investments ? window.Investments.all() : [])
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const q = (query || '').trim().toLowerCase();
  const filtered = q.length >= 3 ? holdings.filter((h) => (h.name || '').toLowerCase().includes(q)) : holdings;

  const current = select.value;
  select.innerHTML = '<option value="">Select a holding…</option>' +
    (filtered.length ? filtered.map((h) => `<option value="${h.id}">${escapeHtml(h.name)}${h.type ? ` — ${escapeHtml(h.type)}` : ''}</option>`).join('') : '');
  select.value = filtered.some((h) => h.id === current) ? current : '';

  // Show as an open suggestion list once there's a real search (3+ chars);
  // collapse back to a normal closed dropdown otherwise.
  select.size = q.length >= 3 ? Math.min(6, Math.max(2, filtered.length)) : 1;
}

function renderAliasSection() {
  const lists = document.querySelectorAll('[data-zd-alias-list]');
  if (!lists.length) return;

  const aliases = (window.ZerodhaSymbolAliases ? window.ZerodhaSymbolAliases.all() : [])
    .slice()
    .sort((a, b) => (a.holdingName || '').localeCompare(b.holdingName || ''));

  const html = aliases.length
    ? aliases.map((a) => `
        <div class="zd-year-row" data-alias-id="${a.id}">
          <div class="zd-alias-row__info">
            <span class="zd-alias-row__alias">${escapeHtml(a.alias)}</span>
            <i class="fa-solid fa-arrow-right-long zd-alias-row__arrow"></i>
            <span class="zd-alias-row__holding">${escapeHtml(a.holdingName || 'Unknown holding')}</span>
          </div>
          <div class="row-actions">
            <button type="button" data-zd-alias-edit aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
            <button type="button" class="danger" data-zd-alias-delete aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>`).join('')
    : `<div class="empty-state"><i class="fa-solid fa-link"></i> No name mappings yet.</div>`;

  lists.forEach((el) => { el.innerHTML = html; });

  document.querySelectorAll('[data-zd-alias-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('[data-alias-id]').dataset.aliasId;
      const alias = (window.ZerodhaSymbolAliases ? window.ZerodhaSymbolAliases.all() : []).find((a) => a.id === id);
      if (alias) openAliasModal(alias);
    });
  });

  document.querySelectorAll('[data-zd-alias-delete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.closest('[data-alias-id]').dataset.aliasId;
      if (!window.confirm('Remove this name mapping? Trades/dividends already imported are not affected — this only changes matching on future uploads.')) return;
      window.ZerodhaSymbolAliases.remove(id);
      Toast.show('Name mapping removed.', 'info');
      renderAliasSection();
    });
  });
}

/* ---------------- shared ---------------- */

function setText(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}
