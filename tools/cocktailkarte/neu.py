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


# ---- Essenkarte im neuen Design (gemessen an ESSEN_NEU: Salate/Brotzeit/Dessert) ----
E_NAME, E_DESC = 16.2, 6.2                 # Montserrat Regular, Name und Beschreibung (Grossbuchstaben)
E_NAME_ZEILE, E_DESC_ZEILE = 16.2, 6.2     # Zeilenabstand
E_KOPF_OBEN = 222.4                        # Grundlinie der Spaltenueberschriften
E_KOPF_ZU_NAME, E_KOPF_ZU_NAME_DESSERT = 40.4, 35.4
E_NAME_ZU_DESC = 7.2                       # Grundlinie letzte Namenszeile -> erste Beschreibungszeile
E_GAP, E_GAP_DESSERT = 34.1, 27.7          # Grundlinie letzte Beschreibung -> naechster Name
E_ABSCHNITT = 65.2                         # Grundlinie letzte Beschreibung -> naechste Ueberschrift
E_ENDE = 634.0                             # darunter beginnt die Legende (Linie bei 645.8)
E_SPALTEN = [dict(x=64.2, breite=178, mitte=138.65), dict(x=329.4, breite=217, mitte=417.05)]
E_EINZEL_BREITE = 230


def _e_item(item, breite, mont, bold):
    from essen import wrap
    name = wrap(item["name"].upper(), mont, E_NAME, breite)
    desc = wrap(item.get("beschreibung", "").upper(), mont, E_DESC, breite) if item.get("beschreibung") else []
    allergene = f"({', '.join(item['allergene'])})" if item.get("allergene") else ""
    if allergene:
        if not desc:
            desc = [""]
        elif mont.text_length(desc[-1] + " ", fontsize=E_DESC) + bold.text_length(allergene, fontsize=E_DESC) > breite:
            desc.append("")
    return dict(name=name, desc=desc, allergene=allergene)


def _e_hoehe(it, gap):
    """Grundlinie des letzten Elements dieses Eintrags relativ zur ersten Namenszeile, und Abstand zum naechsten Namen."""
    letzte = E_NAME_ZEILE * (len(it["name"]) - 1) + (E_NAME_ZU_DESC + E_DESC_ZEILE * (len(it["desc"]) - 1) if it["desc"] else 0)
    return letzte, letzte + gap


def _e_zeichne(page, it, mont, bold, x, y, mitte=None):
    """x = linker Rand (oder mitte = Zentrierung auf diese x-Position); y = Grundlinie erster Namenszeile."""
    for i, z in enumerate(it["name"]):
        px = x if mitte is None else mitte - mont.text_length(z, fontsize=E_NAME) / 2
        page.insert_text((px, y + E_NAME_ZEILE * i), z, fontname="mont", fontsize=E_NAME, color=TEXT)
    d0 = y + E_NAME_ZEILE * (len(it["name"]) - 1) + E_NAME_ZU_DESC
    for i, z in enumerate(it["desc"]):
        letzte = i == len(it["desc"]) - 1
        w = mont.text_length(z, fontsize=E_DESC)
        extra = (mont.text_length(" ", fontsize=E_DESC) if z else 0) + bold.text_length(it["allergene"], fontsize=E_DESC) \
            if (letzte and it["allergene"]) else 0
        px = x if mitte is None else mitte - (w + extra) / 2
        yy = d0 + E_DESC_ZEILE * i
        if z:
            page.insert_text((px, yy), z, fontname="mont", fontsize=E_DESC, color=TEXT)
        if letzte and it["allergene"]:
            ax = px + w + (mont.text_length(" ", fontsize=E_DESC) if z else 0)
            page.insert_text((ax, yy), it["allergene"], fontname="bold", fontsize=E_DESC, color=TEXT)


def render_neu_essen(abschnitte, assets, warn, agrandir=None, titel="Speisen"):
    """abschnitte: [dict(titel, items=[dict(name, beschreibung, allergene)])]. 'DESSERT' steht zentriert unter den Spalten.
    Rueckgabe: PDF-Bytes."""
    doc = pymupdf.open(assets / "template_essen.pdf")
    page = doc[0]
    mont = pymupdf.Font(fontfile=str(assets.parent / "Montserrat-Regular.ttf"))
    bold = pymupdf.Font(fontfile=str(assets.parent / "Montserrat-Bold.ttf"))
    page.insert_font("mont", str(assets.parent / "Montserrat-Regular.ttf"))
    page.insert_font("bold", str(assets.parent / "Montserrat-Bold.ttf"))
    pinsel = Pinsel(page, assets, agrandir, warn, nachbarn=False)

    dessert = next((a for a in abschnitte if a["titel"].upper() == "DESSERT"), None)
    haupt = [a for a in abschnitte if a is not dessert and a["items"]]
    spalten_n = 2 if len(haupt) >= 2 else 1

    def plane(f):
        """Plan mit Abstandsfaktor f: Spalten [(sp, [(art, wert, y)])], Dessert-Plan, Ende."""
        cols = [[] for _ in range(spalten_n)]
        for i, a in enumerate(haupt):
            cols[i % spalten_n].append(a)
        planung, ende = [], 0
        for ci, secs in enumerate(cols):
            sp = E_SPALTEN[ci] if spalten_n == 2 else dict(x=None, breite=E_EINZEL_BREITE, mitte=MITTE)
            y, plan = E_KOPF_OBEN, []
            for si, a in enumerate(secs):
                if si:
                    y += E_ABSCHNITT * f
                plan.append(("kopf", a["titel"].upper(), y))
                y += E_KOPF_ZU_NAME * f
                for k, item in enumerate(a["items"]):
                    it = _e_item(item, sp["breite"], mont, bold)
                    letzte, schritt = _e_hoehe(it, E_GAP * f)
                    plan.append(("item", it, y))
                    if k < len(a["items"]) - 1:
                        y += schritt
                    else:
                        y += letzte
                        ende_sp = y
                ende = max(ende, y)
            planung.append((sp, plan))
        dplan = []
        if dessert and dessert["items"]:
            y = ende + E_ABSCHNITT * f
            dplan.append(("kopf", "DESSERT", y))
            y += E_KOPF_ZU_NAME_DESSERT * f
            for k, item in enumerate(dessert["items"]):
                it = _e_item(item, 330, mont, bold)
                letzte, schritt = _e_hoehe(it, E_GAP_DESSERT * f)
                dplan.append(("item", it, y))
                y += schritt if k < len(dessert["items"]) - 1 else letzte
            ende = y
        return planung, dplan, ende

    f = 1.0
    while True:
        planung, dplan, ende = plane(f)
        if ende <= E_ENDE or f <= 0.45:
            break
        f -= 0.03
    if ende > E_ENDE:
        warn("Die Karte ist voll: Der Inhalt reicht bis in die Allergen-Legende. Bitte Gerichte reduzieren.")

    def kopf(text, mitte, y):
        size = KOPF_SIZE
        grenze = 2 * min(mitte - 40, 555 - mitte)             # muss innerhalb des Rahmens bleiben
        if pinsel.kann(text):
            w = pinsel.laenge(text, size, KOPF_SPUR * size)
            if w > grenze:
                size *= grenze / w
                w = grenze
            pinsel.schreibe(mitte - w / 2, y, text, size, KOPF_SPUR * size, SCHWARZ)
        else:
            warn(f"Die Schrift Agrandir hat nicht alle Buchstaben fuer '{text}' - Ersatzschrift Montserrat Bold "
                 "(die Schriftdatei Agrandir-Black im Datenordner ablegen).")
            w = bold.text_length(text, fontsize=size)
            page.insert_text((mitte - w / 2, y), text, fontname="bold", fontsize=size, color=SCHWARZ)

    for sp, plan in planung:
        items = [p[1] for p in plan if p[0] == "item"]
        if sp["x"] is None:
            breite = max((mont.text_length(z, fontsize=E_NAME) for it in items for z in it["name"]), default=0)
            x = max(60, MITTE - breite / 2)
        else:
            x = sp["x"]
        for art, wert, y in plan:
            if art == "kopf":
                kopf(wert, sp["mitte"], y)
            else:
                _e_zeichne(page, wert, mont, bold, x, y)
    for art, wert, y in dplan:
        if art == "kopf":
            kopf(wert, MITTE, y)
        else:
            _e_zeichne(page, wert, mont, bold, 0, y, mitte=MITTE)
    doc.set_metadata({"title": titel, "author": "Munich Flavour"})
    return pdf_bytes(doc, warn)
