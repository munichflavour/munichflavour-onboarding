const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

const db = new Database(path.join(dbDir, 'onboarding.db'));

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

// Create admin
const adminHash = bcrypt.hashSync('admin123', 10);
db.prepare(`INSERT OR IGNORE INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'admin')`).run('admin', adminHash, 'Administrator');

// Checklist items
const items = [
  { title: 'Einführung in die Barausstattung', description: 'Kennenlernen aller Bargeräte, Werkzeuge und Ausstattungsgegenstände der Mobilbar.' },
  { title: 'Hygiene- und Sicherheitsunterweisung', description: 'Einweisung in Hygienevorschriften, Lebensmittelsicherheit und Arbeitssicherheit bei Events.' },
  { title: 'Cocktailkarten-Schulung', description: 'Einarbeitung in das aktuelle Cocktailmenü, Rezepturen und Zubereitungstechniken.' },
  { title: 'Einweisung in den Auf- und Abbau der Mobilbar', description: 'Praktische Übung zum korrekten Auf- und Abbau der Mobilbar bei Veranstaltungen.' },
  { title: 'Getränkelager und Bestandsverwaltung', description: 'Einführung in Lagerorganisation, Bestandsführung und Bestellprozesse für Getränke und Zutaten.' },
  { title: 'Umgang mit Kunden und Kommunikation bei Events', description: 'Schulung zu Gästebetreuung, professioneller Kommunikation und Servicestandards.' },
  { title: 'Kassensystem und Abrechnung', description: 'Einweisung in das Kassensystem, Zahlungsabwicklung und Tagesabrechnung.' },
  { title: 'Notfallprozesse und Ansprechpartner', description: 'Bekanntmachung mit Notfallplänen, Erste-Hilfe-Maßnahmen und internen Ansprechpartnern.' },
];

const insert = db.prepare('INSERT OR IGNORE INTO checklist_items (title, description, order_index) VALUES (?, ?, ?)');
items.forEach((item, i) => insert.run(item.title, item.description, i));

console.log('✓ Admin-Account erstellt: admin / admin123');
console.log(`✓ ${items.length} Onboarding-Aufgaben eingefügt`);
console.log('Seed abgeschlossen.');
