"""Application settings loaded from environment / .env."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    sarvam_api_key: str = ""
    pexels_api_key: str = ""   # optional; falls back to keyless Openverse

    database_url: str = "sqlite:///./maxfly.sqlite3"
    redis_url: str = ""
    run_mode: str = "local"   # local (in-process pool) | celery
    arnndn_model_path: str = ""   # optional AI denoise model (.rnnn) for audio enhance
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""

    storage_backend: str = "local"
    storage_local_dir: str = "./storage_data"

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_bucket: str = "media"
    supabase_jwt_secret: str = ""
    auth_enabled: bool = False   # require Supabase login when True
    admin_emails: str = ""   # comma-separated superadmin emails (see all projects)

    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""

    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def admin_email_list(self) -> list[str]:
        return [e.strip().lower() for e in self.admin_emails.split(",") if e.strip()]

    @property
    def celery_eager(self) -> bool:
        # No broker configured -> run tasks inline (dev-friendly).
        return not bool(self.redis_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
