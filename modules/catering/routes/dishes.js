// Speisenkatalog (Speisen im Glas): Füllmenge pro Glas, Gebinde, Lieferant, Garnitur, bestätigte Rentman-Namen.
const express = require('express');
const V = require('../validate');
const { ApiError } = V;
const { normName } = require('../match');

const CATEGORIES = ['weckglas', 'brotzeit', 'dessert'];   // Brotzeit und Desserts werden später berechnet
const GARNISH_UNITS = ['g', 'kg', 'ml', 'l', 'stk', 'pkg'];
const uniqueViolation = e => e && e.code === 'SQLITE_CONSTRAINT_UNIQUE';
const conflictChanged = () => new ApiError(409, 'Diese Speise wurde zwischenzeitlich von jemand anderem geändert. Bitte neu laden und die Änderung erneut vornehmen.');

function loadDish(db, id) {
  const d = db.prepare(`SELECT d.*, s.name AS supplier_name FROM catering_dishes d LEFT JOIN catering_suppliers s ON s.id = d.supplier_id WHERE d.id = ?`).get(id);
  if (!d) return null;
  const garnish = db.prepare(`SELECT g.*, s.name AS supplier_name FROM catering_dish_garnish g LEFT JOIN catering_suppliers s ON s.id = g.supplier_id
    WHERE g.dish_id = ? ORDER BY g.sort, g.id`).all(id);
  const aliases = db.prepare('SELECT alias FROM catering_dish_aliases WHERE dish_id = ? ORDER BY alias').all(id).map(a => a.alias);
  return {
    id: d.id, name: d.name, category: d.category, supplierId: d.supplier_id, supplierName: d.supplier_name, fillGrams: d.fill_grams,
    stepGrams: d.step_grams, note: d.note, archived: !!d.archived, rev: d.rev, aliases,
    garnish: garnish.map(g => ({ id: g.id, name: g.name, qtyPerGlass: g.qty_per_glass, unit: g.unit, packSize: g.pack_size, supplierId: g.supplier_id, supplierName: g.supplier_name })),
  };
}

// Beispieldaten aus der Bestellübersicht vom 20.10.2026. Füllmenge = Gesamtmenge / Gläser, abgerundet.
// Menge der Garnitur ist nur dort eingetragen, wo sie bekannt ist (Radieschen, Cherrytomate, Tomate, Fleischpflanzerl).
const OVERVIEW_NOTE = 'Füllmenge aus der Bestellübersicht vom 20.10.2026 zurückgerechnet (Gesamtmenge geteilt durch Gläser, abgerundet). Bitte prüfen.';
const EXAMPLE_DISHES = [
  { name: 'Schweizer Wurstsalat', fillGrams: '40', garnish: [{ name: 'Radieschen', qtyPerGlass: '0.5', unit: 'stk' }] },
  { name: 'Pikanter Couscous', fillGrams: '52', garnish: [{ name: 'Cherrytomate', qtyPerGlass: '1', unit: 'stk' }] },
  { name: 'Garnelen Coco Ginger', fillGrams: '38', garnish: [{ name: 'Dill', qtyPerGlass: null, unit: 'g' }] },
  { name: 'Penne Rucola', fillGrams: '58', garnish: [{ name: 'Rucola', qtyPerGlass: null, unit: 'g' }, { name: 'Tomate', qtyPerGlass: '0.5', unit: 'stk' }] },
  { name: 'Kartoffel-Gurkensalat', fillGrams: '51', garnish: [{ name: 'Mini-Fleischpflanzerl am Spieß', qtyPerGlass: '2', unit: 'stk' }] },
];

function createDishesRouter(db, audit) {
  const r = express.Router();

  function parseBody(b) {
    const name = V.str(b.name, 'Name der Speise', { required: true, max: 120 });
    const category = V.str(b.category, 'Kategorie') || 'weckglas';
    if (!CATEGORIES.includes(category)) throw V.bad('Die Kategorie ist unbekannt.');
    let supplierId = null;
    if (!V.isEmpty(b.supplierId)) {
      supplierId = V.id(b.supplierId, 'Lieferant');
      if (!db.prepare('SELECT 1 FROM catering_suppliers WHERE id = ?').get(supplierId)) throw V.bad('Der Lieferant gibt es nicht.');
    }
    const fillGrams = V.dec(b.fillGrams, 'Füllmenge pro Glas', { minExclusive: 0, max: 100000 });
    const stepGrams = V.dec(b.stepGrams, 'Gebinde', { minExclusive: 0, max: 1000000 });
    const note = V.str(b.note, 'Bemerkung', { max: 1000 });
    const aliasList = Array.isArray(b.aliases) ? b.aliases : [];
    if (aliasList.length > 30) throw V.bad('Zu viele Rentman-Namen (höchstens 30).');
    const aliases = [...new Set(aliasList.map(a => normName(V.str(a, 'Rentman-Name', { max: 160 }) || '')).filter(Boolean))];
    const garnishList = Array.isArray(b.garnish) ? b.garnish : [];
    if (garnishList.length > 20) throw V.bad('Zu viele Garnitur-Positionen (höchstens 20).');
    const garnish = garnishList.map((g, i) => {
      const where = `Garnitur Nr. ${i + 1}`;
      const gname = V.str(g.name, `${where}: Name`, { required: true, max: 100 });
      const unit = V.unit(g.unit || 'stk', `${where}: Einheit`, { only: GARNISH_UNITS });
      let gSupplier = null;
      if (!V.isEmpty(g.supplierId)) {
        gSupplier = V.id(g.supplierId, `${where}: Lieferant`);
        if (!db.prepare('SELECT 1 FROM catering_suppliers WHERE id = ?').get(gSupplier)) throw V.bad(`${where}: Der Lieferant gibt es nicht.`);
      }
      return { name: gname, unit, qtyPerGlass: V.dec(g.qtyPerGlass, `${where}: Menge pro Glas`, { minExclusive: 0, max: 100000 }),
        packSize: V.dec(g.packSize, `${where}: Gebinde`, { minExclusive: 0, max: 1000000 }), supplierId: gSupplier };
    });
    return { name, category, supplierId, fillGrams, stepGrams, note, aliases, garnish };
  }

  function writeChildren(dishId, b) {
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
        id = db.prepare("INSERT INTO catering_dishes (name, category, supplier_id, fill_grams, step_grams, note, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
          .run(b.name, b.category, b.supplierId, b.fillGrams, b.stepGrams, b.note).lastInsertRowid;
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
        const info = db.prepare(`UPDATE catering_dishes SET name = ?, category = ?, supplier_id = ?, fill_grams = ?, step_grams = ?, note = ?,
          rev = rev + 1, updated_at = datetime('now') WHERE id = ? AND rev = ?`).run(b.name, b.category, b.supplierId, b.fillGrams, b.stepGrams, b.note, id, rev);
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
    audit(req, 'speise', id, 'geändert', { name: b.name, fillGrams: b.fillGrams, stepGrams: b.stepGrams });
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
        const id = db.prepare("INSERT INTO catering_dishes (name, category, supplier_id, fill_grams, note, updated_at) VALUES (?, 'weckglas', ?, ?, ?, datetime('now'))")
          .run(ex.name, supplier.id, ex.fillGrams, OVERVIEW_NOTE).lastInsertRowid;
        const ins = db.prepare('INSERT INTO catering_dish_garnish (dish_id, name, qty_per_glass, unit, sort) VALUES (?, ?, ?, ?, ?)');
        ex.garnish.forEach((g, i) => ins.run(id, g.name, g.qtyPerGlass, g.unit, i));
        created.push(ex.name);
      }
    })();
    created.forEach(n => audit(req, 'speise', n, 'aus Bestellübersicht angelegt'));
    res.json({ created });
  });

  return r;
}

module.exports = { createDishesRouter, loadDish };
