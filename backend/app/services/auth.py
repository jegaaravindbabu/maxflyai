"""
Supabase auth. Verifies the access token from the Authorization header.

- auth_enabled=False (dev): auth is off, current_user() returns None, everything open.
- auth_enabled=True: a valid Supabase JWT is required.
    * Modern projects sign with asymmetric keys -> verified via the project JWKS.
    * Legacy projects sign HS256 -> verified with SUPABASE_JWT_SECRET.

Returns the Supabase user id (the token's `sub`).

Admin: emails listed in ADMIN_EMAILS get superadmin access -- they bypass the
per-user project filter and ownership guard, so they see & manage every project.
"""
from __future__ import annotations

from functools import lru_cache

from fastapi import Depends, HTTPException, Request

from app.config import settings


@lru_cache
def _jwk_client():
    import jwt
    url = settings.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"
    return jwt.PyJWKClient(url)


def _verify(token: str) -> dict:
    import jwt
    # HS256 (legacy shared secret) takes precedence if configured
    if settings.supabase_jwt_secret:
        return jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"],
                          audience="authenticated")
    # otherwise verify the asymmetric signature via JWKS
    signing_key = _jwk_client().get_signing_key_from_jwt(token)
    return jwt.decode(token, signing_key.key, algorithms=["ES256", "RS256"],
                      audience="authenticated")


def claims(request: Request) -> dict | None:
    """Verify the bearer token once per request and return its payload.

    Returns None when auth is disabled (dev / open mode)."""
    if not settings.auth_enabled:
        return None

    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    token = auth.split(" ", 1)[1].strip()

    try:
        import jwt  # noqa: F401  (PyJWT)
    except ImportError:
        raise HTTPException(500, "PyJWT not installed")

    try:
        payload = _verify(token)
    except Exception as e:
        raise HTTPException(401, f"invalid token: {e}")
    if not payload.get("sub"):
        raise HTTPException(401, "token has no subject")
    return payload


def current_user(payload: dict | None = Depends(claims)) -> str | None:
    """Supabase user id (sub), or None when auth is disabled."""
    return payload.get("sub") if payload else None


def require_user(user: str | None = Depends(current_user)) -> str:
    if user is None:
        return "dev"   # auth disabled
    return user


def is_admin(payload: dict | None = Depends(claims)) -> bool:
    """True when the signed-in user's email is on the ADMIN_EMAILS allowlist."""
    if payload is None:
        return False   # auth off -> project list is already unfiltered
    email = (payload.get("email") or "").strip().lower()
    return bool(email) and email in settings.admin_email_list
