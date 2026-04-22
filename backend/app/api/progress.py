from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from typing import List, Dict, Any
from rag.vector_service import vector_service
from rag.llm_handler import llm_handler

router = APIRouter()

class ProgressRequest(BaseModel):
    course_name: str = Field(..., description="course")
    last_question: Optional[str] = Field("", description="q")
    last_answer: Optional[str] = Field("", description="a")
    student_feedback: Optional[str] = Field("", description="fb")

class ProgressResponse(BaseModel):
    decision: str = Field(..., description="repeat|advance")
    reason: str = Field(..., description="reason")
    next_step: str = Field(..., description="hint")

@router.post("/progress/analyze", response_model=ProgressResponse)
async def analyze_progress(payload: ProgressRequest):
    try:
        text = (payload.student_feedback or "") + (payload.last_question or "")
        t = text.strip()
        if any(k in t for k in ["不懂", "不会", "听不明白", "不理解", "解释一下"]):
            return ProgressResponse(
                decision="repeat",
                reason="检测到理解不足",
                next_step="重讲当前知识点，放慢节奏并给出示例",
            )
        return ProgressResponse(
            decision="advance",
            reason="未检测到明显困惑",
            next_step="进入下一知识点，保留简短复盘",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class MasteryRequest(BaseModel):
    course_name: str = Field(..., description="course")
    student_notes: Optional[str] = Field("", description="notes")
    max_texts: Optional[int] = Field(30, description="limit")

class MasteryItem(BaseModel):
    point: str = Field(..., description="point")
    mastery: int = Field(..., description="0-100")

@router.post("/progress/assess", response_model=List[MasteryItem])
async def assess_mastery(payload: MasteryRequest):
    try:
        if not vector_service or not getattr(vector_service, "collection", None):
            return []
        expr = f'course_name == "{payload.course_name}"'
        rows = vector_service.collection.query(expr=expr, output_fields=["text"])
        texts = [r.get("text") for r in rows if r.get("text")]
        selected = texts[: max(1, payload.max_texts or 30)]
        key_content = "\n".join(selected)
        raw = await llm_handler.generate_mastery_assessment(payload.course_name, key_content, payload.student_notes or "")
        try:
            import json
            data = json.loads(raw)
            result = []
            for item in data:
                p = str(item.get("point", "")).strip()
                m = int(item.get("mastery", 0))
                if p:
                    result.append(MasteryItem(point=p, mastery=max(0, min(100, m))))
            return result
        except Exception:
            return []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
