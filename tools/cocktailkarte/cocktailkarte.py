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
import time
import urllib.error
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

class KartenFehler(Exception):
    """Fehler mit verstaendlicher Meldung fuer den Anwender (CLI und Oberflaeche)."""


WARNUNGEN = []


def warn(msg):
    WARNUNGEN.append(msg)
    print("Hinweis:", msg, file=sys.stderr)


def einstellung(name):
    """Wert aus der Umgebung oder aus tools/cocktailkarte/.env (Zeilen der Form NAME=Wert), sonst None."""
    wert = os.environ.get(name) or os.environ.get(name.lower())
    if not wert and (HERE / ".env").exists():
        for line in (HERE / ".env").read_text().splitlines():
            k, _, v = line.partition("=")
            if k.strip().upper() == name:
                wert = v.strip().strip("\"'")
    return wert or None


def token():
    t = einstellung("RENTMAN_API")
    if not t:
        raise KartenFehler("Rentman API-Token fehlt: Datei tools/cocktailkarte/.env mit der Zeile "
                           "RENTMAN_API=<Token> anlegen.")
    return t


def api_get(path, **params):
    rows, offset = [], 0
    while True:
        q = urllib.parse.urlencode({**params, "limit": 300, "offset": offset})
        req = urllib.request.Request(f"{API}{path}?{q}", headers={"Authorization": f"Bearer {token()}"})
        try:
            data = json.load(urllib.request.urlopen(req, timeout=60))["data"]
        except urllib.error.HTTPError as e:
            raise KartenFehler(f"Rentman antwortet mit Fehler {e.code} (Token gueltig?).") from e
        except urllib.error.URLError as e:
            raise KartenFehler(f"Rentman nicht erreichbar: {e.reason}") from e
        rows += data
        if len(data) < 300:
            return rows
        offset += 300


# Rentman-Status "Bestaetigt" (3) und die Folgestatus Gepackt (4), Am Veranstaltungsort (5), Retour (6)
BESTAETIGT = {3, 4, 5, 6}
_projekte = dict(zeit=0, daten=[])


def alle_projekte():
    """Projektliste (id, Nummer, Name, Datum, Status), 10 Minuten zwischengespeichert.

    Den Status fuehrt Rentman am Unterprojekt; jedes Projekt hat dort genau eine Zeile.
    """
    if time.time() - _projekte["zeit"] > 600:
        status = {s["id"]: s["name"] for s in api_get("/statuses")}
        status_von = {sp["project"]: int(sp["status"].split("/")[-1]) if sp["status"] else None
                      for sp in api_get("/subprojects", fields="id,project,status")}
        projekte = api_get("/projects", fields="id,number,name,planperiod_start")
        for p in projekte:
            sid = status_von.get(f"/projects/{p['id']}")
            p["status_id"], p["status"] = sid, status.get(sid, "ohne Status")
        _projekte["daten"], _projekte["zeit"] = projekte, time.time()
    return _projekte["daten"]


def projekt_tag(p):
    """Starttag des Projekts als date, oder None (manche Rentman-Projekte haben kein Datum)."""
    d = (p.get("planperiod_start") or "")[:10]
    return datetime.date.fromisoformat(d) if d else None


def sortiere_nach_datum(projekte):
    """Anstehende Events zuerst (nach Datum), danach vergangene (neueste zuerst), Projekte ohne Datum zuletzt."""
    heute = datetime.date.today()

    def key(p):
        t = projekt_tag(p)
        return (2, 0) if t is None else (t < heute, abs((t - heute).days))
    return sorted(projekte, key=key)


def suche(query, nur_bestaetigt=True):
    q = query.strip().lower()
    if not q:
        return []
    treffer = [p for p in alle_projekte() if q in (p["name"] or "").lower() or q == str(p["number"])]
    if nur_bestaetigt:
        treffer = [p for p in treffer if p["status_id"] in BESTAETIGT]
    return sortiere_nach_datum(treffer)


def nicht_bestaetigt(query):
    """Projekte, die zur Suche passen, aber (noch) nicht bestaetigt sind - fuer den Hinweis in der Oberflaeche."""
    return [p for p in suche(query, nur_bestaetigt=False) if p["status_id"] not in BESTAETIGT]


def anstehende(tage=21):
    heute = datetime.date.today()
    bald = [p for p in alle_projekte()
            if p["status_id"] in BESTAETIGT and projekt_tag(p) and 0 <= (projekt_tag(p) - heute).days <= tage]
    return sortiere_nach_datum(bald)


def find_project(query, nur_bestaetigt=True):
    hits = suche(query, nur_bestaetigt)
    if not hits:
        andere = nicht_bestaetigt(query) if nur_bestaetigt else []
        if andere:
            raise KartenFehler(f"Zu '{query}' gibt es nur nicht bestaetigte Projekte: "
                               + ", ".join(f"{p['name'].strip()} ({p['status']})" for p in andere[:5])
                               + ". Mit --auch-unbestaetigt trotzdem erzeugen.")
        raise KartenFehler(f"Kein Projekt zu '{query}' gefunden.")
    if len(hits) > 1:
        print(f"Mehrere Treffer fuer '{query}', es wird das naechste Event genommen:", file=sys.stderr)
        for p in hits[:10]:
            print(f"  Nr. {p['number']}  {p['name'].strip()}  ({(p['planperiod_start'] or 'ohne Datum')[:10]})", file=sys.stderr)
    return hits[0]


def plain(text):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text or ""))).strip()


def lade_material(project_id):
    """Material und Materialgruppen eines Projekts: (Zeilen, {Gruppen-URL: Gruppenname klein})."""
    rows = api_get(f"/projects/{project_id}/projectequipment")
    groups = {f"/projectequipmentgroup/{g['id']}": g["name"].strip().lower()
              for g in api_get(f"/projects/{project_id}/projectequipmentgroup")}
    return rows, groups


def drinks_aus(rows, groups, group_name):
    """Liefert [(Name, Zutatentext)] aller Drinks der angegebenen Materialgruppe."""
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
            warn(f"Drink '{name}' hat in Rentman keine Zutatenzeile (Bemerkung).")
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
        warn(f"'{name}' steht nicht in der Stammliste, Text aus Rentman wird verwendet.")
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


def render(karte, sections, out_path=None):
    """sections: [(Beschriftung, [(Name, Zutaten), ...]), ...]. Ohne out_path werden die PDF-Bytes zurueckgegeben."""
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
            warn(f"Die Pinselschrift der Vorlage hat nicht alle Buchstaben fuer '{title}' - Ersatzschrift Montserrat Bold.")
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
    if out_path is None:
        return doc.tobytes(garbage=3, deflate=True)
    doc.save(out_path, garbage=3, deflate=True)


def erstelle_karten(project, nur=None):
    """Erzeugt alle Karten, fuer die im Projekt Material gebucht ist (oder nur die Kartenart `nur`).

    Rueckgabe: [dict(karte, titel, datei, anzahl, pdf, warnungen)]
    """
    rows, groups = lade_material(project["id"])
    ergebnis = []
    for karte, cfg in KARTEN.items():
        if nur and karte != nur:
            continue
        del WARNUNGEN[:]
        drinks = resolve(drinks_aus(rows, groups, cfg["group"]))
        if not drinks:
            continue
        if karte == "cocktails":
            sections = [("COCKTAILS", [(d["name"], d["zutaten"]) for d in drinks if not d["alkoholfrei"]]),
                        ("MOCKTAILS", [(d["name"], d["zutaten"]) for d in drinks if d["alkoholfrei"]])]
        else:
            sections = [(cfg["titel"].upper(), [(d["name"], d["zutaten"]) for d in drinks])]
        anzahl = ", ".join(f"{len(i)} {t.capitalize()}" for t, i in sections if i)
        pdf = render(karte, sections)
        datei = cfg["datei"] + "_" + re.sub(r"[^\w-]+", "_", project["name"].strip()).strip("_") + ".pdf"
        ergebnis.append(dict(karte=karte, titel=cfg["titel"], datei=datei, anzahl=anzahl, pdf=pdf,
                             warnungen=list(WARNUNGEN)))
    return ergebnis


def karten_ordner():
    """Basisordner fuer fertige Karten: Einstellung KARTEN_ORDNER, sonst ~/Kartengenerator/Karten."""
    return Path(einstellung("KARTEN_ORDNER") or Path.home() / "Kartengenerator" / "Karten").expanduser()


def speichere_karten(project, karten):
    """Legt die PDFs im Projektordner '<Datum> <Projektname> (<Nummer>)' ab; gleiche Namen werden ersetzt.

    Rueckgabe: Liste der Dateipfade. Fehlt der Zugriff auf den Ordner, wird eine KartenFehler-Meldung geworfen.
    """
    sauber = lambda t: re.sub(r"[\\/:*?\"<>|]+", "-", t).strip()
    name = f"{(project.get('planperiod_start') or 'ohne Datum')[:10]} {sauber(project['name'])} ({project['number']})"
    ordner = karten_ordner() / name
    try:
        ordner.mkdir(parents=True, exist_ok=True)
        pfade = []
        for k in karten:
            pfad = ordner / k["datei"]
            pfad.write_bytes(k["pdf"])
            pfade.append(pfad)
    except OSError as e:
        raise KartenFehler(f"Karten konnten nicht in '{ordner}' gespeichert werden: {e.strerror or e}") from e
    return pfade


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("projekt", help="Projektnummer oder Teil des Projektnamens")
    ap.add_argument("-k", "--karte", choices=list(KARTEN), help="nur diese Kartenart (Standard: alle gebuchten)")
    ap.add_argument("-o", "--out", help="Ausgabedatei (nur zusammen mit --karte)")
    ap.add_argument("--auch-unbestaetigt", action="store_true", help="auch Projekte mit Status Option/Anfrage/Konzept")
    args = ap.parse_args()
    try:
        project = find_project(args.projekt, nur_bestaetigt=not args.auch_unbestaetigt)
        print(f"Projekt: Nr. {project['number']} {project['name'].strip()} ({(project['planperiod_start'] or 'ohne Datum')[:10]})")
        karten = erstelle_karten(project, args.karte)
    except KartenFehler as e:
        sys.exit(str(e))
    if not karten:
        sys.exit("Im Projekt ist weder Cocktail- noch Smoothie-Material gebucht.")
    try:
        if args.out and args.karte:
            Path(args.out).write_bytes(karten[0]["pdf"])
            pfade = [Path(args.out)]
        else:
            pfade = speichere_karten(project, karten)
    except KartenFehler as e:
        sys.exit(str(e))
    for k, pfad in zip(karten, pfade):
        print(f"{k['titel']}: {k['anzahl']} -> {pfad}")


if __name__ == "__main__":
    main()
