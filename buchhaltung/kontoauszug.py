#!/usr/bin/env python3
"""Liest einen Kontoauszug (Postbank/Deutsche Bank Geschaeftskunden, PDF) in Buchungen.

Aufruf:  python3 kontoauszug.py auszug.pdf [ausgabe.json]
Prueft sich selbst: alter Saldo + Summe der Buchungen muss dem neuen Saldo entsprechen.
"""
import json, re, subprocess, sys

BUCHUNG = re.compile(r"^\s*(\d\d\.\d\d\.)\s+(\d\d\.\d\d\.)\s+(.+?)\s{2,}([+-])\s*([\d.]+,\d\d)\s*$")
ZEILE2 = re.compile(r"^\s*(20\d\d)\s+(20\d\d)\s+(.*)$")
STOER = re.compile(
    r"^\s*(IBAN von|Buchung\s+Valuta|Postbank|Gesch.ftskunden|53243|0000\d+ /|Telefon|24h-|Seite|Auszug|\f|\d+\s+\d+\s+\d+\s+DE\d\d)"
)


def zahl(s):
    return float(s.replace(".", "").replace(",", "."))


def text_aus_pdf(pfad):
    return subprocess.run(["pdftotext", "-layout", pfad, "-"], capture_output=True, text=True, check=True).stdout


def lese(pfad):
    text = text_aus_pdf(pfad)
    jahr = re.search(r"Kontoauszug vom \d\d\.\d\d\.(\d{4})", text) or re.search(r"\b(20\d\d)\b", text)
    jahr = jahr.group(1)
    alt = re.search(r"Alter Saldo.*?([+-])\s*([\d.]+,\d\d)", text, re.S)
    neu = re.search(r"Neuer Saldo.*?EUR\s+([+-])\s*([\d.]+,\d\d)", text, re.S)
    iban = re.search(r"Seite\s+von\s+IBAN.*?\n\s*\d+\s+\d+\s+\d+\s+(DE\d\d(?: ?\d{4}){4} ?\d\d)", text, re.S)
    buchungen, aktuell = [], None
    for zeile in text.splitlines():
        m = BUCHUNG.match(zeile)
        if m:
            aktuell = {"datum": m.group(1) + jahr, "valuta": m.group(2) + jahr, "vorgang": m.group(3).strip(),
                       "betrag": (1 if m.group(4) == "+" else -1) * zahl(m.group(5)), "text": []}
            buchungen.append(aktuell)
            continue
        if aktuell is None or not zeile.strip():
            continue
        if re.match(r"^\s*(Filialnummer|Kontonummer|Neuer Saldo|Wichtige Hinweise)", zeile):
            aktuell = None
            continue
        if STOER.match(zeile):
            continue
        z2 = ZEILE2.match(zeile)
        teil = (z2.group(3) if z2 else zeile).strip()
        if teil:
            aktuell["text"].append(teil)
    for b in buchungen:
        t = [x for x in b["text"] if not x.startswith(("IBAN DE", "BIC "))]
        if t and not t[0].startswith("Verwendungszweck/"):
            b["partner"], rest = t[0], t[1:]
        else:
            b["partner"], rest = "", t
        b["verwendungszweck"] = " ".join(x for x in rest if not x.startswith("Verwendungszweck/")).strip()
        b["text"] = " ".join(b["text"])
        if b["vorgang"].startswith("Verwendungszweck/") and "Abschlussposten" in b["text"]:
            b["vorgang"], b["partner"], b["verwendungszweck"] = "Abschlussposten", "Bank Abschlussposten", "Entgelte/Zinsen"
    summe = round(sum(b["betrag"] for b in buchungen), 2)
    ergebnis = {"iban": iban.group(1) if iban else "", "alt": None, "neu": None, "buchungen": buchungen}
    if alt:
        ergebnis["alt"] = (1 if alt.group(1) == "+" else -1) * zahl(alt.group(2))
    if neu:
        ergebnis["neu"] = (1 if neu.group(1) == "+" else -1) * zahl(neu.group(2))
    ergebnis["summe"] = summe
    if ergebnis["alt"] is not None and ergebnis["neu"] is not None:
        ergebnis["saldo_ok"] = abs(ergebnis["alt"] + summe - ergebnis["neu"]) < 0.01
    return ergebnis


if __name__ == "__main__":
    e = lese(sys.argv[1])
    print(f"{e['iban']}: {len(e['buchungen'])} Buchungen, alt {e['alt']}, neu {e['neu']}, Summe {e['summe']}, Saldo stimmt: {e.get('saldo_ok')}")
    if len(sys.argv) > 2:
        json.dump(e, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
