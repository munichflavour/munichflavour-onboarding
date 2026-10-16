---
name: monatsabschluss
description: Monatsabschluss Buchhaltung Munich Flavour. Prueft, ob alle Belege eines Monats im Drive-Ordner liegen, gleicht Kontoauszug, Rentman und Belege ab und meldet, was fehlt. Aufrufen mit "/monatsabschluss 2026-10" oder wenn der Nutzer "Oktober machen", "Buchhaltung pruefen" o. ae. sagt.
---

# Monatsabschluss (auf Zuruf)

Ziel: Der Nutzer legt Scans, Kontoauszuege, PayPal-Bericht und Portalbelege selbst im Monatsordner ab und laedt den Ordner bei DATEV hoch. Du holst den Rest, kontrollierst alles und sagst, was fehlt. Regeln: `buchhaltung/README.md`. Sprache: Deutsch, freundlich, keine Gedankenstriche, ehrlich auch bei unbequemen Punkten.

**Nur lesen und hinzufuegen.** Nie loeschen, ueberschreiben oder umbenennen. Nie in DATEV schreiben. Nichts versenden. Den Rentman-Token nie ausgeben, speichern oder in Dateien schreiben.

## Voraussetzungen pruefen
- `RENTMAN_API_TOKEN` gesetzt und `api.rentman.net` erreichbar (`curl` mit dem Token auf `/invoices?limit=1`). Sonst: dem Nutzer sagen, was fehlt (Umgebungseinstellungen am Rechner), und ohne Rentman weitermachen.
- Microsoft-365-Connector muss als `willy.gottbehuet@munichflavour.de` verbunden sein (Zugriff auf `rechnungen@munichflavour.de`). Test: `outlook_email_search` mit `mailboxOwnerEmail`.
- Google Drive Connector erreichbar.

## Ablauf
Arbeitsordner: der Scratchpad der Session, Unterordner `work/m{MONAT}`. Skripte in `buchhaltung/`.

1. **Ordner finden.** Aktiver Baum: `01 Finanzen / Buchhaltung` (Ordner-ID `16RsThFH34NaoEg5WUmvFpsDqU5ZnKGGH`) `/ Steuer {Jahr} / {MM_Monat} / {Rechnungsausgang, Rechnungseingang, Kasse, Sonstiges}`. Es gibt eine alte Kopie unter einem anderen "01 Finanzen" (Buchhaltung-ID `1-KC2...`): **ignorieren**. Mit `search_files` (`parentId = ...`) arbeiten und **bis zum Ende blaettern** (`pageToken`), die Listen sind lang.
2. **Namenslisten** schreiben (`namen.txt`, eine Datei pro Zeile): Eingang-Dateien ohne Praefix, Dateien des Vormonats mit `VM|`, Rechnungsausgang mit `RA|`.
3. **Rentman:** `RENTMAN_API_TOKEN=... python3 buchhaltung/rentman_soll_liste.py {MONAT} vorhanden.txt --json rentman.json` (`vorhanden.txt` = Dateinamen aus Rechnungsausgang). Stornopaare im selben Monat entfallen, Gutschriften ueber die Monatsgrenze bleiben. PDFs lassen sich nicht automatisch holen (die Rentman-API liefert keine, Mailanhaenge gibt der Connector nicht heraus): fehlende nennt der Nutzer-Export.
4. **Kontoauszuege** (liegen im Ordner `Sonstiges`, Name `Kontoauszug_...pdf`, zwei Konten): `download_file_content` (grosse Dateien landen automatisch auf der Platte, Pfad steht in der Fehlermeldung; base64 steckt in `content`). Dekodieren, dann `python3 buchhaltung/kontoauszug.py auszug.pdf konto1.json`. **Die Ausgabe muss "Saldo stimmt: True" zeigen.** Sonst die Buchungen nicht verwenden und den Nutzer informieren.
4b. Fehlen Kontoauszug, PayPal-Bericht oder Abrechnung des Kartenzahlungsanbieters (`LJZFR...MSR...pdf`) im Ordner `Sonstiges`: sofort melden.
5. **Belege lesen:** alle PDFs des Eingangs mit `download_file_content` holen (parallel, in Bloecken zu ca. 20; Dateien ab ca. 70 KB werden auf die Platte gespeichert). Dann `python3 buchhaltung/indexiere.py <tool-results-ordner> work/m{MONAT}` (pdftotext, bei Scans lokale Texterkennung mit RapidOCR, ca. 3 s pro Scan; falls `rapidocr_onnxruntime` fehlt: `pip install rapidocr-onnxruntime`). Kleinere Dateien (unter ca. 70 KB) kommen inline und werden nicht gespeichert: bei Bedarf mit `read_file_content` lesen und in `belege_manuell.csv` eintragen (`datei;TT.MM.JJJJ;betrag;haendler`).
6. **Mails (optional, empfohlen):** `outlook_email_search` mit `mailboxOwnerEmail=rechnungen@munichflavour.de`, `folderName=Eingang`, Datumsfilter, blaettern. Fuer Mails mit Anhang `read_resource` und die Anhangnamen in `mails.json` sammeln (`[{betreff, absender, datum, anhaenge:[...]}]`). Mailanhaenge, die noch nicht im Ordner liegen, erscheinen im Bericht als FEHLT. Achtung: Nicht jede Rechnungsmail landet im Ordner Eingang (z. B. Telekom, Vattenfall, Google, Lexware); bei Verdacht auch alle Ordner durchsuchen.
7. **Abgleich:** `python3 buchhaltung/abgleich.py --monat {MONAT} --arbeit work/m{MONAT} --konto konto1.json [--konto konto2.json] --rentman rentman.json --namen namen.txt [--manuell belege_manuell.csv] [--mails mails.json] [--alt alter_bericht.csv] --out abgleich.csv`
8. **Ergebnis pruefen:** FEHLT, PRUEFEN (Vorschlag), KLAEREN, PORTAL und OFFEN einzeln ansehen. Dateien mit "[Text nicht gelesen]" nachlesen. Ergebnisse nicht blind weitergeben.
9. **Ablegen:** Bericht als Google Sheet im Ordner `Sonstiges` des Monats: `create_file` mit `textContent` (die CSV), `contentMimeType: text/csv` (wird automatisch zu Sheets), Titel `Abgleich_{MONAT}`. Existiert schon einer: **nicht ueberschreiben**, sondern erst lesen (Spalte "Manuelle Notiz" uebernehmen, `--alt`) und dann als neue Version `Abgleich_{MONAT}_v2` anlegen und den Nutzer fragen.
10. **Antwort an den Nutzer:** kurz und konkret: (a) was er noch ablegen muss (Rechnungsausgang-PDFs aus Rentman mit Nummern, PayPal-Bericht, Portalbelege mit Lieferant und Betrag, Kartenbons mit Datum und Betrag), (b) was zu klaeren ist, (c) Hinweise fuer den Steuerberater (privat/nicht abziehbar, Reverse-Charge, Vorauszahlungen fuer Folgemonate, Bewirtung/Betriebsveranstaltung, falsche Rechnungsadressen), (d) Stichtag: 15. des Folgemonats.

## Statuswerte
OK, FEHLT, PORTAL (manuell nachliefern), PRUEFEN (Vorschlag), KLAEREN, OFFEN (Beleg ohne Zahlung), OFFEN (Forderung), EINNAHME (Ausgangsrechnung), KEIN BELEG NOETIG, PRIVAT / nicht Betriebsausgabe, INTERN (Umbuchung).

## Grenzen (ehrlich benennen)
- Der Abgleich trifft nach Rechnungsnummer, Zeitstempel (Metro), Betrag/Datum und Lieferantenname. Er ersetzt keine steuerliche Pruefung.
- Texterkennung kann Betraege verfehlen. Dann bleibt die Buchung auf FEHLT/PRUEFEN und wird manuell geklaert.
- Soll-Versteuerung: Monat nach Rechnungsdatum bzw. Leistung, nicht nach Zahlung. Der Kontoauszug dient der Vollstaendigkeit.
