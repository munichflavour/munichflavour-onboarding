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
import base64
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pymupdf

from essen import render_essen
from neu import render_neu, render_neu_essen
from schrift import Pinsel, pdf_bytes

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
        trennlinie=dict(x0=60.1, x1=536.5, y=572.3, width=0.75),
        # nur eine Abteilung (z. B. Drinks ohne Mocktails): Liste und Beschriftung mittig auf der Seite
        einzeln=dict(center=452, height=520, pitch=58, label_x=55, label_center=452)),
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
GRUPPE_HEISS = re.compile(r"^(hot\s*drinks?|hei(ß|ss)getränke?|te[ea]\b|tee\b)", re.I)   # gehoeren auf die Kaffeekarte
# Einzelne Positionen, die auf die Kaffeekarte gehoeren, auch wenn sie in Rentman anders einsortiert sind
TEE_MATERIAL = re.compile(r"^(\d+([.,]\d+)?\s*l\s+)?(verschiedene\s+)?te[ea](variationen|sorten)?$", re.I)   # nicht Teeloeffel, Ice Tea
HEISS_MATERIAL = re.compile(r"hot\s*chocolate|hei(ß|ss)e\s+schokolade|trinkschokolade|kakao", re.I)
GRUPPE_COCKTAILIG = re.compile(r"cocktail|^drinks?$", re.I)   # Layout mit Cocktail/Mocktail-Aufteilung
# Gruppennamen, die auf der Karte bewusst kuerzer stehen (bisherige handgemachte Karten)
LABEL_NAMEN = {"cocktails & longdrinks": "COCKTAILS", "cocktails": "COCKTAILS"}
KARTENARTEN = {"getraenke": "Getränke", "kaffee": "Kaffee", "essen": "Essen"}
ZUSATZKARTEN = ["kaffee"]   # in der Oberflaeche trotz fehlender Rentman-Gruppe anforderbar (Standardliste)
KAFFEE_STAMM = HERE / "stammdaten" / "kaffee.json"
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
        for line in (HERE / ".env").read_text(encoding="utf-8-sig").splitlines():
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


def standard_design():
    """Design der Karten: 'alt' (Ananas-Design) oder 'neu' (Rahmen, grosser Titel). Einstellung DESIGN, Standard 'alt'."""
    return "neu" if str(einstellung("DESIGN") or "alt").strip().lower() == "neu" else "alt"


def volle_schrift(name="Active-Regular"):
    """Vollstaendige Schrift ('Active-Regular' fuers alte, 'Agrandir-Black' fuers neue Design), falls vorhanden:
    Einstellung SCHRIFT_DATEI bzw. SCHRIFT_AGRANDIR oder als .otf/.ttf im Datenordner. Die Dateien sind
    urheberrechtlich geschuetzt und liegen bewusst nicht im Repository."""
    schluessel = "SCHRIFT_DATEI" if name == "Active-Regular" else "SCHRIFT_AGRANDIR"
    for kandidat in (einstellung(schluessel), daten_ordner() / f"{name}.otf", daten_ordner() / f"{name}.ttf"):
        if kandidat and Path(kandidat).expanduser().is_file():
            return Path(kandidat).expanduser()
    return None


def daten_ordner():
    """Eigene Daten (Ergaenzungen zur Stammliste): Einstellung DATEN_ORDNER, sonst <Programmordner>/daten.

    Dieser Ordner gehoert dem Anwender und wird von Updates nie ueberschrieben.
    """
    return Path(einstellung("DATEN_ORDNER") or HERE / "daten").expanduser()


def lade_stamm(name):
    """Stammliste `name` (getraenke, speisen): mitgelieferte Eintraege, darueber die eigenen aus dem Datenordner."""
    ergebnis = {}
    for pfad in (HERE / "stammdaten" / f"{name}.json", daten_ordner() / f"{name}.json"):
        if pfad.exists():
            ergebnis.update({k: v for k, v in json.load(open(pfad, encoding="utf-8")).items() if not k.startswith("_")})
    return ergebnis


def speichere_stamm(name, key, eintrag):
    """Schreibt einen Eintrag in die eigene Stammliste (Datenordner). Die mitgelieferte Datei bleibt unveraendert."""
    pfad = daten_ordner() / f"{name}.json"
    try:
        pfad.parent.mkdir(parents=True, exist_ok=True)
        daten = json.load(open(pfad, encoding="utf-8")) if pfad.exists() else {
            "_hinweis": "Eigene Ergaenzungen und Korrekturen aus der Oberflaeche. Hat Vorrang vor stammdaten/%s.json." % name}
        daten[key] = eintrag
        tmp = pfad.with_suffix(".tmp")
        tmp.write_text(json.dumps(daten, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, pfad)
    except OSError as e:
        raise KartenFehler(f"Stammliste konnte nicht gespeichert werden ({pfad}): {e.strerror or e}") from e


def _seite(path, params, offset):
    """Eine Seite (300 Zeilen) der Rentman-API; bei Ueberlastung (429) und Netzfehlern kurz wiederholen."""
    q = urllib.parse.urlencode({**params, "limit": 300, "offset": offset})
    req = urllib.request.Request(f"{API}{path}?{q}", headers={"Authorization": f"Bearer {token()}"})
    for versuch in range(4):
        try:
            return json.load(urllib.request.urlopen(req, timeout=60))["data"]
        except urllib.error.HTTPError as e:
            if e.code == 429 and versuch < 3:
                time.sleep(1.5 * (versuch + 1))
                continue
            raise KartenFehler(f"Rentman antwortet mit Fehler {e.code} (Token gueltig?).") from e
        except (OSError, ValueError) as e:           # URLError, Zeitueberschreitung, Verbindungsabbruch, defekte Antwort
            if versuch < 2:
                time.sleep(1)
                continue
            raise KartenFehler(f"Rentman nicht erreichbar: {getattr(e, 'reason', e)}") from e


def api_get(path, **params):
    """Alle Zeilen einer Liste. Die API nennt keine Gesamtzahl, deshalb werden Seiten in Wellen zu je 4 parallel geholt."""
    rows, offset = [], 0
    with ThreadPoolExecutor(4) as pool:
        while True:
            seiten = list(pool.map(lambda o: _seite(path, params, o), [offset + 300 * i for i in range(4)]))
            for s in seiten:
                rows += s
            if any(len(s) < 300 for s in seiten):
                return rows
            offset += 1200


# Rentman-Status "Bestaetigt" (3) und die Folgestatus Gepackt (4), Am Veranstaltungsort (5), Retour (6)
BESTAETIGT = {3, 4, 5, 6}
def cache_datei():
    """Projektliste-Cache: im Webbetrieb im Datenordner (bleibt bei Neustarts erhalten), sonst <Programmordner>/.cache."""
    return (daten_ordner() / ".cache" if einstellung("DATEN_ORDNER") else HERE / ".cache") / "projekte.json"
CACHE_MAX_ALTER = 600          # Sekunden, danach wird im Hintergrund aktualisiert
_projekte = dict(zeit=0, daten=[], laedt=False, fehler=None)
_sperre = threading.Lock()


def _lade_projekte():
    """Holt Projekte samt Status von Rentman und schreibt den Festplatten-Cache. Den Status fuehrt Rentman am
    Unterprojekt; jedes Projekt hat dort genau eine Zeile."""
    try:
        with ThreadPoolExecutor(3) as pool:
            f_status = pool.submit(api_get, "/statuses")
            f_sub = pool.submit(api_get, "/subprojects", fields="id,project,status")
            f_proj = pool.submit(api_get, "/projects", fields="id,number,name,planperiod_start")
            status = {s["id"]: s["name"] for s in f_status.result()}
            status_von = {sp["project"]: int(sp["status"].split("/")[-1]) if sp["status"] else None
                          for sp in f_sub.result()}
            projekte = f_proj.result()
        for p in projekte:
            sid = status_von.get(f"/projects/{p['id']}")
            p["status_id"], p["status"] = sid, status.get(sid, "ohne Status")
        with _sperre:
            _projekte.update(daten=projekte, zeit=time.time(), fehler=None)
        try:
            cache_datei().parent.mkdir(parents=True, exist_ok=True)
            cache_datei().write_text(json.dumps(dict(zeit=_projekte["zeit"], daten=projekte), ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass                   # Cache ist nur eine Beschleunigung
    except KartenFehler as e:
        _projekte["fehler"] = str(e)
        raise
    finally:
        _projekte["laedt"] = False


def aktualisiere(blockierend=False):
    """Startet die Aktualisierung der Projektliste (im Hintergrund, falls nicht blockierend)."""
    with _sperre:
        if _projekte["laedt"]:
            laeuft = True
        else:
            _projekte["laedt"], laeuft = True, False
    if laeuft:
        while blockierend and _projekte["laedt"]:
            time.sleep(0.2)
        return

    def lauf():
        try:
            _lade_projekte()
        except Exception as e:                     # im Hintergrund nie abstuerzen; Fehler in der Anzeige melden
            _projekte["fehler"] = str(e)
    if blockierend:
        _lade_projekte()
    else:
        threading.Thread(target=lauf, daemon=True).start()


def alle_projekte():
    """Projektliste: sofort aus dem Speicher oder dem Festplatten-Cache, bei Bedarf im Hintergrund aktualisiert."""
    if not _projekte["daten"] and cache_datei().exists():
        try:
            d = json.loads(cache_datei().read_text(encoding="utf-8"))
            _projekte.update(daten=d["daten"], zeit=d["zeit"])
        except (OSError, ValueError, KeyError):
            pass
    if not _projekte["daten"]:
        aktualisiere(blockierend=True)      # allererster Start: warten
    elif time.time() - _projekte["zeit"] > CACHE_MAX_ALTER:
        aktualisiere()                      # veraltet: alte Liste sofort nutzen, neue im Hintergrund holen
    return _projekte["daten"]


def projektliste_stand():
    return dict(stand=_projekte["zeit"], laedt=_projekte["laedt"], anzahl=len(_projekte["daten"]),
                fehler=_projekte["fehler"])


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
    def finde():
        t = [p for p in alle_projekte() if q in (p["name"] or "").lower() or q == str(p["number"])]
        return [p for p in t if p["status_id"] in BESTAETIGT] if nur_bestaetigt else t
    treffer = finde()
    if not treffer and time.time() - _projekte["zeit"] > 30:   # evtl. neu angelegt oder bestaetigt: Liste auffrischen
        aktualisiere(blockierend=True)
        treffer = finde()
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


def norm_key(name):
    """Schluessel fuer die Stammliste: Rentman-Name in Kleinbuchstaben, Leerzeichen vereinheitlicht."""
    return re.sub(r"\s+", " ", name.lower()).strip()


def resolve(drinks):
    """[(Rentman-Name, Zutaten)] -> [dict(key, name, zutaten, alkoholfrei, quelle)] mit Texten aus der Stammliste.

    Drinks ohne Stammlisten-Eintrag: Text aus Rentman (bereinigt), quelle='rentman', eine gesammelte Warnung.
    """
    stamm = lade_stamm("getraenke")
    alkoholisch = {n.lower() for n, _ in drinks if "alkoholfrei" not in n.lower()}
    out, unbekannt = [], []
    for name, zutaten in drinks:
        key = norm_key(name)
        eintrag = stamm.get(key)
        if eintrag:
            out.append(dict(key=key, name=eintrag["name"].upper(), zutaten=eintrag["zutaten"].upper(),
                            alkoholfrei=bool(eintrag.get("alkoholfrei")), quelle="stamm"))
            continue
        unbekannt.append(name)
        frei = "alkoholfrei" in name.lower()
        basis = re.sub(r"\s*\(?alkoholfrei\)?\s*$", "", name, flags=re.I).strip()
        # gleicher Name wie ein alkoholischer Drink (z.B. Hugo) -> "Virgin Hugo"
        anzeige = f"Virgin {basis}" if frei and basis.lower() in alkoholisch else basis
        anzeige = re.sub("hollunder", "Holunder", anzeige, flags=re.I)      # Tippfehler in Rentman-Namen
        out.append(dict(key=key, name=anzeige.upper(), zutaten=clean_ingredients(zutaten), alkoholfrei=frei,
                        quelle="rentman"))
    if unbekannt:
        warn("Nicht in der Stammliste (Text aus Rentman): " + ", ".join(unbekannt))
    return out


def kaffee_abschnitt(name):
    """Abschnitt im neuen Design: COFFEE, HOT DRINKS oder TEA (nach dem Namen des Eintrags)."""
    low = name.lower()
    if re.search(r"\btee\b|\btea\b|teevariation", low):
        return "TEA"
    if re.search(r"chocolate|schokolade|kakao|gl(ü|ue)h|punsch|milch\b", low):
        return "HOT DRINKS"
    return "COFFEE"


def heisse_getraenke(rows, groups):
    """Hot Drinks und Tee, die auf die Kaffeekarte gehoeren: [dict(name, zusatz)] aus Gruppen 'Hot Drinks'/'Tee' und aus
    einzelnen Positionen (Hot Chocolate, Tee), egal in welcher Materialgruppe sie gebucht sind."""
    gefunden = {}
    for gruppe in dict.fromkeys(groups.values()):
        if GRUPPE_HEISS.search(gruppe):
            for p in positionen_aus(rows, groups, gruppe):
                gefunden.setdefault(p["name"].lower(), dict(name=p["name"], zusatz=re.sub(r"\s*/\s*", "/", p["remark"]).strip()))
    for r in rows:
        n = plain(r["name"]).strip()
        if not ((r["quantity"] or 0) > 0 or r["parent"]):
            continue
        if TEE_MATERIAL.search(n):
            gefunden.setdefault("tee", dict(name="Tee", zusatz=""))
        elif HEISS_MATERIAL.search(n) and len(n) < 30:
            gefunden.setdefault("hot chocolate", dict(name="Hot Chocolate", zusatz=""))
    return list(gefunden.values())


def kaffee_aus(rows, groups, gruppe=None, erzwingen=False):
    """[dict(key, name, zusatz, quelle)] der Kaffeekarte. Ohne Rentman-Gruppe 'Kaffee': Standardliste, wenn
    Kaffee-Equipment gebucht ist (oder erzwungen). Hot Drinks und Tee kommen nur auf die Karte, wenn sie im Projekt
    gebucht sind (auch ausserhalb der Kaffee-Gruppe)."""
    stamm = json.load(open(KAFFEE_STAMM, encoding="utf-8"))
    umb = stamm["umbenennung"]
    items, seen = [], set()

    def neu(name, zusatz, quelle, key=None):
        name = umb.get(name.lower(), name).upper()
        if name.lower() in seen:
            return
        seen.add(name.lower())
        items.append(dict(key=key or norm_key(name), name=name, zusatz=zusatz.upper(), quelle=quelle,
                          abschnitt=kaffee_abschnitt(name)))

    for p in positionen_aus(rows, groups, gruppe) if gruppe else []:
        neu(p["name"], re.sub(r"\s*/\s*", "/", p["remark"]).strip(), "rentman", norm_key(p["name"]))
    heiss = heisse_getraenke(rows, groups)
    kaffee_da = bool(items) or erzwingen or any(KAFFEE_MATERIAL.search(plain(r["name"])) for r in rows)
    if not items and kaffee_da:
        warn("In Rentman sind keine Kaffeespezialitaeten gebucht (Gruppe 'Kaffee') - Standardliste wird verwendet.")
        for e in stamm["standard"]:
            if kaffee_abschnitt(e["name"]) == "COFFEE":
                neu(e["name"], e.get("zusatz", ""), "standard")
    if items or heiss:
        for h in heiss:
            neu(h["name"], h["zusatz"], "rentman")
    reihenfolge = [e["name"].upper() for e in stamm["standard"]]
    items.sort(key=lambda i: reihenfolge.index(i["name"]) if i["name"] in reihenfolge else len(reihenfolge))
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
    stamm = lade_stamm("speisen")
    abschnitte, gesehen, unbekannt = {}, set(), []
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
            item = dict(e, key=key, quelle="stamm")
        else:
            unbekannt.append(p["name"])
            low = p["name"].lower()
            item = dict(key=key, quelle="rentman",
                        name=re.sub(r"^\s*-\s*|\s*\([^)]*\)", "", p["name"].split("|")[0]).strip(),
                        beschreibung=p["remark"], allergene=[],
                        ernaehrung="VG" if "vegan" in low else "V" if "vegetarisch" in low else "")
        abschnitte.setdefault(titel, []).append(item)
    if unbekannt:
        warn("Nicht in der Stammliste (Allergene und Ernaehrungsform fehlen, bitte ergaenzen): " + ", ".join(unbekannt))
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
    if name == "cocktails" and len(sections) == 1:
        return name, cfg, [cfg["einzeln"]], None
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
    pinsel, bold_da = Pinsel(page, adir, volle_schrift(), warn), set()

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
            if "bold" not in bold_da:
                bold_da.add("bold")
                page.insert_font("bold", str(ASSETS / "Montserrat-Bold.ttf"))
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
    data = pdf_bytes(doc, warn)
    if out_path is None:
        return data
    Path(out_path).write_bytes(data)


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
        elif GRUPPE_HEISS.search(name):
            continue                      # Hot Drinks / Tee: Teil der Kaffeekarte (kaffee_aus)
        elif GRUPPE_GETRAENK.search(name):
            ergebnis.append((name, "getraenke"))
    return ergebnis


def entwuerfe_aus(project, nur=None):
    """Datenstand jeder Karte des Projekts, noch ohne PDF (zum Bearbeiten in der Oberflaeche).

    Die Beschriftung (`label`) ist der Gruppenname aus Rentman. Rueckgabe: Liste von Entwuerfen
    dict(karte, gruppe, titel, label, [label2, layout], datei, warnungen, items | abschnitte).
    """
    rows, groups = lade_material(project["id"])
    gruppen = kartengruppen(rows, groups)
    if (nur == "kaffee" or not nur) and not any(a == "kaffee" for _, a in gruppen) and \
            (nur == "kaffee" or any(KAFFEE_MATERIAL.search(plain(r["name"])) for r in rows)
             or any(GRUPPE_HEISS.search(g) and positionen_aus(rows, groups, g) for g in set(groups.values()))):
        gruppen.append((None, "kaffee"))      # Kaffee-Equipment gebucht, aber keine Kaffee-Gruppe: Standardliste
    entwuerfe, benutzt = [], set()
    for gruppe, art in gruppen:
        if nur and art != nur:
            continue
        del WARNUNGEN[:]
        titel = gruppe or "Kaffee"
        e = dict(karte=art, gruppe=gruppe, titel=titel, label=label_fuer(titel))
        if art == "essen":
            abschnitte = speisen_aus(rows, groups, gruppe)
            if not abschnitte:
                continue
            warn("Allergene und Ernaehrungsangaben stammen aus der Stammliste, nicht aus Rentman - bitte vor dem "
                 "Druck pruefen.")
            e["abschnitte"] = [dict(titel=a["titel"], items=[dict(i, aktiv=True) for i in a["items"]])
                               for a in abschnitte]
            prefix = "ESSEN"
        elif art == "kaffee":
            items = kaffee_aus(rows, groups, gruppe, erzwingen=bool(nur))
            if not items:
                continue
            e["items"], prefix = [dict(i, aktiv=True) for i in items], "KAFFEE-KARTE"
        else:
            drinks = resolve(drinks_aus(rows, groups, gruppe))
            if not drinks:
                continue
            cocktailig = bool(GRUPPE_COCKTAILIG.search(titel))
            e.update(items=[dict(d, aktiv=True) for d in drinks], layout="zwei" if cocktailig else "auto",
                     label2="MOCKTAILS" if cocktailig else "ALKOHOLFREI")
            prefix = re.sub(r"[^\w]+", "-", e["label"]).strip("-")
        datei = prefix + "_" + re.sub(r"[^\w-]+", "_", project["name"].strip())[:60].strip("_") + ".pdf"
        basis, n = datei[:-4], 1
        while datei in benutzt:       # zwei Gruppen mit gleicher Beschriftung im selben Projekt
            n += 1
            datei = f"{basis}_{n}.pdf"
        benutzt.add(datei)
        e.update(datei=datei, warnungen=list(WARNUNGEN), design=standard_design())
        entwuerfe.append(e)
    return entwuerfe


def datei_fuer(datei, design, karte):
    """Dateiname je Design: im neuen Design mit Zusatz _NEU."""
    stem = re.sub(r"_NEU$", "", Path(datei).stem)
    return stem + ("_NEU" if design == "neu" else "") + ".pdf"


def _buchstaben(text):
    return [b for b in re.findall(r"[A-Za-z]", str(text).upper())]


def render_entwurf(e):
    """PDF aus einem (ggf. bearbeiteten) Entwurf: dict(pdf, anzahl, warnungen). Abgewaehlte Eintraege entfallen."""
    del WARNUNGEN[:]
    aktiv = lambda i: i.get("aktiv", True) and str(i.get("name", "")).strip()
    label = str(e.get("label", "")).strip().upper() or e.get("titel", "").upper()
    design = e.get("design") if e.get("design") in ("alt", "neu") else standard_design()
    datei = datei_fuer(e.get("datei") or "karte.pdf", design, e["karte"])
    if design == "neu" and e["karte"] != "essen":
        if e["karte"] == "kaffee":
            neu_zusatz = json.load(open(KAFFEE_STAMM, encoding="utf-8")).get("neu_zusatz", {})
            je_abschnitt = {}
            for i in e["items"]:
                if aktiv(i):
                    name = str(i["name"]).strip().upper()
                    zusatz = str(i.get("zusatz", "")).strip().upper() or neu_zusatz.get(name.lower(), "").upper()
                    je_abschnitt.setdefault(str(i.get("abschnitt") or "COFFEE").strip().upper(), []).append((name, zusatz))
            rang = lambda t: (["COFFEE", "HOT DRINKS", "TEA"].index(t) if t in ("COFFEE", "HOT DRINKS", "TEA") else 3)
            sections = [(t, je_abschnitt[t]) for t in sorted(je_abschnitt, key=rang)]
        else:
            paar = lambda i: (str(i["name"]).strip().upper(), str(i.get("zutaten", "")).strip().upper())
            mit = [paar(i) for i in e["items"] if aktiv(i) and not i.get("alkoholfrei")]
            frei = [paar(i) for i in e["items"] if aktiv(i) and i.get("alkoholfrei")]
            label2 = str(e.get("label2", "")).strip().upper() or "ALKOHOLFREI"
            sections = [(label, mit), (label2, frei)] if mit and frei else [(label, mit + frei)]
        if not any(i for _, i in sections):
            raise KartenFehler("Kein Eintrag ausgewaehlt.")
        anzahl = ", ".join(f"{len(i)} {t.capitalize()}" for t, i in sections if i)
        pdf = render_neu(sections, ASSETS / "neu", warn, volle_schrift("Agrandir-Black"), e.get("titel", label))
        return dict(pdf=pdf, anzahl=anzahl, warnungen=list(WARNUNGEN), datei=datei)
    if e["karte"] == "essen":
        abschnitte = []
        for a in e["abschnitte"]:
            items = [dict(name=str(i["name"]).strip(), beschreibung=str(i.get("beschreibung", "")).strip(),
                          allergene=_buchstaben(i.get("allergene", "")),
                          ernaehrung=i.get("ernaehrung") if i.get("ernaehrung") in ("V", "VG") else "")
                     for i in a["items"] if aktiv(i)]
            if items:
                abschnitte.append(dict(titel=a["titel"], items=items))
        if not abschnitte:
            raise KartenFehler("Keine Speise ausgewaehlt.")
        anzahl = ", ".join(f"{len(a['items'])} {a['titel'].capitalize()}" for a in abschnitte)
        if design == "neu":
            pdf = render_neu_essen(abschnitte, ASSETS / "neu", warn, volle_schrift("Agrandir-Black"), e.get("titel", label))
        else:
            pdf = render_essen(abschnitte, ASSETS / "essen", warn, volle_schrift())
    else:
        if e["karte"] == "kaffee":
            items = [(str(i["name"]).strip().upper(), str(i.get("zusatz", "")).strip().upper())
                     for i in e["items"] if aktiv(i)]
            sections, layout = [(label, items)], "kaffee"
        else:
            def paar(i):
                return str(i["name"]).strip().upper(), str(i.get("zutaten", "")).strip().upper()
            mit = [paar(i) for i in e["items"] if aktiv(i) and not i.get("alkoholfrei")]
            frei = [paar(i) for i in e["items"] if aktiv(i) and i.get("alkoholfrei")]
            label2 = str(e.get("label2", "")).strip().upper() or "ALKOHOLFREI"
            sections = [(label, mit), (label2, frei)] if mit and frei else [(label, mit + frei)]
            layout = e.get("layout", "auto")
        if not any(i for _, i in sections):
            raise KartenFehler("Kein Eintrag ausgewaehlt.")
        anzahl = ", ".join(f"{len(i)} {t.capitalize()}" for t, i in sections if i)
        pdf = render(layout, sections, e.get("titel", label))
    return dict(pdf=pdf, anzahl=anzahl, warnungen=list(WARNUNGEN), datei=datei)


def bearbeiten_erlaubt():
    """Einstellung BEARBEITEN=aus sperrt das Bearbeiten und Aendern der Stammliste (z. B. auf einem Mitarbeiter-PC)."""
    return str(einstellung("BEARBEITEN") or "an").strip().lower() not in ("aus", "nein", "0", "false", "off")


def merke_in_stammliste(e):
    """Schreibt die als 'merken' markierten Eintraege eines Entwurfs in die eigene Stammliste. Rueckgabe: Anzahl."""
    n = 0
    if not bearbeiten_erlaubt():
        return n
    if e["karte"] == "getraenke":
        for i in e["items"]:
            if i.get("merken") and str(i.get("name", "")).strip():
                eintrag = dict(name=str(i["name"]).strip(), zutaten=str(i.get("zutaten", "")).strip())
                if i.get("alkoholfrei"):
                    eintrag["alkoholfrei"] = True
                speichere_stamm("getraenke", i.get("key") or norm_key(i["name"]), eintrag)
                n += 1
    elif e["karte"] == "essen":
        for a in e["abschnitte"]:
            for i in a["items"]:
                if i.get("merken") and str(i.get("name", "")).strip():
                    speichere_stamm("speisen", i.get("key") or speise_schluessel(i["name"]), dict(
                        name=str(i["name"]).strip(), beschreibung=str(i.get("beschreibung", "")).strip(),
                        allergene=_buchstaben(i.get("allergene", "")),
                        ernaehrung=i.get("ernaehrung") if i.get("ernaehrung") in ("V", "VG") else ""))
                    n += 1
    return n


def erstelle_karten(project, nur=None, design=None):
    """Erzeugt fuer jede passende Materialgruppe des Projekts eine Karte (oder nur die Art `nur`), ohne Bearbeitung.

    Rueckgabe: [dict(karte, gruppe, titel, datei, anzahl, pdf, warnungen)]
    """
    ergebnis = []
    for e in entwuerfe_aus(project, nur):
        if design:
            e["design"] = design
        r = render_entwurf(e)
        ergebnis.append(dict(karte=e["karte"], gruppe=e["gruppe"], titel=e["titel"], datei=r["datei"],
                             anzahl=r["anzahl"], pdf=r["pdf"], warnungen=e["warnungen"] + r["warnungen"]))
    return ergebnis


def lade_einstellungen():
    """Eigene Einstellungen der Oberflaeche (z. B. zuletzt gewaehlter Ordner), gespeichert im Datenordner."""
    try:
        return json.load(open(daten_ordner() / "einstellungen.json", encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def speichere_einstellung(key, wert):
    try:
        daten = lade_einstellungen()
        daten[key] = wert
        pfad = daten_ordner() / "einstellungen.json"
        pfad.parent.mkdir(parents=True, exist_ok=True)
        pfad.write_text(json.dumps(daten, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass                      # nur eine Komfortfunktion


def waehle_ordner(prompt="Ordner fuer die PDF auswaehlen"):
    """Ordner-Auswahldialog (macOS). Rueckgabe: Path, oder None bei Abbruch.

    Der Dialog startet im zuletzt gewaehlten Ordner. Auf anderen Systemen gibt es keinen Dialog; dann wird der
    Standardordner (karten_ordner) verwendet.
    """
    if sys.platform not in ("darwin", "win32"):
        return karten_ordner()
    letzter = lade_einstellungen().get("letzter_ordner")
    dokumente = Path.home() / "Documents"
    start = letzter if letzter and Path(letzter).is_dir() else str(dokumente if dokumente.is_dir() else Path.home())
    if sys.platform == "win32":
        return _waehle_ordner_windows(prompt, start)
    esc = lambda t: t.replace("\\", "\\\\").replace('"', '\\"')
    skript = ['tell application "System Events"', "activate",
              f'set ordner to choose folder with prompt "{esc(prompt)}" default location (POSIX file "{esc(start)}")',
              "return POSIX path of ordner", "end tell"]
    cmd = ["osascript"] + [x for z in skript for x in ("-e", z)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise KartenFehler(f"Der Ordner-Dialog konnte nicht geoeffnet werden: {e}") from e
    if r.returncode != 0:
        if "-128" in r.stderr:                       # Abbrechen
            return None
        raise KartenFehler("Der Ordner-Dialog konnte nicht geoeffnet werden: " + (r.stderr.strip() or "unbekannter Fehler"))
    pfad = Path(r.stdout.strip())
    speichere_einstellung("letzter_ordner", str(pfad))
    return pfad


def _waehle_ordner_windows(prompt, start):
    """Ordner-Dialog unter Windows (PowerShell, kein Python-Tk noetig). Rueckgabe: Path oder None bei Abbruch."""
    q = lambda t: t.replace("'", "''")       # fuer PowerShell-Zeichenketten in einfachen Anfuehrungszeichen
    skript = f"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$fenster = New-Object System.Windows.Forms.Form
$fenster.StartPosition = 'CenterScreen'; $fenster.Opacity = 0; $fenster.ShowInTaskbar = $false; $fenster.TopMost = $true
$fenster.Show(); $fenster.Activate()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '{q(prompt)}'
$dialog.SelectedPath = '{q(start)}'
$dialog.ShowNewFolderButton = $true
$antwort = $dialog.ShowDialog($fenster)
$fenster.Close()
if ($antwort -eq [System.Windows.Forms.DialogResult]::OK) {{ [Console]::Out.Write($dialog.SelectedPath) }}
"""
    cmd = ["powershell", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand",
           base64.b64encode(skript.encode("utf-16-le")).decode()]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=900,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired) as e:
        raise KartenFehler(f"Der Ordner-Dialog konnte nicht geoeffnet werden: {e}") from e
    if r.returncode != 0:
        raise KartenFehler("Der Ordner-Dialog konnte nicht geoeffnet werden: " + (r.stderr.strip()[:300] or "unbekannter Fehler"))
    gewaehlt = r.stdout.strip().lstrip("\ufeff")
    if not gewaehlt:
        return None                                   # Abbrechen
    speichere_einstellung("letzter_ordner", gewaehlt)
    return Path(gewaehlt)


def zeige_im_ordner(pfad):
    """Zeigt die Datei im Dateimanager (Finder, Explorer; sonst der Ordner)."""
    if sys.platform == "darwin":
        subprocess.run(["open", "-R", str(pfad)], check=False)
    elif sys.platform == "win32":
        subprocess.Popen(["explorer", f"/select,{pfad}"])      # explorer meldet immer Fehlercode 1, daher Popen
    else:
        subprocess.Popen(["xdg-open", str(Path(pfad).parent)])


def eindeutiger_pfad(ordner, datei):
    """Pfad im Ordner; existiert die Datei schon, wird ' (2)', ' (3)' ... angehaengt (nichts wird ueberschrieben)."""
    ziel, n = Path(ordner) / datei, 2
    while ziel.exists():
        ziel = Path(ordner) / f"{Path(datei).stem} ({n}){Path(datei).suffix}"
        n += 1
    return ziel


def speichere_pdfs(ordner, dateien):
    """Schreibt [(Dateiname, PDF-Bytes)] in den Ordner (ohne etwas zu ueberschreiben). Rueckgabe: Liste der Pfade."""
    try:
        Path(ordner).mkdir(parents=True, exist_ok=True)
        pfade = []
        for datei, pdf in dateien:
            pfad = eindeutiger_pfad(ordner, datei)
            pfad.write_bytes(pdf)
            pfade.append(pfad)
        return pfade
    except OSError as e:
        raise KartenFehler(f"Konnte nicht in '{ordner}' speichern: {e.strerror or e}. Unter macOS ggf. in den "
                           "Systemeinstellungen > Datenschutz & Sicherheit den Zugriff fuer das Terminal erlauben; unter Windows "
                           "pruefen, ob der Ordner beschreibbar ist.") from e


def karten_ordner():
    """Basisordner fuer fertige Karten: Einstellung KARTEN_ORDNER, sonst ~/Kartengenerator/Karten."""
    return Path(einstellung("KARTEN_ORDNER") or Path.home() / "Kartengenerator" / "Karten").expanduser()


def speichere_karten(project, karten):
    """Legt die PDFs im Projektordner '<Datum> <Projektname> (<Nummer>)' ab; gleiche Namen werden ersetzt.

    Rueckgabe: Liste der Dateipfade. Fehlt der Zugriff auf den Ordner, wird eine KartenFehler-Meldung geworfen.
    """
    sauber = lambda t: re.sub(r"[\\/:*?\"<>|]+", "-", t).strip()
    name = f"{(project.get('planperiod_start') or 'ohne Datum')[:10]} {sauber(project['name'])[:60].rstrip('. ')} ({project['number']})"
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
    ap.add_argument("--design", choices=["alt", "neu"], help="Design der Karten (Standard: Einstellung DESIGN, sonst alt)")
    ap.add_argument("--auch-unbestaetigt", action="store_true", help="auch Projekte mit Status Option/Anfrage/Konzept")
    args = ap.parse_args()
    try:
        project = find_project(args.projekt, nur_bestaetigt=not args.auch_unbestaetigt)
        print(f"Projekt: Nr. {project['number']} {project['name'].strip()} ({(project['planperiod_start'] or 'ohne Datum')[:10]})")
        karten = erstelle_karten(project, args.karte, args.design)
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
