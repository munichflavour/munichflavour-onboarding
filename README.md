# Munich Flavour Onboarding

Mitarbeiter-Onboarding-App für Munich Flavour – mobil-optimiert, installierbar als PWA.

## Voraussetzungen

- Node.js (v18 oder neuer)
- npm

## Installation

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Logo platzieren
# Lege die Datei logo.jpg in den Ordner ./assets/
# Beispiel:
cp /pfad/zu/deinem/logo.jpg ./assets/logo.jpg

# 3. Datenbank initialisieren & Beispieldaten einspielen
node seed.js

# 4. Server starten
node server.js
```

Der Server läuft danach auf **http://localhost:3000**

## Zugangsdaten (nach Seed)

| Rolle  | Benutzername | Passwort  |
|--------|-------------|-----------|
| Admin  | admin       | admin123  |

## Funktionen

### Mitarbeiter
- Login & persönliche Onboarding-Checkliste
- Aufgaben mit Gegenzeichnung (Name + Unterschrift des Vorgesetzten) abhaken
- PDF-Report herunterladen (erst nach 100% Abschluss)

### Admin
- Dashboard mit Fortschrittsübersicht aller Mitarbeiter
- Detailansicht mit Unterschriften-Vorschau
- Neue Mitarbeiter anlegen
- Checklisten-Aufgaben hinzufügen, bearbeiten, sortieren, löschen

## App auf iPhone installieren (iOS)

1. Safari öffnen und `http://[deine-IP]:3000` aufrufen
2. Teilen-Symbol antippen (Quadrat mit Pfeil nach oben)
3. **„Zum Home-Bildschirm"** wählen
4. „Hinzufügen" tippen

## App auf Android installieren

1. Chrome öffnen und die App-URL aufrufen
2. Banner „App installieren" antippen **oder**
3. Menü (drei Punkte) → **„App installieren"** / **„Zum Startbildschirm hinzufügen"**

## Port ändern

```bash
PORT=8080 node server.js
```

## Projektstruktur

```
├── server.js          # Express-Server & API-Routen
├── seed.js            # Datenbank-Seed (Admin + Beispielaufgaben)
├── package.json
├── assets/
│   └── logo.jpg       # ← hier Logo ablegen
├── db/                # SQLite-Datenbanken (automatisch erstellt)
└── public/
    ├── login.html
    ├── employee.html
    ├── admin.html
    ├── manifest.json
    ├── sw.js
    ├── css/style.css
    └── js/
        ├── login.js
        ├── employee.js
        └── admin.js
```
