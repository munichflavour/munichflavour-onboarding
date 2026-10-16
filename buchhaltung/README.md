# Monatsabschluss Buchhaltung (Munich Flavour)

Ziel: Alle Belege eines Monats liegen in der Drive-Ordnerstruktur und werden von Hand bei DATEV Unternehmen online hochgeladen. Die Abgabe an den Steuerberater ist bis zum 15. des Folgemonats.
Der Lauf wird vorerst auf Zuruf in einer Claude-Session ausgeloest ("Oktober").

## Zielstruktur (Google Drive)

`01 Finanzen / Buchhaltung / Steuer {Jahr} / {MM_Monat} / {Rechnungsausgang, Rechnungseingang, Kasse, Sonstiges}`

Die Struktur bleibt unveraendert. Der Monatsordner ist das fertige DATEV-Paket.

## Regeln

1. **Zuordnung nach Rechnungsdatum** (Soll-Versteuerung), nicht nach Zahlung oder Eingang. Nachzuegler gehoeren in ihren Rechnungsmonat und werden als "nachgereicht" gekennzeichnet, wenn der Monat schon beim Steuerberater liegt.
2. **Rechnungsausgang**: alle Rentman-Rechnungen des Monats als PDF, Dateiname unveraendert (`Rechnung_RE1236_13.09.2026.pdf`).
   - Stornopaare (Rechnung + Gutschrift im selben Monat) werden **nicht** exportiert.
   - Liegt die stornierte Rechnung im Vormonat, bleibt die Gutschrift im Gutschriftmonat.
3. **Rechnungseingang**: Lieferantenrechnungen mit Originaldateinamen (nie umbenennen). Mahnungen und Duplikate sind keine Belege.
4. **Kasse**: Barbelege. **Sonstiges**: Kontoauszuege (beide Konten), PayPal-Monatsbericht, Abrechnung des Kartenzahlungsanbieters, Abgleichbericht.
5. **Manuell abgelegt wird**: Belege aus Portalen (Metro, Amazon, Google, Telekom, Vattenfall u. a.), Kontoauszuege, PayPal-Bericht, Scans von Kartenbons.
6. **Nur hinzufuegen**: Das Werkzeug loescht, ueberschreibt und benennt nie etwas um. Manuell abgelegte Dateien werden erkannt (ueber den Inhalt) und zaehlen als vorhanden.
7. **Abgleichbericht** (Excel, Ordner `Sonstiges`, mit Spalte "Manuelle Notiz"): jede Kontobuchung gegen einen Beleg, jeder Beleg gegen eine Buchung.
   Status: OK, FEHLT, KEIN BELEG NOETIG, EINNAHME, PRIVAT, INTERN, PORTAL (manuell nachliefern), OFFEN (Beleg ohne Zahlung), KLAEREN.
   Manuelle Notizen bleiben beim naechsten Lauf erhalten.

## Technische Erkenntnisse

- Die Rentman-API liefert die Rechnungsdaten, aber **keine PDFs**. Die PDFs haengen als Anhang an den Rentman-Mails (Gesendete Elemente von `rechnungen@`). Der Connector gibt Anhaenge nicht als Datei heraus ("binary attachment"), die PDFs muessen deshalb vorerst aus Rentman manuell exportiert werden.
- `rentman_soll_liste.py` berechnet, welche PDFs im Rechnungsausgang liegen muessen, und markiert fehlende. Nur lesend.
- Der Zugangstoken liegt **nie** im Repo, sondern als `RENTMAN_API_TOKEN` in der Umgebung (nur Lesezugriff).

## Bausteine

| Datei | Zweck |
|---|---|
| `kontoauszug.py` | liest den Kontoauszug (PDF) in Buchungen und prueft den Saldo |
| `indexiere.py` | macht aus heruntergeladenen Belegen einen Textindex (auch Scans, lokale Texterkennung) |
| `rentman_soll_liste.py` | Soll-Liste der Rentman-Rechnungen, Stornopaare, JSON-Export |
| `abgleich.py` | gleicht Buchungen, Belege, Rentman und Mails ab und schreibt den Abgleichbericht (CSV) |

Der Ablauf fuer Claude steht in `.claude/skills/monatsabschluss/SKILL.md` (Aufruf: `/monatsabschluss 2026-10`).

Test mit September 2026: 135 von 140 Buchungen kommen automatisch zum selben Ergebnis wie die Handpruefung, die uebrigen fuenf sind vorsichtiger (Vorschlag statt OK oder Beleg noch nicht gelesen), keine falschen Treffer.

## Aufruf

```
RENTMAN_API_TOKEN=... python3 buchhaltung/rentman_soll_liste.py 2026-09 vorhanden.txt
```

`vorhanden.txt`: Dateinamen aus dem Ordner Rechnungsausgang, einer pro Zeile.
