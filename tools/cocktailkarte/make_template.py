"""Einmalig pro Kartenart: erzeugt assets/<karte>/template.pdf und label.ttf aus einer fertigen Karte (Canva-PDF).

Entfernt die variablen Teile (Drinkliste, Vertikal-Beschriftung, ggf. Trennlinie in der Mitte).
Titel, Hintergrund, Logo, Footer, QR-Code und feste Linien bleiben erhalten.
Aus der Karte wird ausserdem die Pinselschrift ("Active") fuer die Beschriftung uebernommen; sie enthaelt
nur die Buchstaben, die auf der Karte vorkommen (deshalb pro Kartenart eine eigene Datei).

Aufruf: python3 make_template.py <karte> <fertige_karte.pdf> [weitere_karte.pdf ...]
        <karte> = cocktails | smoothies | kaffee | essen
Weitere PDFs werden nur fuer zusaetzliche Pinselschrift-Dateien (label2.ttf, ...) genutzt, z. B. wegen Sonderzeichen
wie dem E-Akut in CANAPES.
"""
import sys
from pathlib import Path

import pymupdf

karte, src_path, extra = sys.argv[1], sys.argv[2], sys.argv[3:]
out = Path(__file__).parent / "assets" / karte
out.mkdir(parents=True, exist_ok=True)

# Trennlinien (y), die bei der jeweiligen Kartenart variabel sind und neu gezeichnet werden
LINIEN = {"cocktails": [572.3], "essen": [492.0, 626.0]}


def pinselschrift(pdf, ziel):
    d = pymupdf.open(pdf)
    for f in d[0].get_fonts(full=True):
        if "Active" in f[3]:
            ziel.write_bytes(d.extract_font(f[0])[3])
            return True
    return False


doc = pymupdf.open(src_path)
page = doc[0]
pinselschrift(src_path, out / "label.ttf")
d0 = pymupdf.open(src_path)
for f in d0[0].get_fonts(full=True):  # Schrift der Allergen-Legende (nur bei Essenkarten vorhanden)
    if "CanvaSans" in f[3]:
        (out / "legende.ttf").write_bytes(d0.extract_font(f[0])[3])
for i, pdf in enumerate(extra, start=2):
    pinselschrift(pdf, out / f"label{i}.ttf")

# Variable Texte (Drinkliste/Speisen, Vertikal-Beschriftung, Legende) entfernen; Grafiken bleiben
page.add_redact_annot(pymupdf.Rect(10, 150, 585, 760))
page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
# variable Trennlinien (nur der rechte Teil beruehren, damit der Ananas-Hintergrund unberuehrt bleibt)
for y in LINIEN.get(karte, []):
    page.add_redact_annot(pymupdf.Rect(200, y - 4, 500, y + 4))
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                          graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED)
doc.save(out / "template.pdf", garbage=4, deflate=True)
print("Vorlage erzeugt:", out)
