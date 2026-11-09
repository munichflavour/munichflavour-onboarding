#!/bin/bash
# Doppelklick auf dem Mac startet den Kartengenerator (beim ersten Mal: Rechtsklick > Oeffnen).
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null; then echo "Python 3 fehlt. Installation: xcode-select --install"; read -r -p "Enter zum Beenden"; exit 1; fi
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt
if [ ! -f .env ] && [ -z "$RENTMAN_API" ]; then
  read -r -p "Rentman API-Token einfuegen: " TOKEN
  echo "RENTMAN_API=$TOKEN" > .env
fi
python app.py
