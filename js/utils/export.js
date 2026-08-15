/**
 * export.js
 * Shared export utility for all pages.
 * Supports: CSV and PDF (via jsPDF) only — no Word export.
 *
 * The PDF is deliberately plain and monochrome: black ink on white,
 * thin hairline rules, generous whitespace, small-caps section labels.
 * No colored banners, no colored category dots — just a clean,
 * statement-style document that reads well printed or on screen.
 *
 * Usage:
 *   Exporter.csv(rows, columns, filename)
 *   Exporter.pdf(config)
 *
 * config = {
 *   title, subtitle, period, userName,
 *   summaryCards: [{ label, value, negative? }],
 *   tables: [{
 *     title, hideTitle, rows,
 *     columns: [{ label, key, value(row), align, prefix }],
 *   }],
 *   categoryBreakdown: {
 *     transactionCount,
 *     spending: [{ label, value }],   // sorted desc, value pre-formatted (e.g. "24%")
 *     income:   [{ label, value }],
 *   },                                 // shown right under the summary strip, at the top
 *   filename,
 * }
 */

const Exporter = (() => {

  /* ─────────────────────────────────────────
     CSV
  ───────────────────────────────────────── */
  function csv(rows, columns, filename = 'export') {
    if (!rows || rows.length === 0) {
      Toast.show('No data to export.', 'warning');
      return;
    }
    const header = columns.map(c => `"${c.label}"`).join(',');
    const body = rows.map(row =>
      columns.map(c => {
        const val = typeof c.value === 'function' ? c.value(row) : (row[c.key] ?? '');
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(',')
    ).join('\n');
    const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    _download(blob, `${filename}.csv`);
    Toast.show('CSV exported successfully!', 'success');
  }

  /* ─────────────────────────────────────────
     PDF — clean, monochrome, premium statement style
  ───────────────────────────────────────── */
  async function pdf(config) {
    const {
      title = 'Financial Report',
      subtitle = '',
      period = '',
      userName = '',
      summaryCards = [],
      tables = [],
      categoryBreakdown = null,
      filename = 'report',
    } = config;

    if (typeof window.jspdf === 'undefined') {
      Toast.show('Loading PDF library…', 'info');
      await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Embed a Unicode font (Noto Sans) and use it for everything below instead
    // of jsPDF's built-in "helvetica". Helvetica uses WinAnsi encoding, which
    // has no glyph for the Indian Rupee sign (U+20B9) or several other
    // currency symbols, so amounts like "₹10.00" were silently rendered as
    // garbled characters (e.g. "¹10.00"). See pdf-fonts.js for details.
    if (window.PdfFonts && typeof window.PdfFonts.register === 'function') {
      window.PdfFonts.register(doc);
    } else {
      console.warn('PdfFonts not loaded — falling back to helvetica; non-Latin currency symbols may not render correctly.');
    }

    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const MARGIN = 16;
    const CONTENT_W = W - MARGIN * 2;

    // Strictly monochrome palette — no brand colors, no category colors.
    const INK    = [17, 24, 39];      // near-black text
    const MUTED  = [130, 136, 148];   // secondary gray text
    const FAINT  = [178, 183, 193];   // tertiary gray (hairlines, footers)
    const BORDER = [225, 228, 234];   // very light hairline rules
    const NEG    = [153, 27, 27];     // restrained, desaturated red — used only for negative amounts

    const now = new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });

    /* ── Reusable plain header: no fills, no banner, just type + a rule ── */
    function drawHeader() {
      let ty = 16;

      doc.setFont('NotoSans', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text('L E D G E R   ·   P E R S O N A L   F I N A N C E', MARGIN, ty);

      doc.setFont('NotoSans', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...FAINT);
      doc.text(`Generated ${now}`, W - MARGIN, ty, { align: 'right' });

      ty += 9;
      doc.setFont('NotoSans', 'bold');
      doc.setFontSize(19);
      doc.setTextColor(...INK);
      doc.text(title, MARGIN, ty);

      const rightLabel = userName || '';
      const rightSub = subtitle || period || '';
      if (rightLabel) {
        doc.setFont('NotoSans', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(...INK);
        doc.text(rightLabel, W - MARGIN, ty - 1, { align: 'right' });
      }
      if (rightSub) {
        doc.setFont('NotoSans', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...MUTED);
        doc.text(rightSub, W - MARGIN, ty + (rightLabel ? 4.5 : 0), { align: 'right' });
      }

      ty += 5;
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.5);
      doc.line(MARGIN, ty, W - MARGIN, ty);

      return ty + 9;
    }

    let y = drawHeader();

    /* ── Summary strip: plain figures separated by thin vertical rules ── */
    if (summaryCards.length > 0) {
      y = _drawSummaryStrip(doc, summaryCards, MARGIN, y, CONTENT_W, INK, MUTED, NEG);
      y += 3;
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, y, W - MARGIN, y);
      y += 9;
    }

    /* ── Category breakdown (percentages), shown up top right under the summary ── */
    if (categoryBreakdown && ((categoryBreakdown.spending && categoryBreakdown.spending.length) || (categoryBreakdown.income && categoryBreakdown.income.length))) {
      y = _drawCategoryBreakdownTop(doc, MARGIN, y, CONTENT_W, categoryBreakdown, INK, MUTED, BORDER);
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, y, W - MARGIN, y);
      y += 9;
    }

    /* ── Tables ── */
    for (const table of tables) {
      if (!table.rows || table.rows.length === 0) continue;

      if (!table.hideTitle) {
        doc.setFont('NotoSans', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...MUTED);
        doc.text(String(table.title).toUpperCase(), MARGIN, y);
        y += 5;
      }

      const head = [table.columns.map(c => String(c.label).toUpperCase())];
      const body = table.rows.map(row =>
        table.columns.map(c => {
          const raw = typeof c.value === 'function' ? c.value(row) : (row[c.key] ?? '');
          const prefix = typeof c.prefix === 'function' ? c.prefix(row) : (c.prefix || '');
          return `${prefix}${raw}`;
        })
      );

      const columnStyles = _buildColumnStyles(table.columns);

      doc.autoTable({
        startY: y,
        head,
        body,
        margin: { left: MARGIN, right: MARGIN, bottom: 18 },
        theme: 'plain',
        styles: {
          font: 'NotoSans',
          fontSize: 9,
          cellPadding: { top: 4.5, bottom: 4.5, left: 2, right: 2 },
          textColor: INK,
          lineColor: BORDER,
          lineWidth: { bottom: 0.15 },
          valign: 'middle',
          overflow: 'linebreak',
        },
        headStyles: {
          textColor: MUTED,
          fontStyle: 'bold',
          fontSize: 7.5,
          lineWidth: { bottom: 0.5 },
          lineColor: INK,
          cellPadding: { top: 2, bottom: 3, left: 2, right: 2 },
        },
        columnStyles,
        didParseCell: (data) => {
          if (data.section !== 'body') return;
          const col = table.columns[data.column.index];
          if (!col) return;
          const row = table.rows[data.row.index];
          if (col.negative && typeof col.negative === 'function' && col.negative(row)) {
            data.cell.styles.textColor = NEG;
          }
          if (col.emphasis) data.cell.styles.fontStyle = 'bold';
          // Subtotal/total rows (row.__isTotalRow = true): bold the whole row
          // and give it a hairline top rule, like a statement's subtotal line.
          if (row && row.__isTotalRow) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = INK;
            data.cell.styles.lineWidth = { top: 0.5, bottom: 0.15 };
            data.cell.styles.lineColor = INK;
          }
        },
        didDrawPage: () => { _drawPageFooter(doc, W, H, title, FAINT, BORDER, MARGIN); },
      });

      y = doc.lastAutoTable.finalY + 10;
    }

    _drawPageFooter(doc, W, H, title, FAINT, BORDER, MARGIN);
    doc.save(`${filename}.pdf`);
    Toast.show('PDF exported successfully!', 'success');
  }

  /** Plain figures in a row, separated by thin vertical rules — no boxes, no fills. */
  function _drawSummaryStrip(doc, cards, x0, y, contentW, INK, MUTED, NEG) {
    const slotW = contentW / cards.length;
    let x = x0;

    cards.forEach((card, i) => {
      const centerX = x + slotW / 2;
      const isNeg = !!card.negative;

      doc.setFont('NotoSans', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(...(isNeg ? NEG : INK));
      doc.text(String(card.value), centerX, y + 8, { align: 'center' });

      doc.setFont('NotoSans', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(String(card.label).toUpperCase(), centerX, y + 14, { align: 'center' });

      if (i < cards.length - 1) {
        doc.setDrawColor(225, 228, 234);
        doc.setLineWidth(0.3);
        doc.line(x + slotW, y - 2, x + slotW, y + 15);
      }

      x += slotW;
    });

    return y + 17;
  }

  /** Compact "CATEGORY BREAKDOWN" block shown right under the summary strip
   *  on page 1 — category name + its share of the total as a percentage,
   *  with a dotted leader, same statement styling as the rest of the doc. */
  function _drawCategoryBreakdownTop(doc, MARGIN, y, CONTENT_W, breakdown, INK, MUTED, BORDER) {
    const hasSpending = breakdown.spending && breakdown.spending.length;
    const hasIncome = breakdown.income && breakdown.income.length;
    if (!hasSpending && !hasIncome) return y;

    doc.setFont('NotoSans', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text('CATEGORY BREAKDOWN', MARGIN, y);
    y += 3;
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 8;

    const twoCol = hasSpending && hasIncome;
    const colGap = 10;
    const colW = twoCol ? (CONTENT_W - colGap) / 2 : CONTENT_W;
    const leftX = MARGIN;
    const rightX = MARGIN + colW + colGap;

    const drawList = (x, label, items) => {
      let ry = y;
      if (twoCol) {
        doc.setFont('NotoSans', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...MUTED);
        doc.text(label.toUpperCase(), x, ry);
        ry += 5;
      }
      items.forEach((item) => {
        doc.setFont('NotoSans', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...INK);
        doc.text(String(item.label), x, ry);

        doc.setFont('NotoSans', 'bold');
        const valueText = String(item.value);
        doc.text(valueText, x + colW, ry, { align: 'right' });

        // Dotted leader between label and value, like a table of contents.
        const labelW = doc.getTextWidth(String(item.label));
        const valueW = doc.getTextWidth(valueText);
        const leaderStart = x + labelW + 2;
        const leaderEnd = x + colW - valueW - 2;
        if (leaderEnd > leaderStart) {
          doc.setDrawColor(...BORDER);
          doc.setLineWidth(0.25);
          doc.setLineDashPattern([0.5, 1], 0);
          doc.line(leaderStart, ry - 0.8, leaderEnd, ry - 0.8);
          doc.setLineDashPattern([], 0);
        }
        ry += 6.5;
      });
      return ry;
    };

    let bottomY = y;
    if (hasSpending) bottomY = Math.max(bottomY, drawList(leftX, 'Spending', breakdown.spending));
    if (hasIncome) bottomY = Math.max(bottomY, drawList(twoCol ? rightX : leftX, 'Income', breakdown.income));

    return bottomY + 3;
  }

  /* ─────────────────────────────────────────
     Export Dropdown button builder — CSV + PDF only

     The menu is deliberately NOT nested inside the trigger's card. Every
     .glass card in this app uses `isolation: isolate`, which makes each
     card its own CSS stacking context — so a z-index set on a menu inside
     one card can only ever win against other elements *inside that same
     card*. It can't win against a sibling card later in the page (e.g. the
     transaction list below the Filters card), because that sibling paints
     its whole stacking context on top regardless of the menu's z-index.
     That's what caused the CSV/PDF options to render underneath the list
     below them. Appending the menu straight to <body> and positioning it
     with `position: fixed`, computed from the button's own coordinates,
     sidesteps the problem entirely — it's no longer inside any card's
     stacking context.
  ───────────────────────────────────────── */
  function buildDropdown(containerId, onCsv, onPdf) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div class="export-dropdown">
        <button class="btn btn--primary export-dropdown__trigger" aria-expanded="false">
          <i class="fa-solid fa-file-export"></i> Export
          <i class="fa-solid fa-chevron-down" style="font-size:10px; margin-left:2px;"></i>
        </button>
      </div>`;

    const trigger = container.querySelector('.export-dropdown__trigger');

    const menu = document.createElement('div');
    menu.className = 'export-dropdown__menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <button class="export-dropdown__item" data-export-type="csv" role="menuitem">
        <i class="fa-solid fa-file-csv"></i>
        <span><strong>Export as CSV</strong><em>Spreadsheet data</em></span>
      </button>
      <button class="export-dropdown__item" data-export-type="pdf" role="menuitem">
        <i class="fa-solid fa-file-pdf"></i>
        <span><strong>Export as PDF</strong><em>Clean, printable report</em></span>
      </button>`;
    document.body.appendChild(menu);

    function positionMenu() {
      const r = trigger.getBoundingClientRect();
      const menuW = menu.offsetWidth || 220;
      // Right-align to the button, but keep it on-screen on narrow viewports.
      let left = r.right - menuW;
      left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
      menu.style.top = `${r.bottom + 10}px`;
      menu.style.left = `${left}px`;
      // Caret should still point at the button's center, not the menu's edge.
      const caretX = Math.max(16, Math.min(r.left + r.width / 2 - left - 6, menuW - 28));
      menu.style.setProperty('--caret-x', `${caretX}px`);
    }

    const openMenu = () => {
      positionMenu();
      menu.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      window.addEventListener('scroll', closeMenu, { passive: true, capture: true });
      window.addEventListener('resize', positionMenu);
    };
    const closeMenu = () => {
      menu.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      window.removeEventListener('scroll', closeMenu, { capture: true });
      window.removeEventListener('resize', positionMenu);
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.classList.contains('is-open')) closeMenu(); else openMenu();
    });

    // Click-away and Escape both close it.
    document.addEventListener('click', closeMenu);
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

    menu.querySelector('[data-export-type="csv"]').addEventListener('click', () => { closeMenu(); onCsv(); });
    menu.querySelector('[data-export-type="pdf"]').addEventListener('click', () => { closeMenu(); onPdf(); });
  }

  /* ─────────────────────────────────────────
     Private helpers
  ───────────────────────────────────────── */
  function _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function _loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function _buildColumnStyles(columns) {
    const styles = {};
    columns.forEach((c, i) => {
      if (c.align) styles[i] = { ...(styles[i] || {}), halign: c.align };
      if (c.width) styles[i] = { ...(styles[i] || {}), cellWidth: c.width };
    });
    return styles;
  }

  function _drawPageFooter(doc, W, H, title, FAINT, BORDER, MARGIN) {
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, H - 12, W - MARGIN, H - 12);
      doc.setFont('NotoSans', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...FAINT);
      doc.text('Ledger Personal Finance', MARGIN, H - 7);
      doc.text(`${title} · Page ${i} of ${pageCount}`, W - MARGIN, H - 7, { align: 'right' });
    }
  }

  return { csv, pdf, buildDropdown };
})();

window.Exporter = Exporter;
