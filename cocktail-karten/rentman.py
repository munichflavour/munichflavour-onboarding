"""Schlanker, eigenstaendiger Client fuer die Rentman REST-API (api.rentman.net).

Bearer-Token, Offset-Pagination (max. 300 pro Seite), Wiederholung bei 429.
Es wird ausschliesslich gelesen (GET).
"""
from __future__ import annotations

import os
import time

import requests

BASE_URL = os.getenv("RENTMAN_BASE_URL", "https://api.rentman.net").rstrip("/")
PAGE_LIMIT = 300  # Rentman-Maximum pro Seite
MAX_RETRIES = 5


def ref_id(ref: str | None) -> int | None:
    """'/contacts/4158' -> 4158 ; None -> None."""
    if not ref:
        return None
    try:
        return int(str(ref).rstrip("/").split("/")[-1])
    except (ValueError, AttributeError):
        return None


class RentmanClient:
    def __init__(self, token: str):
        if not token:
            raise ValueError("RENTMAN_TOKEN fehlt (in .env eintragen).")
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        })

    def _request(self, path: str, params: dict) -> dict:
        url = f"{BASE_URL}/{path.lstrip('/')}"
        for attempt in range(MAX_RETRIES):
            resp = self.session.get(url, params=params, timeout=30)
            if resp.status_code == 429 and attempt < MAX_RETRIES - 1:
                wait = float(resp.headers.get("Retry-After", 2))
                time.sleep(min(wait, 30))
                continue
            resp.raise_for_status()
            return resp.json()
        raise RuntimeError("unerreichbar")  # pragma: no cover

    def get_all(self, path: str, params: dict | None = None) -> list[dict]:
        """Holt alle Datensaetze eines Endpunkts (Offset-Pagination)."""
        results: list[dict] = []
        offset = 0
        while True:
            page = dict(params or {}, limit=PAGE_LIMIT, offset=offset)
            batch = self._request(path, page).get("data", [])
            results.extend(batch)
            if len(batch) < PAGE_LIMIT:
                return results
            offset += PAGE_LIMIT

    # --- Endpunkte ---
    def projects(self) -> list[dict]:
        return self.get_all("projects")

    def contacts(self) -> list[dict]:
        return self.get_all("contacts")

    def contactpersons(self) -> list[dict]:
        return self.get_all("contactpersons")

    def statuses(self) -> list[dict]:
        return self.get_all("statuses")

    def equipment(self) -> list[dict]:
        return self.get_all("equipment")

    def folders(self) -> list[dict]:
        return self.get_all("folders")

    def project_equipment(self, project_id: int) -> tuple[list[dict], str]:
        """Material eines Projekts. Gibt (Zeilen, genutzter Endpunkt) zurueck.

        Probiert zuerst den verschachtelten Pfad, dann den Filter.
        """
        wanted = f"/projects/{project_id}"
        attempts = [
            (f"projects/{project_id}/projectequipment", None),
            ("projectequipment", {"project": wanted}),
        ]
        last_error = ""
        for path, params in attempts:
            try:
                rows = self.get_all(path, params)
            except requests.HTTPError as exc:
                last_error = f"{path}: {exc}"
                print(f"  ! {last_error}")
                continue
            # Falls der Server den Filter ignoriert hat, hier nochmal eingrenzen.
            if rows and all("project" in r for r in rows):
                rows = [r for r in rows if r.get("project") == wanted]
            return rows, path
        raise RuntimeError(f"Material nicht ladbar. Letzter Fehler: {last_error}")
