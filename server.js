const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const puppeteer = require('puppeteer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Ensure directories exist
const dbDir = path.join(__dirname, 'db');
const uploadsAdminDir = path.join(dbDir, 'uploads', 'admin');
const uploadsEmployeeDir = path.join(dbDir, 'uploads', 'employee');
[dbDir, uploadsAdminDir, uploadsEmployeeDir].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const db = new Database(path.join(dbDir, 'onboarding.db'));

// Database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    start_date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
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
`);

// Multer config for admin documents
const adminStorage = multer.diskStorage({
  destination: uploadsAdminDir,
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  }
});
const adminUpload = multer({ storage: adminStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// Multer config for employee uploads
const employeeStorage = multer.diskStorage({
  destination: uploadsEmployeeDir,
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  }
});
const employeeUpload = multer({ storage: employeeStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// Migrate existing DB: add new columns if missing
try {
  db.exec(`ALTER TABLE checklist_progress ADD COLUMN confirmed_at TEXT`);
} catch(e) {}
try {
  db.exec(`ALTER TABLE checklist_progress ADD COLUMN confirmed_by TEXT`);
} catch(e) {}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: dbDir }),
  secret: 'munich-flavour-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Nicht angemeldet' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Kein Zugriff' });
  }
  next();
}

// ===== AUTH =====
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.fullName = user.full_name;
  res.json({ role: user.role, fullName: user.full_name });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, full_name, role, start_date FROM users WHERE id = ?').get(req.session.userId);
  res.json(user);
});

// ===== EMPLOYEE: CHECKLIST =====
app.get('/api/employee/checklist', requireAuth, (req, res) => {
  const items = db.prepare('SELECT * FROM checklist_items ORDER BY order_index ASC').all();
  const progress = db.prepare('SELECT * FROM checklist_progress WHERE user_id = ?').all(req.session.userId);
  const progressMap = {};
  progress.forEach(p => { progressMap[p.checklist_item_id] = p; });
  res.json(items.map(item => ({ ...item, progress: progressMap[item.id] || null })));
});

// Employee: mark item as done (no signature needed)
app.post('/api/employee/checklist/:itemId/complete', requireAuth, (req, res) => {
  const { itemId } = req.params;
  const item = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(itemId);
  if (!item) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });
  db.prepare(`
    INSERT INTO checklist_progress (user_id, checklist_item_id, completed_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id, checklist_item_id) DO UPDATE SET completed_at = datetime('now')
  `).run(req.session.userId, itemId);
  res.json({ ok: true });
});

// Employee: uncheck item (only if not yet confirmed by admin)
app.post('/api/employee/checklist/:itemId/uncomplete', requireAuth, (req, res) => {
  const progress = db.prepare('SELECT * FROM checklist_progress WHERE user_id = ? AND checklist_item_id = ?').get(req.session.userId, req.params.itemId);
  if (progress?.confirmed_at) return res.status(400).json({ error: 'Bereits vom Admin bestätigt – kann nicht rückgängig gemacht werden' });
  db.prepare('DELETE FROM checklist_progress WHERE user_id = ? AND checklist_item_id = ?').run(req.session.userId, req.params.itemId);
  res.json({ ok: true });
});

// ===== EMPLOYEE: PDF =====
app.get('/api/employee/report/pdf', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const items = db.prepare('SELECT * FROM checklist_items ORDER BY order_index ASC').all();
  const progress = db.prepare('SELECT * FROM checklist_progress WHERE user_id = ?').all(req.session.userId);
  const progressMap = {};
  progress.forEach(p => { progressMap[p.checklist_item_id] = p; });
  const allDone = items.every(item => progressMap[item.id]?.confirmed_at);
  if (!allDone) return res.status(400).json({ error: 'Nicht alle Aufgaben vom Admin bestätigt' });

  const logoPath = path.join(__dirname, 'assets', 'logo.jpg');
  let logoBase64 = '';
  if (fs.existsSync(logoPath)) logoBase64 = 'data:image/jpeg;base64,' + fs.readFileSync(logoPath).toString('base64');

  const rows = items.map(item => {
    const p = progressMap[item.id];
    const doneDate = p?.completed_at ? new Date(p.completed_at + 'Z').toLocaleString('de-DE') : '-';
    const confirmDate = p?.confirmed_at ? new Date(p.confirmed_at + 'Z').toLocaleString('de-DE') : '-';
    return `<tr><td>${item.title}</td><td>${doneDate}</td><td>${confirmDate}</td><td>${p?.confirmed_by || '-'}</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>
    body{font-family:Arial,sans-serif;margin:40px;color:#000}
    .header{text-align:center;margin-bottom:30px}
    .header img{height:80px;margin-bottom:10px}
    h1{font-size:22px;margin:8px 0}
    .info{margin-bottom:24px;font-size:14px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{background:#000;color:#fff;padding:8px;text-align:left}
    td{padding:8px;border-bottom:1px solid #ccc;vertical-align:middle}
    tr:nth-child(even) td{background:#f5f5f5}
    .footer{margin-top:40px;text-align:center;font-size:12px;color:#666;border-top:1px solid #ccc;padding-top:12px}
  </style></head><body>
    <div class="header">${logoBase64 ? `<img src="${logoBase64}" alt="Logo">` : ''}<h1>Munich Flavour Onboarding Report</h1></div>
    <div class="info"><strong>Mitarbeiter:</strong> ${user.full_name}<br><strong>Startdatum:</strong> ${user.start_date ? new Date(user.start_date).toLocaleDateString('de-DE') : '-'}<br><strong>Berichtsdatum:</strong> ${new Date().toLocaleDateString('de-DE')}</div>
    <table><thead><tr><th>Aufgabe</th><th>Erledigt am</th><th>Bestätigt am</th><th>Bestätigt von</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="footer">Munich Flavour Onboarding Report</div>
  </body></html>`;

  try {
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' } });
    await browser.close();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="onboarding-${user.username}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('PDF error:', err);
    res.status(500).json({ error: 'PDF-Erstellung fehlgeschlagen' });
  }
});

// ===== DOCUMENTS (shared) =====
// Get full folder tree with documents
app.get('/api/documents', requireAuth, (req, res) => {
  const folders = db.prepare('SELECT * FROM document_folders ORDER BY name ASC').all();
  const documents = db.prepare('SELECT * FROM documents ORDER BY original_name ASC').all();
  res.json({ folders, documents });
});

// Download a document
app.get('/api/documents/:id/download', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });
  const filePath = path.join(uploadsAdminDir, doc.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.download(filePath, doc.original_name);
});

// ===== ADMIN: EMPLOYEES =====
app.get('/api/admin/employees', requireAdmin, (req, res) => {
  const employees = db.prepare(`SELECT id, username, full_name, role, start_date, created_at FROM users WHERE role = 'employee' ORDER BY created_at DESC`).all();
  const total = db.prepare('SELECT COUNT(*) as cnt FROM checklist_items').get().cnt;
  const result = employees.map(emp => {
    const done = db.prepare(`SELECT COUNT(*) as cnt FROM checklist_progress WHERE user_id = ? AND completed_at IS NOT NULL`).get(emp.id).cnt;
    return { ...emp, completed: done, total };
  });
  res.json(result);
});

app.get('/api/admin/employees/:id', requireAdmin, (req, res) => {
  const user = db.prepare(`SELECT id, username, full_name, role, start_date FROM users WHERE id = ? AND role = 'employee'`).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
  const items = db.prepare('SELECT * FROM checklist_items ORDER BY order_index ASC').all();
  const progress = db.prepare('SELECT * FROM checklist_progress WHERE user_id = ?').all(req.params.id);
  const progressMap = {};
  progress.forEach(p => { progressMap[p.checklist_item_id] = p; });
  res.json({ user, checklist: items.map(item => ({ ...item, progress: progressMap[item.id] || null })) });
});

app.post('/api/admin/employees', requireAdmin, (req, res) => {
  const { username, password, full_name, start_date } = req.body;
  if (!username || !password || !full_name) return res.status(400).json({ error: 'Benutzername, Passwort und Name erforderlich' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: 'Benutzername bereits vergeben' });
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, start_date) VALUES (?, ?, ?, 'employee', ?)`).run(username, hash, full_name, start_date || null);
  res.json({ id: result.lastInsertRowid, username, full_name, start_date });
});

// Admin: confirm a checklist item for an employee
app.post('/api/admin/employees/:userId/checklist/:itemId/confirm', requireAdmin, (req, res) => {
  const { userId, itemId } = req.params;
  const { confirmed_by } = req.body;
  if (!confirmed_by) return res.status(400).json({ error: 'Name erforderlich' });
  const progress = db.prepare('SELECT * FROM checklist_progress WHERE user_id = ? AND checklist_item_id = ?').get(userId, itemId);
  if (!progress) return res.status(400).json({ error: 'Mitarbeiter hat diesen Punkt noch nicht abgehakt' });
  db.prepare(`UPDATE checklist_progress SET confirmed_at = datetime('now'), confirmed_by = ? WHERE user_id = ? AND checklist_item_id = ?`).run(confirmed_by, userId, itemId);
  res.json({ ok: true });
});

// Admin: revoke confirmation
app.post('/api/admin/employees/:userId/checklist/:itemId/unconfirm', requireAdmin, (req, res) => {
  const { userId, itemId } = req.params;
  db.prepare('UPDATE checklist_progress SET confirmed_at = NULL, confirmed_by = NULL WHERE user_id = ? AND checklist_item_id = ?').run(userId, itemId);
  res.json({ ok: true });
});

app.delete('/api/admin/employees/:id', requireAdmin, (req, res) => {
  const user = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'employee'`).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
  // Delete employee uploads from disk
  const uploads = db.prepare('SELECT stored_name FROM employee_uploads WHERE user_id = ?').all(req.params.id);
  uploads.forEach(u => {
    const p = path.join(uploadsEmployeeDir, u.stored_name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  db.prepare('DELETE FROM checklist_progress WHERE user_id = ?').run(req.params.id);
  db.prepare('DELETE FROM employee_uploads WHERE user_id = ?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== ADMIN: CHECKLIST =====
app.get('/api/admin/checklist', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM checklist_items ORDER BY order_index ASC').all());
});
app.post('/api/admin/checklist', requireAdmin, (req, res) => {
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ error: 'Titel erforderlich' });
  const maxOrder = db.prepare('SELECT MAX(order_index) as m FROM checklist_items').get().m || 0;
  const result = db.prepare('INSERT INTO checklist_items (title, description, order_index) VALUES (?, ?, ?)').run(title, description || '', maxOrder + 1);
  res.json({ id: result.lastInsertRowid, title, description, order_index: maxOrder + 1 });
});
app.put('/api/admin/checklist/:id', requireAdmin, (req, res) => {
  const { title, description, order_index } = req.body;
  if (!title) return res.status(400).json({ error: 'Titel erforderlich' });
  db.prepare('UPDATE checklist_items SET title = ?, description = ?, order_index = ? WHERE id = ?').run(title, description || '', order_index, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/checklist/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM checklist_items WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM checklist_progress WHERE checklist_item_id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/checklist/reorder', requireAdmin, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array erforderlich' });
  const update = db.prepare('UPDATE checklist_items SET order_index = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, i) => update.run(i, id)))();
  res.json({ ok: true });
});

// ===== ADMIN: DOCUMENT FOLDERS =====
app.post('/api/admin/folders', requireAdmin, (req, res) => {
  const { name, parent_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });
  const result = db.prepare('INSERT INTO document_folders (name, parent_id) VALUES (?, ?)').run(name, parent_id || null);
  res.json({ id: result.lastInsertRowid, name, parent_id: parent_id || null });
});

app.put('/api/admin/folders/:id', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });
  db.prepare('UPDATE document_folders SET name = ? WHERE id = ?').run(name, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/folders/:id', requireAdmin, (req, res) => {
  // Delete all documents in this folder from disk
  const docs = db.prepare('SELECT stored_name FROM documents WHERE folder_id = ?').all(req.params.id);
  docs.forEach(d => {
    const p = path.join(uploadsAdminDir, d.stored_name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
  db.prepare('DELETE FROM documents WHERE folder_id = ?').run(req.params.id);
  db.prepare('DELETE FROM document_folders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== ADMIN: DOCUMENTS =====
app.post('/api/admin/documents', requireAdmin, adminUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  const { folder_id, description } = req.body;
  const result = db.prepare('INSERT INTO documents (folder_id, original_name, stored_name, description) VALUES (?, ?, ?, ?)').run(folder_id || null, req.file.originalname, req.file.filename, description || '');
  res.json({ id: result.lastInsertRowid, original_name: req.file.originalname, folder_id: folder_id || null });
});

app.delete('/api/admin/documents/:id', requireAdmin, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });
  const filePath = path.join(uploadsAdminDir, doc.stored_name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== EMPLOYEE UPLOADS =====
app.get('/api/employee/uploads', requireAuth, (req, res) => {
  const uploads = db.prepare('SELECT * FROM employee_uploads WHERE user_id = ? ORDER BY uploaded_at DESC').all(req.session.userId);
  res.json(uploads);
});

app.post('/api/employee/uploads', requireAuth, employeeUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  const result = db.prepare('INSERT INTO employee_uploads (user_id, original_name, stored_name) VALUES (?, ?, ?)').run(req.session.userId, req.file.originalname, req.file.filename);
  res.json({ id: result.lastInsertRowid, original_name: req.file.originalname });
});

app.get('/api/employee/uploads/:id/download', requireAuth, (req, res) => {
  const upload = db.prepare('SELECT * FROM employee_uploads WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!upload) return res.status(404).json({ error: 'Datei nicht gefunden' });
  const filePath = path.join(uploadsEmployeeDir, upload.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.download(filePath, upload.original_name);
});

app.delete('/api/employee/uploads/:id', requireAuth, (req, res) => {
  const upload = db.prepare('SELECT * FROM employee_uploads WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!upload) return res.status(404).json({ error: 'Datei nicht gefunden' });
  const filePath = path.join(uploadsEmployeeDir, upload.stored_name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM employee_uploads WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Admin: view employee uploads
app.get('/api/admin/employees/:id/uploads', requireAdmin, (req, res) => {
  const uploads = db.prepare('SELECT * FROM employee_uploads WHERE user_id = ? ORDER BY uploaded_at DESC').all(req.params.id);
  res.json(uploads);
});

app.get('/api/admin/uploads/:id/download', requireAdmin, (req, res) => {
  const upload = db.prepare('SELECT * FROM employee_uploads WHERE id = ?').get(req.params.id);
  if (!upload) return res.status(404).json({ error: 'Datei nicht gefunden' });
  const filePath = path.join(uploadsEmployeeDir, upload.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.download(filePath, upload.original_name);
});

app.get('/', (req, res) => res.redirect('/login.html'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Munich Flavour Onboarding läuft auf http://localhost:${PORT}`));
