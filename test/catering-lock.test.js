const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup } = require('./helpers');
const lock = require('../modules/catering/lock');

const PW = 'testpasswort-123';
const HASH = lock.hash(PW).toString('hex');
const clearEnv = () => { delete process.env.CATERING_PASSWORT; delete process.env.CATERING_OHNE_PASSWORT; };

test('Ohne Passwort bleibt alles gesperrt: Seite zeigt nur die Passwortabfrage, Dateien und API sind zu', async () => {
  clearEnv();
  const t = await setup({ passwordHash: HASH });
  try {
    const page = await t.adminLocked('GET', '/catering/', undefined, true);
    assert.equal(page.status, 200);
    const html = page.buffer.toString('utf8');
    assert.match(html, /Passwort erforderlich/);
    assert.ok(!html.includes('CAT.start'), 'die eigentliche App darf nicht ausgeliefert werden');
    assert.match(page.headers.get('cache-control'), /no-store/);
    for (const f of ['/catering/core.js', '/catering/view-orders.js', '/catering/catering.css']) assert.equal((await t.adminLocked('GET', f)).status, 423, f);
    for (const p of ['/api/catering/status', '/api/catering/orders', '/api/catering/dishes', '/api/catering/suppliers', '/api/catering/meta', '/api/catering/projects']) {
      const r = await t.adminLocked('GET', p);
      assert.equal(r.status, 423, p);
      assert.equal(r.json.locked, true);
    }
    assert.equal((await t.adminLocked('POST', '/api/catering/orders', { name: 'x' })).status, 423);
    assert.equal((await t.adminLocked('GET', '/api/catering/lock-status')).json.unlocked, false);
  } finally { t.close(); }
});

test('Das Passwort gilt zusätzlich zur Admin-Anmeldung: Mitarbeiter und Gäste kommen nie weiter', async () => {
  clearEnv();
  const t = await setup({ passwordHash: HASH });
  try {
    for (const who of [t.anon, t.employee]) {
      assert.equal((await who('GET', '/catering/')).status, 302);                       // Weiterleitung zum Login
      assert.equal((await who('POST', '/api/catering/unlock', { password: PW })).status, 403);   // auch mit richtigem Passwort
      assert.equal((await who('GET', '/api/catering/status')).status, 403);
    }
  } finally { t.close(); }
});

test('Falsches Passwort wird abgelehnt, richtiges entsperrt für die Sitzung', async () => {
  clearEnv();
  const t = await setup({ passwordHash: HASH });
  try {
    // vier Fehlversuche (unter der Sperrgrenze von fünf): ähnliche Eingaben zählen nicht
    for (const bad of ['falsch', 'testpasswort-12', PW.toUpperCase(), ' ' + PW]) {
      assert.equal((await t.adminLocked('POST', '/api/catering/unlock', { password: bad })).status, 401, JSON.stringify(bad));
    }
    assert.equal((await t.adminLocked('GET', '/api/catering/status')).status, 423);       // nach Fehlversuchen weiter gesperrt
    const ok = await t.adminLocked('POST', '/api/catering/unlock', { password: PW });
    assert.equal(ok.status, 200);
    assert.equal((await t.adminLocked('GET', '/api/catering/status')).status, 200);
    assert.equal((await t.adminLocked('GET', '/api/catering/lock-status')).json.unlocked, true);
    const app = await t.adminLocked('GET', '/catering/', undefined, true);
    assert.match(app.buffer.toString('utf8'), /CAT\.start/);                              // jetzt die eigentliche App
    assert.equal((await t.adminLocked('GET', '/catering/core.js')).status, 200);
  } finally { t.close(); }
});

test('Ungültige Eingaben (leer, fehlend, keine Zeichenkette, überlang) werden abgelehnt', async () => {
  clearEnv();
  for (const bad of ['', undefined, null, 12345, {}, [], 'x'.repeat(5000)]) assert.equal(lock.check(bad, HASH), false, String(bad).slice(0, 20));
  assert.equal(lock.check(PW, HASH), true);
  const t = await setup({ passwordHash: HASH });
  try {
    assert.equal((await t.adminLocked('POST', '/api/catering/unlock', {})).status, 401);
    assert.equal((await t.adminLocked('POST', '/api/catering/unlock', { password: 12345 })).status, 401);
    assert.equal((await t.adminLocked('POST', '/api/catering/unlock', { password: 'x'.repeat(5000) })).status, 401);
    assert.equal((await t.adminLocked('POST', '/api/catering/unlock', { password: PW })).status, 200);
  } finally { t.close(); }
});

test('Erneut sperren: danach wieder Passwort nötig', async () => {
  clearEnv();
  const t = await setup({ passwordHash: HASH });
  try {
    await t.adminLocked('POST', '/api/catering/unlock', { password: PW });
    assert.equal((await t.adminLocked('GET', '/api/catering/status')).status, 200);
    assert.equal((await t.adminLocked('POST', '/api/catering/lock')).status, 200);
    assert.equal((await t.adminLocked('GET', '/api/catering/status')).status, 423);
    assert.equal((await t.adminLocked('POST', '/api/catering/unlock', { password: PW })).status, 200);
  } finally { t.close(); }
});

test('Fehlversuche sind begrenzt: nach 5 Fehlern gesperrt, auch das richtige Passwort hilft dann nicht', async () => {
  clearEnv();
  const t = await setup({ passwordHash: HASH });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await t.adminLocked('POST', '/api/catering/unlock', { password: 'nein' + i })).status, 401);
    const blocked = await t.adminLocked('POST', '/api/catering/unlock', { password: PW });
    assert.equal(blocked.status, 429);
    assert.match(blocked.json.error, /Minute/);
    assert.equal((await t.adminLocked('GET', '/api/catering/status')).status, 423);
  } finally { t.close(); }
});

test('Eigenes Passwort über die Umgebungsvariable CATERING_PASSWORT', async () => {
  clearEnv();
  process.env.CATERING_PASSWORT = 'aus-der-umgebung';
  const t = await setup();                                                     // ohne Override: Variable gilt
  try {
    assert.equal((await t.adminLocked('POST', '/api/catering/unlock', { password: 'aus-der-umgebung' })).status, 200);
    const t2 = await setup();
    try { assert.equal((await t2.adminLocked('POST', '/api/catering/unlock', { password: 'anderes' })).status, 401); } finally { t2.close(); }
  } finally { t.close(); clearEnv(); }
});

test('CATERING_OHNE_PASSWORT=1 schaltet die Abfrage ab', async () => {
  clearEnv();
  process.env.CATERING_OHNE_PASSWORT = '1';
  const t = await setup({ passwordHash: HASH });
  try {
    assert.equal((await t.adminLocked('GET', '/api/catering/status')).status, 200);
    const page = await t.adminLocked('GET', '/catering/', undefined, true);
    assert.match(page.buffer.toString('utf8'), /CAT\.start/);
    assert.equal((await t.adminLocked('GET', '/api/catering/lock-status')).json.protected, false);
    assert.equal((await t.employee('GET', '/api/catering/status')).status, 403);        // Admin-Pflicht bleibt
  } finally { t.close(); clearEnv(); }
});

test('Standardpasswort: nur als Hash im Code, falsche Eingaben scheitern, Klartext steht nirgends im Repository', async () => {
  clearEnv();
  assert.match(lock.DEFAULT_HASH, /^[0-9a-f]{64}$/);
  assert.equal(lock.check('falsch'), false);
  assert.equal(lock.check(''), false);
  assert.equal(lock.check(undefined), false);
  const t = await setup();                                                       // ohne Override und ohne Variable: Standard
  try { assert.equal((await t.adminLocked('POST', '/api/catering/unlock', { password: 'falsch' })).status, 401); } finally { t.close(); }
  // Das Klartext-Passwort darf in keiner versionierten Datei vorkommen (es wurde dem Auftraggeber nur mitgeteilt)
  const needle = Buffer.from('Rmxhdm91ci1LYWxrLTQ3MTE=', 'base64').toString();
  const root = path.join(__dirname, '..');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    if (['node_modules', '.git', 'db'].includes(e.name)) return [];
    const f = path.join(d, e.name);
    return e.isDirectory() ? walk(f) : [f];
  });
  const hits = walk(root).filter(f => /\.(js|html|md|json|css|py|txt)$/.test(f) && fs.readFileSync(f, 'utf8').includes(needle));
  assert.deepEqual(hits, []);
});
