import sys
import os
import argparse
import asyncio
from tqdm import tqdm

# Ensure project root is in python path
# This allows importing 'rag' module which is at the project root level
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
# Also add backend to path for app.core.config
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../backend")))

from rag.loader import loader
from rag.processor import processor
from rag.vector_service import vector_service

async def process_course(doc_data):
    """
    Process a single document: Extract chunks -> Vectorize -> Store
    """
    # 1. Chunking
    chunks = processor.process_document(doc_data)
    if not chunks:
        return 0

    # 2. Vectorization & Storage (Batch)
    # Note: vector_service.add_chunks is synchronous but internal embedding can be optimized.
    # For true async parallelism, we would need an async vector service or run in executor.
    # Here we keep it simple as Milvus insert is fast, bottleneck is usually embedding.
    success = vector_service.add_chunks(chunks)
    return len(chunks) if success else 0

async def main(base_path: str):
    print(f"🚀 Starting ingestion from: {base_path}")
    
    if not os.path.exists(base_path):
        print(f"❌ Error: Directory not found: {base_path}")
        return

    # 1. Scan all files first to build a task list
    print("📂 Scanning directory structure...")
    documents = list(loader.scan_course_directory(base_path))
    total_files = len(documents)
    print(f"found {total_files} documents.")

    if total_files == 0:
        print("⚠️  No supported files found.")
        return

    # 2. Process with progress bar
    print("⚙️  Processing and ingesting...")
    total_chunks = 0
    
    with tqdm(total=total_files, desc="Ingesting Documents", unit="file") as pbar:
        for doc in documents:
            pbar.set_postfix(file=doc['file_name'][:20])
            
            # Process synchronously for now to avoid overloading memory/CPU with too many parallel embedding tasks
            chunks_count = await process_course(doc)
            total_chunks += chunks_count
            
            pbar.update(1)

    print(f"\n✅ Ingestion complete!")
    print(f"📚 Processed {total_files} files.")
    print(f"🧩 Created {total_chunks} vector chunks.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bulk ingest course materials into RAG knowledge base")
    parser.add_argument("--path", 
                        default="/Users/zzjay/Downloads/a12基于泛雅平台的AI互动智课生成与实时问答/课件下载-3月3日",
                        help="Base path containing course folders")
    
    args = parser.parse_args()
    
    try:
        asyncio.run(main(args.path))
    except KeyboardInterrupt:
        print("\n🛑 Ingestion stopped by user.")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
