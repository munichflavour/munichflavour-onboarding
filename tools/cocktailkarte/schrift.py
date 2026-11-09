"""Pinselschrift ("Active") der Karten.

Ist die vollstaendige Schriftdatei vorhanden (Datei Active-Regular.otf im Datenordner, siehe `volle_schrift` in
cocktailkarte.py), wird sie verwendet. Sie ist urheberrechtlich geschuetzt und gehoert deshalb nicht ins Repository.

Ohne sie liegt die Schrift nur als Auszug vor: pro Vorlage (assets/<karte>/label*.ttf) enthaelt sie genau die Buchstaben, die auf
der jeweiligen fertigen Karte vorkommen. Alle Auszuege stammen aus derselben Schrift, deshalb werden Buchstaben
einzeln aus der ersten Datei geholt, die sie enthaelt (zuerst die der eigenen Vorlage). Damit lassen sich auch Woerter
setzen, die auf keiner einzelnen Karte vorkommen, solange jeder Buchstabe irgendwo vorkommt.
"""
import io
from pathlib import Path

import pymupdf


_teil_cache = {}


def teilschrift(pfad, text):
    """Bytes der Schrift `pfad`, verkleinert auf die Zeichen von `text` (fontTools). None, wenn das nicht moeglich ist."""
    key = (str(pfad), "".join(sorted(set(text))))
    if key not in _teil_cache:
        try:
            from fontTools import subset
            from fontTools.ttLib import TTFont
            opt = subset.Options()
            opt.layout_features, opt.name_IDs, opt.hinting, opt.notdef_outline, opt.glyph_names = [], [1, 2, 3, 4, 6], False, True, False
            font = TTFont(str(pfad))
            teil = subset.Subsetter(opt)
            teil.populate(text="".join(key[1]) + " ")
            teil.subset(font)
            buf = io.BytesIO()
            font.save(buf)
            _teil_cache[key] = buf.getvalue()
        except Exception:
            _teil_cache[key] = None
    return _teil_cache[key]


class Pinsel:
    def __init__(self, page, vorlage_dir, volle_schrift=None, warn=None, nachbarn=True):
        eigene = sorted(vorlage_dir.glob("label*.ttf"))
        # Auszuege anderer Vorlagen als Reserve (gleiche Schrift); beim neuen Design (andere Schrift) nicht
        fremde = [p for p in sorted(vorlage_dir.parent.glob("*/label*.ttf")) if p.parent != vorlage_dir] if nachbarn else []
        pfade = eigene + fremde
        if volle_schrift:                       # vollstaendige Schrift hat Vorrang, die Auszuege bleiben als Reserve
            if teilschrift(volle_schrift, "A"):  # nur nutzen, wenn sie sich verkleinern laesst (Lizenz: nie komplett einbetten)
                pfade = [Path(volle_schrift)] + pfade
            elif warn:
                warn("Die vollstaendige Pinselschrift kann ohne das Paket fonttools nicht verkleinert werden und wird "
                     "deshalb nicht verwendet (pip install fonttools).")
        self.page = page
        self.fonts = []   # (Datei, Font, Zeichenmenge)
        self.zaehler = 0
        for pfad in pfade:
            f = pymupdf.Font(fontfile=str(pfad))
            self.fonts.append((pfad, f, set(chr(c) for c in f.valid_codepoints())))

    def _font(self, c):
        return next(((p, f) for p, f, z in self.fonts if c in z), None)

    def kann(self, text):
        """True, wenn jeder Buchstabe des Textes in der Pinselschrift vorhanden ist (Leerzeichen ausgenommen)."""
        return all(c == " " or self._font(c) for c in text)

    def _schritt(self, c, size):
        if c == " ":                           # Leerzeichen-Breite der Schrift, falls sie eines enthaelt
            f = next((f for _, f, z in self.fonts if " " in z), None)
            return f.text_length(" ", fontsize=size) if f else size * 0.35
        return self._font(c)[1].text_length(c, fontsize=size)

    def laenge(self, text, size, abstand):
        return sum(self._schritt(c, size) for c in text) + abstand * (len(text) - 1)

    def schreibe(self, x, y, text, size, abstand, farbe, vertikal=False):
        """Setzt den Text Buchstabe fuer Buchstabe.

        Horizontal: (x, y) = linker Rand und Grundlinie. Vertikal (um 90 Grad gedreht, von unten nach oben):
        (x, y) = Grundlinie in x-Richtung und Startpunkt unten.
        Je Aufruf wird pro verwendeter Schriftdatei nur ein Auszug mit genau diesen Zeichen in die PDF eingebettet.
        """
        je_datei = {}
        for c in text:
            if c != " ":
                je_datei.setdefault(self._font(c)[0], set()).add(c)
        namen = {}
        for pfad, zeichen in je_datei.items():
            self.zaehler += 1
            name = f"pinsel{self.zaehler}"
            puffer = teilschrift(pfad, "".join(zeichen))
            if puffer:
                self.page.insert_font(fontname=name, fontbuffer=puffer)
            else:
                self.page.insert_font(fontname=name, fontfile=str(pfad))   # nur kleine Auszuege landen hier
            namen[pfad] = name
        for c in text:
            if c != " ":
                name = namen[self._font(c)[0]]
                if vertikal:
                    self.page.insert_text(pymupdf.Point(x, y), c, fontname=name, fontsize=size, color=farbe, rotate=90)
                else:
                    self.page.insert_text((x, y), c, fontname=name, fontsize=size, color=farbe)
            schritt = self._schritt(c, size) + abstand
            if vertikal:
                y -= schritt
            else:
                x += schritt


def pdf_bytes(doc, warn=None):
    """PDF-Bytes. (Die Schriften sind bereits beim Einbetten auf die verwendeten Zeichen verkleinert.)"""
    return doc.tobytes(garbage=4, deflate=True)
