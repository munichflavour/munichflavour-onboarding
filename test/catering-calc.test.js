const test = require('node:test');
const assert = require('node:assert/strict');
const { convert, UnitError } = require('../modules/catering/units');
const calc = require('../modules/catering/calc');

const eq = (d, s) => assert.equal(d.toString(), s);

test('Einheiten: kg/g und l/ml', () => {
  eq(convert('1', 'kg', 'g'), '1000');
  eq(convert('250', 'ml', 'l'), '0.25');
  eq(convert('0.1', 'kg', 'g'), '100');           // keine Float-Fehler
});

test('Einheiten: Gewicht <-> Volumen nur mit Dichte', () => {
  assert.throws(() => convert('1', 'l', 'kg'), UnitError);
  eq(convert('1', 'l', 'kg', { densityGPerMl: '0.9' }), '0.9');
  eq(convert('900', 'g', 'l', { densityGPerMl: '0.9' }), '1');
});

test('Einheiten: Stück/Packung nur mit Regel', () => {
  assert.throws(() => convert('3', 'stk', 'g'), UnitError);
  eq(convert('3', 'stk', 'g', { discrete: { stk: { amount: '60', unit: 'g' } } }), '180');
  eq(convert('120', 'g', 'stk', { discrete: { stk: { amount: '60', unit: 'g' } } }), '2');
  eq(convert('2', 'pkg', 'stk', { discrete: { pkg: { amount: '10', unit: 'stk' } } }), '20');
});

test('Unbekannte Einheit wird abgelehnt', () => {
  assert.throws(() => convert('1', 'xx', 'g'), UnitError);
});

test('Modus A: feste Menge', () => {
  eq(calc.portionsFor({ mode: 'fest', quantity: 120 }, null).portions, '120');
});

test('Modus B: Portionen pro Person', () => {
  eq(calc.portionsFor({ mode: 'pro_person', perPerson: 2 }, 100).portions, '200');
});

test('Modus C: Anteil der Gäste', () => {
  eq(calc.portionsFor({ mode: 'anteil', share: 40 }, 120).portions, '48');
});

test('Modus D: Buffet, Anteile unabhängig', () => {
  eq(calc.portionsFor({ mode: 'buffet', share: 60 }, 100).portions, '60');
  eq(calc.portionsFor({ mode: 'buffet', share: 80 }, 100).portions, '80');
});

test('Modus E: Gramm pro Person', () => {
  // 100 Gäste x 200 g = 20 kg; Portionsgröße 200 g => 100 Portionen
  eq(calc.portionsFor({ mode: 'gramm_pro_person', gramsPerPerson: 200 }, 100, { portionGrams: 200 }).portions, '100');
  assert.throws(() => calc.portionsFor({ mode: 'gramm_pro_person', gramsPerPerson: 200 }, 100, {}), calc.CalcError);
});

test('Modus F: manuelle Zielmenge, Überschreibung hat Vorrang', () => {
  eq(calc.portionsFor({ mode: 'manuell', target: 33 }, null).portions, '33');
  eq(calc.portionsFor({ mode: 'pro_person', perPerson: 2, overridePortions: 7 }, 100).portions, '7');
});

test('Gästezahl fehlt wird gemeldet, nicht geraten', () => {
  assert.throws(() => calc.portionsFor({ mode: 'pro_person', perPerson: 2 }, null), calc.CalcError);
});

test('Sicherheitspuffer: 100 Portionen + 10 % = 110', () => {
  eq(calc.portionsFor({ mode: 'fest', quantity: 100, bufferPct: 10 }, null).portions, '110');
});

const obazda = {
  refQty: 10,
  items: [
    { ingredientId: 1, qty: '1000', unit: 'g' },
    { ingredientId: 2, qty: '300', unit: 'g' },
  ],
};
const ingredients = {
  1: { name: 'Camembert (Testdaten)', baseUnit: 'g', purchaseUnit: 'kg', packSize: '1' },
  2: { name: 'Frischkäse (Testdaten)', baseUnit: 'g', purchaseUnit: 'kg', packSize: '0.2' },
};

test('Rezeptur: 50 statt 10 Portionen = Faktor 5', () => {
  const needs = calc.ingredientNeeds(obazda, calc.portionsFor({ mode: 'fest', quantity: 50 }, null).portions, ingredients);
  eq(needs[0].qty, '5000');
  eq(needs[1].qty, '1500');
});

test('Zubereitungsverlust: 10 kg essbar bei 20 % Verlust => 12,5 kg Einkauf', () => {
  const rez = { refQty: 1, items: [{ ingredientId: 3, qty: '10', unit: 'kg', lossPct: '20' }] };
  const ing = { 3: { name: 'Kartoffeln', baseUnit: 'g', purchaseUnit: 'kg', packSize: '5' } };
  const [need] = calc.ingredientNeeds(rez, calc.portionsFor({ mode: 'fest', quantity: 1 }, null).portions, ing);
  eq(need.qty, '12500');
  const p = calc.purchaseQuantity(need.qty, ing[3]);
  eq(p.need, '12.5');
  eq(p.packs, '3');
  eq(p.purchase, '15');       // Gebinderundung auf 5-kg-Gebinde
});

test('Verlust von 100 % oder mehr ist ungültig', () => {
  const rez = { refQty: 1, items: [{ ingredientId: 3, qty: '1', unit: 'kg', lossPct: '100' }] };
  assert.throws(() => calc.ingredientNeeds(rez, calc.portionsFor({ mode: 'fest', quantity: 1 }, null).portions,
    { 3: { name: 'X', baseUnit: 'g' } }), calc.CalcError);
});

test('Zusammenführen: gleiche Zutaten-ID aus zwei Gerichten', () => {
  const a = [{ ingredientId: 7, qty: new calc.Decimal('2000'), weg: [] }];
  const b = [{ ingredientId: 7, qty: new calc.Decimal('1500'), weg: [] }, { ingredientId: 8, qty: new calc.Decimal('1'), weg: [] }];
  const sum = calc.aggregate([...a, ...b]);
  assert.equal(sum.length, 2);
  eq(sum.find(s => s.ingredientId === 7).qty, '3500');
});

test('Gebinderundung ohne Gebinde rundet nicht', () => {
  const p = calc.purchaseQuantity(new calc.Decimal('2300'), { baseUnit: 'g', purchaseUnit: 'kg' });
  eq(p.purchase, '2.3');
  assert.equal(p.packs, null);
});

test('Ausschließende Menüoptionen: Anteile müssen 100 % ergeben', () => {
  assert.equal(calc.checkExclusiveShares([60, 40]).ok, true);
  assert.equal(calc.checkExclusiveShares([60, 30]).ok, false);
});
