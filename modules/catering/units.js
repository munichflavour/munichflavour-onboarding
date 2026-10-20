// Einheiten und geprüfte Umrechnung. Alle Mengen sind Decimal, nie Float.
//
// Regeln:
//  - Gewicht (g, kg) und Volumen (ml, l) rechnen sich nur innerhalb ihrer Gruppe um.
//  - Gewicht <-> Volumen nur mit hinterlegter Dichte (g pro ml) der Zutat.
//  - Stück und Packung nur mit hinterlegter Regel der Zutat, z. B. { stk: { amount: '50', unit: 'g' } }.
const Decimal = require('decimal.js');

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

const UNITS = {
  g:   { label: 'g',        dim: 'mass',   factor: new Decimal(1) },
  kg:  { label: 'kg',       dim: 'mass',   factor: new Decimal(1000) },
  ml:  { label: 'ml',       dim: 'volume', factor: new Decimal(1) },
  l:   { label: 'l',        dim: 'volume', factor: new Decimal(1000) },
  stk: { label: 'Stück',    dim: 'count' },
  pkg: { label: 'Packung',  dim: 'pack' },
};

class UnitError extends Error {}

const D = v => (Decimal.isDecimal(v) ? v : new Decimal(v));
const isDiscrete = u => UNITS[u].dim === 'count' || UNITS[u].dim === 'pack';

function assertUnit(u) {
  if (!UNITS[u]) throw new UnitError(`Unbekannte Einheit: ${u}`);
}

// rules: { densityGPerMl?: string|Decimal, discrete?: { stk?: {amount, unit}, pkg?: {amount, unit} } }
function convert(value, from, to, rules = {}) {
  assertUnit(from); assertUnit(to);
  const v = D(value);
  if (from === to) return v;

  const f = UNITS[from], t = UNITS[to];
  if (f.dim === t.dim && f.factor) return v.times(f.factor).div(t.factor);

  // diskrete Einheit -> Basismenge laut Regel, dann weiter
  if (isDiscrete(from)) {
    const rule = rules.discrete && rules.discrete[from];
    if (!rule) throw new UnitError(`Keine Umrechnungsregel für ${f.label} hinterlegt`);
    assertUnit(rule.unit);
    if (isDiscrete(rule.unit) && rule.unit === from) throw new UnitError('Ungültige Umrechnungsregel');
    return convert(v.times(D(rule.amount)), rule.unit, to, rules);
  }
  if (isDiscrete(to)) {
    const rule = rules.discrete && rules.discrete[to];
    if (!rule) throw new UnitError(`Keine Umrechnungsregel für ${t.label} hinterlegt`);
    assertUnit(rule.unit);
    return convert(v, from, rule.unit, rules).div(D(rule.amount));
  }

  // Gewicht <-> Volumen
  if (rules.densityGPerMl !== undefined && rules.densityGPerMl !== null && rules.densityGPerMl !== '') {
    const density = D(rules.densityGPerMl);
    if (density.lte(0)) throw new UnitError('Dichte muss größer als 0 sein');
    if (f.dim === 'volume' && t.dim === 'mass') return v.times(f.factor).times(density).div(t.factor);
    if (f.dim === 'mass' && t.dim === 'volume') return v.times(f.factor).div(density).div(t.factor);
  }
  throw new UnitError(`${f.label} lässt sich ohne hinterlegte Umrechnung nicht in ${t.label} umrechnen`);
}

module.exports = { Decimal, UNITS, UnitError, convert, D };
