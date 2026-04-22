import logging
from typing import AsyncGenerator, Optional
from openai import AsyncOpenAI, APIError
from app.core.config import settings

logger = logging.getLogger(__name__)

class LLMHandler:
    def __init__(self):
        self.api_key = settings.DEEPSEEK_API_KEY
        self.base_url = settings.DEEPSEEK_API_BASE
        
        # Initialize AsyncOpenAI client for DeepSeek
        try:
            self.client = AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url
            )
            logger.info(f"LLM Handler initialized with base_url: {self.base_url}")
        except Exception as e:
            logger.error(f"Failed to initialize OpenAI client: {e}")
            self.client = None
        
    async def chat_with_context(self, query: str, page_context: str = "", rag_context: str = "", course_name: str = "通用", lecture_mode: bool = False, chat_history: str = "", system_prompt_override: Optional[str] = None) -> str:
        """
        Generates a chat response using RAG context only.
        Role: 课程智能助教
        """
        if not self.client:
            return "Error: LLM client is not initialized."

        system_prompt = system_prompt_override or self._build_strict_system_prompt(
            page_context,
            rag_context,
            course_name,
            lecture_mode=lecture_mode,
            chat_history=chat_history,
        )
        
        messages = [
            {"role": "system", "content": system_prompt}
        ]

        user_content = []
        if chat_history and str(chat_history).strip():
            user_content.append({"type": "text", "text": f"对话历史：\n{chat_history}\n"})
        user_content.append({"type": "text", "text": f"本轮任务：\n{query}"})

        messages.append({"role": "user", "content": user_content})

        try:
            # User requested model change to DeepSeek-Chat (reverted)
            response = await self.client.chat.completions.create(
                model="deepseek-chat", 
                messages=messages, 
                temperature=0.3, 
                max_tokens=1024, 
                stream=False
            )
            
            return response.choices[0].message.content
                
        except APIError as e:
            logger.error(f"DeepSeek API Error: {e}")
            return f"不好意思，AI 服务现在有点忙（{e.code}）。"
        except Exception as e:
            logger.error(f"LLM Handler Error: {e}")
            return "不好意思，我这边刚刚出了一点小问题，稍后再试一下。"

    def _build_strict_system_prompt(self, page_context: str, rag_context: str, course_name: str, lecture_mode: bool = False, chat_history: str = "") -> str:
        normalized_course = (course_name or "").strip()
        is_free_mode = normalized_course in {"General", "通用", "general"}

        if is_free_mode:
            base_role = "你叫小星，是风趣幽默的课程智能助教。全程用口语化表达，适合语音朗读；不要使用Markdown格式。"

            context_instruction = f"""
回答要求：
1 这是自由模式：不要输出任何“知识库未找到/未命中”的提示语
2 输出时不要写任何小标题或标签（例如“开场白/讲解/过渡”等字样），直接用自然段落把内容讲清楚并保持上下文连贯
3 若课程知识库（RAG）为空，直接基于通用知识回答
"""
            context_block = f"【可选课程知识库（RAG）】：\n{rag_context if rag_context else '（空）'}"
            history_block = f"【对话历史】：\n{chat_history.strip() if chat_history and chat_history.strip() else '（无）'}"
            format_block = "输出格式：直接输出 2-4 段自然中文，不要输出任何小标题或标签。"
            coherence_block = "连贯性要求：如果对话历史里已经讲到某个点，先用1-2句自然回接，再继续往下讲；避免重复啰嗦。"
            return f"{base_role}\n{context_instruction}\n{history_block}\n{context_block}\n{coherence_block}\n{format_block}"

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

        context_block = f"【课程知识库（RAG）】：\n{rag_context if rag_context else '（空）'}"
        history_block = f"【对话历史】：\n{chat_history.strip() if chat_history and chat_history.strip() else '（无）'}"
        page_block = f"【课堂上下文（可选）】：\n{page_context.strip() if page_context and page_context.strip() else '（无）'}"

        format_block = (
            "输出格式要求：不要输出任何小标题或标签（例如“开场白/讲解/过渡”等字样）。"
            "直接输出 2-4 段自然中文：第一段用一句话友好开头并点题；中间段把要点讲清楚；最后一段用一句话总结并自然抛出 1 个可选追问。"
        )
        coherence_block = "连贯性要求：如果对话历史里已经讲到某个点，先用1-2句自然回接，再继续往下讲；避免重复啰嗦。"
        return f"{base_role}\n{context_instruction}\n{history_block}\n{page_block}\n{context_block}\n{coherence_block}\n{format_block}"

    async def generate_lecture_script(self, course_name: str, key_content: str) -> str:
        if not self.client:
            return "AI 未初始化"
        prompt = (
            f"课程《{course_name}》讲授脚本。"
            f"参考课程知识库（RAG）内容：\n{key_content if key_content else '（空）'}\n"
            "输出包含：开场白、讲解、过渡语，结构化但不使用Markdown。"
        )
        try:
            response = await self.client.chat.completions.create(
                model="deepseek-chat",
                messages=[
                    {"role": "system", "content": "你叫小星，是课程智能助教，只基于课程知识库生成讲授脚本。"},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.5,
                max_tokens=1200,
                stream=False,
            )
            return response.choices[0].message.content
        except Exception as e:
            return "生成失败"

    async def generate_mastery_assessment(self, course_name: str, key_content: str, student_notes: str = "") -> str:
        if not self.client:
            return "[]"
        prompt = (
            f"课程《{course_name}》的知识点掌握评估。"
            f"参考课程知识库（RAG）内容：\n{key_content if key_content else '（空）'}\n"
            f"学生反馈：\n{student_notes}\n"
            "输出JSON数组，每项包含：point(知识点名)、mastery(0-100整数)。只输出JSON。"
        )
        try:
            response = await self.client.chat.completions.create(
                model="deepseek-chat",
                messages=[
                    {"role": "system", "content": "你叫小星，是课程智能助教，只基于课程知识库生成结构化评估。"},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=800,
                stream=False,
            )
            return response.choices[0].message.content
        except Exception:
            return "[]"

llm_handler = LLMHandler()
