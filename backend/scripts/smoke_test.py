"""
CI smoke test — no network, no ffmpeg, SQLite + auth off (defaults).

Guards the two regressions that have taken production down before:
  1. the app failing to boot / import, and
  2. loading a project that contains a b-roll or image overlay (the
     ProjectDetail.model_validate 500 from the missing from_attributes config).

Run:  python -m scripts.smoke_test   (from backend/, or `cd backend && python scripts/smoke_test.py`)
Exits non-zero on any failure so CI fails loudly.
"""
import os
import sys
import uuid

# ensure `app` is importable when run as a plain script
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.database import SessionLocal, init_db  # noqa: E402
from app.models import Project, BrollClip, ImageOverlay  # noqa: E402


def main() -> int:
    init_db()
    client = TestClient(app)

    # 1) app boots + health endpoint
    r = client.get("/api/health")
    assert r.status_code == 200, f"/api/health -> {r.status_code}"
    assert r.json().get("ok") is True, f"/api/health body: {r.text}"
    print("[ok] health")

    # 2) a project with a b-roll + image overlay must load (guards the 500)
    db = SessionLocal()
    pid = str(uuid.uuid4())
    try:
        db.add(Project(id=pid, name="smoke", source_media_url="smoke.mp4",
                       status="uploaded", duration_ms=5000))
        db.commit()
        db.add(BrollClip(project_id=pid, video_url="clip.mp4",
                         start_ms=0, end_ms=2000, track=2, keep_audio=True))
        db.add(ImageOverlay(project_id=pid, image_url="pic.png",
                            start_ms=0, end_ms=1500))
        db.commit()
    finally:
        db.close()

    r = client.get(f"/api/projects/{pid}")
    assert r.status_code == 200, f"project load -> {r.status_code}: {r.text[:300]}"
    body = r.json()
    assert body.get("id") == pid, "project id mismatch"
    assert len(body.get("brolls", [])) == 1, f"brolls not serialised: {body.get('brolls')}"
    assert len(body.get("images", [])) == 1, f"images not serialised: {body.get('images')}"
    print("[ok] project load with b-roll + image")

    # 3) the neutral /api/hub prefix must resolve to the same route
    r = client.get(f"/api/hub/{pid}")
    assert r.status_code == 200, f"/api/hub rewrite broken -> {r.status_code}"
    print("[ok] /api/hub neutral prefix")

    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
