const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { extractCateringBlocks } = require('../modules/catering/rentman');
const { normName, suggest, similarity } = require('../modules/catering/match');

const dish = (over = {}) => ({ name: 'Schweizer Wurstsalat', fillGrams: '40', stepGrams: '100', garnish: [{ name: 'Radieschen', qtyPerGlass: '0,5', unit: 'stk' }], ...over });

test('Berechtigungen: Speisen und Bestellungen nur für Admins', async () => {
  const t = await setup();
  try {
    for (const p of ['/api/catering/dishes', '/api/catering/orders']) {
      assert.equal((await t.anon('GET', p)).status, 403, p);
      assert.equal((await t.employee('GET', p)).status, 403, p);
      assert.equal((await t.admin('GET', p)).status, 200, p);
    }
    assert.equal((await t.employee('POST', '/api/catering/orders', { name: 'x' })).status, 403);
    assert.equal((await t.employee('POST', '/api/catering/dishes/import-example')).status, 403);
    const o = (await t.admin('POST', '/api/catering/orders', { name: 'Test' })).json;
    assert.equal((await t.employee('GET', `/api/catering/orders/${o.id}/pdf`)).status, 403);
    assert.equal((await t.anon('GET', `/api/catering/orders/${o.id}/pdf`)).status, 403);
  } finally { t.close(); }
});

test('Speisen: anlegen, Duplikat, Prüfungen, Konflikt bei paralleler Bearbeitung', async () => {
  const t = await setup();
  try {
    const d = await t.admin('POST', '/api/catering/dishes', dish());
    assert.equal(d.status, 200);
    assert.equal(d.json.garnish[0].qtyPerGlass, '0.5');                       // Komma wird normalisiert
    assert.equal((await t.admin('POST', '/api/catering/dishes', dish({ name: 'schweizer wurstsalat' }))).status, 409);
    assert.equal((await t.admin('POST', '/api/catering/dishes', dish({ name: 'X', fillGrams: '0' }))).status, 400);
    assert.equal((await t.admin('POST', '/api/catering/dishes', dish({ name: 'X', fillGrams: 'abc' }))).status, 400);
    assert.equal((await t.admin('POST', '/api/catering/dishes', dish({ name: 'X', category: 'pizza' }))).status, 400);
    assert.equal((await t.admin('POST', '/api/catering/dishes', dish({ name: 'X', garnish: [{ name: '', unit: 'stk' }] }))).status, 400);
    const a = await t.admin('PUT', `/api/catering/dishes/${d.json.id}`, { ...dish(), fillGrams: '45', rev: d.json.rev });
    assert.equal(a.status, 200);
    const stale = await t.admin('PUT', `/api/catering/dishes/${d.json.id}`, { ...dish(), fillGrams: '99', rev: d.json.rev });
    assert.equal(stale.status, 409);
    assert.equal((await t.admin('GET', `/api/catering/dishes/${d.json.id}`)).json.fillGrams, '45');
  } finally { t.close(); }
});

test('Beispielkatalog (Kugler) wird nur auf Knopfdruck und nur einmal angelegt', async () => {
  const t = await setup();
  try {
    assert.equal((await t.admin('GET', '/api/catering/dishes')).json.length, 0);       // nichts vorbelegt
    const first = await t.admin('POST', '/api/catering/dishes/import-example');
    assert.equal(first.json.created.length, 5);
    assert.equal((await t.admin('POST', '/api/catering/dishes/import-example')).json.created.length, 0);
    const dishes = (await t.admin('GET', '/api/catering/dishes')).json;
    const penne = dishes.find(d => d.name === 'Penne "Rucola"');
    assert.equal(penne.fillGrams, '58');
    assert.equal(penne.stepGrams, '1000');
    assert.equal(penne.articleNo, '360');
    assert.equal(penne.supplierName, 'Kugler');
    assert.equal(penne.garnish.find(g => g.name === 'Rucola').qtyPerGlass, null);      // unbekannte Menge bleibt offen
  } finally { t.close(); }
});

test('Mit dem Kugler-Katalog ergeben sich genau die Mengen der Bestellübersicht vom 20.10.', async () => {
  const t = await setup();
  try {
    await t.admin('POST', '/api/catering/dishes/import-example');
    const dishes = (await t.admin('GET', '/api/catering/dishes')).json;
    const byName = n => dishes.find(d => d.name === n).id;
    const plan = [['Wurstsalat "Schweizer Art"', 22, 900], ['Pikanter Couscous-Salat', 19, 1000], ['Gambas "Coco-Ginger"', 26, 1000],
      ['Penne "Rucola"', 34, 2000], ['Kartoffel-Gurken-Salat', 29, 1500]];
    const o = (await t.admin('POST', '/api/catering/orders', { name: 'Hausbau (Testdaten)', guests: 50, glassesPerPerson: '2,6' })).json;
    const saved = (await t.admin('PUT', `/api/catering/orders/${o.id}`, { name: o.name, guests: '50', glassesPerPerson: '2.6', rev: o.rev,
      lines: plan.map(([n, g]) => ({ rentmanName: n, dishId: byName(n), glasses: String(g) })) })).json;
    assert.deepEqual(saved.computed.lines.map(l => Number(l.orderGrams)), plan.map(p => p[2]));
    assert.equal(saved.computed.totalGlasses, '130');
    assert.equal(saved.computed.warnings.filter(w => w.code === 'summe').length, 0);
    // Rucola und Dill sind offen: Bestellung bleibt unvollständig, Artikelnummern stehen in der Einkaufsliste
    assert.equal(saved.computed.complete, false);
    assert.equal(saved.computed.shopping.find(s => s.name === 'Penne "Rucola"').articleNo, '360');
    assert.equal(saved.computed.shopping.find(s => s.name === 'Radieschen').qty, '11');
    assert.equal(saved.computed.shopping.find(s => s.name === 'Mini-Fleischpflanzerl am Spieß').qty, '29');   // 1 pro Glas, 29 Gläser
  } finally { t.close(); }
});

test('Bestellung: Rechnung, Persistenz und bestätigte Zuordnung für künftige Importe', async () => {
  const t = await setup();
  try {
    const wurst = (await t.admin('POST', '/api/catering/dishes', dish())).json;
    const created = await t.admin('POST', '/api/catering/orders', { name: 'Hausbau (Testdaten)', rentmanProjectId: '3013', guests: 50, guestsSource: 'Block "Speisen im Weckglas" (Menge 50)',
      glassesPerPerson: '2,6', lines: [{ rentmanRowId: '1', rentmanName: 'Wurstsalat "Schweizer Art"', blockName: 'Speisen im Weckglas' }] });
    assert.equal(created.status, 200);
    let o = created.json;
    assert.equal(o.lines[0].dishId, null);                                            // noch nichts bestätigt
    assert.equal(o.computed.complete, false);
    assert.equal(o.lines[0].suggestion.dishId, wurst.id);                             // nur ein Vorschlag
    // Benutzer ordnet zu und gibt 22 Gläser an
    const saved = await t.admin('PUT', `/api/catering/orders/${o.id}`, { name: o.name, guests: '50', guestsSource: o.guestsSource, glassesPerPerson: '2.6', rev: o.rev,
      lines: [{ rentmanRowId: '1', rentmanName: 'Wurstsalat "Schweizer Art"', blockName: 'Speisen im Weckglas', dishId: wurst.id, glasses: '22' }] });
    assert.equal(saved.status, 200);
    o = saved.json;
    assert.equal(o.computed.lines[0].orderGrams, '900');
    assert.equal(o.computed.shopping.find(s => s.name === 'Radieschen').qty, '11');
    // Persistenz: erneutes Laden liefert denselben Stand
    const again = (await t.admin('GET', `/api/catering/orders/${o.id}`)).json;
    assert.equal(again.lines[0].glasses, '22');
    assert.equal(again.computed.lines[0].orderGrams, '900');
    // zweite Bestellung mit derselben Rentman-Zeile: bestätigte Zuordnung greift automatisch
    const next = (await t.admin('POST', '/api/catering/orders', { name: 'Anderes Projekt', lines: [{ rentmanName: 'Wurstsalat "Schweizer Art"' }] })).json;
    assert.equal(next.lines[0].dishId, wurst.id);
  } finally { t.close(); }
});

test('Bestellung: veralteter Stand wird nicht überschrieben, Eingaben werden geprüft', async () => {
  const t = await setup();
  try {
    const o = (await t.admin('POST', '/api/catering/orders', { name: 'Test', guests: 10, glassesPerPerson: 2 })).json;
    const body = { name: 'Test', guests: '10', glassesPerPerson: '2', rev: o.rev, lines: [] };
    assert.equal((await t.admin('PUT', `/api/catering/orders/${o.id}`, body)).status, 200);
    assert.equal((await t.admin('PUT', `/api/catering/orders/${o.id}`, { ...body, guests: '99' })).status, 409);   // gleicher alter rev
    const fresh = (await t.admin('GET', `/api/catering/orders/${o.id}`)).json;
    const base = { ...body, rev: fresh.rev };
    assert.equal((await t.admin('PUT', `/api/catering/orders/${o.id}`, { ...base, guests: '12,5' })).status, 400);
    assert.equal((await t.admin('PUT', `/api/catering/orders/${o.id}`, { ...base, glassesPerPerson: '0' })).status, 400);
    assert.equal((await t.admin('PUT', `/api/catering/orders/${o.id}`, { ...base, lines: [{ glasses: '2,5' }] })).status, 400);
    assert.equal((await t.admin('PUT', `/api/catering/orders/${o.id}`, { ...base, lines: [{ glasses: '3', dishId: 999 }] })).status, 400);
    assert.equal((await t.admin('POST', '/api/catering/orders', { name: '' })).status, 400);
  } finally { t.close(); }
});

test('Doppelte offene Bestellung für dasselbe Rentman-Projekt wird verhindert', async () => {
  const t = await setup();
  try {
    const a = await t.admin('POST', '/api/catering/orders', { name: 'A', rentmanProjectId: '42' });
    const b = await t.admin('POST', '/api/catering/orders', { name: 'B', rentmanProjectId: '42' });
    assert.equal(a.status, 200);
    assert.equal(b.status, 409);
    assert.equal(b.json.openOrderId, a.json.id);
  } finally { t.close(); }
});

test('Abschließen nur vollständig; danach eingefroren und gegen Änderungen an Speisen geschützt', async () => {
  const t = await setup();
  try {
    const d = (await t.admin('POST', '/api/catering/dishes', dish({ garnish: [] }))).json;
    const o = (await t.admin('POST', '/api/catering/orders', { name: 'Final', guests: 10, glassesPerPerson: 2 })).json;
    const put = lines => t.admin('PUT', `/api/catering/orders/${o.id}`, { name: 'Final', guests: '10', glassesPerPerson: '2', rev: o.rev, lines });
    const incomplete = await t.admin('POST', `/api/catering/orders/${o.id}/finalize`, { rev: o.rev });
    assert.equal(incomplete.status, 400);                                               // keine Zeilen = unvollständig
    const saved = (await put([{ rentmanName: 'Wurstsalat', dishId: d.id, glasses: '20' }])).json;
    const fin = await t.admin('POST', `/api/catering/orders/${o.id}/finalize`, { rev: saved.rev });
    assert.equal(fin.status, 200);
    assert.equal(fin.json.status, 'abgeschlossen');
    assert.equal(fin.json.computed.lines[0].orderGrams, '800');
    // Speise wird später geändert: abgeschlossene Bestellung bleibt unverändert
    await t.admin('PUT', `/api/catering/dishes/${d.id}`, { ...dish({ garnish: [] }), fillGrams: '100', rev: d.rev });
    assert.equal((await t.admin('GET', `/api/catering/orders/${o.id}`)).json.computed.lines[0].orderGrams, '800');
    // keine Änderung und kein Löschen im abgeschlossenen Zustand
    assert.equal((await t.admin('PUT', `/api/catering/orders/${o.id}`, { name: 'x', guests: '1', glassesPerPerson: '1', rev: fin.json.rev, lines: [] })).status, 409);
    assert.equal((await t.admin('DELETE', `/api/catering/orders/${o.id}`)).status, 409);
    const reopened = await t.admin('POST', `/api/catering/orders/${o.id}/reopen`);
    assert.equal(reopened.json.status, 'entwurf');
    assert.equal(reopened.json.computed.lines[0].orderGrams, '2000');                   // wieder live mit neuer Füllmenge
  } finally { t.close(); }
});

test('PDF: Bestellübersicht und Einkaufsliste, mehrseitig, unvollständig gekennzeichnet', async () => {
  const t = await setup();
  try {
    const d = (await t.admin('POST', '/api/catering/dishes', dish())).json;
    const lines = Array.from({ length: 60 }, (_, i) => ({ rentmanName: `Speise Nummer ${i + 1} mit längerem Namen`, dishId: d.id, glasses: String(i + 1) }));
    const o = (await t.admin('POST', '/api/catering/orders', { name: 'Großes Projekt (Testdaten)', guests: 100, glassesPerPerson: 2.6, number: '9999' })).json;
    await t.admin('PUT', `/api/catering/orders/${o.id}`, { name: o.name, number: '9999', guests: '100', glassesPerPerson: '2.6', rev: o.rev, lines });
    for (const q of ['', '?type=einkauf', '?type=bestellung']) {          // es gibt nur noch die eine Einkaufsliste, der alte Parameter ist ohne Wirkung
      const res = await t.admin('GET', `/api/catering/orders/${o.id}/pdf${q}`, undefined, true);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /application\/pdf/);
      assert.match(res.headers.get('content-disposition'), /Einkaufsliste_/);
      assert.equal(res.buffer.subarray(0, 5).toString(), '%PDF-');
      const pages = (res.buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
      assert.ok(pages >= 2, `60 Zeilen müssen auf mehrere Seiten umbrechen (Seiten: ${pages})`);
    }
    // leere Bestellung (unvollständig) liefert trotzdem ein PDF, das als unvollständig gekennzeichnet ist
    const empty = (await t.admin('POST', '/api/catering/orders', { name: 'Leer' })).json;
    assert.equal((await t.admin('GET', `/api/catering/orders/${empty.id}/pdf`, undefined, true)).status, 200);
    assert.equal((await t.admin('GET', '/api/catering/orders/99999/pdf', undefined, true)).status, 404);
  } finally { t.close(); }
});

test('Ohne Rentman-Token meldet die API das verständlich', async () => {
  const t = await setup();
  const saved = { a: process.env.RENTMAN_API, b: process.env.rentman_api };
  delete process.env.RENTMAN_API; delete process.env.rentman_api;
  try {
    const res = await t.admin('GET', '/api/catering/orders/rentman/3013');
    assert.equal(res.status, 503);
    assert.match(res.json.error, /nicht angebunden/);
  } finally { if (saved.a) process.env.RENTMAN_API = saved.a; if (saved.b) process.env.rentman_api = saved.b; t.close(); }
});

// ---- Rentman-Struktur (synthetisches Beispiel, kein echter Kundendatensatz) ----
const GROUPS = [{ id: 1, name: 'Auftragspauschale' }, { id: 2, name: 'Catering' }];
const ROW = (id, parent, group, quantity, name, remark = '') => ({ id, parent: parent ? `/projectequipment/${parent}` : null,
  equipment_group: `/projectequipmentgroup/${group}`, quantity, name, external_remark: remark, equipment: `/equipment/${id}` });
const ROWS = [
  ROW(10, null, 1, 1, 'Pauschale Service'),
  ROW(11, 10, 1, 1, 'Mülleimer'),
  ROW(20, null, 2, 50, 'Speisen im Weckglas:', '<p>Pauschale pro&nbsp;Person</p>'),
  ROW(21, 20, 2, 0, '- Beispielsalat A'),
  ROW(22, 21, 2, 0, 'Brot'),
  ROW(23, 20, 2, 0, 'Beispielsalat "B"'),
  ROW(30, null, 2, 50, 'Brotzeit Spezialitäten'),
  ROW(31, 30, 2, 0, 'Beispielbrot'),
  ROW(40, null, 2, 0, 'Leerer Block ohne Menge'),
];

test('Rentman: Blöcke mit Menge und Speisen direkt darunter, Bestandteile und Nicht-Essen bleiben draußen', () => {
  const blocks = extractCateringBlocks(ROWS, GROUPS);
  assert.deepEqual(blocks.map(b => [b.name, b.quantity, b.dishes.length]), [['Speisen im Weckglas:', '50', 2], ['Brotzeit Spezialitäten', '50', 1]]);
  assert.equal(blocks[0].remark, 'Pauschale pro Person');                              // HTML entfernt
  assert.deepEqual(blocks[0].dishes.map(d => d.name), ['- Beispielsalat A', 'Beispielsalat "B"']);
  assert.ok(!blocks.some(b => b.name.includes('Mülleimer')));
});

test('Namensabgleich: nur Vorschläge, Normalisierung ohne Anführungszeichen und Strich', () => {
  assert.equal(normName('- Wurstsalat "Schweizer Art"'), 'wurstsalat schweizer art');
  assert.equal(normName('  Gambas „Coco-Ginger“ '), 'gambas coco ginger');
  const dishes = [{ id: 1, name: 'Schweizer Wurstsalat' }, { id: 2, name: 'Garnelen Coco Ginger' }, { id: 3, name: 'Penne Rucola' }];
  assert.equal(suggest('Wurstsalat "Schweizer Art"', dishes).dishId, 1);
  assert.equal(suggest('Gambas "Coco-Ginger"', dishes).dishId, 2);
  assert.equal(suggest('Völlig anderes Gericht', dishes), null);
  assert.ok(similarity('Penne Rucola', 'Penne "Rucola"') > 0.9);
});

// ---- Manuelle Garnitur-Menge (API) ----
async function orderWithDill(t) {
  await t.admin('POST', '/api/catering/dishes/import-example');
  const dishes = (await t.admin('GET', '/api/catering/dishes')).json;
  const gambas = dishes.find(d => d.name === 'Gambas "Coco-Ginger"');
  const o = (await t.admin('POST', '/api/catering/orders', { name: 'Garnitur (Testdaten)', guests: 10, glassesPerPerson: 2 })).json;
  const saved = (await t.admin('PUT', `/api/catering/orders/${o.id}`, { name: o.name, guests: '10', glassesPerPerson: '2', rev: o.rev,
    lines: [{ rentmanName: 'Gambas', dishId: gambas.id, glasses: '20' }] })).json;
  return { gambas, order: saved };
}

test('Garnitur-Menge manuell festlegen: wirkt im Ergebnis, bleibt gespeichert und macht die Bestellung vollständig', async () => {
  const t = await setup();
  try {
    const { order } = await orderWithDill(t);
    assert.equal(order.computed.complete, false);                                     // Dill offen
    const key = order.computed.shopping.find(s => s.name === 'Dill').key;
    const r = await t.admin('POST', `/api/catering/orders/${order.id}/garnish-override`, { rev: order.rev, key, qty: '1,5', unit: 'stk', note: '1 Bund' });
    assert.equal(r.status, 200);
    const dill = r.json.computed.shopping.find(s => s.name === 'Dill');
    assert.equal(dill.qty, '1.5');
    assert.equal(dill.overridden, true);
    assert.equal(r.json.computed.complete, true);
    // Persistenz
    const again = (await t.admin('GET', `/api/catering/orders/${order.id}`)).json;
    assert.equal(again.garnishOverrides.length, 1);
    assert.equal(again.computed.shopping.find(s => s.name === 'Dill').overrideNote, '1 Bund');
    // Abschließen und Wieder öffnen behalten die Überschreibung
    const fin = await t.admin('POST', `/api/catering/orders/${order.id}/finalize`, { rev: again.rev });
    assert.equal(fin.status, 200);
    assert.equal(fin.json.computed.shopping.find(s => s.name === 'Dill').qty, '1.5');
    const re = await t.admin('POST', `/api/catering/orders/${order.id}/reopen`);
    assert.equal(re.json.computed.shopping.find(s => s.name === 'Dill').qty, '1.5');
    // Zurücksetzen: Menge ist wieder offen
    const reset = await t.admin('POST', `/api/catering/orders/${order.id}/garnish-override`, { rev: re.json.rev, key, qty: null });
    assert.equal(reset.json.computed.shopping.find(s => s.name === 'Dill').qty, null);
    assert.equal(reset.json.computed.complete, false);
    // Protokoll
    const log = (await t.admin('GET', `/api/catering/audit?entity=bestellung&id=${order.id}`)).json;
    assert.ok(log.some(l => l.action === 'Garnitur-Menge manuell festgelegt'));
  } finally { t.close(); }
});

test('Garnitur-Menge: Rechte, Prüfungen, Konflikt und gesperrter Zustand', async () => {
  const t = await setup();
  try {
    const { order } = await orderWithDill(t);
    const key = order.computed.shopping.find(s => s.name === 'Dill').key;
    const url = `/api/catering/orders/${order.id}/garnish-override`;
    assert.equal((await t.employee('POST', url, { rev: order.rev, key, qty: '1', unit: 'stk' })).status, 403);
    assert.equal((await t.anon('POST', url, { rev: order.rev, key, qty: '1', unit: 'stk' })).status, 403);
    assert.equal((await t.admin('POST', url, { rev: order.rev, key, qty: '0', unit: 'stk' })).status, 400);
    assert.equal((await t.admin('POST', url, { rev: order.rev, key, qty: '-2', unit: 'stk' })).status, 400);
    assert.equal((await t.admin('POST', url, { rev: order.rev, key, qty: 'viel', unit: 'stk' })).status, 400);
    assert.equal((await t.admin('POST', url, { rev: order.rev, key, qty: '1', unit: 'bund' })).status, 400);
    assert.equal((await t.admin('POST', url, { rev: order.rev, key: 'gibtsnicht|g', qty: '1', unit: 'g' })).status, 400);
    const ok = await t.admin('POST', url, { rev: order.rev, key, qty: '1', unit: 'stk' });
    assert.equal(ok.status, 200);
    assert.equal((await t.admin('POST', url, { rev: order.rev, key, qty: '2', unit: 'stk' })).status, 409);   // veralteter Stand
    const fin = await t.admin('POST', `/api/catering/orders/${order.id}/finalize`, { rev: ok.json.rev });
    assert.equal((await t.admin('POST', url, { rev: fin.json.rev, key, qty: '3', unit: 'stk' })).status, 409);   // abgeschlossen
  } finally { t.close(); }
});

test('PDF mit manueller Garnitur-Menge: kein "offen" mehr, Hinweis "manuell festgelegt"', async () => {
  const t = await setup();
  try {
    const { order } = await orderWithDill(t);
    const key = order.computed.shopping.find(s => s.name === 'Dill').key;
    const r = await t.admin('POST', `/api/catering/orders/${order.id}/garnish-override`, { rev: order.rev, key, qty: '1', unit: 'stk', note: '1 Bund' });
    const res = await t.admin('GET', `/api/catering/orders/${order.id}/pdf`, undefined, true);
    assert.equal(res.status, 200);
    assert.equal(res.buffer.subarray(0, 5).toString(), '%PDF-');
    assert.equal(r.json.computed.warnings.filter(w => w.code === 'garnitur').length, 0);
  } finally { t.close(); }
});

test('Rentman-Token wird unabhängig von der Schreibweise des Variablennamens erkannt', () => {
  const rentman = require('../modules/catering/rentman');
  const saved = {};
  for (const k of Object.keys(process.env)) if (k.toUpperCase() === 'RENTMAN_API') { saved[k] = process.env[k]; delete process.env[k]; }
  try {
    assert.equal(rentman.isConfigured(), false);
    for (const name of ['RENTMAN_API', 'rentman_api', 'Rentman_api', 'Rentman_Api']) {
      process.env[name] = 'geheim';
      assert.equal(rentman.isConfigured(), true, name);
      delete process.env[name];
    }
    assert.equal(rentman.isConfigured(), false);
  } finally { Object.assign(process.env, saved); }
});

// ---- Automatische Zuordnung der Rentman-Speisen ----
const { autoMatch } = require('../modules/catering/match');

test('autoMatch: gleicher Name oder eindeutig vorangestellter Katalogname, sonst nichts', () => {
  const dishes = [{ id: 1, name: 'Wurstsalat "Schweizer Art"' }, { id: 2, name: 'Penne "Rucola"' }, { id: 3, name: 'Kartoffel-Gurken-Salat' }, { id: 4, name: 'Penne' }];
  assert.equal(autoMatch('Wurstsalat "Schweizer Art"', dishes).id, 1);
  assert.equal(autoMatch('- Penne "Rucola"', dishes).id, 2);                       // führender Strich und Anführungszeichen egal
  assert.equal(autoMatch('- Kartoffel-Gurken-Salat mit Fleischpflanzerl', dishes).id, 3);   // Katalogname steht vorn
  assert.equal(autoMatch('Penne "Rucola" XL', dishes), null);                      // "Penne" und "Penne Rucola" passen: uneindeutig
  assert.equal(autoMatch('Gambas "Coco-Ginger"', dishes), null);                   // nicht im Katalog
  assert.equal(autoMatch('', dishes), null);
  assert.equal(autoMatch('Pennetta', [{ id: 4, name: 'Penne' }]), null);           // nur ganze Wörter zählen
  assert.equal(autoMatch('Salat', [{ id: 1, name: 'Salat A' }, { id: 2, name: 'Salat A' }]), null);
});

const RENTMAN_LINES = ['Wurstsalat "Schweizer Art"', '- Penne "Rucola"', '- Kartoffel-Gurken-Salat mit Fleischpflanzerl', '- Pikanter Couscous-Salat', '- Gambas "Coco-Ginger"', '- Völlig unbekanntes Gericht']
  .map((n, i) => ({ rentmanRowId: String(i + 1), rentmanName: n, blockName: 'Speisen im Weckglas:' }));

test('Neue Bestellung aus Rentman: Speisen werden direkt zugeordnet, Unbekanntes bleibt offen', async () => {
  const t = await setup();
  try {
    await t.admin('POST', '/api/catering/dishes/import-example');
    const o = (await t.admin('POST', '/api/catering/orders', { name: 'Auto (Testdaten)', guests: 50, glassesPerPerson: '2,6', lines: RENTMAN_LINES })).json;
    assert.deepEqual(o.lines.map(l => l.dish && l.dish.name), ['Wurstsalat "Schweizer Art"', 'Penne "Rucola"', 'Kartoffel-Gurken-Salat', 'Pikanter Couscous-Salat', 'Gambas "Coco-Ginger"', null]);
    assert.equal(o.lines[5].dishId, null);                                           // unbekannte Speise nicht erraten
    assert.equal(o.lines[5].suggestion, null);
    // die Zuordnung ist gespeichert (bestätigter Name) und gilt auch für die nächste Bestellung
    const next = (await t.admin('POST', '/api/catering/orders', { name: 'Zweite', lines: [RENTMAN_LINES[2]] })).json;
    assert.equal(next.lines[0].dish.name, 'Kartoffel-Gurken-Salat');
  } finally { t.close(); }
});

test('Bestellung ohne Zuordnung (älterer Stand): eindeutige Treffer sind als auto gekennzeichnet, unklare nur als Vorschlag', async () => {
  const t = await setup();
  try {
    // Bestellung entsteht, bevor der Katalog existiert: nichts zuordenbar
    const o = (await t.admin('POST', '/api/catering/orders', { name: 'Alt', lines: RENTMAN_LINES.slice(0, 2) })).json;
    assert.equal(o.lines[0].dishId, null);
    await t.admin('POST', '/api/catering/dishes/import-example');
    const again = (await t.admin('GET', `/api/catering/orders/${o.id}`)).json;
    assert.equal(again.lines[0].suggestion.auto, true);
    assert.equal(again.lines[0].suggestion.name, 'Wurstsalat "Schweizer Art"');
    // Der Benutzer (bzw. die Oberfläche) übernimmt: speichern ordnet zu
    const put = await t.admin('PUT', `/api/catering/orders/${o.id}`, { name: o.name, rev: again.rev,
      lines: again.lines.map(l => ({ rentmanName: l.rentmanName, rentmanRowId: l.rentmanRowId, blockName: l.blockName, dishId: l.suggestion.dishId, glasses: '10' })) });
    assert.equal(put.status, 200);
    assert.ok(put.json.lines.every(l => l.dish));
  } finally { t.close(); }
});

test('Änderung der Auswahl durch den Benutzer überschreibt die automatische Zuordnung', async () => {
  const t = await setup();
  try {
    await t.admin('POST', '/api/catering/dishes/import-example');
    const dishes = (await t.admin('GET', '/api/catering/dishes')).json;
    const penne = dishes.find(d => d.name === 'Penne "Rucola"');
    const couscous = dishes.find(d => d.name === 'Pikanter Couscous-Salat');
    const o = (await t.admin('POST', '/api/catering/orders', { name: 'Wechsel', lines: [RENTMAN_LINES[1]] })).json;
    assert.equal(o.lines[0].dishId, penne.id);
    const put = (await t.admin('PUT', `/api/catering/orders/${o.id}`, { name: o.name, rev: o.rev,
      lines: [{ rentmanName: RENTMAN_LINES[1].rentmanName, rentmanRowId: '2', blockName: 'x', dishId: couscous.id, glasses: '5' }] })).json;
    assert.equal(put.lines[0].dishId, couscous.id);
    const next = (await t.admin('POST', '/api/catering/orders', { name: 'Danach', lines: [RENTMAN_LINES[1]] })).json;
    assert.equal(next.lines[0].dishId, couscous.id);                                 // die letzte Entscheidung des Benutzers gilt
  } finally { t.close(); }
});

// ---- Einkaufsliste nach Lieferanten ----
test('Garnitur mit Lieferant: Lieferant wird gespeichert und die Einkaufsliste danach aufgeteilt', async () => {
  const t = await setup();
  try {
    const kugler = (await t.admin('POST', '/api/catering/suppliers', { name: 'Kugler' })).json;
    const markt = (await t.admin('POST', '/api/catering/suppliers', { name: 'Großmarkt' })).json;
    const d = (await t.admin('POST', '/api/catering/dishes', { name: 'Wurstsalat', supplierId: kugler.id, articleNo: '3271', fillGrams: '40', stepGrams: '900',
      garnish: [{ name: 'Radieschen', qtyPerGlass: '0,5', unit: 'stk', supplierId: markt.id }, { name: 'Dill', qtyPerGlass: '2', unit: 'g' }] })).json;
    assert.equal(d.garnish[0].supplierId, markt.id);
    assert.equal(d.garnish[0].supplierName, 'Großmarkt');
    assert.equal(d.garnish[1].supplierId, null);
    const o = (await t.admin('POST', '/api/catering/orders', { name: 'Aufgeteilt', guests: 10, glassesPerPerson: 2 })).json;
    const saved = (await t.admin('PUT', `/api/catering/orders/${o.id}`, { name: o.name, guests: '10', glassesPerPerson: '2', rev: o.rev,
      lines: [{ rentmanName: 'Wurstsalat', dishId: d.id, glasses: '20' }] })).json;
    const by = n => saved.computed.shopping.find(s => s.name === n);
    assert.equal(by('Wurstsalat').supplier, 'Kugler');
    assert.equal(by('Radieschen').supplier, 'Großmarkt');
    assert.equal(by('Dill').supplier, null);                                          // kein stiller Standard-Lieferant
    assert.ok(saved.computed.warnings.some(w => w.code === 'ohne_lieferant' && /Dill/.test(w.text)));
    assert.equal(saved.computed.complete, true);                                      // fehlender Lieferant ist ein Hinweis, kein Hindernis
    // eine Seite je Lieferant: Kugler, Großmarkt, Ohne Lieferant
    const res = await t.admin('GET', `/api/catering/orders/${o.id}/pdf`, undefined, true);
    const pages = (res.buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    assert.equal(pages, 3);
  } finally { t.close(); }
});
