#!/usr/bin/env python3
"""Lokale Oberflaeche fuer den Kartengenerator: Projektname eingeben, Karten erzeugen lassen.

Start: python3 app.py   (oeffnet http://127.0.0.1:8765 im Browser; lauscht nur auf diesem Rechner)
"""
import base64
import json
import subprocess
import sys
import threading
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pymupdf

import cocktailkarte as ck

HOST, PORT = "127.0.0.1", 8765
UI = Path(__file__).parent / "ui"
LOCK = threading.Lock()  # Warnungs-Sammler im Kartenmodul ist nicht threadsicher


def projekt_json(p):
    return dict(id=p["id"], nummer=p["number"], name=(p["name"] or "").strip(), datum=(p["planperiod_start"] or "")[:10])


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def senden(self, status, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

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
            else:
                self.senden(404, dict(fehler="Nicht gefunden"))
        except ck.KartenFehler as e:
            self.senden(400, dict(fehler=str(e)))

    def do_POST(self):
        if self.path not in ("/api/karten", "/api/zeigen"):
            return self.senden(404, dict(fehler="Nicht gefunden"))
        if self.path == "/api/zeigen":
            return self.zeigen()
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            pid, nur = body["id"], body.get("nur")
            if nur and nur not in ck.KARTEN:
                raise ck.KartenFehler("Unbekannte Kartenart.")
            projekt = next((p for p in ck.alle_projekte() if p["id"] == pid), None)
            if not projekt:
                raise ck.KartenFehler("Projekt nicht gefunden.")
            with LOCK:
                karten = ck.erstelle_karten(projekt, nur)
            if nur and not karten:
                raise ck.KartenFehler(f"Für dieses Projekt ist kein Material für die Karte "
                                      f"'{ck.KARTEN[nur]['titel']}' gebucht.")
            try:
                pfade = [str(p) for p in ck.speichere_karten(projekt, karten)] if karten else []
                speicherfehler = None
            except ck.KartenFehler as e:  # Karten trotzdem anzeigen, nur den Speicherfehler melden
                pfade, speicherfehler = [None] * len(karten), str(e)
            out = []
            for k, pfad in zip(karten, pfade):
                png = pymupdf.open(stream=k["pdf"], filetype="pdf")[0].get_pixmap(dpi=80).tobytes("png")
                out.append(dict(karte=k["karte"], titel=k["titel"], datei=k["datei"], anzahl=k["anzahl"],
                                warnungen=k["warnungen"], pfad=pfad, pdf=base64.b64encode(k["pdf"]).decode(),
                                png=base64.b64encode(png).decode()))
            self.senden(200, dict(projekt=projekt_json(projekt), karten=out, speicherfehler=speicherfehler,
                                  arten=[dict(karte=k, titel=c["titel"]) for k, c in ck.KARTEN.items()]))
        except ck.KartenFehler as e:
            self.senden(400, dict(fehler=str(e)))
        except Exception as e:  # unerwartet: Meldung statt Absturz
            self.senden(500, dict(fehler=f"Unerwarteter Fehler: {e}"))


    def zeigen(self):
        """Zeigt eine gespeicherte Karte im Finder (nur Dateien unterhalb des Karten-Ordners)."""
        try:
            pfad = Path(json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))["pfad"]).resolve()
            if ck.karten_ordner().resolve() not in pfad.parents or not pfad.is_file():
                return self.senden(400, dict(fehler="Datei nicht gefunden."))
            if sys.platform != "darwin":
                return self.senden(400, dict(fehler="Der Finder ist nur auf dem Mac verfuegbar."))
            subprocess.run(["open", "-R", str(pfad)], check=False)
            self.senden(200, dict(ok=True))
        except Exception as e:
            self.senden(500, dict(fehler=f"Unerwarteter Fehler: {e}"))


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}"
    print(f"Kartengenerator laeuft auf {url}  (beenden mit Ctrl+C)")
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
