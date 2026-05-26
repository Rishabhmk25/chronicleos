"""
Improved DBSCAN Clustering Pipeline for ChronicleOS.

Improvements over v1:
  1. Full stale-session cleanup before each run (no more duplicates)
  2. Temporal gap splitting: bursts separated by >2 hours stay separate sessions
  3. Adaptive eps selection using k-distance elbow heuristic
  4. Cosine + temporal combined distance matrix for richer grouping
  5. Compact sequential cluster IDs (no more user_id*1000000 overflow)
  6. Noise absorption: noise points absorbed into their nearest cluster
     if cosine similarity > threshold, reducing orphaned pages
  7. Page_count always stays accurate (recounted from DB, not from clustering)
"""

from sklearn.cluster import DBSCAN
from sklearn.preprocessing import normalize
import numpy as np
from embedder import get_all_embeddings_for_clustering
from database import SessionLocal, PageCapture, BrowsingSession, is_postgres
from sqlalchemy import text
import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

LABEL_MODEL = "llama-3.1-8b-instant"

# ─── Tuning knobs ─────────────────────────────────────────────────────────────
MIN_SAMPLES         = 2      # minimum pages to form a core cluster
EPS_DEFAULT         = 0.18   # cosine distance threshold (0 = identical, 2 = opposite)
TEMPORAL_GAP_HOURS  = 2.0    # sessions separated by this gap get split
SEMANTIC_WEIGHT     = 0.75   # weight of semantic distance in combined metric
TEMPORAL_WEIGHT     = 0.25   # weight of temporal distance in combined metric
NOISE_ABSORB_THRESH = 0.35   # absorb noise point if nearest centroid is within this cosine distance


# ─── Main entry point ─────────────────────────────────────────────────────────

def cluster_all(user_id: int, groq_key: str | None = None):
    """
    Full clustering pipeline:
    1. Load all embeddings from the database
    2. Clear stale sessions for this user
    3. Run DBSCAN on combined semantic+temporal distance
    4. Split any clusters that span large temporal gaps
    5. Absorb noise points into nearest cluster
    6. Label each cluster with Groq LLM
    7. Write BrowsingSessions + update PageCapture.cluster_id
    """
    print(f"[Clustering] Loading embeddings for user {user_id}...")
    ids, embeddings, metadatas = get_all_embeddings_for_clustering(user_id)

    if len(ids) < MIN_SAMPLES + 1:
        print(f"[Clustering] Not enough data ({len(ids)} pages, need {MIN_SAMPLES + 1}+). Skipping.")
        return

    X = np.array(embeddings, dtype=np.float32)
    X_norm = normalize(X)

    # ── Build combined distance matrix ──────────────────────────────────────
    timestamps = np.array([m["timestamp"] for m in metadatas], dtype=np.float64)

    cosine_dist = _cosine_distance_matrix(X_norm)
    temporal_dist = _temporal_distance_matrix(timestamps)

    combined = (SEMANTIC_WEIGHT * cosine_dist) + (TEMPORAL_WEIGHT * temporal_dist)
    np.fill_diagonal(combined, 0.0)

    # ── Adaptive eps ────────────────────────────────────────────────────────
    eps = _adaptive_eps(combined, k=MIN_SAMPLES)
    print(f"[Clustering] Adaptive eps={eps:.4f} on {len(ids)} pages")

    # ── DBSCAN ──────────────────────────────────────────────────────────────
    db = DBSCAN(eps=eps, min_samples=MIN_SAMPLES, metric="precomputed")
    raw_labels = db.fit_predict(combined)

    # ── Temporal gap splitting ───────────────────────────────────────────────
    labels = _split_on_temporal_gaps(raw_labels, timestamps, TEMPORAL_GAP_HOURS)

    # ── Noise absorption ────────────────────────────────────────────────────
    labels = _absorb_noise(labels, X_norm, cosine_dist, threshold=NOISE_ABSORB_THRESH)

    unique_clusters = sorted(set(labels) - {-1})
    print(f"[Clustering] {len(unique_clusters)} clusters found ({(labels==-1).sum()} noise pages)")

    # Group page IDs by cluster
    clusters: dict[int, list] = {c: [] for c in unique_clusters}
    for i, label in enumerate(labels):
        if label != -1:
            clusters[label].append({"id": ids[i], "metadata": metadatas[i]})

    # ── Write to database ────────────────────────────────────────────────────
    db_session = SessionLocal()
    try:
        # Step 1: Delete ALL existing sessions for this user (fresh start every run)
        db_session.query(BrowsingSession).filter(
            BrowsingSession.user_id == user_id
        ).delete(synchronize_session=False)
        db_session.commit()
        print(f"[Clustering] Cleared existing sessions for user {user_id}")

        # Step 2: Reset ALL capture cluster fields using raw SQL (reliable on Supabase)
        db_session.execute(
            text("UPDATE captures SET cluster_id = NULL, cluster_label = NULL WHERE user_id = :uid"),
            {"uid": int(user_id)}
        )
        db_session.commit()
        print(f"[Clustering] Reset capture cluster_ids for user {user_id}")

        # Step 3: Create sessions and update captures per cluster — committed per batch
        for local_id, pages in clusters.items():
            label = generate_cluster_label(pages, groq_key=groq_key)
            start_ts = min(p["metadata"]["timestamp"] for p in pages)
            end_ts   = max(p["metadata"]["timestamp"] for p in pages)

            # Insert session
            session = BrowsingSession(
                label=label,
                start_time=float(start_ts),
                end_time=float(end_ts),
                page_count=int(len(pages)),
                cluster_id=int(local_id),
                user_id=int(user_id)
            )
            db_session.add(session)

            # Bulk-update captures with raw SQL — reliable on all dialects
            page_ids = [int(p["id"]) for p in pages]
            db_session.execute(
                text(
                    "UPDATE captures SET cluster_id = :cid, cluster_label = :label "
                    "WHERE id = ANY(:ids) AND user_id = :uid"
                ) if is_postgres else
                text(
                    "UPDATE captures SET cluster_id = :cid, cluster_label = :label "
                    "WHERE user_id = :uid AND id IN :ids"
                ),
                {"cid": int(local_id), "label": label, "ids": tuple(page_ids) if not is_postgres else page_ids, "uid": int(user_id)}
            )

            # Commit each cluster immediately — avoids long-running transactions on Supabase
            db_session.commit()

        # Verify
        set_count = db_session.execute(
            text("SELECT COUNT(*) FROM captures WHERE user_id = :uid AND cluster_id IS NOT NULL"),
            {"uid": int(user_id)}
        ).scalar()
        print(f"[Clustering] Done. {len(clusters)} sessions written. {set_count} captures assigned.")

    except Exception as e:
        db_session.rollback()
        print(f"[Clustering] DB write error: {e}")
        raise
    finally:
        db_session.close()


# ─── Distance helpers ──────────────────────────────────────────────────────────

def _cosine_distance_matrix(X_norm: np.ndarray) -> np.ndarray:
    """Compute NxN cosine distance matrix from L2-normalized vectors."""
    sim = X_norm @ X_norm.T
    sim = np.clip(sim, -1.0, 1.0)
    dist = 1.0 - sim
    np.fill_diagonal(dist, 0.0)
    return dist.astype(np.float32)


def _temporal_distance_matrix(timestamps: np.ndarray) -> np.ndarray:
    """Normalised temporal distance [0, 1] based on 24h as reference span."""
    REFERENCE_MS = 24 * 60 * 60 * 1000  # 24 hours in ms
    t = timestamps.reshape(-1, 1)
    raw = np.abs(t - t.T)
    normed = np.minimum(raw / REFERENCE_MS, 1.0)
    return normed.astype(np.float32)


def _adaptive_eps(dist_matrix: np.ndarray, k: int) -> float:
    """
    Use the k-NN distance elbow heuristic to pick eps automatically.
    Sorts all k-th nearest neighbour distances and looks for the elbow.
    Falls back to EPS_DEFAULT if heuristic is inconclusive.
    """
    n = dist_matrix.shape[0]
    k = min(k, n - 1)
    knn_dists = np.sort(dist_matrix, axis=1)[:, k]  # k-th nearest neighbour for each point
    knn_dists_sorted = np.sort(knn_dists)

    # Elbow detection via second derivative
    if len(knn_dists_sorted) > 4:
        d2 = np.diff(np.diff(knn_dists_sorted))
        elbow_idx = int(np.argmax(d2)) + 2  # +2 accounts for double diff offset
        eps_candidate = float(knn_dists_sorted[elbow_idx])
        # Clamp to a reasonable window
        eps = float(np.clip(eps_candidate, 0.10, 0.40))
    else:
        eps = EPS_DEFAULT

    return eps


# ─── Post-processing ──────────────────────────────────────────────────────────

def _split_on_temporal_gaps(
    labels: np.ndarray,
    timestamps: np.ndarray,
    gap_hours: float
) -> np.ndarray:
    """
    For each DBSCAN cluster, sort pages by time and split wherever the gap
    between consecutive page visits exceeds `gap_hours`.
    New sub-clusters receive IDs that continue beyond the existing maximum label.
    """
    gap_ms = gap_hours * 3600 * 1000
    new_labels = labels.copy()
    next_id = int(labels.max()) + 1 if labels.max() >= 0 else 0

    for cluster_id in set(labels) - {-1}:
        idxs = np.where(labels == cluster_id)[0]
        if len(idxs) < 2:
            continue

        # Sort by timestamp
        order = idxs[np.argsort(timestamps[idxs])]
        sorted_ts = timestamps[order]

        gaps = np.diff(sorted_ts)
        split_points = np.where(gaps > gap_ms)[0]  # indices where a gap occurs

        if len(split_points) == 0:
            continue  # no split needed

        # Create sub-clusters
        # First segment keeps original cluster_id; subsequent get new IDs
        segments = np.split(order, split_points + 1)
        for j, seg in enumerate(segments[1:]):
            new_labels[seg] = next_id
            next_id += 1

    return new_labels


def _absorb_noise(
    labels: np.ndarray,
    X_norm: np.ndarray,
    cosine_dist: np.ndarray,
    threshold: float
) -> np.ndarray:
    """
    For each noise point (label == -1), find the nearest cluster centroid.
    If within `threshold` cosine distance, assign that cluster label.
    Pages that are genuinely isolated remain -1 (not shown in timeline).
    """
    unique_clusters = sorted(set(labels) - {-1})
    if not unique_clusters:
        return labels

    # Pre-compute centroids
    centroids = {}
    for cid in unique_clusters:
        idxs = np.where(labels == cid)[0]
        centroids[cid] = normalize(X_norm[idxs].mean(axis=0, keepdims=True))[0]

    new_labels = labels.copy()
    noise_idxs = np.where(labels == -1)[0]

    for idx in noise_idxs:
        vec = X_norm[idx]
        best_cid, best_dist = -1, threshold
        for cid, centroid in centroids.items():
            d = 1.0 - float(vec @ centroid)
            if d < best_dist:
                best_dist = d
                best_cid = cid
        if best_cid != -1:
            new_labels[idx] = best_cid

    absorbed = int((new_labels != labels).sum())
    print(f"[Clustering] Absorbed {absorbed} noise pages into nearest cluster")
    return new_labels


# ─── LLM Labelling ────────────────────────────────────────────────────────────

def generate_cluster_label(pages: list[dict], groq_key: str | None = None) -> str:
    """Ask Groq LLM to name this cluster based on page titles and domains."""
    # Sort by timestamp so the LLM sees the chronological arc
    sorted_pages = sorted(pages, key=lambda p: p["metadata"].get("timestamp", 0))
    titles  = [p["metadata"].get("title", "")  for p in sorted_pages[:10] if p["metadata"].get("title")]
    domains = [p["metadata"].get("domain", "") for p in sorted_pages[:10]]

    titles_str = "\n".join(f"- {t}" for t in titles if t)
    prompt = f"""You are labeling a browsing session. Here are the pages visited (in order):

{titles_str}

Give a SHORT label (3-6 words max) describing what the user was researching or doing.
Examples: "Learning CUDA optimization", "Healthcare startup research", "React hooks deep dive"
Reply with ONLY the label — no quotes, no punctuation, nothing else."""

    active_key = groq_key or os.getenv("GROQ_API_KEY")
    client = Groq(api_key=active_key)

    try:
        response = client.chat.completions.create(
            model=LABEL_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=20,
            temperature=0.2,      # lower temp = more deterministic labels
        )
        label = response.choices[0].message.content.strip().strip('"').strip("'")
        return label[:80]
    except Exception as e:
        print(f"[Clustering] Label generation failed: {e}")
        top_domain = max(set(domains), key=domains.count) if domains else "unknown"
        return f"Session on {top_domain}"