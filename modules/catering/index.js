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

// Beispielprojekte nur für Oberfläche und Tests, nie als echte Daten ausgeben.
const SAMPLE_PROJECTS = [
  { id: 'sample-1', number: 'TEST-001', name: 'Beispielprojekt (Testdaten)', start: null, status: 'Beispiel', statusId: null, sample: true },
];

function mount(app, db, { requireAdmin }) {
  const schemaVersion = migrate(db);
  const projectCache = rentman.createProjectCache(db);
  const audit = createAudit(db);

  // Seite: ohne Admin-Login Weiterleitung zum Login
  const gate = (req, res, next) => {
    if (!req.session.userId || req.session.role !== 'admin') return res.redirect('/login.html');
    next();
  };
  app.use('/catering', gate, express.static(path.join(__dirname, 'web')));

  const api = express.Router();
  api.use(requireAdmin);

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
