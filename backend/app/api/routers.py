import sys
import os

# Ensure project root is in python path to allow importing 'rag' module
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../")))

from fastapi import APIRouter, Depends, HTTPException
from app.models.schemas import TestRequest, TestResponse
# Import the new chat router logic if needed, or keep existing and redirect
# For now, we will use the new backend/app/api/chat.py as the source of truth for /chat
# But to maintain compatibility with existing main.py include, we can re-export or update main.py

# Create API router
router = APIRouter()

@router.post("/test", response_model=TestResponse, summary="Test Endpoint")
async def test_endpoint(payload: TestRequest):
    """
    Test endpoint to verify API functionality.
    """
    return TestResponse(
        message="Test successful",
        received_data=payload.input_data
    )
