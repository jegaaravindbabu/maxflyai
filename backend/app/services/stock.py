"""Stock photo search. Uses Pexels when PEXELS_API_KEY is set, otherwise the
keyless Openverse API. Returns a normalized list of {id, thumb, url, alt}."""
from __future__ import annotations

import httpx

from app.config import settings


def search(query: str, per_page: int = 24) -> list[dict]:
    query = (query or "").strip()
    if not query:
        return []
    if settings.pexels_api_key:
        return _pexels(query, per_page)
    return _openverse(query, per_page)


def _pexels(query: str, per_page: int) -> list[dict]:
    try:
        with httpx.Client(timeout=20) as c:
            r = c.get("https://api.pexels.com/v1/search",
                      headers={"Authorization": settings.pexels_api_key},
                      params={"query": query, "per_page": per_page})
        if r.status_code >= 400:
            return []
        out = []
        for p in r.json().get("photos", []):
            src = p.get("src", {})
            out.append({"id": str(p.get("id")), "thumb": src.get("medium") or src.get("small"),
                        "url": src.get("large2x") or src.get("large") or src.get("original"),
                        "alt": p.get("alt") or query})
        return out
    except Exception:
        return []


def _openverse(query: str, per_page: int) -> list[dict]:
    try:
        with httpx.Client(timeout=20) as c:
            r = c.get("https://api.openverse.org/v1/images/",
                      params={"q": query, "page_size": min(per_page, 40),
                              "license_type": "commercial", "mature": "false"})
        if r.status_code >= 400:
            return []
        out = []
        for it in r.json().get("results", []):
            thumb = it.get("thumbnail") or it.get("url")
            full = it.get("url") or it.get("thumbnail")
            if not full:
                continue
            out.append({"id": str(it.get("id")), "thumb": thumb, "url": full,
                        "alt": it.get("title") or query})
        return out
    except Exception:
        return []
