# backend/embedder.py
# Generates embeddings via Nomic AI API (free, 1M tokens/month) and stores in the main relational DB

import requests
import os
from functools import lru_cache
from dotenv import load_dotenv
from database import PageCapture

def safe_int(val, default=-1) -> int:
    if val is None:
        return default
    if isinstance(val, int):
        return val
    if isinstance(val, bytes):
        import struct
        if len(val) == 8:
            try:
                q_val = struct.unpack('q', val)[0]
                if -1000 <= q_val <= 10000000:
                    return q_val
            except Exception:
                pass
            try:
                d_val = struct.unpack('d', val)[0]
                if -1000.0 <= d_val <= 10000000.0:
                    return int(round(d_val))
            except Exception:
                pass
        try:
            return int(val.decode('utf-8', errors='ignore'))
        except ValueError:
            return default
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return default

load_dotenv()

NOMIC_API_KEY = os.getenv("NOMIC_API_KEY")
NOMIC_URL = "https://api-atlas.nomic.ai/v1/embedding/text"
EMBED_MODEL = "nomic-embed-text-v1.5"


def get_embedding(text: str, nomic_key: str | None = None) -> list[float]:
    """Call Nomic AI API to get embedding vector. Free tier: 1M tokens/month."""
    active_key = nomic_key or NOMIC_API_KEY
    response = requests.post(
        NOMIC_URL,
        headers={"Authorization": f"Bearer {active_key}"},
        json={"texts": [text], "model": EMBED_MODEL, "task_type": "search_document"},
        timeout=30
    )
    response.raise_for_status()
    return response.json()["embeddings"][0]


@lru_cache(maxsize=128)
def get_query_embedding(text: str, nomic_key: str | None = None) -> tuple:
    """Separate task type for queries — improves retrieval quality.
    Cached so the same query always returns the exact same embedding,
    eliminating HNSW non-determinism from floating-point variance."""
    active_key = nomic_key or NOMIC_API_KEY
    response = requests.post(
        NOMIC_URL,
        headers={"Authorization": f"Bearer {active_key}"},
        json={"texts": [text], "model": EMBED_MODEL, "task_type": "search_query"},
        timeout=30
    )
    response.raise_for_status()
    # Return as tuple for hashability (lru_cache requirement)
    return tuple(response.json()["embeddings"][0])


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


def embed_and_store(capture: PageCapture, nomic_key: str | None = None):
    """Embed a single capture and save directly in the relational DB."""
    doc_text = build_document_text(capture)
    embedding = get_embedding(doc_text, nomic_key=nomic_key)
    capture.embedding = embedding


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


def get_all_embeddings_for_clustering(user_id: int):
    """Return all stored embeddings + IDs for DBSCAN clustering for a specific user from main DB."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        captures = db.query(PageCapture).filter(
            PageCapture.user_id == user_id,
            PageCapture.embedding != None
        ).all()
        ids = [c.id for c in captures]
        embeddings = [c.embedding for c in captures]
        metadatas = [{
            "url": c.url,
            "title": c.title,
            "domain": c.domain or "",
            "timestamp": float(c.timestamp),
            "cluster_id": safe_int(c.cluster_id),
            "user_id": safe_int(c.user_id),
        } for c in captures]
        return ids, embeddings, metadatas
    finally:
        db.close()