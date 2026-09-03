"""Shared dependencies: per-user project ownership guard."""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Project
from app.services.auth import current_user, is_admin


def owned_project(project_id: str, db: Session = Depends(get_db),
                  user: str | None = Depends(current_user),
                  admin: bool = Depends(is_admin)) -> Project:
    """Load the project and 404 unless the caller owns it (when auth is on).

    Superadmins (ADMIN_EMAILS) can open any project."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    if admin:
        return project
    if user is not None and project.user_id != user:
        raise HTTPException(404, "project not found")
    return project
