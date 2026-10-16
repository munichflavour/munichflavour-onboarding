#!/usr/bin/env python3
"""Monatsabgleich: Kontobuchungen <-> Belege <-> Rentman. Nur lesend, schreibt eine CSV.

Aufruf (Beispiel):
  python3 abgleich.py --monat 2026-09 --arbeit work/m2026-09 \
      --konto konto1.json --rentman rentman.json --namen namen.txt \
      [--manuell belege_manuell.csv] [--mails mails.json] [--alt abgleich_alt.csv] --out abgleich.csv

Eingaben
  --konto      JSON von kontoauszug.py (mehrfach moeglich)
  --rentman    JSON-Liste der Rentman-Rechnungen (API /invoices)
  --arbeit     Ordner von indexiere.py (index.json mit Belegtexten)
  --namen      Dateinamen der Monatsordner, eine pro Zeile; Praefix "RA|" = Rechnungsausgang, sonst Eingang
  --manuell    Belege ohne lesbaren Text:  datei;datum(TT.MM.JJJJ);betrag;haendler
  --mails      JSON-Liste [{betreff, absender, datum, anhaenge:[...]}] der Eingangsmails
  --alt        fruehere Abgleich-CSV: Spalte "Manuelle Notiz" bleibt erhalten
"""
import argparse, csv, difflib, itertools, json, os, re
from datetime import date, datetime, timedelta

PORTALE = ["amazon", "google", "telekom", "vattenfall", "microsoft", "canva", "metro", "vodafone", "dkv",
           "sumup", "haufe", "lexware", "anthropic"]
KEIN_BELEG = r"miete|versicherung|barmer|knappschaft|berufsgenossenschaft|abschlussposten|beitrag|zinsen|krankenkasse"


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def zahl(s):
    return float(s.replace(".", "").replace(",", "."))


def betraege(text):
    out = set()
    for m in re.finditer(r"(?<![\d,.])(\d{1,3}(?:\.\d{3})+|\d+)(?:,\s?|\.)(\d{2})(?!\d)", text):
        out.add(round(float(m.group(1).replace(".", "") + "." + m.group(2)), 2))
    return out


def datums(text):
    out = []
    for m in re.finditer(r"(?<!\d)(\d{1,2})\.\s?(\d{1,2})\.\s?(20\d\d|\d\d)(?!\d)", text):
        t, mo, j = int(m.group(1)), int(m.group(2)), int(m.group(3))
        j = j + 2000 if j < 100 else j
        try:
            out.append(date(j, mo, t))
        except ValueError:
            pass
    return out


def d(s):
    return datetime.strptime(s, "%d.%m.%Y").date()


def zeit_metro(b):
    t = b["text"]
    m = re.search(r"(\d\d)-(\d\d)-(\d{4})\s?T(\d\d):(\d\d)", t)
    if m:
        return datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)), int(m.group(4)), int(m.group(5)))
    m = re.search(r"ELV\d+\s+(\d\d)\.(\d\d)\s+(\d\d)\.(\d\d)", t)
    if m:
        return datetime(int(b["datum"][-4:]), int(m.group(2)), int(m.group(1)), int(m.group(3)), int(m.group(4)))
    return None


class Beleg:
    def __init__(self, name, text="", quelle="Eingang", total=None, datum=None, haendler=""):
        self.name, self.text, self.quelle = name, text, quelle
        self.nname, self.ntext = norm(name), norm(text)
        self.betr = betraege(text) | ({total} if total else set())
        self.summen = set()
        for m in re.finditer(r"(summe|gesamt|total|betrag|brutto|zu zahlen|endsumme|rechnungsbetrag|zahlung)(.{0,60})", text, re.I | re.S):
            self.summen |= betraege(m.group(2))
        self.mahnung = bool(re.search(r"mahnung|zahlungserinnerung", name.lower()))
        self.datums = datums(text) + ([datum] if datum else [])
        self.total = total if total else (max(self.betr) if self.betr else None)
        if total:
            self.summen.add(total)
        self.haendler = haendler.lower()
        m = re.search(r"_(\d{14})_invoice_copy", name)
        self.metro = datetime.strptime(m.group(1), "%Y%m%d%H%M%S") if m else None
        self.benutzt = 0


STOPP = {"sepa", "lastschrift", "lastschrifteinzug", "ueberweisung", "überweisung", "verwendungszweck", "kundenreferenz",
         "rechnung", "rechnungs", "gmbh", "einkauf", "paypal", "europe", "mandat", "kartenzahlung", "wiederholungslastschrift",
         "bezahlung", "payments", "limited", "ireland", "deutschland", "service", "auslage", "echtzeitueberweisung", "online",
         "kontaktlos", "girocard", "debit", "karte", "gläubiger", "glaeubiger"}


def schluessel(b):
    """Rechnungsnummern-aehnliche Schluessel aus dem Verwendungszweck (auch ueber ein Leerzeichen hinweg)."""
    teile = re.split(r"\s+", (b["verwendungszweck"] + " " + b["partner"]).strip())
    kand = set(teile) | {teile[i] + teile[i + 1] for i in range(len(teile) - 1)}
    kand |= set(re.findall(r"[A-Za-z0-9]+", b["verwendungszweck"] + " " + b["partner"]))
    out = set()
    for t in kand:
        n = norm(t)
        ziffern = sum(c.isdigit() for c in n)
        if len(n) < 5 or ziffern < 4:
            continue
        if n.isdigit() and len(n) < 6:
            continue
        if re.fullmatch(r"\d{2}\d{2}20\d\d", n) or re.fullmatch(r"\d{4}", n):
            continue
        out.add(n)
    return out


def tokens(b):
    return schluessel(b)


def name_treffer(b, belege):
    k = schluessel(b)
    return [x for x in belege if any(t in x.nname for t in k)]


def lieferantenwort(b, belege):
    """Eindeutiger Lieferantenname im Dateinamen (nur als Vorschlag)."""
    woerter = {w for w in re.findall(r"[a-zäöüß]{5,}", (b["partner"] + " " + b["verwendungszweck"]).lower()) if w not in STOPP}
    for w in woerter:
        kand = [x for x in belege if x.benutzt == 0 and not x.mahnung and w in x.nname]
        if len(kand) == 1:
            return kand, "VORSCHLAG Lieferantenname " + w
    return [], ""


def pruefe(b, belege):
    """Liefert (Belege, Hinweis) fuer eine Ausgabe-Buchung."""
    belege = [x for x in belege if not x.mahnung]
    bd = d(b["datum"])
    betrag = abs(b["betrag"])
    karte = "kartenzahlung" in b["vorgang"].lower() or "elv" in b["verwendungszweck"].lower()
    # 1. Metro: Zeitstempel im Dateinamen
    z = zeit_metro(b)
    if z:
        for x in belege:
            if x.metro and abs((x.metro - z).total_seconds()) <= 600:
                return [x], "Metro-Zeitstempel"
    # 2. Rechnungsnummer im Verwendungszweck (Dateiname oder Belegtext), nicht bei Kartenzahlungen
    if not karte:
        treffer = name_treffer(b, belege)
        tk = tokens(b)
        for x in belege:
            if x not in treffer and any(t in x.ntext for t in tk):
                treffer.append(x)
        if treffer:
            return treffer, "Rechnungsnummer"
        # kurze Rechnungsnummer (z. B. "Rechnung Nr. 2624"): nur als Vorschlag
        kurz = re.findall(r"(?:rechnung|rg|re|rnr|nr)\.?\s*(?:nr\.?|nummer)?\s*:?\s*(\d{2,5})(?!\d)", b["verwendungszweck"].lower())
        for nr in kurz:
            kand = [x for x in belege if re.search(r"(?<!\d)" + nr + r"(?!\d)", x.name) and not re.search(r"\d{2}\.\d{2}\.20", nr)]
            if len(kand) == 1:
                return kand, "VORSCHLAG kurze Rechnungsnummer " + nr
    # 3. Betrag + Datum (+ Haendlerwort); bereits zugeordnete Belege nicht noch einmal
    wort = re.findall(r"[a-zäöüß]{4,}", (b["partner"] + " " + b["verwendungszweck"]).lower())
    kand = []
    for x in belege:
        if x.benutzt or (betrag not in x.betr and x.total != betrag):
            continue
        score = 40
        if betrag in x.summen or x.total == betrag:
            score += 25
        if x.datums and any(bd - timedelta(days=45) <= dd <= bd + timedelta(days=7) for dd in x.datums):
            score += 20
        elif x.datums:
            score -= 25
        if any(w in x.ntext or w in x.nname or w in x.haendler for w in wort):
            score += 20
        kand.append((score, x))
    kand.sort(key=lambda t: -t[0])
    if kand and kand[0][0] >= 70:
        mehr = len(kand) > 1 and kand[1][0] == kand[0][0]
        return [kand[0][1]], "Betrag+Datum" + (" (mehrdeutig)" if mehr else "")
    return lieferantenwort(b, belege)


def teilmenge(b, belege, betrag=None):
    bd = d(b["datum"])
    betrag = round(abs(b["betrag"]) if betrag is None else betrag, 2)
    pool = [x for x in belege if x.total and x.benutzt == 0 and x.datums
            and any(bd - timedelta(days=21) <= dd <= bd + timedelta(days=3) for dd in x.datums)]
    for n in (1, 2, 3, 4):
        for kombi in itertools.combinations(pool, n):
            if abs(sum(x.total for x in kombi) - betrag) < 0.015:
                return list(kombi)
    return []


def lade_belege(args):
    belege = []
    idx = {}
    if args.arbeit and os.path.exists(os.path.join(args.arbeit, "index.json")):
        idx = json.load(open(os.path.join(args.arbeit, "index.json"), encoding="utf-8"))
    manuell = {}
    if args.manuell and os.path.exists(args.manuell):
        for r in csv.reader(open(args.manuell, encoding="utf-8"), delimiter=";"):
            if len(r) >= 3 and not r[0].startswith("#"):
                manuell[r[0]] = (d(r[1]), zahl(r[2]), r[3] if len(r) > 3 else "")
    ausgang = []
    for z in open(args.namen, encoding="utf-8"):
        z = z.strip()
        if not z:
            continue
        if z.startswith("RA|"):
            ausgang.append(z[3:])
            continue
        quelle = "Vormonat" if z.startswith("VM|") else "Eingang"
        name = z.split("|", 1)[1] if "|" in z[:4] else z
        text = idx.get(name, {}).get("text", "")
        if name in manuell:
            dt, tot, h = manuell[name]
            belege.append(Beleg(name, text, quelle, tot, dt, h))
        else:
            belege.append(Beleg(name, text, quelle))
    return belege, ausgang, idx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--monat", required=True)
    ap.add_argument("--arbeit")
    ap.add_argument("--konto", action="append", required=True)
    ap.add_argument("--rentman", required=True)
    ap.add_argument("--namen", required=True)
    ap.add_argument("--manuell")
    ap.add_argument("--mails")
    ap.add_argument("--alt")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    belege, ausgang_namen, idx = lade_belege(args)
    rm = json.load(open(args.rentman, encoding="utf-8"))
    rm = rm["data"] if isinstance(rm, dict) else rm
    rm_f = {r["number"]: r for r in rm if r["invoicetype"] != "C"}

    zeilen = []

    def add(datum, quelle, buchung, betrag, status, notiz=""):
        zeilen.append([datum, quelle, buchung, f"{betrag:.2f}".replace(".", ",") if betrag is not None else "", status, notiz])

    bank = []
    for k in args.konto:
        e = json.load(open(k, encoding="utf-8"))
        for b in e["buchungen"]:
            b["konto"] = e["iban"][-4:]
            bank.append(b)
        if e.get("saldo_ok") is False:
            add("", "Kontoauszug", f"Konto ...{e['iban'][-4:]}: Saldo passt nicht zu den Buchungen", None, "KLAEREN")
    bank.sort(key=lambda b: (d(b["datum"]), b["konto"]))

    gebucht = set()
    offene_auslagen = []
    amazon = [b for b in bank if "amazon" in (b["partner"] + b["verwendungszweck"]).lower() and b["betrag"] < 0]
    amazon_belege = [x for x in belege if "amazon" in x.nname]

    for b in bank:
        t = (b["vorgang"] + " " + b["partner"] + " " + b["verwendungszweck"]).lower()
        label = f"{b['partner'] or 'Karte'}: {b['verwendungszweck'][:70]}".strip()
        # --- Einnahmen
        if b["betrag"] > 0:
            if "übertrag" in t:
                add(b["datum"], "Bank", label, b["betrag"], "INTERN (Umbuchung)")
            elif re.search(r"krankenkasse|knappschaft|zinsen|abschlussposten", t) or "zinsen" in b["verwendungszweck"].lower():
                add(b["datum"], "Bank", label, b["betrag"], "KEIN BELEG NOETIG", "Erstattung/Zinsen")
            else:
                hit = None
                for n in re.findall(r"(?<!\d)(1[0-4]\d\d)(?!\d)", t):
                    if n in rm_f and abs(rm_f[n]["price_invat"] - b["betrag"]) < 0.02:
                        hit = rm_f[n]; break
                if not hit:
                    c = [r for r in rm_f.values() if abs(r["price_invat"] - b["betrag"]) < 0.02 and r["number"] not in gebucht]
                    c.sort(key=lambda r: (not r["is_paid"], r["date"]))
                    hit = c[0] if c else None
                if hit:
                    gebucht.add(hit["number"])
                    add(b["datum"], "Bank", label, b["betrag"], "EINNAHME (Ausgangsrechnung)", f"RE{hit['number']}")
                else:
                    nr = re.findall(r"(?<!\d)(1[0-4]\d\d)(?!\d)", t)
                    add(b["datum"], "Bank", label, b["betrag"],
                        "EINNAHME (Ausgangsrechnung)" if nr else "KLAEREN",
                        f"RE{nr[0]} (nicht im geladenen Rentman-Zeitraum)" if nr else "Zahlungseingang ohne Rechnung")
            continue
        # --- Ausgaben ohne Beleg
        if "übertrag" in t:
            add(b["datum"], "Bank", label, b["betrag"], "INTERN (Umbuchung)"); continue
        if re.search(r"privatentnahme|einkommensteuer", t):
            add(b["datum"], "Bank", label, b["betrag"], "PRIVAT / nicht Betriebsausgabe"); continue
        if re.search(r"finanzamt|stok bay|kfz-steuer|zentrales finanzwesen", t):
            add(b["datum"], "Bank", label, b["betrag"], "KEIN BELEG NOETIG", "Steuer"); continue
        if re.search(KEIN_BELEG, t) and not re.search(r"amazon|paypal", t):
            add(b["datum"], "Bank", label, b["betrag"], "KEIN BELEG NOETIG", "Dauerauftrag/Beitrag/Bankentgelt"); continue
        # --- Google Ads: mehrere Abbuchungen, Monatsrechnung(en)
        if "adwords" in t:
            gb = [x for x in belege if "google" in x.ntext and "ads" in x.ntext]
            if gb:
                add(b["datum"], "Bank", label, b["betrag"], "OK", "Sammelrechnung: " + "; ".join(x.name for x in gb) + " [Summe der Abbuchungen mit Rechnungen vergleichen]")
                continue
        # --- Amazon: Beleg pro Abbuchung ueber Betrag; sonst Anzahl
        treffer, wie = pruefe(b, belege)
        if not treffer and "amazon" in t and amazon_belege:
            frei = [x for x in amazon_belege if x.benutzt == 0]
            if len(amazon_belege) == len(amazon) and frei:
                treffer, wie = [frei[0]], "Amazon (nur Anzahl, Betrag pruefen)"
        if treffer:
            for x in treffer:
                x.benutzt += 1
            namen = "; ".join(x.name for x in treffer)
            if re.search(r"auslage", t):
                b["_treffer"] = treffer
                b["_zeile"] = len(zeilen)
            add(b["datum"], "Bank", label, b["betrag"], "PRUEFEN (Vorschlag)" if wie.startswith("VORSCHLAG") else "OK", f"{namen} [{wie}]")
            continue
        if re.search(r"auslage", t) or "echtzeit" in b["vorgang"].lower():
            offene_auslagen.append(b)
        add_idx = len(zeilen)
        add(b["datum"], "Bank", label, b["betrag"], "FEHLT")
        b["_zeile"] = add_idx

    # Sammelauslagen aus mehreren Kassenbons
    for b in offene_auslagen:
        k = teilmenge(b, [x for x in belege if x.benutzt == 0])
        if k:
            for x in k:
                x.benutzt += 1
            z = zeilen[b["_zeile"]]
            z[4], z[5] = "OK", "Sammelauslage: " + "; ".join(x.name for x in k)

    # Auslagen, bei denen ein Beleg per Nummer passt, aber der Betrag noch nicht voll gedeckt ist
    for b in bank:
        if "_treffer" in b:
            rest = round(abs(b["betrag"]) - sum(x.total or 0 for x in b["_treffer"]), 2)
            if rest > 0.01:
                k = teilmenge(b, [x for x in belege if x.benutzt == 0], rest)
                if k:
                    for x in k:
                        x.benutzt += 1
                    zeilen[b["_zeile"]][5] += "; zusaetzlich: " + "; ".join(x.name for x in k)

    # Portal-Lieferanten ohne Beleg
    for z, b in ((zeilen[b["_zeile"]], b) for b in bank if "_zeile" in b):
        if z[4] == "FEHLT":
            t = (b["partner"] + " " + b["verwendungszweck"]).lower()
            if any(p in t for p in PORTALE):
                z[4], z[5] = "PORTAL (manuell nachliefern)", "bekannter Portal-Lieferant"

    # Rentman: Ausgangsrechnungen des Monats gegen Ordner
    mon = args.monat
    ra = set(ausgang_namen)
    for r in sorted((r for r in rm if r["date"][:7] == mon), key=lambda r: int(r["number"])):
        pass
    paare = {}
    for c in (r for r in rm if r["invoicetype"] == "C"):
        for f in rm_f.values():
            if f["project"] == c["project"] and abs(c["price_invat"] + f["price_invat"]) < 0.01 and f["date"] <= c["date"] and f["id"] not in paare:
                paare[f["id"]] = c["number"]; break
    entf = set()
    for fid, cn in paare.items():
        f = next(x for x in rm if x["id"] == fid)
        c = next(x for x in rm if x["number"] == cn and x["invoicetype"] == "C")
        if f["date"][:7] == c["date"][:7] == mon:
            entf |= {f["number"], c["number"]}
    for r in sorted((r for r in rm if r["date"][:7] == mon and r["number"] not in entf), key=lambda r: int(r["number"])):
        art = "Gutschrift" if r["invoicetype"] == "C" else "Rechnung"
        if r["filename"] not in ra:
            add(r["date"][:10], "Rentman", f"{art} {r['number']}", r["price_invat"], "FEHLT", f"PDF {r['filename']} fehlt im Ordner Rechnungsausgang")
    for n in sorted(ra - {r["filename"] for r in rm if r["date"][:7] == mon}):
        add("", "Rentman", n, None, "KLAEREN", "Datei im Ausgang, aber nicht im Soll (z. B. Stornopaar oder anderer Monat)")
    for r in sorted((r for r in rm if r["invoicetype"] != "C" and r["outstanding_balance"] > 0.01 and r["date"][:7] <= mon), key=lambda r: int(r["number"])):
        add(r["date"][:10], "Rentman", f"Offene Forderung RE{r['number']}", r["outstanding_balance"], "OFFEN (Forderung)", f"faellig {r['expiration'][:10]}")

    # Belege ohne Zahlung
    for x in belege:
        if x.benutzt == 0 and x.quelle == "Eingang":
            if re.search(r"mahnung|zahlungserinnerung", x.name.lower()):
                add("", "Beleg", x.name, x.total, "KEIN BELEG NOETIG", "Mahnung, keine Rechnung")
            else:
                add("", "Beleg", x.name, x.total, "OFFEN (Beleg ohne Zahlung)",
                    "im Monat nicht bezahlt oder nicht zugeordnet" + ("" if x.text else " [Text nicht gelesen: Datei pruefen]"))

    # Mails: Anhaenge, die noch nicht im Ordner liegen
    if args.mails and os.path.exists(args.mails):
        namen_norm = {norm(x.name) for x in belege}
        for m in json.load(open(args.mails, encoding="utf-8")):
            for a in m.get("anhaenge", []):
                if norm(a) not in namen_norm and not re.search(r"image\d+|logo|mahnung", a.lower()):
                    add(m.get("datum", ""), "Mail", f"{m.get('absender','')}: {a}", None, "FEHLT", "Mailanhang noch nicht im Ordner Rechnungseingang")

    # Manuelle Notizen aus frueherem Lauf uebernehmen
    notizen = {}
    if args.alt and os.path.exists(args.alt):
        for r in csv.reader(open(args.alt, encoding="utf-8-sig"), delimiter=";"):
            if len(r) >= 7 and r[6]:
                notizen[(r[0], r[2], r[3])] = r[6]
    with open(args.out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Datum", "Quelle", "Buchung", "Betrag EUR", "Status", "Beleg / Anmerkung", "Manuelle Notiz"])
        for z in zeilen:
            w.writerow(z + [notizen.get((z[0], z[2], z[3]), "")])
    from collections import Counter
    c = Counter(z[4] for z in zeilen)
    print(len(zeilen), "Zeilen")
    for k, v in sorted(c.items(), key=lambda t: -t[1]):
        print(f"  {v:3d}  {k}")


if __name__ == "__main__":
    main()
