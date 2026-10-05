#!/bin/bash
# Installiert (oder aktualisiert) den Kartengenerator unter ~/Kartengenerator
# und legt auf dem Schreibtisch den Starter "Kartengenerator" an.
# Der heruntergeladene Ordner kann danach geloescht werden. Token und Einstellungen bleiben bei Updates erhalten.
set -e
QUELLE="$(cd "$(dirname "$0")" && pwd)"
ZIEL="$HOME/Kartengenerator"
STARTER="$HOME/Desktop/Kartengenerator.command"

mkdir -p "$ZIEL"
# Programmdateien kopieren (die Muster * schliessen unsichtbare Dateien wie .venv und .env aus)
for f in "$QUELLE"/*; do
  name="$(basename "$f")"
  case "$name" in *.pdf|__pycache__) continue ;; esac
  rm -rf "$ZIEL/$name"
  cp -R "$f" "$ZIEL/$name"
done
cp "$QUELLE/.env.example" "$ZIEL/.env.example" 2>/dev/null || true
# vorhandenen Token mitnehmen, falls er noch nicht am Zielort liegt
if [ -f "$QUELLE/.env" ] && [ ! -f "$ZIEL/.env" ]; then cp "$QUELLE/.env" "$ZIEL/.env"; fi
chmod +x "$ZIEL/start.command"

printf '#!/bin/bash\nexec "%s/start.command"\n' "$ZIEL" > "$STARTER"
chmod +x "$STARTER"
xattr -dr com.apple.quarantine "$ZIEL" "$STARTER" 2>/dev/null || true

echo
echo "Fertig. Auf dem Schreibtisch liegt jetzt 'Kartengenerator' - Doppelklick startet das Programm."
echo "(Falls macOS fragt, ob Terminal auf den Schreibtisch zugreifen darf: bitte erlauben.)"
read -r -p "Enter zum Schliessen"
