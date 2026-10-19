// Tabellen des Catering-Kalkulators. Alle Namen beginnen mit catering_ bzw. rentman_,
// bestehende Tabellen werden nicht angefasst. Mengen und Geldbeträge stehen als TEXT (Decimal-Strings).
// Änderungen am Schema kommen als neuer Eintrag in MIGRATIONS (nie bestehende Einträge ändern).
const MIGRATIONS = [
  // 1: Grundstruktur
  `
  CREATE TABLE catering_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE catering_suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    note TEXT,
    archived INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE catering_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    goods_group TEXT,                      -- Warengruppe (Obst und Gemüse, Fleisch, ...)
    base_unit TEXT NOT NULL,               -- g, ml, stk, pkg
    purchase_unit TEXT NOT NULL,
    pack_size TEXT,                        -- Standardgebinde in Einkaufseinheit
    supplier_id INTEGER REFERENCES catering_suppliers(id),
    price TEXT,                            -- Preis je Einkaufseinheit, optional
    loss_pct TEXT,                         -- Standard-Zubereitungsverlust in Prozent, optional
    density_g_per_ml TEXT,                 -- nur für Gewicht <-> Volumen
    discrete_rules TEXT,                   -- JSON, z. B. {"stk":{"amount":"60","unit":"g"}}
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE catering_recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rentman_item_id TEXT,                  -- Zuordnung über Rentman-Artikel-ID
    article_no TEXT,                       -- interne Artikelnummer
    category_id INTEGER REFERENCES catering_categories(id),
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_recipes_rentman ON catering_recipes(rentman_item_id);
  CREATE INDEX idx_recipes_article ON catering_recipes(article_no);

  -- Rezepturversionen sind unveränderlich; Bearbeiten legt eine neue Version an.
  CREATE TABLE catering_recipe_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES catering_recipes(id),
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    photo TEXT,
    calc_unit TEXT NOT NULL DEFAULT 'Portion',
    ref_qty TEXT NOT NULL,                 -- Referenzmenge, z. B. 10 (Portionen)
    portion_grams TEXT,                    -- für Modus "Gramm pro Person"
    default_buffer_pct TEXT,
    default_portion_factor TEXT,
    allergens TEXT,
    prep_notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    UNIQUE (recipe_id, version)
  );

  CREATE TABLE catering_recipe_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id INTEGER NOT NULL REFERENCES catering_recipe_versions(id),
    ingredient_id INTEGER NOT NULL REFERENCES catering_ingredients(id),
    qty TEXT NOT NULL,
    unit TEXT NOT NULL,
    loss_pct TEXT,
    note TEXT
  );

  -- Gespeicherte Entscheidungen für künftige Importe: Rentman-Position -> Rezeptur oder Ausschluss
  CREATE TABLE catering_item_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rentman_item_id TEXT,
    article_no TEXT,
    name_hint TEXT,
    action TEXT NOT NULL CHECK (action IN ('recipe','exclude')),
    recipe_id INTEGER REFERENCES catering_recipes(id),
    confirmed_by INTEGER,
    confirmed_at TEXT DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX idx_mappings_rentman ON catering_item_mappings(rentman_item_id) WHERE rentman_item_id IS NOT NULL;

  CREATE TABLE catering_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rentman_project_id TEXT UNIQUE,        -- NULL bei manuell angelegten Projekten
    number TEXT,
    name TEXT NOT NULL,
    customer TEXT,
    event_date TEXT,
    location TEXT,
    rentman_status TEXT,
    guests TEXT,
    guests_source TEXT,                    -- woher der Wert stammt (Rentman-Feld oder "manuell")
    calc_status TEXT NOT NULL DEFAULT 'offen',
    purchase_status TEXT NOT NULL DEFAULT 'offen',
    is_sample INTEGER NOT NULL DEFAULT 0,
    rentman_hash TEXT,
    synced_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE catering_project_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES catering_projects(id),
    rentman_row_id TEXT,
    rentman_item_id TEXT,
    article_no TEXT,
    name TEXT NOT NULL,
    quantity TEXT,
    unit TEXT,
    mapping_id INTEGER REFERENCES catering_item_mappings(id),
    calc_mode TEXT,
    calc_params TEXT,                      -- JSON
    local_modified INTEGER NOT NULL DEFAULT 0,
    rentman_snapshot TEXT                  -- JSON des Rentman-Stands, für den Vergleich beim Sync
  );

  -- Eingefrorene Kalkulation (Rezeptur-Versionen, Faktoren, Rentman-Werte, Rechenweg)
  CREATE TABLE catering_calculations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES catering_projects(id),
    status TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','freigegeben')),
    snapshot TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    approved_at TEXT
  );

  CREATE TABLE catering_shopping_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES catering_projects(id),
    calculation_id INTEGER REFERENCES catering_calculations(id),
    status TEXT NOT NULL DEFAULT 'erstellt',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE catering_shopping_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL REFERENCES catering_shopping_lists(id),
    ingredient_id INTEGER NOT NULL REFERENCES catering_ingredients(id),
    need_qty TEXT NOT NULL,
    need_unit TEXT NOT NULL,
    purchase_qty TEXT NOT NULL,
    purchase_unit TEXT NOT NULL,
    supplier_id INTEGER,
    goods_group TEXT,
    price TEXT,
    note TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    bought_qty TEXT,
    missing INTEGER NOT NULL DEFAULT 0,
    calc_path TEXT                         -- Rechenweg
  );

  CREATE TABLE rentman_cache (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );
  `,
];

const DEFAULT_CATEGORIES = ['Fingerfood', 'Vorspeisen', 'Hauptgerichte', 'Beilagen', 'Salate', 'Desserts',
  'Brotzeit', 'Frühstück', 'Buffetkomponenten', 'Sonstige'];

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS catering_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = db.prepare("SELECT value FROM catering_meta WHERE key = 'schema_version'").get();
  let version = row ? Number(row.value) : 0;
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    db.transaction(() => {
      db.exec(sql);
      version += 1;
      db.prepare("INSERT OR REPLACE INTO catering_meta (key, value) VALUES ('schema_version', ?)").run(String(version));
      if (version === 1) {
        const ins = db.prepare('INSERT OR IGNORE INTO catering_categories (name, sort) VALUES (?, ?)');
        DEFAULT_CATEGORIES.forEach((n, i) => ins.run(n, i));
      }
    })();
  }
  return version;
}

module.exports = { migrate, MIGRATIONS };
