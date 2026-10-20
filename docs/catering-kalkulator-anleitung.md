# Catering-Kalkulator: Kurzanleitung

Nur für Admins. Im Admin-Bereich oben auf **Kalkulator** tippen.

## Einmalig: Speisen einrichten
1. Reiter **Speisen**. Beim ersten Mal auf **Salate (Kugler) anlegen** tippen. Das legt die Salate der Menükarte mit Kugler-Gebinden und Artikelnummern an.
2. Jede Speise antippen und prüfen:
   - **Füllmenge pro Glas (g)**: Die vorbelegten Werte sind aus der Bestellübersicht vom 20.10.2026 zurückgerechnet. Bitte prüfen.
   - **Gebinde / Bestellschritt (g)**: Die Bestellmenge wird auf ein Vielfaches aufgerundet. Leer lassen, wenn nicht gerundet werden soll.
   - **Garnitur pro Glas**: Name, Menge pro Glas, Einheit und optional Gebinde. Eine leere Menge bedeutet "offen" und wird nie als 0 gerechnet.
3. Fehlt etwas, meldet das Tool "unvollständig", statt eine scheinbar fertige Liste zu erzeugen.

## Für jedes Event
1. Reiter **Bestellungen**, **Neue Bestellung**, **Aus Rentman**. Projekt suchen und antippen.
2. **Block wählen**, dessen Speisen berechnet werden sollen (z. B. "Speisen im Weckglas"). Die Gästezahl kommt aus der Menge des Blocks, die Quelle steht darunter. Mehrere Blöcke werden **nicht** addiert. Weichen sie voneinander ab, trägst du die Gästezahl selbst ein.
3. **Gläser pro Person** eintragen (kein Standardwert), **Bestellung anlegen**.
4. Auf der Bestellseite jede Rentman-Zeile einer Speise zuordnen. Das Tool macht einen **Vorschlag**, den du mit **Übernehmen** bestätigst. Die Zuordnung wird gespeichert und beim nächsten Mal automatisch genutzt.
5. **Gläser pro Speise** eintragen oder **Gläser gleichmäßig verteilen** tippen. Oben steht, wie viele Gläser verteilt sind und wie viele laut Gästezahl nötig wären.
6. **Speichern**. Darunter steht das Ergebnis: Einkaufsliste mit Bestellmenge, Bedarf, Artikelnummer und Garnitur. Der Rechenweg steht bei jeder Speise.
7. **PDF Bestellung** (Anzahl, Gericht, Menge, Garnitur) oder **PDF Einkauf** (nach Lieferant, mit Abhak-Kästchen).
8. **Garnitur-Menge von Hand festlegen:** In der Einkaufsliste hat jede Garnitur einen Knopf **Menge festlegen** bzw. **Menge ändern**. Damit gibst du die Gesamtmenge für diese Bestellung selbst an (z. B. 1 Stück, Bemerkung "1 Bund", oder 100 g). Sie ersetzt die berechnete Menge, wird nicht auf ein Gebinde gerundet und macht auch eine noch offene Menge pro Glas vollständig. Mit **Zurücksetzen** gilt wieder die Berechnung. Das PDF kennzeichnet solche Mengen als "manuell festgelegt".
9. **Abschließen** friert das Ergebnis ein. Spätere Änderungen an den Speisen verändern es nicht. Mit **Wieder öffnen** lässt es sich neu rechnen.

## Wichtige Regeln
- Rentman wird nur gelesen, nie geändert.
- Fehlende Angaben (Gästezahl, Füllmenge, Garnitur-Menge, Zuordnung) machen die Bestellung **unvollständig**. Das PDF trägt dann eine rote Warnung, Abschließen ist gesperrt.
- Gebinde: Es wird mit **einem** Gebinde je Speise gerechnet (dem Hauptgebinde). Kombinationen mehrerer Gebinde werden nicht berechnet.
- Zwei Personen, die gleichzeitig dieselbe Bestellung oder Speise ändern: Die zweite Änderung wird abgelehnt und nicht stillschweigend überschrieben. Dann neu laden.
- Brotzeit und Desserts sind noch nicht enthalten.

## Wenn etwas nicht klappt
- "Rentman ist nicht angebunden": Die Variable `RENTMAN_API` fehlt im Portal-Dienst.
- "Die Rentman-Verbindung ist derzeit nicht verfügbar": später erneut versuchen. Bereits gespeicherte Bestellungen sind davon nicht betroffen.
- Mit **Rentman** (oberer Reiter) lassen sich Projektliste und Rohdaten eines Projekts ansehen.
