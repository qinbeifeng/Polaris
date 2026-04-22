from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from typing import List, Optional
from rag.vector_service import get_vector_service, VECTOR_SERVICE_INIT_ERROR, EMBEDDING_MODEL_INIT_ERROR
from pymilvus import utility

router = APIRouter()

class VectorHealth(BaseModel):
    connected: bool = Field(..., description="milvus connection")
    collection: Optional[str] = Field(None, description="name")
    has_collection: Optional[bool] = Field(None, description="exists")
    collections: List[str] = Field(default_factory=list, description="list")
    error: Optional[str] = Field(None, description="error")

@router.get("/vector/health", response_model=VectorHealth)
async def vector_health(force: bool = Query(False, description="force re-init vector service")):
    try:
        svc = get_vector_service(force=force)
        if not svc:
            parts = ["vector_service is None"]
            if EMBEDDING_MODEL_INIT_ERROR:
                parts.append(f"embedding_error={EMBEDDING_MODEL_INIT_ERROR}")
            if VECTOR_SERVICE_INIT_ERROR:
                parts.append(f"init_error={VECTOR_SERVICE_INIT_ERROR}")
            return VectorHealth(connected=False, error="; ".join(parts), collections=[])

        name = getattr(svc, "collection_name", None)
        try:
            cols = utility.list_collections()
            has_col = utility.has_collection(name) if name else False
            return VectorHealth(connected=True, collection=name, has_collection=has_col, collections=cols)
        except Exception as e:
            return VectorHealth(connected=False, collection=name, has_collection=False, collections=[], error=str(e))
    except Exception as e:
        return VectorHealth(connected=False, error=str(e), collections=[])

class SeedRequest(BaseModel):
    courses: Optional[List[str]] = Field(None, description="course names")

class SeedResponse(BaseModel):
    inserted_chunks: int = Field(..., description="chunks")
    courses: List[str] = Field(default_factory=list, description="courses")

@router.post("/vector/seed", response_model=SeedResponse)
async def seed_vector(payload: SeedRequest):
    svc = get_vector_service()
    if not svc or not getattr(svc, "collection", None):
        return SeedResponse(inserted_chunks=0, courses=[])

    courses = payload.courses or ["测试课程-高等数学", "测试课程-大学物理", "自动控制"]
    chunks = []
    for c in courses:
        chunks.extend([
            {"text": f"{c}：本课程介绍与学习目标。", "metadata": {"course_name": c, "file_name": "seed", "page_num": 1}},
            {"text": f"{c}：核心概念与典型例题讲解。", "metadata": {"course_name": c, "file_name": "seed", "page_num": 2}},
        ])

    ok = svc.add_chunks(chunks)
    return SeedResponse(inserted_chunks=len(chunks) if ok else 0, courses=courses if ok else [])
