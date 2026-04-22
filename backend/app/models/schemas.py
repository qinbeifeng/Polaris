from pydantic import BaseModel, Field
from typing import List, Optional

class HealthCheck(BaseModel):
    """Health check response model"""
    status: str = Field(..., description="System status")
    version: str = Field(..., description="API Version")

class TestRequest(BaseModel):
    """Test endpoint request model"""
    input_data: str = Field(..., description="Input data to echo back")

class TestResponse(BaseModel):
    """Test endpoint response model"""
    message: str = Field(..., description="Response message")
    received_data: str = Field(..., description="Echoed input data")

class ChatRequest(BaseModel):
    """Chat request model for RAG"""
    query: str = Field(..., description="User question")

class ChatResponse(BaseModel):
    """Chat response model for RAG"""
    answer: str = Field(..., description="AI generated answer")

class Document(BaseModel):
    id: str = Field(..., description="Document ID")
    name: str = Field(..., description="File name")
    path: str = Field(..., description="File path on server or URL")
    type: str = Field(..., description="File type (pdf, pptx, url)")

class Course(BaseModel):
    id: str = Field(..., description="Course ID")
    name: str = Field(..., description="Course Name")
    description: Optional[str] = Field(None, description="Course Description")
    documents: List[Document] = Field(default=[], description="List of documents")
