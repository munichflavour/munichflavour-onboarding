#!/usr/bin/env python3
"""Prueft den PayPal-Monatskontoauszug (PDF, Name LJZFR...-MSR-...) gegen die PayPal-Buchungen im Bankkonto.

Aufruf:  python3 paypal_pruefen.py paypal.pdf konto1.json [konto2.json ...]
Der Auszug enthaelt nur Summen ("Gesendete Zahlungen", "Einzahlungen und Gutschriften"), keine Einzelbelege.
Er zeigt also, ob nichts fehlt, ersetzt aber nicht die Rechnungen der Haendler.
"""
import json, re, subprocess, sys


def zahl(s):
    return float(s.replace(".", "").replace(",", "."))


def main(pdf, konten):
    text = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
    m = re.search(r"Gesendete Zahlungen\s+(-?[\d.]+,\d\d)", text)
    gesendet = zahl(m.group(1)) if m else None
    bank = 0.0
    n = 0
    for k in konten:
        for b in json.load(open(k, encoding="utf-8"))["buchungen"]:
            t = (b["partner"] + " " + b["verwendungszweck"]).lower()
            if "paypal" in t and b["betrag"] < 0:
                bank += b["betrag"]
                n += 1
    bank = round(bank, 2)
    print(f"PayPal-Auszug: gesendete Zahlungen {gesendet}")
    print(f"Bank: {n} PayPal-Abbuchungen, Summe {bank}")
    if gesendet is None:
        print("Auszug nicht lesbar: von Hand pruefen")
    elif abs(gesendet - bank) < 0.01:
        print("PASST: Summe der Abbuchungen entspricht den gesendeten Zahlungen")
    else:
        print(f"ABWEICHUNG {round(gesendet - bank, 2)}: PayPal-Zahlungen im Bankkonto vs. Auszug klaeren")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
