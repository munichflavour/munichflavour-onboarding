// Serverseitige Eingabeprüfung. Alle Fehler werden als ApiError mit verständlicher deutscher Meldung geworfen.
const { Decimal, UNITS } = require('./units');

class ApiError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const bad = (msg, extra) => new ApiError(400, msg, extra);

const isEmpty = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function str(v, label, { required = false, max = 200 } = {}) {
  if (isEmpty(v)) {
    if (required) throw bad(`${label} fehlt.`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw bad(`${label} ist ungültig.`);
  const s = String(v).trim();
  if (s.length > max) throw bad(`${label} ist zu lang (höchstens ${max} Zeichen).`);
  return s;
}

// Dezimalzahl als String ("1,5" und "1.5" sind erlaubt). Gibt normalisierten String ohne Exponent zurück.
function dec(v, label, { required = false, min, minExclusive, max, maxExclusive } = {}) {
  if (isEmpty(v)) {
    if (required) throw bad(`${label} fehlt.`);
    return null;
  }
  let s = String(v).trim().replace(/\s/g, '');
  if (!s.includes('.')) s = s.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s) || s.length > 20) throw bad(`${label} ist keine gültige Zahl.`);
  const d = new Decimal(s);
  if (min !== undefined && d.lt(min)) throw bad(`${label} darf nicht kleiner als ${min} sein.`);
  if (minExclusive !== undefined && d.lte(minExclusive)) throw bad(`${label} muss größer als ${minExclusive} sein.`);
  if (max !== undefined && d.gt(max)) throw bad(`${label} darf nicht größer als ${max} sein.`);
  if (maxExclusive !== undefined && d.gte(maxExclusive)) throw bad(`${label} muss kleiner als ${maxExclusive} sein.`);
  return d.toFixed();
}

function unit(v, label = 'Einheit', { required = true, only } = {}) {
  if (isEmpty(v)) {
    if (required) throw bad(`${label} fehlt.`);
    return null;
  }
  if (!UNITS[v]) throw bad(`${label} ist unbekannt (erlaubt: ${Object.keys(UNITS).join(', ')}).`);
  if (only && !only.includes(v)) throw bad(`${label} muss eine von ${only.join(', ')} sein.`);
  return v;
}

function id(v, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad(`${label} ist ungültig.`);
  return n;
}

function bool(v) { return v === true || v === 1 || v === '1' || v === 'true'; }

// Umrechnungsregeln für Stück/Packung: { stk: { amount, unit }, pkg: { amount, unit } }
function discreteRules(v) {
  if (isEmpty(v)) return null;
  let obj = v;
  if (typeof v === 'string') { try { obj = JSON.parse(v); } catch { throw bad('Umrechnungsregeln sind ungültig.'); } }
  if (typeof obj !== 'object' || Array.isArray(obj)) throw bad('Umrechnungsregeln sind ungültig.');
  const out = {};
  for (const k of Object.keys(obj)) {
    if (!['stk', 'pkg'].includes(k)) throw bad('Umrechnungsregeln gibt es nur für Stück und Packung.');
    const r = obj[k] || {};
    if (isEmpty(r.amount) && isEmpty(r.unit)) continue;
    out[k] = { amount: dec(r.amount, 'Menge der Umrechnungsregel', { required: true, minExclusive: 0 }),
               unit: unit(r.unit, 'Einheit der Umrechnungsregel') };
    if (out[k].unit === k) throw bad('Eine Einheit kann nicht auf sich selbst verweisen.');
  }
  return Object.keys(out).length ? out : null;
}

module.exports = { ApiError, bad, isEmpty, str, dec, unit, id, bool, discreteRules };
