import os
import re
import shutil
import zipfile
import logging
from xml.etree import ElementTree

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from typing import List, Optional

from app.platform.db import get_conn, now_ts
from app.platform.deps import CurrentUser, get_current_user
from rag.loader import loader
from rag.processor import processor
from rag.vector_service import get_vector_service, VECTOR_SERVICE_INIT_ERROR, EMBEDDING_MODEL_INIT_ERROR


router = APIRouter(prefix="/material")
logger = logging.getLogger(__name__)


UPLOAD_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../data/materials")
)


def _safe_filename(name: str) -> str:
    name = name.strip().replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff\.\-\_\(\)\[\]\s]+", "_", name)
    return name[:160] or "file"


def _extract_docx(file_path: str) -> List[dict]:
    try:
        with zipfile.ZipFile(file_path) as zf:
            xml = zf.read("word/document.xml")
        root = ElementTree.fromstring(xml)
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        texts = [t.text for t in root.findall(".//w:t", ns) if t.text]
        full = "\n".join([t.strip() for t in texts if t.strip()]).strip()
        if not full:
            return []
        return [{"text": full, "page_num": 1}]
    except Exception as e:
        logger.exception("DOCX extraction error: %s", file_path)
        raise e


class MaterialItem(BaseModel):
    id: int
    course_id: int
    filename: str
    status: str
    created_at: int


class AnalyzeRequest(BaseModel):
    material_id: int


class AnalyzeResponse(BaseModel):
    status: str
    chunks: int


class DeleteRequest(BaseModel):
    material_id: int


class DeleteResponse(BaseModel):
    status: str
    deleted_vectors: int = 0


@router.get("/list", response_model=List[MaterialItem])
async def list_materials(
    course_id: int, user: CurrentUser = Depends(get_current_user)
):
    with get_conn() as conn:
        course = conn.execute(
            "SELECT id, teacher_id FROM courses WHERE id = ?",
            (int(course_id),),
        ).fetchone()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")

        if user["role"] == "teacher":
            if int(course["teacher_id"]) != user["id"]:
                raise HTTPException(status_code=403, detail="No permission")
        else:
            member = conn.execute(
                "SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?",
                (int(course_id), user["id"]),
            ).fetchone()
            if not member:
                raise HTTPException(status_code=403, detail="Not joined")

        rows = conn.execute(
            """
            SELECT id, course_id, filename, status, created_at
            FROM materials
            WHERE course_id = ?
            ORDER BY created_at DESC
            """,
            (int(course_id),),
        ).fetchall()
        return [
            MaterialItem(
                id=int(r["id"]),
                course_id=int(r["course_id"]),
                filename=r["filename"],
                status=r["status"],
                created_at=int(r["created_at"]),
            )
            for r in rows
        ]


@router.post("/upload", response_model=MaterialItem, status_code=201)
async def upload_material(
    file: UploadFile = File(...),
    course_id: int = Form(...),
    user: CurrentUser = Depends(get_current_user),
):
    if user["role"] != "teacher":
        raise HTTPException(status_code=403, detail="Teacher only")

    filename = _safe_filename(file.filename or "file")
    ext = os.path.splitext(filename)[1].lower()
    if ext not in {".pdf", ".pptx", ".docx"}:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    with get_conn() as conn:
        course = conn.execute(
            "SELECT id, name, teacher_id FROM courses WHERE id = ?",
            (course_id,),
        ).fetchone()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        if int(course["teacher_id"]) != user["id"]:
            raise HTTPException(status_code=403, detail="No permission")

    os.makedirs(os.path.join(UPLOAD_ROOT, str(course_id)), exist_ok=True)
    stored_path = os.path.join(UPLOAD_ROOT, str(course_id), filename)
    with open(stored_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO materials(course_id, uploader_id, filename, stored_path, mime, status, created_at)
            VALUES(?,?,?,?,?,?,?)
            """,
            (course_id, user["id"], filename, stored_path, file.content_type, "uploaded", now_ts()),
        )
        material_id = cur.lastrowid

    return MaterialItem(
        id=int(material_id),
        course_id=int(course_id),
        filename=filename,
        status="uploaded",
        created_at=now_ts(),
    )


@router.post("/delete", response_model=DeleteResponse)
async def delete_material(payload: DeleteRequest, user: CurrentUser = Depends(get_current_user)):
    if user["role"] != "teacher":
        raise HTTPException(status_code=403, detail="Teacher only")

    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT m.id, m.course_id, m.filename, m.stored_path, c.name AS course_name, c.teacher_id
            FROM materials m
            JOIN courses c ON c.id = m.course_id
            WHERE m.id = ?
            """,
            (int(payload.material_id),),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Material not found")
        if int(row["teacher_id"]) != user["id"]:
            raise HTTPException(status_code=403, detail="No permission")

        course_id = int(row["course_id"])
        course_name = row["course_name"]
        filename = row["filename"]
        file_path = row["stored_path"]

    course_key = f"{course_id}::{course_name}"
    safe_course_key = course_key.replace("\\", "\\\\").replace('"', '\\"')
    safe_filename = str(filename).replace("\\", "\\\\").replace('"', '\\"')

    svc = get_vector_service()
    if not svc or not getattr(svc, "collection", None):
        raise HTTPException(
            status_code=503,
            detail="Vector service unavailable, cannot delete vectors. Please ensure Milvus is running.",
        )

    deleted_vectors = 0
    try:
        expr = f'course_name == "{safe_course_key}" && source_info["file_name"] == "{safe_filename}"'
        res = svc.collection.delete(expr)
        deleted_vectors = int(getattr(res, "delete_count", 0) or 0)
        svc.collection.flush()
    except Exception as e:
        logger.exception("Failed to delete vectors for material_id=%s", payload.material_id)
        raise HTTPException(status_code=500, detail=f"Failed to delete vectors from Milvus: {e}")

    with get_conn() as conn:
        conn.execute("DELETE FROM materials WHERE id = ?", (int(payload.material_id),))

    try:
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
    except Exception as e:
        logger.exception("Failed to delete file on disk: %s", file_path)
        raise HTTPException(status_code=500, detail=f"Deleted vectors+db, but failed to delete file: {e}")

    return DeleteResponse(status="ok", deleted_vectors=deleted_vectors)


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_material(
    payload: AnalyzeRequest, user: CurrentUser = Depends(get_current_user)
):
    if user["role"] != "teacher":
        raise HTTPException(status_code=403, detail="Teacher only")

    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT m.id, m.course_id, m.filename, m.stored_path, c.name AS course_name, c.teacher_id
            FROM materials m
            JOIN courses c ON c.id = m.course_id
            WHERE m.id = ?
            """,
            (payload.material_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Material not found")
        if int(row["teacher_id"]) != user["id"]:
            raise HTTPException(status_code=403, detail="No permission")

        course_id = int(row["course_id"])
        course_name = row["course_name"]
        file_path = row["stored_path"]
        filename = row["filename"]

    if not os.path.exists(file_path):
        with get_conn() as conn:
            conn.execute(
                "UPDATE materials SET status = 'failed' WHERE id = ?",
                (payload.material_id,),
            )
        raise HTTPException(status_code=404, detail=f"File not found on disk: {file_path}")

    ext = os.path.splitext(filename)[1].lower()
    try:
        content = []
        if ext == ".pdf":
            content = loader._extract_pdf(file_path)
        elif ext == ".pptx":
            content = loader._extract_pptx(file_path)
        elif ext == ".docx":
            content = _extract_docx(file_path)
    except Exception as e:
        with get_conn() as conn:
            conn.execute(
                "UPDATE materials SET status = 'failed' WHERE id = ?",
                (payload.material_id,),
            )
        raise HTTPException(status_code=400, detail=f"Parse error ({ext}): {e}")

    if not content:
        with get_conn() as conn:
            conn.execute(
                "UPDATE materials SET status = 'failed' WHERE id = ?",
                (payload.material_id,),
            )
        raise HTTPException(
            status_code=400,
            detail="No text extracted (可能是扫描版PDF/纯图片PPT/空DOCX，当前解析器只提取可选中文本)",
        )

    course_key = f"{course_id}::{course_name}"
    doc_data = {"course_name": course_key, "file_name": filename, "content": content}
    try:
        chunks = processor.process_document(doc_data)
    except Exception as e:
        logger.exception("Chunking error: material_id=%s", payload.material_id)
        with get_conn() as conn:
            conn.execute(
                "UPDATE materials SET status = 'failed' WHERE id = ?",
                (payload.material_id,),
            )
        raise HTTPException(status_code=500, detail=f"Chunking error: {e}")

    if not chunks:
        with get_conn() as conn:
            conn.execute(
                "UPDATE materials SET status = 'failed' WHERE id = ?",
                (payload.material_id,),
            )
        raise HTTPException(status_code=400, detail="Chunking produced 0 chunks")

    svc = get_vector_service()
    if not svc:
        with get_conn() as conn:
            conn.execute(
                "UPDATE materials SET status = 'failed' WHERE id = ?",
                (payload.material_id,),
            )
        parts = []
        if EMBEDDING_MODEL_INIT_ERROR:
            parts.append(f"embedding_error={EMBEDDING_MODEL_INIT_ERROR}")
        if VECTOR_SERVICE_INIT_ERROR:
            parts.append(f"init_error={VECTOR_SERVICE_INIT_ERROR}")
        hint = "; ".join(parts) if parts else "vector_service is None"
        raise HTTPException(status_code=503, detail=f"Vector service unavailable: {hint}")

    ok = svc.add_chunks(chunks)
    if not ok:
        with get_conn() as conn:
            conn.execute(
                "UPDATE materials SET status = 'failed' WHERE id = ?",
                (payload.material_id,),
            )
        raise HTTPException(status_code=500, detail="Failed to insert vectors into Milvus")

    with get_conn() as conn:
        conn.execute(
            "UPDATE materials SET status = 'analyzed' WHERE id = ?",
            (payload.material_id,),
        )

    return AnalyzeResponse(status="success", chunks=len(chunks))
