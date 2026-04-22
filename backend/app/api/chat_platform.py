import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional

from app.platform.db import get_conn, now_ts
from app.platform.deps import CurrentUser, get_current_user
from rag.vector_service import get_vector_service
from rag.llm_handler import llm_handler


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat")


class AskRequest(BaseModel):
    query: str = Field(..., description="User question")
    course_id: int = Field(..., description="Course id")
    page_context: Optional[str] = Field(None, description="Optional page context")
    lecture_mode: bool = Field(False, description="Lecture/script style")
    chat_history: Optional[str] = Field(None, description="Optional dialog history for coherence")


class SourceItem(BaseModel):
    fileName: str = ""
    page: int = 0
    text: str = ""


class AskResponse(BaseModel):
    answer: str
    sources: List[SourceItem] = []
    course_name: str


def _build_platform_system_prompt(
    course_name: str,
    rag_context: str,
    page_context: str,
    chat_history: str,
) -> str:
    base_role = (
        "你叫小星，是课程智能助教，口吻自然像真实课程助教；全程用口语化表达，适合语音朗读；不要使用Markdown格式。"
        "你回答时优先依据课程知识库（RAG）与课堂上下文，其次再用通用知识做自然补充。"
    )

    context_instruction = f"""
回答目标：
1 当前课程为【{course_name}】，优先依据课程知识库（RAG）回答，尽量把知识点讲清楚、讲透
2 严禁出现任何“先否定知识库”的说法：不要说“我没找到/检索失败/未命中/知识库为空/没有直接相关内容/没有资料”等
3 如果 RAG 内容不够覆盖问题：不要提及“不足/没找到”，直接顺滑补充通用知识，并在句中用“我再补充一点…”“更完整地说…”这种自然衔接
4 如果 RAG 与通用知识有冲突：以 RAG 为准，用“按课件口径/按本课讲法”解释，不要暴露检索过程
5 可以在结尾给 1 个追问，帮助澄清题目（但仍要先给出当前最可能的解答）
"""

    history_block = f"【对话历史】：\n{chat_history.strip() if chat_history and chat_history.strip() else '（无）'}"
    page_block = f"【课堂上下文（可选）】：\n{page_context.strip() if page_context and page_context.strip() else '（无）'}"
    context_block = f"【课程知识库（RAG）】：\n{rag_context if rag_context else '（空）'}"
    coherence_block = "连贯性要求：如果对话历史里已经讲到某个点，先用1-2句自然回接，再继续往下讲；避免重复啰嗦。"
    format_block = (
        "输出格式要求：不要输出任何小标题或标签（例如“开场白/讲解/过渡”等字样）。"
        "直接输出 2-4 段自然中文：第一段用一句话友好开头并点题；中间段把要点讲清楚；最后一段用一句话总结并自然抛出 1 个可选追问。"
    )
    return f"{base_role}\n{context_instruction}\n{history_block}\n{page_block}\n{context_block}\n{coherence_block}\n{format_block}"


def _assert_course_access(conn, user: CurrentUser, course_id: int) -> str:
    row = conn.execute(
        "SELECT id, name, teacher_id FROM courses WHERE id = ?",
        (course_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Course not found")

    if user["role"] == "teacher":
        if int(row["teacher_id"]) != user["id"]:
            raise HTTPException(status_code=403, detail="No permission")
        return row["name"]

    member = conn.execute(
        "SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?",
        (course_id, user["id"]),
    ).fetchone()
    if not member:
        raise HTTPException(status_code=403, detail="Not joined")
    return row["name"]


@router.post("/ask", response_model=AskResponse)
async def ask(payload: AskRequest, user: CurrentUser = Depends(get_current_user)):
    with get_conn() as conn:
        course_name = _assert_course_access(conn, user, int(payload.course_id))
    course_key = f"{int(payload.course_id)}::{course_name}"

    user_query = payload.query.strip()
    if not user_query:
        raise HTTPException(status_code=400, detail="Empty query")

    retrieved_docs = []
    svc = get_vector_service()
    if svc:
        try:
            retrieved_docs = svc.search_top_k_with_sources(
                user_query, top_k=5, course_name=course_key
            )
        except Exception:
            retrieved_docs = []

    rag_context = "\n".join([d.get("text", "") for d in retrieved_docs if d.get("text")]) if retrieved_docs else ""
    page_context = payload.page_context or ""
    system_prompt = _build_platform_system_prompt(
        course_name=course_name,
        rag_context=rag_context,
        page_context=page_context,
        chat_history=payload.chat_history or "",
    )

    answer = await llm_handler.chat_with_context(
        query=user_query,
        page_context=page_context,
        rag_context=rag_context,
        course_name=course_name,
        lecture_mode=payload.lecture_mode,
        chat_history=payload.chat_history or "",
        system_prompt_override=system_prompt,
    )

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO chat_records(user_id, role, course_id, question, answer, created_at)
            VALUES(?,?,?,?,?,?)
            """,
            (user["id"], user["role"], int(payload.course_id), user_query, answer, now_ts()),
        )

    return AskResponse(answer=answer, sources=retrieved_docs, course_name=course_name)
