from fastapi import FastAPI, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from urllib.parse import urlparse
import time

from database import get_db, init_db, PageCapture, BrowsingSession

app = FastAPI(title="ChronicleOS API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Pydantic models ────────────────────────────────────────────────────────

class CaptureRequest(BaseModel):
    url: str
    title: str
    timestamp: float
    visit_start: float
    tab_id: int
    session_id: str
    selected_text: str | None = None
    page_text: str | None = None


class TextCaptureRequest(BaseModel):
    url: str
    selected_text: str
    timestamp: float


# ─── Startup ─────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    init_db()
    print("ChronicleOS backend started. DB initialized.")


# ─── Capture endpoints ────────────────────────────────────────────────────────

@app.post("/capture")
def capture_page(
    req: CaptureRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    domain = urlparse(req.url).netloc

    # Deduplication: If the same URL was visited within the last 30 minutes,
    # just update the timestamp instead of creating a new row.
    # req.timestamp is in ms, so 30 mins = 1,800,000 ms
    existing = (
        db.query(PageCapture)
        .filter(PageCapture.url == req.url)
        .order_by(PageCapture.timestamp.desc())
        .first()
    )
    if existing and (req.timestamp - existing.timestamp) < 1800000:
        existing.timestamp = req.timestamp
        db.commit()
        return {"id": existing.id, "status": "deduplicated"}

    capture = PageCapture(
        url=req.url,
        title=req.title,
        domain=domain,
        timestamp=req.timestamp,
        visit_start=req.visit_start,
        selected_text=req.selected_text,
        page_text=req.page_text,
        tab_id=req.tab_id,
        session_id=req.session_id,
        embedded=0,
    )
    db.add(capture)
    db.commit()
    db.refresh(capture)

    background_tasks.add_task(embed_capture_task, capture.id)

    return {"id": capture.id, "status": "captured"}


@app.post("/capture/text")
def capture_text(req: TextCaptureRequest, db: Session = Depends(get_db)):
    existing = (
        db.query(PageCapture)
        .filter(PageCapture.url == req.url)
        .order_by(PageCapture.timestamp.desc())
        .first()
    )
    if existing:
        existing.selected_text = req.selected_text
        db.commit()
    return {"status": "ok"}


# ─── Status endpoint ─────────────────────────────────────────────────────────

@app.delete("/flush")
def flush_database(db: Session = Depends(get_db)):
    """Clear all data from SQLite and ChromaDB."""
    db.query(PageCapture).delete()
    db.query(BrowsingSession).delete()
    db.commit()
    try:
        from embedder import collection
        all_docs = collection.get()
        if all_docs and all_docs['ids']:
            collection.delete(ids=all_docs['ids'])
    except Exception as e:
        print(f"Chroma flush error: {e}")
    return {"status": "flushed"}


@app.delete("/captures/{capture_id}")
def delete_capture(capture_id: int, db: Session = Depends(get_db)):
    """Delete a specific capture from SQLite and ChromaDB."""
    capture = db.query(PageCapture).filter(PageCapture.id == capture_id).first()
    if capture:
        db.delete(capture)
        db.commit()
    try:
        from embedder import collection
        collection.delete(ids=[str(capture_id)])
    except Exception as e:
        print(f"Chroma delete error: {e}")
    return {"status": "deleted"}

@app.get("/status")
def status(db: Session = Depends(get_db)):
    total = db.query(PageCapture).count()
    unembedded = db.query(PageCapture).filter(PageCapture.embedded == 0).count()
    sessions = db.query(BrowsingSession).count()
    return {
        "total_captures": total,
        "unembedded": unembedded,
        "sessions": sessions,
        "status": "running",
    }


# ─── Recent captures ─────────────────────────────────────────────────────────

@app.get("/captures/recent")
def recent_captures(limit: int = 50, db: Session = Depends(get_db)):
    captures = (
        db.query(PageCapture)
        .order_by(PageCapture.timestamp.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": c.id,
            "url": c.url,
            "title": c.title,
            "domain": c.domain,
            "timestamp": c.timestamp,
            "cluster_label": c.cluster_label,
        }
        for c in captures
    ]


# ─── Sessions endpoint (used by Timeline tab) ────────────────────────────────

@app.get("/sessions")
def get_sessions(db: Session = Depends(get_db)):
    """Return all browsing sessions with their pages."""
    sessions = (
        db.query(BrowsingSession)
        .order_by(BrowsingSession.start_time.desc())
        .all()
    )
    result = []
    for s in sessions:
        pages = (
            db.query(PageCapture)
            .filter(PageCapture.cluster_id == s.cluster_id)
            .order_by(PageCapture.timestamp.asc())
            .all()
        )
        result.append({
            "id": s.id,
            "label": s.label,
            "start_time": s.start_time,
            "end_time": s.end_time,
            "page_count": s.page_count,
            "cluster_id": s.cluster_id,
            "pages": [
                {
                    "id": p.id,
                    "url": p.url,
                    "title": p.title,
                    "timestamp": p.timestamp,
                    "domain": p.domain,
                }
                for p in pages
            ],
        })
    return result


# ─── Search endpoint ─────────────────────────────────────────────────────────

@app.get("/search")
def search_endpoint(q: str, limit: int = 10):
    """Hybrid BM25 + vector search."""
    try:
        from search import search as hybrid_search
        results = hybrid_search(q, top_k=limit)
        return {"results": results, "query": q}
    except Exception as e:
        return {"results": [], "query": q, "error": str(e)}


# ─── Cluster endpoint ─────────────────────────────────────────────────────────

@app.post("/cluster")
def trigger_clustering(background_tasks: BackgroundTasks):
    """Trigger DBSCAN clustering in the background."""
    background_tasks.add_task(run_clustering)
    return {"status": "clustering started"}


def run_clustering():
    try:
        from clustering import cluster_all
        cluster_all()
    except Exception as e:
        print(f"Clustering error: {e}")


# ─── RAG endpoints ───────────────────────────────────────────────────────────

@app.get("/ask")
def ask_endpoint(q: str, level: str = "high"):
    """Answer a natural language question about browsing history."""
    try:
        from rag import ask_memory
        return ask_memory(q, level=level)
    except Exception as e:
        return {"answer": f"Error: {str(e)}", "question": q, "sources": []}


@app.get("/reconstruct")
def reconstruct_endpoint(topic: str):
    """Reconstruct the chronological research trail for a topic."""
    try:
        from rag import reconstruct_workflow
        return reconstruct_workflow(topic)
    except Exception as e:
        return {"trail": [], "topic": topic, "narrative": f"Error: {str(e)}"}


@app.get("/weekly")
def weekly_endpoint():
    """Generate a weekly browsing summary."""
    try:
        from rag import weekly_summary
        return weekly_summary()
    except Exception as e:
        return {"summary": f"Error: {str(e)}"}


# ─── Background embedding task ───────────────────────────────────────────────

def embed_capture_task(capture_id: int):
    """Called in background after each capture. Embeds and stores in ChromaDB."""
    try:
        from embedder import embed_and_store
        db = next(get_db())
        capture = db.query(PageCapture).filter(PageCapture.id == capture_id).first()
        if capture:
            embed_and_store(capture)
            capture.embedded = 1
            db.commit()
    except Exception as e:
        print(f"Embedding failed for capture {capture_id}: {e}")


# ─── Run ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)