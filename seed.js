const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

const db = new Database(path.join(dbDir, 'onboarding.db'));

db.exec(`PRAGMA foreign_keys = OFF;`);

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

// Admin account
const adminHash = bcrypt.hashSync('admin123', 10);
db.prepare(`INSERT OR IGNORE INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'admin')`).run('admin', adminHash, 'Administrator');

// Clear and re-insert checklist items (delete in correct order)
db.prepare('DELETE FROM profile_checklist_items').run();
db.prepare('DELETE FROM checklist_progress').run();
db.prepare('DELETE FROM checklist_items').run();

const items = [
  {
    title: 'Personalfragebogen',
    description: 'Personalfragebogen vollständig ausfüllen, unterschreiben und im System hochladen.'
  },
  {
    title: 'Rentman App einrichten',
    description: 'Rentman App installieren und den persönlichen Zugang mit den erhaltenen Zugangsdaten einrichten.'
  },
  {
    title: 'Infektionsschutzbelehrung',
    description: 'Infektionsschutzbelehrung gemäß §43 IfSG absolvieren, Bestätigung unterschreiben und hochladen.'
  },
  {
    title: 'Einarbeitungsleitfaden',
    description: 'Einarbeitungsleitfaden von Munich Flavour vollständig durchlesen und Kenntnisnahme bestätigen.'
  },
  {
    title: 'Einweisung im Lager',
    description: 'Lagerstruktur und Logik kennenlernen, Lieferscheine und Packlisten kontrollieren, Materialien korrekt einlagern (Leergut, Bars, Stehtische etc.) sowie Schlüsselsafe, Parkplätze und Müllentsorgung kennenlernen.'
  },
  {
    title: 'Beladen & Einweisung der Transporter',
    description: 'Sicheres Verstauen von Equipment und Getränken mit Spanngurten, fachgerechter Umgang mit zerbrechlichem Material, Ladungssicherung sowie Sauberkeit im Fahrzeug. Nutzung der Tankkarten und korrektes Verhalten bei Schäden.'
  },
  {
    title: 'Einweisung der Barkonzepte',
    description: 'Vorstellung und Erklärung aller verfügbaren Barkonzepte von Munich Flavour, einschließlich Aufbau, Ausstattung und Einsatzbereiche der einzelnen Konzepte. Anschließend praktische Übung zum eigenständigen Auf- und Abbau, damit der Ablauf bei Veranstaltungen sicher und effizient umgesetzt werden kann.'
  },
  {
    title: 'Cocktail-Schulung',
    description: 'Einarbeitung in das aktuelle Cocktailmenü von Munich Flavour, einschließlich aller Rezepturen, Zutaten und Mengenangaben. Erlernen der fachgerechten Zubereitungstechniken, des professionellen Umgangs mit Barequipment sowie der ansprechenden Präsentation und Ausgabe der Getränke. Ziel ist es, jeden Cocktail sicher, schnell und in gleichbleibender Qualität zubereiten zu können.'
  },
  {
    title: 'Kaffee & Barista-Schulung',
    description: 'Einarbeitung in die fachgerechte Zubereitung von Espresso- und Kaffeespezialitäten nach Munich Flavour Standard, einschließlich der richtigen Einstellung und Bedienung der Kaffeemaschine sowie des Mahlgrads. Erlernen der korrekten Milchschaumtechnik für verschiedene Getränke wie Cappuccino, Latte Macchiato und weitere Spezialitäten.'
  },
  {
    title: 'Smoothie & Matcha-Schulung',
    description: 'Einarbeitung in die Zubereitung von Smoothies und Matcha-Getränken nach den Standards von Munich Flavour, einschließlich der richtigen Verwendung von Zutaten, Mengenangaben und Rezepturen. Erlernen der fachgerechten Bedienung der Geräte sowie der optimalen Zubereitung für gleichbleibende Qualität und Geschmack.'
  },
];

const insertItem = db.prepare('INSERT INTO checklist_items (title, description, order_index) VALUES (?, ?, ?)');
items.forEach((item, i) => insertItem.run(item.title, item.description, i));

// Document folders (only insert if not already present)
const folderNames = ['Personalfragebögen', 'Einarbeitungsleitfaden', 'Rentman', 'Rezepte'];
const insertFolder = db.prepare('INSERT OR IGNORE INTO document_folders (name, parent_id) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM document_folders WHERE name = ? AND parent_id IS NULL)');
folderNames.forEach(name => insertFolder.run(name, null, name));

console.log('✓ Admin-Account erstellt: admin / admin123');
console.log(`✓ ${items.length} Onboarding-Aufgaben eingefügt`);
console.log(`✓ Ordnerstruktur angelegt: ${folderNames.join(', ')}`);
console.log('Seed abgeschlossen.');
