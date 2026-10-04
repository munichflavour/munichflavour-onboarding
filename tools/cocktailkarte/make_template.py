"""Einmalig: erzeugt assets/template.pdf aus einer fertigen Karte (Canva-PDF).

Entfernt die variablen Teile (Drinkliste, Cocktails/Mocktails-Beschriftung,
Trennlinie). Titel, Hintergrund, Logo, Footer und QR-Code bleiben erhalten.

Aufruf: python3 make_template.py <fertige_karte.pdf>
"""
import sys
import pymupdf

src = pymupdf.open(sys.argv[1])
page = src[0]
# Drinkliste und Vertikal-Beschriftungen (nur Text, Grafiken bleiben)
page.add_redact_annot(pymupdf.Rect(40, 170, 570, 750))
page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                      graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
# Trennlinie (nur der rechte Teil, damit der Ananas-Hintergrund unberuehrt bleibt)
page.add_redact_annot(pymupdf.Rect(200, 568, 500, 577))
page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                      graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED)
src.save("assets/template.pdf", garbage=4, deflate=True)
