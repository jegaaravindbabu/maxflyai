"""
Pluggable storage. Selected by STORAGE_BACKEND:
  local    - filesystem (dev default)
  supabase - Supabase Storage (private bucket, signed URLs)
  r2       - Cloudflare R2 (S3-compatible, no egress fees)

Media processing (ffmpeg) needs a real local file, so remote backends implement
`path(key)` by downloading to a local cache and returning that path.
"""
from __future__ import annotations

import os
import shutil
import tempfile
import uuid

import httpx

from app.config import settings

_CACHE_DIR = os.path.join(tempfile.gettempdir(), "maxfly_cache")
os.makedirs(_CACHE_DIR, exist_ok=True)


class LocalStorage:
    backend = "local"

    def __init__(self, base_dir: str):
        self.base = os.path.abspath(base_dir)
        os.makedirs(self.base, exist_ok=True)

    def save_upload(self, tmp_path: str, filename: str) -> str:
        key = f"{uuid.uuid4()}_{filename}"
        dest = os.path.join(self.base, key)
        shutil.copyfile(tmp_path, dest)
        return key

    def write_bytes(self, key: str, data: bytes) -> str:
        dest = os.path.join(self.base, key)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
        return key

    def path(self, key: str) -> str:
        return os.path.join(self.base, key)

    def url(self, key: str) -> str:
        return f"/media/{key}"


class SupabaseStorage:
    """Uses the Supabase Storage REST API with the service-role key."""
    backend = "supabase"

    def __init__(self, url: str, service_key: str, bucket: str):
        self.base = url.rstrip("/")
        self.key = service_key
        self.bucket = bucket
        self._h = {"Authorization": f"Bearer {service_key}"}

    def _obj_url(self, key: str) -> str:
        return f"{self.base}/storage/v1/object/{self.bucket}/{key}"

    def save_upload(self, tmp_path: str, filename: str) -> str:
        key = f"{uuid.uuid4()}_{filename}"
        with open(tmp_path, "rb") as f:
            data = f.read()
        with httpx.Client(timeout=300) as c:
            r = c.post(self._obj_url(key), headers={**self._h,
                       "Content-Type": "application/octet-stream", "x-upsert": "true"},
                       content=data)
        if r.status_code >= 400:
            raise RuntimeError(f"supabase upload failed {r.status_code}: {r.text[:200]}")
        return key

    def write_bytes(self, key: str, data: bytes) -> str:
        with httpx.Client(timeout=120) as c:
            r = c.post(self._obj_url(key), headers={**self._h,
                       "Content-Type": "application/octet-stream", "x-upsert": "true"},
                       content=data)
        if r.status_code >= 400:
            raise RuntimeError(f"supabase write failed {r.status_code}: {r.text[:200]}")
        return key

    def path(self, key: str) -> str:
        # download to local cache for ffmpeg
        local = os.path.join(_CACHE_DIR, key.replace("/", "_"))
        if os.path.exists(local) and os.path.getsize(local) > 0:
            return local
        os.makedirs(os.path.dirname(local) or _CACHE_DIR, exist_ok=True)
        with httpx.Client(timeout=300) as c:
            r = c.get(self._obj_url(key), headers=self._h)
        if r.status_code >= 400:
            raise RuntimeError(f"supabase download failed {r.status_code}: {r.text[:200]}")
        with open(local, "wb") as f:
            f.write(r.content)
        return local

    def url(self, key: str, expires_in: int = 3600) -> str:
        with httpx.Client(timeout=30) as c:
            r = c.post(f"{self.base}/storage/v1/object/sign/{self.bucket}/{key}",
                       headers={**self._h, "Content-Type": "application/json"},
                       json={"expiresIn": expires_in})
        if r.status_code >= 400:
            return ""
        signed = r.json().get("signedURL", "")
        return f"{self.base}/storage/v1{signed}" if signed else ""


class R2Storage:
    """Cloudflare R2 via the S3 API (boto3). No egress fees."""
    backend = "r2"

    def __init__(self, account_id, access_key, secret_key, bucket):
        import boto3  # imported lazily so it's optional
        self.bucket = bucket
        self.s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
        )

    def save_upload(self, tmp_path: str, filename: str) -> str:
        key = f"{uuid.uuid4()}_{filename}"
        self.s3.upload_file(tmp_path, self.bucket, key)
        return key

    def write_bytes(self, key: str, data: bytes) -> str:
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data)
        return key

    def path(self, key: str) -> str:
        local = os.path.join(_CACHE_DIR, key.replace("/", "_"))
        if not (os.path.exists(local) and os.path.getsize(local) > 0):
            self.s3.download_file(self.bucket, key, local)
        return local

    def url(self, key: str, expires_in: int = 3600) -> str:
        return self.s3.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in)


def get_storage():
    b = (settings.storage_backend or "local").lower()
    if b == "supabase" and settings.supabase_url and settings.supabase_service_role_key:
        return SupabaseStorage(settings.supabase_url,
                               settings.supabase_service_role_key,
                               settings.supabase_bucket)
    if b == "r2" and settings.r2_account_id:
        return R2Storage(settings.r2_account_id, settings.r2_access_key_id,
                         settings.r2_secret_access_key, settings.r2_bucket)
    return LocalStorage(settings.storage_local_dir)


storage = get_storage()
