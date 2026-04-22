import httpx
import logging
from typing import Optional
from app.core.config import settings

logger = logging.getLogger(__name__)

class DeepSeekService:
    def __init__(self):
        self.api_key = settings.DEEPSEEK_API_KEY
        self.base_url = settings.DEEPSEEK_API_BASE
        
        if not self.api_key:
            logger.warning("DeepSeek API Key is not set. LLM service will fail.")

    async def query_with_context(self, query: str, context: str) -> str:
        """
        Queries DeepSeek LLM with the provided context.
        """
        prompt = self._build_prompt(query, context)
        
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "DeepSeek-OCR-2", # Updated model name
                        "messages": [
                            {"role": "system", "content": "You are a helpful teaching assistant."},
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": 0.7,
                        "max_tokens": 1024
                    }
                )
                
                if response.status_code != 200:
                    logger.error(f"DeepSeek API Error: {response.status_code} - {response.text}")
                    return f"Error: Unable to get response from AI. (Status: {response.status_code})"
                
                data = response.json()
                answer = data['choices'][0]['message']['content']
                return answer

        except httpx.RequestError as e:
            logger.error(f"Network error when calling DeepSeek API: {e}")
            return "Error: Network connection to AI service failed."
        except Exception as e:
            logger.error(f"Unexpected error in LLM service: {e}")
            return "Error: An unexpected error occurred."

    def _build_prompt(self, query: str, context: str) -> str:
        """
        Constructs the RAG prompt.
        """
        if not context:
            context = "暂无参考资料。"
            
        return f"""
你是一个助教。请根据以下参考资料回答学生问题：

【参考资料】：
{context}

【学生问题】：
{query}

如果资料中没有提到，请诚实告知，不要胡编乱造。
"""

llm_service = DeepSeekService()
