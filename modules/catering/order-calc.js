// Bestellrechner für Speisen (Salate im Glas, Brotzeit).
//
//   Eine Speise besteht aus Zutaten (Einkaufsartikel pro Portion) und Garnituren (Deko pro Portion).
//   Beide können einen Lieferanten haben; ohne Lieferant stehen sie unter "Ohne Lieferant".
//
//   Bedarf je Zeile    = Portionen x Menge pro Portion
//   Einkaufsliste      = Zutaten und Garnituren über alle Speisen nach Name und Einheit zusammengefasst,
//                        erst danach auf das Gebinde aufgerundet (falls hinterlegt)
//   Portionen          = Gäste x Portionen pro Person, getrennt für Gläser und Brotzeit
//
// Fehlende Angaben (Menge, Zuordnung, Lieferant) werden nie als 0 gerechnet. Sie erzeugen eine
// Warnung und markieren die Bestellung als unvollständig.
const { Decimal, D } = require('./units');
const { num, perGlass, qtyUnit } = require('./format');

const ceilTo = (value, step) => value.div(step).ceil().times(step);
const empty = v => v === undefined || v === null || v === '';
const keyOf = (name, unit) => `${String(name).trim().toLowerCase().replace(/\s+/g, ' ')}|${unit}`;

// Speisenarten: Anzeigename der Portion und das Feld der Bestellung mit den Portionen pro Person
const CATEGORIES = {
  weckglas: { label: 'Gläser', perPersonLabel: 'Gläser pro Person', field: 'glassesPerPerson', warn: 'gpp' },
  brotzeit: { label: 'Brote', perPersonLabel: 'Brote pro Person', field: 'brotzeitPerPerson', warn: 'bpp' },
};
const categoryOf = dish => (dish && dish.category) || 'weckglas';

// input: { guests, glassesPerPerson, brotzeitPerPerson, lines: [{ id, glasses, rentmanName, dish }], garnishOverrides: [{ key, name, qty, unit, note }] }
// glasses = Portionen der Zeile (Gläser oder Brote).
// garnishOverrides: Vom Benutzer festgelegte Gesamtmenge einer Garnitur für diese Bestellung. Sie ersetzt die berechnete Menge
// (ohne Gebinderundung, der Benutzer legt die Einkaufsmenge fest) und macht auch eine offene Menge pro Portion vollständig.
// dish: { id, name, category, ingredients: [{ name, qtyPerPortion, unit, packSize, articleNo, supplierName }],
//         garnish: [{ name, qtyPerGlass, unit, packSize, supplierName }] } oder null
function computeOrder(input) {
  const { guests, lines, garnishOverrides = [] } = input;
  const perPersonOf = cat => input[CATEGORIES[cat].field];
  const overrides = new Map(garnishOverrides.map(o => [o.key, o]));
  const warnings = [];
  const warn = (code, text, lineId) => warnings.push({ code, text, lineId: lineId ?? null });

  if (empty(guests)) warn('gaeste', 'Die Gästezahl fehlt.');

  // Welche Speisenarten kommen vor? Ohne zugeordnete Speise gilt die Angabe für Gläser als nötig.
  let present = [...new Set(lines.filter(l => l.dish).map(l => categoryOf(l.dish)))].filter(c => CATEGORIES[c]);
  if (!present.length) present = Object.keys(CATEGORIES).filter(c => !empty(perPersonOf(c)));
  if (!present.length) present = ['weckglas'];
  for (const c of present) {
    if (empty(perPersonOf(c))) warn(CATEGORIES[c].warn, `${CATEGORIES[c].perPersonLabel} sind nicht angegeben.`);
  }

  const out = [];
  const totals = Object.fromEntries(Object.keys(CATEGORIES).map(c => [c, D(0)]));
  const agg = new Map();           // Zutaten und Garnituren, nach Name und Einheit

  const addPart = (kind, item, dish, portions, lineId, res) => {
    const qtyField = kind === 'zutat' ? item.qtyPerPortion : item.qtyPerGlass;
    const k = keyOf(item.name, item.unit);
    const supplier = item.supplierName || null;
    const ov = kind === 'garnitur' ? overrides.get(k) : null;
    const qtyPer = empty(qtyField) ? null : D(qtyField).toFixed();
    const a = agg.get(k) || { key: k, kind, name: item.name, articleNo: null, supplier, unit: item.unit,
      sum: D(0), open: false, unknown: false, packSize: null, sources: [], parts: [] };
    if (kind === 'zutat') a.kind = 'zutat';        // kommt der Artikel auch als Zutat vor, gilt er als Zutat
    if (!a.articleNo && item.articleNo) a.articleNo = item.articleNo;
    if (!a.sources.includes(dish.name)) a.sources.push(dish.name);
    a.parts.push({ dish: dish.name, glasses: portions === null ? null : portions.toFixed(), qtyPerGlass: qtyPer });
    // Derselbe Artikel bei Speisen mit verschiedenen Lieferanten wird nicht still zusammengeführt
    if (supplier !== a.supplier && !a.conflict) {
      a.conflict = true;
      warn('lieferant_konflikt', `Der Artikel "${item.name}" hat bei verschiedenen Speisen unterschiedliche Lieferanten (${a.supplier || 'keiner'} und ${supplier || 'keiner'}). Es gilt: ${a.supplier || 'ohne Lieferant'}.`, lineId);
    }
    if (!empty(item.packSize) && a.packSize === null) a.packSize = D(item.packSize).toFixed();
    if (qtyPer === null) {
      a.unknown = true;            // Bedarf ist unbekannt, nie als 0 ausweisen
      if (!ov) {                   // mit manueller Gesamtmenge ist die offene Menge abgedeckt
        a.open = true;
        res.complete = false;
        warn(kind === 'zutat' ? 'zutat' : 'garnitur',
          `Für ${kind === 'zutat' ? 'die Zutat' : 'die Garnitur'} "${item.name}" bei "${dish.name}" ist die Menge pro Portion offen.`, lineId);
      }
    } else if (portions !== null) {
      const total = portions.times(D(qtyPer));
      a.sum = a.sum.plus(total);
      if (kind === 'zutat') res.weg.push(`${item.name}: ${portions.toFixed()} x ${perGlass(qtyPer, item.unit)} = ${qtyUnit(total.toFixed(), item.unit)}`);
    }
    agg.set(k, a);
    return { name: item.name, unit: item.unit, qtyPerGlass: qtyPer, overridden: !!ov };
  };

  for (const line of lines) {
    const label = line.dish ? line.dish.name : (line.rentmanName || 'Unbenannt');
    const cat = categoryOf(line.dish);
    const res = { lineId: line.id, rentmanName: line.rentmanName, dishName: line.dish ? line.dish.name : null, category: line.dish ? cat : null,
      glasses: null, garnish: [], complete: true, weg: [] };
    const portions = empty(line.glasses) ? null : D(line.glasses);
    res.glasses = portions === null ? null : portions.toFixed();

    if (portions === null) {
      res.complete = false;
      warn('glaeser', `Für "${label}" fehlt die Anzahl der ${line.dish && CATEGORIES[cat] ? CATEGORIES[cat].label : 'Portionen'}.`, line.id);
    } else if (CATEGORIES[cat]) totals[cat] = totals[cat].plus(portions);

    if (!line.dish) {
      res.complete = false;
      warn('zuordnung', `Für "${label}" wurde noch keine Speise aus dem Katalog zugeordnet.`, line.id);
    } else {
      const dish = line.dish;
      const ingredients = dish.ingredients || [];
      if (!ingredients.length) {
        res.complete = false;
        warn('keine_zutat', `Für "${dish.name}" ist keine Zutat hinterlegt.`, line.id);
      }
      for (const ing of ingredients) addPart('zutat', ing, dish, portions, line.id, res);
      for (const g of dish.garnish || []) res.garnish.push(addPart('garnitur', g, dish, portions, line.id, res));
    }
    out.push(res);
  }

  const usedOverrides = new Set();
  const shopping = [...agg.values()].map(a => {
    const row = { key: a.key, kind: a.kind, name: a.name, articleNo: a.articleNo, supplier: a.supplier, unit: a.unit, need: a.unknown ? null : a.sum.toFixed(), needUnit: a.unit,
      qty: null, packSize: a.packSize, packs: null, open: a.open, sources: a.sources, parts: a.parts, overridden: false, overrideNote: null };
    const ov = a.kind === 'garnitur' ? overrides.get(a.key) : null;
    if (ov) {
      usedOverrides.add(a.key);
      row.qty = D(ov.qty).toFixed();
      row.unit = ov.unit;
      row.packSize = null;
      row.open = false;
      row.overridden = true;
      row.overrideNote = ov.note || null;
      return row;
    }
    if (!a.open || a.sum.gt(0)) {
      let q = a.sum;
      if (a.packSize) { q = ceilTo(q, D(a.packSize)); row.packs = q.div(D(a.packSize)).toFixed(); }
      row.qty = q.toFixed();
    }
    return row;
  });

  const ohne = shopping.filter(x => !x.supplier);
  if (ohne.length) warn('ohne_lieferant', `Für ${ohne.length === 1 ? '1 Artikel' : ohne.length + ' Artikel'} ist noch kein Lieferant festgelegt: ${ohne.map(x => x.name).join(', ')}. Sie stehen unter "Ohne Lieferant" (Hinweis, kein Hindernis).`);

  for (const o of garnishOverrides) {
    if (!usedOverrides.has(o.key)) warn('override_unbenutzt', `Die manuelle Menge für "${o.name || o.key}" wird nicht verwendet, weil diese Garnitur in der Bestellung nicht mehr vorkommt.`);
  }

  // Soll-Portionen je Speisenart; bei Bruchteilen (z. B. 22 Gäste x 2,6) gilt die gerundete Zahl als erreicht
  const categories = present.map(c => {
    const pp = perPersonOf(c);
    const target = !empty(guests) && !empty(pp) ? D(guests).times(D(pp)) : null;
    const total = totals[c];
    if (target !== null && !total.eq(target) && !total.eq(target.toDecimalPlaces(0))) {
      warn('summe', `Verteilt sind ${total.toFixed()} ${CATEGORIES[c].label}, laut ${guests} Gästen x ${num(pp, 2)} wären es ${num(target, 2)}.`);
    }
    return { category: c, label: CATEGORIES[c].label, perPersonLabel: CATEGORIES[c].perPersonLabel, perPerson: empty(pp) ? null : D(pp).toFixed(),
      target: target === null ? null : target.toFixed(), total: total.toFixed() };
  });
  const targets = categories.map(c => c.target);
  const target = targets.length && targets.every(t => t !== null) ? targets.reduce((s, t) => s.plus(t), D(0)).toFixed() : null;
  const totalPortions = Object.values(totals).reduce((s, t) => s.plus(t), D(0));

  const complete = out.length > 0 && out.every(l => l.complete) && !empty(guests) && categories.every(c => c.perPerson !== null);
  return {
    guests: empty(guests) ? null : D(guests).toFixed(),
    glassesPerPerson: empty(input.glassesPerPerson) ? null : D(input.glassesPerPerson).toFixed(),
    brotzeitPerPerson: empty(input.brotzeitPerPerson) ? null : D(input.brotzeitPerPerson).toFixed(),
    target, totalGlasses: totalPortions.toFixed(), categories,
    complete, warnings, lines: out, shopping,
  };
}

// Teilt die Einkaufsliste nach Lieferant auf: benannte Lieferanten alphabetisch, "ohne Lieferant" zuletzt.
// Innerhalb eines Lieferanten stehen zuerst die Zutaten, dann die Garnitur.
function groupBySupplier(shopping) {
  const map = new Map();
  for (const it of shopping) {
    const k = it.supplier || '';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  const rank = it => (it.kind === 'zutat' ? 0 : 1);
  return [...map.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'de')))
    .map(([k, items]) => ({ supplier: k || null, items: items.slice().sort((x, y) => rank(x) - rank(y)) }));
}

// Verteilt `total` Portionen möglichst gleichmäßig auf n Zeilen (Rest auf die ersten Zeilen).
function distributeEvenly(total, n) {
  if (n <= 0) return [];
  const t = Math.round(Number(total));
  const base = Math.floor(t / n);
  const rest = t - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

// Automatische Verteilung: Gäste x Portionen pro Person je Speisenart, gleichmäßig auf die Zeilen dieser Art.
// lines: [{ dish }] in Reihenfolge; Ergebnis: Portionen je Zeile (Text) oder null, wenn nicht berechenbar.
function autoSplit({ guests, glassesPerPerson, brotzeitPerPerson, lines }) {
  const pp = { weckglas: glassesPerPerson, brotzeit: brotzeitPerPerson };
  const result = lines.map(() => null);
  for (const cat of Object.keys(CATEGORIES)) {
    const idx = lines.map((l, i) => (l.dish && categoryOf(l.dish) === cat ? i : -1)).filter(i => i >= 0);
    if (!idx.length || empty(guests) || empty(pp[cat])) continue;
    const parts = distributeEvenly(D(guests).times(D(pp[cat])).toDecimalPlaces(0).toNumber(), idx.length);
    idx.forEach((i, k) => { result[i] = String(parts[k]); });
  }
  return result;
}

module.exports = { computeOrder, distributeEvenly, autoSplit, groupBySupplier, keyOf, categoryOf, CATEGORIES, Decimal, perGlass };
