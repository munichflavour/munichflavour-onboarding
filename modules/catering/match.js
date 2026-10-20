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

module.exports = { normName, similarity, suggest };
