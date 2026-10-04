#!/bin/bash
# Laedt das Projekt von Daniel Böttcher aus Rentman und zeigt das Material.
# Nur lesen. Beim ersten Start wird die Python-Umgebung automatisch angelegt.
cd "$(dirname "$0")" || exit 1

if [ ! -f .env ]; then
  echo "Es fehlt die Datei .env. Kopiere .env.example nach .env und trage den Rentman-Token ein."
  read -n 1 -s -r -p "Taste zum Schliessen."
  exit 1
fi

[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt
python projekt_laden.py "Daniel Böttcher"

echo
read -n 1 -s -r -p "Fertig. Beliebige Taste zum Schliessen."
