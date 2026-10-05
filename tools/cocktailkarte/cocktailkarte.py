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
# Kartenarten: Rentman-Materialgruppe, Vorlage (assets/<vorlage>) und Layout (pt, A4 595.5 x 842.25).
# Die Werte stammen aus den handgemachten Karten.
KARTEN = {
    "cocktails": dict(
        group="cocktails & longdrinks", datei="COCKTAILS", titel="Cocktails", text_x=176.5,
        bloecke={  # Mitte der Drinkliste, Hoehe des Bereichs, Vertikal-Beschriftung
            "COCKTAILS": dict(center=341, height=330, pitch=45.5, label_x=55, label_center=350),
            "MOCKTAILS": dict(center=666, height=160, pitch=45.5, label_x=58, label_center=669),
        },
        trennlinie=dict(x0=60.1, x1=536.5, y=572.3, width=0.75)),
    "smoothies": dict(
        group="smoothies", datei="SMOOTHIES", titel="Smoothies", text_x=181,
        bloecke={"SMOOTHIES": dict(center=418.5, height=500, pitch=90.7, label_x=55, label_center=421)}),
}
FARBZUSATZ = re.compile(r"\s*\((gelb|gruen|grün|blau|rot|orange|pink|lila|weiss|weiß)\)", re.I)
TEXT_RECHTS = 545  # rechter Rand fuer Drinktexte

# Textkorrekturen fuer Drinks, die nicht in der Stammliste stehen (Rentman -> Karte)
ZUTATEN_ERSETZUNGEN = {
    "absolut wodka": "Wodka",
    "bombay sapphire gin": "Gin",
    "hollunder": "Holunder",
    "minze rohrzucker": "Minze, Rohrzucker",  # fehlendes Komma in Rentman
}
TEXT_COLOR = (0x23 / 255, 0x22 / 255, 0x20 / 255)
NAME_SIZE, ZUTAT_SIZE = 20, 10
LABEL_SIZE = 30
LABEL_SPACING = 1.5  # Buchstabenabstand der senkrechten Beschriftung (pt)
STAMMLISTE = HERE / "stammdaten" / "getraenke.json"


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


def resolve(drinks):
    """[(Rentman-Name, Zutaten)] -> [dict(name, zutaten, alkoholfrei)] mit Texten aus der Stammliste.

    Drinks ohne Stammlisten-Eintrag: Text aus Rentman (bereinigt), Warnung auf stderr.
    """
    stamm = {k: v for k, v in json.load(open(STAMMLISTE, encoding="utf-8")).items() if not k.startswith("_")}
    alkoholisch = {n.lower() for n, _ in drinks if "alkoholfrei" not in n.lower()}
    out = []
    for name, zutaten in drinks:
        eintrag = stamm.get(re.sub(r"\s+", " ", name.lower()).strip())
        if eintrag:
            out.append(dict(name=eintrag["name"].upper(), zutaten=eintrag["zutaten"].upper(),
                            alkoholfrei=bool(eintrag.get("alkoholfrei"))))
            continue
        print(f"Hinweis: '{name}' steht nicht in der Stammliste, Text aus Rentman wird verwendet.", file=sys.stderr)
        frei = "alkoholfrei" in name.lower()
        basis = re.sub(r"\s*\(alkoholfrei\)", "", name, flags=re.I).strip()
        # gleicher Name wie ein alkoholischer Drink (z.B. Hugo) -> "Virgin Hugo"
        anzeige = f"Virgin {basis}" if frei and basis.lower() in alkoholisch else basis
        out.append(dict(name=anzeige.upper(), zutaten=clean_ingredients(zutaten), alkoholfrei=frei))
    return out


# ---------------------------------------------------------------- PDF

def fit_size(font, text, size, x):
    """Verkleinert die Schrift, falls der Text sonst ueber den rechten Rand laeuft."""
    w = font.text_length(text, fontsize=size)
    return size if x + w <= TEXT_RECHTS else size * (TEXT_RECHTS - x) / w


def render(karte, sections, out_path):
    """sections: [(Beschriftung, [(Name, Zutaten), ...]), ...]"""
    cfg = KARTEN[karte]
    sections = [(t, items) for t, items in sections if items]
    adir = ASSETS / karte
    doc = pymupdf.open(adir / "template.pdf")
    page = doc[0]
    x = cfg["text_x"]
    mont = pymupdf.Font(fontfile=str(ASSETS / "Montserrat-Regular.ttf"))
    label = pymupdf.Font(fontfile=str(adir / "label.ttf"))
    page.insert_font("mont", str(ASSETS / "Montserrat-Regular.ttf"))
    page.insert_font("label", str(adir / "label.ttf"))
    page.insert_font("bold", str(ASSETS / "Montserrat-Bold.ttf"))
    label_chars = set(chr(c) for c in label.valid_codepoints())

    for title, items in sections:
        b = cfg["bloecke"][title]
        pitch = min(b["pitch"], b["height"] / len(items))
        scale = min(1.0, pitch / 45.5) ** 0.5
        block_h = pitch * (len(items) - 1) + 32      # von Oberkante Name bis Unterkante Zutatenzeile
        top = b["center"] - block_h / 2
        for i, (name, zutaten) in enumerate(items):
            y = top + i * pitch + 19 * scale
            page.insert_text((x, y), name, fontname="mont", fontsize=fit_size(mont, name, NAME_SIZE * scale, x),
                             color=TEXT_COLOR)
            if zutaten:
                page.insert_text((x, y + 10.5 * scale), zutaten, fontname="mont",
                                 fontsize=fit_size(mont, zutaten, ZUTAT_SIZE * scale, x), color=TEXT_COLOR)
        # senkrechte Beschriftung (gedreht um 90 Grad), mittig; Pinselschrift der Karte, falls alle Buchstaben vorhanden
        use_label = set(title) <= label_chars
        if not use_label:
            print(f"Hinweis: Die Pinselschrift der Vorlage hat nicht alle Buchstaben fuer '{title}' "
                  "- Ersatzschrift Montserrat Bold.", file=sys.stderr)
        font = label if use_label else pymupdf.Font(fontfile=str(ASSETS / "Montserrat-Bold.ttf"))
        size = LABEL_SIZE if use_label else LABEL_SIZE * 0.8
        fname = "label" if use_label else "bold"
        # Zeichen einzeln setzen (Canva-Buchstabenabstand), von unten nach oben, mittig auf label_center
        total = sum(font.text_length(c, fontsize=size) for c in title) + LABEL_SPACING * (len(title) - 1)
        y = b["label_center"] + total / 2
        for c in title:
            page.insert_text(pymupdf.Point(b["label_x"] + 27.5, y), c, fontname=fname, fontsize=size,
                             color=TEXT_COLOR, rotate=90)
            y -= font.text_length(c, fontsize=size) + LABEL_SPACING

    if len(sections) == 2 and cfg.get("trennlinie"):
        t = cfg["trennlinie"]
        page.draw_line((t["x0"], t["y"]), (t["x1"], t["y"]), color=(0, 0, 0), width=t["width"])
    doc.set_metadata({"title": cfg["titel"], "author": "Munich Flavour"})
    doc.save(out_path, garbage=3, deflate=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("projekt", help="Projektnummer oder Teil des Projektnamens")
    ap.add_argument("-k", "--karte", choices=KARTEN, default="cocktails", help="Kartenart (Standard: cocktails)")
    ap.add_argument("-o", "--out", help="Ausgabedatei (Standard: <KARTE>_<Projektname>.pdf)")
    args = ap.parse_args()
    cfg = KARTEN[args.karte]

    project = find_project(args.projekt)
    print(f"Projekt: Nr. {project['number']} {project['name'].strip()} ({project['planperiod_start'][:10]})")
    drinks = resolve(load_drinks(project["id"], cfg["group"]))
    if not drinks:
        sys.exit(f"Im Projekt wurden keine Eintraege in der Materialgruppe '{cfg['group']}' gefunden.")
    if args.karte == "cocktails":
        sections = [("COCKTAILS", [(d["name"], d["zutaten"]) for d in drinks if not d["alkoholfrei"]]),
                    ("MOCKTAILS", [(d["name"], d["zutaten"]) for d in drinks if d["alkoholfrei"]])]
    else:
        sections = [(cfg["titel"].upper(), [(d["name"], d["zutaten"]) for d in drinks])]
    print(", ".join(f"{len(i)} {t.capitalize()}" for t, i in sections))
    out = args.out or cfg["datei"] + "_" + re.sub(r"[^\w-]+", "_", project["name"].strip()) + ".pdf"
    render(args.karte, sections, out)
    print("Gespeichert:", out)


if __name__ == "__main__":
    main()
