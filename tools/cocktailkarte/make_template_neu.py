"""Einmalig: erzeugt die Vorlage des NEUEN Designs (assets/neu/) aus fertigen Karten im neuen Design (Canva-PDFs).

Behalten werden Rahmen, Titel und Fuss (Logo, Social-Icons, QR-Code). Alle Abschnitte und Eintraege werden entfernt.
Aus jeder PDF wird ausserdem der Auszug der Ueberschrift-Schrift "Agrandir Black" uebernommen (label.ttf, label2.ttf, ...).

Aufruf: python3 make_template_neu.py <karte_neu.pdf> [weitere_karte_neu.pdf ...]
"""
import sys
from pathlib import Path

import pymupdf

pdfs = sys.argv[1:]
if not pdfs:
    sys.exit(__doc__)
out = Path(__file__).parent / "assets" / "neu"
out.mkdir(parents=True, exist_ok=True)

for i, pdf in enumerate(pdfs, start=1):                     # Schrift-Auszuege
    d = pymupdf.open(pdf)
    for f in d[0].get_fonts(full=True):
        if "Agrandir" in f[3]:
            (out / ("label.ttf" if i == 1 else f"label{i}.ttf")).write_bytes(d.extract_font(f[0])[3])

doc = pymupdf.open(pdfs[0])
page = doc[0]
page.add_redact_annot(pymupdf.Rect(25, 170, 575, 740))      # nur Text zwischen Titel und Fuss
page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
doc.save(out / "template.pdf", garbage=4, deflate=True)
print("Vorlage (neues Design) erzeugt:", out)
