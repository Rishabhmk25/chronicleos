# backend/embedder.py
# Generates embeddings via Nomic AI API (free, 1M tokens/month) and stores in ChromaDB

import chromadb
import requests
import os
from dotenv import load_dotenv
from database import PageCapture

load_dotenv()

NOMIC_API_KEY = os.getenv("NOMIC_API_KEY")
NOMIC_URL = "https://api-atlas.nomic.ai/v1/embedding/text"
EMBED_MODEL = "nomic-embed-text-v1.5"

# ChromaDB client — persisted to disk, no server needed
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection(
    name="pages",
    metadata={"hnsw:space": "cosine"}
)


def get_embedding(text: str) -> list[float]:
    """Call Nomic AI API to get embedding vector. Free tier: 1M tokens/month."""
    response = requests.post(
        NOMIC_URL,
        headers={"Authorization": f"Bearer {NOMIC_API_KEY}"},
        json={"texts": [text], "model": EMBED_MODEL, "task_type": "search_document"},
        timeout=30
    )
    response.raise_for_status()
    return response.json()["embeddings"][0]


def get_query_embedding(text: str) -> list[float]:
    """Separate task type for queries — improves retrieval quality."""
    response = requests.post(
        NOMIC_URL,
        headers={"Authorization": f"Bearer {NOMIC_API_KEY}"},
        json={"texts": [text], "model": EMBED_MODEL, "task_type": "search_query"},
        timeout=30
    )
    response.raise_for_status()
    return response.json()["embeddings"][0]


def build_document_text(capture: PageCapture) -> str:
    """Concatenate all available text for a page into one string to embed."""
    parts = [capture.title or "", capture.url or ""]
    if capture.selected_text:
        parts.append(capture.selected_text)
    if getattr(capture, "page_text", None):
        parts.append(capture.page_text)
    if capture.domain:
        parts.append(capture.domain)
    return " | ".join(filter(None, parts))


def embed_and_store(capture: PageCapture):
    """Embed a single capture and upsert into ChromaDB."""
    doc_text = build_document_text(capture)
    embedding = get_embedding(doc_text)

    collection.upsert(
        ids=[str(capture.id)],
        embeddings=[embedding],
        documents=[doc_text],
        metadatas=[{
            "url": capture.url,
            "title": capture.title,
            "domain": capture.domain or "",
            "timestamp": float(capture.timestamp),
            "cluster_id": int(capture.cluster_id) if capture.cluster_id is not None else -1,
        }]
    )


def embed_all_pending(db_session):
    """Batch embed all unembedded captures. Call this manually if needed."""
    pending = db_session.query(PageCapture).filter(PageCapture.embedded == 0).all()
    print(f"Embedding {len(pending)} pending captures...")
    for capture in pending:
        try:
            embed_and_store(capture)
            capture.embedded = 1
            db_session.commit()
            print(f"  ✓ {capture.title[:50]}")
        except Exception as e:
            print(f"  ✗ Failed {capture.id}: {e}")


def get_all_embeddings_for_clustering():
    """Return all stored embeddings + IDs for DBSCAN clustering."""
    results = collection.get(include=["embeddings", "metadatas"])
    return results["ids"], results["embeddings"], results["metadatas"]