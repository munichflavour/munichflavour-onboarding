// Catering-Kalkulator: Einbindung ins Portal. Nur für angemeldete Admins, genau wie /karten.
//   Seite:  /catering/      (Dateien in ./web)
//   API:    /api/catering/* (JSON)
const path = require('path');
const express = require('express');
const { migrate } = require('./schema');
const rentman = require('./rentman');
const { UNITS } = require('./units');
const { MODES } = require('./calc');
const { createAudit } = require('./audit');
const { ApiError } = require('./validate');
const { createMasterdataRouter } = require('./routes/masterdata');
const { createRecipesRouter } = require('./routes/recipes');
const { createDishesRouter } = require('./routes/dishes');
const { createOrdersRouter } = require('./routes/orders');
const lock = require('./lock');

// Beispielprojekte nur für Oberfläche und Tests, nie als echte Daten ausgeben.
const SAMPLE_PROJECTS = [
  { id: 'sample-1', number: 'TEST-001', name: 'Beispielprojekt (Testdaten)', start: null, status: 'Beispiel', statusId: null, sample: true },
];

// options.passwordHash (Hex, scrypt) überschreibt das Passwort, nur für Tests
function mount(app, db, { requireAdmin, passwordHash }) {
  const schemaVersion = migrate(db);
  const projectCache = rentman.createProjectCache(db);
  const foodCache = rentman.createFoodCache(db);
  const audit = createAudit(db);

  const limiter = lock.createLimiter();
  const unlocked = req => !lock.enabled() || req.session.cateringUnlocked === true;

  // Seite: ohne Admin-Login Weiterleitung zum Login, ohne Passwort die Sperrseite (und sonst nichts)
  const gate = (req, res, next) => {
    if (!req.session.userId || req.session.role !== 'admin') return res.redirect('/login.html');
    if (!unlocked(req)) {
      res.set('Cache-Control', 'no-store');
      if (req.path === '/' || req.path === '/index.html') return res.sendFile(path.join(__dirname, 'lock.html'));
      return res.status(423).type('text/plain; charset=utf-8').send('Gesperrt');
    }
    next();
  };
  app.use('/catering', gate, express.static(path.join(__dirname, 'web')));

  const api = express.Router();
  api.use(requireAdmin);

  // Passwortschutz: Entsperren gilt für die Sitzung; alles andere ist bis dahin gesperrt (423)
  api.get('/lock-status', (req, res) => res.json({ protected: lock.enabled(), unlocked: unlocked(req) }));
  api.post('/unlock', (req, res) => {
    const wait = limiter.blockedMinutes(req);
    if (wait) return res.status(429).json({ error: `Zu viele Fehlversuche. Bitte in ${wait} Minute(n) erneut versuchen.` });
    if (!lock.check(req.body && req.body.password, passwordHash)) {
      limiter.fail(req);
      return res.status(401).json({ error: 'Falsches Passwort.' });
    }
    limiter.clear(req);
    req.session.cateringUnlocked = true;
    res.json({ ok: true });
  });
  api.post('/lock', (req, res) => { req.session.cateringUnlocked = false; res.json({ ok: true }); });
  api.use((req, res, next) => {
    if (unlocked(req)) return next();
    res.status(423).json({ error: 'Der Catering-Kalkulator ist gesperrt. Bitte das Passwort eingeben.', locked: true });
  });

  api.get('/status', (req, res) => {
    res.json({
      schemaVersion,
      rentman: { configured: rentman.isConfigured(), cache: projectCache.info() },
      units: Object.fromEntries(Object.entries(UNITS).map(([k, v]) => [k, v.label])),
      modes: MODES,
    });
  });

  // Projektliste (Cache 10 Minuten; ?refresh=1 erzwingt Abgleich)
  api.get('/projects', async (req, res) => {
    if (!rentman.isConfigured()) {
      return res.json({ source: 'beispiel', configured: false, projects: SAMPLE_PROJECTS,
        hinweis: 'Rentman ist nicht angebunden (RENTMAN_API fehlt). Angezeigt werden nur Beispieldaten.' });
    }
    try {
      const r = await projectCache.get({ force: req.query.refresh === '1' });
      res.json({ source: 'rentman', configured: true, fetchedAt: new Date(r.at).toISOString(), projects: r.data });
    } catch (e) {
      res.status(e.status && e.status < 600 ? 502 : 500).json({ error: e.message });
    }
  });

  // Auswahl für neue Bestellungen: nur Projekte, die Speisen enthalten (Block der Materialgruppe "Catering" mit Speisen darunter).
  // Standard: bestätigte Projekte ab gestern, nach Datum aufsteigend. all=1: alle Projekte, neueste zuerst. q: Name oder Nummer.
  api.get('/rentman/projects-with-food', async (req, res) => {
    if (!rentman.isConfigured()) {
      return res.json({ configured: false, projects: [], hinweis: 'Rentman ist nicht angebunden (RENTMAN_API fehlt).' });
    }
    try {
      const all = req.query.all === '1';
      const q = String(req.query.q || '').trim().toLowerCase().slice(0, 60);
      const gestern = new Date().setHours(0, 0, 0, 0) - 86400000;
      const force = req.query.refresh === '1';        // Aktualisieren: Projektliste und Speisenprüfung sofort neu holen
      const list = (await projectCache.get({ force })).data;
      const ts = p => (p.start ? Date.parse(p.start) : 0);
      const candidates = list
        .filter(p => (all || ([3, 4, 5, 6].includes(p.statusId) && p.start && ts(p) >= gestern))
          && (!q || (p.name || '').toLowerCase().includes(q) || String(p.number || '').includes(q)))
        .sort((a, b) => (all ? ts(b) - ts(a) : ts(a) - ts(b)));
      const r = await foodCache.find(candidates, { want: 25, maxChecks: 60, force });
      if (r.checked === 0 && r.failed > 0) {
        return res.status(502).json({ error: 'Die Rentman-Verbindung ist derzeit nicht verfügbar. Bitte in einer Minute erneut versuchen.' });
      }
      res.json({ configured: true, projects: r.hits, geprueft: r.checked, fehler: r.failed, kandidaten: candidates.length, mehr: r.remaining > 0 });
    } catch (e) {
      res.status(e.status && e.status < 600 ? 502 : 500).json({ error: e.message });
    }
  });

  // Rohdaten eines Projekts zur Klärung der Datenfelder (nur lesend)
  api.get('/rentman/diagnose/:id', async (req, res) => {
    if (!rentman.isConfigured()) return res.status(503).json({ error: 'Rentman ist nicht konfiguriert (RENTMAN_API fehlt)' });
    try {
      res.json(await rentman.diagnoseProject(req.params.id));
    } catch (e) {
      res.status(e.status === 400 ? 400 : 502).json({ error: e.message });
    }
  });

  api.use(createMasterdataRouter(db, audit));
  api.use(createRecipesRouter(db, audit));
  api.use(createDishesRouter(db, audit));
  api.use(createOrdersRouter(db, audit));

  // Änderungsprotokoll eines Datensatzes
  api.get('/audit', (req, res) => {
    const rows = db.prepare('SELECT at, user_name, action, detail FROM catering_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT 100')
      .all(String(req.query.entity || ''), String(req.query.id || ''));
    res.json(rows.map(r => ({ at: r.at, userName: r.user_name, action: r.action, detail: r.detail ? JSON.parse(r.detail) : null })));
  });

  // Fehlerbehandlung: verständliche Meldungen, keine internen Details oder Geheimnisse nach außen
  api.use((req, res) => res.status(404).json({ error: 'Nicht gefunden.' }));
  api.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    console.error('Catering-Fehler:', err && err.code ? err.code : '', err && err.message);
    res.status(500).json({ error: 'Interner Fehler. Bitte erneut versuchen; bestehende Daten wurden nicht verändert.' });
  });

  app.use('/api/catering', api);
}

module.exports = { mount };
