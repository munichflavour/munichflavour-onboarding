// Kalkulationskern. Trennt strikt:
//   1. Portionsbedarf der Speise (Modus A bis F)
//   2. Sicherheitspuffer (auf Portionen)
//   3. Zubereitungsverlust (auf Rohware): Einkaufsmenge = Bedarf / (1 - Verlust)
//   4. Zusammenführen je Zutaten-ID
//   5. Gebinderundung (nur Einkaufsliste, fließt nie zurück in die Rezepturberechnung)
// Jeder Schritt schreibt eine Zeile in `weg` (Rechenweg).
const { Decimal, D, convert } = require('./units');

class CalcError extends Error {}

const MODES = ['fest', 'pro_person', 'anteil', 'buffet', 'gramm_pro_person', 'manuell'];

const pct = v => D(v).div(100);

// item: { mode, quantity, perPerson, share (in %), gramsPerPerson, target, consumptionFactor,
//         bufferPct, overridePortions }
// recipe: { refQty, portionGrams? }
// Ergebnis: { portions, weg } mit Portionen inkl. Puffer
function portionsFor(item, guests, recipe) {
  const weg = [];
  const g = guests === undefined || guests === null || guests === '' ? null : D(guests);
  const needGuests = () => { if (g === null) throw new CalcError('Gästezahl fehlt'); return g; };
  const req = (v, name) => { if (v === undefined || v === null || v === '') throw new CalcError(`${name} fehlt`); return D(v); };
  let portions;

  if (item.overridePortions !== undefined && item.overridePortions !== null && item.overridePortions !== '') {
    portions = D(item.overridePortions);
    weg.push(`Manuelle Überschreibung: ${portions} Portionen`);
  } else {
    switch (item.mode) {
      case 'fest':
        portions = req(item.quantity, 'Menge');
        weg.push(`Feste Menge: ${portions} Portionen`);
        break;
      case 'pro_person': {
        const per = req(item.perPerson, 'Portionen pro Person');
        portions = needGuests().times(per);
        weg.push(`${g} Gäste x ${per} je Person = ${portions} Portionen`);
        break;
      }
      case 'anteil': {
        const share = req(item.share, 'Anteil');
        const per = item.perPerson === undefined || item.perPerson === null || item.perPerson === '' ? D(1) : D(item.perPerson);
        portions = needGuests().times(pct(share)).times(per);
        weg.push(`${g} Gäste x ${share} % x ${per} = ${portions} Portionen`);
        break;
      }
      case 'buffet': {
        // Anteile einzelner Buffet-Speisen sind voneinander unabhängig (Summe darf von 100 % abweichen)
        const share = req(item.share, 'Anteil');
        const per = item.perPerson === undefined || item.perPerson === null || item.perPerson === '' ? D(1) : D(item.perPerson);
        portions = needGuests().times(pct(share)).times(per);
        weg.push(`Buffet: ${g} Gäste x ${share} % x ${per} = ${portions} Portionen`);
        break;
      }
      case 'gramm_pro_person': {
        if (!recipe || !recipe.portionGrams) throw new CalcError('Rezeptur hat keine Portionsgröße in Gramm hinterlegt');
        const grams = req(item.gramsPerPerson, 'Gramm pro Person');
        const total = needGuests().times(grams);
        portions = total.div(D(recipe.portionGrams));
        weg.push(`${g} Gäste x ${grams} g = ${total} g; Portionsgröße ${recipe.portionGrams} g => ${portions} Portionen`);
        break;
      }
      case 'manuell':
        portions = req(item.target, 'Zielmenge');
        weg.push(`Manuelle Zielmenge: ${portions} Portionen`);
        break;
      default:
        throw new CalcError(`Unbekannter Kalkulationsmodus: ${item.mode}`);
    }
    if (item.consumptionFactor !== undefined && item.consumptionFactor !== null && item.consumptionFactor !== '') {
      const f = D(item.consumptionFactor);
      portions = portions.times(f);
      weg.push(`Verbrauchsfaktor ${f} => ${portions} Portionen`);
    }
  }

  if (item.bufferPct !== undefined && item.bufferPct !== null && item.bufferPct !== '' && !D(item.bufferPct).isZero()) {
    const b = D(item.bufferPct);
    portions = portions.times(D(1).plus(pct(b)));
    weg.push(`Sicherheitspuffer ${b} % => ${portions} Portionen`);
  }
  if (portions.lt(0)) throw new CalcError('Negative Menge');
  return { portions, weg };
}

// Zutatenbedarf einer Speise: Rezeptur skaliert auf die Portionen.
// recipe: { refQty, items: [{ ingredientId, qty, unit, lossPct?, note? }] }
// ingredients: Map/Objekt id -> { name, baseUnit, lossPct?, densityGPerMl?, discrete? }
// Ergebnis: Liste { ingredientId, qty (in Basiseinheit der Zutat, ROH inkl. Verlust), weg[] }
function ingredientNeeds(recipe, portions, ingredients) {
  const ref = D(recipe.refQty);
  if (ref.lte(0)) throw new CalcError('Referenzmenge der Rezeptur muss größer als 0 sein');
  const factor = portions.div(ref);
  const get = id => (ingredients instanceof Map ? ingredients.get(id) : ingredients[id]);
  return recipe.items.map(it => {
    const ing = get(it.ingredientId);
    if (!ing) throw new CalcError(`Zutat ${it.ingredientId} nicht im Katalog`);
    const weg = [];
    const scaled = D(it.qty).times(factor);
    weg.push(`${ing.name}: ${it.qty} ${it.unit} x Faktor ${factor.toDecimalPlaces(6)} = ${scaled.toDecimalPlaces(6)} ${it.unit}`);
    const rules = { densityGPerMl: ing.densityGPerMl, discrete: ing.discrete };
    let base = convert(scaled, it.unit, ing.baseUnit, rules);
    if (it.unit !== ing.baseUnit) weg.push(`in Basiseinheit ${ing.baseUnit}: ${base.toDecimalPlaces(6)}`);
    // Verlust: Wert der Rezeptzeile hat Vorrang vor dem Standardwert der Zutat
    const lossRaw = it.lossPct !== undefined && it.lossPct !== null && it.lossPct !== '' ? it.lossPct : ing.lossPct;
    if (lossRaw !== undefined && lossRaw !== null && lossRaw !== '' && !D(lossRaw).isZero()) {
      const loss = pct(lossRaw);
      if (loss.gte(1)) throw new CalcError(`Verlust von ${lossRaw} % ist nicht zulässig (${ing.name})`);
      base = base.div(D(1).minus(loss));
      weg.push(`Zubereitungsverlust ${lossRaw} %: / ${D(1).minus(loss)} = ${base.toDecimalPlaces(6)} ${ing.baseUnit}`);
    }
    return { ingredientId: it.ingredientId, qty: base, weg };
  });
}

// Fasst Bedarfe mehrerer Speisen je Zutaten-ID zusammen (Basiseinheit der Zutat).
function aggregate(needs) {
  const sums = new Map();
  for (const n of needs) {
    const cur = sums.get(n.ingredientId) || { ingredientId: n.ingredientId, qty: D(0), weg: [] };
    cur.qty = cur.qty.plus(n.qty);
    cur.weg.push(...n.weg);
    sums.set(n.ingredientId, cur);
  }
  return [...sums.values()];
}

// Gebinderundung. Ergebnis ist nur für die Einkaufsliste bestimmt.
// ingredient: { baseUnit, purchaseUnit, packSize?, densityGPerMl?, discrete? }
function purchaseQuantity(neededBase, ingredient) {
  const rules = { densityGPerMl: ingredient.densityGPerMl, discrete: ingredient.discrete };
  const need = convert(neededBase, ingredient.baseUnit, ingredient.purchaseUnit, rules);
  const weg = [`Bedarf ${need.toDecimalPlaces(4)} ${ingredient.purchaseUnit}`];
  if (!ingredient.packSize || D(ingredient.packSize).lte(0)) {
    weg.push('Kein Gebinde hinterlegt: keine Rundung');
    return { need, packs: null, purchase: need, unit: ingredient.purchaseUnit, weg };
  }
  const size = D(ingredient.packSize);
  const packs = need.div(size).ceil();
  const purchase = packs.times(size);
  weg.push(`Gebinde ${size} ${ingredient.purchaseUnit}: ${packs} Stück => ${purchase} ${ingredient.purchaseUnit}`);
  return { need, packs, purchase, unit: ingredient.purchaseUnit, weg };
}

// Plausibilitätsprüfung für sich gegenseitig ausschließende Menüoptionen (Anteile in %).
function checkExclusiveShares(shares) {
  const sum = shares.reduce((a, s) => a.plus(D(s)), D(0));
  if (!sum.eq(100)) return { ok: false, sum, message: `Anteile ergeben ${sum} % statt 100 %` };
  return { ok: true, sum };
}

module.exports = { CalcError, MODES, portionsFor, ingredientNeeds, aggregate, purchaseQuantity, checkExclusiveShares, Decimal };
