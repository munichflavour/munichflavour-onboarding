const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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

async function sendPushToAdmins(title, body, url = '/admin.html') {
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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: dbDir }),
  secret: 'munich-flavour-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7*24*60*60*1000 }
}));

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

// ===== AUTH =====
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
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
app.get('/api/documents/search', requireAuth, (req, res) => {
  const q = `%${req.query.q || ''}%`;
  res.json(db.prepare(`SELECT * FROM documents WHERE original_name LIKE ? OR description LIKE ? ORDER BY uploaded_at DESC`).all(q, q));
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
app.post('/api/admin/documents', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  const { folder_id, description } = req.body;
  const result = db.prepare('INSERT INTO documents (folder_id, original_name, stored_name, description) VALUES (?, ?, ?, ?)').run(folder_id||null, req.file.originalname, req.file.filename, description||'');
  sendPushToAllEmployees('📄 Neues Dokument', `„${req.file.originalname}" wurde hochgeladen.`);
  res.json({ id: result.lastInsertRowid });
});
app.delete('/api/admin/documents/:id', requireAdmin, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });
  const fp = path.join(uploadsDir, doc.stored_name);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/', (req, res) => res.redirect('/login.html'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Munich Flavour Portal läuft auf http://localhost:${PORT}`));
