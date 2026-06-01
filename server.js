const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();
const db = new Database(path.join(__dirname, 'db', 'onboarding.db'));

// Ensure db directory exists
if (!fs.existsSync(path.join(__dirname, 'db'))) {
  fs.mkdirSync(path.join(__dirname, 'db'));
}

// Initialize database schema
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
    countersigned_by TEXT,
    signature_data_url TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (checklist_item_id) REFERENCES checklist_items(id),
    UNIQUE(user_id, checklist_item_id)
  );
`);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve logo from assets
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'db') }),
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

// Auth routes
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });

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

// Employee routes
app.get('/api/employee/checklist', requireAuth, (req, res) => {
  const items = db.prepare('SELECT * FROM checklist_items ORDER BY order_index ASC').all();
  const progress = db.prepare('SELECT * FROM checklist_progress WHERE user_id = ?').all(req.session.userId);
  const progressMap = {};
  progress.forEach(p => { progressMap[p.checklist_item_id] = p; });

  const result = items.map(item => ({
    ...item,
    progress: progressMap[item.id] || null
  }));

  res.json(result);
});

app.post('/api/employee/checklist/:itemId/complete', requireAuth, (req, res) => {
  const { itemId } = req.params;
  const { countersigned_by, signature_data_url } = req.body;

  if (!countersigned_by || !signature_data_url) {
    return res.status(400).json({ error: 'Vorgesetztenname und Unterschrift erforderlich' });
  }

  const item = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(itemId);
  if (!item) return res.status(404).json({ error: 'Aufgabe nicht gefunden' });

  db.prepare(`
    INSERT INTO checklist_progress (user_id, checklist_item_id, completed_at, countersigned_by, signature_data_url)
    VALUES (?, ?, datetime('now'), ?, ?)
    ON CONFLICT(user_id, checklist_item_id) DO UPDATE SET
      completed_at = datetime('now'),
      countersigned_by = excluded.countersigned_by,
      signature_data_url = excluded.signature_data_url
  `).run(req.session.userId, itemId, countersigned_by, signature_data_url);

  res.json({ ok: true });
});

// PDF generation
app.get('/api/employee/report/pdf', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const items = db.prepare('SELECT * FROM checklist_items ORDER BY order_index ASC').all();
  const progress = db.prepare('SELECT * FROM checklist_progress WHERE user_id = ?').all(req.session.userId);
  const progressMap = {};
  progress.forEach(p => { progressMap[p.checklist_item_id] = p; });

  const allDone = items.every(item => progressMap[item.id]?.completed_at);
  if (!allDone) return res.status(400).json({ error: 'Nicht alle Aufgaben abgeschlossen' });

  const logoPath = path.join(__dirname, 'assets', 'logo.jpg');
  let logoBase64 = '';
  if (fs.existsSync(logoPath)) {
    logoBase64 = 'data:image/jpeg;base64,' + fs.readFileSync(logoPath).toString('base64');
  }

  const rows = items.map(item => {
    const p = progressMap[item.id];
    const date = p?.completed_at ? new Date(p.completed_at + 'Z').toLocaleString('de-DE') : '-';
    const sig = p?.signature_data_url ? `<img src="${p.signature_data_url}" style="height:40px;">` : '-';
    return `
      <tr>
        <td>${item.title}</td>
        <td>${date}</td>
        <td>${p?.countersigned_by || '-'}</td>
        <td>${sig}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; margin: 40px; color: #000; }
  .header { text-align: center; margin-bottom: 30px; }
  .header img { height: 80px; margin-bottom: 10px; }
  h1 { font-size: 22px; margin: 8px 0; }
  .info { margin-bottom: 24px; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #000; color: #fff; padding: 8px; text-align: left; }
  td { padding: 8px; border-bottom: 1px solid #ccc; vertical-align: middle; }
  tr:nth-child(even) td { background: #f5f5f5; }
  .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #666; border-top: 1px solid #ccc; padding-top: 12px; }
</style>
</head>
<body>
  <div class="header">
    ${logoBase64 ? `<img src="${logoBase64}" alt="Munich Flavour Logo">` : ''}
    <h1>Munich Flavour Onboarding Report</h1>
  </div>
  <div class="info">
    <strong>Mitarbeiter:</strong> ${user.full_name}<br>
    <strong>Startdatum:</strong> ${user.start_date ? new Date(user.start_date).toLocaleDateString('de-DE') : '-'}<br>
    <strong>Berichtsdatum:</strong> ${new Date().toLocaleDateString('de-DE')}
  </div>
  <table>
    <thead>
      <tr>
        <th>Aufgabe</th>
        <th>Abgeschlossen am</th>
        <th>Gegengezeichnet von</th>
        <th>Unterschrift</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">Munich Flavour Onboarding Report</div>
</body>
</html>`;

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

// Admin routes
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
  const user = db.prepare('SELECT id, username, full_name, role, start_date FROM users WHERE id = ? AND role = ?').get(req.params.id, 'employee');
  if (!user) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });

  const items = db.prepare('SELECT * FROM checklist_items ORDER BY order_index ASC').all();
  const progress = db.prepare('SELECT * FROM checklist_progress WHERE user_id = ?').all(req.params.id);
  const progressMap = {};
  progress.forEach(p => { progressMap[p.checklist_item_id] = p; });

  const checklist = items.map(item => ({ ...item, progress: progressMap[item.id] || null }));
  res.json({ user, checklist });
});

app.post('/api/admin/employees', requireAdmin, (req, res) => {
  const { username, password, full_name, start_date } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: 'Benutzername, Passwort und Name erforderlich' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Benutzername bereits vergeben' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, start_date) VALUES (?, ?, ?, 'employee', ?)`).run(username, hash, full_name, start_date || null);

  res.json({ id: result.lastInsertRowid, username, full_name, start_date });
});

// Checklist admin routes
app.get('/api/admin/checklist', requireAdmin, (req, res) => {
  const items = db.prepare('SELECT * FROM checklist_items ORDER BY order_index ASC').all();
  res.json(items);
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
  const { ids } = req.body; // array of ids in new order
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array erforderlich' });

  const update = db.prepare('UPDATE checklist_items SET order_index = ? WHERE id = ?');
  const transaction = db.transaction(() => {
    ids.forEach((id, index) => update.run(index, id));
  });
  transaction();
  res.json({ ok: true });
});

// Default route
app.get('/', (req, res) => res.redirect('/login.html'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Munich Flavour Onboarding läuft auf http://localhost:${PORT}`));
