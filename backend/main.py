from fastapi import FastAPI, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from urllib.parse import urlparse
import time
from datetime import timedelta

import auth
from database import get_db, init_db, PageCapture, BrowsingSession, User
from fastapi.security import OAuth2PasswordRequestForm
from passlib.context import CryptContext

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

class UserCreate(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str


# ─── Startup ─────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    init_db()
    print("ChronicleOS backend started. DB initialized.")


# ─── Auth endpoints ────────────────────────────────────────────────────────────

@app.post("/register", response_model=Token)
def register(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_password = auth.get_password_hash(user.password)
    new_user = User(username=user.username, password_hash=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Data Migration: If this is the first user, assign all orphan captures to them
    user_count = db.query(User).count()
    if user_count == 1:
        db.query(PageCapture).filter(PageCapture.user_id == None).update({"user_id": new_user.id})
        db.query(BrowsingSession).filter(BrowsingSession.user_id == None).update({"user_id": new_user.id})
        db.commit()

    access_token = auth.create_access_token(
        data={"sub": new_user.username},
        expires_delta=timedelta(days=30)
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    from fastapi import HTTPException
    if not user or not auth.verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    
    access_token = auth.create_access_token(
        data={"sub": user.username},
        expires_delta=timedelta(days=30)
    )
    return {"access_token": access_token, "token_type": "bearer"}


# ─── Capture endpoints ────────────────────────────────────────────────────────

@app.post("/capture")
def capture_page(
    req: CaptureRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_user)
):
    domain = urlparse(req.url).netloc

    existing = (
        db.query(PageCapture)
        .filter(PageCapture.url == req.url, PageCapture.user_id == current_user.id)
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
        user_id=current_user.id,
    )
    db.add(capture)
    db.commit()
    db.refresh(capture)

    background_tasks.add_task(embed_capture_task, capture.id)

    return {"id": capture.id, "status": "captured"}


@app.post("/capture/text")
def capture_text(req: TextCaptureRequest, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    existing = (
        db.query(PageCapture)
        .filter(PageCapture.url == req.url, PageCapture.user_id == current_user.id)
        .order_by(PageCapture.timestamp.desc())
        .first()
    )
    if existing:
        existing.selected_text = req.selected_text
        db.commit()
    return {"status": "ok"}


# ─── Status endpoint ─────────────────────────────────────────────────────────

@app.delete("/flush")
def flush_database(db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """Clear all data from SQLite and ChromaDB for the current user."""
    db.query(PageCapture).filter(PageCapture.user_id == current_user.id).delete()
    db.query(BrowsingSession).filter(BrowsingSession.user_id == current_user.id).delete()
    db.commit()
    try:
        from embedder import collection
        all_docs = collection.get(where={"user_id": current_user.id})
        if all_docs and all_docs['ids']:
            collection.delete(ids=all_docs['ids'])
    except Exception as e:
        print(f"Chroma flush error: {e}")
    return {"status": "flushed"}


@app.delete("/captures/{capture_id}")
def delete_capture(capture_id: int, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """Delete a specific capture from SQLite and ChromaDB."""
    capture = db.query(PageCapture).filter(PageCapture.id == capture_id, PageCapture.user_id == current_user.id).first()
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
def status(db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    total = db.query(PageCapture).filter(PageCapture.user_id == current_user.id).count()
    unembedded = db.query(PageCapture).filter(PageCapture.user_id == current_user.id, PageCapture.embedded == 0).count()
    sessions = db.query(BrowsingSession).filter(BrowsingSession.user_id == current_user.id).count()
    return {
        "total_captures": total,
        "unembedded": unembedded,
        "sessions": sessions,
        "status": "running",
        "username": current_user.username
    }


# ─── Recent captures ─────────────────────────────────────────────────────────

@app.get("/captures/recent")
def recent_captures(limit: int = 50, db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    captures = (
        db.query(PageCapture)
        .filter(PageCapture.user_id == current_user.id)
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
def get_sessions(db: Session = Depends(get_db), current_user: User = Depends(auth.get_current_user)):
    """Return all browsing sessions with their pages."""
    sessions = (
        db.query(BrowsingSession)
        .filter(BrowsingSession.user_id == current_user.id)
        .order_by(BrowsingSession.start_time.desc())
        .all()
    )
    result = []
    for s in sessions:
        pages = (
            db.query(PageCapture)
            .filter(PageCapture.cluster_id == s.cluster_id, PageCapture.user_id == current_user.id)
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
def search_endpoint(q: str, limit: int = 10, current_user: User = Depends(auth.get_current_user)):
    """Hybrid BM25 + vector search."""
    try:
        from search import search as hybrid_search
        results = hybrid_search(q, user_id=current_user.id, top_k=limit)
        return {"results": results, "query": q}
    except Exception as e:
        return {"results": [], "query": q, "error": str(e)}


# ─── Cluster endpoint ─────────────────────────────────────────────────────────

@app.post("/cluster")
def trigger_clustering(background_tasks: BackgroundTasks, current_user: User = Depends(auth.get_current_user)):
    """Trigger DBSCAN clustering in the background."""
    background_tasks.add_task(run_clustering, current_user.id)
    return {"status": "clustering started"}


def run_clustering(user_id: int):
    try:
        from clustering import cluster_all
        cluster_all(user_id)
    except Exception as e:
        print(f"Clustering error: {e}")


# ─── RAG endpoints ───────────────────────────────────────────────────────────

@app.get("/ask")
def ask_endpoint(q: str, level: str = "high", current_user: User = Depends(auth.get_current_user)):
    """Answer a natural language question about browsing history."""
    try:
        from rag import ask_memory
        return ask_memory(q, user_id=current_user.id, level=level)
    except Exception as e:
        return {"answer": f"Error: {str(e)}", "question": q, "sources": []}


@app.get("/reconstruct")
def reconstruct_endpoint(topic: str, current_user: User = Depends(auth.get_current_user)):
    """Reconstruct the chronological research trail for a topic."""
    try:
        from rag import reconstruct_workflow
        return reconstruct_workflow(topic, user_id=current_user.id)
    except Exception as e:
        return {"trail": [], "topic": topic, "narrative": f"Error: {str(e)}"}


@app.get("/weekly")
def weekly_endpoint(current_user: User = Depends(auth.get_current_user)):
    """Generate a weekly browsing summary."""
    try:
        from rag import weekly_summary
        return weekly_summary(user_id=current_user.id)
    except Exception as e:
        return {"summary": f"Error: {str(e)}"}


# ─── Background embedding task ───────────────────────────────────────────────

def embed_capture_task(capture_id: int):
    """Called in background after each capture. Embeds and stores in ChromaDB."""
    try:
        from embedder import embed_and_store
        from graph import extract_entities_and_relationships
        db = next(get_db())
        capture = db.query(PageCapture).filter(PageCapture.id == capture_id).first()
        if capture:
            embed_and_store(capture)
            
            # Extract Graph RAG entities in background
            if capture.page_text:
                extract_entities_and_relationships(capture.page_text, capture.url)
                
            capture.embedded = 1
            db.commit()
    except Exception as e:
        print(f"Embedding failed for capture {capture_id}: {e}")


# ─── Run ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)