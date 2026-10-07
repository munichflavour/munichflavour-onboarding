#!/usr/bin/env python3
"""Lokale Oberflaeche fuer den Kartengenerator: Projekt waehlen, Karten pruefen und bearbeiten, PDF speichern.

Start: python3 app.py   (oeffnet http://127.0.0.1:8765 im Browser; lauscht nur auf diesem Rechner)
"""
import base64
import json
import os
import re
import sys
import threading
import uuid
from collections import OrderedDict
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pymupdf

import cocktailkarte as ck

HOST, PORT = "127.0.0.1", 8765
UI = Path(__file__).parent / "ui"
LOCK = threading.Lock()  # Warnungs-Sammler im Kartenmodul ist nicht threadsicher
MAX_EINTRAEGE = 120
PDFS = OrderedDict()      # Token -> (Dateiname, PDF-Bytes) der letzten Vorschau, fuer 'PDF downloaden'
GESPEICHERT = set()       # Pfade, die diese Sitzung gespeichert hat (nur diese darf 'Im Finder zeigen' oeffnen)


def projekt_json(p):
    return dict(id=p["id"], nummer=p["number"], name=(p["name"] or "").strip(), datum=(p["planperiod_start"] or "")[:10])


def pruefe_entwurf(e):
    """Prueft einen vom Browser gelieferten Entwurf auf Form und Groesse und bereinigt den Dateinamen."""
    if not isinstance(e, dict) or e.get("karte") not in ck.KARTENARTEN:
        raise ck.KartenFehler("Ungueltiger Entwurf.")
    gruppen = [a.get("items") for a in e["abschnitte"]] if e["karte"] == "essen" and isinstance(e.get("abschnitte"), list) \
        else [e.get("items")]
    if sum(len(g) for g in gruppen if isinstance(g, list)) > MAX_EINTRAEGE or \
            not all(isinstance(g, list) and all(isinstance(i, dict) for i in g) for g in gruppen):
        raise ck.KartenFehler("Ungueltiger Entwurf (Eintraege).")
    if e.get("design") not in ("alt", "neu"):
        e["design"] = ck.standard_design()
    name = re.sub(r"[\\/:*?\"<>|]+", "-", Path(str(e.get("datei") or "karte.pdf")).name)
    e["datei"] = name if name.lower().endswith(".pdf") else name + ".pdf"
    return e


def vorschau_png(pdf):
    return pymupdf.open(stream=pdf, filetype="pdf")[0].get_pixmap(dpi=80).tobytes("png")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def senden(self, status, body, ctype="application/json; charset=utf-8", headers=None):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        try:
            if url.path == "/":
                self.senden(200, (UI / "index.html").read_bytes(), "text/html; charset=utf-8")
            elif url.path == "/schrift.ttf":
                self.senden(200, (ck.ASSETS / "cocktails" / "label.ttf").read_bytes(), "font/ttf")
            elif url.path == "/api/suche":
                q = urllib.parse.parse_qs(url.query).get("q", [""])[0]
                treffer = ck.suche(q)
                andere = [] if treffer else ck.nicht_bestaetigt(q)
                self.senden(200, dict(projekte=[projekt_json(p) for p in treffer],
                                      andere=[dict(projekt_json(p), status=p["status"]) for p in andere[:5]]))
            elif url.path == "/api/anstehende":
                self.senden(200, dict(projekte=[projekt_json(p) for p in ck.anstehende()]))
            elif url.path == "/api/einstellungen":
                self.senden(200, dict(bearbeiten=ck.bearbeiten_erlaubt(), plattform=sys.platform, design=ck.standard_design()))
            elif url.path == "/api/stand":
                self.senden(200, ck.projektliste_stand())
            elif url.path == "/api/pdf":
                token = urllib.parse.parse_qs(url.query).get("t", [""])[0]
                if token not in PDFS:
                    return self.senden(404, dict(fehler="Die Vorschau ist abgelaufen, bitte die Karte neu laden."))
                datei, pdf = PDFS[token]
                self.senden(200, pdf, "application/pdf", {
                    "Content-Disposition": "attachment; filename=\"karte.pdf\"; filename*=UTF-8''" + urllib.parse.quote(datei)})
            else:
                self.senden(404, dict(fehler="Nicht gefunden"))
        except ck.KartenFehler as e:
            self.senden(400, dict(fehler=str(e)))

    def do_POST(self):
        try:
            if self.path == "/api/aktualisieren":
                ck.aktualisiere()
                return self.senden(200, ck.projektliste_stand())
            if self.path == "/api/entwurf":
                return self.entwurf()
            if self.path == "/api/vorschau":
                return self.vorschau()
            if self.path == "/api/speichern":
                return self.speichern()
            if self.path == "/api/merken":
                return self.merken()
            if self.path == "/api/zeigen":
                return self.zeigen()
            self.senden(404, dict(fehler="Nicht gefunden"))
        except ck.KartenFehler as e:
            self.senden(400, dict(fehler=str(e)))
        except (KeyError, TypeError, ValueError) as e:
            self.senden(400, dict(fehler=f"Ungueltige Anfrage: {e}"))
        except Exception as e:  # unerwartet: Meldung statt Absturz
            self.senden(500, dict(fehler=f"Unerwarteter Fehler: {e}"))

    def projekt(self, pid):
        p = next((p for p in ck.alle_projekte() if p["id"] == pid), None)
        if not p:
            raise ck.KartenFehler("Projekt nicht gefunden.")
        return p

    def entwurf(self):
        """Datenstand der Karten eines Projekts (ohne PDF), zum Bearbeiten."""
        b = self.body()
        nur = b.get("nur")
        if nur and nur not in ck.KARTENARTEN:
            raise ck.KartenFehler("Unbekannte Kartenart.")
        projekt = self.projekt(b["id"])
        with LOCK:
            entwuerfe = ck.entwuerfe_aus(projekt, nur)
        if nur and not entwuerfe:
            raise ck.KartenFehler(f"Für dieses Projekt ist kein Material für die Karte '{ck.KARTENARTEN[nur]}' gebucht.")
        self.senden(200, dict(projekt=projekt_json(projekt), entwuerfe=entwuerfe,
                              arten=[dict(karte=k, titel=ck.KARTENARTEN[k] + "karte (Standardliste)")
                                     for k in ck.ZUSATZKARTEN]))

    def vorschau(self):
        e = pruefe_entwurf(self.body()["entwurf"])
        with LOCK:
            r = ck.render_entwurf(e)
        token = uuid.uuid4().hex
        PDFS[token] = (r["datei"], r["pdf"])
        while len(PDFS) > 60:
            PDFS.popitem(last=False)
        self.senden(200, dict(png=base64.b64encode(vorschau_png(r["pdf"])).decode(), anzahl=r["anzahl"],
                              warnungen=r["warnungen"], token=token, datei=r["datei"]))

    def merken(self):
        """Traegt die markierten Eintraege in die eigene Stammliste ein (auch beim Download aufgerufen)."""
        e = pruefe_entwurf(self.body()["entwurf"])
        with LOCK:
            self.senden(200, dict(gemerkt=ck.merke_in_stammliste(e)))

    def speichern(self):
        """Ordner waehlen (Dialog), PDFs der Entwuerfe dort ablegen und markierte Eintraege in die Stammliste merken."""
        entwuerfe = [pruefe_entwurf(e) for e in self.body()["entwuerfe"]]
        if not entwuerfe or len(entwuerfe) > 20:
            raise ck.KartenFehler("Keine Karte zum Speichern.")
        ordner = ck.waehle_ordner("Ordner fuer " + ("die PDF" if len(entwuerfe) == 1 else "die PDFs") + " auswaehlen")
        if ordner is None:
            return self.senden(200, dict(abgebrochen=True))
        with LOCK:
            renders = [ck.render_entwurf(e) for e in entwuerfe]
            pfade = ck.speichere_pdfs(ordner, [(r["datei"], r["pdf"]) for r in renders])
            gemerkt, fehler = 0, None
            try:
                gemerkt = sum(ck.merke_in_stammliste(e) for e in entwuerfe)
            except ck.KartenFehler as ex:
                fehler = str(ex)
        GESPEICHERT.update(os.path.normcase(str(p.resolve())) for p in pfade)
        self.senden(200, dict(ordner=str(ordner), gemerkt=gemerkt, speicherfehler=fehler, dateien=[
            dict(datei=p.name, pfad=str(p), umbenannt=p.name != r["datei"]) for p, r in zip(pfade, renders)]))

    def zeigen(self):
        """Zeigt eine in dieser Sitzung gespeicherte Karte im Finder."""
        pfad = Path(self.body()["pfad"]).resolve()
        if os.path.normcase(str(pfad)) not in GESPEICHERT or not pfad.is_file():
            return self.senden(400, dict(fehler="Datei nicht gefunden."))
        ck.zeige_im_ordner(pfad)
        self.senden(200, dict(ok=True))


def main():
    url = f"http://{HOST}:{PORT}"
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:                       # Port belegt: laeuft der Kartengenerator vielleicht schon?
        try:
            urllib.request.urlopen(url + "/api/einstellungen", timeout=3).read()
        except (OSError, urllib.error.URLError):
            sys.exit(f"Der Port {PORT} ist von einem anderen Programm belegt. Bitte dieses Programm beenden und neu starten.")
        print("Der Kartengenerator laeuft bereits - der Browser wird geoeffnet.")
        webbrowser.open(url)
        return
    print(f"Kartengenerator laeuft auf {url}  (beenden mit Ctrl+C)")

    def vorwaermen():          # Projektliste schon beim Start laden (aus dem Cache sofort)
        try:
            ck.alle_projekte()
        except ck.KartenFehler:
            pass
    threading.Thread(target=vorwaermen, daemon=True).start()
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
