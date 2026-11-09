// Stammdaten: Kategorien, Warengruppen, Lieferanten, Zutaten.
// Paralleles Bearbeiten: Zutaten und Lieferanten tragen einen Versionszähler `rev`. Ein Speichern mit
// veraltetem `rev` wird mit 409 abgelehnt, damit keine Änderung unbemerkt überschrieben wird.
const express = require('express');
const V = require('../validate');
const { ApiError } = V;
const { UNITS, UnitError, convert } = require('../units');

const BASE_UNITS = ['g', 'ml', 'stk', 'pkg'];

const uniqueViolation = e => e && e.code === 'SQLITE_CONSTRAINT_UNIQUE';
const conflictChanged = what => new ApiError(409, `${what} wurde zwischenzeitlich von jemand anderem geändert. Bitte neu laden und die Änderung erneut vornehmen.`);

function ingredientOut(r) {
  return {
    id: r.id, name: r.name, goodsGroup: r.goods_group, baseUnit: r.base_unit, purchaseUnit: r.purchase_unit,
    packSize: r.pack_size, supplierId: r.supplier_id, supplierName: r.supplier_name ?? null, price: r.price,
    lossPct: r.loss_pct, densityGPerMl: r.density_g_per_ml,
    discreteRules: r.discrete_rules ? JSON.parse(r.discrete_rules) : null,
    archived: !!r.archived, rev: r.rev, usedInRecipes: r.used_in_recipes ?? undefined, updatedAt: r.updated_at,
  };
}

function createMasterdataRouter(db, audit) {
  const r = express.Router();

  r.get('/meta', (req, res) => {
    res.json({
      categories: db.prepare('SELECT id, name FROM catering_categories ORDER BY sort, name').all(),
      goodsGroups: db.prepare('SELECT id, name FROM catering_goods_groups ORDER BY sort, name').all(),
      units: Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [k, v.label])),
      baseUnits: BASE_UNITS,
    });
  });

  // ---- Kategorien und Warengruppen (erweiterbar) ----
  for (const [path, table, label] of [['categories', 'catering_categories', 'Kategorie'], ['goods-groups', 'catering_goods_groups', 'Warengruppe']]) {
    r.post(`/${path}`, (req, res) => {
      const name = V.str(req.body.name, `Name der ${label}`, { required: true, max: 60 });
      try {
        const sort = db.prepare(`SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM ${table}`).get().s;
        const info = db.prepare(`INSERT INTO ${table} (name, sort) VALUES (?, ?)`).run(name, sort);
        audit(req, table, info.lastInsertRowid, 'angelegt', { name });
        res.json({ id: info.lastInsertRowid, name });
      } catch (e) {
        if (uniqueViolation(e)) throw new ApiError(409, `Diese ${label} gibt es bereits.`);
        throw e;
      }
    });
  }

  // ---- Lieferanten ----
  const supplierOut = s => ({ id: s.id, name: s.name, contact: s.contact, note: s.note, archived: !!s.archived, rev: s.rev });
  r.get('/suppliers', (req, res) => {
    const all = req.query.archived === '1';
    res.json(db.prepare(`SELECT * FROM catering_suppliers ${all ? '' : 'WHERE archived = 0'} ORDER BY name COLLATE NOCASE`).all().map(supplierOut));
  });
  const supplierBody = b => ({ name: V.str(b.name, 'Name des Lieferanten', { required: true, max: 120 }),
    contact: V.str(b.contact, 'Kontaktdaten', { max: 500 }), note: V.str(b.note, 'Bemerkung', { max: 1000 }) });
  r.post('/suppliers', (req, res) => {
    const b = supplierBody(req.body);
    const info = db.prepare("INSERT INTO catering_suppliers (name, contact, note, updated_at) VALUES (?, ?, ?, datetime('now'))").run(b.name, b.contact, b.note);
    audit(req, 'lieferant', info.lastInsertRowid, 'angelegt', b);
    res.json(supplierOut(db.prepare('SELECT * FROM catering_suppliers WHERE id = ?').get(info.lastInsertRowid)));
  });
  r.put('/suppliers/:id', (req, res) => {
    const id = V.id(req.params.id, 'Lieferant');
    const b = supplierBody(req.body);
    const rev = V.id(req.body.rev, 'Versionsstand');
    const info = db.prepare("UPDATE catering_suppliers SET name = ?, contact = ?, note = ?, rev = rev + 1, updated_at = datetime('now') WHERE id = ? AND rev = ?")
      .run(b.name, b.contact, b.note, id, rev);
    if (!info.changes) {
      if (!db.prepare('SELECT 1 FROM catering_suppliers WHERE id = ?').get(id)) throw new ApiError(404, 'Lieferant nicht gefunden.');
      throw conflictChanged('Dieser Lieferant');
    }
    audit(req, 'lieferant', id, 'geändert', b);
    res.json(supplierOut(db.prepare('SELECT * FROM catering_suppliers WHERE id = ?').get(id)));
  });
  r.post('/suppliers/:id/archive', (req, res) => {
    const id = V.id(req.params.id, 'Lieferant');
    const archived = V.bool(req.body.archived) ? 1 : 0;
    const info = db.prepare("UPDATE catering_suppliers SET archived = ?, rev = rev + 1, updated_at = datetime('now') WHERE id = ?").run(archived, id);
    if (!info.changes) throw new ApiError(404, 'Lieferant nicht gefunden.');
    audit(req, 'lieferant', id, archived ? 'archiviert' : 'wiederhergestellt');
    res.json({ ok: true });
  });

  // ---- Zutaten ----
  const ingredientSelect = `
    SELECT i.*, s.name AS supplier_name,
      (SELECT COUNT(DISTINCT v.recipe_id) FROM catering_recipe_items ri JOIN catering_recipe_versions v ON v.id = ri.version_id
         WHERE ri.ingredient_id = i.id) AS used_in_recipes
    FROM catering_ingredients i LEFT JOIN catering_suppliers s ON s.id = i.supplier_id`;

  function ingredientBody(b) {
    const name = V.str(b.name, 'Name der Zutat', { required: true, max: 120 });
    const goodsGroup = V.str(b.goodsGroup, 'Warengruppe', { max: 60 });
    if (goodsGroup && !db.prepare('SELECT 1 FROM catering_goods_groups WHERE name = ?').get(goodsGroup)) {
      throw V.bad(`Die Warengruppe "${goodsGroup}" gibt es nicht.`);
    }
    const baseUnit = V.unit(b.baseUnit, 'Basiseinheit', { only: BASE_UNITS });
    const purchaseUnit = V.unit(b.purchaseUnit || baseUnit, 'Einkaufseinheit');
    const packSize = V.dec(b.packSize, 'Gebindegröße', { minExclusive: 0 });
    const price = V.dec(b.price, 'Einkaufspreis', { min: 0 });
    const lossPct = V.dec(b.lossPct, 'Verlustfaktor', { min: 0, maxExclusive: 100 });
    const density = V.dec(b.densityGPerMl, 'Dichte', { minExclusive: 0 });
    const discrete = V.discreteRules(b.discreteRules);
    let supplierId = null;
    if (!V.isEmpty(b.supplierId)) {
      supplierId = V.id(b.supplierId, 'Lieferant');
      if (!db.prepare('SELECT 1 FROM catering_suppliers WHERE id = ?').get(supplierId)) throw V.bad('Der Lieferant gibt es nicht.');
    }
    // Einkaufseinheit muss sich in die Basiseinheit umrechnen lassen, sonst ist keine Einkaufsmenge berechenbar
    try { convert('1', purchaseUnit, baseUnit, { densityGPerMl: density, discrete: discrete || undefined }); }
    catch (e) {
      if (e instanceof UnitError) throw V.bad(`Die Einheit dieser Zutat kann nicht automatisch umgerechnet werden: ${e.message}.`);
      throw e;
    }
    return { name, goodsGroup, baseUnit, purchaseUnit, packSize, price, lossPct, density, discrete, supplierId };
  }

  r.get('/ingredients', (req, res) => {
    const where = [];
    const params = [];
    if (req.query.archived !== '1') where.push('i.archived = 0');
    if (req.query.q) { where.push('i.name LIKE ?'); params.push(`%${String(req.query.q).slice(0, 60)}%`); }
    const sql = `${ingredientSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.name COLLATE NOCASE`;
    res.json(db.prepare(sql).all(...params).map(ingredientOut));
  });
  r.get('/ingredients/:id', (req, res) => {
    const row = db.prepare(`${ingredientSelect} WHERE i.id = ?`).get(V.id(req.params.id, 'Zutat'));
    if (!row) throw new ApiError(404, 'Zutat nicht gefunden.');
    res.json(ingredientOut(row));
  });
  r.post('/ingredients', (req, res) => {
    const b = ingredientBody(req.body);
    try {
      const info = db.prepare(`INSERT INTO catering_ingredients
        (name, goods_group, base_unit, purchase_unit, pack_size, supplier_id, price, loss_pct, density_g_per_ml, discrete_rules, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`)
        .run(b.name, b.goodsGroup, b.baseUnit, b.purchaseUnit, b.packSize, b.supplierId, b.price, b.lossPct, b.density,
          b.discrete ? JSON.stringify(b.discrete) : null, req.session.userId);
      audit(req, 'zutat', info.lastInsertRowid, 'angelegt', { name: b.name });
      res.json(ingredientOut(db.prepare(`${ingredientSelect} WHERE i.id = ?`).get(info.lastInsertRowid)));
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError(409, 'Eine Zutat mit diesem Namen gibt es bereits.');
      throw e;
    }
  });
  r.put('/ingredients/:id', (req, res) => {
    const id = V.id(req.params.id, 'Zutat');
    const b = ingredientBody(req.body);
    const rev = V.id(req.body.rev, 'Versionsstand');
    const cur = db.prepare('SELECT base_unit FROM catering_ingredients WHERE id = ?').get(id);
    if (!cur) throw new ApiError(404, 'Zutat nicht gefunden.');
    if (cur.base_unit !== b.baseUnit && db.prepare('SELECT 1 FROM catering_recipe_items WHERE ingredient_id = ? LIMIT 1').get(id)) {
      throw new ApiError(409, 'Die Basiseinheit lässt sich nicht mehr ändern, weil die Zutat in Rezepturen verwendet wird.');
    }
    try {
      const info = db.prepare(`UPDATE catering_ingredients SET name = ?, goods_group = ?, base_unit = ?, purchase_unit = ?, pack_size = ?,
        supplier_id = ?, price = ?, loss_pct = ?, density_g_per_ml = ?, discrete_rules = ?, rev = rev + 1, updated_at = datetime('now'), updated_by = ?
        WHERE id = ? AND rev = ?`)
        .run(b.name, b.goodsGroup, b.baseUnit, b.purchaseUnit, b.packSize, b.supplierId, b.price, b.lossPct, b.density,
          b.discrete ? JSON.stringify(b.discrete) : null, req.session.userId, id, rev);
      if (!info.changes) throw conflictChanged('Diese Zutat');
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError(409, 'Eine Zutat mit diesem Namen gibt es bereits.');
      throw e;
    }
    audit(req, 'zutat', id, 'geändert', { name: b.name });
    res.json(ingredientOut(db.prepare(`${ingredientSelect} WHERE i.id = ?`).get(id)));
  });
  r.post('/ingredients/:id/archive', (req, res) => {
    const id = V.id(req.params.id, 'Zutat');
    const archived = V.bool(req.body.archived) ? 1 : 0;
    try {
      const info = db.prepare("UPDATE catering_ingredients SET archived = ?, rev = rev + 1, updated_at = datetime('now'), updated_by = ? WHERE id = ?")
        .run(archived, req.session.userId, id);
      if (!info.changes) throw new ApiError(404, 'Zutat nicht gefunden.');
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError(409, 'Es gibt bereits eine aktive Zutat mit diesem Namen.');
      throw e;
    }
    audit(req, 'zutat', id, archived ? 'archiviert' : 'wiederhergestellt');
    res.json({ ok: true });
  });

  return r;
}

module.exports = { createMasterdataRouter, ingredientOut };
