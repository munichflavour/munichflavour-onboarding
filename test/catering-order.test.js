const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOrder, distributeEvenly, groupBySupplier } = require('../modules/catering/order-calc');
const { grams, perGlass } = require('../modules/catering/format');

// Bestellübersicht vom 20.10.: Anzahl Gläser und Gesamtmenge. Füllmenge = Gesamtmenge / Gläser, abgerundet.
const OVERVIEW = [
  { name: 'Schweizer Wurstsalat', glasses: 22, total: 900, fill: 40 },
  { name: 'Pikanter Couscous', glasses: 19, total: 1000, fill: 52 },
  { name: 'Garnelen Coco Ginger', glasses: 26, total: 1000, fill: 38 },
  { name: 'Penne Rucola', glasses: 34, total: 2000, fill: 58 },
  { name: 'Kartoffel-Gurkensalat', glasses: 29, total: 1500, fill: 51 },
];

const dishOf = (o, step) => ({ id: o.name, name: o.name, fillGrams: String(o.fill), stepGrams: step, supplierName: 'Kugler', garnish: [] });

test('Füllmenge = Gesamtmenge / Gläser, abgerundet (Herleitung aus der Bestellübersicht)', () => {
  assert.deepEqual(OVERVIEW.map(o => Math.floor(o.total / o.glasses)), OVERVIEW.map(o => o.fill));
});

test('Mit 100-g-Schritten ergibt die Rechnung genau die Mengen der Bestellübersicht', () => {
  const r = computeOrder({ guests: 50, glassesPerPerson: '2.6',
    lines: OVERVIEW.map(o => ({ id: o.name, glasses: o.glasses, rentmanName: o.name, dish: dishOf(o, '100') })) });
  assert.deepEqual(r.lines.map(l => Number(l.orderGrams)), OVERVIEW.map(o => o.total));
  assert.equal(r.totalGlasses, '130');
  assert.equal(r.target, '130');
  assert.equal(r.warnings.length, 0);
  assert.equal(r.complete, true);
});

test('Ohne Gebinde wird nicht gerundet und das so ausgewiesen', () => {
  const r = computeOrder({ guests: 50, glassesPerPerson: '2.6', lines: [{ id: 1, glasses: 22, rentmanName: 'x', dish: dishOf(OVERVIEW[0], null) }] });
  assert.equal(r.lines[0].orderGrams, '880');
  assert.match(r.lines[0].weg.join(' '), /keine Rundung/);
});

test('Garnitur: Menge pro Glas, zusammengefasst nach Name und Einheit', () => {
  const garnishA = { name: 'Radieschen', qtyPerGlass: '0.5', unit: 'stk' };
  const garnishB = { name: 'radieschen', qtyPerGlass: '1', unit: 'stk' };
  const r = computeOrder({ guests: 50, glassesPerPerson: 2, lines: [
    { id: 1, glasses: 22, rentmanName: 'a', dish: { ...dishOf(OVERVIEW[0], null), garnish: [garnishA] } },
    { id: 2, glasses: 10, rentmanName: 'b', dish: { ...dishOf(OVERVIEW[1], null), garnish: [garnishB] } },
  ] });
  const rad = r.shopping.filter(s => s.kind === 'garnitur');
  assert.equal(rad.length, 1);                       // Schreibweise egal, eine Position
  assert.equal(rad[0].qty, '21');                     // 22 x 0,5 + 10 x 1
  assert.equal(rad[0].sources.length, 2);
});

test('Garnitur: Gebinde wird erst nach dem Zusammenfassen gerundet', () => {
  const g = (qty) => ({ name: 'Dill', qtyPerGlass: qty, unit: 'g', packSize: '50' });
  const r = computeOrder({ guests: 1, glassesPerPerson: 1, lines: [
    { id: 1, glasses: 10, rentmanName: 'a', dish: { ...dishOf(OVERVIEW[0], null), garnish: [g('2')] } },    // 20 g
    { id: 2, glasses: 10, rentmanName: 'b', dish: { ...dishOf(OVERVIEW[1], null), garnish: [g('2')] } },    // 20 g
  ] });
  const dill = r.shopping.find(s => s.name === 'Dill');
  assert.equal(dill.need, '40');
  assert.equal(dill.qty, '50');                       // ein Gebinde, nicht zwei
  assert.equal(dill.packs, '1');
});

test('Offene Garnitur-Menge wird nicht als 0 gerechnet, Bestellung gilt als unvollständig', () => {
  const r = computeOrder({ guests: 50, glassesPerPerson: 2, lines: [
    { id: 1, glasses: 26, rentmanName: 'a', dish: { ...dishOf(OVERVIEW[2], '100'), garnish: [{ name: 'Dill', qtyPerGlass: null, unit: 'g' }] } },
  ] });
  assert.equal(r.complete, false);
  assert.ok(r.warnings.some(w => w.code === 'garnitur'));
  const dill = r.shopping.find(s => s.name === 'Dill');
  assert.equal(dill.open, true);
  assert.equal(dill.qty, null);
});

test('Fehlende Zuordnung, Füllmenge und Gästezahl machen die Bestellung unvollständig', () => {
  const r = computeOrder({ guests: null, glassesPerPerson: null, lines: [
    { id: 1, glasses: 5, rentmanName: 'Unbekannt', dish: null },
    { id: 2, glasses: 5, rentmanName: 'b', dish: { id: 9, name: 'Ohne Menge', fillGrams: null, stepGrams: null, garnish: [] } },
  ] });
  assert.equal(r.complete, false);
  const codes = r.warnings.map(w => w.code);
  for (const c of ['gaeste', 'gpp', 'zuordnung', 'fuellmenge']) assert.ok(codes.includes(c), c);
  assert.equal(r.lines[1].orderGrams, null);          // keine scheinbar vollständige Menge
});

test('Summe der Gläser weicht vom Soll ab: Warnung, aber kein Fehler', () => {
  const r = computeOrder({ guests: 50, glassesPerPerson: '2.6', lines: [{ id: 1, glasses: 100, rentmanName: 'a', dish: dishOf(OVERVIEW[0], null) }] });
  assert.ok(r.warnings.some(w => w.code === 'summe'));
  assert.equal(r.lines[0].orderGrams, '4000');
});

test('Gleichmäßig verteilen: Rest auf die ersten Zeilen, Summe bleibt erhalten', () => {
  assert.deepEqual(distributeEvenly(130, 5), [26, 26, 26, 26, 26]);
  assert.deepEqual(distributeEvenly(131, 5), [27, 26, 26, 26, 26]);
  assert.equal(distributeEvenly(97, 6).reduce((a, b) => a + b, 0), 97);
  assert.deepEqual(distributeEvenly(10, 0), []);
});

test('Formatierung wie in der Bestellübersicht', () => {
  assert.equal(grams(900), '900 g');
  assert.equal(grams(1000), '1 kg');
  assert.equal(grams(1500), '1,5 kg');
  assert.equal(grams(2000), '2 kg');
  assert.equal(perGlass('0.5', 'stk'), '½');
  assert.equal(perGlass('1', 'stk'), '1');
  assert.equal(perGlass('2', 'stk'), '2');
  assert.equal(perGlass('1.5', 'stk'), '1½');
});

test('PDF: offene Garnitur-Menge erscheint nie als 0', async () => {
  const { renderOrderPdf } = require('../modules/catering/pdf');
  const dish = { id: 1, name: 'Gambas', fillGrams: '38', stepGrams: '1000', garnish: [{ name: 'Dill', qtyPerGlass: null, unit: 'g' }] };
  const computed = computeOrder({ guests: 50, glassesPerPerson: 2, lines: [{ id: 1, glasses: 26, rentmanName: 'g', dish }] });
  const dill = computed.shopping.find(s => s.name === 'Dill');
  assert.equal(dill.open, true);
  assert.equal(dill.qty, null);
  const pdf = await renderOrderPdf({ order: { name: 'T', status: 'entwurf' }, computed });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

// ---- Manuelle Garnitur-Menge ----
const { keyOf } = require('../modules/catering/order-calc');
const gambas = (extra = {}) => ({ id: 1, name: 'Gambas', fillGrams: '38', stepGrams: '1000', garnish: [{ name: 'Dill', qtyPerGlass: null, unit: 'g', ...extra }] });

test('Manuelle Menge ersetzt die berechnete und macht eine offene Garnitur vollständig', () => {
  const base = { guests: 50, glassesPerPerson: 2, lines: [{ id: 1, glasses: 26, rentmanName: 'g', dish: gambas() }] };
  const open = computeOrder(base);
  assert.equal(open.complete, false);
  const withOv = computeOrder({ ...base, garnishOverrides: [{ key: keyOf('Dill', 'g'), name: 'Dill', qty: '1', unit: 'stk', note: '1 Bund' }] });
  assert.equal(withOv.complete, true);                                        // abweichende Gläser-Summe ist nur eine Warnung
  assert.ok(!withOv.warnings.some(w => w.code === 'garnitur'));               // offene Menge ist abgedeckt
  const dill = withOv.shopping.find(s => s.name === 'Dill');
  assert.equal(dill.qty, '1');
  assert.equal(dill.unit, 'stk');
  assert.equal(dill.overridden, true);
  assert.equal(dill.overrideNote, '1 Bund');
  assert.equal(dill.open, false);
  assert.equal(dill.need, null);                                              // berechneter Wert unbekannt, nicht 0
});

test('Manuelle Menge überschreibt eine berechnete Menge ohne Gebinderundung', () => {
  const dish = gambas({ qtyPerGlass: '2', packSize: '50' });
  const calc1 = computeOrder({ guests: 26, glassesPerPerson: 1, lines: [{ id: 1, glasses: 26, rentmanName: 'g', dish }] });
  assert.equal(calc1.shopping.find(s => s.name === 'Dill').qty, '100');        // 52 g, aufgerundet auf 2 x 50 g
  const ov = computeOrder({ guests: 26, glassesPerPerson: 1, lines: [{ id: 1, glasses: 26, rentmanName: 'g', dish }],
    garnishOverrides: [{ key: keyOf('Dill', 'g'), name: 'Dill', qty: '60', unit: 'g' }] });
  const dill = ov.shopping.find(s => s.name === 'Dill');
  assert.equal(dill.qty, '60');                                                // genau die festgelegte Menge
  assert.equal(dill.need, '52');                                               // berechneter Wert bleibt sichtbar
  assert.equal(dill.packs, null);
  assert.equal(ov.complete, true);
});

test('Manuelle Menge ohne passende Garnitur erzeugt einen Hinweis statt still zu verschwinden', () => {
  const r = computeOrder({ guests: 10, glassesPerPerson: 1, lines: [{ id: 1, glasses: 10, rentmanName: 'g', dish: { ...gambas(), garnish: [] } }],
    garnishOverrides: [{ key: keyOf('Dill', 'g'), name: 'Dill', qty: '1', unit: 'stk' }] });
  assert.ok(r.warnings.some(w => w.code === 'override_unbenutzt'));
  assert.ok(!r.shopping.some(s => s.name === 'Dill'));
});

test('Garnitur-Schlüssel ist unabhängig von Groß-/Kleinschreibung', () => {
  assert.equal(keyOf('Dill', 'g'), keyOf('  dill ', 'g'));
  assert.notEqual(keyOf('Dill', 'g'), keyOf('Dill', 'stk'));
});

// ---- Aufteilung nach Lieferanten ----
const withSupplier = (name, supplier, garnish = []) => ({ id: name, name, fillGrams: '40', stepGrams: '100', supplierName: supplier, garnish });

test('Garnitur bekommt nicht still den Lieferanten der Speise', () => {
  const r = computeOrder({ guests: 10, glassesPerPerson: 2, lines: [{ id: 1, glasses: 20, rentmanName: 'a',
    dish: withSupplier('Wurstsalat', 'Kugler', [{ name: 'Radieschen', qtyPerGlass: '1', unit: 'stk' }]) }] });
  assert.equal(r.shopping.find(s => s.name === 'Radieschen').supplier, null);
  assert.equal(r.shopping.find(s => s.name === 'Wurstsalat').supplier, 'Kugler');
  const w = r.warnings.find(x => x.code === 'ohne_lieferant');
  assert.ok(w && /Radieschen/.test(w.text) && !/Wurstsalat/.test(w.text));
  assert.equal(r.complete, true);                                           // Hinweis, kein Hindernis
});

test('Garnitur mit eigenem Lieferant steht beim eigenen Lieferanten', () => {
  const r = computeOrder({ guests: 10, glassesPerPerson: 2, lines: [{ id: 1, glasses: 20, rentmanName: 'a',
    dish: withSupplier('Wurstsalat', 'Kugler', [{ name: 'Radieschen', qtyPerGlass: '1', unit: 'stk', supplierName: 'Großmarkt' }]) }] });
  assert.equal(r.shopping.find(s => s.name === 'Radieschen').supplier, 'Großmarkt');
  assert.ok(!r.warnings.some(w => w.code === 'ohne_lieferant'));
});

test('Dieselbe Garnitur mit verschiedenen Lieferanten wird nicht still zusammengeführt', () => {
  const r = computeOrder({ guests: 10, glassesPerPerson: 2, lines: [
    { id: 1, glasses: 10, rentmanName: 'a', dish: withSupplier('A', 'Kugler', [{ name: 'Tomate', qtyPerGlass: '1', unit: 'stk', supplierName: 'Großmarkt' }]) },
    { id: 2, glasses: 10, rentmanName: 'b', dish: withSupplier('B', 'Kugler', [{ name: 'Tomate', qtyPerGlass: '1', unit: 'stk', supplierName: 'Bauer' }]) },
  ] });
  assert.ok(r.warnings.some(w => w.code === 'lieferant_konflikt' && /Tomate/.test(w.text)));
  assert.equal(r.shopping.find(s => s.name === 'Tomate').qty, '20');       // Menge bleibt zusammen, der Hinweis zeigt den Konflikt
});

test('groupBySupplier: benannte Lieferanten alphabetisch, ohne Lieferant zuletzt, Speisen vor Garnitur', () => {
  const g = groupBySupplier([
    { name: 'Dill', kind: 'garnitur', supplier: null }, { name: 'Tomate', kind: 'garnitur', supplier: 'Kugler' },
    { name: 'Salat', kind: 'speise', supplier: 'Kugler' }, { name: 'Radieschen', kind: 'garnitur', supplier: 'Bauer' }, { name: 'Äpfel', kind: 'garnitur', supplier: 'Ägypten Import' },
  ]);
  assert.deepEqual(g.map(x => x.supplier), ['Ägypten Import', 'Bauer', 'Kugler', null]);
  assert.deepEqual(g[2].items.map(i => i.name), ['Salat', 'Tomate']);
  assert.deepEqual(groupBySupplier([]), []);
});

test('Positionen enthalten Gläser und Zusammensetzung für die gemeinsame Liste', () => {
  const r = computeOrder({ guests: 10, glassesPerPerson: 2, lines: [
    { id: 1, glasses: 22, rentmanName: 'a', dish: withSupplier('A', 'Kugler', [{ name: 'Radieschen', qtyPerGlass: '0.5', unit: 'stk', supplierName: 'Markt' }]) },
    { id: 2, glasses: 10, rentmanName: 'b', dish: withSupplier('B', 'Kugler', [{ name: 'Radieschen', qtyPerGlass: '1', unit: 'stk', supplierName: 'Markt' }]) },
  ] });
  const a = r.shopping.find(s => s.name === 'A');
  assert.equal(a.glasses, '22');
  assert.equal(a.fillGrams, '40');
  const rad = r.shopping.find(s => s.name === 'Radieschen');
  assert.deepEqual(rad.parts.map(p => [p.dish, p.glasses, p.qtyPerGlass]), [['A', '22', '0.5'], ['B', '10', '1']]);
  assert.equal(rad.qty, '21');
});
