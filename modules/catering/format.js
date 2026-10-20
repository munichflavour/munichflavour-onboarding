// Zahlen und Mengen für die Ausgabe (deutsches Format).
const { Decimal, UNITS } = require('./units');

function num(v, maxDecimals = 2) {
  const d = new Decimal(v).toDecimalPlaces(maxDecimals);
  return d.toFixed().replace('.', ',');
}

// Gramm: ab 1000 als kg ("1 kg", "1,5 kg"), sonst "900 g"
function grams(v) {
  const d = new Decimal(v);
  if (d.gte(1000)) return `${num(d.div(1000), 3)} kg`;
  return `${num(d, 1)} g`;
}

const FRACTIONS = { '0.25': '¼', '0.5': '½', '0.75': '¾' };

// Menge pro Glas für die Garnitur: "½", "1", "2", bei Gewicht "5 g"
function perGlass(qty, unit) {
  const d = new Decimal(qty);
  if (unit === 'g' || unit === 'kg' || unit === 'ml' || unit === 'l') return `${num(d, 2)} ${UNITS[unit].label}`;
  const whole = d.floor();
  const frac = FRACTIONS[d.minus(whole).toFixed()];
  if (frac) return whole.isZero() ? frac : `${whole.toFixed()}${frac}`;
  return num(d, 2);
}

// Menge mit Einheit: Gramm als g/kg, sonst "12 Stück"
function qtyUnit(qty, unit) {
  if (unit === 'g') return grams(qty);
  if (unit === 'kg') return `${num(qty, 3)} kg`;
  return `${num(qty, 2)} ${UNITS[unit] ? UNITS[unit].label : unit}`;
}

module.exports = { num, grams, perGlass, qtyUnit };
