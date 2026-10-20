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
  // 2: Phase 2 (Zutaten, Lieferanten, Rezepturen): Audit-Log, Warengruppen, Gebinde, Versionszähler
  `
  ALTER TABLE catering_ingredients ADD COLUMN rev INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE catering_ingredients ADD COLUMN updated_at TEXT;
  ALTER TABLE catering_ingredients ADD COLUMN updated_by INTEGER;
  ALTER TABLE catering_suppliers ADD COLUMN contact TEXT;
  ALTER TABLE catering_suppliers ADD COLUMN rev INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE catering_suppliers ADD COLUMN updated_at TEXT;

  -- keine zwei aktiven Zutaten mit gleichem Namen, keine zwei aktiven Rezepturen mit gleicher Zuordnung
  CREATE UNIQUE INDEX uq_ingredients_name ON catering_ingredients(lower(name)) WHERE archived = 0;
  CREATE UNIQUE INDEX uq_recipes_rentman ON catering_recipes(rentman_item_id) WHERE archived = 0 AND rentman_item_id IS NOT NULL;
  CREATE UNIQUE INDEX uq_recipes_article ON catering_recipes(article_no) WHERE archived = 0 AND article_no IS NOT NULL;

  CREATE TABLE catering_goods_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort INTEGER NOT NULL DEFAULT 0
  );

  -- Gebindegrößen und Preise je Lieferant und Zutat (Phase 5 nutzt sie für die Auswahl)
  CREATE TABLE catering_supplier_packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES catering_suppliers(id),
    ingredient_id INTEGER NOT NULL REFERENCES catering_ingredients(id),
    pack_size TEXT NOT NULL,
    unit TEXT NOT NULL,
    price TEXT,
    article_no TEXT,
    archived INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE catering_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    user_id INTEGER,
    user_name TEXT,
    entity TEXT NOT NULL,
    entity_id TEXT,
    action TEXT NOT NULL,
    detail TEXT
  );
  CREATE INDEX idx_audit_entity ON catering_audit_log(entity, entity_id);
  `,
  // 3: Schlanker Bestellrechner (Speisen im Glas): Speisenkatalog, Garnitur, bestätigte Rentman-Namen, Bestellungen
  `
  CREATE TABLE catering_dishes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'weckglas',
    supplier_id INTEGER REFERENCES catering_suppliers(id),
    fill_grams TEXT,                       -- Füllmenge pro Glas in Gramm
    step_grams TEXT,                       -- Gebinde bzw. Bestellschritt in Gramm (NULL = nicht runden)
    note TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  );
  CREATE UNIQUE INDEX uq_dishes_name ON catering_dishes(lower(name)) WHERE archived = 0;

  -- Bestätigte Zuordnung: dieser (normalisierte) Rentman-Name gehört zu dieser Speise
  CREATE TABLE catering_dish_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dish_id INTEGER NOT NULL REFERENCES catering_dishes(id),
    alias TEXT NOT NULL UNIQUE,
    confirmed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE catering_dish_garnish (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dish_id INTEGER NOT NULL REFERENCES catering_dishes(id),
    name TEXT NOT NULL,
    qty_per_glass TEXT,                    -- NULL = Menge noch offen (wird nicht als 0 gerechnet)
    unit TEXT NOT NULL DEFAULT 'stk',
    pack_size TEXT,                        -- Gebinde in der Einheit der Zeile, NULL = nicht runden
    supplier_id INTEGER REFERENCES catering_suppliers(id),
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE catering_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rentman_project_id TEXT,
    number TEXT,
    name TEXT NOT NULL,
    event_date TEXT,
    guests TEXT,
    guests_source TEXT,                    -- woher die Gästezahl stammt
    glasses_per_person TEXT,
    status TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','abgeschlossen')),
    snapshot TEXT,                         -- eingefrorenes Ergebnis beim Abschließen
    rev INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    created_by INTEGER,
    updated_at TEXT
  );
  CREATE UNIQUE INDEX uq_orders_open_project ON catering_orders(rentman_project_id) WHERE status = 'entwurf' AND rentman_project_id IS NOT NULL;

  CREATE TABLE catering_order_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES catering_orders(id) ON DELETE CASCADE,
    dish_id INTEGER REFERENCES catering_dishes(id),
    rentman_row_id TEXT,
    rentman_name TEXT,
    block_name TEXT,
    glasses TEXT,
    sort INTEGER NOT NULL DEFAULT 0
  );
  `,
  // 4: Artikelnummer der Speise beim Lieferanten (für die Bestellung)
  `
  ALTER TABLE catering_dishes ADD COLUMN article_no TEXT;
  `,
  // 5: Manuelle Gesamtmenge einer Garnitur je Bestellung
  `
  CREATE TABLE catering_order_garnish_overrides (
    order_id INTEGER NOT NULL REFERENCES catering_orders(id) ON DELETE CASCADE,
    key TEXT NOT NULL,                     -- Name und Einheit der Garnitur, normalisiert
    name TEXT NOT NULL,
    qty TEXT NOT NULL,
    unit TEXT NOT NULL,
    note TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (order_id, key)
  );
  `,
];

const DEFAULT_GOODS_GROUPS = ['Obst und Gemüse', 'Fleisch', 'Fisch', 'Milchprodukte', 'Backwaren', 'Trockenwaren',
  'Tiefkühlprodukte', 'Sonstiges'];
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
      if (version === 2) {
        const ins = db.prepare('INSERT OR IGNORE INTO catering_goods_groups (name, sort) VALUES (?, ?)');
        DEFAULT_GOODS_GROUPS.forEach((n, i) => ins.run(n, i));
      }
    })();
  }
  return version;
}

module.exports = { migrate, MIGRATIONS };
