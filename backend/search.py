from rank_bm25 import BM25Okapi
from embedder import collection, get_query_embedding
from database import PageCapture, SessionLocal

def tokenize(text: str) -> list[str]:
    return text.lower().split()

def vector_search(query: str, n_results: int = 20) -> list[dict]:
    """Pure semantic search using ChromaDB."""
    query_embedding = get_query_embedding(query)  # task_type=search_query for better results
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(n_results, collection.count()),
        include=["documents", "metadatas", "distances"]
    )
    if not results["ids"][0]:
        return []

    hits = []
    for i, doc_id in enumerate(results["ids"][0]):
        hits.append({
            "id": int(doc_id),
            "document": results["documents"][0][i],
            "metadata": results["metadatas"][0][i],
            "vector_score": 1 - results["distances"][0][i],  # cosine → similarity
        })
    return hits

def bm25_rerank(query: str, candidates: list[dict]) -> list[dict]:
    """Rerank vector search results using BM25 keyword matching."""
    if not candidates:
        return []

    corpus = [tokenize(c["document"]) for c in candidates]
    bm25 = BM25Okapi(corpus)
    scores = bm25.get_scores(tokenize(query))

    # Normalize BM25 scores to 0-1
    max_score = max(scores) if max(scores) > 0 else 1
    bm25_norm = scores / max_score

    # Hybrid score: 60% vector similarity + 40% BM25
    for i, candidate in enumerate(candidates):
        candidate["bm25_score"] = float(bm25_norm[i])
        candidate["hybrid_score"] = (
            0.6 * candidate["vector_score"] + 0.4 * candidate["bm25_score"]
        )

    return sorted(candidates, key=lambda x: x["hybrid_score"], reverse=True)

def search(query: str, top_k: int = 10) -> list[dict]:
    """
    Full hybrid search pipeline:
    1. Vector search for semantic similarity (top 20)
    2. BM25 reranking for keyword precision
    3. Return top_k results with full metadata from SQLite
    """
    # Step 1: vector search
    candidates = vector_search(query, n_results=20)
    if not candidates:
        return []

    # Step 2: BM25 rerank
    reranked = bm25_rerank(query, candidates)[:top_k]

    # Step 3: enrich with SQLite metadata
    db = SessionLocal()
    try:
        enriched = []
        for hit in reranked:
            capture = db.query(PageCapture).filter(
                PageCapture.id == hit["id"]
            ).first()
            if capture:
                enriched.append({
                    "id": capture.id,
                    "url": capture.url,
                    "title": capture.title,
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