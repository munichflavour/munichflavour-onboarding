#!/usr/bin/env python3
"""Soll-Liste der Rentman-Rechnungen eines Monats (nur lesend).

Aufruf:
  RENTMAN_API_TOKEN=... python3 rentman_soll_liste.py 2026-09 [vorhanden.txt]

vorhanden.txt: ein Dateiname pro Zeile (Inhalt des Ordners Rechnungsausgang).
Regeln:
  - Stornopaare (Rechnung + Gutschrift, selber Monat) entfallen komplett.
  - Gutschrift ueber die Monatsgrenze (Rechnung im Vormonat) bleibt im Gutschriftmonat.
  - Zuordnung nach Rechnungsdatum (Soll-Versteuerung).
"""
import json, os, sys, urllib.parse, urllib.request

API = "https://api.rentman.net"


def get(path, token):
    req = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def lade_rechnungen(monat, token):
    jahr, mon = map(int, monat.split("-"))
    start = f"{jahr}-{mon:02d}-01"
    # Vormonat mitladen, damit Stornopaare ueber die Monatsgrenze erkannt werden
    vj, vm = (jahr, mon - 1) if mon > 1 else (jahr - 1, 12)
    von = f"{vj}-{vm:02d}-01"
    bis = f"{jahr + (mon == 12)}-{(mon % 12) + 1:02d}-01"
    out, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"date[gte]": von, "date[lt]": bis, "limit": 100, "offset": offset})
        d = get("/invoices?" + q, token)
        out += d["data"]
        if len(d["data"]) < 100:
            return out, start
        offset += 100


def stornopaare(rechnungen):
    """Gutschrift (invoicetype C) neutralisiert Rechnung im selben Projekt mit gleichem Betrag."""
    paare, benutzt = [], set()
    for c in (r for r in rechnungen if r["invoicetype"] == "C"):
        for f in (r for r in rechnungen if r["invoicetype"] != "C" and r["project"] == c["project"]):
            if f["id"] in benutzt:
                continue
            if abs(c["price_invat"] + f["price_invat"]) < 0.01 and f["date"] <= c["date"]:
                paare.append((f, c))
                benutzt.add(f["id"])
                break
    return paare


def main():
    monat = sys.argv[1]
    token = os.environ["RENTMAN_API_TOKEN"]
    vorhanden = set()
    if len(sys.argv) > 2:
        vorhanden = {z.strip() for z in open(sys.argv[2], encoding="utf-8") if z.strip()}
    alle, start = lade_rechnungen(monat, token)
    monatsdok = [r for r in alle if r["date"][:7] == monat]
    entfallen = set()
    for f, c in stornopaare(alle):
        if f["date"][:7] == c["date"][:7] == monat:
            entfallen |= {f["number"], c["number"]}
    soll = sorted((r for r in monatsdok if r["number"] not in entfallen), key=lambda r: int(r["number"]))
    print(f"{len(monatsdok)} Dokumente im Monat, {len(entfallen)} entfallen (Stornopaare), {len(soll)} Soll")
    for r in soll:
        art = "Gutschrift" if r["invoicetype"] == "C" else "Rechnung"
        status = "vorhanden" if r["filename"] in vorhanden else "FEHLT"
        offen = f"offen {r['outstanding_balance']:.2f}" if r["outstanding_balance"] > 0.01 else ""
        print(f"{r['number']}\t{art}\t{r['filename']}\t{status}\t{offen}")
    if entfallen:
        print("Entfallen:", ", ".join(sorted(entfallen, key=int)))
    print("Im Ordner, aber nicht im Soll:", sorted(vorhanden - {r["filename"] for r in soll}) or "keine")


if __name__ == "__main__":
    main()
