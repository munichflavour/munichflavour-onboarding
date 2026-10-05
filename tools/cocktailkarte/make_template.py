"""Einmalig pro Kartenart: erzeugt assets/<karte>/template.pdf und label.ttf aus einer fertigen Karte (Canva-PDF).

Entfernt die variablen Teile (Drinkliste, Vertikal-Beschriftung, ggf. Trennlinie in der Mitte).
Titel, Hintergrund, Logo, Footer, QR-Code und feste Linien bleiben erhalten.
Aus der Karte wird ausserdem die Pinselschrift ("Active") fuer die Beschriftung uebernommen; sie enthaelt
nur die Buchstaben, die auf der Karte vorkommen (deshalb pro Kartenart eine eigene Datei).

Aufruf: python3 make_template.py <karte> <fertige_karte.pdf>
        <karte> = cocktails | smoothies | ...
"""
import sys
from pathlib import Path

import pymupdf

karte, src_path = sys.argv[1], sys.argv[2]
out = Path(__file__).parent / "assets" / karte
out.mkdir(parents=True, exist_ok=True)

doc = pymupdf.open(src_path)
page = doc[0]
for f in page.get_fonts(full=True):
    if "Active" in f[3]:
        (out / "label.ttf").write_bytes(doc.extract_font(f[0])[3])

# Drinkliste und Vertikal-Beschriftung (nur Text, Grafiken bleiben)
page.add_redact_annot(pymupdf.Rect(40, 170, 570, 700))
page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
page.add_redact_annot(pymupdf.Rect(40, 700, 570, 750))
page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
if karte == "cocktails":
    # Trennlinie in der Mitte (nur der rechte Teil, damit der Ananas-Hintergrund unberuehrt bleibt)
    page.add_redact_annot(pymupdf.Rect(200, 568, 500, 577))
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                          graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED)
doc.save(out / "template.pdf", garbage=4, deflate=True)
print("Vorlage erzeugt:", out)
