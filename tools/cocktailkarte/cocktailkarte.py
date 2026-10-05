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

from essen import render_essen
from schrift import Pinsel

HERE = Path(__file__).parent
ASSETS = HERE / "assets"
API = "https://api.rentman.net"
# Layouts (pt, A4 595.5 x 842.25); die Werte stammen aus den handgemachten Karten. Vorlage = assets/<Layoutname>.
LAYOUTS = {
    "cocktails": dict(  # zwei Bloecke mit Trennlinie (Cocktails + Mocktails)
        text_x=176.5,
        bloecke=[  # Mitte der Drinkliste, Hoehe des Bereichs, Vertikal-Beschriftung
            dict(center=341, height=330, pitch=45.5, label_x=55, label_center=350),
            dict(center=666, height=160, pitch=45.5, label_x=58, label_center=669, label_max=170)],
        trennlinie=dict(x0=60.1, x1=536.5, y=572.3, width=0.75)),
    "smoothies": dict(  # ein Block (Smoothies, Hot Drinks, ...)
        text_x=181,
        bloecke=[dict(center=418.5, height=500, pitch=90.7, label_x=55, label_center=421)]),
    "kaffee": dict(  # Espresso hat eine Zusatzzeile (Einfach/Doppelt): Eintraege mit Zusatz brauchen mehr Platz
        text_x=212,
        bloecke=[dict(center=432, height=490, pitch=54.8, pitch_ohne=45.6, label_x=55, label_center=421)]),
}
# Welche Rentman-Materialgruppe wird zu welcher Karte? Die Beschriftung der Karte ist immer der Gruppenname.
GRUPPE_ESSEN = re.compile(r"^catering\b", re.I)
GRUPPE_KAFFEE = re.compile(r"^(kaffee|coffee)", re.I)
GRUPPE_GETRAENK = re.compile(r"cocktail|longdrink|aperitif|\bdrinks?\b|smoothie|matcha|shake|shot|slush|limonade|"
                             r"hei(ß|ss)getränk", re.I)
GRUPPE_COCKTAILIG = re.compile(r"cocktail|^drinks?$", re.I)   # Layout mit Cocktail/Mocktail-Aufteilung
# Gruppennamen, die auf der Karte bewusst kuerzer stehen (bisherige handgemachte Karten)
LABEL_NAMEN = {"cocktails & longdrinks": "COCKTAILS", "cocktails": "COCKTAILS", "matcha spezialitäten": "MATCHA"}
KARTENARTEN = {"getraenke": "Getränke", "kaffee": "Kaffee", "essen": "Essen"}
ZUSATZKARTEN = ["kaffee"]   # in der Oberflaeche trotz fehlender Rentman-Gruppe anforderbar (Standardliste)
KAFFEE_STAMM = HERE / "stammdaten" / "kaffee.json"
SPEISEN_STAMM = HERE / "stammdaten" / "speisen.json"
# Rentman-Blockname (klein, ohne Doppelpunkt) -> Ueberschrift auf der Essenkarte
SPEISEN_ABSCHNITTE = {"canapés": "CANAPÉS", "brotzeit spezialitäten": "BROTZEIT", "speisen im weckglas": "SALATE",
                      "dessert im weckglas": "DESSERT"}
ABSCHNITT_REIHENFOLGE = ["SALATE", "CANAPÉS", "BROTZEIT"]  # Rest danach, DESSERT immer zuletzt
KAFFEE_MATERIAL = re.compile(r"siebträger|kaffeebar|barista|kiste kaffee|^kaffee\b", re.I)
FARBZUSATZ = re.compile(r"\s*\(((hell|dunkel)?(gelb|gruen|grün|blau|rot|orange|pink|rosa?|lila|violett|weiss|weiß|türkis|magenta|braun|schwarz|gold|silber|grau|beige|petrol|flieder)|[^)]*\bfarbe)\)", re.I)  # Farbhinweis im Namen, z. B. "(gelb)"
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
    """Material und Materialgruppen eines Projekts: (Zeilen, {Gruppen-URL: Gruppenname})."""
    rows = api_get(f"/projects/{project_id}/projectequipment")
    groups = {f"/projectequipmentgroup/{g['id']}": g["name"].strip()
              for g in api_get(f"/projects/{project_id}/projectequipmentgroup")}
    return rows, groups


def positionen_aus(rows, groups, group_name):
    """Eintraege (unter den Bloecken mit Menge > 0) einer Materialgruppe: [dict(block, name, remark)]."""
    bloecke = {f"/projectequipment/{r['id']}": plain(r["name"]) for r in rows
               if not r["parent"] and groups.get(r["equipment_group"], "").lower() == group_name.lower()
               and (r["quantity"] or 0) > 0}
    return [dict(block=bloecke[r["parent"]], name=plain(r["name"]), remark=plain(r["external_remark"]))
            for r in rows if r["parent"] in bloecke]


def drinks_aus(rows, groups, group_name):
    """Liefert [(Name, Zutatentext)] aller Drinks der angegebenen Materialgruppe."""
    drinks, seen = [], set()
    for p in positionen_aus(rows, groups, group_name):
        name = FARBZUSATZ.sub("", p["name"])  # "Chia Mango (gelb)" und "Chia Mango" sind derselbe Drink
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        if not p["remark"]:
            warn(f"Drink '{name}' hat in Rentman keine Zutatenzeile (Bemerkung).")
        drinks.append((name, p["remark"]))
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
    out, unbekannt = [], []
    for name, zutaten in drinks:
        eintrag = stamm.get(re.sub(r"\s+", " ", name.lower()).strip())
        if eintrag:
            out.append(dict(name=eintrag["name"].upper(), zutaten=eintrag["zutaten"].upper(),
                            alkoholfrei=bool(eintrag.get("alkoholfrei"))))
            continue
        unbekannt.append(name)
        frei = "alkoholfrei" in name.lower()
        basis = re.sub(r"\s*\(?alkoholfrei\)?\s*$", "", name, flags=re.I).strip()
        # gleicher Name wie ein alkoholischer Drink (z.B. Hugo) -> "Virgin Hugo"
        anzeige = f"Virgin {basis}" if frei and basis.lower() in alkoholisch else basis
        out.append(dict(name=anzeige.upper(), zutaten=clean_ingredients(zutaten), alkoholfrei=frei))
    if unbekannt:
        warn("Nicht in der Stammliste (Text aus Rentman): " + ", ".join(unbekannt))
    return out


def kaffee_aus(rows, groups, gruppe=None, erzwingen=False):
    """[(Name, Zusatz)] der Kaffeekarte. Ohne Rentman-Gruppe 'Kaffee': Standardliste, wenn Kaffee-Equipment gebucht ist."""
    stamm = json.load(open(KAFFEE_STAMM, encoding="utf-8"))
    umb = stamm["umbenennung"]
    items, seen = [], set()
    for p in positionen_aus(rows, groups, gruppe) if gruppe else []:
        if p["name"].lower() in seen:
            continue
        seen.add(p["name"].lower())
        zusatz = re.sub(r"\s*/\s*", "/", p["remark"]).strip()
        items.append((umb.get(p["name"].lower(), p["name"]).upper(), zusatz.upper()))
    reihenfolge = [e["name"].upper() for e in stamm["standard"]]
    items.sort(key=lambda i: reihenfolge.index(i[0]) if i[0] in reihenfolge else len(reihenfolge))  # stabil
    if not items and (erzwingen or any(KAFFEE_MATERIAL.search(plain(r["name"])) for r in rows)):
        warn("In Rentman sind keine Kaffeespezialitaeten gebucht (Gruppe 'Kaffee') - Standardliste wird verwendet.")
        items = [(e["name"].upper(), e.get("zusatz", "").upper()) for e in stamm["standard"]]
    return items


def speise_schluessel(name):
    n = name.split("|")[0]
    n = re.sub(r"\([^)]*\)", "", n)
    n = re.sub(r"[“”„\"'`´]", "", n)
    n = re.sub(r"^\s*-\s*", "", n)
    n = re.sub(r"\s*-\s*", "-", n)
    n = re.sub(r"\s+im glas\s*$", "", n.strip(), flags=re.I)
    return re.sub(r"\s+", " ", n).strip().lower()


def speisen_aus(rows, groups, gruppe):
    """Abschnitte der Essenkarte: [dict(titel, items)] mit Texten, Allergenen und Ernaehrungsform aus der Stammliste."""
    stamm = {k: v for k, v in json.load(open(SPEISEN_STAMM, encoding="utf-8")).items() if not k.startswith("_")}
    abschnitte, gesehen = {}, set()
    for p in positionen_aus(rows, groups, gruppe):
        blockname = re.sub(r"\s+", " ", p["block"].lower().rstrip(": ")).strip()
        titel = SPEISEN_ABSCHNITTE.get(blockname)
        if not titel:
            titel = p["block"].rstrip(": ").upper()
            warn(f"Unbekannter Catering-Block '{p['block']}' - wird als eigener Abschnitt '{titel}' gesetzt.")
        key = speise_schluessel(p["name"])
        if (titel, key) in gesehen:
            continue
        gesehen.add((titel, key))
        e = stamm.get(key)
        if e:
            item = dict(e)
        else:
            warn(f"Speise '{p['name']}' steht nicht in der Stammliste: Text aus Rentman, Allergene und "
                 "Ernaehrungsform fehlen - bitte ergaenzen.")
            low = p["name"].lower()
            item = dict(name=re.sub(r"^\s*-\s*|\s*\([^)]*\)", "", p["name"].split("|")[0]).strip(),
                        beschreibung=p["remark"], allergene=[],
                        ernaehrung="VG" if "vegan" in low else "V" if "vegetarisch" in low else "")
        abschnitte.setdefault(titel, []).append(item)
    rang = lambda t: (2 if t == "DESSERT" else ABSCHNITT_REIHENFOLGE.index(t) if t in ABSCHNITT_REIHENFOLGE else 1, t)
    return [dict(titel=t, items=abschnitte[t]) for t in sorted(abschnitte, key=rang)]


# ---------------------------------------------------------------- PDF

def fit_size(font, text, size, x):
    """Verkleinert die Schrift, falls der Text sonst ueber den rechten Rand laeuft."""
    w = font.text_length(text, fontsize=size)
    return size if x + w <= TEXT_RECHTS else size * (TEXT_RECHTS - x) / w


def layout_fuer(layout, sections):
    """(Vorlagenordner, Konfiguration, Block-Konfigurationen je Abschnitt, Trennlinie).

    layout: "zwei" (Cocktail-Layout), "eins" (Smoothie-Layout), "kaffee" oder "auto" (je nach Abschnittszahl).
    """
    name = {"zwei": "cocktails", "eins": "smoothies", "kaffee": "kaffee",
            "auto": "cocktails" if len(sections) == 2 else "smoothies"}[layout]
    cfg = LAYOUTS[name]
    return name, cfg, cfg["bloecke"][:len(sections)], cfg.get("trennlinie")


def render(layout, sections, titel, out_path=None):
    """sections: [(Beschriftung, [(Name, Zutaten), ...]), ...]. Ohne out_path werden die PDF-Bytes zurueckgegeben."""
    sections = [(t, items) for t, items in sections if items]
    vorlage, cfg, bloecke, trennlinie = layout_fuer(layout, sections)
    adir = ASSETS / vorlage
    doc = pymupdf.open(adir / "template.pdf")
    page = doc[0]
    x = cfg["text_x"]
    mont = pymupdf.Font(fontfile=str(ASSETS / "Montserrat-Regular.ttf"))
    bold = pymupdf.Font(fontfile=str(ASSETS / "Montserrat-Bold.ttf"))
    page.insert_font("mont", str(ASSETS / "Montserrat-Regular.ttf"))
    page.insert_font("bold", str(ASSETS / "Montserrat-Bold.ttf"))
    pinsel = Pinsel(page, adir)

    for (title, items), b in zip(sections, bloecke):
        # Abstand pro Eintrag: mit Zusatzzeile 'pitch', ohne Zusatzzeile 'pitch_ohne' (Standard: gleich)
        adv = [b["pitch"] if z else b.get("pitch_ohne", b["pitch"]) for _, z in items]
        letzte_h = 32 if items[-1][1] else 24
        gesamt = sum(adv[:-1]) + letzte_h
        f = min(1.0, b["height"] / gesamt)
        adv = [a * f for a in adv]
        scale = min(1.0, adv[0] / 45.5) ** 0.5 if f < 1 else 1.0
        top = b["center"] - (sum(adv[:-1]) + letzte_h * f) / 2
        y_pos = top
        for i, (name, zutaten) in enumerate(items):
            y = y_pos + 19 * scale
            page.insert_text((x, y), name, fontname="mont", fontsize=fit_size(mont, name, NAME_SIZE * scale, x),
                             color=TEXT_COLOR)
            if zutaten:
                page.insert_text((x, y + 10.5 * scale), zutaten, fontname="mont",
                                 fontsize=fit_size(mont, zutaten, ZUTAT_SIZE * scale, x), color=TEXT_COLOR)
            y_pos += adv[i]
        # senkrechte Beschriftung (um 90 Grad gedreht), mittig; Pinselschrift der Karte, falls alle Buchstaben vorhanden
        bx = b["label_x"] + 27.5
        if pinsel.kann(title):
            size = LABEL_SIZE
            laenge = pinsel.laenge(title, size, LABEL_SPACING)
            if laenge > b.get("label_max", 300):          # lange Beschriftung verkleinern
                size = size * b.get("label_max", 300) / laenge
                laenge = pinsel.laenge(title, size, LABEL_SPACING)
            pinsel.schreibe(bx, b["label_center"] + laenge / 2, title, size, LABEL_SPACING, TEXT_COLOR, vertikal=True)
        else:
            warn(f"Die Pinselschrift hat nicht alle Buchstaben fuer '{title}' - Ersatzschrift Montserrat Bold.")
            size = LABEL_SIZE * 0.8
            laenge = sum(bold.text_length(c, fontsize=size) for c in title) + LABEL_SPACING * (len(title) - 1)
            y = b["label_center"] + laenge / 2
            for c in title:
                page.insert_text(pymupdf.Point(bx, y), c, fontname="bold", fontsize=size, color=TEXT_COLOR, rotate=90)
                y -= bold.text_length(c, fontsize=size) + LABEL_SPACING

    if len(sections) == 2 and trennlinie:
        t = trennlinie
        page.draw_line((t["x0"], t["y"]), (t["x1"], t["y"]), color=(0, 0, 0), width=t["width"])
    doc.set_metadata({"title": titel, "author": "Munich Flavour"})
    if out_path is None:
        return doc.tobytes(garbage=3, deflate=True)
    doc.save(out_path, garbage=3, deflate=True)


def label_fuer(gruppe):
    """Beschriftung der Karte = Rentman-Gruppenname (Grossbuchstaben, ohne Zusatz '-optional-')."""
    n = re.sub(r"\s*-?\s*optional\s*-?\s*$", "", gruppe, flags=re.I).strip()
    return LABEL_NAMEN.get(n.lower(), n.upper())


def kartengruppen(rows, groups):
    """[(Gruppenname, Art)] der Materialgruppen mit gebuchten Eintraegen, die eine Karte ergeben (Reihenfolge wie Rentman)."""
    ergebnis = []
    for name in dict.fromkeys(groups.values()):
        if not positionen_aus(rows, groups, name):
            continue
        if GRUPPE_ESSEN.search(name):
            ergebnis.append((name, "essen"))
        elif GRUPPE_KAFFEE.search(name):
            ergebnis.append((name, "kaffee"))
        elif GRUPPE_GETRAENK.search(name):
            ergebnis.append((name, "getraenke"))
    return ergebnis


def erstelle_karten(project, nur=None):
    """Erzeugt fuer jede passende Materialgruppe des Projekts eine Karte (oder nur die Art `nur`).

    Die Beschriftung ist der Gruppenname aus Rentman. Rueckgabe:
    [dict(karte, gruppe, titel, datei, anzahl, pdf, warnungen)]
    """
    rows, groups = lade_material(project["id"])
    gruppen = kartengruppen(rows, groups)
    if (nur == "kaffee" or not nur) and not any(a == "kaffee" for _, a in gruppen) and \
            (nur == "kaffee" or any(KAFFEE_MATERIAL.search(plain(r["name"])) for r in rows)):
        gruppen.append((None, "kaffee"))      # Kaffee-Equipment gebucht, aber keine Kaffee-Gruppe: Standardliste
    ergebnis, benutzt = [], set()
    for gruppe, art in gruppen:
        if nur and art != nur:
            continue
        del WARNUNGEN[:]
        titel = gruppe or "Kaffee"
        label = label_fuer(titel)
        if art == "essen":
            abschnitte = speisen_aus(rows, groups, gruppe)
            if not abschnitte:
                continue
            warn("Allergene und Ernaehrungsangaben stammen aus der Stammliste (stammdaten/speisen.json), nicht aus "
                 "Rentman - bitte vor dem Druck pruefen.")
            anzahl = ", ".join(f"{len(a['items'])} {a['titel'].capitalize()}" for a in abschnitte)
            pdf = render_essen(abschnitte, ASSETS / "essen", warn)
            prefix = "ESSEN"
        else:
            if art == "kaffee":
                sections, layout, prefix = [(label, kaffee_aus(rows, groups, gruppe, erzwingen=bool(nur)))], "kaffee", "KAFFEE-KARTE"
            else:
                drinks = resolve(drinks_aus(rows, groups, gruppe))
                cocktailig = bool(GRUPPE_COCKTAILIG.search(titel))
                mit = [(d["name"], d["zutaten"]) for d in drinks if not d["alkoholfrei"]]
                frei = [(d["name"], d["zutaten"]) for d in drinks if d["alkoholfrei"]]
                zweit = "MOCKTAILS" if cocktailig else "ALKOHOLFREI"
                sections = [(label, mit), (zweit, frei)] if mit and frei else [(label, mit + frei)]
                layout, prefix = ("zwei" if cocktailig else "auto"), re.sub(r"[^\w]+", "-", label).strip("-")
            if not any(i for _, i in sections):
                continue
            anzahl = ", ".join(f"{len(i)} {t.capitalize()}" for t, i in sections if i)
            pdf = render(layout, sections, titel)
        datei = prefix + "_" + re.sub(r"[^\w-]+", "_", project["name"].strip()).strip("_") + ".pdf"
        basis, n = datei[:-4], 1
        while datei in benutzt:       # zwei Gruppen mit gleicher Beschriftung im selben Projekt
            n += 1
            datei = f"{basis}_{n}.pdf"
        benutzt.add(datei)
        ergebnis.append(dict(karte=art, gruppe=gruppe, titel=titel, datei=datei, anzahl=anzahl, pdf=pdf,
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
    ap.add_argument("-k", "--karte", choices=list(KARTENARTEN), help="nur diese Kartenart (Standard: alle gebuchten)")
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
        sys.exit("Im Projekt ist kein Getränke-, Kaffee- oder Catering-Material gebucht, das eine Karte ergibt.")
    try:
        if args.out and len(karten) == 1:
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
