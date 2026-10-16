#!/usr/bin/env python3
"""Macht aus heruntergeladenen Drive-PDFs einen Textindex (pdftotext, bei Scans lokale Texterkennung).

Aufruf:  python3 indexiere.py <ordner_mit_download-json> <ziel_ordner>
Die Download-JSONs stammen vom Drive-Connector (download_file_content, Felder content/title/mimeType).
Kontoauszuege werden nach <ziel>/konto/ kopiert, alles andere nach <ziel>/pdf/ und in <ziel>/index.json erfasst.
"""
import base64, glob, json, os, subprocess, sys, tempfile


def pdf_text(pfad):
    return subprocess.run(["pdftotext", "-layout", pfad, "-"], capture_output=True, text=True).stdout


_ocr = None


def ocr_text(pfad):
    """Scan ohne Textebene: eingebettete Bilder ziehen und lokal erkennen (RapidOCR)."""
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR()
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdfimages", "-j", pfad, os.path.join(tmp, "img")], capture_output=True)
        teile = []
        for bild in sorted(glob.glob(os.path.join(tmp, "img*"))):
            res, _ = _ocr(bild)
            teile += [r[1] for r in (res or [])]
        return "\n".join(teile)


def main(quelle, ziel):
    os.makedirs(os.path.join(ziel, "pdf"), exist_ok=True)
    os.makedirs(os.path.join(ziel, "konto"), exist_ok=True)
    idx_pfad = os.path.join(ziel, "index.json")
    index = json.load(open(idx_pfad, encoding="utf-8")) if os.path.exists(idx_pfad) else {}
    neu = 0
    for f in sorted(glob.glob(os.path.join(quelle, "*download_file_content*.txt"))):
        try:
            d = json.load(open(f, encoding="utf-8"))
            titel, daten = d["title"], base64.b64decode(d["content"])
        except Exception:
            continue
        if not titel.lower().endswith(".pdf"):
            continue
        if titel.startswith("Kontoauszug"):
            open(os.path.join(ziel, "konto", titel), "wb").write(daten)
            continue
        if titel in index:
            continue
        pfad = os.path.join(ziel, "pdf", titel)
        open(pfad, "wb").write(daten)
        text, art = pdf_text(pfad), "pdf"
        if len(text.strip()) < 40:
            text, art = ocr_text(pfad), "ocr"
        index[titel] = {"id": d.get("id", ""), "art": art, "text": text}
        neu += 1
    json.dump(index, open(idx_pfad, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"{neu} neu indexiert, {len(index)} gesamt "
          f"({sum(1 for v in index.values() if v['art']=='ocr')} per Texterkennung)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
