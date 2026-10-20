# Catering-Kalkulator: Bestandsaufnahme und Umsetzungsvorschlag

Stand: 2026-10-19. Es wurde noch kein Code geändert. Alle Aussagen unten stammen aus dem Repository.

## 1. Bestehende Architektur

| Bereich | Befund | Fundstelle |
|---|---|---|
| Backend | Node.js (>= 18), Express 4, eine Datei `server.js` (ca. 500 Zeilen), CommonJS | `server.js`, `package.json` |
| Datenbank | SQLite über `better-sqlite3`, Datei `db/onboarding.db`. Tabellen werden per `CREATE TABLE IF NOT EXISTS` in `server.js` angelegt und zusätzlich in `seed.js` dupliziert. Es gibt kein Migrationssystem. | `server.js:22`, `seed.js` |
| Sessions | `express-session` mit SQLite-Store, Cookie 7 Tage, Secret aus `SESSION_SECRET` oder DB | `server.js:196` |
| CSRF | Origin/Referer-Prüfung für alle ändernden Requests | `server.js:183` |
| Login | `bcryptjs`, Rate-Limit pro IP (5 Fehlversuche, 15 min Sperre) | `server.js:329` |
| Rollen | `users.role` kennt nur `admin` und `employee`. Prüfung über `requireAuth` und `requireAdmin` (`req.session.role`). Es gibt keine Modulrechte. | `server.js:239-246` |
| Frontend | Reines HTML, CSS und Vanilla-JS, kein Framework, kein Build-Schritt. Seiten: `login.html`, `admin.html`, `employee.html`. Eine gemeinsame `style.css` mit CSS-Variablen (schwarz/weiß, Touch-Ziele 48 px). PWA mit `sw.js` und `manifest.json`. | `public/` |
| Push | Web-Push (VAPID), Versand an Rolle `admin` oder `employee` | `server.js:118-155` |
| Tools | Kartengenerator als **eigener Python-Dienst** (`tools/cocktailkarte`, eigenes Dockerfile), im Portal nur per Reverse Proxy unter `/karten` und nur für Admins erreichbar. Gemeinsames Token `KARTEN_TOKEN`. | `server.js:248-302` |
| Tests, Lint | Keine vorhanden | |
| Deployment | Railway (Hinweise im Code), Konfiguration über Umgebungsvariablen | `server.js` |

### Konsequenzen für die Rollen
`role` wird an mehreren Stellen hart auf `'admin'` bzw. `'employee'` geprüft (Push-Versand, Mitarbeiterliste, Anlegen von Mitarbeitern). Neue globale Rollen wie "kueche" oder "einkauf" würden diese Stellen still brechen. Deshalb: **Modulberechtigungen in einer eigenen Tabelle**, die globale Rolle bleibt unverändert.

## 2. Bestehende Rentman-Anbindung

Es gibt **keine** Rentman-Integration im Node-Portal. Es gibt aber eine ausgereifte im Kartengenerator (`tools/cocktailkarte/cocktailkarte.py`):

- Token aus Umgebungsvariable `RENTMAN_API`, Aufruf `https://api.rentman.net` mit `Authorization: Bearer`.
- Paginierung (`limit=300`, `offset`), Wiederholung bei HTTP 429, Timeouts.
- Verwendete Ressourcen: `/projects` (Felder `id, number, name, planperiod_start`), `/subprojects` (Felder `id, project, status`), `/statuses`, `/projects/{id}/projectequipment`, `/projects/{id}/projectequipmentgroup`.
- Der **Projektstatus hängt am Unterprojekt**, nicht am Projekt. Bestätigt sind die Status-IDs 3 bis 6.
- Projektequipment hat u. a. `id, name, quantity, parent, equipment_group, external_remark`. Speisen hängen als Kinder unter Blöcken (`parent`) in einer Materialgruppe, deren Name mit "Catering" beginnt.
- Projektliste wird 10 Minuten gecacht (Speicher plus Datei).
- Die API ist dort als Version 1.16.0 vermerkt und kann keine Dateien hochladen.

### Befunde aus der Live-Diagnose (Beispielprojekt vom 2026-10-20, Token funktioniert)

Abgerufen wurde ein bestätigtes Catering-Projekt (56 Materialzeilen, Gruppen "Auftragspauschale" und "Catering").

1. **Gästezahl:** Am Projekt gibt es kein Gästefeld. Die Personenzahl steht als **Menge der Blockzeile** (z. B. "Brotzeit Spezialitäten", Menge 50, Bemerkung "Pauschale pro Person"). Es gab zwei Blöcke mit je 50. Die Werte dürfen **nicht addiert** werden (das wären nicht 100 Gäste). Das Custom Field `custom_8` am Projekt war leer, seine Bedeutung ist nicht abrufbar.
2. **Gericht-Zeilen haben Menge 0.** Die einzelnen Speisen hängen als Kinder unter dem Block und tragen keine Portionszahl. Die Aufteilung auf die Speisen ("Mischkalkulation", "2-3 Gläser pro Person") steht nur im Freitext der Bemerkung. Die Portionen je Speise müssen also im Kalkulator festgelegt werden (Modi C/D mit Anteilen), sie lassen sich nicht aus Rentman übernehmen.
3. **Die Rentman-Artikel-ID identifiziert die Speise nicht eindeutig.** Die Speisen sind virtuelle Pakete mit Artikelnummern (z. B. 988 bis 990), aber mehrere unterschiedlich benannte Speisen im Projekt verweisen auf dieselbe Artikel-ID (die Zeilennamen wurden im Projekt überschrieben). Verlässlich ist daher nur die Kombination aus Artikel-ID und Zeilenname, bestätigt durch den Benutzer. Die Zuordnung rein über die Artikel-ID wäre hier falsch.
4. **Darunter hängen Bestandteile** (Brot, Aufstriche, Tomaten, Kräuter) als physische Artikel mit Menge 0 und eigener, eindeutiger Artikel-ID. Sie zeigen, welche Komponenten zu einer Speise gehören.
5. **Verknüpfungen** (Kunde, Ort, Ansprechpartner) sind als `/contacts/<id>` abrufbar. Custom-Field-Definitionen liefern mit diesem Token HTTP 403.
6. Nicht-Essen-Zeilen (Mülleimer, Servietten) stehen in der Gruppe "Auftragspauschale" und werden ausgeschlossen.

## 3. Architekturentscheidung (Empfehlung)

**Eigenes Node-Modul im Portal**, nicht als zweiter Python-Dienst.

Gründe: Login, Sessions, CSRF, Rollen und SQLite sind schon da. Eine zweite Benutzerverwaltung wird ausgeschlossen. Die Kalkulation braucht Transaktionen und Verknüpfungen (Rezeptur, Zutat, Snapshot, Einkaufsliste), das passt zu SQLite. Der Python-Dienst bleibt unverändert.

Der Rentman-Client wird in Node neu geschrieben (nach dem Vorbild des Python-Clients: Paginierung, 429-Retry, Cache). Der Python-Client bleibt unangetastet.

Vorgeschlagene Struktur (neue Dateien, `server.js` bekommt nur eine Einbindungszeile):

```
modules/catering/
  index.js          Router, mountet unter /api/catering
  schema.js         Tabellen (idempotent, mit Schema-Version)
  permissions.js    Modulrechte + Middleware
  rentman.js        Lese-Client, Cache, Sync
  units.js          Einheiten und Umrechnung
  calc.js           Kalkulationsmodi, Puffer, Verlust, Rundung
  shopping.js       Einkaufsliste
  export.js         PDF und Excel
public/catering/    Frontend (HTML/JS/CSS im Stil des Portals)
test/               Unit-Tests für units.js und calc.js (node:test)
```

### Berechtigungen (Entscheidung vom 2026-10-19)
Das Modul ist wie der Kartengenerator **nur für angemeldete Portal-Admins** zugänglich. Seite (`/catering/`) und API (`/api/catering/*`) prüfen serverseitig die Admin-Rolle, ohne Login erfolgt eine Weiterleitung bzw. 403. Eigene Stufen für Küche und Einkauf sowie die Preis-Filterung entfallen vorerst. Sollten sie später nötig werden, kommen sie als Modulberechtigungen (Tabelle), nicht als neue globale Rollen.

### Rechnen
- Dezimalarithmetik: `decimal.js` als neue Abhängigkeit (Mengen und Geld nie als Float).
- Rechenkette strikt getrennt: Bedarf je Speise (Modus A bis F) → Sicherheitspuffer → Zubereitungsverlust (Menge / (1 - Verlust)) → Summe je Zutaten-ID → Gebinderundung (nur für die Einkaufsliste, fließt nie zurück).
- Einheiten: g/kg, ml/l fest; Stück und Packung nur mit hinterlegter Regel; Gewicht und Volumen nur mit expliziter Dichte je Zutat.
- Freigegebene Kalkulationen speichern einen **Snapshot** (Rezeptur-Version, Zutaten, Faktoren, Rentman-Werte). Spätere Rezepturänderungen verändern ihn nicht.
- Rechenweg wird je Position als Text/JSON gespeichert und auf Wunsch angezeigt.

### Sync
Rentman-Daten landen in lokalen Tabellen (`rentman_project_cache`, `rentman_item_cache`) mit Hash und Zeitstempel. Beim erneuten Abgleich wird verglichen: Änderungen an Projekten mit manuellen Anpassungen oder abgeschlossener Einkaufsliste werden **nicht angewendet**, sondern als Konflikt mit Gegenüberstellung angezeigt. Rentman wird nur gelesen (nur GET-Aufrufe im Client, per Test abgesichert).

### Ohne Token
Fehlt `RENTMAN_API`, zeigt das Modul einen deutlichen Hinweis und nutzt ausschließlich ausdrücklich als **Beispieldaten** gekennzeichnete Projekte, abschaltbar.

## 4. Umsetzung in Schritten

1. Schema, Modulrechte, leere Startseite (Navigation im Portal, Rechteprüfung testbar)
2. Einheiten und Rechenkern mit Unit-Tests (ohne UI)
3. Zutaten und Rezepturen (Editor, Versionen, Duplizieren, Archiv)
4. Rentman-Client, Diagnose-Endpunkt, Projektübersicht mit Cache
5. Mapping Rentman-Position zu Rezeptur (Vorschläge, Bestätigung, Ausschluss)
6. Kalkulation je Projekt (Modi A bis F, Rechenweg, Snapshots)
7. Einkaufsliste (Gebinde, Gruppierung, Abhaken, Ist-Mengen, Status)
8. Konfliktanzeige beim Sync, Exporte (PDF, Excel)

## 5. Offene Punkte (Entscheidung bzw. Zuarbeit nötig)

1. **Der Projektauftrag bricht in Abschnitt 10 ab** (nach "Backwaren"). Es fehlen mindestens Rest der Einkaufsliste, Exporte, UI-Details und eventuell Abnahmekriterien. Bitte den Rest nachreichen.
2. ~~Zustimmung zur Architektur~~ erledigt: Node-Modul im Portal, nur Admins.
3. Neue Abhängigkeiten: `decimal.js` (vorhanden), für PDF später `pdfkit`. Kein Excel/CSV, kein `exceljs`.
4. Zugriff auf die Rentman-Felder: Wer kann mir einen Auszug (JSON) eines echten Catering-Projekts über den Diagnose-Endpunkt oder aus der Rentman-API-Doku bereitstellen?
5. ~~Stufen für Küche und Einkauf~~ entfallen (nur Admins). Wie kommt die Einkaufsliste später zum Einkäufer, wenn dieser keinen Admin-Zugang hat (PDF, Excel)?

## 6. Entscheidungen des Auftraggebers

- Das Modul ist nur für Portal-Admins zugänglich (wie `/karten`).
- **Kein CSV/XLSX-Import oder -Export.** Rezepturen und Zutaten werden im Editor gepflegt. Export ausschließlich als **PDF** (Einkaufsliste, Phase 4, vorgesehen mit `pdfkit`).

## 7. Stand der Umsetzung

**Phase 1 (fertig):** Schema mit Versionierung, Einheiten und Rechenkern, lesender Rentman-Client mit Diagnose, Startseite, Einbindung ins Portal.

**Phase 2 (fertig, ohne Import):**
- Zutatenverwaltung: Warengruppe, Basis- und Einkaufseinheit, Gebinde, Lieferant, Preis, Verlust, Dichte, Umrechnung Stück/Packung. Keine Duplikate (Name, ohne Groß-/Kleinschreibung), Archivierung statt Löschen.
- Lieferanten (Name, Kontakt, Bemerkung). Gebindegrößen je Lieferant sind als Tabelle vorbereitet (Phase 5).
- Rezepturen mit unveränderlichen Versionen: jede Änderung erzeugt eine neue Version, ältere bleiben les- und reproduzierbar. Duplizieren (ohne Rentman-Zuordnung), Archivieren, eindeutige Zuordnung über Rentman-Artikel-ID bzw. Artikelnummer.
- Paralleles Bearbeiten: Zutaten und Lieferanten über Versionszähler `rev`, Rezepturen über `baseVersion`. Veraltete Stände werden mit 409 abgelehnt, nichts wird unbemerkt überschrieben.
- Serverseitige Prüfung aller Eingaben, nicht umrechenbare Einheiten werden mit verständlicher Meldung abgelehnt.
- Änderungsprotokoll (`catering_audit_log`) mit Benutzer und Zeitpunkt.
- Tests: `npm test` (28 Tests: Rechenkern, API, Berechtigungen, Versionierung, Konflikte, Beispiel aus dem Auftrag 11 / 13,75 / 15 kg). Zusätzlich manuell im Browser (mobil) durchgespielt.

**Noch offen:** Phase 3 (Rentman-Projektimport, Artikelzuordnung, Kalkulation, Snapshots), Phase 4 (Einkaufsliste, PDF), Phase 5 (Lieferantengebinde, Wareneinsatz, Sammelbestellung), Einstellungsseite, Foto-Upload der Rezeptur (Feld vorhanden, Upload fehlt).

**Bekannte Einschränkungen:** Der Rentman-Zugang ist ungetestet gegen echte Daten (Token fehlt). Die Felder für Gästezahl, Kunde und Ort sind unbestätigt (siehe Abschnitt 2).
