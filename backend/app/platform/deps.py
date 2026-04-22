from typing import Optional, TypedDict

from fastapi import Header, HTTPException

from app.platform.db import get_conn
from app.platform.security import decode_jwt


class CurrentUser(TypedDict):
    id: int
    username: str
    role: str
    nickname: str
    school: str


def get_current_user(authorization: Optional[str] = Header(None)) -> CurrentUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.replace("Bearer ", "", 1).strip()
    try:
        payload = decode_jwt(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, username, role, nickname, school FROM users WHERE id = ?",
            (int(user_id),),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="User not found")
        return {
            "id": int(row["id"]),
            "username": row["username"],
            "role": row["role"],
            "nickname": row["nickname"],
            "school": row["school"],
        }

