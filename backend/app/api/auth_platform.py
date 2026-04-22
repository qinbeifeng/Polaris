import sqlite3

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Literal, Optional

from app.platform.db import get_conn, now_ts
from app.platform.security import encode_jwt, hash_password, verify_password


router = APIRouter(prefix="/auth")


class RegisterStudent(BaseModel):
    username: str = Field(..., min_length=3, max_length=32)
    password: str = Field(..., min_length=6, max_length=64)
    nickname: str = Field(..., min_length=1, max_length=32)
    school: str = Field(..., min_length=1, max_length=64)
    student_no: str = Field(..., min_length=1, max_length=64)
    major: str = Field(..., min_length=1, max_length=64)
    grade: str = Field(..., min_length=1, max_length=32)


class RegisterTeacher(BaseModel):
    username: str = Field(..., min_length=3, max_length=32)
    password: str = Field(..., min_length=6, max_length=64)
    nickname: str = Field(..., min_length=1, max_length=32)
    school: str = Field(..., min_length=1, max_length=64)
    teacher_no: str = Field(..., min_length=1, max_length=64)
    department: str = Field(..., min_length=1, max_length=64)
    title: Optional[str] = Field(None, max_length=64)


class RegisterRequest(BaseModel):
    role: Literal["student", "teacher"]
    student: Optional[RegisterStudent] = None
    teacher: Optional[RegisterTeacher] = None


class AuthResponse(BaseModel):
    token: str
    role: Literal["student", "teacher"]


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/register", response_model=AuthResponse)
async def register(payload: RegisterRequest):
    if payload.role == "student":
        if not payload.student:
            raise HTTPException(status_code=400, detail="Missing student profile")
        s = payload.student
        password_hash, salt = hash_password(s.password)
        with get_conn() as conn:
            exists = conn.execute(
                "SELECT 1 FROM users WHERE username = ?",
                (s.username,),
            ).fetchone()
            if exists:
                raise HTTPException(status_code=409, detail="Username already exists")
            try:
                cur = conn.execute(
                    """
                    INSERT INTO users(username, password_hash, password_salt, role, nickname, school, created_at)
                    VALUES(?,?,?,?,?,?,?)
                    """,
                    (s.username, password_hash, salt, "student", s.nickname, s.school, now_ts()),
                )
            except sqlite3.IntegrityError:
                raise HTTPException(status_code=409, detail="Username already exists")
            except sqlite3.Error as e:
                raise HTTPException(status_code=500, detail=f"Database error: {e}")
            user_id = cur.lastrowid
            conn.execute(
                """
                INSERT INTO student_profiles(user_id, student_no, major, grade)
                VALUES(?,?,?,?)
                """,
                (user_id, s.student_no, s.major, s.grade),
            )
        token = encode_jwt({"sub": user_id, "role": "student"})
        return AuthResponse(token=token, role="student")

    if payload.role == "teacher":
        if not payload.teacher:
            raise HTTPException(status_code=400, detail="Missing teacher profile")
        t = payload.teacher
        password_hash, salt = hash_password(t.password)
        with get_conn() as conn:
            exists = conn.execute(
                "SELECT 1 FROM users WHERE username = ?",
                (t.username,),
            ).fetchone()
            if exists:
                raise HTTPException(status_code=409, detail="Username already exists")
            try:
                cur = conn.execute(
                    """
                    INSERT INTO users(username, password_hash, password_salt, role, nickname, school, created_at)
                    VALUES(?,?,?,?,?,?,?)
                    """,
                    (t.username, password_hash, salt, "teacher", t.nickname, t.school, now_ts()),
                )
            except sqlite3.IntegrityError:
                raise HTTPException(status_code=409, detail="Username already exists")
            except sqlite3.Error as e:
                raise HTTPException(status_code=500, detail=f"Database error: {e}")
            user_id = cur.lastrowid
            conn.execute(
                """
                INSERT INTO teacher_profiles(user_id, teacher_no, department, title)
                VALUES(?,?,?,?)
                """,
                (user_id, t.teacher_no, t.department, t.title),
            )
        token = encode_jwt({"sub": user_id, "role": "teacher"})
        return AuthResponse(token=token, role="teacher")

    raise HTTPException(status_code=400, detail="Invalid role")


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, role, password_hash, password_salt FROM users WHERE username = ?",
            (payload.username,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        if not verify_password(payload.password, row["password_hash"], row["password_salt"]):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        user_id = int(row["id"])
        role = row["role"]
    token = encode_jwt({"sub": user_id, "role": role})
    return AuthResponse(token=token, role=role)
