from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Literal, Optional

from app.platform.deps import CurrentUser, get_current_user
from app.platform.db import get_conn


router = APIRouter(prefix="/user")


class StudentProfile(BaseModel):
    student_no: str
    major: str
    grade: str


class TeacherProfile(BaseModel):
    teacher_no: str
    department: str
    title: Optional[str] = None


class UserProfileResponse(BaseModel):
    id: int
    username: str
    role: Literal["student", "teacher"]
    nickname: str
    school: str
    student: Optional[StudentProfile] = None
    teacher: Optional[TeacherProfile] = None


def _fetch_profile(user: CurrentUser) -> UserProfileResponse:
    with get_conn() as conn:
        if user["role"] == "student":
            s = conn.execute(
                "SELECT student_no, major, grade FROM student_profiles WHERE user_id = ?",
                (user["id"],),
            ).fetchone()
            u = conn.execute(
                "SELECT id, username, nickname, school FROM users WHERE id = ?",
                (user["id"],),
            ).fetchone()
            return UserProfileResponse(
                id=int(u["id"]),
                username=u["username"],
                role="student",
                nickname=u["nickname"],
                school=u["school"],
                student=StudentProfile(
                    student_no=s["student_no"],
                    major=s["major"],
                    grade=s["grade"],
                )
                if s
                else None,
            )

        t = conn.execute(
            "SELECT teacher_no, department, title FROM teacher_profiles WHERE user_id = ?",
            (user["id"],),
        ).fetchone()
        u = conn.execute(
            "SELECT id, username, nickname, school FROM users WHERE id = ?",
            (user["id"],),
        ).fetchone()
        return UserProfileResponse(
            id=int(u["id"]),
            username=u["username"],
            role="teacher",
            nickname=u["nickname"],
            school=u["school"],
            teacher=TeacherProfile(
                teacher_no=t["teacher_no"],
                department=t["department"],
                title=t["title"],
            )
            if t
            else None,
        )


@router.get("/profile", response_model=UserProfileResponse)
async def profile(user: CurrentUser = Depends(get_current_user)):
    return _fetch_profile(user)


class UpdateStudentProfile(BaseModel):
    student_no: Optional[str] = Field(None, max_length=64)
    major: Optional[str] = Field(None, max_length=64)
    grade: Optional[str] = Field(None, max_length=32)


class UpdateTeacherProfile(BaseModel):
    teacher_no: Optional[str] = Field(None, max_length=64)
    department: Optional[str] = Field(None, max_length=64)
    title: Optional[str] = Field(None, max_length=64)


class UpdateProfileRequest(BaseModel):
    nickname: Optional[str] = Field(None, min_length=1, max_length=64)
    school: Optional[str] = Field(None, min_length=1, max_length=64)
    student: Optional[UpdateStudentProfile] = None
    teacher: Optional[UpdateTeacherProfile] = None


@router.put("/profile", response_model=UserProfileResponse)
async def update_profile(
    payload: UpdateProfileRequest, user: CurrentUser = Depends(get_current_user)
):
    if (
        payload.nickname is None
        and payload.school is None
        and payload.student is None
        and payload.teacher is None
    ):
        raise HTTPException(status_code=400, detail="No changes")

    with get_conn() as conn:
        if payload.nickname is not None or payload.school is not None:
            row = conn.execute(
                "SELECT nickname, school FROM users WHERE id = ?",
                (user["id"],),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            nickname = payload.nickname if payload.nickname is not None else row["nickname"]
            school = payload.school if payload.school is not None else row["school"]
            conn.execute(
                "UPDATE users SET nickname = ?, school = ? WHERE id = ?",
                (nickname, school, user["id"]),
            )

        if user["role"] == "student":
            if payload.teacher is not None:
                raise HTTPException(status_code=400, detail="Invalid payload")
            if payload.student is not None:
                s = conn.execute(
                    "SELECT student_no, major, grade FROM student_profiles WHERE user_id = ?",
                    (user["id"],),
                ).fetchone()
                if not s:
                    raise HTTPException(status_code=404, detail="Student profile not found")
                student_no = (
                    payload.student.student_no
                    if payload.student.student_no is not None
                    else s["student_no"]
                )
                major = payload.student.major if payload.student.major is not None else s["major"]
                grade = payload.student.grade if payload.student.grade is not None else s["grade"]
                conn.execute(
                    "UPDATE student_profiles SET student_no = ?, major = ?, grade = ? WHERE user_id = ?",
                    (student_no, major, grade, user["id"]),
                )
        else:
            if payload.student is not None:
                raise HTTPException(status_code=400, detail="Invalid payload")
            if payload.teacher is not None:
                t = conn.execute(
                    "SELECT teacher_no, department, title FROM teacher_profiles WHERE user_id = ?",
                    (user["id"],),
                ).fetchone()
                if not t:
                    raise HTTPException(status_code=404, detail="Teacher profile not found")
                teacher_no = (
                    payload.teacher.teacher_no
                    if payload.teacher.teacher_no is not None
                    else t["teacher_no"]
                )
                department = (
                    payload.teacher.department
                    if payload.teacher.department is not None
                    else t["department"]
                )
                title = payload.teacher.title if payload.teacher.title is not None else t["title"]
                conn.execute(
                    "UPDATE teacher_profiles SET teacher_no = ?, department = ?, title = ? WHERE user_id = ?",
                    (teacher_no, department, title, user["id"]),
                )

    return _fetch_profile(user)
