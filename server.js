const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const webpush = require('web-push');

const app = express();

const dbDir = path.join(__dirname, 'db');
const uploadsDir = path.join(dbDir, 'uploads', 'documents');
[dbDir, uploadsDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const db = new Database(path.join(dbDir, 'onboarding.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS document_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES document_folders(id)
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    description TEXT,
    uploaded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (folder_id) REFERENCES document_folders(id)
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ===== VAPID =====
let vapidPublicKey, vapidPrivateKey;
const storedPublic = db.prepare("SELECT value FROM settings WHERE key = 'vapid_public'").get();
const storedPrivate = db.prepare("SELECT value FROM settings WHERE key = 'vapid_private'").get();
if (storedPublic && storedPrivate) {
  vapidPublicKey = storedPublic.value;
  vapidPrivateKey = storedPrivate.value;
} else {
  const keys = webpush.generateVAPIDKeys();
  vapidPublicKey = keys.publicKey;
  vapidPrivateKey = keys.privateKey;
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('vapid_public', ?)").run(vapidPublicKey);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('vapid_private', ?)").run(vapidPrivateKey);
}
webpush.setVapidDetails('mailto:admin@municflavour.de', vapidPublicKey, vapidPrivateKey);

// ===== SESSION SECRET =====
// Bevorzugt aus Umgebungsvariable (empfohlen für Produktivbetrieb). Falls nicht gesetzt,
// wird einmalig ein zufälliges Secret erzeugt und in der DB gespeichert (wie die VAPID-Keys),
// damit es nicht im Code steht und Sessions nicht bei jedem Neustart ungültig werden.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  const stored = db.prepare("SELECT value FROM settings WHERE key = 'session_secret'").get();
  if (stored) {
    sessionSecret = stored.value;
  } else {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('session_secret', ?)").run(sessionSecret);
  }
}

// Master switch so the admin can pause pushes (e.g. while bulk-uploading test documents)
// without touching anyone's individual subscription.
function isPushEnabled() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'push_enabled'").get();
  return !row || row.value !== 'false';
}

async function sendPushToAdmins(title, body, url = '/admin.html') {
  if (!isPushEnabled()) return;
  const subs = db.prepare(`SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id WHERE u.role = 'admin'`).all();
  const payload = JSON.stringify({ title, body, url });
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
    }
  }
}

async function sendPushToAllEmployees(title, body, url = '/employee.html') {
  if (!isPushEnabled()) return;
  const subs = db.prepare(`SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id WHERE u.role = 'employee'`).all();
  const payload = JSON.stringify({ title, body, url });
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
    }
  }
}

// ===== MULTER =====
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1e6) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 50*1024*1024 } });

const isProduction = process.env.NODE_ENV === 'production';
// Hinter einem Reverse Proxy (z.B. nginx, Heroku, Render) nötig, damit Express req.secure
// korrekt erkennt und "secure" Cookies gesetzt werden. Per Env-Var aktivierbar.
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// CSRF-Schutz: Für alle Anfragen, die Daten ändern, muss Origin/Referer auf denselben Host
// zeigen. Das Frontend ruft die API ausschließlich same-origin per fetch() auf, sodass
// Browser diesen Header automatisch mitschicken; eine Cross-Site-Anfrage (z.B. von einer
// bösartigen Seite) hat einen abweichenden Origin und wird abgelehnt.
function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const source = req.get('origin') || req.get('referer');
  if (!source) return res.status(403).json({ error: 'Anfrage abgelehnt' });
  try {
    if (new URL(source).host !== req.get('host')) return res.status(403).json({ error: 'Anfrage abgelehnt' });
  } catch {
    return res.status(403).json({ error: 'Anfrage abgelehnt' });
  }
  next();
}
app.use(csrfProtection);

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: dbDir }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7*24*60*60*1000, sameSite: 'lax', secure: isProduction }
}));

// ===== LOGIN RATE LIMITING =====
// Einfacher In-Memory-Limiter: pro IP max. 5 Fehlversuche, danach 15 Minuten Sperre.
// Reicht für den Einsatzzweck (kleines internes Team); kein zusätzlicher Dienst nötig.
const loginAttempts = new Map();
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
function loginRateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (entry && entry.lockedUntil && entry.lockedUntil > now) {
    const waitMin = Math.ceil((entry.lockedUntil - now) / 60000);
    return res.status(429).json({ error: `Zu viele Fehlversuche. Bitte in ${waitMin} Minute(n) erneut versuchen.` });
  }
  next();
}
function recordLoginFailure(req) {
  const key = req.ip;
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.windowStart + LOGIN_WINDOW_MS < now) {
    loginAttempts.set(key, { count: 1, windowStart: now, lockedUntil: 0 });
    return;
  }
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) entry.lockedUntil = now + LOGIN_WINDOW_MS;
}
function clearLoginFailures(req) { loginAttempts.delete(req.ip); }
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginAttempts) {
    if (entry.windowStart + LOGIN_WINDOW_MS < now && entry.lockedUntil < now) loginAttempts.delete(key);
  }
}, 60 * 60 * 1000).unref();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Nicht angemeldet' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.role !== 'admin') return res.status(403).json({ error: 'Kein Zugriff' });
  next();
}

// ===== PUSH =====
app.get('/api/push/vapid-public-key', (req, res) => res.json({ key: vapidPublicKey }));
app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Ungültige Subscription' });
  db.prepare('INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)').run(req.session.userId, endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});
app.delete('/api/push/subscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(req.session.userId, endpoint);
  res.json({ ok: true });
});

// Master on/off switch for outgoing push notifications (e.g. pause during bulk uploads)
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json({ pushEnabled: isPushEnabled() });
});
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const { pushEnabled } = req.body;
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('push_enabled', ?)").run(pushEnabled ? 'true' : 'false');
  res.json({ ok: true, pushEnabled: !!pushEnabled });
});

// ===== AUTH =====
app.post('/api/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordLoginFailure(req);
    return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  }
  clearLoginFailures(req);
  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ role: user.role, fullName: user.full_name });
});
app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });
app.get('/api/me', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT id, username, full_name, role FROM users WHERE id = ?').get(req.session.userId));
});

// ===== ADMIN: EMPLOYEES =====
app.get('/api/admin/employees', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT id, username, full_name, created_at FROM users WHERE role = 'employee' ORDER BY full_name ASC`).all());
});
app.post('/api/admin/employees', requireAdmin, (req, res) => {
  const { username, password, full_name } = req.body;
  if (!username || !password || !full_name) return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: 'Benutzername vergeben' });
  const result = db.prepare(`INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'employee')`).run(username, bcrypt.hashSync(password, 10), full_name);
  res.json({ id: result.lastInsertRowid });
});
app.put('/api/admin/employees/:id', requireAdmin, (req, res) => {
  const { full_name, password } = req.body;
  if (full_name) db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(full_name, req.params.id);
  if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/employees/:id', requireAdmin, (req, res) => {
  const user = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'employee'`).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Nicht gefunden' });
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== DOCUMENTS =====
app.get('/api/documents', requireAuth, (req, res) => {
  res.json({
    folders: db.prepare('SELECT * FROM document_folders ORDER BY name ASC').all(),
    documents: db.prepare('SELECT * FROM documents ORDER BY uploaded_at DESC').all()
  });
});
// Sucht Dateiname + Beschreibung. Filterung in JS statt SQL LIKE, damit Groß/Kleinschreibung
// bei Umlauten (Ä/Ö/Ü) korrekt behandelt wird (SQLite LIKE kennt das nur für ASCII).
app.get('/api/documents/search', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json([]);
  const docs = db.prepare('SELECT * FROM documents ORDER BY uploaded_at DESC').all();
  const results = docs.filter(d =>
    d.original_name.toLowerCase().includes(q) ||
    (d.description || '').toLowerCase().includes(q)
  );
  res.json(results);
});
app.get('/api/documents/:id/download', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });
  const fp = path.join(uploadsDir, doc.stored_name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.download(fp, doc.original_name);
});
app.get('/api/documents/:id/view', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });
  const fp = path.join(uploadsDir, doc.stored_name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.setHeader('Content-Disposition', `inline; filename="${doc.original_name}"`);
  res.sendFile(fp);
});

// ===== ADMIN: FOLDERS =====
app.post('/api/admin/folders', requireAdmin, (req, res) => {
  const { name, parent_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });
  const result = db.prepare('INSERT INTO document_folders (name, parent_id) VALUES (?, ?)').run(name, parent_id||null);
  res.json({ id: result.lastInsertRowid, name, parent_id: parent_id||null });
});
app.put('/api/admin/folders/:id', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });
  db.prepare('UPDATE document_folders SET name = ? WHERE id = ?').run(name, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/folders/:id', requireAdmin, (req, res) => {
  const deleteFolderRecursive = (folderId) => {
    const children = db.prepare('SELECT id FROM document_folders WHERE parent_id = ?').all(folderId);
    children.forEach(c => deleteFolderRecursive(c.id));
    const docs = db.prepare('SELECT stored_name FROM documents WHERE folder_id = ?').all(folderId);
    docs.forEach(d => { const p = path.join(uploadsDir, d.stored_name); if (fs.existsSync(p)) fs.unlinkSync(p); });
    db.prepare('DELETE FROM documents WHERE folder_id = ?').run(folderId);
    db.prepare('DELETE FROM document_folders WHERE id = ?').run(folderId);
  };
  deleteFolderRecursive(req.params.id);
  res.json({ ok: true });
});

// ===== ADMIN: DOCUMENTS =====
app.post('/api/admin/documents', requireAdmin, upload.array('files', 30), (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'Keine Datei' });
  const { folder_id, description } = req.body;
  const insert = db.prepare('INSERT INTO documents (folder_id, original_name, stored_name, description) VALUES (?, ?, ?, ?)');
  const ids = req.files.map(f => insert.run(folder_id||null, f.originalname, f.filename, description||'').lastInsertRowid);
  if (req.files.length === 1) {
    sendPushToAllEmployees('📄 Neues Dokument', `„${req.files[0].originalname}" wurde hochgeladen.`);
  } else {
    sendPushToAllEmployees('📄 Neue Dokumente', `${req.files.length} neue Dokumente wurden hochgeladen.`);
  }
  res.json({ ids });
});
app.delete('/api/admin/documents/:id', requireAdmin, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });
  const fp = path.join(uploadsDir, doc.stored_name);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== ANNOUNCEMENTS =====
app.get('/api/announcements', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 20').all());
});
app.post('/api/admin/announcements', requireAdmin, (req, res) => {
  const { title, body } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Titel erforderlich' });
  const result = db.prepare('INSERT INTO announcements (title, body) VALUES (?, ?)').run(title.trim(), (body||'').trim());
  sendPushToAllEmployees('📢 ' + title.trim(), (body||'').trim() || 'Neue Ankündigung im Portal.');
  res.json({ id: result.lastInsertRowid });
});
app.delete('/api/admin/announcements/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/', (req, res) => res.redirect('/login.html'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Munich Flavour Portal läuft auf http://localhost:${PORT}`));
