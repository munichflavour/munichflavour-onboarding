#!/usr/bin/env python3
"""Baut die beiden Download-Pakete fuer den Kartengenerator (nur Entwickler, nicht Teil der Pakete).

    python3 tools/cocktailkarte/zip_bauen.py

Ergebnis: downloads/Kartengenerator-Mac.zip und downloads/Kartengenerator-Windows.zip
Beide enthalten nur die Dateien der jeweiligen Plattform direkt in einem Ordner (Installer oben, keine Verschachtelung).
Nach jeder Aenderung am Programm neu bauen und mit committen.
"""
import zipfile
from pathlib import Path

QUELLE = Path(__file__).parent
ZIEL = QUELLE.parent.parent / "downloads"
IGNORIEREN_ORDNER = {"__pycache__", "daten", ".cache", ".venv"}
IGNORIEREN_DATEIEN = {".env", ".DS_Store", "zip_bauen.py"}
NUR_MAC = {"installieren.command", "start.command"}
NUR_WINDOWS = {"installieren.bat", "installieren.ps1", "start.bat", "start.ps1"}
PAKETE = {"Mac": NUR_WINDOWS, "Windows": NUR_MAC}          # Plattform -> auszuschliessende Dateien
ZEILENENDE = {".bat": b"\r\n", ".ps1": b"\r\n", ".command": b"\n"}   # Windows-Skripte CRLF, Mac-Skripte LF


def dateien():
    for pfad in sorted(QUELLE.rglob("*")):
        rel = pfad.relative_to(QUELLE)
        if pfad.is_dir() or set(rel.parts) & IGNORIEREN_ORDNER or pfad.name in IGNORIEREN_DATEIEN:
            continue
        if pfad.suffix.lower() in (".pdf",) and rel.parts[0] != "assets":   # fertige Karten nie mitliefern
            continue
        if pfad.suffix.lower() in (".otf",) or (pfad.suffix.lower() == ".ttf" and rel.parts[0] != "assets"):
            continue                                                         # geschuetzte Schrift nie mitliefern
        yield pfad, rel


def baue(plattform, ausschluss):
    ZIEL.mkdir(exist_ok=True)
    ziel = ZIEL / f"Kartengenerator-{plattform}.zip"
    ordner = f"Kartengenerator-{plattform}"
    with zipfile.ZipFile(ziel, "w", zipfile.ZIP_DEFLATED) as z:
        for pfad, rel in dateien():
            if rel.name in ausschluss:
                continue
            daten = pfad.read_bytes()
            ende = ZEILENENDE.get(pfad.suffix.lower())
            if ende:
                daten = daten.replace(b"\r\n", b"\n").replace(b"\n", ende)
            info = zipfile.ZipInfo(f"{ordner}/{rel.as_posix()}", date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if pfad.suffix == ".command" else 0o644) << 16     # .command ausfuehrbar
            z.writestr(info, daten)
    return ziel


if __name__ == "__main__":
    for plattform, ausschluss in PAKETE.items():
        z = baue(plattform, ausschluss)
        print(f"{z.name}: {z.stat().st_size // 1024} KB")
