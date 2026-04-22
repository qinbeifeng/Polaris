import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class DocumentProcessor:
    def __init__(self, chunk_size: int = 500, chunk_overlap: int = 50):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def process_document(self, doc_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Processes a loaded document dictionary and returns a list of chunks with metadata.
        Input: {
            "course_name": str,
            "file_name": str,
            "content": [{"text": "...", "page_num": 1}, ...]
        }
        Output: [
            {
                "text": "chunk text...",
                "metadata": {
                    "course_name": "...",
                    "file_name": "...",
                    "page_num": 1
                }
            }, ...
        ]
        """
        chunks = []
        course_name = doc_data.get("course_name", "Unknown")
        file_name = doc_data.get("file_name", "Unknown")

        for page in doc_data.get("content", []):
            page_text = page.get("text", "")
            page_num = page.get("page_num", 0)
            
            # Split text into chunks
            text_chunks = self._split_text(page_text)
            
            for chunk_text in text_chunks:
                chunks.append({
                    "text": chunk_text,
                    "metadata": {
                        "course_name": course_name,
                        "file_name": file_name,
                        "page_num": page_num
                    }
                })
        return chunks

    def _split_text(self, text: str) -> List[str]:
        """
        Recursive Character Text Splitter logic (Simplified).
        """
        if not text:
            return []
            
        chunks = []
        start = 0
        text_len = len(text)

        while start < text_len:
            end = start + self.chunk_size
            chunk = text[start:end]
            chunks.append(chunk)
            
            # Move forward by (chunk_size - overlap)
            step = max(1, self.chunk_size - self.chunk_overlap)
            start += step
            
        return chunks

processor = DocumentProcessor()
