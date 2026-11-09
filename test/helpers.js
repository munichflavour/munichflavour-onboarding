// Gemeinsamer Testaufbau: Minimaler Portal-Ersatz mit Sitzung aus dem Header x-test-user.
const express = require('express');
const Database = require('better-sqlite3');
const { mount } = require('../modules/catering');

// options.passwordHash: Hex-Hash des Kalkulator-Passworts (statt Standard/Umgebungsvariable)
async function setup(options = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT); INSERT INTO users VALUES (1, 'Admin Test'), (2, 'Mitarbeiter Test')");
  const app = express();
  app.use(express.json());
  // Sitzungen bleiben je Kopfzeile über mehrere Anfragen erhalten (nötig, damit "entsperrt" bestehen bleibt)
  const sessions = new Map();
  app.use((req, res, next) => {
    const u = req.get('x-test-user');
    if (!u) { req.session = {}; return next(); }
    if (!sessions.has(u)) sessions.set(u, JSON.parse(u));
    req.session = sessions.get(u);
    next();
  });
  const requireAdmin = (req, res, next) => (!req.session.userId || req.session.role !== 'admin') ? res.status(403).json({ error: 'Kein Zugriff' }) : next();
  mount(app, db, { requireAdmin, passwordHash: options.passwordHash });
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = user => async (method, path, body, raw) => {
    const res = await fetch(base + path, { method, redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': JSON.stringify(user) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* keine JSON-Antwort */ }
    return { status: res.status, json, headers: res.headers };
  };
  // `admin` ist bereits entsperrt (für alle Tests der Funktionen), `adminLocked` hat das Passwort noch nicht eingegeben
  return { db, admin: as({ userId: 1, role: 'admin', cateringUnlocked: true }), adminLocked: as({ userId: 1, role: 'admin', _gesperrt: true }), employee: as({ userId: 2, role: 'employee' }), anon: as(null),
    close: () => { server.close(); db.close(); } };
}
module.exports = { setup };
