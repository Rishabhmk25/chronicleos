"""
Hybrid Search Engine for ChronicleOS.
Uses EXACT brute-force cosine similarity (not HNSW approximate search)
to guarantee 100% deterministic results for small collections.
"""

import re
import numpy as np
from rank_bm25 import BM25Okapi
from functools import lru_cache
from embedder import collection, get_query_embedding
from database import PageCapture, SessionLocal

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


def exact_vector_search(query: str, user_id: int, n_results: int = 30) -> list[dict]:
    """
    Brute-force exact cosine similarity search.
    Loads ALL embeddings from ChromaDB and computes exact similarity.
    For collections < 5000 docs, this is instant and 100% deterministic.
    """
    # Get query embedding (cached via lru_cache)
    query_emb = np.array(get_query_embedding(query))

    # Load ALL documents and embeddings for the specific user from ChromaDB
    all_data = collection.get(where={"user_id": user_id}, include=["embeddings", "documents", "metadatas"])

    if not all_data["ids"]:
        return []

    hits = []
    for i, doc_id in enumerate(all_data["ids"]):
        doc_emb = np.array(all_data["embeddings"][i])
        score = cosine_similarity(query_emb, doc_emb)
        hits.append({
            "id": int(doc_id),
            "document": all_data["documents"][i],
            "metadata": all_data["metadatas"][i],
            "vector_score": score,
        })

    # Sort by exact cosine similarity (descending) and return top N
    hits.sort(key=lambda x: x["vector_score"], reverse=True)
    return hits[:n_results]


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


def search(query: str, user_id: int, top_k: int = 10) -> list[dict]:
    """
    Deterministic hybrid search pipeline:
    1. Exact brute-force cosine similarity (no HNSW approximation)
    2. BM25 reranking for keyword precision
    3. Enrich with SQLite metadata
    """
    # Step 1: Exact vector search (deterministic)
    candidates = exact_vector_search(query, user_id=user_id, n_results=30)
    if not candidates:
        return []

    # Step 2: BM25 rerank
    reranked = bm25_rerank(query, candidates)[:top_k]

    # Step 3: Enrich with SQLite metadata
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