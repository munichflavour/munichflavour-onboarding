// PDF-Ausgabe (DIN A4): eine vollständige Einkaufsliste, nach Lieferanten aufgeteilt.
// Jeder Lieferant steht auf einer eigenen Seite mit Projektkopf, damit sich jede Seite einzeln weitergeben lässt.
// Unvollständige Bestellungen werden deutlich gekennzeichnet und nie als fertige Liste ausgegeben.
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { num, grams, perGlass, qtyUnit } = require('./format');
const { groupBySupplier } = require('./order-calc');

const M = 40;                       // Seitenrand
const COLOR = { text: '#000', gray: '#666', line: '#ccc', warn: '#cc0000', warnBg: '#fff0f0', note: '#fff4d6' };

const dateDe = v => {
  const d = v ? new Date(v) : null;
  return d && !isNaN(d) ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'ohne Datum';
};

// Woraus sich die Menge zusammensetzt: bei Speisen "22 Gläser x 40 g", bei Garnitur "22 x ½ + 19 x 1"
function detailText(s) {
  if (s.kind === 'speise') {
    if (s.glasses === null || s.glasses === undefined || !s.fillGrams) return '';
    return `${num(s.glasses, 0)} Gläser x ${num(s.fillGrams, 2)} g = ${grams(s.need)}`;
  }
  const known = (s.parts || []).filter(p => p.qtyPerGlass !== null && p.glasses !== null);
  const calc = known.length ? known.map(p => `${num(p.glasses, 0)} x ${perGlass(p.qtyPerGlass, s.unit)}`).join(' + ') : '';
  if (s.overridden) return s.need === null ? 'Menge pro Glas offen' : `berechnet: ${qtyUnit(s.need, s.needUnit || s.unit)}`;
  if (s.open || s.need === null) return 'Menge pro Glas offen';
  return `${calc} = ${qtyUnit(s.need, s.needUnit || s.unit)}`;
}

// order: { name, number, eventDate, status, createdAt }, computed: Ergebnis von computeOrder
function renderOrderPdf({ order, computed, logoPath }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true,
      info: { Title: `Einkaufsliste ${order.name}`, Author: 'Munich Flavour' } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 2 * M;
    const bottom = () => doc.page.height - M - 20;
    const rule = y => doc.moveTo(M, y).lineTo(M + W, y).lineWidth(0.5).strokeColor(COLOR.line).stroke();
    const hasLogo = !!(logoPath && fs.existsSync(logoPath));

    const meta = [
      order.number ? `Nr. ${order.number}` : null,
      `Event: ${dateDe(order.eventDate)}`,
      computed.guests ? `Gäste: ${num(computed.guests, 0)}` : 'Gäste: fehlt',
      computed.glassesPerPerson ? `${num(computed.glassesPerPerson, 2)} Gläser/Person` : null,
      `${num(computed.totalGlasses, 0)} Gläser`,
      `Erstellt: ${dateDe(order.createdAt)}`,
      order.status === 'abgeschlossen' ? 'abgeschlossen' : 'Entwurf',
    ].filter(Boolean).join('   |   ');

    // Kopf einer Seite: Titel, Projekt, Lieferant. `first` zeigt zusätzlich die ausführlichen Hinweise.
    function header(supplierLabel, count, first, cont) {
      let logoH = 0;
      if (hasLogo) { try { doc.image(logoPath, M, M, { fit: [44, 44] }); logoH = 50; } catch { /* Logo ist optional */ } }
      const tx = M + (logoH ? 58 : 0);
      doc.fillColor(COLOR.text).font('Helvetica-Bold').fontSize(18).text('Einkaufsliste', tx, M + 2, { width: W - (tx - M) });
      doc.font('Helvetica').fontSize(10).fillColor(COLOR.gray).text('Munich Flavour', tx, doc.y, { width: W - (tx - M) });
      doc.y = Math.max(doc.y, M + logoH) + 8;
      doc.fillColor(COLOR.text).font('Helvetica-Bold').fontSize(13).text(order.name, M, doc.y, { width: W });
      doc.font('Helvetica').fontSize(8.5).fillColor(COLOR.gray).text(meta, M, doc.y + 2, { width: W });
      doc.moveDown(0.6);

      if (!computed.complete) {
        const h = 22;
        const y = doc.y;
        doc.rect(M, y, W, h).fill(COLOR.warnBg);
        doc.fillColor(COLOR.warn).font('Helvetica-Bold').fontSize(10).text('UNVOLLSTÄNDIG: Diese Liste nicht zum Bestellen verwenden', M + 8, y + 6, { width: W - 16 });
        doc.y = y + h + 8;
      }
      if (first && computed.warnings.length) {
        const items = computed.warnings.slice(0, 12).map(w => `• ${w.text}`);
        if (computed.warnings.length > 12) items.push(`• … und ${computed.warnings.length - 12} weitere Hinweise`);
        const body = items.join('\n');
        doc.font('Helvetica').fontSize(8.5);
        const h = 12 + doc.heightOfString(body, { width: W - 16 });
        const y = doc.y;
        doc.rect(M, y, W, h).fill(COLOR.note);
        doc.fillColor(COLOR.text).font('Helvetica').fontSize(8.5).text(body, M + 8, y + 6, { width: W - 16 });
        doc.y = y + h + 10;
      }
      doc.fillColor(COLOR.text).font('Helvetica-Bold').fontSize(14)
        .text(`${supplierLabel}${cont ? ' (Fortsetzung)' : ''}`, M, doc.y, { width: W, continued: false });
      doc.font('Helvetica').fontSize(9).fillColor(COLOR.gray).text(`${count} Artikel`, M, doc.y, { width: W });
      doc.moveDown(0.4);
    }

    const cols = [{ x: M, w: 18 }, { x: M + 26, w: 168 }, { x: M + 200, w: 92 }, { x: M + 298, w: 120 }, { x: M + 424, w: W - 424 }];
    const tableHead = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.gray);
      ['', 'Artikel', 'Einkaufsmenge', 'Zusammensetzung', 'Bemerkung'].forEach((t, i) => doc.text(t, cols[i].x, y, { width: cols[i].w }));
      doc.y = y + 13; rule(doc.y); doc.y += 5;
    };

    const groups = groupBySupplier(computed.shopping);
    if (!groups.length) groups.push({ supplier: null, items: [] });
    let firstPage = true;

    for (const g of groups) {
      const label = g.supplier || 'Ohne Lieferant';
      if (!firstPage) doc.addPage();
      header(label, g.items.length, firstPage, false);
      firstPage = false;
      tableHead();
      if (!g.items.length) { doc.font('Helvetica').fontSize(10).fillColor(COLOR.gray).text('Noch nichts zu bestellen.', M, doc.y); }

      for (const s of g.items) {
        const sub = [s.articleNo ? `Art.-Nr. ${s.articleNo}` : null,
          s.overridden ? `manuell festgelegt${s.overrideNote ? ': ' + s.overrideNote : ''}` : null,
          s.kind === 'garnitur' && s.sources && s.sources.length ? `für: ${s.sources.join(', ')}` : null].filter(Boolean).join('  |  ');
        const buy = s.qty === null ? 'Menge offen' : qtyUnit(s.qty, s.unit) + (s.packs && s.packSize ? ` (${num(s.packs, 0)} x ${qtyUnit(s.packSize, s.unit)})` : '');
        const label2 = s.kind === 'garnitur' ? `${s.name} (Garnitur)` : s.name;
        const detail = detailText(s);

        doc.font('Helvetica').fontSize(10);
        const labelH = doc.heightOfString(label2, { width: cols[1].w });
        const subH = sub ? doc.fontSize(7.5).heightOfString(sub, { width: cols[1].w }) + 2 : 0;
        const detH = detail ? doc.fontSize(8).heightOfString(detail, { width: cols[3].w }) : 0;
        doc.fontSize(10);
        const h = Math.max(labelH + subH, doc.heightOfString(buy, { width: cols[2].w }), detH, 18) + 8;
        if (doc.y + h > bottom()) { doc.addPage(); header(label, g.items.length, false, true); tableHead(); }

        const y = doc.y;
        doc.lineWidth(1).strokeColor(COLOR.text).rect(cols[0].x, y + 1, 13, 13).stroke();
        doc.fillColor(COLOR.text).font('Helvetica').fontSize(10).text(label2, cols[1].x, y, { width: cols[1].w });
        if (sub) doc.fontSize(7.5).fillColor(COLOR.gray).text(sub, cols[1].x, doc.y, { width: cols[1].w });
        doc.fontSize(10).fillColor(s.qty === null ? COLOR.warn : COLOR.text).font('Helvetica-Bold').text(buy, cols[2].x, y, { width: cols[2].w });
        if (detail) doc.font('Helvetica').fontSize(8).fillColor(COLOR.gray).text(detail, cols[3].x, y + 1, { width: cols[3].w });
        doc.moveTo(cols[4].x, y + 13).lineTo(M + W, y + 13).lineWidth(0.5).strokeColor(COLOR.line).stroke();
        doc.y = y + h - 4; rule(doc.y); doc.y += 4;
      }
    }

    // Fußzeile mit Seitenzahlen
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0;     // Fußzeile liegt im Seitenrand; sonst legt pdfkit eine neue Seite an
      doc.font('Helvetica').fontSize(8).fillColor(COLOR.gray)
        .text(`${order.name}   |   Seite ${i + 1} von ${range.count}`, M, doc.page.height - M + 4, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { renderOrderPdf };
