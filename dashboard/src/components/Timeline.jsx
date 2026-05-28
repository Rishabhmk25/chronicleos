import { useEffect, useState } from "react";
import axios from "axios";
import SessionCard from "./SessionCard";

export default function Timeline() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clustering, setClustering] = useState(false);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    axios
      .get("/sessions")
      .then((r) => setSessions(r.data))
      .catch((e) => setError(e?.message || "Failed to load sessions"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const triggerClustering = async () => {
    setClustering(true);
    try {
      await axios.post("/cluster");
      await new Promise((r) => setTimeout(r, 8000));
      load();
    } catch (e) {
      setError(e?.message || "Clustering failed");
    } finally {
      setClustering(false);
    }
  };

  const totalPages = sessions.reduce(
    (acc, s) => acc + (s.pages?.length || 0),
    0,
  );

  return (
    <div>
      <div className="section-header">
        <div>
          <h2 className="section-title">Timeline</h2>
          <p className="section-subtitle">
            {sessions.length > 0
              ? `${sessions.length} sessions · ${totalPages} pages captured`
              : "Cluster your browsing into knowledge sessions"}
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={triggerClustering}
          disabled={clustering || loading}
          style={{ flexShrink: 0 }}
        >
          {clustering ? (
            <>
              <span className="spinner" style={{ borderTopColor: "#fff" }} />{" "}
              Clustering...
            </>
          ) : (
            "◈ Cluster Sessions"
          )}
        </button>
      </div>

      {error && (
        <div className="error-box" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="loading-row">
          <span className="spinner" /> Loading sessions...
        </div>
      ) : sessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">◈</div>
          <div className="empty-state-title">No sessions yet</div>
          <div className="empty-state-desc">
            Make sure the backend is running and you've visited some pages.
            <br />
            Then click{" "}
            <strong style={{ color: "var(--crimson)" }}>
              Cluster Sessions
            </strong>{" "}
            to group them into topics.
          </div>
        </div>
      ) : (
        <div className="session-grid">
          {sessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}
