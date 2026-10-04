#!/usr/bin/env python3
"""Erzeugt die Cocktailkarte (PDF) fuer ein Rentman-Projekt.

Aufruf:
    python3 cocktailkarte.py "Böttcher"          # Kundenname / Teil des Projektnamens
    python3 cocktailkarte.py 2480                 # Projektnummer
    python3 cocktailkarte.py 2480 -o karte.pdf

Zugang: Umgebungsvariable RENTMAN_API (API-Token, wird nie ausgegeben).
Abhaengigkeit: pip install pymupdf
"""
import argparse
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
GROUP_NAME = "cocktails & longdrinks"  # Rentman-Materialgruppe mit den Drinks

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
        hits.sort(key=lambda p: p["planperiod_start"], reverse=True)
        print(f"Mehrere Treffer fuer '{query}', es wird das neueste Projekt genommen:", file=sys.stderr)
        for p in hits[:10]:
            print(f"  Nr. {p['number']}  {p['name'].strip()}  ({p['planperiod_start'][:10]})", file=sys.stderr)
    return hits[0]


def plain(text):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text or ""))).strip()


def load_drinks(project_id):
    """Liefert [(Name, Zutatentext)] aller Drinks der Gruppe 'Cocktails & Longdrinks'."""
    rows = api_get(f"/projects/{project_id}/projectequipment")
    groups = {f"/projectequipmentgroup/{g['id']}": g["name"].strip().lower()
              for g in api_get(f"/projects/{project_id}/projectequipmentgroup")}
    blocks = {f"/projectequipment/{r['id']}" for r in rows
              if not r["parent"] and groups.get(r["equipment_group"]) == GROUP_NAME and (r["quantity"] or 0) > 0}
    drinks, seen = [], set()
    for r in rows:
        if r["parent"] not in blocks:
            continue
        name = plain(r["name"])
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

def render(cocktails, mocktails, out_path):
    doc = pymupdf.open(ASSETS / "template.pdf")
    page = doc[0]
    page.insert_font("mont", str(ASSETS / "Montserrat-Regular.ttf"))
    page.insert_font("active", str(ASSETS / "Active-Regular.ttf"))

    for title, items in (("COCKTAILS", cocktails), ("MOCKTAILS", mocktails)):
        if not items:
            continue
        b = BLOCKS[title]
        pitch = min(MAX_PITCH, b["height"] / len(items))
        scale = min(1.0, pitch / MAX_PITCH)
        # Drinks sind vertikal um die Beschriftung zentriert (bei Original-Raster: Name-Basislinie + 20pt = naechster Drink)
        block_h = pitch * (len(items) - 1) + 31
        top = b["center"] - block_h / 2
        for i, (name, zutaten) in enumerate(items):
            y = top + i * pitch + NAME_SIZE * 0.85
            page.insert_text((NAME_X, y), name, fontname="mont", fontsize=NAME_SIZE * scale ** 0.5, color=TEXT_COLOR)
            page.insert_text((NAME_X, y + 10.5 * scale ** 0.5), zutaten, fontname="mont",
                             fontsize=ZUTAT_SIZE * scale ** 0.5, color=TEXT_COLOR)
        # senkrechte Beschriftung, gedreht um 90 Grad, mittig auf label_center
        font = pymupdf.Font(fontfile=str(ASSETS / "Active-Regular.ttf"))
        w = font.text_length(title, fontsize=LABEL_SIZE)
        origin = pymupdf.Point(b["label_x"] + 36.5, b["label_center"] + w / 2)
        page.insert_text(origin, title, fontname="active", fontsize=LABEL_SIZE, color=TEXT_COLOR,
                         rotate=90)

    if cocktails and mocktails:
        page.draw_line((DIVIDER["x0"], DIVIDER["y"]), (DIVIDER["x1"], DIVIDER["y"]),
                       color=(0, 0, 0), width=DIVIDER["width"])
    doc.set_metadata({"title": "Cocktails", "author": "Munich Flavour"})
    doc.save(out_path, garbage=3, deflate=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("projekt", help="Projektnummer oder Teil des Projektnamens")
    ap.add_argument("-o", "--out", help="Ausgabedatei (Standard: COCKTAILS_<Projektname>.pdf)")
    args = ap.parse_args()

    project = find_project(args.projekt)
    print(f"Projekt: Nr. {project['number']} {project['name'].strip()} ({project['planperiod_start'][:10]})")
    drinks = load_drinks(project["id"])
    if not drinks:
        sys.exit("Im Projekt wurden keine Drinks in der Gruppe 'Cocktails & Longdrinks' gefunden.")
    cocktails, mocktails = split_menu(drinks)
    print(f"{len(cocktails)} Cocktails, {len(mocktails)} Mocktails")
    out = args.out or "COCKTAILS_" + re.sub(r"[^\w-]+", "_", project["name"].strip()) + ".pdf"
    render(cocktails, mocktails, out)
    print("Gespeichert:", out)


if __name__ == "__main__":
    main()
