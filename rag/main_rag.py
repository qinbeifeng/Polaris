import logging
from typing import List
from rag.vector_store import get_vector_store
from rag.llm_service import llm_service
from rag.document_loader import DocumentLoader

logger = logging.getLogger(__name__)

# Initialize components
# Note: In a production app, these might be initialized via dependency injection
try:
    vector_store = get_vector_store()
except Exception as e:
    logger.error(f"Failed to initialize Vector Store: {e}")
    vector_store = None

document_loader = DocumentLoader()

async def rag_pipeline(query: str) -> str:
    """
    Main RAG pipeline:
    1. Retrieve relevant documents from Vector Store.
    2. Construct prompt with context.
    3. Query LLM.
    """
    if not query:
        return "请输入有效的问题。"

    context = ""
    try:
        # 1. Retrieval
        if vector_store:
            retrieved_docs = vector_store.search(query, top_k=3)
            if retrieved_docs:
                context = "\n\n".join(retrieved_docs)
            else:
                logger.info("No relevant documents found in vector store.")
        else:
            logger.warning("Vector store is not available. Skipping retrieval.")
            
    except Exception as e:
        logger.error(f"Error during retrieval: {e}")
        # Continue without context rather than failing completely
        context = ""

    # 2. & 3. Generation
    try:
        answer = await llm_service.query_with_context(query, context)
        return answer
    except Exception as e:
        logger.error(f"Error during generation: {e}")
        return "抱歉，系统暂时无法回答您的问题。"

def ingest_document(file_path: str) -> bool:
    """
    Helper function to load a document and add it to the vector store.
    """
    try:
        chunks = document_loader.load_file(file_path)
        if not chunks:
            logger.warning(f"No text extracted from {file_path}")
            return False
            
        if vector_store:
            success = vector_store.add_documents(chunks)
            return success
        else:
            logger.error("Vector store not initialized.")
            return False
            
    except Exception as e:
        logger.error(f"Error ingesting document {file_path}: {e}")
        return False

# Example usage for testing
if __name__ == "__main__":
    import asyncio
    
    async def main():
        # 1. Test Ingestion (Optional: uncomment if you have a file)
        # ingest_document("sample_course.txt")
        
        # 2. Test Query
        query = "什么是人工智能？"
        print(f"Query: {query}")
        answer = await rag_pipeline(query)
        print(f"Answer: {answer}")

    asyncio.run(main())
