// Namensabgleich Rentman-Zeile <-> Speise. Ähnlichkeit erzeugt nur VORSCHLÄGE, nie eine Zuordnung.
// Zugeordnet wird nur über bestätigte Namen (catering_dish_aliases).

// Normalisiert: Kleinbuchstaben, ohne Anführungszeichen und führenden Strich, Satzzeichen als Leerzeichen
const normName = s => String(s || '').toLowerCase()
  .replace(/[„“”"'`´‚‘’]/g, '')
  .replace(/^[\s\-–—•]+/, '')
  .replace(/[^a-z0-9äöüß\s]/g, ' ')
  .replace(/\s+/g, ' ').trim();

function bigrams(s) {
  const t = s.replace(/\s/g, '');
  const m = new Map();
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
  return m;
}

// Dice-Koeffizient über Zeichenpaare, 0 bis 1
function similarity(a, b) {
  const x = bigrams(normName(a)), y = bigrams(normName(b));
  let inter = 0, nx = 0, ny = 0;
  x.forEach(v => { nx += v; });
  y.forEach(v => { ny += v; });
  x.forEach((v, k) => { if (y.has(k)) inter += Math.min(v, y.get(k)); });
  return nx + ny === 0 ? 0 : (2 * inter) / (nx + ny);
}

// Bester Vorschlag unter den Speisen (Mindestähnlichkeit 0,5), sonst null
function suggest(name, dishes, minScore = 0.5) {
  let best = null;
  for (const d of dishes) {
    const score = similarity(name, d.name);
    if (score >= minScore && (!best || score > best.score)) best = { dishId: d.id, name: d.name, score: Math.round(score * 100) / 100 };
  }
  return best;
}

// Eindeutige automatische Zuordnung einer Rentman-Zeile zu einer Speise des Katalogs:
//   1. Der Name stimmt (nach Normalisierung) genau überein, oder
//   2. der Katalogname steht am Anfang des Rentman-Namens (ganze Wörter), z. B. Katalog "Kartoffel-Gurken-Salat" und
//      Rentman "Kartoffel-Gurken-Salat mit Fleischpflanzerl".
// Gibt es dabei mehr als einen Treffer, wird NICHT automatisch zugeordnet (dann bleibt es bei einem Vorschlag).
function autoMatch(name, dishes) {
  const n = normName(name);
  if (!n) return null;
  const exact = dishes.filter(d => normName(d.name) === n);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const prefix = dishes.filter(d => { const dn = normName(d.name); return dn && n.startsWith(dn + ' '); });
  return prefix.length === 1 ? prefix[0] : null;
}

module.exports = { normName, similarity, suggest, autoMatch };
