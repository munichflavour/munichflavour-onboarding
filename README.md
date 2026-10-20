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

## Kartengenerator im Portal (nur Admins)

Der Kartengenerator (`tools/cocktailkarte`, Python) laeuft als **eigener Dienst** und ist ins Portal eingebunden: Im
Admin-Bereich oeffnet der Reiter **Programme** und dort die Karte **Kartengenerator** die Seite `/karten/`. Das Portal prueft den Admin-Login und reicht die Anfrage
an den Kartengenerator weiter (Reverse Proxy, `server.js`). Mitarbeiter und nicht Angemeldete werden abgewiesen. Der
Kartengenerator selbst akzeptiert im Webbetrieb nur Anfragen mit dem gemeinsamen Token (`KARTEN_TOKEN`) und hat keine
oeffentliche Adresse. Karten werden als PDF heruntergeladen (kein Ordnerdialog im Webbetrieb).
Im Portal erscheint die Seite im Portal-Design (schwarze Kopfleiste mit Logo, Link **← Programme**, immer hell). Das wird am
Pfad `/karten/` erkannt; im lokalen Betrieb (Mac/Windows) bleibt die Oberflaeche unveraendert.

**Einrichtung auf Railway** (das Portal bleibt unveraendert, nur Variablen kommen dazu):
1. Im Railway-Projekt **New > GitHub Repo** (dasselbe Repo, Branch `main`) = zweiter Dienst, Name z. B. `karten`.
2. Im neuen Dienst unter **Settings > Source > Add Root Directory**: `/tools/cocktailkarte` (dort liegt ein `Dockerfile`).
3. Im Dienst `karten` unter **Variables**: `RENTMAN_API` (Rentman-Token, am besten eigener Benutzer mit minimalen Rechten)
   und `KARTEN_TOKEN` (lange zufaellige Zeichenfolge).
4. Im Dienst `karten` ein **Volume** mit Mount Path `/data` anlegen (Stammliste, Schriften, Cache bleiben erhalten).
   Keine oeffentliche Domain erzeugen (**Generate Domain** nicht klicken).
5. Im **Portal-Dienst** unter **Variables**: `KARTEN_URL` = `http://karten.railway.internal:8765`
   (Name des Dienstes + `.railway.internal`) und `KARTEN_TOKEN` mit demselben Wert wie bei `karten`.
6. Danach im Portal **Karten** oeffnen, unten die Schriften Active und Agrandir hochladen und eine Karte testen.

Ohne `KARTEN_URL` zeigt `/karten/` nur den Hinweis "nicht eingerichtet"; das Portal laeuft normal weiter.
Lokal zum Testen: `KARTEN_LOKAL=1 node server.js` startet den Generator als Kindprozess (Python + PyMuPDF noetig).

## Catering-Kalkulator im Portal (nur Admins)

Der Catering-Kalkulator rechnet aus Gästezahl und Speisen eines Rentman-Projekts die Bestellmengen fuer Speisen im Glas und
erzeugt eine **Einkaufsliste** als PDF, nach Lieferanten aufgeteilt (ein Lieferant je Seite). Im Admin-Bereich oeffnet der Reiter **Programme** und dort die Karte **Catering-Kalkulator** die
Seite `/catering/`. Wie beim Kartengenerator prueft das Portal den Admin-Login (Seite und API serverseitig); Mitarbeiter und nicht
Angemeldete werden abgewiesen. Bedienung: [`docs/catering-kalkulator-anleitung.md`](docs/catering-kalkulator-anleitung.md),
Architektur und Entscheidungen: [`docs/catering-kalkulator-bestandsaufnahme.md`](docs/catering-kalkulator-bestandsaufnahme.md).

**Passwortschutz (solange der Kalkulator in Entwicklung ist):** Wer als Admin angemeldet ist, sieht beim Oeffnen des Kalkulators
zuerst eine Passwortabfrage. Ohne Passwort sind Seite, Dateien und API gesperrt (HTTP 423). Das Entsperren gilt fuer die Sitzung
(nach Abmelden wieder gesperrt; im Kalkulator sperrt der Knopf 🔒 sofort). Nach 5 Fehlversuchen gibt es eine Pause von 15 Minuten.
- **Eigenes Passwort (empfohlen):** Im Portal-Dienst die Variable `CATERING_PASSWORT` setzen. Dann steht das Passwort nicht im Repository.
- Ohne diese Variable gilt ein eingebautes Standardpasswort. Im Code steht davon nur der Hash (`modules/catering/lock.js`), das Passwort selbst wurde dem Auftraggeber direkt mitgeteilt.
- **Abfrage abschalten** (wenn der Kalkulator fertig ist): Im Portal-Dienst die Variable `CATERING_OHNE_PASSWORT` auf `1` setzen. Die Admin-Pflicht bleibt bestehen.
- Das ist ein zusaetzlicher Riegel, kein Ersatz fuer die Admin-Anmeldung. Der Schutz der Daten bleibt die Admin-Anmeldung.

**Unterschied zum Kartengenerator:** Der Kalkulator ist Node.js und laeuft **im Portal-Dienst selbst** (`modules/catering`). Es ist
kein zweiter Railway-Dienst und kein Proxy noetig. Seine Daten liegen in derselben SQLite-Datenbank wie das Portal
(`db/onboarding.db`), in eigenen Tabellen (`catering_*`, `rentman_cache`). Sie werden beim Start automatisch angelegt oder
erweitert (versionierte Migrationen); bestehende Tabellen und Daten werden nicht veraendert.

**Einrichtung auf Railway:**
1. **Datensicherung und Speicher pruefen:** Die Datenbank `db/` muss im Portal-Dienst auf einem **Volume** liegen (sonst gehen
   Portal- und Kalkulator-Daten bei jedem Deploy verloren). Vor dem ersten Deploy `db/onboarding.db` sichern.
2. Im **Portal-Dienst** unter **Variables**: `RENTMAN_API` = Rentman-Token (am besten ein eigener Rentman-Benutzer mit nur Leserechten;
   der Kalkulator liest ausschliesslich und aendert nichts in Rentman). Es ist derselbe Token wie beim Kartengenerator, aber die
   Variable muss im Portal-Dienst **zusaetzlich** gesetzt werden, die Dienste teilen keine Variablen.
3. Branch nach `main` bringen (Pull Request). Railway installiert die neuen Pakete (`decimal.js`, `pdfkit`) beim Deploy selbst.
4. Im Portal **Kalkulator > Speisen > Salate (Kugler) anlegen** (einmalig), Werte pruefen, dann eine Testbestellung anlegen.

Ohne `RENTMAN_API` laeuft der Kalkulator weiter, zeigt aber nur einen Hinweis und manuell angelegte Bestellungen. Optional kann
`assets/logo-pdf.jpg` (kleines Logo) abgelegt werden, damit die PDFs klein bleiben; sonst wird `assets/logo.jpg` verwendet.

**Tests:** `npm test` (Rechenlogik, Rechte, Versionierung, Konflikte, PDF). Ausnahme: Der Abgleich mit echten Rentman-Daten ist
nicht automatisiert, er wurde manuell geprueft.

## Funktionen

### Mitarbeiter
- Login
- Dokumente durchsuchen (Ordnerstruktur) und per Volltextsuche finden
- Dokumente direkt ansehen (Klick auf die Zeile öffnet das Dokument)
- Eigenen Überstunden-Stand einsehen (sofern vom Admin gepflegt)
- Push-Benachrichtigung bei neuen Dokumenten und bei Aktualisierung des Überstunden-Stands (als installierte PWA)

### Admin
- Ordnerstruktur anlegen, umbenennen, löschen (inkl. Unterordner)
- Dokumente hochladen (Klick oder Drag & Drop) mit Beschreibung, löschen
- Mitarbeiter anlegen, bearbeiten (Name/Passwort), löschen
- Überstunden-Stand je Mitarbeiter pflegen (einfacher Saldo, kein Buchungsverlauf – wie bisher in Excel)

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
