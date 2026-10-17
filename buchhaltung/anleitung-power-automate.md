# Mail-Anhaenge automatisch ins Google Drive sichern (Power Automate)

Ziel: Jede Rechnung, die im geteilten Postfach `rechnungen@munichflavour.de` im Ordner **Eingang** ankommt, landet mit dem **Originalnamen** in einem Sammelordner im Google Drive. Beim Monatsabschluss sortiert Claude die Dateien nach Rechnungsdatum in `Rechnungseingang` des richtigen Monats (kopieren, nie loeschen).

Dauer: ca. 30 Minuten, am Rechner. Voraussetzungen: Microsoft-365-Konto mit Zugriff auf das geteilte Postfach, Google-Konto mit Schreibrecht im Drive (`mail@munichflavour.de`).

## 1. Sammelordner anlegen (Google Drive)
1. Im Drive unter `01 Finanzen / Buchhaltung` einen neuen Ordner anlegen: **Mail-Eingang**. Er liegt bewusst ausserhalb von `Steuer {Jahr}`, damit nichts Ungeprueftes ins DATEV-Paket rutscht.
2. Ordner nicht freigeben (nur du).

## 2. Flow anlegen
1. Auf make.powerautomate.com mit dem Microsoft-Konto anmelden, das Zugriff auf `rechnungen@` hat.
2. **Erstellen > Automatisierter Cloud-Flow**. Name: `Rechnungsanhaenge ins Drive`. Trigger waehlen: **Wenn eine neue E-Mail in einem freigegebenen Postfach eingeht (V2)** (englisch: *When a new email arrives in a shared mailbox (V2)*).
3. Einstellungen des Triggers:
   - Original-Postfachadresse: `rechnungen@munichflavour.de`
   - Ordner: **Eingang** (nicht den Posteingang, wenn die Mails per Regel in "Eingang" verschoben werden)
   - Nur mit Anhaengen: **Ja**
   - Anhaenge einschliessen: **Ja**
4. **Neuer Schritt: Auf jedes anwenden** (*Apply to each*), Eingabe: **Anhaenge** (dynamischer Inhalt aus dem Trigger).
5. Darin **Bedingung** (*Condition*), alles muss erfuellt sein:
   - `Ist Inline` ist gleich `false` (schliesst Logos und Signaturbilder aus)
   - `Name` endet auf `.pdf` (Ausdruck: `endsWith(toLower(items('Auf_jedes_anwenden')?['name']), '.pdf')`; der Schrittname kann bei dir anders heissen)
6. Im Zweig **Ja**: Aktion **Google Drive: Datei erstellen** (*Create file*). Beim ersten Mal die Verbindung mit dem Google-Konto herstellen.
   - Ordnerpfad: `/01 Finanzen/Buchhaltung/Mail-Eingang`
   - Dateiname: **Name** des Anhangs (nicht aendern, nicht ergaenzen)
   - Dateiinhalt: **Inhaltsbytes** des Anhangs (*Content Bytes*)
7. Speichern. Rechts oben **Test**, dann eine echte Rechnungsmail an `rechnungen@` schicken oder eine bestehende Mail erneut in den Ordner Eingang ziehen.

Hinweis zur Lizenz: Der Google-Drive-Connector kann je nach Lizenz als Premium-Connector gelten. Das siehst du direkt im Editor (Raute-Symbol). Falls ja, gibt es zwei Auswege: Zapier oder Make (gleiches Prinzip: Outlook-Trigger, Drive-Aktion; die kostenlosen Tarife reichen fuer etwa 50 Mails mit Anhang im Monat knapp aus) oder die Lizenz klaeren.

Getestet am 17.10.2026: Das **Verschieben** einer Mail vom Posteingang in den Ordner Eingang loest den Flow aus, die PDF landet mit Originalnamen im Sammelordner. Der Flow muss dafuer **eingeschaltet** sein (nicht nur im Testmodus).

## 3. Pruefen
- Im Flow unter **Ausfuehrungsverlauf** muss der Lauf **Erfolgreich** sein.
- Im Drive muss die PDF mit dem Originalnamen im Ordner `Mail-Eingang` liegen.
- Doppelte Namen entstehen, wenn dieselbe Rechnung zweimal ankommt. Das ist gewollt (nicht ueberschreiben). Claude erkennt Doppelte beim Abgleich am Inhalt.

## 4. Einmalig: Mails ab 1. Oktober nachholen
Der Flow reagiert nur auf **neue** Mails. Fuer bereits eingegangene Mails ein zweiter, einmaliger Flow:
1. **Erstellen > Sofortiger Cloud-Flow** (manuell ausloesen).
2. Aktion **E-Mails abrufen (V3)** (*Get emails (V3)*): Ordner `Eingang`, Original-Postfach `rechnungen@munichflavour.de`, Abrufen: nur mit Anhaengen, Anhaenge einschliessen, Filterabfrage `receivedDateTime ge 2026-10-01T00:00:00Z`, Maximale Anzahl 200.
3. **Auf jedes anwenden** ueber die E-Mails, darin **Auf jedes anwenden** ueber die Anhaenge, darin dieselbe Bedingung und **Datei erstellen** wie oben.
4. Einmal ausfuehren, danach den Flow ausschalten.

## 5. Wenn etwas nicht klappt
- **Trigger feuert nicht:** Mails, die per Postfachregel in den Ordner Eingang verschoben werden, loesen den Trigger manchmal verzoegert oder nicht aus. Dann den Trigger auf den **Posteingang** stellen und im Flow nach Absender oder Betreff filtern, oder die Regel so aendern, dass die Mail in den Ordner **kopiert** statt verschoben wird. Im Zweifel Test mit einer Mail machen.
- **Kein Zugriff auf das geteilte Postfach:** Das Konto, mit dem der Flow laeuft, braucht Vollzugriff oder Lesen/Verwalten auf `rechnungen@`.
- **Flow faellt aus:** Verbindungen laufen mit deinem Konto. Aendert sich das Passwort oder verlaesst eine Person das Unternehmen, muss die Verbindung neu bestaetigt werden. Unter *Meine Flows > Details* kann man Benachrichtigungen bei Fehlern einschalten.
- **Datenschutz:** Der Flow darf nur lesen und in diesen einen Drive-Ordner schreiben. Nichts weiterleiten.

## 6. Danach
Sag Claude Bescheid, dass der Ordner `Mail-Eingang` existiert. Beim naechsten Monatsabschluss wird er als Quelle fuer Mail-Rechnungen genutzt.
