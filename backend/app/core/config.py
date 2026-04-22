from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
import os

class Settings(BaseSettings):
    """Application Settings"""
    PROJECT_NAME: str = "AI Smart Course System"
    API_V1_STR: str = "/api"
    
    # Security
    API_KEY: str
    
    # Database & Cache
    REDIS_URL: str
    
    # RAG / Vector DB
    MILVUS_URI: str
    MILVUS_TOKEN: str = ""
    MILVUS_COLLECTION_NAME: str = "course_knowledge"
    EMBEDDING_MODEL_NAME: str = "sentence-transformers/all-MiniLM-L6-v2"
    
    # LLM Provider
    DEEPSEEK_API_KEY: str
    DEEPSEEK_API_BASE: str = "https://api.deepseek.com"
    
    # Task Queue
    CELERY_BROKER_URL: str
    CELERY_RESULT_BACKEND: str

    model_config = SettingsConfigDict(
        # Try loading from .env in backend directory if current .env fails
        env_file=[".env", "backend/.env", "../backend/.env"],
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

@lru_cache
def get_settings():
    return Settings()

settings = get_settings()
