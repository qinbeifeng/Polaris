import logging
import uuid
from typing import List, Dict, Any, Optional

try:
    from pymilvus import connections, Collection, FieldSchema, CollectionSchema, DataType, utility
except ImportError:
    logging.warning("pymilvus not installed. MilvusVectorStore will not work.")

from sentence_transformers import SentenceTransformer
from app.core.config import settings

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class VectorStore:
    def add_documents(self, documents: List[str]) -> bool:
        raise NotImplementedError

    def search(self, query: str, top_k: int = 3) -> List[str]:
        raise NotImplementedError

class MilvusVectorStore(VectorStore):
    def __init__(self, 
                 host: str = "localhost", 
                 port: str = "19530", 
                 collection_name: str = settings.MILVUS_COLLECTION_NAME,
                 embedding_model_name: str = settings.EMBEDDING_MODEL_NAME):
        
        self.collection_name = collection_name
        self.embedding_model = SentenceTransformer(embedding_model_name)
        self.embedding_dim = self.embedding_model.get_sentence_embedding_dimension()

        # Connect to Milvus
        try:
            # Parse URI if provided in settings, otherwise use host/port
            # Simple parsing for http://host:port
            uri = settings.MILVUS_URI
            if uri.startswith("http://"):
                uri = uri.replace("http://", "")
                if ":" in uri:
                    host, port = uri.split(":")
            
            connections.connect("default", host=host, port=port)
            logger.info(f"Connected to Milvus at {host}:{port}")
            
            self._init_collection()
            
        except Exception as e:
            logger.error(f"Failed to connect to Milvus: {e}")
            # Fallback logic could go here (e.g. switch to LocalVectorStore)

    def _init_collection(self):
        """
        Initialize the collection schema if it doesn't exist.
        """
        if not utility.has_collection(self.collection_name):
            fields = [
                FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=64, auto_id=False),
                FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=self.embedding_dim),
                FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535) # Max length for VARCHAR in Milvus
            ]
            schema = CollectionSchema(fields, description="Course Knowledge Base")
            self.collection = Collection(self.collection_name, schema)
            
            # Create index for faster search
            index_params = {
                "metric_type": "L2",
                "index_type": "IVF_FLAT",
                "params": {"nlist": 128}
            }
            self.collection.create_index(field_name="embedding", index_params=index_params)
            logger.info(f"Collection '{self.collection_name}' created.")
        else:
            self.collection = Collection(self.collection_name)
            self.collection.load()
            logger.info(f"Collection '{self.collection_name}' loaded.")

    def add_documents(self, documents: List[str]) -> bool:
        if not documents:
            return False

        try:
            embeddings = self.embedding_model.encode(documents)
            ids = [str(uuid.uuid4()) for _ in range(len(documents))]
            
            # Entities to insert: [[ids], [embeddings], [texts]]
            # Milvus expects list of columns
            entities = [
                ids,
                embeddings,
                documents
            ]
            
            self.collection.insert(entities)
            self.collection.flush() # Ensure data is visible
            logger.info(f"Inserted {len(documents)} documents into Milvus.")
            return True
        except Exception as e:
            logger.error(f"Error adding documents: {e}")
            return False

    def search(self, query: str, top_k: int = 3) -> List[str]:
        try:
            query_embedding = self.embedding_model.encode([query])
            
            search_params = {"metric_type": "L2", "params": {"nprobe": 10}}
            
            results = self.collection.search(
                data=query_embedding, 
                anns_field="embedding", 
                param=search_params, 
                limit=top_k, 
                output_fields=["text"]
            )

            retrieved_texts = []
            for hits in results:
                for hit in hits:
                    retrieved_texts.append(hit.entity.get("text"))
            
            return retrieved_texts
        except Exception as e:
            logger.error(f"Error searching documents: {e}")
            return []

class LocalVectorStore(VectorStore):
    """
    Simple in-memory vector store for fallback/testing without Milvus.
    Uses numpy for cosine similarity.
    """
    def __init__(self, embedding_model_name: str = settings.EMBEDDING_MODEL_NAME):
        import numpy as np
        self.documents = []
        self.embeddings = None
        self.embedding_model = SentenceTransformer(embedding_model_name)
        self.np = np
        logger.info("Initialized LocalVectorStore (In-Memory).")

    def add_documents(self, documents: List[str]) -> bool:
        if not documents:
            return False
        
        new_embeddings = self.embedding_model.encode(documents)
        
        if self.embeddings is None:
            self.embeddings = new_embeddings
        else:
            self.embeddings = self.np.vstack((self.embeddings, new_embeddings))
            
        self.documents.extend(documents)
        logger.info(f"Added {len(documents)} documents to local store.")
        return True

    def search(self, query: str, top_k: int = 3) -> List[str]:
        if self.embeddings is None or len(self.documents) == 0:
            return []
            
        query_embedding = self.embedding_model.encode([query])[0]
        
        # Calculate Cosine Similarity
        # norm(a) * norm(b)
        scores = self.np.dot(self.embeddings, query_embedding) / (
            self.np.linalg.norm(self.embeddings, axis=1) * self.np.linalg.norm(query_embedding)
        )
        
        # Get top_k indices
        top_indices = self.np.argsort(scores)[::-1][:top_k]
        
        return [self.documents[i] for i in top_indices]

# Factory to get vector store
def get_vector_store() -> VectorStore:
    # Try connecting to Milvus first? 
    # For now, let's just return MilvusStore if configured, else fallback or error.
    # To keep it robust for the user who might not have Milvus running yet:
    try:
        return MilvusVectorStore()
    except Exception as e:
        logger.warning(f"Could not initialize MilvusVectorStore: {e}. Falling back to LocalVectorStore.")
        return LocalVectorStore()
