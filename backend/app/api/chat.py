import sys
import os
import logging

# Ensure project root is in python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../")))

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import List, Optional
from rag.vector_service import vector_service
from rag.llm_handler import llm_handler
from app.api.parse import parse_url_endpoint, ParseRequest

logger = logging.getLogger(__name__)
router = APIRouter()

class ChatRequest(BaseModel):
    query: str = Field(..., description="User question")
    message: Optional[str] = Field(None, description="Alias for query")
    course_name: Optional[str] = Field(None, description="Course name")
    page_context: Optional[str] = Field(None, description="Text context from current page")
    current_page_content: Optional[str] = Field(None, description="Legacy field")
    document_url: Optional[str] = Field(None, description="Optional embedded document URL")
    image_data: Optional[str] = Field(None, description="Deprecated. OCR is not supported.")
    lecture_mode: bool = Field(False, description="Whether to generate colloquial response for TTS")
    chat_history: Optional[str] = Field(None, description="Optional dialog history for coherence")

    def get_query(self) -> str:
        return self.query or self.message or ""

    def get_page_context(self) -> str:
        return self.page_context or self.current_page_content or ""

class ChatResponse(BaseModel):
    answer: str = Field(..., description="AI generated answer")
    sources: List[str] = Field(default=[], description="Source texts used for answer")
    course_name: Optional[str] = Field(None, description="Detected course name")

@router.post("/chat", response_model=ChatResponse, summary="RAG Chat Endpoint")
async def chat_endpoint(payload: ChatRequest, background_tasks: BackgroundTasks):
    try:
        user_query = payload.get_query()

        page_content = payload.get_page_context()
        course_name = payload.course_name
        
        logger.info(f"Received chat request: query='{user_query}', course='{course_name}'")
        
        # New Requirement: Allow answering if course_name is provided even without page content, 
        # or rely on Vector Search (RAG) primarily.
        # But user said "Precise Extraction... innerText... auto-tag course_name".
        # So page_content should be there.
        
        if not page_content and not course_name:
             # Graceful response: do not proceed without context
            guidance = "我这边还没拿到页面内容，也没看到你选了哪门课。\n\n讲解：\n你可以先选一个课程进入课堂，或者在自由模式里直接问；如果你在课堂模式里提问，我会更好地结合课程资料来讲。\n\n过渡语：\n你先告诉我：想聊哪门课，或者直接把问题发我也行。"
            return ChatResponse(answer=guidance, sources=[])

        retrieved_docs = []
        if course_name and course_name != "unknown":
            if vector_service:
                # Force isolation: search only within this course
                retrieved_docs = vector_service.search_top_k(user_query, top_k=5, course_name=course_name)

        rag_context = "\n".join(retrieved_docs) if retrieved_docs else ""
        
        answer = await llm_handler.chat_with_context(
            query=user_query, 
            page_context=page_content, 
            rag_context=rag_context, 
            course_name=course_name or "unknown", 
            lecture_mode=payload.lecture_mode,
            chat_history=payload.chat_history or ""
        )
        
        return ChatResponse(
            answer=answer,
            sources=retrieved_docs,
            course_name=course_name
        )
        
    except Exception as e:
        logger.error(f"Error in chat endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))
