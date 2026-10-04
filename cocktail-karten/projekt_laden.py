"""Cocktail-Karten, Schritt 1: Projekt aus Rentman laden und Material auflisten.

Nur lesen: Es wird nichts in Rentman veraendert.

Aufruf:
    python projekt_laden.py "Daniel Böttcher"

Ergebnis in output/:
    projekt_<id>.md              lesbare Uebersicht (Material nach Ordner)
    projekt_<id>_rohdaten.json   Rohdaten aus der API (zum Auswerten)
"""
from __future__ import annotations

import json
import os
import sys

from dotenv import load_dotenv

from rentman import RentmanClient, ref_id

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "output")
MAX_PROJECTS = 3  # so viele Treffer (neueste zuerst) werden ausgewertet


def norm(text: str) -> str:
    """Kleinschreibung, Umlaute aufgeloest: 'Böttcher' == 'boettcher'."""
    t = str(text).casefold()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        t = t.replace(a, b)
    return t


def blob(record: dict) -> str:
    """Alle Textfelder eines Datensatzes als ein durchsuchbarer String."""
    return norm(" ".join(v for v in record.values() if isinstance(v, str)))


def refs(record: dict, kind: str) -> set[int]:
    """Alle IDs, auf die der Datensatz per '/<kind>/<id>' verweist."""
    found = set()
    for v in record.values():
        if isinstance(v, str) and v.startswith(f"/{kind}/"):
            rid = ref_id(v)
            if rid is not None:
                found.add(rid)
    return found


def find_projects(client: RentmanClient, term: str) -> list[dict]:
    words = [norm(w) for w in term.split() if w.strip()]
    projects = client.projects()
    contacts = client.contacts()
    persons = client.contactpersons()

    def search(ws: list[str]) -> list[dict]:
        contact_ids = {c["id"] for c in contacts if all(w in blob(c) for w in ws)}
        person_ids = {p["id"] for p in persons if all(w in blob(p) for w in ws)}
        for p in persons:  # Ansprechpartner -> zugehoeriger Kunde
            if p["id"] in person_ids:
                contact_ids |= refs(p, "contacts")
        return [
            pr for pr in projects
            if all(w in blob(pr) for w in ws)
            or refs(pr, "contacts") & contact_ids
            or refs(pr, "contactpersons") & person_ids
        ]

    hits = search(words)
    if not hits and len(words) > 1:  # Fallback: nur der Nachname
        print(f"Kein Treffer fuer '{term}', versuche nur '{words[-1]}' ...")
        hits = search([words[-1]])

    def start(pr: dict) -> str:
        return str(pr.get("planperiod_start") or pr.get("usageperiod_start") or "")

    return sorted(hits, key=start, reverse=True)


def folder_paths(folders: list[dict]) -> dict[int, str]:
    by_id = {f["id"]: f for f in folders}

    def path(fid: int, seen: tuple = ()) -> str:
        f = by_id.get(fid)
        if not f or fid in seen:
            return ""
        name = f.get("displayname") or f.get("name") or str(fid)
        parent = ref_id(f.get("parent"))
        up = path(parent, seen + (fid,)) if parent else ""
        return f"{up} / {name}" if up else name

    return {fid: path(fid) for fid in by_id}


def build_report(project: dict, status_name: str, rows: list[dict],
                 catalog: dict[int, dict], paths: dict[int, str],
                 endpoint: str) -> str:
    title = project.get("displayname") or project.get("name") or project["id"]
    lines = [
        f"# {title}",
        "",
        f"- Projekt-ID: {project['id']}  (Nr. {project.get('number', '?')})",
        f"- Status: {status_name}",
        f"- Zeitraum: {project.get('planperiod_start', '?')} bis "
        f"{project.get('planperiod_end', '?')}",
        f"- Material-Zeilen: {len(rows)}  (Endpunkt: `{endpoint}`)",
        "",
    ]

    grouped: dict[str, list[str]] = {}
    for r in rows:
        eq = catalog.get(ref_id(r.get("equipment")) or -1, {})
        folder = paths.get(ref_id(eq.get("folder")) or -1, "") or "(ohne Ordner)"
        name = r.get("name") or eq.get("displayname") or eq.get("name") or "?"
        qty = r.get("quantity", "?")
        remark = r.get("remark") or ""
        line = f"- {qty} x {name}" + (f"  _({remark})_" if remark else "")
        grouped.setdefault(folder, []).append(line)

    lines.append("## Material nach Ordner")
    for folder in sorted(grouped, key=str.casefold):
        lines += ["", f"### {folder}", *grouped[folder]]

    hits = [
        ln for folder, items in grouped.items() for ln in items
        if "cocktail" in norm(folder) or "cocktail" in norm(ln)
    ]
    lines += ["", "## Treffer mit 'cocktail' in Name oder Ordner"]
    lines += hits or ["(keine)"]
    return "\n".join(lines) + "\n"


def main() -> int:
    load_dotenv(os.path.join(HERE, ".env"))
    term = " ".join(sys.argv[1:]).strip() or "Daniel Böttcher"
    client = RentmanClient(os.getenv("RENTMAN_TOKEN", "").strip())
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f"Suche Projekte zu '{term}' ...")
    hits = find_projects(client, term)
    if not hits:
        print("Keine Projekte gefunden.")
        return 1

    print(f"{len(hits)} Treffer (neueste zuerst):")
    for pr in hits:
        print(f"  - {pr['id']}: {pr.get('displayname') or pr.get('name')} "
              f"({pr.get('planperiod_start', '?')})")

    statuses = {s["id"]: s.get("displayname") or s.get("name")
                for s in client.statuses()}
    print("Lade Artikelkatalog und Ordner ...")
    catalog = {e["id"]: e for e in client.equipment()}
    paths = folder_paths(client.folders())

    for pr in hits[:MAX_PROJECTS]:
        pid = pr["id"]
        print(f"\nProjekt {pid}: lade Material ...")
        try:
            rows, endpoint = client.project_equipment(pid)
        except RuntimeError as exc:
            print(f"  ! {exc}")
            continue

        status_name = statuses.get(ref_id(pr.get("status")), "?")
        report = build_report(pr, status_name, rows, catalog, paths, endpoint)
        used = {ref_id(r.get("equipment")) for r in rows}
        raw = {
            "project": pr,
            "status": status_name,
            "endpoint": endpoint,
            "projectequipment": rows,
            "equipment_catalog": [catalog[i] for i in used if i in catalog],
            "folder_paths": {str(i): p for i, p in paths.items()},
        }
        with open(os.path.join(OUT_DIR, f"projekt_{pid}.md"), "w",
                  encoding="utf-8") as fh:
            fh.write(report)
        with open(os.path.join(OUT_DIR, f"projekt_{pid}_rohdaten.json"), "w",
                  encoding="utf-8") as fh:
            json.dump(raw, fh, ensure_ascii=False, indent=2)
        print(f"  -> output/projekt_{pid}.md ({len(rows)} Zeilen)")

    print("\nFertig. Dateien liegen in output/")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ValueError as exc:  # z.B. fehlender Token
        print(f"Fehler: {exc}")
        sys.exit(2)
