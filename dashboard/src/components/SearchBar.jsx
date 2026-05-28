import { useState, useEffect } from "react";
import axios from "axios";
import { format } from "date-fns";

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(null);
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    axios
      .get("/sessions")
      .then((r) => setSessions(r.data))
      .catch(() => {});
  }, []);

  const exampleQueries =
    sessions.length > 0
      ? sessions.slice(0, 4).map((s) => s.label)
      : [
          "CUDA memory optimization",
          "battery machine learning",
          "React hooks tutorial",
          "neural architecture design",
        ];

  const search = async (q) => {
    const searchQuery = typeof q === "string" ? q : query;
    if (!searchQuery.trim()) return;
    if (typeof q === "string") setQuery(q);
    setLoading(true);
    setSearched(true);
    setError(null);
    setElapsed(null);
    const t0 = performance.now();
    try {
      const r = await axios.get(`/search?q=${encodeURIComponent(searchQuery)}`);
      setResults(r.data.results || []);
      setElapsed(Math.round(performance.now() - t0));
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const deleteCapture = async (id) => {
    try {
      await axios.delete(`/captures/${id}`);
      setResults(results.filter((r) => r.id !== id));
    } catch (e) {
      alert("Failed to delete memory");
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="section-header">
        <div>
          <h2 className="section-title">Search Memory</h2>
          <p className="section-subtitle">
            Hybrid semantic + keyword search across everything you've ever read
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <span className="cluster-label">BM25 + Vector</span>
          <span className="cluster-label">ChromaDB</span>
        </div>
      </div>

      {/* Search bar */}
      <div className="search-bar">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Ask your memory — e.g. CUDA optimization, React hooks..."
          className="input"
        />

        <button
          onClick={() => search()}
          disabled={loading || !query.trim()}
          className="btn btn-primary"
          style={{ flexShrink: 0 }}
        >
          {loading ? (
            <>
              <span className="spinner" style={{ borderTopColor: "#fff" }} />{" "}
              Searching...
            </>
          ) : (
            "⌕ Search"
          )}
        </button>
      </div>

      {/* Example chips */}
      <div className="example-chips" style={{ marginBottom: 24 }}>
        {exampleQueries.map((q) => (
          <button key={q} className="example-chip" onClick={() => search(q)}>
            ↗ {q}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="error-box" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="loading-row">
          <span className="spinner" /> Searching your memory...
        </div>
      )}

      {/* No results */}
      {searched && !loading && results.length === 0 && !error && (
        <div className="empty-state">
          <div className="empty-state-icon">⌕</div>
          <div className="empty-state-title">No results found</div>
          <div className="empty-state-desc">
            Try a different query, or make sure the backend has indexed your
            captures.
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <>
          <p
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              marginBottom: 14,
            }}
          >
            <span
              style={{
                color: "var(--ice)",
                fontFamily: "'Geist Mono', monospace",
              }}
            >
              {results.length} result{results.length !== 1 ? "s" : ""}
            </span>{" "}
            for <span style={{ color: "var(--crimson)" }}>"{query}"</span>
            {elapsed != null && (
              <span
                style={{
                  marginLeft: 10,
                  background: "var(--amber-muted)",
                  color: "var(--amber)",
                  border: "1px solid rgba(251,146,60,0.2)",
                  borderRadius: 20,
                  padding: "1px 8px",
                  fontSize: 11,
                  fontFamily: "'Geist Mono', monospace",
                }}
              >
                {elapsed}ms
              </span>
            )}
          </p>

          <div className="search-results">
            {results.map((result) => (
              <div key={result.id} className="result-card">
                {/* Title row */}
                <div className="result-title">
                  <a href={result.url} target="_blank" rel="noreferrer">
                    {result.title || result.url}
                  </a>
                </div>

                {/* Meta row */}
                <div className="result-meta">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span className="domain-pill">{result.domain}</span>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteCapture(result.id);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--crimson)",
                        cursor: "pointer",
                        opacity: 0.6,
                        fontSize: 14,
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.opacity = "1")}
                      onMouseOut={(e) =>
                        (e.currentTarget.style.opacity = "0.6")
                      }
                      title="Delete Memory"
                    >
                      ✕
                    </button>
                  </div>
                  {result.cluster_label && (
                    <span className="cluster-label">
                      {result.cluster_label}
                    </span>
                  )}
                  <span className="score-badge">
                    {(result.hybrid_score * 100).toFixed(0)}% match
                  </span>
                  {result.timestamp && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--text-ghost)",
                        fontFamily: "'Geist Mono', monospace",
                      }}
                    >
                      {format(
                        new Date(result.timestamp),
                        "MMM d, yyyy · h:mm a",
                      )}
                    </span>
                  )}
                </div>

                {/* URL */}
                <div className="result-url">{result.url}</div>

                {/* Score bar */}
                <div className="score-bar" style={{ marginTop: 10 }}>
                  <div
                    className="score-bar-fill"
                    style={{
                      width: `${(result.hybrid_score * 100).toFixed(0)}%`,
                    }}
                  />
                </div>

                {/* Highlight */}
                {result.selected_text && (
                  <div className="result-highlight">
                    {result.selected_text.substring(0, 300)}
                    {result.selected_text.length > 300 ? "…" : ""}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
