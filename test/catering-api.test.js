const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');
const { mount } = require('../modules/catering');
const calc = require('../modules/catering/calc');

// Minimaler Portal-Ersatz: Sitzung kommt aus dem Header x-test-user (JSON), requireAdmin wie im Portal.
async function setup() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT); INSERT INTO users VALUES (1, 'Admin Test'), (2, 'Mitarbeiter Test')");
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { const u = req.get('x-test-user'); req.session = u ? JSON.parse(u) : {}; next(); });
  const requireAdmin = (req, res, next) => (!req.session.userId || req.session.role !== 'admin') ? res.status(403).json({ error: 'Kein Zugriff' }) : next();
  mount(app, db, { requireAdmin });
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = user => async (method, path, body) => {
    const res = await fetch(base + path, { method, redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': JSON.stringify(user) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* keine JSON-Antwort */ }
    return { status: res.status, json, headers: res.headers };
  };
  return { db, admin: as({ userId: 1, role: 'admin' }), employee: as({ userId: 2, role: 'employee' }), anon: as(null),
    close: () => { server.close(); db.close(); } };
}

const flour = { name: 'Mehl (Testdaten)', goodsGroup: 'Trockenwaren', baseUnit: 'g', purchaseUnit: 'kg', packSize: '1' };

test('Berechtigungen: nur Admins, serverseitig', async () => {
  const t = await setup();
  try {
    for (const path of ['/api/catering/status', '/api/catering/ingredients', '/api/catering/recipes', '/api/catering/suppliers', '/api/catering/meta']) {
      assert.equal((await t.anon('GET', path)).status, 403, path);
      assert.equal((await t.employee('GET', path)).status, 403, path);
      assert.equal((await t.admin('GET', path)).status, 200, path);
    }
    assert.equal((await t.employee('POST', '/api/catering/ingredients', flour)).status, 403);
    assert.equal((await t.employee('POST', '/api/catering/recipes', {})).status, 403);
    assert.equal((await t.anon('GET', '/catering/')).status, 302);       // Seite: Weiterleitung zum Login
    assert.equal((await t.employee('GET', '/catering/')).status, 302);
    assert.equal((await t.admin('GET', '/catering/')).status, 200);
  } finally { t.close(); }
});

test('Zutaten: anlegen, Duplikat, ungültige Eingaben', async () => {
  const t = await setup();
  try {
    const ok = await t.admin('POST', '/api/catering/ingredients', flour);
    assert.equal(ok.status, 200);
    assert.equal(ok.json.rev, 1);
    const dup = await t.admin('POST', '/api/catering/ingredients', { ...flour, name: 'mehl (testdaten)' });
    assert.equal(dup.status, 409);                                       // Groß-/Kleinschreibung egal
    assert.equal((await t.admin('POST', '/api/catering/ingredients', { ...flour, name: '' })).status, 400);
    assert.equal((await t.admin('POST', '/api/catering/ingredients', { ...flour, name: 'X', baseUnit: 'kg' })).status, 400);
    assert.equal((await t.admin('POST', '/api/catering/ingredients', { ...flour, name: 'X', price: '-1' })).status, 400);
    assert.equal((await t.admin('POST', '/api/catering/ingredients', { ...flour, name: 'X', lossPct: '100' })).status, 400);
    assert.equal((await t.admin('POST', '/api/catering/ingredients', { ...flour, name: 'X', goodsGroup: 'gibt es nicht' })).status, 400);
    // Einkaufseinheit Liter bei Basiseinheit g ohne Dichte: nicht automatisch umrechenbar
    const unit = await t.admin('POST', '/api/catering/ingredients', { ...flour, name: 'Öl', purchaseUnit: 'l' });
    assert.equal(unit.status, 400);
    assert.match(unit.json.error, /nicht automatisch umgerechnet/);
    // mit Dichte geht es
    assert.equal((await t.admin('POST', '/api/catering/ingredients', { ...flour, name: 'Öl', purchaseUnit: 'l', densityGPerMl: '0,92' })).status, 200);
  } finally { t.close(); }
});

test('Ähnliche Namen bleiben getrennte Zutaten', async () => {
  const t = await setup();
  try {
    const a = await t.admin('POST', '/api/catering/ingredients', { ...flour, name: 'Tomaten' });
    const b = await t.admin('POST', '/api/catering/ingredients', { ...flour, name: 'Tomaten, passiert' });
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.notEqual(a.json.id, b.json.id);
  } finally { t.close(); }
});

test('Parallele Bearbeitung: veraltete Zutat wird nicht überschrieben', async () => {
  const t = await setup();
  try {
    const ing = (await t.admin('POST', '/api/catering/ingredients', flour)).json;
    const first = await t.admin('PUT', `/api/catering/ingredients/${ing.id}`, { ...flour, price: '1.20', rev: ing.rev });
    assert.equal(first.status, 200);
    assert.equal(first.json.rev, 2);
    const stale = await t.admin('PUT', `/api/catering/ingredients/${ing.id}`, { ...flour, price: '9.99', rev: ing.rev });
    assert.equal(stale.status, 409);
    assert.equal((await t.admin('GET', `/api/catering/ingredients/${ing.id}`)).json.price, '1.2');
  } finally { t.close(); }
});

async function recipeFixture(t) {
  const cam = (await t.admin('POST', '/api/catering/ingredients', { name: 'Camembert (Testdaten)', goodsGroup: 'Milchprodukte', baseUnit: 'g', purchaseUnit: 'kg', packSize: '1' })).json;
  const zw = (await t.admin('POST', '/api/catering/ingredients', { name: 'Zwiebeln (Testdaten)', goodsGroup: 'Obst und Gemüse', baseUnit: 'g', purchaseUnit: 'kg', packSize: '5' })).json;
  return { cam, zw, body: {
    name: 'Obazda (Testdaten)', articleNo: 'T-001', refQty: '10', calcUnit: 'Portionen',
    items: [{ ingredientId: cam.id, qty: '1000', unit: 'g' }, { ingredientId: zw.id, qty: '100', unit: 'g' }] } };
}

test('Rezepturversionierung: Änderung legt neue Version an, alte bleibt unverändert', async () => {
  const t = await setup();
  try {
    const { body, cam } = await recipeFixture(t);
    const created = await t.admin('POST', '/api/catering/recipes', body);
    assert.equal(created.status, 200);
    const id = created.json.id;
    assert.equal(created.json.version.version, 1);

    const edit = { ...body, baseVersion: 1, items: [{ ingredientId: cam.id, qty: '1,5', unit: 'kg' }, body.items[1]] };
    const v2 = await t.admin('PUT', `/api/catering/recipes/${id}`, edit);
    assert.equal(v2.status, 200);
    assert.equal(v2.json.newVersionCreated, true);
    assert.equal(v2.json.version.version, 2);

    const old = (await t.admin('GET', `/api/catering/recipes/${id}?version=1`)).json;
    assert.equal(old.items[0].qty, '1000');                  // Version 1 ist unverändert
    assert.equal(old.items[0].unit, 'g');
    assert.equal(v2.json.items[0].qty, '1.5');

    // unveränderter Inhalt erzeugt keine weitere Version
    const same = await t.admin('PUT', `/api/catering/recipes/${id}`, { ...edit, baseVersion: 2 });
    assert.equal(same.json.newVersionCreated, false);
    assert.equal(same.json.latestVersion, 2);
  } finally { t.close(); }
});

test('Rezeptur: zwei Benutzer speichern auf demselben Stand', async () => {
  const t = await setup();
  try {
    const { body } = await recipeFixture(t);
    const id = (await t.admin('POST', '/api/catering/recipes', body)).json.id;
    const a = await t.admin('PUT', `/api/catering/recipes/${id}`, { ...body, baseVersion: 1, refQty: '20' });
    const b = await t.admin('PUT', `/api/catering/recipes/${id}`, { ...body, baseVersion: 1, refQty: '30' });
    assert.equal(a.status, 200);
    assert.equal(b.status, 409);
    assert.equal((await t.admin('GET', `/api/catering/recipes/${id}`)).json.version.refQty, '20');
  } finally { t.close(); }
});

test('Rezeptur: Prüfungen und Eindeutigkeit der Zuordnung', async () => {
  const t = await setup();
  try {
    const { body, cam } = await recipeFixture(t);
    assert.equal((await t.admin('POST', '/api/catering/recipes', body)).status, 200);
    assert.equal((await t.admin('POST', '/api/catering/recipes', { ...body, name: 'Zweite' })).status, 409);       // gleiche Artikelnummer
    assert.equal((await t.admin('POST', '/api/catering/recipes', { ...body, articleNo: 'T-002', items: [] })).status, 400);
    assert.equal((await t.admin('POST', '/api/catering/recipes', { ...body, articleNo: 'T-002', refQty: '0' })).status, 400);
    const stk = await t.admin('POST', '/api/catering/recipes', { ...body, articleNo: 'T-002', items: [{ ingredientId: cam.id, qty: '2', unit: 'stk' }] });
    assert.equal(stk.status, 400);                                                                                  // Stück ohne Regel
    assert.match(stk.json.error, /nicht automatisch umgerechnet/);
    assert.equal((await t.admin('POST', '/api/catering/recipes', { ...body, articleNo: 'T-002', items: [{ ingredientId: 9999, qty: '2', unit: 'g' }] })).status, 400);
  } finally { t.close(); }
});

test('Rezeptur duplizieren und archivieren', async () => {
  const t = await setup();
  try {
    const { body } = await recipeFixture(t);
    const id = (await t.admin('POST', '/api/catering/recipes', body)).json.id;
    const copy = await t.admin('POST', `/api/catering/recipes/${id}/duplicate`);
    assert.equal(copy.status, 200);
    assert.equal(copy.json.articleNo, null);                  // Zuordnung wird nicht kopiert
    assert.match(copy.json.version.name, /\(Kopie\)$/);
    assert.equal(copy.json.items.length, 2);
    await t.admin('POST', `/api/catering/recipes/${id}/archive`, { archived: true });
    const list = (await t.admin('GET', '/api/catering/recipes')).json;
    assert.equal(list.length, 1);                              // archivierte Rezeptur ist ausgeblendet
    assert.equal((await t.admin('GET', '/api/catering/recipes?archived=1')).json.length, 2);
    // nach dem Archivieren darf die Artikelnummer neu vergeben werden
    assert.equal((await t.admin('POST', '/api/catering/recipes', body)).status, 200);
  } finally { t.close(); }
});

test('Änderungsprotokoll hält Benutzer fest', async () => {
  const t = await setup();
  try {
    const ing = (await t.admin('POST', '/api/catering/ingredients', flour)).json;
    const log = (await t.admin('GET', `/api/catering/audit?entity=zutat&id=${ing.id}`)).json;
    assert.equal(log[0].action, 'angelegt');
    assert.equal(log[0].userName, 'Admin Test');
  } finally { t.close(); }
});

test('Beispiel aus dem Auftrag: 10 kg + 10 % Puffer, 20 % Verlust, 5-kg-Gebinde', () => {
  // 100 Portionen benötigen laut Rezeptur 10 kg essbare Ware
  const recipe = { refQty: 100, items: [{ ingredientId: 1, qty: '10', unit: 'kg' }] };
  const ing = { 1: { name: 'Ware (Testdaten)', baseUnit: 'g', purchaseUnit: 'kg', packSize: '5', lossPct: '20' } };
  const { portions } = calc.portionsFor({ mode: 'fest', quantity: 100, bufferPct: 10 }, null);
  assert.equal(portions.toString(), '110');                                    // 110 Portionen = 11 kg essbar
  const [need] = calc.ingredientNeeds({ ...recipe, items: [{ ...recipe.items[0], lossPct: undefined }] }, portions, { 1: { ...ing[1], lossPct: undefined } });
  assert.equal(need.qty.toString(), '11000');                                  // 11 kg essbare Ware inkl. Puffer
  const [raw] = calc.ingredientNeeds(recipe, portions, ing);
  assert.equal(raw.qty.toString(), '13750');                                   // 13,75 kg Rohware
  const buy = calc.purchaseQuantity(raw.qty, ing[1]);
  assert.equal(buy.purchase.toString(), '15');                                 // 15 kg nach Gebinderundung
});
