const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

// Simulierte Rentman-API: Die echte Abrufkette (Statusliste, Projekte, Materialzeilen, Seitenabruf) läuft durch, nur das Netz fehlt.
const DAY = 86400000;
const iso = ms => new Date(Date.now() + ms).toISOString();
const ROW = (id, parent, group, quantity, name) => ({ id, parent: parent ? `/projectequipment/${parent}` : null,
  equipment_group: `/projectequipmentgroup/${group}`, quantity, name, external_remark: '', equipment: `/equipment/${id}` });
const GROUPS = [{ id: 1, name: 'Auftragspauschale' }, { id: 2, name: 'Catering' }];
const WITH_FOOD = [ROW(10, null, 1, 1, 'Pauschale'), ROW(20, null, 2, 50, 'Speisen im Weckglas'), ROW(21, 20, 2, 0, 'Wurstsalat'), ROW(22, 20, 2, 0, 'Penne')];
const NO_FOOD = [ROW(10, null, 1, 1, 'Pauschale'), ROW(11, 10, 1, 1, 'Mülleimer')];
const EMPTY_BLOCK = [ROW(20, null, 2, 50, 'Catering ohne Speisen')];

function makeState() {
  return {
    calls: {}, modified: {},
    projects: [
      { id: 1, number: 101, name: 'Firmenfeier mit Essen', start: iso(3 * DAY), status: 3, equipment: WITH_FOOD },
      { id: 2, number: 102, name: 'Bar ohne Essen', start: iso(2 * DAY), status: 3, equipment: NO_FOOD },
      { id: 3, number: 103, name: 'Leerer Cateringblock', start: iso(4 * DAY), status: 3, equipment: EMPTY_BLOCK },
      { id: 4, number: 104, name: 'Altes Event mit Essen', start: iso(-30 * DAY), status: 3, equipment: WITH_FOOD },
      { id: 5, number: 105, name: 'Anfrage mit Essen', start: iso(5 * DAY), status: 1, equipment: WITH_FOOD },
      { id: 6, number: 106, name: 'Rentman-Fehler', start: iso(6 * DAY), status: 3, equipment: null },
    ],
  };
}

function stubRentman(state) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = new URL(String(url));
    if (u.hostname !== 'api.rentman.net') return real(url, opts);
    const json = (data, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } });
    const p = u.pathname;
    if (p === '/statuses') return json([{ id: 3, name: 'Bestätigt' }, { id: 1, name: 'Anfrage' }]);
    if (p === '/subprojects') return json(state.projects.map(x => ({ id: x.id, project: `/projects/${x.id}`, status: `/statuses/${x.status}` })));
    if (p === '/projects') return json(state.projects.map(x => ({ id: x.id, number: x.number, name: x.name, planperiod_start: x.start, modified: state.modified[x.id] || 'v1' })));
    const single = p.match(/^\/projects\/(\d+)$/);
    if (single) {
      const x = state.projects.find(q => q.id === Number(single[1]));
      return x ? json({ id: x.id, number: x.number, name: x.name, planperiod_start: x.start }) : json({}, 404);
    }
    const m = p.match(/^\/projects\/(\d+)\/(projectequipment|projectequipmentgroup)$/);
    if (m) {
      const proj = state.projects.find(x => x.id === Number(m[1]));
      if (m[2] === 'projectequipment') state.calls[proj.id] = (state.calls[proj.id] || 0) + 1;
      if (!proj.equipment) return json([], 500);
      return json(m[2] === 'projectequipment' ? proj.equipment : GROUPS);
    }
    return json([], 404);
  };
  return () => { globalThis.fetch = real; };
}

async function withRentman(fn, mutate) {
  const state = makeState();
  if (mutate) mutate(state);
  const restore = stubRentman(state);
  const saved = {};
  for (const k of Object.keys(process.env)) if (k.toUpperCase() === 'RENTMAN_API') { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.RENTMAN_API = 'test-token';
  const t = await setup();
  try { await fn(t, state); }
  finally { t.close(); restore(); delete process.env.RENTMAN_API; Object.assign(process.env, saved); }
}

const names = r => r.json.projects.map(p => p.name);

test('Standardauswahl: nur bestätigte, kommende Projekte mit Speisen', async () => {
  await withRentman(async t => {
    const r = await t.admin('GET', '/api/catering/rentman/projects-with-food');
    assert.equal(r.status, 200);
    assert.deepEqual(names(r), ['Firmenfeier mit Essen']);                // ohne Essen, leerer Block, alt, unbestätigt: nicht dabei
    assert.equal(r.json.projects[0].speisen, 2);
    assert.equal(r.json.projects[0].bloecke, 1);
    assert.equal(r.json.fehler, 1);                                       // das Projekt mit Rentman-Fehler wurde nicht stillschweigend übergangen
  });
});

test('Alle Projekte: auch vergangene und unbestätigte, aber weiterhin nur mit Speisen', async () => {
  await withRentman(async t => {
    const r = await t.admin('GET', '/api/catering/rentman/projects-with-food?all=1');
    assert.deepEqual(names(r), ['Anfrage mit Essen', 'Firmenfeier mit Essen', 'Altes Event mit Essen']);   // neueste zuerst
    assert.ok(!names(r).includes('Bar ohne Essen'));
    assert.ok(!names(r).includes('Leerer Cateringblock'));
  });
});

test('Suche nach Name oder Nummer wirkt zusätzlich', async () => {
  await withRentman(async t => {
    assert.deepEqual(names(await t.admin('GET', '/api/catering/rentman/projects-with-food?all=1&q=altes')), ['Altes Event mit Essen']);
    assert.deepEqual(names(await t.admin('GET', '/api/catering/rentman/projects-with-food?all=1&q=105')), ['Anfrage mit Essen']);
    assert.deepEqual(names(await t.admin('GET', '/api/catering/rentman/projects-with-food?all=1&q=bar')), []);      // Bar hat keine Speisen
  });
});

test('Ergebnis je Projekt wird 10 Minuten gemerkt, danach neu geprüft', async () => {
  await withRentman(async (t, state) => {
    await t.admin('GET', '/api/catering/rentman/projects-with-food');
    await t.admin('GET', '/api/catering/rentman/projects-with-food');
    assert.equal(state.calls[1], 1);                                       // zweiter Aufruf aus dem Zwischenspeicher
    t.db.prepare("UPDATE rentman_cache SET fetched_at = datetime('now', '-11 minutes') WHERE key LIKE 'food:%'").run();
    await t.admin('GET', '/api/catering/rentman/projects-with-food');
    assert.equal(state.calls[1], 2);                                       // abgelaufen: erneut abgefragt
  });
});

test('Aktualisieren prüft sofort neu, auch innerhalb der 10 Minuten (Änderung in Rentman wird sichtbar)', async () => {
  await withRentman(async (t, state) => {
    assert.deepEqual(names(await t.admin('GET', '/api/catering/rentman/projects-with-food')), ['Firmenfeier mit Essen']);
    state.projects[0].equipment = NO_FOOD;                                 // Speisen in Rentman entfernt, `modified` ändert sich dabei nicht
    assert.deepEqual(names(await t.admin('GET', '/api/catering/rentman/projects-with-food')), ['Firmenfeier mit Essen']);   // noch aus dem Zwischenspeicher
    assert.deepEqual(names(await t.admin('GET', '/api/catering/rentman/projects-with-food?refresh=1')), []);               // Aktualisieren
    assert.deepEqual(names(await t.admin('GET', '/api/catering/rentman/projects-with-food')), []);                         // und gemerkt
  });
});

test('Ist Rentman nicht erreichbar, gibt es eine verständliche Meldung statt einer leeren Liste', async () => {
  await withRentman(async t => {
    const r = await t.admin('GET', '/api/catering/rentman/projects-with-food');
    assert.equal(r.status, 502);
    assert.match(r.json.error, /nicht verfügbar/);
  }, state => { state.projects.forEach(p => { p.equipment = null; }); });
});

test('Rechte und fehlende Konfiguration', async () => {
  await withRentman(async t => {
    assert.equal((await t.employee('GET', '/api/catering/rentman/projects-with-food')).status, 403);
    assert.equal((await t.anon('GET', '/api/catering/rentman/projects-with-food')).status, 403);
  });
  const t = await setup();
  const saved = {};
  for (const k of Object.keys(process.env)) if (k.toUpperCase() === 'RENTMAN_API') { saved[k] = process.env[k]; delete process.env[k]; }
  try {
    const r = await t.admin('GET', '/api/catering/rentman/projects-with-food');
    assert.equal(r.json.configured, false);
    assert.deepEqual(r.json.projects, []);
  } finally { t.close(); Object.assign(process.env, saved); }
});

test('Prüfung bleibt begrenzt: höchstens 60 Projekte je Anfrage', async () => {
  await withRentman(async (t, state) => {
    const r = await t.admin('GET', '/api/catering/rentman/projects-with-food?all=1&q=gleich');
    assert.equal(r.status, 200);
    assert.ok(r.json.geprueft + r.json.fehler <= 60);
    assert.equal(r.json.mehr, true);                                       // es gibt weitere, der Hinweis zur genaueren Suche erscheint
    assert.equal(r.json.projects.length, 0);
  }, state => {
    for (let i = 0; i < 100; i++) state.projects.push({ id: 1000 + i, number: 2000 + i, name: `Gleich ${i}`, start: iso(-i * DAY), status: 3, equipment: NO_FOOD });
  });
});

// ---- Kalkulation direkt aus einem Rentman-Projekt starten ----
const mkDish = (t, name) => t.admin('POST', '/api/catering/dishes', { name, ingredients: [{ name, qtyPerPortion: '40', unit: 'g', packSize: '100', supplierId: 1 }], garnish: [] });

test('Kalkulation aus Rentman starten: Speisen und Gäste übernommen, automatisch zugeordnet und verteilt', async () => {
  await withRentman(async t => {
    await t.admin('POST', '/api/catering/suppliers', { name: 'Testlieferant' });
    await mkDish(t, 'Wurstsalat'); await mkDish(t, 'Penne');
    assert.equal((await t.employee('PUT', '/api/catering/settings', { glassesPerPerson: '2' })).status, 403);
    assert.deepEqual((await t.admin('GET', '/api/catering/settings')).json, { glassesPerPerson: null, brotzeitPerPerson: null });      // kein eingebauter Standard
    assert.equal((await t.admin('PUT', '/api/catering/settings', { glassesPerPerson: '0' })).status, 400);
    assert.deepEqual((await t.admin('PUT', '/api/catering/settings', { glassesPerPerson: '2,6', brotzeitPerPerson: '3.1' })).json, { glassesPerPerson: '2.6', brotzeitPerPerson: '3.1' });
    const r = await t.admin('POST', '/api/catering/orders/from-rentman/1');
    assert.equal(r.status, 200);
    const o = r.json;
    assert.equal(o.name, 'Firmenfeier mit Essen');
    assert.equal(o.rentmanProjectId, '1');
    assert.equal(o.guests, '50');
    assert.match(o.guestsSource, /Rentman, Block "Speisen im Weckglas" \(Menge 50\)/);
    assert.deepEqual(o.lines.map(l => [l.rentmanName, l.dish && l.dish.name]), [['Wurstsalat', 'Wurstsalat'], ['Penne', 'Penne']]);
    assert.deepEqual(o.lines.map(l => l.glasses), ['65', '65']);                      // 50 x 2,6 = 130 gleichmäßig
    assert.equal(o.autoSplit, true);
    assert.equal(o.computed.complete, true);
    assert.equal(o.computed.shopping.find(s => s.name === 'Wurstsalat').qty, '2600');
    // zweiter Aufruf: es gibt schon eine offene Kalkulation
    const again = await t.admin('POST', '/api/catering/orders/from-rentman/1');
    assert.equal(again.status, 409);
    assert.equal(again.json.openOrderId, o.id);
    // Rentman wurde nur gelesen
    assert.ok((await t.admin('GET', '/api/catering/orders')).json.some(x => x.rentmanProjectId === '1'));
  });
});

test('Kalkulation aus Rentman: ohne Standardwerte, ohne Speisen und bei abweichenden Blöcken wird nichts geraten', async () => {
  await withRentman(async t => {
    await t.admin('POST', '/api/catering/suppliers', { name: 'Testlieferant' });
    await mkDish(t, 'Wurstsalat'); await mkDish(t, 'Penne');
    const o = (await t.admin('POST', '/api/catering/orders/from-rentman/1')).json;
    assert.deepEqual(o.lines.map(l => l.glasses), [null, null]);                      // keine Portionen pro Person: nichts verteilt
    assert.equal(o.computed.complete, false);
    assert.ok(o.computed.warnings.some(w => w.code === 'gpp'));
    assert.equal((await t.admin('POST', '/api/catering/orders/from-rentman/2')).status, 400);     // Projekt ohne Speisen
    assert.equal((await t.admin('POST', '/api/catering/orders/from-rentman/abc')).status, 400);
  });
  await withRentman(async t => {
    const o = (await t.admin('POST', '/api/catering/orders/from-rentman/1')).json;
    assert.equal(o.guests, '50');                                                    // gleiche Menge in beiden Blöcken: einmal gezählt, nicht addiert
    assert.match(o.guestsSource, /Blöcke "Speisen im Weckglas", "Zweiter Block" \(Menge 50\)/);
  }, st => { st.projects[0].equipment = [...WITH_FOOD, ROW(30, null, 2, 50, 'Zweiter Block'), ROW(31, 30, 2, 0, 'Couscous')]; });
  await withRentman(async t => {
    const o = (await t.admin('POST', '/api/catering/orders/from-rentman/1')).json;
    assert.equal(o.guests, null);                                                    // Blöcke mit 50 und 40 werden nicht addiert oder geraten
    assert.match(o.guestsSource, /unterschiedliche Mengen \(50, 40\)/);
    assert.equal(o.lines.length, 3);
  }, st => { st.projects[0].equipment = [...WITH_FOOD, ROW(30, null, 2, 40, 'Zweiter Block'), ROW(31, 30, 2, 0, 'Couscous')]; });
});
