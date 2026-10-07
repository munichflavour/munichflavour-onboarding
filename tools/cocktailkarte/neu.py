"""Neues Design (2026): schwarzer Rahmen, grosser Titel, mittig gesetzte Abschnitte mit fetter Ueberschrift.

Alle Masse in pt (A4 595.5 x 842.25) und aus den fertigen Karten "Cocktails" und "Kaffee" im neuen Design gemessen:
Ueberschrift Agrandir Black 29 pt (Laufweite -0,05 em), Name Montserrat 20 pt, Zusatzzeile 10 pt; alles mittig auf x = 297.75.
Der Textblock wird als Ganzes mittig zwischen Titel und Fuss gesetzt; ist er zu hoch, werden die Abstaende (und
notfalls die Schrift) verkleinert.
"""
import pymupdf

from schrift import Pinsel, pdf_bytes

MITTE = 297.75
SCHWARZ = (0, 0, 0)
TEXT = (0x23 / 255, 0x1f / 255, 0x20 / 255)
KOPF_SIZE, NAME_SIZE, ZUSATZ_SIZE = 29, 20, 10
KOPF_SPUR = -0.05                 # Laufweite der Ueberschrift in em (Canva: -50)
KOPF_OBEN = 21.4                  # Oberkante der Ueberschrift ueber ihrer Grundlinie
KOPF_ZU_ITEM = 37.0               # Grundlinie Ueberschrift -> Grundlinie erster Eintrag
PITCH_MIT, PITCH_OHNE = 43.8, 32.8  # Grundlinie -> naechste Grundlinie (Eintrag mit / ohne Zusatzzeile)
ABSCHNITT_ABSTAND = 80.0          # Grundlinie letzter Eintrag -> Grundlinie naechste Ueberschrift
ZUSATZ_ABSTAND = 10.5             # Grundlinie Name -> Grundlinie Zusatzzeile
BLOCK_MITTE = 445                 # Mitte des Textblocks (Titel unten bei 153, Fuss ab 747)
BEREICH = (185, 728)              # hier muss der Block hineinpassen
MAX_BREITE = 500


def _plan(sections, f):
    """Relative Grundlinien: [(art, wert, y)] und (Oberkante, Unterkante) des Blocks bei Abstandsfaktor f."""
    plan, y, letzter_zusatz = [], 0.0, False
    for i, (titel, items) in enumerate(sections):
        if i:
            y += (ABSCHNITT_ABSTAND + (2 if letzter_zusatz else -2)) * f
        plan.append(("kopf", titel, y))
        y += KOPF_ZU_ITEM * f
        for k, (name, zusatz) in enumerate(items):
            plan.append(("item", (name, zusatz), y))
            letzter_zusatz = bool(zusatz)
            if k < len(items) - 1:
                y += (PITCH_MIT if zusatz else PITCH_OHNE) * f
    unten = y + (ZUSATZ_ABSTAND * f if letzter_zusatz else 4)
    return plan, -KOPF_OBEN * f, unten


def render_neu(sections, assets, warn, agrandir=None, titel="Karte"):
    """sections: [(Ueberschrift, [(Name, Zusatzzeile), ...]), ...]. Rueckgabe: PDF-Bytes."""
    sections = [(t, items) for t, items in sections if items]
    doc = pymupdf.open(assets / "template.pdf")
    page = doc[0]
    mont = pymupdf.Font(fontfile=str(assets.parent / "Montserrat-Regular.ttf"))
    bold = pymupdf.Font(fontfile=str(assets.parent / "Montserrat-Bold.ttf"))
    page.insert_font("mont", str(assets.parent / "Montserrat-Regular.ttf"))
    pinsel = Pinsel(page, assets, agrandir, warn, nachbarn=False)

    # Abstaende verkleinern, bis der Block in den Bereich passt; bei starker Verkleinerung auch die Schrift
    f = 1.0
    while True:
        plan, oben, unten = _plan(sections, f)
        if unten - oben <= BEREICH[1] - BEREICH[0] or f <= 0.5:
            break
        f -= 0.02
    if unten - oben > BEREICH[1] - BEREICH[0]:
        warn("Die Karte ist sehr voll: Die Eintraege sind sehr eng gesetzt. Bitte Eintraege reduzieren.")
    fs = 1.0 if f >= 0.75 else max(0.65, f / 0.75)        # Schriftfaktor
    hoehe = unten - oben
    start = min(max(BLOCK_MITTE - hoehe / 2, BEREICH[0]), BEREICH[1] - hoehe) - oben    # absolute y der ersten Grundlinie

    for art, wert, y in plan:
        y += start
        if art == "kopf":
            size = KOPF_SIZE * fs
            if pinsel.kann(wert):
                w = pinsel.laenge(wert, size, KOPF_SPUR * size)
                pinsel.schreibe(MITTE - w / 2, y, wert, size, KOPF_SPUR * size, SCHWARZ)
            else:
                warn(f"Die Schrift Agrandir hat nicht alle Buchstaben fuer '{wert}' - Ersatzschrift Montserrat Bold "
                     "(die Schriftdatei Agrandir-Black im Datenordner ablegen).")
                if "bold" not in getattr(page, "_bold_da", set()):
                    page.insert_font("bold", str(assets.parent / "Montserrat-Bold.ttf"))
                    page._bold_da = {"bold"}
                w = bold.text_length(wert, fontsize=size)
                page.insert_text((MITTE - w / 2, y), wert, fontname="bold", fontsize=size, color=SCHWARZ)
        else:
            name, zusatz = wert
            ns = NAME_SIZE * fs
            w = mont.text_length(name, fontsize=ns)
            if w > MAX_BREITE:
                ns *= MAX_BREITE / w
                w = MAX_BREITE
            page.insert_text((MITTE - w / 2, y), name, fontname="mont", fontsize=ns, color=TEXT)
            if zusatz:
                zs = ZUSATZ_SIZE * fs
                wz = mont.text_length(zusatz, fontsize=zs)
                if wz > MAX_BREITE:
                    zs *= MAX_BREITE / wz
                    wz = MAX_BREITE
                page.insert_text((MITTE - wz / 2, y + ZUSATZ_ABSTAND * fs), zusatz, fontname="mont", fontsize=zs, color=TEXT)
    doc.set_metadata({"title": titel, "author": "Munich Flavour"})
    return pdf_bytes(doc, warn)
