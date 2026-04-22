import os
import sqlite3
import time
from contextlib import contextmanager
from typing import Iterator

from app.platform.security import hash_password


DB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../data/platform.db")
)


def _ensure_dir():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)


def connect() -> sqlite3.Connection:
    _ensure_dir()
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def now_ts() -> int:
    return int(time.time())


def init_db() -> None:
    _ensure_dir()
    with get_conn() as conn:
        conn.executescript(
            """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','teacher')),
  nickname TEXT NOT NULL,
  school TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS student_profiles (
  user_id INTEGER PRIMARY KEY,
  student_no TEXT NOT NULL,
  major TEXT NOT NULL,
  grade TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS teacher_profiles (
  user_id INTEGER PRIMARY KEY,
  teacher_no TEXT NOT NULL,
  department TEXT NOT NULL,
  title TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  teacher_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS course_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  UNIQUE(course_id, student_id),
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  uploader_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK(status IN ('uploaded','analyzed','failed')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY(uploader_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','teacher')),
  course_id INTEGER,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE SET NULL
);
"""
        )


def ensure_default_users() -> None:
    defaults = [
        {
            "username": "tech1",
            "password": "123456",
            "role": "teacher",
            "nickname": "tech1",
            "school": "默认学校",
            "teacher_no": "T001",
            "department": "默认院系",
            "title": "讲师",
        },
        {
            "username": "stu1",
            "password": "123456",
            "role": "student",
            "nickname": "stu1",
            "school": "默认学校",
            "student_no": "S001",
            "major": "默认专业",
            "grade": "大一",
        },
    ]

    with get_conn() as conn:
        for u in defaults:
            row = conn.execute(
                "SELECT id FROM users WHERE username = ?",
                (u["username"],),
            ).fetchone()
            if not row:
                password_hash, salt = hash_password(u["password"])
                conn.execute(
                    """
                    INSERT INTO users(username, password_hash, password_salt, role, nickname, school, created_at)
                    VALUES(?,?,?,?,?,?,?)
                    """,
                    (
                        u["username"],
                        password_hash,
                        salt,
                        u["role"],
                        u["nickname"],
                        u["school"],
                        now_ts(),
                    ),
                )
                row = conn.execute(
                    "SELECT id FROM users WHERE username = ?",
                    (u["username"],),
                ).fetchone()

            if not row:
                continue

            user_id = int(row["id"])
            if u["role"] == "teacher":
                conn.execute(
                    """
                    INSERT OR IGNORE INTO teacher_profiles(user_id, teacher_no, department, title)
                    VALUES(?,?,?,?)
                    """,
                    (
                        user_id,
                        u["teacher_no"],
                        u["department"],
                        u["title"],
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO student_profiles(user_id, student_no, major, grade)
                    VALUES(?,?,?,?)
                    """,
                    (
                        user_id,
                        u["student_no"],
                        u["major"],
                        u["grade"],
                    ),
                )
