from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from app.core.config import settings
from app.api.routers import router as api_router
from app.api.chat import router as chat_router
from app.api.courses import router as courses_router, initialize_default_courses
from app.api.parse import router as parse_router
from app.api.lecture import router as lecture_router
from app.api.progress import router as progress_router
from app.api.vector import router as vector_router
from app.api.auth_platform import router as auth_router
from app.api.user_platform import router as user_router
from app.api.course_platform import router as course_router
from app.api.material_platform import router as material_router
from app.api.chat_platform import router as chat_platform_router
from app.platform.db import init_db, ensure_default_users
from app.models.schemas import HealthCheck

# Initialize FastAPI application
app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    description="AI Smart Course System Backend API"
)

@app.on_event("startup")
async def startup_event():
    init_db()
    ensure_default_users()
    await initialize_default_courses()

# CORS Configuration
# Allow all origins for development (Plugin development needs this)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Health Check
@app.get("/health", response_model=HealthCheck, tags=["System"])
async def health_check():
    """
    System health check endpoint.
    Returns status and current version.
    """
    return HealthCheck(status="ok", version="0.1.0")

# Include API Routers
app.include_router(api_router, prefix=settings.API_V1_STR, tags=["API"])
app.include_router(chat_router, prefix=settings.API_V1_STR, tags=["Chat"])
app.include_router(chat_platform_router, prefix=settings.API_V1_STR, tags=["Chat Platform"])
app.include_router(courses_router, prefix=settings.API_V1_STR, tags=["Courses"])
app.include_router(auth_router, prefix=settings.API_V1_STR, tags=["Auth"])
app.include_router(user_router, prefix=settings.API_V1_STR, tags=["User"])
app.include_router(course_router, prefix=settings.API_V1_STR, tags=["Course Platform"])
app.include_router(material_router, prefix=settings.API_V1_STR, tags=["Material"])
app.include_router(parse_router, prefix=settings.API_V1_STR, tags=["Parse"])
app.include_router(lecture_router, prefix=settings.API_V1_STR, tags=["Lecture"])
app.include_router(progress_router, prefix=settings.API_V1_STR, tags=["Progress"])
app.include_router(vector_router, prefix=settings.API_V1_STR, tags=["Vector"])

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app", 
        host="0.0.0.0", 
        port=8000, 
        reload=True
    )
