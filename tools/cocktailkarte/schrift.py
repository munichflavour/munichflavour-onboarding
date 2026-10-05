"""Pinselschrift ("Active") der Karten.

Die Schrift liegt nur als Auszug vor: pro Vorlage (assets/<karte>/label*.ttf) enthaelt sie genau die Buchstaben, die auf
der jeweiligen fertigen Karte vorkommen. Alle Auszuege stammen aus derselben Schrift, deshalb werden Buchstaben
einzeln aus der ersten Datei geholt, die sie enthaelt (zuerst die der eigenen Vorlage). Damit lassen sich auch Woerter
setzen, die auf keiner einzelnen Karte vorkommen, solange jeder Buchstabe irgendwo vorkommt.
"""
import pymupdf


class Pinsel:
    def __init__(self, page, vorlage_dir):
        eigene = sorted(vorlage_dir.glob("label*.ttf"))
        fremde = [p for p in sorted(vorlage_dir.parent.glob("*/label*.ttf")) if p.parent != vorlage_dir]
        self.page = page
        self.fonts = []   # (Name auf der Seite, Font, Zeichenmenge)
        for i, pfad in enumerate(eigene + fremde):
            f = pymupdf.Font(fontfile=str(pfad))
            name = f"pinsel{i}"
            page.insert_font(name, str(pfad))
            self.fonts.append((name, f, set(chr(c) for c in f.valid_codepoints())))

    def _font(self, c):
        return next(((n, f) for n, f, z in self.fonts if c in z), None)

    def kann(self, text):
        """True, wenn jeder Buchstabe des Textes in der Pinselschrift vorhanden ist (Leerzeichen ausgenommen)."""
        return all(c == " " or self._font(c) for c in text)

    def _schritt(self, c, size):
        if c == " ":
            return size * 0.35
        return self._font(c)[1].text_length(c, fontsize=size)

    def laenge(self, text, size, abstand):
        return sum(self._schritt(c, size) for c in text) + abstand * (len(text) - 1)

    def schreibe(self, x, y, text, size, abstand, farbe, vertikal=False):
        """Setzt den Text Buchstabe fuer Buchstabe.

        Horizontal: (x, y) = linker Rand und Grundlinie. Vertikal (um 90 Grad gedreht, von unten nach oben):
        (x, y) = Grundlinie in x-Richtung und Startpunkt unten.
        """
        for c in text:
            if c != " ":
                name = self._font(c)[0]
                if vertikal:
                    self.page.insert_text(pymupdf.Point(x, y), c, fontname=name, fontsize=size, color=farbe, rotate=90)
                else:
                    self.page.insert_text((x, y), c, fontname=name, fontsize=size, color=farbe)
            schritt = self._schritt(c, size) + abstand
            if vertikal:
                y -= schritt
            else:
                x += schritt
