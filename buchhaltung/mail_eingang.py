#!/usr/bin/env python3
"""Plan fuer den Sammelordner Mail-Eingang: welche Anhaenge gehoeren in den Rechnungseingang des Monats?

Aufruf:
  python3 mail_eingang.py --monat 2026-10 --index work/mail/index.json --namen namen.txt \
      [--eingang-index work/m2026-10/index.json] --out plan_mail_eingang.csv

index.json: Ausgabe von indexiere.py fuer den Ordner Mail-Eingang ({titel: {id, art, text}}).
namen.txt:  Dateien im Rechnungseingang des Monats (ohne Praefix), Vormonat mit "VM|".
Es wird nichts kopiert. Die Ausgabe ist die Liste fuer den Trockenlauf (Freigabe durch den Nutzer).
Aktionen: KOPIEREN, SCHON DA, VORMONAT, ANDERER MONAT, MAHNUNG, KEINE RECHNUNG, UNKLAR.
"""
import argparse, csv, json, re
from datetime import date

KEYWORDS = r"(?:rechnungs?datum|rechnungsdat\.|belegdatum|datum|date|invoice date|vom|ausstellungsdatum|leistungsdatum)"
MAHNUNG = r"mahnung|zahlungserinnerung|zahlungsaufforderung|inkasso|letzte erinnerung|1\. erinnerung"
RECHNUNG = r"rechnung|invoice|beleg|quittung|kassenbon|gutschrift|rg\.?[- ]?nr|re[-_ ]?\d|bestellung|order"
MONATE = {"januar": 1, "februar": 2, "maerz": 3, "märz": 3, "april": 4, "mai": 5, "juni": 6, "juli": 7,
          "august": 8, "september": 9, "oktober": 10, "november": 11, "dezember": 12}


def mk(j, m, t):
    j = j + 2000 if j < 100 else j
    try:
        return date(j, m, t)
    except ValueError:
        return None


def alle_daten(text):
    out = []
    for m in re.finditer(r"(?<!\d)(\d{1,2})\.\s?(\d{1,2})\.\s?(20\d\d|\d\d)(?!\d)", text):
        x = mk(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        if x: out.append((m.start(), x))
    for m in re.finditer(r"(?<!\d)(20\d\d)-(\d\d)-(\d\d)(?!\d)", text):
        x = mk(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if x: out.append((m.start(), x))
    for m in re.finditer(r"(?<!\d)(\d{1,2})\.?\s+([A-Za-zäöüÄÖÜ]+)\s+(20\d\d)", text):
        mo = MONATE.get(m.group(2).lower())
        x = mo and mk(int(m.group(3)), mo, int(m.group(1)))
        if x: out.append((m.start(), x))
    return out


def rechnungsdatum(titel, text):
    """(datum, quelle): Datum direkt hinter einem Schluesselwort, sonst im Dateinamen, sonst erstes Datum."""
    daten = alle_daten(text)
    for m in re.finditer(KEYWORDS, text, re.I):
        for pos, x in daten:
            if m.end() <= pos <= m.end() + 40:
                return x, "Text (Schluesselwort)"
    for m in re.finditer(r"(20\d\d)[-_]?(\d\d)[-_]?(\d\d)|(\d\d)\.(\d\d)\.(20\d\d)", titel):
        x = mk(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m.group(1) else mk(int(m.group(6)), int(m.group(5)), int(m.group(4)))
        if x: return x, "Dateiname"
    if daten:
        return min(daten, key=lambda p: p[0])[1], "Text (erstes Datum)"
    return None, ""


def lese_namen(pfad):
    ein, vm = set(), set()
    for z in open(pfad, encoding="utf-8"):
        z = z.rstrip("\n")
        if z.startswith("VM|"): vm.add(z[3:])
        elif z.startswith("RA|") or not z.strip(): continue
        else: ein.add(z)
    return ein, vm


def norm_text(t):
    return re.sub(r"\W+", "", t.lower())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--monat", required=True)
    ap.add_argument("--index", required=True)
    ap.add_argument("--namen", required=True)
    ap.add_argument("--eingang-index")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    jahr, mon = map(int, a.monat.split("-"))
    index = json.load(open(a.index, encoding="utf-8"))
    ein, vm = lese_namen(a.namen)
    gleich = set()
    if a.eingang_index:
        for v in json.load(open(a.eingang_index, encoding="utf-8")).values():
            if len(v["text"].strip()) > 80: gleich.add(norm_text(v["text"]))
    zeilen, zaehler = [], {}
    for titel, v in sorted(index.items()):
        text = v["text"]
        dat, quelle = rechnungsdatum(titel, text)
        if titel in ein: akt, grund = "SCHON DA", "gleicher Dateiname im Rechnungseingang des Monats"
        elif titel in vm: akt, grund = "VORMONAT", "gleicher Dateiname im Vormonat abgelegt"
        elif len(text.strip()) > 80 and norm_text(text) in gleich: akt, grund = "SCHON DA", "gleicher Inhalt unter anderem Namen"
        elif len(text.strip()) < 40: akt, grund = "UNKLAR", "kein Text lesbar: Datei von Hand ansehen"
        elif re.search(MAHNUNG, text, re.I) and not re.search(r"\brechnung\b", titel, re.I): akt, grund = "MAHNUNG", "Mahnung/Zahlungserinnerung, nicht kopieren"
        elif not re.search(RECHNUNG, titel + " " + text[:3000], re.I): akt, grund = "KEINE RECHNUNG", "weder Name noch Text deuten auf Rechnung/Beleg"
        elif dat is None: akt, grund = "UNKLAR", "kein Rechnungsdatum gefunden"
        elif (dat.year, dat.month) == (jahr, mon): akt, grund = "KOPIEREN", f"Rechnungsdatum {dat:%d.%m.%Y} ({quelle})"
        else: akt, grund = "ANDERER MONAT", f"Rechnungsdatum {dat:%d.%m.%Y} ({quelle})"
        zaehler[akt] = zaehler.get(akt, 0) + 1
        zeilen.append([akt, titel, f"{dat:%d.%m.%Y}" if dat else "", grund, v.get("id", "")])
    with open(a.out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Aktion", "Datei", "Rechnungsdatum", "Grund", "Drive-ID"])
        w.writerows(sorted(zeilen, key=lambda z: (z[0] != "KOPIEREN", z[0], z[1])))
    print(", ".join(f"{k}: {n}" for k, n in sorted(zaehler.items())) or "keine Dateien")


if __name__ == "__main__":
    main()
