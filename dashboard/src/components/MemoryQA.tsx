import { useState, useEffect } from "react"
import axios from "axios"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

type Mode = "ask" | "reconstruct" | "weekly"

const MODE_LABELS: Record<Mode, string> = {
  ask:         "Ask a Question",
  reconstruct: "Reconstruct Trail",
  weekly:      "Weekly Summary",
}

interface Session {
  id: number
  label: string
}

export default function MemoryQA() {
  const [mode, setMode]     = useState<Mode>("ask")
  const [detailLevel, setDetailLevel] = useState<"lite" | "medium" | "high">("high")
  const [query, setQuery]   = useState("")
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])

  useEffect(() => {
    axios.get("/sessions")
      .then(r => setSessions(r.data))
      .catch(() => {})
  }, [])

  const examples = {
    ask: sessions.length > 0
      ? sessions.slice(0, 4).map(s => `Show me everything about ${s.label}`)
      : [
          "Where did I read about CUDA optimization?",
          "What battery papers did I look at?",
          "When did I research React hooks?",
          "Show me everything about neural architecture",
        ],
    reconstruct: sessions.length > 0
      ? sessions.slice(0, 4).map(s => s.label)
      : [
          "PINN neural networks",
          "startup ideas",
          "machine learning for robotics",
        ],
    weekly: [],
  }

  const submit = async (overrideQuery?: any) => {
    const q = (typeof overrideQuery === "string") ? overrideQuery : query;
    if (mode !== "weekly" && !q.trim()) return
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      let r;
      if (mode === "ask") {
        r = await axios.get(`/ask?q=${encodeURIComponent(q)}&level=${detailLevel}`)
      } else if (mode === "reconstruct") {
        r = await axios.get(`/reconstruct?topic=${encodeURIComponent(q)}`)
      } else {
        r = await axios.get("/weekly")
      }

      const data = r.data
      const errorMsg = data.answer?.startsWith("Error:") ? data.answer
                     : data.narrative?.startsWith("Error:") ? data.narrative
                     : data.summary?.startsWith("Error:") ? data.summary
                     : null

      if (errorMsg) {
        if (errorMsg.includes("Number of requested results 0") || errorMsg.includes("empty")) {
          setError("No matching memories found. Either your database is empty, or there's no captured data related to this topic yet.")
        } else {
          setError(errorMsg.replace("Error: ", ""))
        }
        setResult(null)
      } else {
        setResult(data)
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Request failed")
    } finally {
      setLoading(false)
    }
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    setResult(null)
    setError(null)
    setQuery("")
  }

  return (
    <div>
      {/* Header */}
      <div className="section-header">
        <div>
          <h2 className="section-title">Ask Memory</h2>
          <p className="section-subtitle">
            Ask anything about your browsing history — powered by RAG + Groq llama3
          </p>
        </div>
      </div>

      {/* Mode tabs */}
      <div className="mode-tabs">
        {(["ask", "reconstruct", "weekly"] as Mode[]).map(m => (
          <button
            key={m}
            className={`mode-tab ${mode === m ? "active" : ""}`}
            onClick={() => switchMode(m)}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Input */}
      {mode !== "weekly" && (
        <div className="search-bar" style={{ marginBottom: 0 }}>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            placeholder={
              mode === "ask"
                ? "Ask a question about your browsing — e.g. CUDA optimization..."
                : "Enter a topic to trace — e.g. PINN neural networks..."
            }
            className="input"
          />
          <button
            onClick={submit}
            disabled={loading || !query.trim()}
            className="btn btn-primary"
            style={{ flexShrink: 0 }}
          >
            {loading
              ? <><span className="spinner" style={{ borderTopColor: "#fff" }} /> Running...</>
              : mode === "ask" ? "Ask Memory" : "Reconstruct"
            }
          </button>
        </div>
      )}
      {mode === "ask" && (
        <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Detail Level:</span>
          <select 
            value={detailLevel} 
            onChange={(e) => setDetailLevel(e.target.value as any)}
            style={{
              background: "black",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: 13,
              outline: "none",
              cursor: "pointer",
              colorScheme: "dark"
            }}
          >
            <option value="lite" style={{ background: "black", color: "var(--text-primary)" }}>Lite (Fast & Concise)</option>
            <option value="medium" style={{ background: "black", color: "var(--text-primary)" }}>Medium (Balanced)</option>
            <option value="high" style={{ background: "black", color: "var(--text-primary)" }}>High (Detailed & Technical)</option>
          </select>
        </div>
      )}

      {/* Example chips */}
      {examples[mode].length > 0 && (
        <div className="example-chips">
          {examples[mode].map((ex, i) => (
            <button
              key={i}
              className="example-chip"
              onClick={() => { setQuery(ex); submit(ex); }}
            >
              ↗ {ex}
            </button>
          ))}
        </div>
      )}

      {/* Weekly trigger */}
      {mode === "weekly" && (
        <div style={{ marginTop: 16 }}>
          <button
            onClick={submit}
            disabled={loading}
            className="btn btn-primary"
          >
            {loading
              ? <><span className="spinner" style={{ borderTopColor: "#fff" }} /> Generating...</>
              : "⬡ Generate Weekly Summary"
            }
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="error-box" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <div style={{ marginTop: 24 }}>

          {/* Ask mode — answer */}
          {result.answer && (
            <div className="answer-box">
              <div className="answer-label">[ Memory Answer ]</div>
              <div className="answer-text markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
              </div>
            </div>
          )}

          {/* Ask mode — sources */}
          {result.sources?.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <span className="section-label">
                Sources from your memory — {result.sources.length} used
              </span>
              <div className="sources-grid">
                {result.sources.map((s: any, i: number) => (
                  <div key={s.id ?? i} className="source-card">
                    <div className="source-card-header">
                      <div className="source-index">{i + 1}</div>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="source-title"
                        title={s.title}
                      >
                        {s.title || s.url}
                      </a>
                    </div>
                    <div className="source-meta">
                      <span className="source-domain">{s.domain || new URL(s.url).hostname}</span>
                      <span className="source-score">
                        {s.hybrid_score != null
                          ? `${(s.hybrid_score * 100).toFixed(0)}%`
                          : ""}
                      </span>
                    </div>
                    {s.hybrid_score != null && (
                      <div className="score-bar">
                        <div
                          className="score-bar-fill"
                          style={{ width: `${(s.hybrid_score * 100).toFixed(0)}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Weekly mode */}
          {result.summary && (
            <div>
              <div className="answer-box">
                <div className="answer-label">[ AI Weekly Summary ]</div>
                <div className="answer-text markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.summary}</ReactMarkdown>
                </div>
              </div>

              <div className="weekly-stat-row">
                {result.total_pages && (
                  <div className="stat-card">
                    <div className="stat-value">{result.total_pages}</div>
                    <div className="stat-label">Pages This Week</div>
                  </div>
                )}
              </div>

              {result.top_topics?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <span className="section-label">Top Topics</span>
                  <ul className="topic-list">
                    {result.top_topics.map((t: any) => (
                      <li key={t.label}>
                        {t.label}
                        <span className="topic-count">{t.count} pages</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.top_domains?.length > 0 && (
                <div>
                  <span className="section-label">Top Domains</span>
                  <ul className="topic-list">
                    {result.top_domains.map((d: any) => (
                      <li key={d.domain}>
                        <span style={{ fontFamily: "'Geist Mono', monospace", color: "var(--amber)" }}>
                          {d.domain}
                        </span>
                        <span className="topic-count">{d.count} visits</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Reconstruct mode — narrative */}
          {result.narrative && (
            <div className="answer-box">
              <div className="answer-label">[ Trail Narrative ]</div>
              <div className="answer-text markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.narrative}</ReactMarkdown>
              </div>
            </div>
          )}

          {/* Reconstruct mode — trail */}
          {result.trail?.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <span className="section-label">
                Chronological Trail — {result.trail.length} pages
              </span>
              <div className="card" style={{ padding: "4px 0" }}>
                {result.trail.map((page: any, i: number) => (
                  <div key={page.id ?? i} className="trail-item" style={{ padding: "10px 18px" }}>
                    <div className="trail-index">{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <a
                        href={page.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {page.title || page.url}
                      </a>
                    </div>
                    <span className="domain-pill">{page.domain}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}