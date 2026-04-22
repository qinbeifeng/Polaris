from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List
from rag.vector_service import vector_service
from rag.llm_handler import llm_handler

router = APIRouter()

class LectureRequest(BaseModel):
    course_name: str = Field(..., description="course")
    max_texts: Optional[int] = Field(50, description="limit")

class LectureResponse(BaseModel):
    script: str = Field(..., description="script")

@router.post("/lecture/generate", response_model=LectureResponse)
async def generate_lecture(payload: LectureRequest):
    try:
        if not vector_service or not getattr(vector_service, "collection", None):
            raise HTTPException(status_code=500, detail="vector unavailable")
        expr = f'course_name == "{payload.course_name}"'
        results = vector_service.collection.query(expr=expr, output_fields=["text"])
        texts = [r.get("text") for r in results if r.get("text")]
        if not texts:
            script = await llm_handler.generate_lecture_script(payload.course_name, "")
            return LectureResponse(script=script)
        selected = texts[: max(1, payload.max_texts or 50)]
        content = "\n".join(selected)
        script = await llm_handler.generate_lecture_script(payload.course_name, content)
        return LectureResponse(script=script)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
