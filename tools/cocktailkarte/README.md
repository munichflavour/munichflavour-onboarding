# Kartengenerator (Rentman -> PDF)

**Download-Pakete** (bei GitHub angemeldet sein; fertige Pakete im Ordner `downloads/` des Repositorys):
Mac: `downloads/Kartengenerator-Mac.zip`, Windows: `downloads/Kartengenerator-Windows.zip`.
Nach dem Entpacken liegen `installieren.command` (Mac) bzw. `installieren.bat` (Windows) direkt im entpackten Ordner.
Neu bauen nach Aenderungen am Programm: `python3 tools/cocktailkarte/zip_bauen.py`.

## Oberflaeche auf Windows (z. B. Mitarbeiter-PC im Lager)

Voraussetzung: Windows 10/11 (Surface mit Intel/AMD oder ARM) und beim ersten Start eine Internetverbindung.
**Python muss nicht vorher installiert sein**: Fehlt es, installiert der Starter es automatisch ueber `winget`.

**Installieren (auch fuer Updates):**
1. ZIP des Branches von GitHub laden. **Rechtsklick auf die ZIP-Datei > Eigenschaften > unten "Zulassen" anhaken > OK**
   (hebt die Windows-Sperre fuer Dateien aus dem Internet auf), dann **Alle extrahieren**.
2. Optional die Datei `active-regular.otf` (Pinselschrift) neben `installieren.bat` legen (im entpackten Ordner).
3. `installieren.bat` doppelklicken. Der Installer kopiert das Programm nach
   `C:\Users\<Name>\Kartengenerator` und legt auf dem Desktop die Verknuepfung **Kartengenerator** an.
   Eigene Daten (Token, Stammliste, Schrift, Einstellungen) bleiben bei Updates erhalten.
4. Beim ersten Start (der Installer bietet ihn an) wird Python bei Bedarf installiert, die Programmumgebung
   eingerichtet (1 bis 2 Minuten), der **Rentman API-Token** abgefragt und gefragt, ob Mitarbeitende Karten **bearbeiten**
   duerfen. Auf einem Mitarbeiter-PC mit **N** antworten (siehe Mitarbeiter-Modus).

**Benutzen:** Verknuepfung **Kartengenerator** doppelklicken. Der Browser oeffnet sich; das minimierte schwarze Fenster in
der Taskleiste gehoert zum Programm und muss offen bleiben (Fenster schliessen = Programm beenden). Bedienung wie
unten beschrieben. "PDF speichern" oeffnet den Windows-Dialog zur Ordnerwahl, "PDF downloaden" speichert im
Download-Ordner des Browsers.

**Mitarbeiter-Modus:** In der Datei `C:\Users\<Name>\Kartengenerator\.env` die Zeile `BEARBEITEN=aus` setzen (oder
beim ersten Start mit N antworten). Dann gibt es keinen Knopf "Bearbeiten", und die Stammliste (Allergene!) kann
nicht geaendert werden. Karten erzeugen, speichern und downloaden geht weiterhin. Entfernen der Zeile gibt das Bearbeiten
wieder frei. (Die Sperre schuetzt vor Versehen, nicht vor gezielter Umgehung durch Fachleute.)

**Sicherheit auf einem gemeinsam genutzten PC:** Der Rentman-Token steht in der Datei `.env` im Benutzerordner und gibt
Zugriff auf Projekt- und Kundendaten. Besser einen **eigenen Rentman-Benutzer mit eingeschraenkten Rechten** und dessen
Token verwenden, nicht den Token der Geschaeftsfuehrung.

**Probleme?** Eine Eingabeaufforderung oeffnen (Windows-Taste, "cmd", Enter), die Datei `start.bat` aus dem Ordner
`C:\Users\<Name>\Kartengenerator` in das Fenster ziehen und Enter druecken: Dann bleibt die Fehlermeldung sichtbar und
kann weitergegeben werden. Notfalls Python selbst von python.org installieren (dabei den Haken "Add python.exe to PATH"
setzen) und den Starter noch einmal ausfuehren.

## Oberflaeche auf dem Mac

**Einmalig installieren** (auch fuer Updates):
1. ZIP des Branches von GitHub laden und entpacken.
2. Falls macOS blockiert: im Terminal `xattr -dr com.apple.quarantine ` tippen, den entpackten Ordner ins Fenster
   ziehen, Enter.
3. `installieren.command` doppelklicken. Das kopiert das Programm nach `~/Kartengenerator` und
   legt auf dem Schreibtisch den Starter **Kartengenerator** an. Token und Einstellungen bleiben bei Updates erhalten.

**Benutzen:** Starter **Kartengenerator** auf dem Schreibtisch doppelklicken. Beim ersten Start wird nach dem
Rentman API-Token gefragt (gespeichert in `~/Kartengenerator/.env`, nie im Repo). Im Browser Projektnamen eingeben und
"Karten laden" klicken. Fuer jede passende Rentman-Gruppe wird die Karte **automatisch angelegt** und mit Vorschau
angezeigt. Dabei wird noch **nichts gespeichert**.

- **PDF speichern:** oeffnet einen Dialog zur Ordnerwahl (startet im zuletzt gewaehlten Ordner) und legt die PDF dort ab.
  Existiert der Dateiname schon, wird " (2)" angehaengt, nichts wird ueberschrieben. **Alle PDFs speichern** fragt den
  Ordner nur einmal. (Der Dialog ist ein macOS-Dialog; auf anderen Systemen wird der Standardordner `KARTEN_ORDNER`
  bzw. `~/Kartengenerator/Karten` benutzt.)
- **PDF downloaden:** laedt die PDF direkt in den Download-Ordner deines Browsers.
- **Bearbeiten** (optional): Eintraege an- und abwaehlen, Reihenfolge aendern (Pfeile), Texte aendern, Eintraege
  hinzufuegen oder entfernen; bei Essen auch Beschreibung, Allergene (Buchstaben laut Legende) und vegetarisch/vegan.
  Die Vorschau aktualisiert sich live, **Bearbeiten beenden** schliesst den Editor.
- Mit dem Haken **merken** landet ein Eintrag in deiner eigenen Stammliste und gilt ab dann fuer alle Projekte
  (geaenderte Texte werden automatisch zum Merken vorgeschlagen; uebernommen wird beim Speichern oder Downloaden).
- Fehlende Karten lassen sich unter "Weitere Karte erstellen" anfordern.

**Eigene Stammliste:** Aenderungen aus der Oberflaeche stehen in `~/Kartengenerator/daten/getraenke.json` und
`speisen.json`. Sie haben Vorrang vor den mitgelieferten Listen in `stammdaten/` und werden bei Updates nie
ueberschrieben. Der Ordner laesst sich in `.env` mit `DATEN_ORDNER=...` aendern.

**Schneller Start:** Die Projektliste wird zwischengespeichert (`.cache/`) und im Hintergrund aktualisiert; die
Anzeige "Stand ..." mit dem Knopf **Aktualisieren** zeigt, wie aktuell sie ist. Der allererste Start dauert etwa 4 Sekunden.

Es werden nur **bestaetigte** Projekte angeboten (Rentman-Status Bestaetigt, Gepackt, Am Veranstaltungsort, Retour).
Bei Option, Anfrage, Konzept oder Annulliert meldet die Oberflaeche den Status, erzeugt aber keine Karte.

**Ablage:** Jede erzeugte Karte wird automatisch gespeichert, je Projekt in einem Unterordner
`<Datum> <Projektname> (<Nummer>)` unter `~/Kartengenerator/Karten`. Eine neu erzeugte Karte ersetzt die alte mit
gleichem Namen. Der Ordner laesst sich in `~/Kartengenerator/.env` aendern (z. B. auf einen Google-Drive-Ordner):

```
KARTEN_ORDNER=/Users/DEINNAME/Google Drive/Karten
```

Der Knopf **Im Finder zeigen** markiert die Datei im Finder. Von dort die PDF in Rentman im Projekt unter *Dateien*
hochladen. Die Rentman-API (Version 1.16.0) bietet keinen Datei-Upload, deshalb ist dieser Schritt von Hand.

Die Oberflaeche laeuft nur auf deinem Rechner (127.0.0.1:8765), beenden mit Ctrl+C im Terminalfenster.

## Kommandozeile

Erzeugt Getraenkekarten im Munich-Flavour-Layout aus dem Material eines Rentman-Projekts.

```bash
pip install pymupdf
export RENTMAN_API=<API-Token>            # nie ins Repo schreiben

python3 tools/cocktailkarte/cocktailkarte.py "Böttcher"                    # alle gebuchten Karten
python3 tools/cocktailkarte/cocktailkarte.py "Lammens" --karte smoothies   # nur Smoothie-Karte
```

Name oder Projektnummer, nur bestaetigte Projekte (`--auch-unbestaetigt` hebt das auf). Bei mehreren Treffern wird
das naechste anstehende Event genommen.

## Welche Karten entstehen? (gruppengesteuert)

Fuer **jede passende Rentman-Materialgruppe** eines Projekts entsteht eine Karte. Die senkrechte Beschriftung ist der
**Gruppenname aus Rentman** (Pinselschrift), z. B. "Drinks", "Hot Drinks", "Aperitif", "Smoothies".
Kuerzer steht nur `Cocktails & Longdrinks` und `Cocktails` -> COCKTAILS, wie auf den bisherigen Karten
(Liste `LABEL_NAMEN` in `cocktailkarte.py`). Zu lange Beschriftungen werden automatisch verkleinert.

| Gruppenname enthaelt | Karte | Texte |
|---|---|---|
| cocktail, longdrink, aperitif, drinks, smoothie, matcha, shake, shot, slush, limonade, heissgetraenk | Getraenkekarte. Mit alkoholfreien Drinks zwei Abteilungen (MOCKTAILS bei Cocktail-Gruppen, sonst ALKOHOLFREI) | `stammdaten/getraenke.json` + eigene Liste, sonst Rentman |
| kaffee, coffee | Kaffeekarte (Zusatzzeile = Bemerkung, z. B. Einfach/Doppelt). Fehlt die Gruppe, aber Kaffee-Equipment ist gebucht (Siebtraeger, Kaffeebar ...), gilt die Standardliste | `stammdaten/kaffee.json` |
| catering | Essenkarte (Bloecke: Canapes, Brotzeit Spezialitaeten, Speisen im Weckglas = Salate, Dessert im Weckglas) | `stammdaten/speisen.json` inkl. Allergene und vegetarisch/vegan |

Andere Gruppen (Auftragspauschale, Bars, Mietequipment, Getraenke mit Weinen/Bier ...) ergeben keine Karte.
Neue Gruppennamen erkennt man an den Mustern `GRUPPE_*` in `cocktailkarte.py`.

**Pinselschrift:** Fuer die vollstaendige Schrift "Active" (alle Buchstaben, Umlaute, &) die Datei `Active-Regular.otf`
neben `installieren.command` legen und den Installer ausfuehren. Er kopiert sie nach `~/Kartengenerator/daten/`.
Die Schrift ist urheberrechtlich geschuetzt und gehoert **nicht ins Repository** (`.gitignore` verhindert das). In
jede PDF wird nur ein Auszug mit den tatsaechlich verwendeten Zeichen eingebettet, nie die ganze Schrift. Ohne die
Datei reichen die Auszuege aus den Vorlagen; fehlt dann ein Buchstabe, steht die Beschriftung ersatzweise in
Montserrat Bold und die Oberflaeche zeigt einen Hinweis. Ohne das Paket `fonttools` wird die volle Schrift nicht benutzt.

**Allergene** stehen nicht in Rentman, sondern in `stammdaten/speisen.json`. Die Angaben stammen aus den bisherigen
Karten und sind nicht neu geprueft. Speisen ohne Eintrag werden ohne Allergene gesetzt und gemeldet.

## Aufbau

- `assets/<karte>/template.pdf` und `label.ttf`: Vorlage (Titel, Ananas, Logo, Footer, QR) und die Pinselschrift
  aus der jeweiligen fertigen Karte. Neu erzeugen mit `make_template.py <karte> <fertige_karte.pdf>`.
- `stammdaten/getraenke.json`: Kartentexte (Name, Zutaten, alkoholfrei). Drinks, die hier fehlen, werden mit dem
  Rentman-Text gesetzt und auf stderr gemeldet.
- Reihenfolge der Drinks = Reihenfolge in Rentman.

## Design Alt / Neu

Es gibt zwei Designs: das bisherige (Alt) und das neue (Neu, nachgebaut nach den Canva-Karten
COCKTAILS_Standard_NEU und KAFFEE_PRICEHUBBLE_NEU). In der Oberflaeche schaltet man oben zwischen Alt und Neu um.
Voreinstellung: `DESIGN=neu` oder `DESIGN=alt` in der `.env`. Per Kommandozeile: `--design neu`.
Dateien im neuen Design enden auf `_NEU.pdf`.

- Neu gibt es fuer alle Karten: Cocktails, Smoothies, Drinks, Hot Drinks, Matcha, Aperitif, Kaffee und Essen
  (Essen: zwei Spalten Salate/Brotzeit, Dessert zentriert darunter, Allergen-Legende fest in der Vorlage).
  Die Essenkarte im neuen Design zeigt keine (V)/(VG)-Hinweise, wie in der Vorlage ESSEN_NEU.
- Die Ueberschriftschrift Agrandir ist lizenzpflichtig. In `assets/neu/` liegen nur Auszuege (A-Z, Ä Ö Ü, a-z, Ziffern).
  Es fehlen Sonderzeichen wie & und É (z. B. CANAPÉS): dann steht die Ueberschrift in Montserrat Bold mit Hinweis.
  Mit der vollstaendigen Datei `Agrandir-Black.otf` (neben den Installer legen, er kopiert sie nach `daten/`) gibt es
  keine Ersatzschrift.
- Code: `neu.py` (Layout inkl. Essenkarte), `make_template_neu.py` (baut `assets/neu/template.pdf` aus der Canva-PDF; `template_essen.pdf` entstand analog aus ESSEN_NEU).
