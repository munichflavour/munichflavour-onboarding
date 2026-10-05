# Kartengenerator (Rentman -> PDF)

Erzeugt Getraenkekarten im Munich-Flavour-Layout aus dem Material eines Rentman-Projekts.

```bash
pip install pymupdf
export RENTMAN_API=<API-Token>            # nie ins Repo schreiben

python3 tools/cocktailkarte/cocktailkarte.py "Böttcher"                    # Cocktails + Mocktails
python3 tools/cocktailkarte/cocktailkarte.py "Lammens" --karte smoothies   # Smoothie-Karte
```

Name oder Projektnummer. Bei mehreren Treffern wird das naechste anstehende Event genommen.

## Aufbau

- `assets/<karte>/template.pdf` und `label.ttf`: Vorlage (Titel, Ananas, Logo, Footer, QR) und die Pinselschrift
  aus der jeweiligen fertigen Karte. Neu erzeugen mit `make_template.py <karte> <fertige_karte.pdf>`.
- `stammdaten/getraenke.json`: Kartentexte (Name, Zutaten, alkoholfrei). Drinks, die hier fehlen, werden mit dem
  Rentman-Text gesetzt und auf stderr gemeldet.
- Reihenfolge der Drinks = Reihenfolge in Rentman.
