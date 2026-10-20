// PDF-Ausgabe (DIN A4): "Bestellübersicht" (Anzahl, Gericht, Menge, Garnitur) und "Einkaufsliste" nach Lieferant.
// Unvollständige Bestellungen werden deutlich gekennzeichnet und nie als fertige Liste ausgegeben.
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { num, grams, perGlass, qtyUnit } = require('./format');

const M = 40;                       // Seitenrand
const COLOR = { text: '#000', gray: '#666', line: '#ccc', warn: '#cc0000', warnBg: '#fff0f0', note: '#fff4d6' };

const dateDe = v => {
  const d = v ? new Date(v) : null;
  return d && !isNaN(d) ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'ohne Datum';
};

function garnishText(line) {
  return line.garnish.map(g => (g.qtyPerGlass === null ? `${g.name} (Menge offen)` : `${perGlass(g.qtyPerGlass, g.unit)} ${g.name}`)).join(' & ');
}

// order: { name, number, eventDate, status, createdAt, updatedAt }, computed: Ergebnis von computeOrder
function renderOrderPdf({ order, computed, kind, logoPath }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true,
      info: { Title: `${kind === 'einkauf' ? 'Einkaufsliste' : 'Bestellübersicht'} ${order.name}`, Author: 'Munich Flavour' } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 2 * M;
    const bottom = () => doc.page.height - M - 20;
    const ensure = h => { if (doc.y + h > bottom()) doc.addPage(); };

    // Kopf
    let headerH = 0;
    if (logoPath && fs.existsSync(logoPath)) {
      try { doc.image(logoPath, M, M, { fit: [48, 48] }); headerH = 54; } catch { /* Logo ist optional */ }
    }
    doc.fillColor(COLOR.text).font('Helvetica-Bold').fontSize(20)
      .text(kind === 'einkauf' ? 'Einkaufsliste' : 'Bestellübersicht', M + (headerH ? 62 : 0), M + 2, { width: W - (headerH ? 62 : 0) });
    doc.font('Helvetica').fontSize(11).fillColor(COLOR.gray).text('Munich Flavour', M + (headerH ? 62 : 0), doc.y, { width: W - 62 });
    doc.y = Math.max(doc.y, M + headerH) + 10;

    doc.fillColor(COLOR.text).font('Helvetica-Bold').fontSize(14).text(order.name, M, doc.y, { width: W });
    const meta = [
      order.number ? `Nr. ${order.number}` : null,
      `Event: ${dateDe(order.eventDate)}`,
      computed.guests ? `Gäste: ${num(computed.guests, 0)}` : 'Gäste: fehlt',
      computed.glassesPerPerson ? `${num(computed.glassesPerPerson, 2)} Gläser/Person` : null,
      `Erstellt: ${dateDe(order.createdAt)}`,
      order.status === 'abgeschlossen' ? 'abgeschlossen' : 'Entwurf',
    ].filter(Boolean).join('   |   ');
    doc.font('Helvetica').fontSize(9).fillColor(COLOR.gray).text(meta, M, doc.y + 2, { width: W });
    doc.moveDown(0.8);

    // Hinweise: unvollständig = rot, sonst gelb
    if (computed.warnings.length) {
      const items = computed.warnings.slice(0, 12).map(w => `• ${w.text}`);
      if (computed.warnings.length > 12) items.push(`• … und ${computed.warnings.length - 12} weitere Hinweise`);
      const head = computed.complete ? 'Hinweise' : 'UNVOLLSTÄNDIG: Diese Liste nicht zum Bestellen verwenden';
      const body = items.join('\n');
      doc.font('Helvetica-Bold').fontSize(10);
      const h = 14 + doc.heightOfString(head, { width: W - 16 }) + doc.font('Helvetica').fontSize(9).heightOfString(body, { width: W - 16 });
      ensure(h + 10);
      const y = doc.y;
      doc.rect(M, y, W, h).fill(computed.complete ? COLOR.note : COLOR.warnBg);
      doc.fillColor(computed.complete ? COLOR.text : COLOR.warn).font('Helvetica-Bold').fontSize(10).text(head, M + 8, y + 7, { width: W - 16 });
      doc.fillColor(COLOR.text).font('Helvetica').fontSize(9).text(body, M + 8, doc.y + 2, { width: W - 16 });
      doc.y = y + h + 12;
    }

    const rule = y => doc.moveTo(M, y).lineTo(M + W, y).lineWidth(0.5).strokeColor(COLOR.line).stroke();

    if (kind !== 'einkauf') {
      // ---- Bestellübersicht ----
      const cols = [{ x: M, w: 55, align: 'right' }, { x: M + 70, w: 175 }, { x: M + 255, w: 70 }, { x: M + 335, w: W - 335 }];
      const head = () => {
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR.text);
        ['Anzahl', 'Gericht', 'Menge', 'Garnitur / Beilage'].forEach((t, i) => doc.text(t, cols[i].x, y, { width: cols[i].w, align: cols[i].align || 'left' }));
        doc.y = y + 16; rule(doc.y); doc.y += 6;
      };
      ensure(60); head();
      for (const l of computed.lines) {
        const name = l.dishName || l.rentmanName || 'Unbenannt';
        const gt = garnishText(l);
        doc.font('Helvetica').fontSize(11);
        const h = Math.max(doc.heightOfString(name, { width: cols[1].w }), doc.heightOfString(gt || ' ', { width: cols[3].w }), 14) + 8;
        if (doc.y + h > bottom()) { doc.addPage(); head(); }
        const y = doc.y;
        doc.fillColor(COLOR.text);
        doc.text(l.glasses === null ? '?' : `${num(l.glasses, 0)}×`, cols[0].x, y, { width: cols[0].w, align: 'right' });
        doc.text(name, cols[1].x, y, { width: cols[1].w });
        doc.fillColor(l.orderGrams === null ? COLOR.warn : COLOR.text).text(l.orderGrams === null ? 'offen' : grams(l.orderGrams), cols[2].x, y, { width: cols[2].w });
        doc.fillColor(COLOR.text).text(gt, cols[3].x, y, { width: cols[3].w });
        doc.y = y + h - 4; rule(doc.y); doc.y += 4;
      }
      ensure(30);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.text).text(`${num(computed.totalGlasses, 0)}×`, cols[0].x, doc.y + 4, { width: cols[0].w, align: 'right' });
      doc.text('Gesamt', cols[1].x, doc.y - 13, { width: cols[1].w });
      if (computed.target !== null) doc.font('Helvetica').fontSize(9).fillColor(COLOR.gray)
        .text(`Soll laut Gästezahl: ${num(computed.target, 2)}`, cols[3].x, doc.y - 12, { width: cols[3].w });
      doc.y += 14;
    } else {
      // ---- Einkaufsliste nach Lieferant ----
      const groups = new Map();
      computed.shopping.forEach(s => { const k = s.supplier || 'Ohne Lieferant'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); });
      const cols = [{ x: M, w: 18 }, { x: M + 26, w: 170 }, { x: M + 205, w: 95 }, { x: M + 310, w: 85 }, { x: M + 405, w: W - 405 }];
      const head = () => {
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.gray);
        ['', 'Artikel', 'Einkaufsmenge', 'Bedarf', 'Bemerkung'].forEach((t, i) => doc.text(t, cols[i].x, y, { width: cols[i].w }));
        doc.y = y + 13; rule(doc.y); doc.y += 5;
      };
      for (const [supplier, items] of groups) {
        ensure(70);
        doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR.text).text(supplier, M, doc.y, { width: W });
        doc.moveDown(0.3); head();
        for (const s of items) {
          const sources = [s.articleNo ? `Art.-Nr. ${s.articleNo}` : null, s.sources && s.sources.length && s.kind === 'garnitur' ? `für: ${s.sources.join(', ')}` : null].filter(Boolean).join('  |  ');
          const buy = s.qty === null ? 'Menge offen' : qtyUnit(s.qty, s.unit) + (s.packs && s.packSize ? ` (${num(s.packs, 0)} × ${qtyUnit(s.packSize, s.unit)})` : '');
          const label = s.kind === 'garnitur' ? `${s.name} (Garnitur)` : s.name;
          doc.font('Helvetica').fontSize(10);
          const h = Math.max(doc.heightOfString(label, { width: cols[1].w }) + (sources ? 10 : 0), doc.heightOfString(buy, { width: cols[2].w }), 18) + 8;
          if (doc.y + h > bottom()) { doc.addPage(); head(); }
          const y = doc.y;
          doc.lineWidth(1).strokeColor(COLOR.text).rect(cols[0].x, y + 1, 13, 13).stroke();
          doc.fillColor(COLOR.text).font('Helvetica').fontSize(10).text(label, cols[1].x, y, { width: cols[1].w });
          if (sources) doc.fontSize(7.5).fillColor(COLOR.gray).text(sources, cols[1].x, doc.y, { width: cols[1].w });
          doc.fontSize(10).fillColor(s.qty === null ? COLOR.warn : COLOR.text).font('Helvetica-Bold').text(buy, cols[2].x, y, { width: cols[2].w });
          doc.font('Helvetica').fillColor(COLOR.gray).text(s.need === null || s.unit === undefined ? '' : qtyUnit(s.need, s.unit), cols[3].x, y, { width: cols[3].w });
          doc.moveTo(cols[4].x, y + 13).lineTo(M + W, y + 13).lineWidth(0.5).strokeColor(COLOR.line).stroke();
          doc.y = y + h - 4; rule(doc.y); doc.y += 4;
        }
        doc.moveDown(0.8);
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
