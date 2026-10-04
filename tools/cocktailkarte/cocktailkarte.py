#!/usr/bin/env python3
"""Erzeugt die Cocktailkarte (PDF) fuer ein Rentman-Projekt.

Aufruf:
    python3 cocktailkarte.py "Böttcher"          # Kundenname / Teil des Projektnamens
    python3 cocktailkarte.py 2480                 # Projektnummer
    python3 cocktailkarte.py 2480 -o karte.pdf
    python3 cocktailkarte.py "Toni Dress" --karte smoothies

Zugang: Umgebungsvariable RENTMAN_API (API-Token, wird nie ausgegeben).
Abhaengigkeit: pip install pymupdf
"""
import argparse
import datetime
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import pymupdf

HERE = Path(__file__).parent
ASSETS = HERE / "assets"
API = "https://api.rentman.net"
# Kartenarten: Rentman-Materialgruppe mit den Drinks und Beschriftung(en) der Karte
KARTEN = {
    "cocktails": dict(group="cocktails & longdrinks", datei="COCKTAILS", titel="Cocktails"),
    "smoothies": dict(group="smoothies", datei="SMOOTHIES", titel="Smoothies"),
}
FARBZUSATZ = re.compile(r"\s*\((gelb|gruen|grün|blau|rot|orange|pink|lila|weiss|weiß)\)", re.I)
MAX_TEXT_WIDTH = 385  # Platz zwischen Textspalte und rechtem Rand

# Textkorrekturen fuer die Zutatenzeile (Rentman -> Karte), ohne Beruecksichtigung der Gross/Kleinschreibung
ZUTATEN_ERSETZUNGEN = {
    "absolut wodka": "Wodka",
    "bombay sapphire gin": "Gin",
    "hollunder": "Holunder",
    "minze rohrzucker": "Minze, Rohrzucker",  # fehlendes Komma in Rentman
}

# Layout (pt, A4 595.5 x 842.25), uebernommen aus der handgemachten Karte
TEXT_COLOR = (0x23 / 255, 0x22 / 255, 0x20 / 255)
NAME_SIZE, ZUTAT_SIZE = 20, 10
NAME_X = 176.5
BLOCKS = {  # Mitte der Drinkliste, Hoehe des Bereichs, Position der Vertikal-Beschriftung
    "COCKTAILS": dict(center=343, height=330, label_x=55, label_center=350),
    "MOCKTAILS": dict(center=668, height=160, label_x=58, label_center=669),
}
BLOCKS["EINZEL"] = dict(center=460, height=520, label_x=55, label_center=460, max_pitch=62)  # nur eine Gruppe
MAX_PITCH = 45.5
LABEL_SIZE = 30
DIVIDER = dict(x0=60.1, x1=536.5, y=572.3, width=0.75)


# ---------------------------------------------------------------- Rentman

def api_get(path, **params):
    token = os.environ.get("RENTMAN_API") or os.environ.get("rentman_api")
    if not token:
        sys.exit("Umgebungsvariable RENTMAN_API (Rentman API-Token) ist nicht gesetzt.")
    rows, offset = [], 0
    while True:
        q = urllib.parse.urlencode({**params, "limit": 300, "offset": offset})
        req = urllib.request.Request(f"{API}{path}?{q}", headers={"Authorization": f"Bearer {token}"})
        data = json.load(urllib.request.urlopen(req, timeout=60))["data"]
        rows += data
        if len(data) < 300:
            return rows
        offset += 300


def find_project(query):
    if query.isdigit():
        hits = api_get("/projects", number=query)
    else:
        hits = [p for p in api_get("/projects") if query.lower() in (p["name"] or "").lower()]
    if not hits:
        sys.exit(f"Kein Projekt zu '{query}' gefunden.")
    if len(hits) > 1:
        heute = datetime.date.today().isoformat()
        hits.sort(key=lambda p: (p["planperiod_start"][:10] < heute, abs(
            (datetime.date.fromisoformat(p["planperiod_start"][:10]) - datetime.date.today()).days)))
        print(f"Mehrere Treffer fuer '{query}', es wird das naechste Event genommen:", file=sys.stderr)
        for p in hits[:10]:
            print(f"  Nr. {p['number']}  {p['name'].strip()}  ({p['planperiod_start'][:10]})", file=sys.stderr)
    return hits[0]


def plain(text):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text or ""))).strip()


def load_drinks(project_id, group_name):
    """Liefert [(Name, Zutatentext)] aller Drinks der angegebenen Materialgruppe."""
    rows = api_get(f"/projects/{project_id}/projectequipment")
    groups = {f"/projectequipmentgroup/{g['id']}": g["name"].strip().lower()
              for g in api_get(f"/projects/{project_id}/projectequipmentgroup")}
    blocks = {f"/projectequipment/{r['id']}" for r in rows
              if not r["parent"] and groups.get(r["equipment_group"]) == group_name and (r["quantity"] or 0) > 0}
    drinks, seen = [], set()
    for r in rows:
        if r["parent"] not in blocks:
            continue
        name = FARBZUSATZ.sub("", plain(r["name"]))  # "Chia Mango (gelb)" und "Chia Mango" sind derselbe Drink
        zutaten = plain(r["external_remark"])
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        if not zutaten:
            print(f"Hinweis: Drink '{name}' hat in Rentman keine Zutatenzeile (Bemerkung).", file=sys.stderr)
        drinks.append((name, zutaten))
    return drinks


# ---------------------------------------------------------------- Texte

def clean_ingredients(text):
    text = text.strip()
    if text.startswith("(") and text.endswith(")"):
        text = text[1:-1]
    text = re.sub(r"(?<=[^\W\d])\.\s+", ", ", text)  # "Banane. Zitrone" -> "Banane, Zitrone"
    for old, new in ZUTATEN_ERSETZUNGEN.items():
        text = re.sub(re.escape(old), new, text, flags=re.I)
    parts = [p.strip() for p in re.split(r",(?!\d)", text) if p.strip()]  # "0,00%" nicht trennen
    return ", ".join(parts).upper()


def split_menu(drinks):
    """Teilt in (Cocktails, Mocktails). Mocktails erkennt man an '(alkoholfrei)' im Namen."""
    is_free = lambda n: "alkoholfrei" in n.lower()
    base = lambda n: re.sub(r"\s*\(alkoholfrei\)", "", n, flags=re.I).strip()
    alcoholic = {n.lower() for n, _ in drinks if not is_free(n)}
    cocktails, mocktails = [], []
    for name, zutaten in drinks:
        item = (base(name), clean_ingredients(zutaten))
        if not is_free(name):
            cocktails.append((item[0].upper(), item[1]))
        else:
            # gleicher Name wie ein alkoholischer Drink (z.B. Hugo) -> "Virgin Hugo"
            label = f"Virgin {item[0]}" if item[0].lower() in alcoholic else item[0]
            mocktails.append((label.upper(), item[1]))
    return cocktails, mocktails


# ---------------------------------------------------------------- PDF

def fit_size(font, text, size):
    """Verkleinert die Schrift, falls der Text sonst ueber den rechten Rand laeuft."""
    w = font.text_length(text, fontsize=size)
    return size if w <= MAX_TEXT_WIDTH else size * MAX_TEXT_WIDTH / w


def render(sections, out_path, titel):
    """sections: [(Beschriftung, [(Name, Zutaten), ...]), ...] - eine oder zwei Gruppen."""
    sections = [(t, items) for t, items in sections if items]
    doc = pymupdf.open(ASSETS / "template.pdf")
    page = doc[0]
    mont = pymupdf.Font(fontfile=str(ASSETS / "Montserrat-Regular.ttf"))
    page.insert_font("mont", str(ASSETS / "Montserrat-Regular.ttf"))
    page.insert_font("active", str(ASSETS / "Active-Regular.ttf"))
    page.insert_font("bold", str(ASSETS / "Montserrat-Bold.ttf"))
    active_chars = set(chr(c) for c in pymupdf.Font(fontfile=str(ASSETS / "Active-Regular.ttf")).valid_codepoints())

    for title, items in sections:
        b = BLOCKS[title] if len(sections) == 2 else BLOCKS["EINZEL"]
        pitch = min(b.get("max_pitch", MAX_PITCH), b["height"] / len(items))
        scale = min(1.0, pitch / MAX_PITCH) ** 0.5
        # Drinks sind vertikal um die Beschriftung zentriert
        block_h = pitch * (len(items) - 1) + 31
        top = b["center"] - block_h / 2
        for i, (name, zutaten) in enumerate(items):
            y = top + i * pitch + NAME_SIZE * 0.85
            ns = fit_size(mont, name, NAME_SIZE * scale)
            zs = fit_size(mont, zutaten, ZUTAT_SIZE * scale)
            page.insert_text((NAME_X, y), name, fontname="mont", fontsize=ns, color=TEXT_COLOR)
            page.insert_text((NAME_X, y + 10.5 * scale), zutaten, fontname="mont", fontsize=zs, color=TEXT_COLOR)
        # senkrechte Beschriftung (gedreht um 90 Grad), mittig; Pinselschrift der Karte, falls alle Buchstaben vorhanden
        fname = "active" if set(title) <= active_chars else "bold"
        if fname == "bold":
            print(f"Hinweis: Die Pinselschrift der Karte hat nicht alle Buchstaben fuer '{title}' "
                  "- Ersatzschrift Montserrat Bold.", file=sys.stderr)
        font = pymupdf.Font(fontfile=str(ASSETS / ("Active-Regular.ttf" if fname == "active" else "Montserrat-Bold.ttf")))
        size = LABEL_SIZE if fname == "active" else LABEL_SIZE * 0.8
        w = font.text_length(title, fontsize=size)
        page.insert_text(pymupdf.Point(b["label_x"] + 36.5, b["label_center"] + w / 2), title,
                         fontname=fname, fontsize=size, color=TEXT_COLOR, rotate=90)

    if len(sections) == 2:
        page.draw_line((DIVIDER["x0"], DIVIDER["y"]), (DIVIDER["x1"], DIVIDER["y"]),
                       color=(0, 0, 0), width=DIVIDER["width"])
    doc.set_metadata({"title": titel, "author": "Munich Flavour"})
    doc.save(out_path, garbage=3, deflate=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("projekt", help="Projektnummer oder Teil des Projektnamens")
    ap.add_argument("-k", "--karte", choices=KARTEN, default="cocktails", help="Kartenart (Standard: cocktails)")
    ap.add_argument("-o", "--out", help="Ausgabedatei (Standard: <KARTE>_<Projektname>.pdf)")
    args = ap.parse_args()
    karte = KARTEN[args.karte]

    project = find_project(args.projekt)
    print(f"Projekt: Nr. {project['number']} {project['name'].strip()} ({project['planperiod_start'][:10]})")
    drinks = load_drinks(project["id"], karte["group"])
    if not drinks:
        sys.exit(f"Im Projekt wurden keine Eintraege in der Materialgruppe '{karte['group']}' gefunden.")
    if args.karte == "cocktails":
        cocktails, mocktails = split_menu(drinks)
        sections = [("COCKTAILS", cocktails), ("MOCKTAILS", mocktails)]
    else:
        sections = [(karte["titel"].upper(), [(n.upper(), clean_ingredients(z)) for n, z in drinks])]
    print(", ".join(f"{len(i)} {t.capitalize()}" for t, i in sections))
    out = args.out or karte["datei"] + "_" + re.sub(r"[^\w-]+", "_", project["name"].strip()) + ".pdf"
    render(sections, out, karte["titel"])
    print("Gespeichert:", out)


if __name__ == "__main__":
    main()
