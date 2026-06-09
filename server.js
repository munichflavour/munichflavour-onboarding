const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');

const app = express();

// Ensure directories exist
const dbDir = path.join(__dirname, 'db');
const uploadsAdminDir = path.join(dbDir, 'uploads', 'admin');
const uploadsEmployeeDir = path.join(dbDir, 'uploads', 'employee');
[dbDir, uploadsAdminDir, uploadsEmployeeDir].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const db = new Database(path.join(dbDir, 'onboarding.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    start_date TEXT,
    profile_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS profile_checklist_items (
    profile_id INTEGER NOT NULL,
    checklist_item_id INTEGER NOT NULL,
    PRIMARY KEY (profile_id, checklist_item_id),
    FOREIGN KEY (profile_id) REFERENCES profiles(id),
    FOREIGN KEY (checklist_item_id) REFERENCES checklist_items(id)
  );

  CREATE TABLE IF NOT EXISTS checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS checklist_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    checklist_item_id INTEGER NOT NULL,
    completed_at TEXT,
    confirmed_at TEXT,
    confirmed_by TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (checklist_item_id) REFERENCES checklist_items(id),
    UNIQUE(user_id, checklist_item_id)
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

  CREATE TABLE IF NOT EXISTS employee_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    uploaded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS clothing_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    issued_at TEXT DEFAULT (datetime('now')),
    admin_name TEXT,
    admin_signature TEXT,
    admin_signed_at TEXT,
    employee_signature TEXT,
    employee_signed_at TEXT,
    returned_at TEXT,
    return_admin_name TEXT,
    return_admin_signature TEXT,
    return_admin_signed_at TEXT,
    return_employee_signature TEXT,
    return_employee_signed_at TEXT,
    return_notes TEXT,
    fee_applicable INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS clothing_record_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    size TEXT,
    quantity INTEGER DEFAULT 1,
    returned INTEGER DEFAULT 0,
    FOREIGN KEY (record_id) REFERENCES clothing_records(id)
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

// Migrations for existing DBs
['confirmed_at TEXT', 'confirmed_by TEXT', 'rejection_comment TEXT', 'rejected_at TEXT'].forEach(col => {
  try { db.exec(`ALTER TABLE checklist_progress ADD COLUMN ${col}`); } catch(e) {}
});
try { db.exec(`ALTER TABLE users ADD COLUMN profile_id INTEGER`); } catch(e) {}

// ===== VAPID SETUP =====
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
  console.log('✓ VAPID Keys generiert und gespeichert');
}
webpush.setVapidDetails('mailto:admin@municflavour.de', vapidPublicKey, vapidPrivateKey);

async function sendPushToUser(userId, title, body, url = '/employee.html') {
  const subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  const payload = JSON.stringify({ title, body, url });
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
      }
    }
  }
}

async function sendPushToAdmins(title, body, url = '/admin.html') {
  const subs = db.prepare(`
    SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps
    JOIN users u ON u.id = ps.user_id WHERE u.role = 'admin'
  `).all();
  const payload = JSON.stringify({ title, body, url });
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
      }
    }
  }
}

// Multer
const adminStorage = multer.diskStorage({
  destination: uploadsAdminDir,
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1e6) + path.extname(file.originalname))
});
const adminUpload = multer({ storage: adminStorage, limits: { fileSize: 20*1024*1024 } });

const employeeStorage = multer.diskStorage({
  destination: uploadsEmployeeDir,
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1e6) + path.extname(file.originalname))
});
const employeeUpload = multer({ storage: employeeStorage, limits: { fileSize: 20*1024*1024 } });

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

// ===== PUSH NOTIFICATIONS =====
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
  res.json(db.prepare('SELECT id, username, full_name, role, start_date, profile_id FROM users WHERE id = ?').get(req.session.userId));
});

// ===== PROFILES =====
app.get('/api/admin/profiles', requireAdmin, (req, res) => {
  const profiles = db.prepare('SELECT * FROM profiles ORDER BY name ASC').all();
  res.json(profiles);
});
app.post('/api/admin/profiles', requireAdmin, (req, res) => {
  const { name, description, item_ids } = req.body;
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });
  const result = db.prepare('INSERT INTO profiles (name, description) VALUES (?, ?)').run(name, description || '');
  const pid = result.lastInsertRowid;
  if (Array.isArray(item_ids)) {
    const ins = db.prepare('INSERT OR IGNORE INTO profile_checklist_items (profile_id, checklist_item_id) VALUES (?, ?)');
    db.transaction(() => item_ids.forEach(id => ins.run(pid, id)))();
  }
  res.json({ id: pid, name, description });
});
app.put('/api/admin/profiles/:id', requireAdmin, (req, res) => {
  const { name, description, item_ids } = req.body;
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });
  db.prepare('UPDATE profiles SET name = ?, description = ? WHERE id = ?').run(name, description || '', req.params.id);
  if (Array.isArray(item_ids)) {
    db.prepare('DELETE FROM profile_checklist_items WHERE profile_id = ?').run(req.params.id);
    const ins = db.prepare('INSERT OR IGNORE INTO profile_checklist_items (profile_id, checklist_item_id) VALUES (?, ?)');
    db.transaction(() => item_ids.forEach(id => ins.run(req.params.id, id)))();
  }
  res.json({ ok: true });
});
app.delete('/api/admin/profiles/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM profile_checklist_items WHERE profile_id = ?').run(req.params.id);
  db.prepare('UPDATE users SET profile_id = NULL WHERE profile_id = ?').run(req.params.id);
  db.prepare('DELETE FROM profiles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.get('/api/admin/profiles/:id/items', requireAdmin, (req, res) => {
  const items = db.prepare(`
    SELECT ci.* FROM checklist_items ci
    JOIN profile_checklist_items pci ON pci.checklist_item_id = ci.id
    WHERE pci.profile_id = ? ORDER BY ci.order_index ASC`).all(req.params.id);
  res.json(items);
});

// ===== EMPLOYEE: CHECKLIST =====
app.get('/api/employee/checklist', requireAuth, (req, res) => {
  const user = db.prepare('SELECT profile_id FROM users WHERE id = ?').get(req.session.userId);
  let items;
  if (user.profile_id) {
    items = db.prepare(`
      SELECT ci.* FROM checklist_items ci
      JOIN profile_checklist_items pci ON pci.checklist_item_id = ci.id
      WHERE pci.profile_id = ? ORDER BY ci.order_index ASC`).all(user.profile_id);
  } else {
    items = db.prepare('SELECT * FROM checklist_items ORDER BY order_index ASC').all();
  }
  const progress = db.prepare('SELECT * FROM checklist_progress WHERE user_id = ?').all(req.session.userId);
  const progressMap = {};
  progress.forEach(p => { progressMap[p.checklist_item_id] = p; });
  res.json(items.map(item => ({ ...item, progress: progressMap[item.id] || null })));
});

app.post('/api/employee/checklist/:itemId/complete', requireAuth, (req, res) => {
  const item = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
  db.prepare(`INSERT INTO checklist_progress (user_id, checklist_item_id, completed_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id, checklist_item_id) DO UPDATE SET completed_at = datetime('now')`).run(req.session.userId, req.params.itemId);
  const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.session.userId);
  sendPushToAdmins('✅ Aufgabe abgehakt', `${user.full_name} hat „${item.title}" als erledigt markiert.`, '/admin.html');
  res.json({ ok: true });
});
app.post('/api/employee/checklist/:itemId/uncomplete', requireAuth, (req, res) => {
  const progress = db.prepare('SELECT * FROM checklist_progress WHERE user_id = ? AND checklist_item_id = ?').get(req.session.userId, req.params.itemId);
  if (progress?.confirmed_at) return res.status(400).json({ error: 'Bereits bestätigt' });
  db.prepare('DELETE FROM checklist_progress WHERE user_id = ? AND checklist_item_id = ?').run(req.session.userId, req.params.itemId);
  res.json({ ok: true });
});

// ===== ADMIN: CHECKLIST CONFIRM =====
app.post('/api/admin/employees/:userId/checklist/:itemId/confirm', requireAdmin, (req, res) => {
  const { confirmed_by } = req.body;
  if (!confirmed_by) return res.status(400).json({ error: 'Name erforderlich' });
  const progress = db.prepare('SELECT * FROM checklist_progress WHERE user_id = ? AND checklist_item_id = ?').get(req.params.userId, req.params.itemId);
  if (!progress) return res.status(400).json({ error: 'Noch nicht abgehakt' });
  db.prepare(`UPDATE checklist_progress SET confirmed_at = datetime('now'), confirmed_by = ? WHERE user_id = ? AND checklist_item_id = ?`).run(confirmed_by, req.params.userId, req.params.itemId);
  const confirmedItem = db.prepare('SELECT title FROM checklist_items WHERE id = ?').get(req.params.itemId);
  sendPushToUser(req.params.userId, '✅ Aufgabe bestätigt!', `„${confirmedItem?.title}" wurde von ${confirmed_by} bestätigt.`);
  res.json({ ok: true });
});
app.post('/api/admin/employees/:userId/checklist/:itemId/unconfirm', requireAdmin, (req, res) => {
  db.prepare('UPDATE checklist_progress SET confirmed_at = NULL, confirmed_by = NULL WHERE user_id = ? AND checklist_item_id = ?').run(req.params.userId, req.params.itemId);
  res.json({ ok: true });
});

// Admin: reject item with comment
app.post('/api/admin/employees/:userId/checklist/:itemId/reject', requireAdmin, (req, res) => {
  const { comment } = req.body;
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'Kommentar erforderlich' });
  db.prepare(`UPDATE checklist_progress SET completed_at = NULL, confirmed_at = NULL, confirmed_by = NULL, rejection_comment = ?, rejected_at = datetime('now') WHERE user_id = ? AND checklist_item_id = ?`).run(comment.trim(), req.params.userId, req.params.itemId);
  const rejectedItem = db.prepare('SELECT title FROM checklist_items WHERE id = ?').get(req.params.itemId);
  sendPushToUser(req.params.userId, '❌ Aufgabe abgelehnt', `„${rejectedItem?.title}" wurde abgelehnt. Kommentar: ${comment.trim()}`);
  res.json({ ok: true });
});

// ===== EMPLOYEE: PDF =====
app.get('/api/employee/report/pdf', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const profileUser = db.prepare('SELECT profile_id FROM users WHERE id = ?').get(req.session.userId);
  let items;
  if (profileUser.profile_id) {
    items = db.prepare(`SELECT ci.* FROM checklist_items ci JOIN profile_checklist_items pci ON pci.checklist_item_id = ci.id WHERE pci.profile_id = ? ORDER BY ci.order_index ASC`).all(profileUser.profile_id);
  } else {
    items = db.prepare('SELECT * FROM checklist_items ORDER BY order_index ASC').all();
  }
  const progress = db.prepare('SELECT * FROM checklist_progress WHERE user_id = ?').all(req.session.userId);
  const progressMap = {};
  progress.forEach(p => { progressMap[p.checklist_item_id] = p; });
  const allDone = items.every(item => progressMap[item.id]?.confirmed_at);
  if (!allDone) return res.status(400).json({ error: 'Nicht alle Aufgaben bestätigt' });

  try {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="onboarding-${user.username}.pdf"`);
    doc.pipe(res);
    const logoPath = path.join(__dirname, 'assets', 'logo.jpg');
    if (fs.existsSync(logoPath)) doc.image(logoPath, 50, 40, { width: 60 });
    doc.fontSize(20).font('Helvetica-Bold').text('Munich Flavour Onboarding Report', 0, 50, { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#000').stroke();
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Mitarbeiter: `, { continued: true }).font('Helvetica-Bold').text(user.full_name);
    doc.font('Helvetica').text(`Startdatum: `, { continued: true }).font('Helvetica-Bold').text(user.start_date ? new Date(user.start_date).toLocaleDateString('de-DE') : '-');
    doc.font('Helvetica').text(`Berichtsdatum: `, { continued: true }).font('Helvetica-Bold').text(new Date().toLocaleDateString('de-DE'));
    doc.moveDown(1);
    const colX = [50, 230, 350, 460];
    const colW = [175, 115, 105, 85];
    const rowH = 22;
    const drawHeader = () => {
      doc.rect(50, doc.y, 495, rowH).fill('#000');
      const y = doc.y + 6;
      doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold');
      ['Aufgabe','Erledigt am','Bestätigt am','Bestätigt von'].forEach((h,i) => doc.text(h, colX[i]+4, y, { width: colW[i]-8, lineBreak: false }));
      doc.y += rowH; doc.fillColor('#000');
    };
    drawHeader();
    doc.font('Helvetica').fontSize(9);
    items.forEach((item, idx) => {
      const p = progressMap[item.id];
      const rowY = doc.y;
      if (idx%2===1) doc.rect(50, rowY, 495, rowH).fill('#f5f5f5');
      doc.fillColor('#000');
      const cellY = rowY + 6;
      doc.text(item.title, colX[0]+4, cellY, { width: colW[0]-8, lineBreak: false });
      doc.text(p?.completed_at ? new Date(p.completed_at+'Z').toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'}) : '-', colX[1]+4, cellY, { width: colW[1]-8, lineBreak: false });
      doc.text(p?.confirmed_at ? new Date(p.confirmed_at+'Z').toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'}) : '-', colX[2]+4, cellY, { width: colW[2]-8, lineBreak: false });
      doc.text(p?.confirmed_by || '-', colX[3]+4, cellY, { width: colW[3]-8, lineBreak: false });
      doc.moveTo(50, rowY+rowH).lineTo(545, rowY+rowH).strokeColor('#ddd').stroke();
      doc.y = rowY+rowH;
      if (doc.y > 750) { doc.addPage(); drawHeader(); }
    });
    doc.moveDown(2);
    doc.moveTo(50,doc.y).lineTo(545,doc.y).strokeColor('#000').stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#666').font('Helvetica').text('Munich Flavour Onboarding Report', { align: 'center' });
    doc.end();
  } catch(err) {
    console.error('PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'PDF-Erstellung fehlgeschlagen' });
  }
});

// ===== DOCUMENTS =====
app.get('/api/documents', requireAuth, (req, res) => {
  res.json({
    folders: db.prepare('SELECT * FROM document_folders ORDER BY name ASC').all(),
    documents: db.prepare('SELECT * FROM documents ORDER BY original_name ASC').all()
  });
});
app.get('/api/documents/:id/download', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });
  const fp = path.join(uploadsAdminDir, doc.stored_name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.download(fp, doc.original_name);
});

app.get('/api/documents/:id/view', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });
  const fp = path.join(uploadsAdminDir, doc.stored_name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.setHeader('Content-Disposition', `inline; filename="${doc.original_name}"`);
  res.sendFile(fp);
});

// ===== ADMIN: EMPLOYEES =====
app.get('/api/admin/employees', requireAdmin, (req, res) => {
  const employees = db.prepare(`SELECT u.*, p.name as profile_name FROM users u LEFT JOIN profiles p ON p.id = u.profile_id WHERE u.role = 'employee' ORDER BY u.created_at DESC`).all();
  const result = employees.map(emp => {
    let items;
    if (emp.profile_id) {
      items = db.prepare(`SELECT ci.id FROM checklist_items ci JOIN profile_checklist_items pci ON pci.checklist_item_id = ci.id WHERE pci.profile_id = ?`).all(emp.profile_id);
    } else {
      items = db.prepare('SELECT id FROM checklist_items').all();
    }
    const total = items.length;
    const itemIds = items.map(i => i.id);
    const done = itemIds.length > 0 ? db.prepare(`SELECT COUNT(*) as cnt FROM checklist_progress WHERE user_id = ? AND checklist_item_id IN (${itemIds.map(()=>'?').join(',')}) AND confirmed_at IS NOT NULL`).get(emp.id, ...itemIds).cnt : 0;
    const pending = itemIds.length > 0 ? db.prepare(`SELECT COUNT(*) as cnt FROM checklist_progress WHERE user_id = ? AND checklist_item_id IN (${itemIds.map(()=>'?').join(',')}) AND completed_at IS NOT NULL AND confirmed_at IS NULL`).get(emp.id, ...itemIds).cnt : 0;
    const rejected = itemIds.length > 0 ? db.prepare(`SELECT COUNT(*) as cnt FROM checklist_progress WHERE user_id = ? AND checklist_item_id IN (${itemIds.map(()=>'?').join(',')}) AND completed_at IS NULL AND rejection_comment IS NOT NULL`).get(emp.id, ...itemIds).cnt : 0;
    return { ...emp, completed: done, total, pending, rejected };
  });
  res.json(result);
});

app.get('/api/admin/employees/:id', requireAdmin, (req, res) => {
  const user = db.prepare(`SELECT u.*, p.name as profile_name FROM users u LEFT JOIN profiles p ON p.id = u.profile_id WHERE u.id = ? AND u.role = 'employee'`).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Nicht gefunden' });
  let items;
  if (user.profile_id) {
    items = db.prepare(`SELECT ci.* FROM checklist_items ci JOIN profile_checklist_items pci ON pci.checklist_item_id = ci.id WHERE pci.profile_id = ? ORDER BY ci.order_index ASC`).all(user.profile_id);
  } else {
    items = db.prepare('SELECT * FROM checklist_items ORDER BY order_index ASC').all();
  }
  const progress = db.prepare('SELECT * FROM checklist_progress WHERE user_id = ?').all(req.params.id);
  const progressMap = {};
  progress.forEach(p => { progressMap[p.checklist_item_id] = p; });
  res.json({ user, checklist: items.map(item => ({ ...item, progress: progressMap[item.id] || null })) });
});

app.post('/api/admin/employees', requireAdmin, (req, res) => {
  const { username, password, full_name, start_date, profile_id } = req.body;
  if (!username || !password || !full_name) return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: 'Benutzername vergeben' });
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, start_date, profile_id) VALUES (?, ?, ?, 'employee', ?, ?)`).run(username, hash, full_name, start_date||null, profile_id||null);
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/admin/employees/:id', requireAdmin, (req, res) => {
  const user = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'employee'`).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Nicht gefunden' });
  const uploads = db.prepare('SELECT stored_name FROM employee_uploads WHERE user_id = ?').all(req.params.id);
  uploads.forEach(u => { const p = path.join(uploadsEmployeeDir, u.stored_name); if (fs.existsSync(p)) fs.unlinkSync(p); });
  db.prepare('DELETE FROM checklist_progress WHERE user_id = ?').run(req.params.id);
  db.prepare('DELETE FROM employee_uploads WHERE user_id = ?').run(req.params.id);
  db.prepare('DELETE FROM clothing_record_items WHERE record_id IN (SELECT id FROM clothing_records WHERE user_id = ?)').run(req.params.id);
  db.prepare('DELETE FROM clothing_records WHERE user_id = ?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== ADMIN: CHECKLIST STATS =====
app.get('/api/admin/stats/checklist', requireAdmin, (req, res) => {
  const items = db.prepare('SELECT * FROM checklist_items ORDER BY order_index ASC').all();
  const employees = db.prepare(`SELECT u.id, u.full_name, u.profile_id FROM users u WHERE u.role = 'employee'`).all();

  const result = items.map(item => {
    const confirmed = [], pending = [], rejected = [], open = [];

    employees.forEach(emp => {
      // Check if this item is relevant for this employee
      if (emp.profile_id) {
        const inProfile = db.prepare('SELECT 1 FROM profile_checklist_items WHERE profile_id = ? AND checklist_item_id = ?').get(emp.profile_id, item.id);
        if (!inProfile) return; // item not in this employee's profile
      }
      const p = db.prepare('SELECT * FROM checklist_progress WHERE user_id = ? AND checklist_item_id = ?').get(emp.id, item.id);
      const entry = { id: emp.id, full_name: emp.full_name };
      if (p?.confirmed_at) confirmed.push(entry);
      else if (p?.completed_at) pending.push(entry);
      else if (p?.rejection_comment) rejected.push(entry);
      else open.push(entry);
    });

    return { ...item, confirmed, pending, rejected, open };
  });

  res.json(result);
});

// ===== ADMIN: CHECKLIST EDITOR =====
app.get('/api/admin/checklist', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM checklist_items ORDER BY order_index ASC').all()));
app.post('/api/admin/checklist', requireAdmin, (req, res) => {
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ error: 'Titel erforderlich' });
  const maxOrder = db.prepare('SELECT MAX(order_index) as m FROM checklist_items').get().m || 0;
  const result = db.prepare('INSERT INTO checklist_items (title, description, order_index) VALUES (?, ?, ?)').run(title, description||'', maxOrder+1);
  res.json({ id: result.lastInsertRowid, title, description, order_index: maxOrder+1 });
});
app.put('/api/admin/checklist/:id', requireAdmin, (req, res) => {
  const { title, description, order_index } = req.body;
  if (!title) return res.status(400).json({ error: 'Titel erforderlich' });
  db.prepare('UPDATE checklist_items SET title = ?, description = ?, order_index = ? WHERE id = ?').run(title, description||'', order_index, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/checklist/:id', requireAdmin, (req, res) => {
  // Delete dependent rows first, then the item itself
  db.prepare('DELETE FROM checklist_progress WHERE checklist_item_id = ?').run(req.params.id);
  db.prepare('DELETE FROM profile_checklist_items WHERE checklist_item_id = ?').run(req.params.id);
  db.prepare('DELETE FROM checklist_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/checklist/reorder', requireAdmin, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids erforderlich' });
  const update = db.prepare('UPDATE checklist_items SET order_index = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, i) => update.run(i, id)))();
  res.json({ ok: true });
});

// ===== ADMIN: DOCUMENT FOLDERS & DOCUMENTS =====
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
  const docs = db.prepare('SELECT stored_name FROM documents WHERE folder_id = ?').all(req.params.id);
  docs.forEach(d => { const p = path.join(uploadsAdminDir, d.stored_name); if (fs.existsSync(p)) fs.unlinkSync(p); });
  db.prepare('DELETE FROM documents WHERE folder_id = ?').run(req.params.id);
  db.prepare('DELETE FROM document_folders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/documents', requireAdmin, adminUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  const { folder_id, description } = req.body;
  const result = db.prepare('INSERT INTO documents (folder_id, original_name, stored_name, description) VALUES (?, ?, ?, ?)').run(folder_id||null, req.file.originalname, req.file.filename, description||'');
  res.json({ id: result.lastInsertRowid });
});
app.delete('/api/admin/documents/:id', requireAdmin, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });
  const fp = path.join(uploadsAdminDir, doc.stored_name);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== EMPLOYEE UPLOADS =====
app.get('/api/employee/uploads', requireAuth, (req, res) => res.json(db.prepare('SELECT * FROM employee_uploads WHERE user_id = ? ORDER BY uploaded_at DESC').all(req.session.userId)));
app.post('/api/employee/uploads', requireAuth, employeeUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  const result = db.prepare('INSERT INTO employee_uploads (user_id, original_name, stored_name) VALUES (?, ?, ?)').run(req.session.userId, req.file.originalname, req.file.filename);
  const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.session.userId);
  sendPushToAdmins('📄 Neues Dokument', `${user.full_name} hat „${req.file.originalname}" hochgeladen.`, '/admin.html');
  res.json({ id: result.lastInsertRowid });
});
app.get('/api/employee/uploads/:id/download', requireAuth, (req, res) => {
  const upload = db.prepare('SELECT * FROM employee_uploads WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!upload) return res.status(404).json({ error: 'Nicht gefunden' });
  const fp = path.join(uploadsEmployeeDir, upload.stored_name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Nicht gefunden' });
  res.download(fp, upload.original_name);
});
app.delete('/api/employee/uploads/:id', requireAuth, (req, res) => {
  const upload = db.prepare('SELECT * FROM employee_uploads WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!upload) return res.status(404).json({ error: 'Nicht gefunden' });
  const fp = path.join(uploadsEmployeeDir, upload.stored_name);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  db.prepare('DELETE FROM employee_uploads WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.get('/api/admin/employees/:id/uploads', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM employee_uploads WHERE user_id = ? ORDER BY uploaded_at DESC').all(req.params.id)));
app.get('/api/admin/uploads/:id/download', requireAdmin, (req, res) => {
  const upload = db.prepare('SELECT * FROM employee_uploads WHERE id = ?').get(req.params.id);
  if (!upload) return res.status(404).json({ error: 'Nicht gefunden' });
  const fp = path.join(uploadsEmployeeDir, upload.stored_name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Nicht gefunden' });
  res.download(fp, upload.original_name);
});

// ===== CLOTHING =====
app.get('/api/admin/employees/:id/clothing', requireAdmin, (req, res) => {
  const records = db.prepare('SELECT * FROM clothing_records WHERE user_id = ? ORDER BY issued_at DESC').all(req.params.id);
  const result = records.map(r => ({
    ...r,
    items: db.prepare('SELECT * FROM clothing_record_items WHERE record_id = ?').all(r.id)
  }));
  res.json(result);
});

app.post('/api/admin/employees/:id/clothing', requireAdmin, (req, res) => {
  const { items, admin_name, admin_signature } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'Kleidungsstücke erforderlich' });
  if (!admin_name || !admin_signature) return res.status(400).json({ error: 'Admin-Name und Unterschrift erforderlich' });
  const result = db.prepare(`INSERT INTO clothing_records (user_id, admin_name, admin_signature, admin_signed_at) VALUES (?, ?, ?, datetime('now'))`).run(req.params.id, admin_name, admin_signature);
  const rid = result.lastInsertRowid;
  const insItem = db.prepare('INSERT INTO clothing_record_items (record_id, name, size, quantity) VALUES (?, ?, ?, ?)');
  db.transaction(() => items.forEach(item => insItem.run(rid, item.name, item.size||'', item.quantity||1)))();
  sendPushToUser(req.params.id, '👕 Neue Arbeitskleidung', `Dir wurde Arbeitskleidung ausgegeben. Bitte bestätige den Erhalt mit deiner Unterschrift.`);
  res.json({ id: rid });
});

app.post('/api/employee/clothing/:recordId/sign', requireAuth, (req, res) => {
  const { employee_signature } = req.body;
  if (!employee_signature) return res.status(400).json({ error: 'Unterschrift erforderlich' });
  const record = db.prepare('SELECT * FROM clothing_records WHERE id = ?').get(req.params.recordId);
  if (!record || record.user_id !== req.session.userId) return res.status(403).json({ error: 'Kein Zugriff' });
  if (record.employee_signed_at) return res.status(400).json({ error: 'Bereits unterschrieben' });
  db.prepare(`UPDATE clothing_records SET employee_signature = ?, employee_signed_at = datetime('now') WHERE id = ?`).run(employee_signature, req.params.recordId);
  const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.session.userId);
  sendPushToAdmins('👕 Kleidung unterschrieben', `${user.full_name} hat den Erhalt der Arbeitskleidung bestätigt.`, '/admin.html');
  res.json({ ok: true });
});

app.get('/api/employee/clothing', requireAuth, (req, res) => {
  const records = db.prepare('SELECT * FROM clothing_records WHERE user_id = ? ORDER BY issued_at DESC').all(req.session.userId);
  res.json(records.map(r => ({ ...r, items: db.prepare('SELECT * FROM clothing_record_items WHERE record_id = ?').all(r.id) })));
});

// Admin: initiate return
app.post('/api/admin/employees/:userId/clothing/:recordId/return', requireAdmin, (req, res) => {
  const { return_admin_name, return_admin_signature, return_notes, returned_items, fee_applicable } = req.body;
  if (!return_admin_name || !return_admin_signature) return res.status(400).json({ error: 'Admin-Name und Unterschrift erforderlich' });
  const record = db.prepare('SELECT * FROM clothing_records WHERE id = ? AND user_id = ?').get(req.params.recordId, req.params.userId);
  if (!record) return res.status(404).json({ error: 'Nicht gefunden' });
  db.prepare(`UPDATE clothing_records SET return_admin_name = ?, return_admin_signature = ?, return_admin_signed_at = datetime('now'), return_notes = ?, fee_applicable = ?, returned_at = datetime('now') WHERE id = ?`).run(return_admin_name, return_admin_signature, return_notes||'', fee_applicable?1:0, req.params.recordId);
  if (Array.isArray(returned_items)) {
    const upd = db.prepare('UPDATE clothing_record_items SET returned = ? WHERE id = ?');
    db.transaction(() => returned_items.forEach(({id, returned}) => upd.run(returned?1:0, id)))();
  }
  res.json({ ok: true });
});

// Employee: sign return
app.post('/api/employee/clothing/:recordId/return-sign', requireAuth, (req, res) => {
  const { return_employee_signature } = req.body;
  if (!return_employee_signature) return res.status(400).json({ error: 'Unterschrift erforderlich' });
  const record = db.prepare('SELECT * FROM clothing_records WHERE id = ?').get(req.params.recordId);
  if (!record || record.user_id !== req.session.userId) return res.status(403).json({ error: 'Kein Zugriff' });
  db.prepare(`UPDATE clothing_records SET return_employee_signature = ?, return_employee_signed_at = datetime('now') WHERE id = ?`).run(return_employee_signature, req.params.recordId);
  const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.session.userId);
  sendPushToAdmins('👕 Rückgabe bestätigt', `${user.full_name} hat die Rückgabe der Arbeitskleidung unterschrieben.`, '/admin.html');
  res.json({ ok: true });
});

// Clothing PDF (issuance or return)
app.get('/api/clothing/:recordId/pdf', requireAuth, (req, res) => {
  const record = db.prepare('SELECT cr.*, u.full_name, u.username FROM clothing_records cr JOIN users u ON u.id = cr.user_id WHERE cr.id = ?').get(req.params.recordId);
  if (!record) return res.status(404).json({ error: 'Nicht gefunden' });
  if (req.session.role !== 'admin' && record.user_id !== req.session.userId) return res.status(403).json({ error: 'Kein Zugriff' });
  const items = db.prepare('SELECT * FROM clothing_record_items WHERE record_id = ?').all(record.id);
  const isReturn = !!record.returned_at;
  const title = isReturn ? 'Rückgabeprotokoll Arbeitskleidung' : 'Ausgabeprotokoll Arbeitskleidung';

  try {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="kleidung-${isReturn?'rueckgabe':'ausgabe'}-${record.username}.pdf"`);
    doc.pipe(res);

    const logoPath = path.join(__dirname, 'assets', 'logo.jpg');
    if (fs.existsSync(logoPath)) doc.image(logoPath, 50, 40, { width: 60 });

    doc.fontSize(18).font('Helvetica-Bold').text(title, 0, 50, { align: 'center' });
    doc.fontSize(11).font('Helvetica').text('Munich Flavour', 0, 74, { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#000').stroke();
    doc.moveDown(0.8);

    doc.fontSize(11).font('Helvetica');
    doc.text(`Mitarbeiter: `, { continued: true }).font('Helvetica-Bold').text(record.full_name);
    doc.font('Helvetica').text(`Datum der Ausgabe: `, { continued: true }).font('Helvetica-Bold').text(new Date(record.issued_at+'Z').toLocaleDateString('de-DE'));
    if (isReturn) {
      doc.font('Helvetica').text(`Datum der Rückgabe: `, { continued: true }).font('Helvetica-Bold').text(new Date(record.returned_at+'Z').toLocaleDateString('de-DE'));
    }
    doc.moveDown(1);

    // Items table
    doc.fontSize(13).font('Helvetica-Bold').text('Kleidungsstücke');
    doc.moveDown(0.4);
    const colX2 = [50, 280, 380, 460];
    const colW2 = [225, 95, 75, 85];
    const rowH2 = 22;
    doc.rect(50, doc.y, 495, rowH2).fill('#000');
    const hy = doc.y + 6;
    doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold');
    ['Bezeichnung','Größe','Anzahl', isReturn?'Zurückgegeben':'Status'].forEach((h,i) => doc.text(h, colX2[i]+4, hy, { width: colW2[i]-8, lineBreak: false }));
    doc.y += rowH2; doc.fillColor('#000');

    items.forEach((item, idx) => {
      const rowY = doc.y;
      if (idx%2===1) doc.rect(50, rowY, 495, rowH2).fill('#f5f5f5');
      doc.fillColor('#000').font('Helvetica').fontSize(9);
      const cy = rowY + 6;
      doc.text(item.name, colX2[0]+4, cy, { width: colW2[0]-8, lineBreak: false });
      doc.text(item.size||'-', colX2[1]+4, cy, { width: colW2[1]-8, lineBreak: false });
      doc.text(String(item.quantity), colX2[2]+4, cy, { width: colW2[2]-8, lineBreak: false });
      doc.text(isReturn ? (item.returned ? '✓ Ja' : '✗ Fehlend') : '✓ Ausgegeben', colX2[3]+4, cy, { width: colW2[3]-8, lineBreak: false });
      doc.moveTo(50, rowY+rowH2).lineTo(545, rowY+rowH2).strokeColor('#ddd').stroke();
      doc.y = rowY+rowH2;
    });

    if (isReturn && record.return_notes) {
      doc.moveDown(1);
      doc.fontSize(11).font('Helvetica-Bold').text('Anmerkungen:');
      doc.font('Helvetica').fontSize(10).text(record.return_notes);
    }
    if (isReturn && record.fee_applicable) {
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#cc0000').text('⚠ Fehlende Kleidungsstücke – Gebühr fällig');
      doc.fillColor('#000');
    }

    // Signatures
    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.8);
    doc.fontSize(11).font('Helvetica-Bold').text(isReturn ? 'Unterschriften Rückgabe' : 'Unterschriften Ausgabe');
    doc.moveDown(0.5);

    const sigY = doc.y;
    // Admin sig
    doc.fontSize(10).font('Helvetica').text('Vorgesetzter/Admin:', 50, sigY);
    doc.text(isReturn ? (record.return_admin_name||'-') : (record.admin_name||'-'), 50, sigY+14);
    const adminSig = isReturn ? record.return_admin_signature : record.admin_signature;
    if (adminSig) {
      try { doc.image(Buffer.from(adminSig.split(',')[1], 'base64'), 50, sigY+30, { width: 180, height: 60 }); } catch(e) {}
    }
    doc.moveTo(50, sigY+95).lineTo(230, sigY+95).strokeColor('#000').stroke();
    doc.fontSize(9).fillColor('#666').text('Unterschrift', 50, sigY+98);

    // Employee sig
    doc.fillColor('#000').fontSize(10).font('Helvetica').text('Mitarbeiter:', 300, sigY);
    doc.text(record.full_name, 300, sigY+14);
    const empSig = isReturn ? record.return_employee_signature : record.employee_signature;
    if (empSig) {
      try { doc.image(Buffer.from(empSig.split(',')[1], 'base64'), 300, sigY+30, { width: 180, height: 60 }); } catch(e) {}
    }
    doc.moveTo(300, sigY+95).lineTo(480, sigY+95).strokeColor('#000').stroke();
    doc.fontSize(9).fillColor('#666').text('Unterschrift', 300, sigY+98);

    doc.moveDown(8);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#000').stroke();
    doc.moveDown(0.4);
    doc.fontSize(9).fillColor('#999').text('Munich Flavour Onboarding – ' + title, { align: 'center' });

    doc.end();
  } catch(err) {
    console.error('Clothing PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'PDF-Erstellung fehlgeschlagen' });
  }
});

app.get('/', (req, res) => res.redirect('/login.html'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Munich Flavour Onboarding läuft auf http://localhost:${PORT}`));
