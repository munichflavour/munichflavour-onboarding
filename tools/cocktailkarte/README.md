# Kartengenerator (Rentman -> PDF)

## Oberflaeche auf dem Mac (empfohlen)

**Einmalig installieren** (auch fuer Updates):
1. ZIP des Branches von GitHub laden und entpacken.
2. Falls macOS blockiert: im Terminal `xattr -dr com.apple.quarantine ` tippen, den entpackten Ordner ins Fenster
   ziehen, Enter.
3. `tools/cocktailkarte/installieren.command` doppelklicken. Das kopiert das Programm nach `~/Kartengenerator` und
   legt auf dem Schreibtisch den Starter **Kartengenerator** an. Token und Einstellungen bleiben bei Updates erhalten.

**Benutzen:** Starter **Kartengenerator** auf dem Schreibtisch doppelklicken. Beim ersten Start wird nach dem
Rentman API-Token gefragt (gespeichert in `~/Kartengenerator/.env`, nie im Repo). Im Browser Projektnamen eingeben,
"Karte erstellen" klicken. Es werden alle Karten erzeugt, fuer die im Projekt Material gebucht ist (Cocktails,
Smoothies, Kaffee, Essen). Fehlende Karten lassen sich unter "Weitere Karte erstellen" trotzdem anfordern. Vorschau, PDF-Download und Hinweise stehen direkt darunter.

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

## Kartenarten und Datenquellen

| Karte | Rentman-Gruppe | Texte |
|---|---|---|
| Cocktails (+ Mocktails) | `Cocktails & Longdrinks` | `stammdaten/getraenke.json`, sonst Rentman |
| Smoothies | `Smoothies` | `stammdaten/getraenke.json`, sonst Rentman |
| Kaffee | `Kaffee` (Zusatzzeile = Bemerkung, z. B. Einfach/Doppelt). Fehlt die Gruppe, aber Kaffee-Equipment ist gebucht (Siebtraeger, Kaffeebar ...), gilt die Standardliste | `stammdaten/kaffee.json` |
| Essen | `Catering` (Bloecke: Canapes, Brotzeit Spezialitaeten, Speisen im Weckglas = Salate, Dessert im Weckglas) | `stammdaten/speisen.json` inkl. Allergene und vegetarisch/vegan |

**Allergene** stehen nicht in Rentman, sondern in `stammdaten/speisen.json`. Die Angaben stammen aus den bisherigen
Karten und sind nicht neu geprueft. Speisen ohne Eintrag werden ohne Allergene gesetzt und gemeldet.

## Aufbau

- `assets/<karte>/template.pdf` und `label.ttf`: Vorlage (Titel, Ananas, Logo, Footer, QR) und die Pinselschrift
  aus der jeweiligen fertigen Karte. Neu erzeugen mit `make_template.py <karte> <fertige_karte.pdf>`.
- `stammdaten/getraenke.json`: Kartentexte (Name, Zutaten, alkoholfrei). Drinks, die hier fehlen, werden mit dem
  Rentman-Text gesetzt und auf stderr gemeldet.
- Reihenfolge der Drinks = Reihenfolge in Rentman.
