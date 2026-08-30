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


def search_videos(query: str, per_page: int = 18) -> list[dict]:
    """Stock video search (Pexels Videos). Requires PEXELS_API_KEY; returns
    [] when no key is configured."""
    query = (query or "").strip()
    if not query or not settings.pexels_api_key:
        return []
    try:
        with httpx.Client(timeout=20) as c:
            r = c.get("https://api.pexels.com/videos/search",
                      headers={"Authorization": settings.pexels_api_key},
                      params={"query": query, "per_page": per_page})
        if r.status_code >= 400:
            return []
        out = []
        for v in r.json().get("videos", []):
            files = v.get("video_files", []) or []
            mp4s = [f for f in files if (f.get("file_type") == "video/mp4") and f.get("link")]
            if not mp4s:
                continue
            # prefer the largest file at or under 720p, else the smallest available
            under = [f for f in mp4s if (f.get("height") or 0) <= 720]
            pick = (max(under, key=lambda f: f.get("height") or 0) if under
                    else min(mp4s, key=lambda f: f.get("height") or 9999))
            out.append({"id": str(v.get("id")), "thumb": v.get("image"),
                        "url": pick["link"], "alt": query,
                        "duration": v.get("duration")})
        return out
    except Exception:
        return []
