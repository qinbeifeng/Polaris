import logging
import json
import time
from typing import List, Dict, Any, Optional
from sentence_transformers import SentenceTransformer
from pymilvus import (
    connections,
    utility,
    FieldSchema,
    CollectionSchema,
    DataType,
    Collection,
)
from app.core.config import settings

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

VECTOR_SERVICE_INIT_ERROR: Optional[str] = None
EMBEDDING_MODEL_INIT_ERROR: Optional[str] = None

_EMBEDDING_MODEL: Optional[SentenceTransformer] = None
_EMBEDDING_MODEL_NAME: Optional[str] = None
_EMBEDDING_DIM: Optional[int] = None

_VECTOR_SERVICE_LAST_INIT_TS: float = 0.0
_VECTOR_SERVICE_RETRY_COOLDOWN_SECONDS: float = 10.0


def _get_embedding_model_and_dim(model_name: str) -> tuple[SentenceTransformer, int]:
    global _EMBEDDING_MODEL, _EMBEDDING_MODEL_NAME, _EMBEDDING_DIM, EMBEDDING_MODEL_INIT_ERROR

    if _EMBEDDING_MODEL and _EMBEDDING_MODEL_NAME == model_name and _EMBEDDING_DIM:
        return _EMBEDDING_MODEL, int(_EMBEDDING_DIM)

    try:
        model = SentenceTransformer(model_name)
        dim = int(model.get_sentence_embedding_dimension())
        _EMBEDDING_MODEL = model
        _EMBEDDING_MODEL_NAME = model_name
        _EMBEDDING_DIM = dim
        EMBEDDING_MODEL_INIT_ERROR = None
        return model, dim
    except Exception as e:
        EMBEDDING_MODEL_INIT_ERROR = str(e)
        logger.exception("Failed to load embedding model")
        raise

class VectorService:
    def __init__(self):
        self.collection_name = "course_knowledge"
        self.embedding_model_name = settings.EMBEDDING_MODEL_NAME
        self.milvus_uri = settings.MILVUS_URI
        
        # Load embedding model
        # all-MiniLM-L6-v2 produces 384-dimensional vectors
        self.embedding_model, self.embedding_dim = _get_embedding_model_and_dim(self.embedding_model_name)
        
        # Connect and Initialize
        self.connect()
        self._init_collection()

    def connect(self):
        """
        Connects to the Milvus server.
        """
        try:
            # Parse URI (http://localhost:19530 -> host=localhost, port=19530)
            host = "localhost"
            port = "19530"
            uri = self.milvus_uri
            if uri.startswith("http://"):
                uri = uri.replace("http://", "")
                if ":" in uri:
                    host, port = uri.split(":")
            
            token = getattr(settings, "MILVUS_TOKEN", "") or None
            user = None
            password = None
            if token and ":" in token:
                user, password = token.split(":", 1)
            if user and password:
                connections.connect("default", host=host, port=port, user=user, password=password)
                logger.info(f"✅ Connected to Milvus at {host}:{port} (user={user})")
            else:
                connections.connect("default", host=host, port=port, token=token)
                logger.info(f"✅ Connected to Milvus at {host}:{port} (token={'set' if token else 'none'})")
        except Exception as e:
            logger.exception("❌ Failed to connect to Milvus")
            raise ConnectionError(f"Could not connect to Milvus: {e}")

    def _init_collection(self):
        """
        Initializes the Milvus collection with the required schema.
        """
        if utility.has_collection(self.collection_name):
            self.collection = Collection(self.collection_name)
            self.collection.load()
            logger.info(f"📂 Collection '{self.collection_name}' loaded.")
        else:
            # Schema Definition
            fields = [
                # Automatic primary key
                FieldSchema(name="pk", dtype=DataType.INT64, is_primary=True, auto_id=True),
                # Vector field (Dimension must match embedding model)
                FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=self.embedding_dim),
                # Metadata fields
                FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535),
                FieldSchema(name="course_name", dtype=DataType.VARCHAR, max_length=256),
                FieldSchema(name="source_info", dtype=DataType.JSON) # Requires Milvus 2.3+
            ]
            
            schema = CollectionSchema(fields, description="Course Knowledge Base")
            self.collection = Collection(self.collection_name, schema)
            
            # Create Index for faster search
            index_params = {
                "metric_type": "L2",
                "index_type": "IVF_FLAT",
                "params": {"nlist": 128}
            }
            self.collection.create_index(field_name="vector", index_params=index_params)
            self.collection.load()
            logger.info(f"🆕 Collection '{self.collection_name}' created and loaded.")

    def add_chunks(self, chunks: List[Dict[str, Any]]) -> bool:
        """
        Adds processed chunks to Milvus.
        Input: [{"text": "...", "metadata": {"course_name": "...", "file_name": "...", "page_num": 1}}, ...]
        """
        if not chunks:
            return False

        texts = [chunk["text"] for chunk in chunks]
        metadatas = [chunk["metadata"] for chunk in chunks]

        try:
            # 1. Generate Embeddings
            embeddings = self.embedding_model.encode(texts)
            
            # 2. Prepare Data for Insertion
            # Milvus expects list of columns: [[vector...], [text...], [course_name...], [source_info...]]
            
            course_names = [m.get("course_name", "Unknown") for m in metadatas]
            
            # Prepare source_info JSON
            source_infos = []
            for m in metadatas:
                info = {
                    "file_name": m.get("file_name", ""),
                    "page_num": m.get("page_num", 0)
                }
                source_infos.append(info)

            entities = [
                embeddings,
                texts,
                course_names,
                source_infos
            ]
            
            # 3. Insert and Flush
            self.collection.insert(entities)
            self.collection.flush() # Ensure data is persisted immediately
            
            logger.info(f"📥 Inserted {len(chunks)} chunks into Milvus.")
            return True
            
        except Exception as e:
            logger.exception("❌ Error adding chunks to Milvus")
            return False

    def search_top_k(self, query: str, top_k: int = 3, course_name: Optional[str] = None) -> List[str]:
        """
        Searches for relevant texts.
        Supports filtering by course_name.
        """
        items = self.search_top_k_with_sources(query=query, top_k=top_k, course_name=course_name)
        return [i.get("text", "") for i in items if i.get("text")]

    def search_top_k_with_sources(
        self, query: str, top_k: int = 3, course_name: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        try:
            query_embedding = self.embedding_model.encode([query])

            search_params = {"metric_type": "L2", "params": {"nprobe": 10}}

            expr = None
            if course_name:
                expr = f'course_name == "{course_name}"'

            results = self.collection.search(
                data=query_embedding,
                anns_field="vector",
                param=search_params,
                limit=top_k,
                expr=expr,
                output_fields=["text", "course_name", "source_info"],
            )

            out: List[Dict[str, Any]] = []
            for hits in results:
                for hit in hits:
                    text = hit.entity.get("text")
                    src = hit.entity.get("source_info") or {}
                    if isinstance(src, str):
                        try:
                            src = json.loads(src)
                        except Exception:
                            src = {}
                    file_name = ""
                    page_num = 0
                    if isinstance(src, dict):
                        file_name = str(src.get("file_name") or src.get("fileName") or "")
                        try:
                            page_num = int(src.get("page_num") or src.get("page") or 0)
                        except Exception:
                            page_num = 0

                    out.append(
                        {
                            "fileName": file_name,
                            "page": page_num,
                            "text": text,
                        }
                    )
            return out
        except Exception as e:
            logger.exception("❌ Error searching Milvus")
            return []

vector_service: Optional[VectorService] = None


def get_vector_service(force: bool = False) -> Optional[VectorService]:
    global vector_service, VECTOR_SERVICE_INIT_ERROR, _VECTOR_SERVICE_LAST_INIT_TS

    if vector_service and not force:
        return vector_service

    now = time.time()
    if not force and (now - _VECTOR_SERVICE_LAST_INIT_TS) < _VECTOR_SERVICE_RETRY_COOLDOWN_SECONDS:
        return None

    _VECTOR_SERVICE_LAST_INIT_TS = now
    try:
        vector_service = VectorService()
        VECTOR_SERVICE_INIT_ERROR = None
        return vector_service
    except Exception as e:
        VECTOR_SERVICE_INIT_ERROR = str(e)
        logger.exception("Failed to initialize VectorService")
        vector_service = None
        return None


get_vector_service(force=True)
