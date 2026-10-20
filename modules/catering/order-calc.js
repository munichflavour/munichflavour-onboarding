// Bestellrechner für Speisen im Glas.
//
//   Bedarf je Speise   = Gläser x Füllmenge pro Glas (g)
//   Bestellmenge       = Bedarf, aufgerundet auf das Gebinde (Bestellschritt), falls hinterlegt
//   Garnitur je Speise = Gläser x Menge pro Glas
//   Einkaufsliste      = Speisen einzeln, Garnitur über alle Speisen nach Name und Einheit zusammengefasst,
//                        erst danach auf das Gebinde der Garnitur aufgerundet
//
// Fehlende Angaben (Füllmenge, Zuordnung, Garnitur-Menge) werden nie als 0 gerechnet. Sie erzeugen eine
// Warnung und markieren die Bestellung als unvollständig.
const { Decimal, D } = require('./units');
const { num, grams, perGlass } = require('./format');

const ceilTo = (value, step) => value.div(step).ceil().times(step);
const empty = v => v === undefined || v === null || v === '';
const keyOf = (name, unit) => `${String(name).trim().toLowerCase().replace(/\s+/g, ' ')}|${unit}`;

// input: { guests, glassesPerPerson, lines: [{ id, glasses, rentmanName, dish }], garnishOverrides: [{ key, name, qty, unit, note }] }
// garnishOverrides: Vom Benutzer festgelegte Gesamtmenge einer Garnitur für diese Bestellung. Sie ersetzt die berechnete Menge
// (ohne Gebinderundung, der Benutzer legt die Einkaufsmenge fest) und macht auch eine offene Menge pro Glas vollständig.
// dish: { id, name, articleNo, fillGrams, stepGrams, supplierName, garnish: [{ name, qtyPerGlass, unit, packSize, supplierName }] } oder null
function computeOrder({ guests, glassesPerPerson, lines, garnishOverrides = [] }) {
  const overrides = new Map(garnishOverrides.map(o => [o.key, o]));
  const warnings = [];
  const warn = (code, text, lineId) => warnings.push({ code, text, lineId: lineId ?? null });

  let target = null;
  if (!empty(guests) && !empty(glassesPerPerson)) target = D(guests).times(D(glassesPerPerson));
  if (empty(guests)) warn('gaeste', 'Die Gästezahl fehlt.');
  if (empty(glassesPerPerson)) warn('gpp', 'Gläser pro Person sind nicht angegeben.');

  const out = [];
  let total = D(0);
  const shoppingMain = [];
  const garnishAgg = new Map();

  for (const line of lines) {
    const label = line.dish ? line.dish.name : (line.rentmanName || 'Unbenannt');
    const res = { lineId: line.id, rentmanName: line.rentmanName, dishName: line.dish ? line.dish.name : null,
      glasses: null, fillGrams: null, stepGrams: null, needGrams: null, orderGrams: null, supplier: null, garnish: [], complete: true, weg: [] };
    const glasses = empty(line.glasses) ? null : D(line.glasses);
    res.glasses = glasses === null ? null : glasses.toFixed();

    if (glasses === null) { res.complete = false; warn('glaeser', `Für "${label}" fehlt die Anzahl der Gläser.`, line.id); }
    else total = total.plus(glasses);

    if (!line.dish) {
      res.complete = false;
      warn('zuordnung', `Für "${label}" wurde noch keine Speise aus dem Katalog zugeordnet.`, line.id);
    } else {
      const dish = line.dish;
      res.supplier = dish.supplierName || null;
      if (empty(dish.fillGrams)) {
        res.complete = false;
        warn('fuellmenge', `Für "${dish.name}" ist keine Füllmenge pro Glas hinterlegt.`, line.id);
      } else if (glasses !== null) {
        res.fillGrams = D(dish.fillGrams).toFixed();
        res.needGrams = glasses.times(D(dish.fillGrams)).toFixed();
        res.weg.push(`${glasses} Gläser x ${num(dish.fillGrams, 2)} g = ${grams(res.needGrams)}`);
        let order = glasses.times(D(dish.fillGrams));
        if (!empty(dish.stepGrams)) {
          res.stepGrams = D(dish.stepGrams).toFixed();
          order = ceilTo(order, D(dish.stepGrams));
          res.weg.push(`aufgerundet auf Gebinde ${grams(dish.stepGrams)} = ${grams(order)}`);
        } else {
          res.weg.push('kein Gebinde hinterlegt: keine Rundung');
        }
        res.orderGrams = order.toFixed();
        shoppingMain.push({ kind: 'speise', name: dish.name, articleNo: dish.articleNo || null, supplier: dish.supplierName || null, qty: res.orderGrams, unit: 'g',
          need: res.needGrams, packSize: res.stepGrams, open: false, sources: [label] });
      }

      for (const g of dish.garnish || []) {
        const item = { name: g.name, unit: g.unit, qtyPerGlass: empty(g.qtyPerGlass) ? null : D(g.qtyPerGlass).toFixed(), total: null };
        const k = keyOf(g.name, g.unit);
        const ov = overrides.get(k);
        item.overridden = !!ov;
        const agg = garnishAgg.get(k) || { key: k, kind: 'garnitur', name: g.name, supplier: g.supplierName || dish.supplierName || null, unit: g.unit,
          sum: D(0), open: false, unknown: false, packSize: null, sources: [] };
        if (!agg.sources.includes(dish.name)) agg.sources.push(dish.name);
        if (!empty(g.packSize) && agg.packSize === null) agg.packSize = D(g.packSize).toFixed();
        if (item.qtyPerGlass === null) {
          agg.unknown = true;       // Bedarf ist unbekannt, nie als 0 ausweisen
          if (!ov) {      // mit manueller Gesamtmenge ist die offene Menge pro Glas abgedeckt
            agg.open = true;
            res.complete = false;
            warn('garnitur', `Für die Garnitur "${g.name}" bei "${dish.name}" ist die Menge pro Glas offen.`, line.id);
          }
        } else if (glasses !== null) {
          item.total = glasses.times(D(item.qtyPerGlass)).toFixed();
          agg.sum = agg.sum.plus(item.total);
        }
        garnishAgg.set(k, agg);
        res.garnish.push(item);
      }
    }
    out.push(res);
  }

  const usedOverrides = new Set();
  const garnishShopping = [...garnishAgg.values()].map(a => {
    const row = { key: a.key, kind: 'garnitur', name: a.name, supplier: a.supplier, unit: a.unit, need: a.unknown ? null : a.sum.toFixed(), needUnit: a.unit, qty: null,
      packSize: a.packSize, packs: null, open: a.open, sources: a.sources, overridden: false, overrideNote: null };
    const ov = overrides.get(a.key);
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

  for (const o of garnishOverrides) {
    if (!usedOverrides.has(o.key)) warn('override_unbenutzt', `Die manuelle Menge für "${o.name || o.key}" wird nicht verwendet, weil diese Garnitur in der Bestellung nicht mehr vorkommt.`);
  }

  if (target !== null && !total.eq(target)) {
    warn('summe', `Verteilt sind ${total.toFixed()} Gläser, laut ${guests} Gästen x ${num(glassesPerPerson, 2)} Gläser wären es ${num(target, 2)}.`);
  }

  const complete = out.length > 0 && out.every(l => l.complete) && !empty(guests) && !empty(glassesPerPerson);
  return {
    guests: empty(guests) ? null : D(guests).toFixed(),
    glassesPerPerson: empty(glassesPerPerson) ? null : D(glassesPerPerson).toFixed(),
    target: target === null ? null : target.toFixed(),
    totalGlasses: total.toFixed(),
    complete, warnings, lines: out, shopping: [...shoppingMain, ...garnishShopping],
  };
}

// Verteilt `total` Gläser möglichst gleichmäßig auf n Zeilen (Rest auf die ersten Zeilen).
function distributeEvenly(total, n) {
  if (n <= 0) return [];
  const t = Math.round(Number(total));
  const base = Math.floor(t / n);
  const rest = t - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

module.exports = { computeOrder, distributeEvenly, keyOf, Decimal, perGlass };
