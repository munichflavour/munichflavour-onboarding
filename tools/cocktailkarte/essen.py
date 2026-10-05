"""Layout der Essenkarte (Canapes, Brotzeit, Salate, Dessert ...), nachgebaut nach den Karten Manitz Finsterwald
und Hausbau. Alle Masse in pt (A4 595.5 x 842.25).

Aufbau: Abschnitte oben (eine Spalte oder zwei Spalten), darunter Trennlinie und DESSERT zentriert, ganz unten
Linie und Allergen-Legende (fester Text).
"""
import re

import pymupdf

from schrift import Pinsel

TEXT = (0x23 / 255, 0x22 / 255, 0x20 / 255)
NAME_SIZE, DESC_SIZE, DIET_SIZE, HEAD_SIZE = 16.2, 6.2, 8.4, 30
NAME_LEAD, DESC_LEAD = 16.2, 6.4
HEAD_SPACING = 1.5            # Buchstabenabstand der Abschnittsueberschriften (Canva-Tracking)
PAGE_CENTER = 297.75
SPALTEN = [dict(x=62, breite=190, kopf=157), dict(x=337, breite=218, kopf=437)]   # zwei Spalten (kopf = Mitte der Ueberschrift)
EINZEL_BREITE = 250                                          # eine Spalte (zentriert)
LINIE_X0, LINIE_X1 = 59.5, 536.0
LEGENDE_LINIE_Y = 656.2
INHALT_ENDE = 640            # darunter beginnt die Legende
LEGENDE = [  # (Text, Grundlinie y, Textgroesse)
    ("Allergene und Unverträglichkeiten", 681.9),
    ("A. glutenhaltiges Getreide | B. Krebstiere | C. Eier | D. Pilze | E. Nüsse | F. Soja |", 703.3),
    ("G. Milch / Laktose | H. Fisch | L. Sellerie | M. Senf | N. Sesam", 714.0),
    ("Bei Allergien und Unverträglichkeiten sprecht bitte unser Servicepersonal an. Wir beraten euch gerne bei der "
     "Speisenauswahl. Trotz aller Sorgfalt", 735.3),
    ("können Kreuzkontaminationen nicht ausgeschlossen werden!", 746.0),
]


def wrap(text, font, size, breite):
    """Bricht Text an Leerzeichen und Bindestrichen um (Bindestrich bleibt am Zeilenende)."""
    stuecke = []  # (Stueck, Leerzeichen davor?)
    for i, wort in enumerate(text.split()):
        teile = re.findall(r"[^-]+-?|-", wort)
        for j, t in enumerate(teile):
            stuecke.append((t, j == 0 and i > 0))
    zeilen, zeile = [], ""
    for t, leer in stuecke:
        kandidat = zeile + (" " if leer and zeile else "") + t
        if zeile and font.text_length(kandidat, fontsize=size) > breite:
            zeilen.append(zeile)
            zeile = t
        else:
            zeile = kandidat
    if zeile:
        zeilen.append(zeile)
    return zeilen


def baue_item(item, breite, fonts, kurz):
    """Zerlegt ein Gericht in Zeilen und berechnet die Hoehe."""
    name = wrap(item["name"].upper(), fonts["mont"], NAME_SIZE, breite)
    diet = {"V": "(V)" if kurz else "(vegetarisch)", "VG": "(VG)" if kurz else "(vegan)"}.get(item.get("ernaehrung", ""), "")
    allergene = f"({', '.join(item['allergene'])})" if item.get("allergene") else ""
    # Beschreibung inkl. Allergenkuerzel: Kuerzel steht (fett) hinter dem Text; fuer den Umbruch mitgemessen
    zeilen = wrap(item.get("beschreibung", "").upper(), fonts["mont"], DESC_SIZE, breite) if item.get("beschreibung") else []
    if allergene and zeilen:
        if fonts["mont"].text_length(zeilen[-1] + " " + allergene, fontsize=DESC_SIZE) > breite:
            zeilen.append("")
    elif allergene:
        zeilen = [""]
    h = NAME_LEAD * len(name) + (1 + DESC_LEAD * len(zeilen) if zeilen else 0)
    return dict(name=name, diet=diet, desc=zeilen, allergene=allergene, h=h)


def zeichne_item(page, it, fonts, x, top, mitte=None):
    """Zeichnet ein Gericht. x = linker Rand; mitte = zentrieren auf diese x-Position (sonst linksbuendig)."""
    for i, zeile in enumerate(it["name"]):
        w = fonts["mont"].text_length(zeile, fontsize=NAME_SIZE)
        extra = fonts["bold"].text_length(" " + it["diet"], fontsize=DIET_SIZE) if (i == len(it["name"]) - 1 and it["diet"]) else 0
        px = x if mitte is None else mitte - (w + extra) / 2
        y = top + 15.9 + NAME_LEAD * i
        page.insert_text((px, y), zeile, fontname="mont", fontsize=NAME_SIZE, color=TEXT)
        if i == len(it["name"]) - 1 and it["diet"]:
            page.insert_text((px + w + fonts["bold"].text_length(" ", fontsize=DIET_SIZE), y), it["diet"],
                             fontname="bold", fontsize=DIET_SIZE, color=TEXT)
    desc_top = top + NAME_LEAD * len(it["name"]) + 1
    for i, zeile in enumerate(it["desc"]):
        letzte = i == len(it["desc"]) - 1
        w = fonts["mont"].text_length(zeile, fontsize=DESC_SIZE)
        wa = fonts["bold"].text_length((" " if zeile else "") + it["allergene"], fontsize=DESC_SIZE) if (letzte and it["allergene"]) else 0
        px = x if mitte is None else mitte - (w + wa) / 2
        y = desc_top + DESC_LEAD * i + 5.9
        if zeile:
            page.insert_text((px, y), zeile, fontname="mont", fontsize=DESC_SIZE, color=TEXT)
        if letzte and it["allergene"]:
            ax = px + w + (fonts["mont"].text_length(" ", fontsize=DESC_SIZE) if zeile else 0)
            page.insert_text((ax, y), it["allergene"], fontname="bold", fontsize=DESC_SIZE, color=TEXT)


def ueberschrift(page, text, mitte, y0, fonts, warn):
    """Abschnittsueberschrift in der Pinselschrift der Karte (wenn alle Buchstaben vorhanden), sonst Montserrat Bold."""
    pinsel = fonts["pinsel"]
    if pinsel.kann(text):
        w = pinsel.laenge(text, HEAD_SIZE, HEAD_SPACING)
        pinsel.schreibe(mitte - w / 2, y0 + 27.4, text, HEAD_SIZE, HEAD_SPACING, TEXT)
        return
    warn(f"Die Pinselschrift der Vorlage hat nicht alle Buchstaben fuer '{text}' - Ersatzschrift Montserrat Bold.")
    size, spacing = HEAD_SIZE * 0.8, 1.0
    w = sum(fonts["bold"].text_length(c, fontsize=size) for c in text) + spacing * (len(text) - 1)
    x = mitte - w / 2
    for c in text:
        page.insert_text((x, y0 + 27.4), c, fontname="bold", fontsize=size, color=TEXT)
        x += fonts["bold"].text_length(c, fontsize=size) + spacing


def render_essen(abschnitte, assets, warn):
    """abschnitte: [dict(titel, items=[dict(name, beschreibung, allergene, ernaehrung)])] in Anzeigereihenfolge.

    Der Abschnitt mit dem Titel DESSERT wird zentriert unter den uebrigen gesetzt. Rueckgabe: PDF-Bytes.
    """
    doc = pymupdf.open(assets / "template.pdf")
    page = doc[0]
    fonts = dict(mont=pymupdf.Font(fontfile=str(assets.parent / "Montserrat-Regular.ttf")),
                 bold=pymupdf.Font(fontfile=str(assets.parent / "Montserrat-Bold.ttf")))
    page.insert_font("mont", str(assets.parent / "Montserrat-Regular.ttf"))
    page.insert_font("bold", str(assets.parent / "Montserrat-Bold.ttf"))
    fonts["pinsel"] = Pinsel(page, assets)
    legende_ttf = assets / "legende.ttf"
    page.insert_font("legende", str(legende_ttf))
    legende = pymupdf.Font(fontfile=str(legende_ttf))

    dessert = next((a for a in abschnitte if a["titel"] == "DESSERT"), None)
    haupt = [a for a in abschnitte if a["titel"] != "DESSERT" and a["items"]]
    zwei = len(haupt) >= 2

    # Gericht-Hoehen erst berechnen, dann ggf. Abstaende verkleinern, bis alles vor die Legende passt
    def layout(luecke):
        spalten = [[] for _ in range(2 if zwei else 1)]
        for i, a in enumerate(haupt):
            spalten[i % len(spalten)].append(a)
        kopf_y = 179 if zwei else 174
        cols = []
        for ci, secs in enumerate(spalten):
            sp = SPALTEN[ci] if zwei else dict(x=None, breite=EINZEL_BREITE)
            y = kopf_y
            plan = []
            for a in secs:
                plan.append(("kopf", a["titel"], y))
                y += 50
                for item in a["items"]:
                    it = baue_item(item, sp["breite"], fonts, zwei)
                    plan.append(("item", it, y))
                    y += it["h"] + luecke
                y += 18 - luecke   # Abstand zum naechsten Abschnitt in derselben Spalte
            cols.append((sp, plan, y - luecke))
        ende = max(c[2] for c in cols)
        d = []
        if dessert and dessert["items"]:
            ly = ende + 26 - luecke + 2
            y = ly + 15
            d.append(("kopf", "DESSERT", y)); d_y = y + 41
            for item in dessert["items"]:
                it = baue_item(item, 330, fonts, True)
                d.append(("item", it, d_y)); d_y += it["h"] + 11
            return cols, ly, d, d_y - 11
        return cols, None, d, ende

    for luecke in (18, 14, 10, 7):
        cols, linie, dess, ende = layout(luecke)
        if ende <= INHALT_ENDE:
            break
    else:
        warn("Die Karte ist voll: Der Inhalt reicht bis in die Allergen-Legende. Bitte Gerichte reduzieren.")

    for sp, plan, _ in cols:
        breiten = [max(fonts["mont"].text_length(z, fontsize=NAME_SIZE) for z in p[1]["name"]) for p in plan if p[0] == "item"]
        links = sp["x"] if sp["x"] is not None else max(60, PAGE_CENTER - (max(breiten) if breiten else 0) / 2)
        mitte = sp["kopf"] if sp["x"] is not None else PAGE_CENTER
        for art, wert, y in plan:
            if art == "kopf":
                ueberschrift(page, wert, mitte, y, fonts, warn)
            else:
                zeichne_item(page, wert, fonts, links, y)

    if linie:
        page.draw_line((LINIE_X0, linie), (LINIE_X1, linie), color=(0, 0, 0), width=0.75)
        for art, wert, y in dess:
            if art == "kopf":
                ueberschrift(page, wert, PAGE_CENTER, y, fonts, warn)
            else:
                zeichne_item(page, wert, fonts, 0, y, mitte=PAGE_CENTER)

    page.draw_line((LINIE_X0, LEGENDE_LINIE_Y), (LINIE_X1, LEGENDE_LINIE_Y), color=(0, 0, 0), width=0.75)
    for text, y in LEGENDE:
        w = legende.text_length(text, fontsize=8)
        page.insert_text((PAGE_CENTER - w / 2, y), text, fontname="legende", fontsize=8, color=TEXT)
    doc.set_metadata({"title": "Speisen", "author": "Munich Flavour"})
    return doc.tobytes(garbage=3, deflate=True)
