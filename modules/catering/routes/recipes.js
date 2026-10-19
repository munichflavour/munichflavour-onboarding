// Rezepturen. Eine Rezeptur besteht aus der Kopfzeile (catering_recipes: Zuordnung, Kategorie, Archiv)
// und unveränderlichen Versionen (catering_recipe_versions + catering_recipe_items).
// Jede inhaltliche Änderung legt eine NEUE Version an. Kalkulationen verweisen auf die Version, die sie
// verwendet haben, und bleiben dadurch reproduzierbar.
const express = require('express');
const V = require('../validate');
const { ApiError } = V;
const { UnitError, convert } = require('../units');

const uniqueViolation = e => e && e.code === 'SQLITE_CONSTRAINT_UNIQUE';

function versionOut(v) {
  return {
    id: v.id, version: v.version, name: v.name, description: v.description, photo: v.photo, calcUnit: v.calc_unit,
    refQty: v.ref_qty, portionGrams: v.portion_grams, defaultBufferPct: v.default_buffer_pct,
    defaultPortionFactor: v.default_portion_factor, allergens: v.allergens, prepNotes: v.prep_notes,
    createdAt: v.created_at, createdByName: v.created_by_name ?? null,
  };
}

function createRecipesRouter(db, audit) {
  const r = express.Router();

  const currentVersionId = db.prepare('SELECT id FROM catering_recipe_versions WHERE recipe_id = ? ORDER BY version DESC LIMIT 1');
  const versionRow = db.prepare(`SELECT v.*, u.full_name AS created_by_name FROM catering_recipe_versions v
    LEFT JOIN users u ON u.id = v.created_by WHERE v.id = ?`);
  const itemRows = db.prepare(`SELECT ri.*, i.name AS ingredient_name, i.base_unit, i.archived AS ingredient_archived
    FROM catering_recipe_items ri JOIN catering_ingredients i ON i.id = ri.ingredient_id WHERE ri.version_id = ? ORDER BY ri.id`);

  function load(recipeId, versionNo) {
    const rec = db.prepare('SELECT * FROM catering_recipes WHERE id = ?').get(recipeId);
    if (!rec) throw new ApiError(404, 'Rezeptur nicht gefunden.');
    const vid = versionNo
      ? (db.prepare('SELECT id FROM catering_recipe_versions WHERE recipe_id = ? AND version = ?').get(recipeId, versionNo) || {}).id
      : currentVersionId.get(recipeId).id;
    if (!vid) throw new ApiError(404, 'Diese Version gibt es nicht.');
    const versions = db.prepare(`SELECT v.version, v.created_at, u.full_name AS created_by_name FROM catering_recipe_versions v
      LEFT JOIN users u ON u.id = v.created_by WHERE v.recipe_id = ? ORDER BY v.version DESC`).all(recipeId)
      .map(v => ({ version: v.version, createdAt: v.created_at, createdByName: v.created_by_name }));
    return {
      id: rec.id, rentmanItemId: rec.rentman_item_id, articleNo: rec.article_no, categoryId: rec.category_id,
      archived: !!rec.archived, latestVersion: versions[0].version,
      version: versionOut(versionRow.get(vid)),
      items: itemRows.all(vid).map(i => ({
        id: i.id, ingredientId: i.ingredient_id, ingredientName: i.ingredient_name, baseUnit: i.base_unit,
        ingredientArchived: !!i.ingredient_archived, qty: i.qty, unit: i.unit, lossPct: i.loss_pct, note: i.note,
      })),
      versions,
    };
  }

  // Prüft und normalisiert den Eingabekörper. `allowedArchived` = Zutaten, die schon in der aktuellen Version stehen.
  function parseBody(b, allowedArchived = new Set()) {
    const head = {
      name: V.str(b.name, 'Name der Speise', { required: true, max: 120 }),
      description: V.str(b.description, 'Beschreibung', { max: 1000 }),
      calcUnit: V.str(b.calcUnit, 'Kalkulationseinheit', { max: 30 }) || 'Portionen',
      refQty: V.dec(b.refQty, 'Referenzmenge', { required: true, minExclusive: 0 }),
      portionGrams: V.dec(b.portionGrams, 'Portionsgröße in Gramm', { minExclusive: 0 }),
      defaultBufferPct: V.dec(b.defaultBufferPct, 'Standard-Sicherheitspuffer', { min: 0, max: 100 }),
      defaultPortionFactor: V.dec(b.defaultPortionFactor, 'Standard-Portionsfaktor', { minExclusive: 0 }),
      allergens: V.str(b.allergens, 'Allergene', { max: 300 }),
      prepNotes: V.str(b.prepNotes, 'Zubereitungshinweise', { max: 4000 }),
      photo: V.str(b.photo, 'Foto', { max: 300 }),
    };
    const meta = {
      rentmanItemId: V.str(b.rentmanItemId, 'Rentman-Artikel-ID', { max: 60 }),
      articleNo: V.str(b.articleNo, 'Artikelnummer', { max: 60 }),
      categoryId: V.isEmpty(b.categoryId) ? null : V.id(b.categoryId, 'Kategorie'),
    };
    if (meta.categoryId && !db.prepare('SELECT 1 FROM catering_categories WHERE id = ?').get(meta.categoryId)) throw V.bad('Die Kategorie gibt es nicht.');
    if (!Array.isArray(b.items) || b.items.length === 0) throw V.bad('Eine Rezeptur braucht mindestens eine Zutat.');
    if (b.items.length > 100) throw V.bad('Zu viele Zutaten (höchstens 100).');
    const ing = db.prepare('SELECT * FROM catering_ingredients WHERE id = ?');
    const items = b.items.map((it, n) => {
      const where = `Zutat Nr. ${n + 1}`;
      const ingredientId = V.id(it.ingredientId, `${where}: Zutat`);
      const row = ing.get(ingredientId);
      if (!row) throw V.bad(`${where}: Die Zutat gibt es nicht.`);
      if (row.archived && !allowedArchived.has(ingredientId)) throw V.bad(`${where}: "${row.name}" ist archiviert.`);
      const out = {
        ingredientId,
        qty: V.dec(it.qty, `${where} (${row.name}): Menge`, { required: true, minExclusive: 0 }),
        unit: V.unit(it.unit, `${where} (${row.name}): Einheit`),
        lossPct: V.dec(it.lossPct, `${where} (${row.name}): Zubereitungsverlust`, { min: 0, maxExclusive: 100 }),
        note: V.str(it.note, `${where}: Hinweis`, { max: 300 }),
      };
      try {
        convert('1', out.unit, row.base_unit, { densityGPerMl: row.density_g_per_ml, discrete: row.discrete_rules ? JSON.parse(row.discrete_rules) : undefined });
      } catch (e) {
        if (e instanceof UnitError) throw V.bad(`${where} (${row.name}): Die Einheit dieser Zutat kann nicht automatisch umgerechnet werden. ${e.message}.`);
        throw e;
      }
      return out;
    });
    return { head, meta, items };
  }

  const canonical = (head, items) => JSON.stringify([head, items.map(i => [i.ingredientId, i.qty, i.unit, i.lossPct, i.note])]);

  const insertVersion = db.prepare(`INSERT INTO catering_recipe_versions
    (recipe_id, version, name, description, photo, calc_unit, ref_qty, portion_grams, default_buffer_pct, default_portion_factor, allergens, prep_notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertItem = db.prepare('INSERT INTO catering_recipe_items (version_id, ingredient_id, qty, unit, loss_pct, note) VALUES (?, ?, ?, ?, ?, ?)');
  function writeVersion(recipeId, versionNo, head, items, userId) {
    const info = insertVersion.run(recipeId, versionNo, head.name, head.description, head.photo, head.calcUnit, head.refQty, head.portionGrams,
      head.defaultBufferPct, head.defaultPortionFactor, head.allergens, head.prepNotes, userId);
    items.forEach(i => insertItem.run(info.lastInsertRowid, i.ingredientId, i.qty, i.unit, i.lossPct, i.note));
    return info.lastInsertRowid;
  }
  const conflictMsg = e => {
    const m = String(e.message);
    if (m.includes('rentman_item_id')) return 'Diese Rentman-Artikel-ID ist bereits einer anderen Rezeptur zugeordnet.';
    if (m.includes('article_no')) return 'Diese Artikelnummer ist bereits einer anderen Rezeptur zugeordnet.';
    return 'Diese Zuordnung existiert bereits.';
  };

  // Liste mit aktuellem Namen
  r.get('/recipes', (req, res) => {
    const where = [];
    const params = [];
    if (req.query.archived !== '1') where.push('r.archived = 0');
    if (req.query.q) { where.push('v.name LIKE ?'); params.push(`%${String(req.query.q).slice(0, 60)}%`); }
    if (req.query.categoryId) { where.push('r.category_id = ?'); params.push(V.id(req.query.categoryId, 'Kategorie')); }
    const rows = db.prepare(`
      SELECT r.id, r.rentman_item_id, r.article_no, r.category_id, r.archived, c.name AS category_name,
             v.version, v.name, v.ref_qty, v.calc_unit,
             (SELECT COUNT(*) FROM catering_recipe_items WHERE version_id = v.id) AS item_count
      FROM catering_recipes r
      JOIN catering_recipe_versions v ON v.recipe_id = r.id AND v.version = (SELECT MAX(version) FROM catering_recipe_versions WHERE recipe_id = r.id)
      LEFT JOIN catering_categories c ON c.id = r.category_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY v.name COLLATE NOCASE`).all(...params);
    res.json(rows.map(x => ({ id: x.id, name: x.name, version: x.version, categoryId: x.category_id, categoryName: x.category_name,
      refQty: x.ref_qty, calcUnit: x.calc_unit, itemCount: x.item_count, rentmanItemId: x.rentman_item_id, articleNo: x.article_no, archived: !!x.archived })));
  });

  r.get('/recipes/:id', (req, res) => {
    const v = req.query.version ? V.id(req.query.version, 'Version') : null;
    res.json(load(V.id(req.params.id, 'Rezeptur'), v));
  });

  r.post('/recipes', (req, res) => {
    const { head, meta, items } = parseBody(req.body);
    let recipeId;
    try {
      db.transaction(() => {
        recipeId = db.prepare('INSERT INTO catering_recipes (rentman_item_id, article_no, category_id) VALUES (?, ?, ?)')
          .run(meta.rentmanItemId, meta.articleNo, meta.categoryId).lastInsertRowid;
        writeVersion(recipeId, 1, head, items, req.session.userId);
      })();
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError(409, conflictMsg(e));
      throw e;
    }
    audit(req, 'rezeptur', recipeId, 'angelegt', { name: head.name });
    res.json(load(recipeId));
  });

  // Bearbeiten = neue Version. `baseVersion` ist der Stand, auf dem der Benutzer aufgebaut hat.
  r.put('/recipes/:id', (req, res) => {
    const id = V.id(req.params.id, 'Rezeptur');
    const baseVersion = V.id(req.body.baseVersion, 'Versionsstand');
    const cur = load(id);
    const allowed = new Set(cur.items.map(i => i.ingredientId));
    const { head, meta, items } = parseBody(req.body, allowed);
    let created = false;
    try {
      db.transaction(() => {
        // Prüfung innerhalb der Transaktion, damit zwei gleichzeitige Speichervorgänge sich nicht überholen
        const latest = db.prepare('SELECT MAX(version) AS v FROM catering_recipe_versions WHERE recipe_id = ?').get(id).v;
        if (latest !== baseVersion) {
          throw new ApiError(409, 'Diese Rezeptur wurde zwischenzeitlich von jemand anderem geändert. Bitte neu laden und die Änderung erneut vornehmen.');
        }
        db.prepare('UPDATE catering_recipes SET rentman_item_id = ?, article_no = ?, category_id = ? WHERE id = ?')
          .run(meta.rentmanItemId, meta.articleNo, meta.categoryId, id);
        const curHead = { name: cur.version.name, description: cur.version.description, calcUnit: cur.version.calcUnit, refQty: cur.version.refQty,
          portionGrams: cur.version.portionGrams, defaultBufferPct: cur.version.defaultBufferPct,
          defaultPortionFactor: cur.version.defaultPortionFactor, allergens: cur.version.allergens, prepNotes: cur.version.prepNotes, photo: cur.version.photo };
        const norm = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k] === undefined ? null : o[k]]));
        const same = norm(curHead) === norm(head) && canonical({}, cur.items) === canonical({}, items);
        if (!same) { writeVersion(id, latest + 1, head, items, req.session.userId); created = true; }
      })();
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError(409, conflictMsg(e));
      throw e;
    }
    if (created) audit(req, 'rezeptur', id, 'neue Version', { name: head.name });
    res.json({ ...load(id), newVersionCreated: created });
  });

  r.post('/recipes/:id/duplicate', (req, res) => {
    const src = load(V.id(req.params.id, 'Rezeptur'));
    let recipeId;
    db.transaction(() => {
      // Die Kopie erhält bewusst keine Rentman-ID und keine Artikelnummer, damit die Zuordnung eindeutig bleibt.
      recipeId = db.prepare('INSERT INTO catering_recipes (category_id) VALUES (?)').run(src.categoryId).lastInsertRowid;
      const v = src.version;
      writeVersion(recipeId, 1, { name: `${v.name} (Kopie)`.slice(0, 120), description: v.description, calcUnit: v.calcUnit, refQty: v.refQty,
        portionGrams: v.portionGrams, defaultBufferPct: v.defaultBufferPct, defaultPortionFactor: v.defaultPortionFactor,
        allergens: v.allergens, prepNotes: v.prepNotes, photo: v.photo },
      src.items.map(i => ({ ingredientId: i.ingredientId, qty: i.qty, unit: i.unit, lossPct: i.lossPct, note: i.note })), req.session.userId);
    })();
    audit(req, 'rezeptur', recipeId, 'dupliziert', { von: src.id });
    res.json(load(recipeId));
  });

  r.post('/recipes/:id/archive', (req, res) => {
    const id = V.id(req.params.id, 'Rezeptur');
    const archived = V.bool(req.body.archived) ? 1 : 0;
    try {
      const info = db.prepare('UPDATE catering_recipes SET archived = ? WHERE id = ?').run(archived, id);
      if (!info.changes) throw new ApiError(404, 'Rezeptur nicht gefunden.');
    } catch (e) {
      if (uniqueViolation(e)) throw new ApiError(409, 'Es gibt bereits eine aktive Rezeptur mit derselben Zuordnung.');
      throw e;
    }
    audit(req, 'rezeptur', id, archived ? 'archiviert' : 'wiederhergestellt');
    res.json({ ok: true });
  });

  return r;
}

module.exports = { createRecipesRouter };
