# Cocktail-Karten (Munich Flavour)

Eigenständiges Programm, unabhängig vom Rentman-Mailer. Ziel: aus dem Material
eines Rentman-Projekts automatisch Cocktail-Karten erzeugen.

**Stand: Schritt 1.** Ein Projekt aus Rentman laden und zeigen, welches Material
(und damit welche Cocktails) darin steckt. Es wird nur gelesen.

## Einrichtung (einmalig)

1. Ordner `cocktail-karten` auf den Mac legen.
2. `.env.example` nach `.env` kopieren und `RENTMAN_TOKEN=` ausfüllen
   (Rentman: Konfiguration, API). Die `.env` nie teilen oder committen.
3. `start.command` per Doppelklick starten. Beim ersten Mal legt es die
   Python-Umgebung selbst an (braucht Python 3.9 oder neuer).
   Falls macOS die Datei nicht startet: im Terminal `chmod +x start.command`.

## Benutzung

    python projekt_laden.py "Daniel Böttcher"

Gesucht wird in Projektnamen, Kunden und Ansprechpartnern. Die Ergebnisse
liegen in `output/`:

- `projekt_<id>.md`: Material nach Artikelordner, plus Treffer mit "cocktail"
- `projekt_<id>_rohdaten.json`: Rohdaten der API

Die Ausgabe kann Kundennamen und Notizen enthalten.

## Aufbau

- `rentman.py`: Rentman-REST-API-Client (Bearer-Token, Pagination, nur GET)
- `projekt_laden.py`: Suche, Material laden, Bericht schreiben
