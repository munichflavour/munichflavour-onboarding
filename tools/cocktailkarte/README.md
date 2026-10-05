# Kartengenerator (Rentman -> PDF)

## Oberflaeche auf dem Mac (empfohlen)

1. Einmalig Python 3 sicherstellen (Terminal: `python3 --version`; sonst `xcode-select --install`).
2. `tools/cocktailkarte/start.command` doppelklicken (beim ersten Mal Rechtsklick > Oeffnen).
   Beim ersten Start wird nach dem Rentman API-Token gefragt; er wird lokal in `tools/cocktailkarte/.env` gespeichert
   (steht in `.gitignore`, landet nicht im Repo).
3. Im Browser Projektnamen eingeben, "Karte erstellen" klicken. Es werden alle Karten erzeugt, fuer die im Projekt
   Material gebucht ist (Cocktails, Smoothies). Vorschau, PDF-Download und Hinweise stehen direkt darunter.

Die Oberflaeche laeuft nur auf deinem Rechner (127.0.0.1:8765), beenden mit Ctrl+C im Terminalfenster.

## Kommandozeile

Erzeugt Getraenkekarten im Munich-Flavour-Layout aus dem Material eines Rentman-Projekts.

```bash
pip install pymupdf
export RENTMAN_API=<API-Token>            # nie ins Repo schreiben

python3 tools/cocktailkarte/cocktailkarte.py "Böttcher"                    # alle gebuchten Karten
python3 tools/cocktailkarte/cocktailkarte.py "Lammens" --karte smoothies   # nur Smoothie-Karte
```

Name oder Projektnummer. Bei mehreren Treffern wird das naechste anstehende Event genommen.

## Aufbau

- `assets/<karte>/template.pdf` und `label.ttf`: Vorlage (Titel, Ananas, Logo, Footer, QR) und die Pinselschrift
  aus der jeweiligen fertigen Karte. Neu erzeugen mit `make_template.py <karte> <fertige_karte.pdf>`.
- `stammdaten/getraenke.json`: Kartentexte (Name, Zutaten, alkoholfrei). Drinks, die hier fehlen, werden mit dem
  Rentman-Text gesetzt und auf stderr gemeldet.
- Reihenfolge der Drinks = Reihenfolge in Rentman.
