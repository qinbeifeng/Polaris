import os
from typing import List
from pypdf import PdfReader

class DocumentLoader:
    def __init__(self, chunk_size: int = 500, chunk_overlap: int = 50):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def load_file(self, file_path: str) -> List[str]:
        """
        Loads a file (.txt or .pdf) and returns a list of text chunks.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        file_ext = os.path.splitext(file_path)[1].lower()
        
        if file_ext == '.txt':
            with open(file_path, 'r', encoding='utf-8') as f:
                text = f.read()
        elif file_ext == '.pdf':
            text = self._read_pdf(file_path)
        else:
            raise ValueError(f"Unsupported file type: {file_ext}")

        return self._split_text(text)

    def _read_pdf(self, file_path: str) -> str:
        reader = PdfReader(file_path)
        text = ""
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
        return text

    def _split_text(self, text: str) -> List[str]:
        """
        Simple sliding window text splitter.
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
            # Ensure we always move forward at least 1 char
            step = max(1, self.chunk_size - self.chunk_overlap)
            start += step
            
        return chunks

# Usage example
if __name__ == "__main__":
    loader = DocumentLoader()
    # Test with a dummy file if needed
    # print(loader._split_text("A" * 1000))
