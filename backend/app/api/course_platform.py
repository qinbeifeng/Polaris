import secrets
import string
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional

from app.platform.db import get_conn, now_ts
from app.platform.deps import CurrentUser, get_current_user


router = APIRouter(prefix="/course")


def _generate_code(length: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


class CourseItem(BaseModel):
    id: int
    name: str
    code: str
    teacher_nickname: Optional[str] = None
    students_count: Optional[int] = None
    materials_count: Optional[int] = None


class CourseCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)


class CourseCreateResponse(BaseModel):
    id: int
    name: str
    code: str


class CourseJoinRequest(BaseModel):
    code: str = Field(..., min_length=4, max_length=12)

class CourseMember(BaseModel):
    id: int
    nickname: str
    school: str
    student_no: Optional[str] = None
    major: Optional[str] = None
    grade: Optional[str] = None


class CourseLeaveRequest(BaseModel):
    course_id: int = Field(..., description="course id")


class CourseLeaveResponse(BaseModel):
    status: str = Field(..., description="ok")


@router.post("/create", response_model=CourseCreateResponse)
async def create_course(
    payload: CourseCreateRequest, user: CurrentUser = Depends(get_current_user)
):
    if user["role"] != "teacher":
        raise HTTPException(status_code=403, detail="Teacher only")

    with get_conn() as conn:
        code = _generate_code()
        for _ in range(10):
            exists = conn.execute("SELECT 1 FROM courses WHERE code = ?", (code,)).fetchone()
            if not exists:
                break
            code = _generate_code()
        cur = conn.execute(
            "INSERT INTO courses(name, code, teacher_id, created_at) VALUES(?,?,?,?)",
            (payload.name, code, user["id"], now_ts()),
        )
        course_id = cur.lastrowid
    return CourseCreateResponse(id=course_id, name=payload.name, code=code)


@router.post("/join", response_model=CourseItem)
async def join_course(
    payload: CourseJoinRequest, user: CurrentUser = Depends(get_current_user)
):
    if user["role"] != "student":
        raise HTTPException(status_code=403, detail="Student only")

    with get_conn() as conn:
        course = conn.execute(
            """
            SELECT c.id, c.name, c.code, u.nickname AS teacher_nickname
            FROM courses c
            JOIN users u ON u.id = c.teacher_id
            WHERE c.code = ?
            """,
            (payload.code.strip().upper(),),
        ).fetchone()
        if not course:
            raise HTTPException(status_code=404, detail="Invalid code")
        try:
            conn.execute(
                "INSERT INTO course_members(course_id, student_id, joined_at) VALUES(?,?,?)",
                (course["id"], user["id"], now_ts()),
            )
        except Exception:
            pass
        students_count = conn.execute(
            "SELECT COUNT(1) AS cnt FROM course_members WHERE course_id = ?",
            (course["id"],),
        ).fetchone()["cnt"]
        materials_count = conn.execute(
            "SELECT COUNT(1) AS cnt FROM materials WHERE course_id = ?",
            (course["id"],),
        ).fetchone()["cnt"]

        return CourseItem(
            id=int(course["id"]),
            name=course["name"],
            code=course["code"],
            teacher_nickname=course["teacher_nickname"],
            students_count=int(students_count),
            materials_count=int(materials_count),
        )


@router.get("/list", response_model=List[CourseItem])
async def list_courses(user: CurrentUser = Depends(get_current_user)):
    with get_conn() as conn:
        if user["role"] == "teacher":
            rows = conn.execute(
                """
                SELECT c.id, c.name, c.code,
                  (SELECT COUNT(1) FROM course_members m WHERE m.course_id = c.id) AS students_count,
                  (SELECT COUNT(1) FROM materials mt WHERE mt.course_id = c.id) AS materials_count
                FROM courses c
                WHERE c.teacher_id = ?
                ORDER BY c.created_at DESC
                """,
                (user["id"],),
            ).fetchall()
            return [
                CourseItem(
                    id=int(r["id"]),
                    name=r["name"],
                    code=r["code"],
                    teacher_nickname=user["nickname"],
                    students_count=int(r["students_count"]),
                    materials_count=int(r["materials_count"]),
                )
                for r in rows
            ]

        rows = conn.execute(
            """
            SELECT c.id, c.name, c.code, u.nickname AS teacher_nickname,
              (SELECT COUNT(1) FROM materials mt WHERE mt.course_id = c.id) AS materials_count
            FROM course_members m
            JOIN courses c ON c.id = m.course_id
            JOIN users u ON u.id = c.teacher_id
            WHERE m.student_id = ?
            ORDER BY m.joined_at DESC
            """,
            (user["id"],),
        ).fetchall()
        return [
            CourseItem(
                id=int(r["id"]),
                name=r["name"],
                code=r["code"],
                teacher_nickname=r["teacher_nickname"],
                materials_count=int(r["materials_count"]),
            )
            for r in rows
        ]


@router.post("/leave", response_model=CourseLeaveResponse)
async def leave_course(payload: CourseLeaveRequest, user: CurrentUser = Depends(get_current_user)):
    if user["role"] != "student":
        raise HTTPException(status_code=403, detail="Student only")

    with get_conn() as conn:
        exists = conn.execute(
            "SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?",
            (int(payload.course_id), user["id"]),
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Not joined")
        conn.execute(
            "DELETE FROM course_members WHERE course_id = ? AND student_id = ?",
            (int(payload.course_id), user["id"]),
        )

    return CourseLeaveResponse(status="ok")


@router.get("/{course_id}/members", response_model=List[CourseMember])
async def list_members(course_id: int, user: CurrentUser = Depends(get_current_user)):
    if user["role"] != "teacher":
        raise HTTPException(status_code=403, detail="Teacher only")

    with get_conn() as conn:
        course = conn.execute(
            "SELECT id, teacher_id FROM courses WHERE id = ?",
            (int(course_id),),
        ).fetchone()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        if int(course["teacher_id"]) != user["id"]:
            raise HTTPException(status_code=403, detail="No permission")

        rows = conn.execute(
            """
            SELECT u.id, u.nickname, u.school, sp.student_no, sp.major, sp.grade
            FROM course_members m
            JOIN users u ON u.id = m.student_id
            LEFT JOIN student_profiles sp ON sp.user_id = u.id
            WHERE m.course_id = ?
            ORDER BY m.joined_at DESC
            """,
            (int(course_id),),
        ).fetchall()
        return [
            CourseMember(
                id=int(r["id"]),
                nickname=r["nickname"],
                school=r["school"],
                student_no=r["student_no"],
                major=r["major"],
                grade=r["grade"],
            )
            for r in rows
        ]
