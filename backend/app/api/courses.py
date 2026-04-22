import json
import os
import shutil
import uuid
from typing import List
from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from app.models.schemas import Course, Document
from rag.vector_service import vector_service
from rag.loader import loader
from rag.processor import processor
from app.api.parse import parse_url_endpoint, ParseRequest

router = APIRouter()
DATA_FILE = "backend/data/courses.json"

OFFICIAL_COURSES = [
    "材料力学智慧课程",
    "电工技术 I",
    "汽车构造",
    "制冷原理与设备、建筑冷热源",
    "自动控制原理"
]

def load_courses_data() -> List[dict]:
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Migration check: if list of strings (legacy), convert or return empty
            if data and isinstance(data, list) and len(data) > 0 and isinstance(data[0], str):
                return [] 
            return data
    except Exception:
        return []

def save_courses_data(courses: List[dict]):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(courses, f, ensure_ascii=False, indent=2)

async def initialize_default_courses():
    current_data = load_courses_data()
    current_names = {c["name"] for c in current_data}
    
    new_added = []
    for name in OFFICIAL_COURSES:
        if name not in current_names:
            course = {
                "id": str(uuid.uuid4()),
                "name": name,
                "description": "官方课程",
                "documents": []
            }
            current_data.append(course)
            new_added.append(name)
    
    if new_added:
        save_courses_data(current_data)
    return new_added

@router.post("/courses/init", summary="Initialize Official Courses")
async def init_courses():
    added = await initialize_default_courses()
    return {"message": "Initialization complete", "added": added}

@router.get("/courses", response_model=List[Course])
async def list_courses():
    """
    Dynamically list unique course names from Milvus collection.
    Falls back to local JSON if Milvus is unavailable.
    """
    try:
        if vector_service and getattr(vector_service, "collection", None):
            results = vector_service.collection.query(expr="pk >= 0", output_fields=["course_name"])
            unique = sorted({r.get("course_name") for r in results if r.get("course_name")})
            # Build Course models with stable ids (use name-based UUID-like format)
            courses = [
                Course(
                    id=name,
                    name=name,
                    description="来自 Milvus 知识库",
                    documents=[]
                )
                for name in unique
            ]
            return courses
    except Exception as e:
        # Log then gracefully fall back
        # Avoid crashing the API due to Milvus unavailability
        pass
    data = load_courses_data()
    return [Course(**c) for c in data]

@router.get("/courses/{course_id}/documents", response_model=List[Document])
async def get_course_documents(course_id: str):
    data = load_courses_data()
    for c in data:
        if c["id"] == course_id:
            return [Document(**d) for d in c.get("documents", [])]
    raise HTTPException(status_code=404, detail="Course not found")

@router.post("/courses/upload", status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    course_id: str = Form(...)
):
    try:
        # 1. Find Course
        data = load_courses_data()
        course = next((c for c in data if c["id"] == course_id), None)
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")

        # 2. Save File
        temp_dir = "backend/data/uploads"
        os.makedirs(temp_dir, exist_ok=True)
        file_path = os.path.join(temp_dir, file.filename)
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # 3. Extract & Vectorize
        content = []
        ext = os.path.splitext(file.filename)[1].lower()
        if ext == ".pdf":
            content = loader._extract_pdf(file_path)
        elif ext == ".pptx":
            content = loader._extract_pptx(file_path)
        
        if not content:
            os.remove(file_path)
            return {"status": "warning", "message": "No text extracted"}
            
        # Ingest to Milvus
        doc_data = {
            "course_name": course["name"], # Use Name for RAG isolation
            "file_name": file.filename,
            "content": content
        }
        chunks = processor.process_document(doc_data)
        if chunks:
            vector_service.add_chunks(chunks)
            
        # 4. Update Course Data
        new_doc = {
            "id": str(uuid.uuid4()),
            "name": file.filename,
            "path": file_path,
            "type": ext.replace(".", "")
        }
        course["documents"].append(new_doc)
        save_courses_data(data)
            
        return {"status": "success", "chunks": len(chunks), "document": new_doc}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
