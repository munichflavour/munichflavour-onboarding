// Bestellungen (Speisen im Glas): Gästezahl x Gläser pro Person, Verteilung auf Speisen, Bestellübersicht und
// Einkaufsliste als PDF. Entwürfe sind änderbar, abgeschlossene Bestellungen tragen ein eingefrorenes Ergebnis.
const path = require('path');
const express = require('express');
const V = require('../validate');
const { ApiError } = V;
const rentman = require('../rentman');
const { normName, suggest } = require('../match');
const { computeOrder, keyOf } = require('../order-calc');
const { loadDish } = require('./dishes');
const { renderOrderPdf } = require('../pdf');

// Ein kleineres Logo (assets/logo-pdf.jpg) wird bevorzugt, damit die PDFs klein bleiben; sonst assets/logo.jpg.
const ASSETS = path.join(__dirname, '..', '..', '..', 'assets');
const LOGO = ['logo-pdf.jpg', 'logo.jpg'].map(f => path.join(ASSETS, f)).find(f => require('fs').existsSync(f));
// Express 4 leitet Fehler aus async-Routen nicht selbst an die Fehlerbehandlung weiter
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const conflictChanged = () => new ApiError(409, 'Diese Bestellung wurde zwischenzeitlich von jemand anderem geändert. Bitte neu laden und die Änderung erneut vornehmen.');

function createOrdersRouter(db, audit) {
  const r = express.Router();

  const activeDishes = () => db.prepare('SELECT id FROM catering_dishes WHERE archived = 0').all().map(x => loadDish(db, x.id));

  function loadOrder(id) {
    const o = db.prepare('SELECT * FROM catering_orders WHERE id = ?').get(id);
    if (!o) throw new ApiError(404, 'Bestellung nicht gefunden.');
    const rows = db.prepare('SELECT * FROM catering_order_lines WHERE order_id = ? ORDER BY sort, id').all(id);
    const dishCache = new Map();
    const dishOf = did => { if (!did) return null; if (!dishCache.has(did)) dishCache.set(did, loadDish(db, did)); return dishCache.get(did); };
    const catalog = o.status === 'entwurf' ? activeDishes() : [];
    const lines = rows.map(l => {
      const dish = dishOf(l.dish_id);
      return { id: l.id, dishId: l.dish_id, rentmanRowId: l.rentman_row_id, rentmanName: l.rentman_name, blockName: l.block_name, glasses: l.glasses, dish,
        suggestion: !dish && l.rentman_name ? suggest(l.rentman_name, catalog) : null };
    });
    const garnishOverrides = db.prepare('SELECT key, name, qty, unit, note FROM catering_order_garnish_overrides WHERE order_id = ? ORDER BY name').all(id);
    const live = computeOrder({ guests: o.guests, glassesPerPerson: o.glasses_per_person, garnishOverrides,
      lines: lines.map(l => ({ id: l.id, glasses: l.glasses, rentmanName: l.rentmanName || l.blockName, dish: l.dish })) });
    const computed = o.status === 'abgeschlossen' && o.snapshot ? JSON.parse(o.snapshot).computed : live;
    return {
      id: o.id, rentmanProjectId: o.rentman_project_id, number: o.number, name: o.name, eventDate: o.event_date, guests: o.guests,
      guestsSource: o.guests_source, glassesPerPerson: o.glasses_per_person, status: o.status, rev: o.rev, createdAt: o.created_at, updatedAt: o.updated_at,
      finalizedAt: o.snapshot ? JSON.parse(o.snapshot).finalizedAt : null,
      lines, computed, garnishOverrides,
    };
  }

  function parseHead(b) {
    const guests = V.dec(b.guests, 'Gästezahl', { min: 0, max: 100000 });
    if (guests !== null && guests.includes('.')) throw V.bad('Die Gästezahl muss eine ganze Zahl sein.');
    return {
      name: V.str(b.name, 'Name der Bestellung', { required: true, max: 200 }),
      number: V.str(b.number, 'Projektnummer', { max: 40 }),
      eventDate: V.str(b.eventDate, 'Veranstaltungsdatum', { max: 40 }),
      guests,
      guestsSource: V.str(b.guestsSource, 'Quelle der Gästezahl', { max: 200 }),
      glassesPerPerson: V.dec(b.glassesPerPerson, 'Gläser pro Person', { minExclusive: 0, max: 50 }),
    };
  }
  function parseGlasses(v, label) {
    if (V.isEmpty(v)) return null;
    const s = String(v).trim();
    if (!/^\d{1,5}$/.test(s)) throw V.bad(`${label}: Die Anzahl der Gläser muss eine ganze Zahl sein.`);
    return String(Number(s));
  }

  // ---- Rentman: Blöcke und Speisen eines Projekts ----
  r.get('/orders/rentman/:projectId', ah(async (req, res) => {
    if (!rentman.isConfigured()) throw new ApiError(503, 'Rentman ist nicht angebunden (RENTMAN_API fehlt).');
    let data;
    try { data = await rentman.fetchProjectCatering(req.params.projectId); }
    catch (e) { throw new ApiError(e.status === 400 ? 400 : 502, e.status === 400 ? e.message : `Die Rentman-Verbindung ist derzeit nicht verfügbar. ${e.message}`); }
    const open = db.prepare("SELECT id FROM catering_orders WHERE rentman_project_id = ? AND status = 'entwurf'").get(data.project.id);
    res.json({ ...data, openOrderId: open ? open.id : null });
  }));

  r.get('/orders', (req, res) => {
    const rows = db.prepare('SELECT id FROM catering_orders ORDER BY COALESCE(event_date, created_at) DESC, id DESC LIMIT 200').all();
    res.json(rows.map(x => {
      const o = loadOrder(x.id);
      return { id: o.id, name: o.name, number: o.number, eventDate: o.eventDate, status: o.status, guests: o.guests,
        totalGlasses: o.computed.totalGlasses, complete: o.computed.complete, lineCount: o.lines.length, updatedAt: o.updatedAt || o.createdAt };
    }));
  });

  r.post('/orders', (req, res) => {
    const head = parseHead(req.body);
    const rentmanProjectId = V.isEmpty(req.body.rentmanProjectId) ? null : String(req.body.rentmanProjectId).trim();
    if (rentmanProjectId && !/^\d+$/.test(rentmanProjectId)) throw V.bad('Die Rentman-Projekt-ID ist ungültig.');
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (lines.length > 200) throw V.bad('Zu viele Speisen (höchstens 200).');
    if (rentmanProjectId) {
      const open = db.prepare("SELECT id FROM catering_orders WHERE rentman_project_id = ? AND status = 'entwurf'").get(rentmanProjectId);
      if (open) throw new ApiError(409, 'Für dieses Projekt gibt es bereits eine offene Bestellung.', { openOrderId: open.id });
    }
    const aliasDish = db.prepare('SELECT dish_id FROM catering_dish_aliases a JOIN catering_dishes d ON d.id = a.dish_id WHERE a.alias = ? AND d.archived = 0');
    let id;
    db.transaction(() => {
      id = db.prepare(`INSERT INTO catering_orders (rentman_project_id, number, name, event_date, guests, guests_source, glasses_per_person, created_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
        .run(rentmanProjectId, head.number, head.name, head.eventDate, head.guests, head.guestsSource, head.glassesPerPerson, req.session.userId).lastInsertRowid;
      const ins = db.prepare('INSERT INTO catering_order_lines (order_id, dish_id, rentman_row_id, rentman_name, block_name, sort) VALUES (?, ?, ?, ?, ?, ?)');
      lines.forEach((l, i) => {
        const rentmanName = V.str(l.rentmanName, 'Name der Speise', { max: 200 });
        const known = rentmanName ? aliasDish.get(normName(rentmanName)) : null;     // nur bestätigte Zuordnungen
        ins.run(id, known ? known.dish_id : null, V.str(l.rentmanRowId, 'Rentman-Zeile', { max: 40 }), rentmanName, V.str(l.blockName, 'Block', { max: 200 }), i);
      });
    })();
    audit(req, 'bestellung', id, 'angelegt', { name: head.name, rentmanProjectId });
    res.json(loadOrder(id));
  });

  r.get('/orders/:id', (req, res) => res.json(loadOrder(V.id(req.params.id, 'Bestellung'))));

  r.put('/orders/:id', (req, res) => {
    const id = V.id(req.params.id, 'Bestellung');
    const head = parseHead(req.body);
    const rev = V.id(req.body.rev, 'Versionsstand');
    const lines = Array.isArray(req.body.lines) ? req.body.lines : null;
    if (!lines) throw V.bad('Die Speisenliste fehlt.');
    if (lines.length > 200) throw V.bad('Zu viele Speisen (höchstens 200).');
    const parsed = lines.map((l, i) => {
      const where = `Zeile ${i + 1}`;
      let dishId = null;
      if (!V.isEmpty(l.dishId)) {
        dishId = V.id(l.dishId, `${where}: Speise`);
        if (!db.prepare('SELECT 1 FROM catering_dishes WHERE id = ?').get(dishId)) throw V.bad(`${where}: Die Speise gibt es nicht.`);
      }
      return { dishId, glasses: parseGlasses(l.glasses, where), rentmanName: V.str(l.rentmanName, 'Name', { max: 200 }),
        rentmanRowId: V.str(l.rentmanRowId, 'Rentman-Zeile', { max: 40 }), blockName: V.str(l.blockName, 'Block', { max: 200 }) };
    });
    db.transaction(() => {
      const cur = db.prepare('SELECT status FROM catering_orders WHERE id = ?').get(id);
      if (!cur) throw new ApiError(404, 'Bestellung nicht gefunden.');
      if (cur.status !== 'entwurf') throw new ApiError(409, 'Eine abgeschlossene Bestellung lässt sich nicht ändern. Bitte zuerst wieder öffnen.');
      const info = db.prepare(`UPDATE catering_orders SET name = ?, number = ?, event_date = ?, guests = ?, guests_source = ?, glasses_per_person = ?,
        rev = rev + 1, updated_at = datetime('now') WHERE id = ? AND rev = ?`).run(head.name, head.number, head.eventDate, head.guests, head.guestsSource, head.glassesPerPerson, id, rev);
      if (!info.changes) throw conflictChanged();
      db.prepare('DELETE FROM catering_order_lines WHERE order_id = ?').run(id);
      const ins = db.prepare('INSERT INTO catering_order_lines (order_id, dish_id, rentman_row_id, rentman_name, block_name, glasses, sort) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const saveAlias = db.prepare('INSERT INTO catering_dish_aliases (dish_id, alias) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET dish_id = excluded.dish_id, confirmed_at = datetime(\'now\')');
      parsed.forEach((l, i) => {
        ins.run(id, l.dishId, l.rentmanRowId, l.rentmanName, l.blockName, l.glasses, i);
        // Die Auswahl des Benutzers ist die Bestätigung und gilt für künftige Importe
        if (l.dishId && l.rentmanName && normName(l.rentmanName)) saveAlias.run(l.dishId, normName(l.rentmanName));
      });
    })();
    audit(req, 'bestellung', id, 'geändert', { guests: head.guests, glassesPerPerson: head.glassesPerPerson, zeilen: parsed.length });
    res.json(loadOrder(id));
  });

  // Manuelle Gesamtmenge einer Garnitur (nur für diese Bestellung). qty leer = Überschreibung entfernen.
  // `key` stammt aus der Einkaufsliste (computed.shopping[].key), `rev` ist der Stand, auf dem der Benutzer aufbaut.
  r.post('/orders/:id/garnish-override', (req, res) => {
    const id = V.id(req.params.id, 'Bestellung');
    const rev = V.id(req.body.rev, 'Versionsstand');
    const key = V.str(req.body.key, 'Garnitur', { required: true, max: 200 });
    const qty = V.dec(req.body.qty, 'Menge', { minExclusive: 0, max: 1000000 });
    const unit = qty === null ? null : V.unit(req.body.unit, 'Einheit');
    const note = V.str(req.body.note, 'Bemerkung', { max: 200 });
    db.transaction(() => {
      const cur = db.prepare('SELECT status FROM catering_orders WHERE id = ?').get(id);
      if (!cur) throw new ApiError(404, 'Bestellung nicht gefunden.');
      if (cur.status !== 'entwurf') throw new ApiError(409, 'Eine abgeschlossene Bestellung lässt sich nicht ändern. Bitte zuerst wieder öffnen.');
      const info = db.prepare("UPDATE catering_orders SET rev = rev + 1, updated_at = datetime('now') WHERE id = ? AND rev = ?").run(id, rev);
      if (!info.changes) throw conflictChanged();
      if (qty === null) {
        db.prepare('DELETE FROM catering_order_garnish_overrides WHERE order_id = ? AND key = ?').run(id, key);
        return;
      }
      // Nur Garnituren, die in dieser Bestellung vorkommen, dürfen überschrieben werden
      const shopping = loadOrder(id).computed.shopping.find(x => x.kind === 'garnitur' && x.key === key);
      const existing = db.prepare('SELECT name FROM catering_order_garnish_overrides WHERE order_id = ? AND key = ?').get(id, key);
      if (!shopping && !existing) throw V.bad('Diese Garnitur kommt in der Bestellung nicht vor.');
      db.prepare(`INSERT INTO catering_order_garnish_overrides (order_id, key, name, qty, unit, note) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(order_id, key) DO UPDATE SET qty = excluded.qty, unit = excluded.unit, note = excluded.note, updated_at = datetime('now')`)
        .run(id, key, shopping ? shopping.name : existing.name, qty, unit, note);
    })();
    audit(req, 'bestellung', id, qty === null ? 'Garnitur-Menge zurückgesetzt' : 'Garnitur-Menge manuell festgelegt', { key, qty, unit, note });
    res.json(loadOrder(id));
  });

  r.post('/orders/:id/finalize', (req, res) => {
    const id = V.id(req.params.id, 'Bestellung');
    const rev = V.id(req.body.rev, 'Versionsstand');
    const o = loadOrder(id);
    if (o.status !== 'entwurf') throw new ApiError(409, 'Diese Bestellung ist bereits abgeschlossen.');
    if (o.rev !== rev) throw conflictChanged();
    if (!o.computed.complete) throw new ApiError(400, 'Die Bestellung ist unvollständig und kann nicht abgeschlossen werden.', { warnings: o.computed.warnings });
    const snapshot = JSON.stringify({ finalizedAt: new Date().toISOString(), computed: o.computed,
      dishes: o.lines.map(l => l.dish).filter(Boolean) });
    const info = db.prepare("UPDATE catering_orders SET status = 'abgeschlossen', snapshot = ?, rev = rev + 1, updated_at = datetime('now') WHERE id = ? AND rev = ? AND status = 'entwurf'")
      .run(snapshot, id, rev);
    if (!info.changes) throw conflictChanged();
    audit(req, 'bestellung', id, 'abgeschlossen');
    res.json(loadOrder(id));
  });

  r.post('/orders/:id/reopen', (req, res) => {
    const id = V.id(req.params.id, 'Bestellung');
    try {
      const info = db.prepare("UPDATE catering_orders SET status = 'entwurf', snapshot = NULL, rev = rev + 1, updated_at = datetime('now') WHERE id = ? AND status = 'abgeschlossen'").run(id);
      if (!info.changes) throw new ApiError(409, 'Diese Bestellung ist nicht abgeschlossen.');
    } catch (e) {
      if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new ApiError(409, 'Für dieses Projekt gibt es bereits eine offene Bestellung.');
      throw e;
    }
    audit(req, 'bestellung', id, 'wieder geöffnet');
    res.json(loadOrder(id));
  });

  r.delete('/orders/:id', (req, res) => {
    const id = V.id(req.params.id, 'Bestellung');
    const cur = db.prepare('SELECT status FROM catering_orders WHERE id = ?').get(id);
    if (!cur) throw new ApiError(404, 'Bestellung nicht gefunden.');
    if (cur.status !== 'entwurf') throw new ApiError(409, 'Abgeschlossene Bestellungen lassen sich nicht löschen.');
    db.transaction(() => {
      db.prepare('DELETE FROM catering_order_garnish_overrides WHERE order_id = ?').run(id);
      db.prepare('DELETE FROM catering_order_lines WHERE order_id = ?').run(id);
      db.prepare('DELETE FROM catering_orders WHERE id = ?').run(id);
    })();
    audit(req, 'bestellung', id, 'gelöscht');
    res.json({ ok: true });
  });

  r.get('/orders/:id/pdf', ah(async (req, res) => {
    const o = loadOrder(V.id(req.params.id, 'Bestellung'));
    const kind = req.query.type === 'einkauf' ? 'einkauf' : 'bestellung';
    const pdf = await renderOrderPdf({ order: o, computed: o.computed, kind, logoPath: LOGO });
    const safe = o.name.replace(/[^\w\-äöüÄÖÜß]+/g, '_').slice(0, 60);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${kind === 'einkauf' ? 'Einkaufsliste' : 'Bestelluebersicht'}_${safe}.pdf"`,
      'Cache-Control': 'no-store' });
    res.send(pdf);
  }));

  return r;
}

module.exports = { createOrdersRouter };
