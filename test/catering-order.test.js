const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOrder, distributeEvenly, autoSplit, groupBySupplier, keyOf } = require('../modules/catering/order-calc');
const { grams, perGlass } = require('../modules/catering/format');

// Bestellübersicht vom 20.10.: Anzahl Gläser und Gesamtmenge. Füllmenge = Gesamtmenge / Gläser, abgerundet.
const OVERVIEW = [
  { name: 'Schweizer Wurstsalat', glasses: 22, total: 900, fill: 40 },
  { name: 'Pikanter Couscous', glasses: 19, total: 1000, fill: 52 },
  { name: 'Garnelen Coco Ginger', glasses: 26, total: 1000, fill: 38 },
  { name: 'Penne Rucola', glasses: 34, total: 2000, fill: 58 },
  { name: 'Kartoffel-Gurkensalat', glasses: 29, total: 1500, fill: 51 },
];

// Speise mit einer Zutat (der fertige Salat) und optionaler Garnitur; alles bei Kugler, sofern nichts anderes angegeben ist
const ing = (name, qty, step, supplierName = 'Kugler', extra = {}) => ({ name, qtyPerPortion: qty, unit: 'g', packSize: step, supplierName, ...extra });
const dishOf = (o, step, supplier = 'Kugler') => ({ id: o.name, name: o.name, category: 'weckglas', ingredients: [ing(o.name, String(o.fill), step, supplier)], garnish: [] });
const garnitur = (name, qty, unit = 'stk', extra = {}) => ({ name, qtyPerGlass: qty, unit, supplierName: 'Markt', ...extra });

test('Füllmenge = Gesamtmenge / Gläser, abgerundet (Herleitung aus der Bestellübersicht)', () => {
  assert.deepEqual(OVERVIEW.map(o => Math.floor(o.total / o.glasses)), OVERVIEW.map(o => o.fill));
});

test('Mit 100-g-Schritten ergibt die Rechnung genau die Mengen der Bestellübersicht', () => {
  const r = computeOrder({ guests: 50, glassesPerPerson: '2.6',
    lines: OVERVIEW.map(o => ({ id: o.name, glasses: o.glasses, rentmanName: o.name, dish: dishOf(o, '100') })) });
  assert.deepEqual(OVERVIEW.map(o => Number(r.shopping.find(s => s.name === o.name).qty)), OVERVIEW.map(o => o.total));
  assert.equal(r.totalGlasses, '130');
  assert.equal(r.target, '130');
  assert.equal(r.warnings.length, 0);
  assert.equal(r.complete, true);
});

test('Ohne Gebinde wird nicht gerundet', () => {
  const r = computeOrder({ guests: 50, glassesPerPerson: '2.6', lines: [{ id: 1, glasses: 22, rentmanName: 'x', dish: dishOf(OVERVIEW[0], null) }] });
  const s = r.shopping[0];
  assert.equal(s.qty, '880');
  assert.equal(s.packSize, null);
  assert.match(r.lines[0].weg.join(' '), /22 x 40 g = 880 g/);
});

test('Garnitur: Menge pro Portion, zusammengefasst nach Name und Einheit', () => {
  const r = computeOrder({ guests: 50, glassesPerPerson: 2, lines: [
    { id: 1, glasses: 22, rentmanName: 'a', dish: { ...dishOf(OVERVIEW[0], null), garnish: [garnitur('Radieschen', '0.5')] } },
    { id: 2, glasses: 10, rentmanName: 'b', dish: { ...dishOf(OVERVIEW[1], null), garnish: [garnitur('radieschen', '1')] } },
  ] });
  const rad = r.shopping.filter(s => s.kind === 'garnitur');
  assert.equal(rad.length, 1);                       // Schreibweise egal, eine Position
  assert.equal(rad[0].qty, '21');                     // 22 x 0,5 + 10 x 1
  assert.equal(rad[0].sources.length, 2);
});

test('Garnitur: Gebinde wird erst nach dem Zusammenfassen gerundet', () => {
  const g = qty => garnitur('Dill', qty, 'g', { packSize: '50' });
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
    { id: 1, glasses: 26, rentmanName: 'a', dish: { ...dishOf(OVERVIEW[2], '100'), garnish: [garnitur('Dill', null, 'g')] } },
  ] });
  assert.equal(r.complete, false);
  assert.ok(r.warnings.some(w => w.code === 'garnitur'));
  const dill = r.shopping.find(s => s.name === 'Dill');
  assert.equal(dill.open, true);
  assert.equal(dill.qty, null);
});

test('Fehlende Zuordnung, Zutat-Menge und Gästezahl machen die Bestellung unvollständig', () => {
  const r = computeOrder({ guests: null, glassesPerPerson: null, lines: [
    { id: 1, glasses: 5, rentmanName: 'Unbekannt', dish: null },
    { id: 2, glasses: 5, rentmanName: 'b', dish: { id: 9, name: 'Ohne Menge', ingredients: [ing('Ohne Menge', null, null)], garnish: [] } },
  ] });
  assert.equal(r.complete, false);
  const codes = r.warnings.map(w => w.code);
  for (const c of ['gaeste', 'gpp', 'zuordnung', 'zutat']) assert.ok(codes.includes(c), c);
  assert.equal(r.shopping.find(s => s.name === 'Ohne Menge').qty, null);      // keine scheinbar vollständige Menge
});

test('Speise ohne Zutat ist unvollständig', () => {
  const r = computeOrder({ guests: 10, glassesPerPerson: 1, lines: [{ id: 1, glasses: 10, rentmanName: 'a', dish: { id: 1, name: 'Leer', ingredients: [], garnish: [] } }] });
  assert.equal(r.complete, false);
  assert.ok(r.warnings.some(w => w.code === 'keine_zutat'));
});

test('Summe der Gläser weicht vom Soll ab: Warnung, aber kein Fehler', () => {
  const r = computeOrder({ guests: 50, glassesPerPerson: '2.6', lines: [{ id: 1, glasses: 100, rentmanName: 'a', dish: dishOf(OVERVIEW[0], null) }] });
  assert.ok(r.warnings.some(w => w.code === 'summe'));
  assert.equal(r.shopping[0].qty, '4000');
});

test('Bruchteile beim Soll (22 Gäste x 2,6 = 57,2): die gerundete Summe gilt als erreicht', () => {
  const ok = computeOrder({ guests: 22, glassesPerPerson: '2.6', lines: [{ id: 1, glasses: 57, rentmanName: 'a', dish: dishOf(OVERVIEW[0], null) }] });
  assert.ok(!ok.warnings.some(w => w.code === 'summe'));
  const off = computeOrder({ guests: 22, glassesPerPerson: '2.6', lines: [{ id: 1, glasses: 58, rentmanName: 'a', dish: dishOf(OVERVIEW[0], null) }] });
  assert.ok(off.warnings.some(w => w.code === 'summe'));
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
  const dish = { id: 1, name: 'Gambas', category: 'weckglas', ingredients: [ing('Gambas', '38', '1000')], garnish: [garnitur('Dill', null, 'g')] };
  const computed = computeOrder({ guests: 50, glassesPerPerson: 2, lines: [{ id: 1, glasses: 26, rentmanName: 'g', dish }] });
  const dill = computed.shopping.find(s => s.name === 'Dill');
  assert.equal(dill.open, true);
  assert.equal(dill.qty, null);
  const pdf = await renderOrderPdf({ order: { name: 'T', status: 'entwurf' }, computed });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

// ---- Manuelle Garnitur-Menge ----
const gambas = (extra = {}) => ({ id: 1, name: 'Gambas', category: 'weckglas', ingredients: [ing('Gambas', '38', '1000')], garnish: [garnitur('Dill', null, 'g', extra)] });

test('Manuelle Menge ersetzt die berechnete und macht eine offene Garnitur vollständig', () => {
  const base = { guests: 50, glassesPerPerson: 2, lines: [{ id: 1, glasses: 26, rentmanName: 'g', dish: gambas() }] };
  const open = computeOrder(base);
  assert.equal(open.complete, false);
  const withOv = computeOrder({ ...base, garnishOverrides: [{ key: keyOf('Dill', 'g'), name: 'Dill', qty: '1', unit: 'stk', note: '1 Bund' }] });
  assert.equal(withOv.complete, true);                                        // abweichende Portionen-Summe ist nur eine Warnung
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

// ---- Lieferanten ----
test('Ohne Lieferant: Artikel steht unter "Ohne Lieferant", die Bestellung bleibt vollständig', () => {
  const r = computeOrder({ guests: 10, glassesPerPerson: 2, lines: [{ id: 1, glasses: 20, rentmanName: 'a',
    dish: { ...dishOf(OVERVIEW[0], null), garnish: [garnitur('Radieschen', '1', 'stk', { supplierName: null })] } }] });
  assert.equal(r.shopping.find(s => s.name === 'Radieschen').supplier, null);
  assert.equal(r.shopping.find(s => s.name === OVERVIEW[0].name).supplier, 'Kugler');
  const w = r.warnings.find(x => x.code === 'ohne_lieferant');
  assert.ok(w && /Radieschen/.test(w.text) && !/Wurstsalat/.test(w.text));
  assert.equal(r.complete, true);                                           // Hinweis, kein Hindernis (Einkauf z. B. im Supermarkt)
});

test('Garnitur mit eigenem Lieferant steht beim eigenen Lieferanten', () => {
  const r = computeOrder({ guests: 10, glassesPerPerson: 2, lines: [{ id: 1, glasses: 20, rentmanName: 'a',
    dish: { ...dishOf(OVERVIEW[0], null), garnish: [garnitur('Radieschen', '1', 'stk', { supplierName: 'Großmarkt' })] } }] });
  assert.equal(r.shopping.find(s => s.name === 'Radieschen').supplier, 'Großmarkt');
  assert.ok(!r.warnings.some(w => w.code === 'ohne_lieferant'));
  assert.equal(r.complete, true);
});

test('Derselbe Artikel mit verschiedenen Lieferanten wird nicht still zusammengeführt', () => {
  const r = computeOrder({ guests: 10, glassesPerPerson: 2, lines: [
    { id: 1, glasses: 10, rentmanName: 'a', dish: { ...dishOf(OVERVIEW[0], null), garnish: [garnitur('Tomate', '1', 'stk', { supplierName: 'Großmarkt' })] } },
    { id: 2, glasses: 10, rentmanName: 'b', dish: { ...dishOf(OVERVIEW[1], null), garnish: [garnitur('Tomate', '1', 'stk', { supplierName: 'Bauer' })] } },
  ] });
  assert.ok(r.warnings.some(w => w.code === 'lieferant_konflikt' && /Tomate/.test(w.text)));
  assert.equal(r.shopping.find(s => s.name === 'Tomate').qty, '20');       // Menge bleibt zusammen, der Hinweis zeigt den Konflikt
});

test('groupBySupplier: benannte Lieferanten alphabetisch, ohne Lieferant zuletzt, Zutaten vor Garnitur', () => {
  const g = groupBySupplier([
    { name: 'Dill', kind: 'garnitur', supplier: null }, { name: 'Tomate', kind: 'garnitur', supplier: 'Kugler' },
    { name: 'Salat', kind: 'zutat', supplier: 'Kugler' }, { name: 'Radieschen', kind: 'garnitur', supplier: 'Bauer' }, { name: 'Äpfel', kind: 'garnitur', supplier: 'Ägypten Import' },
  ]);
  assert.deepEqual(g.map(x => x.supplier), ['Ägypten Import', 'Bauer', 'Kugler', null]);
  assert.deepEqual(g[2].items.map(i => i.name), ['Salat', 'Tomate']);
  assert.deepEqual(groupBySupplier([]), []);
});

test('Positionen enthalten Portionen und Zusammensetzung für die gemeinsame Liste', () => {
  const r = computeOrder({ guests: 10, glassesPerPerson: 2, lines: [
    { id: 1, glasses: 22, rentmanName: 'a', dish: { ...dishOf({ name: 'A', fill: 40 }, '100'), garnish: [garnitur('Radieschen', '0.5')] } },
    { id: 2, glasses: 10, rentmanName: 'b', dish: { ...dishOf({ name: 'B', fill: 40 }, '100'), garnish: [garnitur('Radieschen', '1')] } },
  ] });
  const a = r.shopping.find(s => s.name === 'A');
  assert.deepEqual(a.parts.map(p => [p.dish, p.glasses, p.qtyPerGlass]), [['A', '22', '40']]);
  const rad = r.shopping.find(s => s.name === 'Radieschen');
  assert.deepEqual(rad.parts.map(p => [p.dish, p.glasses, p.qtyPerGlass]), [['A', '22', '0.5'], ['B', '10', '1']]);
  assert.equal(rad.qty, '21');
});

// ---- Zutaten über mehrere Speisen und Brotzeit ----
const brot = (name, zutaten, garnish = []) => ({ id: name, name, category: 'brotzeit', ingredients: zutaten, garnish });
const stk = (name, qty, packSize, supplierName = 'Bäcker', extra = {}) => ({ name, qtyPerPortion: qty, unit: 'stk', packSize, supplierName, ...extra });

test('Gleiche Zutat bei mehreren Speisen: erst zusammenzählen, dann auf das Gebinde runden', () => {
  const frischkaese = qty => ({ name: 'Frischkäse', qtyPerPortion: qty, unit: 'g', packSize: '200', supplierName: 'Metro' });
  const r = computeOrder({ guests: 20, brotzeitPerPerson: 1, lines: [
    { id: 1, glasses: 10, rentmanName: 'a', dish: brot('Radiserl Frischkäse', [frischkaese('15')]) },     // 150 g
    { id: 2, glasses: 10, rentmanName: 'b', dish: brot('Trüffel Frischkäse', [frischkaese('15')]) },     // 150 g
  ] });
  const fk = r.shopping.filter(s => s.name === 'Frischkäse');
  assert.equal(fk.length, 1);
  assert.equal(fk[0].need, '300');
  assert.equal(fk[0].qty, '400');                    // 2 Gebinde zu 200 g, nicht 2 x aufgerundet auf 200 g
  assert.equal(fk[0].packs, '2');
  assert.equal(fk[0].kind, 'zutat');
  assert.deepEqual(fk[0].sources, ['Radiserl Frischkäse', 'Trüffel Frischkäse']);
});

test('Brotzeit rechnet mit eigenen Portionen pro Person, getrennt von den Gläsern', () => {
  const lines = [
    { id: 1, glasses: 26, rentmanName: 's', dish: dishOf(OVERVIEW[2], '1000') },
    { id: 2, glasses: 20, rentmanName: 'b', dish: brot('Chicken Curry', [stk('Holzofenbrot', '1', '10')]) },
  ];
  const r = computeOrder({ guests: 10, glassesPerPerson: '2.6', brotzeitPerPerson: 2, lines });
  assert.deepEqual(r.categories.map(c => [c.category, c.target, c.total]), [['weckglas', '26', '26'], ['brotzeit', '20', '20']]);
  assert.equal(r.target, '46');
  assert.equal(r.totalGlasses, '46');
  assert.equal(r.shopping.find(s => s.name === 'Holzofenbrot').qty, '20');
  assert.equal(r.complete, true);
  assert.equal(r.warnings.length, 0);
  const noBpp = computeOrder({ guests: 10, glassesPerPerson: '2.6', lines });
  assert.equal(noBpp.complete, false);
  assert.ok(noBpp.warnings.some(w => w.code === 'bpp'));
});

test('Nur Brotzeit: Gläser pro Person werden nicht verlangt', () => {
  const r = computeOrder({ guests: 10, brotzeitPerPerson: 1, lines: [{ id: 1, glasses: 10, rentmanName: 'b', dish: brot('Chicken Curry', [stk('Holzofenbrot', '1', null)]) }] });
  assert.ok(!r.warnings.some(w => w.code === 'gpp'));
  assert.equal(r.complete, true);
});

test('Automatische Verteilung: Gäste x Portionen pro Person gleichmäßig je Speisenart', () => {
  const lines = [{ dish: dishOf(OVERVIEW[0], null) }, { dish: brot('A', []) }, { dish: dishOf(OVERVIEW[1], null) }, { dish: null }, { dish: brot('B', []) }, { dish: brot('C', []) }];
  // 22 Gäste x 3 Gläser = 66 auf 2 Salate, 22 x 2 Brote = 44 auf 3 Brote (15, 15, 14)
  assert.deepEqual(autoSplit({ guests: 22, glassesPerPerson: 3, brotzeitPerPerson: 2, lines }), ['33', '15', '33', null, '15', '14']);
  // fehlende Angaben werden nicht geraten
  assert.deepEqual(autoSplit({ guests: 22, glassesPerPerson: 3, brotzeitPerPerson: null, lines }), ['33', null, '33', null, null, null]);
  assert.deepEqual(autoSplit({ guests: null, glassesPerPerson: 3, brotzeitPerPerson: 2, lines }), lines.map(() => null));
  assert.deepEqual(autoSplit({ guests: 22, glassesPerPerson: '2.6', lines: [{ dish: dishOf(OVERVIEW[0], null) }, { dish: dishOf(OVERVIEW[1], null) }] }), ['29', '28']);   // 57,2 auf 57
});
