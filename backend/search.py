"""
Hybrid Search Engine for ChronicleOS.
Uses pgvector on PostgreSQL / Supabase, and exact brute-force cosine similarity on SQLite
to guarantee 100% deterministic, ultra-fast results.
"""

import re
import numpy as np
from rank_bm25 import BM25Okapi
from functools import lru_cache
from embedder import get_query_embedding, build_document_text
from database import PageCapture, SessionLocal, is_postgres

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

# Stop words to filter from queries
STOP_WORDS = {
    "show", "me", "everything", "about", "what", "is", "the", "a", "an",
    "how", "does", "do", "did", "was", "were", "are", "can", "could",
    "tell", "give", "find", "search", "all", "my", "i", "learning",
    "researching", "details", "detail", "information", "info", "explain",
}


def tokenize(text: str) -> list[str]:
    return text.lower().split()


def extract_key_terms(query: str) -> list[str]:
    """Extract meaningful keywords from a query, filtering out stop words."""
    words = re.findall(r'[a-zA-Z0-9]+', query.lower())
    return [w for w in words if w not in STOP_WORDS and len(w) > 1]


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Exact cosine similarity between two vectors."""
    dot = np.dot(a, b)
    norm = np.linalg.norm(a) * np.linalg.norm(b)
    if norm == 0:
        return 0.0
    return float(dot / norm)


def exact_vector_search(query: str, user_id: int, n_results: int = 30, nomic_key: str | None = None) -> list[dict]:
    """
    Direct pgvector database query if running on PostgreSQL/Supabase.
    Otherwise, fallback to brute-force exact cosine similarity search over SQLite database records.
    """
    # Get query embedding (cached via lru_cache)
    query_emb = get_query_embedding(query, nomic_key=nomic_key)
    query_emb_list = list(query_emb)

    db = SessionLocal()
    try:
        if is_postgres:
            # PostgreSQL native pgvector cosine similarity search.
            # <=> operator is represented by .cosine_distance() in pgvector.sqlalchemy
            captures = db.query(PageCapture).filter(
                PageCapture.user_id == user_id,
                PageCapture.embedding != None
            ).order_by(
                PageCapture.embedding.cosine_distance(query_emb_list)
            ).limit(n_results).all()

            hits = []
            query_emb_np = np.array(query_emb_list)
            for c in captures:
                score = cosine_similarity(query_emb_np, np.array(c.embedding))
                hits.append({
                    "id": c.id,
                    "document": build_document_text(c),
                    "metadata": {
                        "url": c.url,
                        "title": c.title,
                        "domain": c.domain or "",
                        "timestamp": float(c.timestamp),
                        "cluster_id": safe_int(c.cluster_id),
                        "user_id": safe_int(c.user_id),
                    },
                    "vector_score": score,
                })
            # Ensure hits are sorted descending by vector_score
            hits.sort(key=lambda x: x["vector_score"], reverse=True)
            return hits
        else:
            # SQLite fallback: load all user captures and calculate similarity in Python
            captures = db.query(PageCapture).filter(
                PageCapture.user_id == user_id,
                PageCapture.embedding != None
            ).all()

            if not captures:
                return []

            hits = []
            query_emb_np = np.array(query_emb_list)
            for c in captures:
                doc_emb = np.array(c.embedding)
                score = cosine_similarity(query_emb_np, doc_emb)
                hits.append({
                    "id": c.id,
                    "document": build_document_text(c),
                    "metadata": {
                        "url": c.url,
                        "title": c.title,
                        "domain": c.domain or "",
                        "timestamp": float(c.timestamp),
                        "cluster_id": safe_int(c.cluster_id),
                        "user_id": safe_int(c.user_id),
                    },
                    "vector_score": score,
                })

            hits.sort(key=lambda x: x["vector_score"], reverse=True)
            return hits[:n_results]
    finally:
        db.close()


def bm25_rerank(query: str, candidates: list[dict]) -> list[dict]:
    """Rerank candidates using BM25 keyword matching + title bonus."""
    if not candidates:
        return []

    corpus = [tokenize(c["document"]) for c in candidates]
    bm25 = BM25Okapi(corpus)
    scores = bm25.get_scores(tokenize(query))

    # Normalize BM25 scores to 0-1
    max_score = max(scores) if max(scores) > 0 else 1
    bm25_norm = scores / max_score

    key_terms = extract_key_terms(query)

    for i, candidate in enumerate(candidates):
        candidate["bm25_score"] = float(bm25_norm[i])

        # Title-match bonus
        title = candidate.get("metadata", {}).get("title", "").lower()
        if key_terms:
            title_match_ratio = sum(1 for w in key_terms if w in title) / len(key_terms)
        else:
            title_match_ratio = 0
        title_bonus = 0.25 * title_match_ratio

        candidate["hybrid_score"] = (
            0.4 * candidate["vector_score"] + 0.6 * candidate["bm25_score"] + title_bonus
        )

    return sorted(candidates, key=lambda x: x["hybrid_score"], reverse=True)


def search(query: str, user_id: int, top_k: int = 10, nomic_key: str | None = None) -> list[dict]:
    """
    Deterministic hybrid search pipeline:
    1. Exact brute-force / pgvector similarity search
    2. BM25 reranking for keyword precision
    3. Enrich with database metadata
    """
    # Step 1: Exact vector search (deterministic)
    candidates = exact_vector_search(query, user_id=user_id, n_results=30, nomic_key=nomic_key)
    if not candidates:
        return []

    # Step 2: BM25 rerank
    reranked = bm25_rerank(query, candidates)[:top_k]

    # Step 3: Enrich with database metadata
    db = SessionLocal()
    try:
        enriched = []
        for hit in reranked:
            capture = db.query(PageCapture).filter(
                PageCapture.id == hit["id"],
                PageCapture.user_id == user_id
            ).first()
            if capture:
                enriched.append({
                    "id": capture.id,
                    "url": capture.url,
                    "title": capture.title,
                    "domain": capture.domain,
                    "timestamp": capture.timestamp,
                    "cluster_label": capture.cluster_label,
                    "selected_text": capture.selected_text,
                    "page_text": getattr(capture, "page_text", None),
                    "vector_score": hit["vector_score"],
                    "bm25_score": hit["bm25_score"],
                    "hybrid_score": hit["hybrid_score"],
                })
        return enriched
    finally:
        db.close()