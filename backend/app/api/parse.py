import sys
import os
import logging
import httpx
import tempfile
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from rag.loader import loader
from rag.processor import processor
from rag.vector_service import vector_service

logger = logging.getLogger(__name__)
router = APIRouter()

class ParseRequest(BaseModel):
    url: str = Field(..., description="URL of the document to parse")
    course_name: str = Field(..., description="Course name for metadata")

@router.post("/parse_url", summary="Real-time Document Parsing")
async def parse_url_endpoint(payload: ParseRequest):
    """
    Downloads a document from a URL, parses it, and ingests it into Milvus.
    """
    try:
        logger.info(f"Downloading document from: {payload.url}")
        
        # Download file
        async with httpx.AsyncClient() as client:
            response = await client.get(payload.url)
            if response.status_code != 200:
                raise HTTPException(status_code=400, detail="Failed to download document")
            
            # Determine extension
            content_type = response.headers.get("content-type", "")
            ext = ".pdf" if "pdf" in content_type else ".pptx"
            if payload.url.endswith(".pdf"): ext = ".pdf"
            if payload.url.endswith(".pptx"): ext = ".pptx"

            # Save to temp file
            with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp_file:
                tmp_file.write(response.content)
                tmp_path = tmp_file.name

        logger.info(f"Processing downloaded file: {tmp_path}")
        
        # Use existing loader logic
        # Loader expects a directory usually, but we can reuse extract methods if we refactor or just use loader instance methods
        # For now, let's assume we can call internal extraction methods or wrap it
        
        content = []
        if ext == ".pdf":
            content = loader._extract_pdf(tmp_path)
        elif ext == ".pptx":
            content = loader._extract_pptx(tmp_path)
            
        if not content:
            os.unlink(tmp_path)
            return {"status": "warning", "message": "No text extracted"}

        # Process and Ingest
        doc_data = {
            "course_name": payload.course_name,
            "file_name": os.path.basename(payload.url),
            "content": content
        }
        
        chunks = processor.process_document(doc_data)
        if chunks:
            vector_service.add_chunks(chunks)
            logger.info(f"Ingested {len(chunks)} chunks from URL")
        
        os.unlink(tmp_path)
        return {"status": "success", "chunks_count": len(chunks)}

    except Exception as e:
        logger.error(f"Error parsing URL: {e}")
        raise HTTPException(status_code=500, detail=str(e))
