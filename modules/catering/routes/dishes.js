// Speisenkatalog: Zutaten und Garnituren (jeweils mit optionalem Lieferant), Speisenart, bestätigte Rentman-Namen.
const express = require('express');
const V = require('../validate');
const { ApiError } = V;
const { normName } = require('../match');

const CATEGORIES = ['weckglas', 'brotzeit', 'dessert'];   // Desserts werden später berechnet
const GARNISH_UNITS = ['g', 'kg', 'ml', 'l', 'stk', 'pkg', 'bund', 'hscheibe'];
const uniqueViolation = e => e && e.code === 'SQLITE_CONSTRAINT_UNIQUE';
const conflictChanged = () => new ApiError(409, 'Diese Speise wurde zwischenzeitlich von jemand anderem geändert. Bitte neu laden und die Änderung erneut vornehmen.');

function loadDish(db, id) {
  const d = db.prepare('SELECT * FROM catering_dishes WHERE id = ?').get(id);
  if (!d) return null;
  const ingredients = db.prepare(`SELECT i.*, s.name AS supplier_name FROM catering_dish_ingredients i LEFT JOIN catering_suppliers s ON s.id = i.supplier_id
    WHERE i.dish_id = ? ORDER BY i.sort, i.id`).all(id);
  const garnish = db.prepare(`SELECT g.*, s.name AS supplier_name FROM catering_dish_garnish g LEFT JOIN catering_suppliers s ON s.id = g.supplier_id
    WHERE g.dish_id = ? ORDER BY g.sort, g.id`).all(id);
  const aliases = db.prepare('SELECT alias FROM catering_dish_aliases WHERE dish_id = ? ORDER BY alias').all(id).map(a => a.alias);
  const dish = {
    id: d.id, name: d.name, category: d.category, note: d.note, archived: !!d.archived, rev: d.rev, aliases,
    ingredients: ingredients.map(i => ({ id: i.id, name: i.name, qtyPerPortion: i.qty_per_portion, unit: i.unit, packSize: i.pack_size, articleNo: i.article_no,
      supplierId: i.supplier_id, supplierName: i.supplier_name })),
    garnish: garnish.map(g => ({ id: g.id, name: g.name, qtyPerGlass: g.qty_per_glass, unit: g.unit, packSize: g.pack_size, supplierId: g.supplier_id, supplierName: g.supplier_name })),
  };
  dish.missingSupplier = [...dish.ingredients, ...dish.garnish].some(x => !x.supplierId);   // nur zur Anzeige
  return dish;
}

// Beispieldaten: Namen, Artikelnummern und Gebinde laut Kugler-Shop (kugler.de, abgerufen am 20.10.2026), Füllmengen aus der
// Bestellübersicht vom 20.10.2026 zurückgerechnet (Gesamtmenge geteilt durch Gläser, abgerundet). Als Gebinde (Bestellschritt)
// ist das Hauptgebinde eingetragen, mit dem die Mengen der Bestellübersicht exakt aufgehen. Weitere Gebinde stehen in der Bemerkung.
// Die Menge der Garnitur ist nur dort eingetragen, wo sie bekannt ist (Radieschen, Cherrytomate, Tomate, Fleischpflanzerl).
const note = (fill, gebinde) => `${fill ? 'Füllmenge aus der Bestellübersicht vom 20.10.2026 zurückgerechnet, bitte prüfen. ' : 'Füllmenge noch nicht bekannt. '}`
  + `Kugler-Shop (Stand 20.10.2026): ${gebinde}. Eingetragen ist das Hauptgebinde als Bestellschritt.`;
const EXAMPLE_DISHES = [
  { name: 'Wurstsalat "Schweizer Art"', articleNo: '3271', fillGrams: '40', stepGrams: '900', garnish: [{ name: 'Radieschen', qtyPerGlass: '0.5', unit: 'stk' }],
    note: note(true, 'Gebinde 900 g (Art. 3271), Becher ca. 410 g, Becher ca. 210 g') },
  { name: 'Pikanter Couscous-Salat', articleNo: '4310', fillGrams: '52', stepGrams: '1000', garnish: [{ name: 'Cherrytomate', qtyPerGlass: '1', unit: 'stk' }],
    note: note(true, 'Gebinde 1000 g (Art. 4310), Gebinde 500 g (Art. 4319), Gebinde 270 g') },
  { name: 'Gambas "Coco-Ginger"', articleNo: '6741', fillGrams: '38', stepGrams: '1000', garnish: [{ name: 'Dill', qtyPerGlass: null, unit: 'g' }],
    note: note(true, 'Gebinde 1000 g (Art. 6741), Becher ca. 570 g, Becher ca. 370 g') },
  { name: 'Penne "Rucola"', articleNo: '360', fillGrams: '58', stepGrams: '1000', garnish: [{ name: 'Rucola', qtyPerGlass: null, unit: 'g' }, { name: 'Tomate', qtyPerGlass: '0.5', unit: 'stk' }],
    note: note(true, 'Gebinde 1000 g (Art. 360), Becher ca. 530 g, Gebinde 270 g') },
  { name: 'Kartoffel-Gurken-Salat', articleNo: '3591', fillGrams: '51', stepGrams: '1500', garnish: [{ name: 'Mini-Fleischpflanzerl am Spieß', qtyPerGlass: '1', unit: 'stk' }],
    note: note(true, 'Gebinde 1500 g (Art. 3591), Gebinde 5000 g, Becher ca. 550 g, Becher ca. 350 g') },
];

// Brotzeit Hausbau (Event vom 20.10.2026): Rezepte aus der ausgefüllten Excel-Datei des Betriebs, Menge pro halber Brotscheibe.
// Einkaufsmengen für 155 halbe Scheiben (50 Gäste) geteilt durch die Scheiben je Brot, auf 0,1 g abgerundet, damit die Rückrechnung
// nie mehr Packungen ergibt als gekauft wurden. Packungsgrößen und Artikelnummern laut Betrieb.
const BROT = { name: 'Schwabinger Doppelkruste', qtyPerPortion: '1', unit: 'hscheibe', packSize: '31', supplier: 'Bäckerei Wimmer' };
const kug = (name, qty, articleNo, pack = '1000') => ({ name, qtyPerPortion: qty, unit: 'g', packSize: pack, articleNo, supplier: 'Kugler' });
const metro = (name, qty, pack, unit = 'g') => ({ name, qtyPerPortion: qty, unit, packSize: pack, supplier: 'METRO' });
const EXAMPLE_BROTZEIT = [
  { name: 'Rucola-Parmaschinken', ingredients: [BROT, kug('Rucolafrischkäsezubereitung', '40', '3080'), metro('Parmaschinken', '8', '200')],
    garnish: [metro('Rucola', '6', '150'), metro('Porree-Sprossen', '2', '100')] },
  { name: 'Chicken Curry', ingredients: [BROT, kug('DeliSpread Chicken-Curry', '50', '7680')], garnish: [metro('Rote-Bete-Sprossen', '2.5', '100')] },
  { name: 'Radiserl Frischkäse', ingredients: [BROT, kug('Radiserlfrischkäsezubereitung', '40', '2520')],
    garnish: [metro('Radieschen', '0.04', '1', 'bund'), metro('Radieschen-Microgreens', '4', '100')] },
  { name: 'Trüffel Frischkäse', ingredients: [BROT, kug('Trüffelfrischkäsezubereitung', '40', '4350'), metro('Trüffel (Scheiben)', '4', '100')],
    garnish: [metro('Porree-Sprossen', '2', '100')] },
  { name: 'Lachs-Meerrettich', ingredients: [BROT, kug('Lachsfrischkäsezubereitung', '33.3', '1100'), metro('Frischer Lachs', '10', '150')], garnish: [metro('Dill', '2', '200')] },
  { name: 'Basilikum-Avocado', ingredients: [BROT, kug('DeliSpread Basilikum', '16.6', '299', '500'), metro('Avocado', '0.2', null, 'stk')],
    garnish: [metro('Rote-Bete-Sprossen', '1.6', '100')] },
];

function createDishesRouter(db, audit) {
  const r = express.Router();

  // Der Lieferant ist freiwillig: Artikel ohne Lieferant stehen auf der Einkaufsliste unter "Ohne Lieferant" (z. B. Einkauf im Supermarkt)
  const supplierOf = (v, where) => {
    if (V.isEmpty(v)) return null;
    const id = V.id(v, `${where}: Lieferant`);
    if (!db.prepare('SELECT 1 FROM catering_suppliers WHERE id = ?').get(id)) throw V.bad(`${where}: Den Lieferanten gibt es nicht.`);
    return id;
  };

  function parseBody(b) {
    const name = V.str(b.name, 'Name der Speise', { required: true, max: 120 });
    const category = V.str(b.category, 'Speisenart') || 'weckglas';
    if (!CATEGORIES.includes(category)) throw V.bad('Die Speisenart ist unbekannt.');
    const note = V.str(b.note, 'Bemerkung', { max: 1000 });
    const aliasList = Array.isArray(b.aliases) ? b.aliases : [];
    if (aliasList.length > 30) throw V.bad('Zu viele Rentman-Namen (höchstens 30).');
    const aliases = [...new Set(aliasList.map(a => normName(V.str(a, 'Rentman-Name', { max: 160 }) || '')).filter(Boolean))];

    // Ältere Aufrufe ohne `ingredients`: Füllmenge, Gebinde, Artikelnummer und Lieferant der Speise werden zur einzigen Zutat
    let ingredientList = b.ingredients;
    if (ingredientList === undefined && ['fillGrams', 'stepGrams', 'supplierId', 'articleNo'].some(k => b[k] !== undefined)) {
      ingredientList = [{ name, qtyPerPortion: b.fillGrams, unit: 'g', packSize: b.stepGrams, articleNo: b.articleNo, supplierId: b.supplierId }];
    }
    ingredientList = Array.isArray(ingredientList) ? ingredientList : [];
    if (!ingredientList.length) throw V.bad('Eine Speise braucht mindestens eine Zutat.');
    if (ingredientList.length > 20) throw V.bad('Zu viele Zutaten (höchstens 20).');
    const ingredients = ingredientList.map((g, i) => {
      const where = `Zutat Nr. ${i + 1}`;
      return { name: V.str(g.name, `${where}: Name`, { required: true, max: 100 }),
        unit: V.unit(g.unit || 'g', `${where}: Einheit`, { only: GARNISH_UNITS }),
        qtyPerPortion: V.dec(g.qtyPerPortion, `${where}: Menge pro Portion`, { minExclusive: 0, max: 100000 }),
        packSize: V.dec(g.packSize, `${where}: Gebinde`, { minExclusive: 0, max: 1000000 }),
        articleNo: V.str(g.articleNo, `${where}: Artikelnummer`, { max: 40 }),
        supplierId: supplierOf(g.supplierId, `${where} (${V.str(g.name, 'Name', { max: 100 }) || 'ohne Name'})`) };
    });
    const garnishList = Array.isArray(b.garnish) ? b.garnish : [];
    if (garnishList.length > 20) throw V.bad('Zu viele Garnitur-Positionen (höchstens 20).');
    const garnish = garnishList.map((g, i) => {
      const where = `Garnitur Nr. ${i + 1}`;
      return { name: V.str(g.name, `${where}: Name`, { required: true, max: 100 }),
        unit: V.unit(g.unit || 'stk', `${where}: Einheit`, { only: GARNISH_UNITS }),
        qtyPerGlass: V.dec(g.qtyPerGlass, `${where}: Menge pro Portion`, { minExclusive: 0, max: 100000 }),
        packSize: V.dec(g.packSize, `${where}: Gebinde`, { minExclusive: 0, max: 1000000 }),
        supplierId: supplierOf(g.supplierId, `${where} (${V.str(g.name, 'Name', { max: 100 }) || 'ohne Name'})`) };
    });
    return { name, category, note, aliases, ingredients, garnish };
  }

  function writeChildren(dishId, b) {
    db.prepare('DELETE FROM catering_dish_ingredients WHERE dish_id = ?').run(dishId);
    const insI = db.prepare('INSERT INTO catering_dish_ingredients (dish_id, name, qty_per_portion, unit, pack_size, article_no, supplier_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    b.ingredients.forEach((g, i) => insI.run(dishId, g.name, g.qtyPerPortion, g.unit, g.packSize, g.articleNo, g.supplierId, i));
    db.prepare('DELETE FROM catering_dish_garnish WHERE dish_id = ?').run(dishId);
    const ins = db.prepare('INSERT INTO catering_dish_garnish (dish_id, name, qty_per_glass, unit, pack_size, supplier_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?)');
    b.garnish.forEach((g, i) => ins.run(dishId, g.name, g.qtyPerGlass, g.unit, g.packSize, g.supplierId, i));
    db.prepare('DELETE FROM catering_dish_aliases WHERE dish_id = ?').run(dishId);
    const insA = db.prepare('INSERT INTO catering_dish_aliases (dish_id, alias) VALUES (?, ?)');
    b.aliases.forEach(a => {
      const owner = db.prepare('SELECT d.name FROM catering_dish_aliases a JOIN catering_dishes d ON d.id = a.dish_id WHERE a.alias = ?').get(a);
      if (owner) throw new ApiError(409, `Der Rentman-Name "${a}" ist bereits der Speise "${owner.name}" zugeordnet.`);
      insA.run(dishId, a);
    });
  }

  r.get('/dishes', (req, res) => {
    const rows = db.prepare(`SELECT id FROM catering_dishes ${req.query.archived === '1' ? '' : 'WHERE archived = 0'} ORDER BY name COLLATE NOCASE`).all();
    res.json(rows.map(x => loadDish(db, x.id)));
  });
  r.get('/dishes/:id', (req, res) => {
    const d = loadDish(db, V.id(req.params.id, 'Speise'));
    if (!d) throw new ApiError(404, 'Speise nicht gefunden.');
    res.json(d);
  });

  r.post('/dishes', (req, res) => {
    const b = parseBody(req.body);
    let id;
    try {
      db.transaction(() => {
        id = db.prepare("INSERT INTO catering_dishes (name, category, note, updated_at) VALUES (?, ?, ?, datetime('now'))")
          .run(b.name, b.category, b.note).lastInsertRowid;
        writeChildren(id, b);
      })();
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError(409, 'Eine Speise mit diesem Namen gibt es bereits.');
      throw e;
    }
    audit(req, 'speise', id, 'angelegt', { name: b.name });
    res.json(loadDish(db, id));
  });

  r.put('/dishes/:id', (req, res) => {
    const id = V.id(req.params.id, 'Speise');
    const b = parseBody(req.body);
    const rev = V.id(req.body.rev, 'Versionsstand');
    try {
      db.transaction(() => {
        const info = db.prepare(`UPDATE catering_dishes SET name = ?, category = ?, note = ?,
          rev = rev + 1, updated_at = datetime('now') WHERE id = ? AND rev = ?`).run(b.name, b.category, b.note, id, rev);
        if (!info.changes) {
          if (!db.prepare('SELECT 1 FROM catering_dishes WHERE id = ?').get(id)) throw new ApiError(404, 'Speise nicht gefunden.');
          throw conflictChanged();
        }
        writeChildren(id, b);
      })();
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError(409, 'Eine Speise mit diesem Namen gibt es bereits.');
      throw e;
    }
    audit(req, 'speise', id, 'geändert', { name: b.name, zutaten: b.ingredients.length, garnituren: b.garnish.length });
    res.json(loadDish(db, id));
  });

  r.post('/dishes/:id/archive', (req, res) => {
    const id = V.id(req.params.id, 'Speise');
    const archived = V.bool(req.body.archived) ? 1 : 0;
    try {
      const info = db.prepare("UPDATE catering_dishes SET archived = ?, rev = rev + 1, updated_at = datetime('now') WHERE id = ?").run(archived, id);
      if (!info.changes) throw new ApiError(404, 'Speise nicht gefunden.');
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError(409, 'Es gibt bereits eine aktive Speise mit diesem Namen.');
      throw e;
    }
    audit(req, 'speise', id, archived ? 'archiviert' : 'wiederhergestellt');
    res.json({ ok: true });
  });

  // Legt die fünf Salate aus der Bestellübersicht an (nur wenn es sie noch nicht gibt). Ausdrücklich ausgelöst.
  r.post('/dishes/import-example', (req, res) => {
    let supplier = db.prepare("SELECT id FROM catering_suppliers WHERE lower(name) = 'kugler'").get();
    const created = [];
    db.transaction(() => {
      if (!supplier) supplier = { id: db.prepare("INSERT INTO catering_suppliers (name, updated_at) VALUES ('Kugler', datetime('now'))").run().lastInsertRowid };
      for (const ex of EXAMPLE_DISHES) {
        if (db.prepare('SELECT 1 FROM catering_dishes WHERE lower(name) = lower(?) AND archived = 0').get(ex.name)) continue;
        const id = db.prepare("INSERT INTO catering_dishes (name, category, note, updated_at) VALUES (?, 'weckglas', ?, datetime('now'))")
          .run(ex.name, ex.note).lastInsertRowid;
        db.prepare('INSERT INTO catering_dish_ingredients (dish_id, name, qty_per_portion, unit, pack_size, article_no, supplier_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
          .run(id, ex.name, ex.fillGrams, 'g', ex.stepGrams, ex.articleNo, supplier.id);
        const ins = db.prepare('INSERT INTO catering_dish_garnish (dish_id, name, qty_per_glass, unit, sort) VALUES (?, ?, ?, ?, ?)');
        ex.garnish.forEach((g, i) => ins.run(id, g.name, g.qtyPerGlass, g.unit, i));
        created.push(ex.name);
      }
    })();
    created.forEach(n => audit(req, 'speise', n, 'aus Bestellübersicht angelegt'));
    res.json({ created });
  });

  // Legt die sechs Brotzeiten vom Hausbau-Event samt Lieferanten an (nur wenn es sie noch nicht gibt). Ausdrücklich ausgelöst.
  r.post('/dishes/import-brotzeit', (req, res) => {
    const created = [];
    db.transaction(() => {
      const supplierId = name => {
        const s = db.prepare('SELECT id FROM catering_suppliers WHERE lower(name) = lower(?)').get(name);
        return s ? s.id : db.prepare("INSERT INTO catering_suppliers (name, updated_at) VALUES (?, datetime('now'))").run(name).lastInsertRowid;
      };
      const insI = db.prepare('INSERT INTO catering_dish_ingredients (dish_id, name, qty_per_portion, unit, pack_size, article_no, supplier_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const insG = db.prepare('INSERT INTO catering_dish_garnish (dish_id, name, qty_per_glass, unit, pack_size, supplier_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const ex of EXAMPLE_BROTZEIT) {
        if (db.prepare('SELECT 1 FROM catering_dishes WHERE lower(name) = lower(?) AND archived = 0').get(ex.name)) continue;
        const id = db.prepare("INSERT INTO catering_dishes (name, category, note, updated_at) VALUES (?, 'brotzeit', ?, datetime('now'))")
          .run(ex.name, 'Menge pro halber Brotscheibe aus dem Hausbau-Event (Einkauf für 50 Gäste, 155 halbe Scheiben) zurückgerechnet.').lastInsertRowid;
        ex.ingredients.forEach((g, i) => insI.run(id, g.name, g.qtyPerPortion, g.unit, g.packSize, g.articleNo || null, supplierId(g.supplier), i));
        ex.garnish.forEach((g, i) => insG.run(id, g.name, g.qtyPerPortion, g.unit, g.packSize, supplierId(g.supplier), i));
        created.push(ex.name);
      }
    })();
    created.forEach(n => audit(req, 'speise', n, 'Brotzeit Hausbau angelegt'));
    res.json({ created });
  });

  return r;
}

module.exports = { createDishesRouter, loadDish };
