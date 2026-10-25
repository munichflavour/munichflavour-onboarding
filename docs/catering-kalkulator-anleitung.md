# Catering-Kalkulator: Kurzanleitung

Nur für Admins und zusätzlich **passwortgeschützt**, solange der Kalkulator in Entwicklung ist. Im Admin-Bereich den Reiter **Programme** öffnen und **Catering-Kalkulator 🔒** antippen, dann das Passwort eingeben. Es gilt für die aktuelle Anmeldung. Mit dem Knopf 🔒 oben im Kalkulator sperrst du ihn sofort wieder. Über **← Programme** oben rechts im Kalkulator kommst du zurück.

## Einmalig: Speisen einrichten
1. Reiter **Speisen**. Beim ersten Mal auf **Salate (Kugler) anlegen** tippen. Das legt die Salate der Menükarte mit Kugler-Gebinden und Artikelnummern an.
2. Jede Speise antippen und prüfen. Eine Speise hat eine **Speisenart** (Salat im Glas oder Brotzeit), **Zutaten** und **Garnituren**:
   - **Zutaten** sind die Einkaufsartikel pro Portion, zum Beispiel der fertige Salat, Brot oder Frischkäse. Jede Zutat hat Menge pro Portion, Einheit, optional Gebinde und Artikelnummer. Die vorbelegten Salat-Mengen sind aus der Bestellübersicht vom 20.10.2026 zurückgerechnet, bitte prüfen. Gleiche Zutaten verschiedener Speisen werden zusammengezählt und erst dann auf das Gebinde aufgerundet.
   - **Garnituren** sind die Deko pro Portion (z. B. Radieschen, Dill). Eine leere Menge bedeutet "offen" und wird nie als 0 gerechnet.
   - **Lieferant** ist bei jeder Zutat und Garnitur frei wählbar, aber nicht verpflichtend, so kannst du Artikel auch mal im Supermarkt besorgen. Ohne Lieferant steht der Artikel unter "Ohne Lieferant" auf der Einkaufsliste. Es gibt dazu einen Hinweis, die Bestellung bleibt aber vollständig. Ein Artikel bekommt nie stillschweigend einen Lieferanten.
3. Fehlt etwas, meldet das Tool "unvollständig", statt eine scheinbar fertige Liste zu erzeugen.

## Für jedes Event
1. Reiter **Bestellungen**, **Neue Bestellung**, **Aus Rentman**. Projekt suchen und antippen. Angezeigt werden nur Projekte, die **Speisen enthalten** (ein Block der Materialgruppe "Catering" mit Speisen darunter). Bar-, Kaffee- und Smoothie-Projekte ohne Essen erscheinen nicht. Das Ergebnis wird 10 Minuten gemerkt. Wenn du in Rentman etwas geändert hast, tippe auf **Aktualisieren**.
2. **Block wählen**, dessen Speisen berechnet werden sollen (z. B. "Speisen im Weckglas"). Die Gästezahl kommt aus der Menge des Blocks, die Quelle steht darunter. Mehrere Blöcke werden **nicht** addiert. Weichen sie voneinander ab, trägst du die Gästezahl selbst ein.
3. **Gläser pro Person** (Salate) und **Halbe Scheiben pro Person** (Brotzeit) eintragen, kein Standardwert, nur für die Speisenarten, die dabei sind. **Bestellung anlegen**.
4. Die Speisen aus Rentman werden **automatisch** den Speisen deines Katalogs zugeordnet, wenn der Name gleich ist oder der Katalogname am Anfang des Rentman-Namens steht (z. B. Katalog "Kartoffel-Gurken-Salat", Rentman "Kartoffel-Gurken-Salat mit Fleischpflanzerl"). Ist es nicht eindeutig oder fehlt die Speise im Katalog, bleibt die Zeile offen. Bei ähnlichen Namen erscheint ein **Vorschlag**, den du mit **Übernehmen** bestätigst, oder du wählst die Speise selbst. Die Zuordnung wird gemerkt und beim nächsten Mal wieder genutzt. Wählst du eine andere Speise, gilt künftig deine Auswahl.
5. Die **Portionen werden automatisch gleichmäßig** auf die Speisen verteilt (Gäste x Portionen pro Person, getrennt für Gläser und Brote). Ändert du eine Zahl selbst, bleibt sie stehen. Mit **Automatisch gleichmäßig verteilen** rechnet das Tool wieder neu. Oben steht, wie viele Portionen verteilt sind und wie viele laut Gästezahl nötig wären.
6. Die Seite **speichert und rechnet automatisch**, kurz nachdem du etwas änderst. Unten steht "Gespeichert ✓". Darunter steht das Ergebnis: Einkaufsliste mit Bestellmenge, Bedarf, Artikelnummer und Garnitur. Der Rechenweg steht bei jeder Speise. Gelb markierte Hinweise zeigen, was noch offen ist. Der Knopf **Speichern** erzwingt das Speichern sofort.
7. **PDF Einkaufsliste**: Es gibt genau eine vollständige Liste, nach **Lieferanten aufgeteilt**. Jeder Lieferant steht auf einer eigenen Seite mit Projektkopf (Projekt, Datum, Gäste, Portionen), sodass sich jede Seite einzeln weitergeben lässt. Pro Artikel stehen Artikelnummer, Einkaufsmenge, die Zusammensetzung (z. B. "22 x 40 g = 880 g" oder "22 x ½ + 19 x 1"), ein Abhak-Kästchen und Platz für eine Bemerkung. Artikel ohne Lieferant stehen auf der letzten Seite unter "Ohne Lieferant"; dazu gibt es einen Hinweis.
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
- Bei Datenproblemen zeigt die versteckte Seite `/catering/#/rentman` Projektliste und Rohdaten eines Projekts (nur für die Fehlersuche, nicht in der Navigation).
