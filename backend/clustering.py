from sklearn.cluster import DBSCAN
from sklearn.preprocessing import normalize
import numpy as np
from embedder import get_all_embeddings_for_clustering
from database import SessionLocal, PageCapture, BrowsingSession
import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

LABEL_MODEL = "llama-3.1-8b-instant"

def cluster_all(user_id: int, groq_key: str | None = None):
    """
    Main clustering pipeline:
    1. Load all embeddings from the database
    2. Run DBSCAN to find clusters
    3. Label each cluster with LLM (utilising dynamic Groq keys)
    4. Update database with cluster assignments
    """
    print(f"Loading embeddings for clustering user {user_id}...")
    ids, embeddings, metadatas = get_all_embeddings_for_clustering(user_id)

    if len(ids) < 5:
        print("Not enough data to cluster (need 5+ pages)")
        return

    X = np.array(embeddings)
    X_norm = normalize(X)  # cosine distance works better normalized

    # DBSCAN params:
    db = DBSCAN(eps=0.15, min_samples=3, metric="cosine")
    labels = db.fit_predict(X_norm)

    unique_clusters = set(labels) - {-1}  # -1 = noise/unclustered
    print(f"Found {len(unique_clusters)} clusters from {len(ids)} pages")

    # Group page IDs by cluster
    clusters: dict[int, list] = {}
    for i, label in enumerate(labels):
        if label == -1:
            continue
        if label not in clusters:
            clusters[label] = []
        clusters[label].append({
            "id": ids[i],
            "metadata": metadatas[i]
        })

    # Label and save each cluster
    db_session = SessionLocal()
    try:
        for local_cluster_id, pages in clusters.items():
            global_cluster_id = user_id * 1000000 + local_cluster_id
            label = generate_cluster_label(pages, groq_key=groq_key)
            start_ts = min(p["metadata"]["timestamp"] for p in pages)
            end_ts = max(p["metadata"]["timestamp"] for p in pages)

            # Upsert into BrowsingSession table
            existing = db_session.query(BrowsingSession).filter(
                BrowsingSession.cluster_id == global_cluster_id
            ).first()

            if existing:
                existing.label = label
                existing.end_time = end_ts
            else:
                session = BrowsingSession(
                    label=label,
                    start_time=start_ts,
                    end_time=end_ts,
                    page_count=len(pages),
                    cluster_id=global_cluster_id,
                    user_id=user_id
                )
                db_session.add(session)

            # Update each PageCapture with its cluster
            for page in pages:
                capture = db_session.query(PageCapture).filter(
                    PageCapture.id == page["id"]
                ).first()
                if capture:
                    capture.cluster_id = global_cluster_id
                    capture.cluster_label = label

        db_session.commit()
        print(f"Clustering complete. {len(clusters)} sessions created.")
    finally:
        db_session.close()

def generate_cluster_label(pages: list[dict], groq_key: str | None = None) -> str:
    """Ask Groq LLM to name this cluster based on page titles. ~1s response time."""
    titles = [p["metadata"].get("title", "") for p in pages[:8]]  # use up to 8 titles
    titles_str = "\n".join(f"- {t}" for t in titles if t)

    prompt = f"""You are labeling a browsing session. Here are the pages visited:

{titles_str}

Give a SHORT label (3-6 words max) describing what the user was doing/learning.
Examples: "Learning CUDA optimization", "Healthcare startup research", "React hooks tutorial"
Reply with ONLY the label, nothing else."""

    active_key = groq_key or os.getenv("GROQ_API_KEY")
    client = Groq(api_key=active_key)

    try:
        response = client.chat.completions.create(
            model=LABEL_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=20,
            temperature=0.3,
        )
        label = response.choices[0].message.content.strip().strip('"')
        return label[:80]  # cap at 80 chars
    except Exception as e:
        print(f"Label generation failed: {e}")
        # Fallback: use most common domain
        domains = [p["metadata"].get("domain", "") for p in pages]
        return f"Session on {max(set(domains), key=domains.count)}"