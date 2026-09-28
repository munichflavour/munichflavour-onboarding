# Munich Flavour Mitarbeiterportal

Mitarbeiterportal für Munich Flavour – zum Austausch von Dokumenten und Infos (Rezepte, Anleitungen, Geräte, Hygiene). Mobil-optimiert, installierbar als PWA.

Frühere Version war eine Onboarding-App mit Checklisten und Unterschriften. Diese Funktion wurde entfernt; das Portal dient jetzt ausschließlich dem Dokumenten- und Infoaustausch. Inhaltliche Ausrichtung siehe [`docs/portal-inhalte.md`](docs/portal-inhalte.md).

## Voraussetzungen

- Node.js (v18 oder neuer)
- npm

## Installation

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Logo platzieren
# Lege die Datei logo.jpg in den Ordner ./assets/
cp /pfad/zu/deinem/logo.jpg ./assets/logo.jpg

# 3. Datenbank initialisieren (Admin-Account + Standardordner)
node seed.js

# 4. Server starten
node server.js
```

Der Server läuft danach auf **http://localhost:3000**

## Zugangsdaten (nach Seed)

| Rolle | Benutzername | Passwort |
|--------|-------------|-----------|
| Admin | admin | admin123 |

**Wichtig:** Passwort nach der Ersteinrichtung ändern.

## Umgebungsvariablen (optional)

| Variable | Zweck |
|----------|-------|
| `SESSION_SECRET` | Secret für Session-Cookies. Wird bei Produktiveinsatz empfohlen; ohne gesetzte Variable erzeugt der Server beim ersten Start automatisch ein zufälliges Secret und speichert es in der Datenbank. |
| `COOKIE_SECURE=true` | Nur setzen, wenn die App wirklich ausschließlich über **HTTPS** erreichbar ist (z.B. hinter einem Reverse Proxy mit TLS). Läuft die App per HTTP im lokalen Netz (Standardfall laut Installationsanleitung oben), **nicht** setzen – sonst funktioniert der Login nicht, weil der Browser das Session-Cookie verwirft. |
| `TRUST_PROXY=1` | Setzen, wenn die App hinter einem Reverse Proxy (nginx, Heroku, Render, …) mit HTTPS-Terminierung läuft – sonst erkennt Express HTTPS-Anfragen nicht korrekt. |

## Funktionen

### Mitarbeiter
- Login
- Dokumente durchsuchen (Ordnerstruktur) und per Volltextsuche finden
- Dokumente ansehen oder herunterladen
- Push-Benachrichtigung bei neuen Dokumenten (als installierte PWA)

### Admin
- Ordnerstruktur anlegen, umbenennen, löschen (inkl. Unterordner)
- Dokumente hochladen (Klick oder Drag & Drop) mit Beschreibung, löschen
- Mitarbeiter anlegen, bearbeiten (Name/Passwort), löschen

## App auf iPhone installieren (iOS)

1. Safari öffnen und `http://[deine-IP]:3000` aufrufen
2. Teilen-Symbol antippen (Quadrat mit Pfeil nach oben)
3. „Zum Home-Bildschirm" wählen
4. „Hinzufügen" tippen

## App auf Android installieren

1. Chrome öffnen und die App-URL aufrufen
2. Banner „App installieren" antippen **oder**
3. Menü (drei Punkte) → „App installieren" / „Zum Startbildschirm hinzufügen"

## Port ändern

```bash
PORT=8080 node server.js
```

## Projektstruktur

```
├── server.js              # Express-Server & API-Routen
├── seed.js                # Datenbank-Seed (Admin-Account + Standardordner)
├── package.json
├── assets/
│   └── logo.jpg           # ← hier Logo ablegen
├── db/                    # SQLite-Datenbanken (automatisch erstellt)
├── docs/
│   └── portal-inhalte.md  # Redaktionsplan für Dokumenteninhalte
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
