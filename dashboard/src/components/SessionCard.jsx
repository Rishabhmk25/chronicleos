import { useState } from "react";
import { format } from "date-fns";
import axios from "axios";

function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

function sessionEmoji(label) {
  const l = label.toLowerCase();
  if (
    l.includes("code") ||
    l.includes("program") ||
    l.includes("react") ||
    l.includes("python")
  )
    return "◻";
  if (l.includes("research") || l.includes("paper") || l.includes("study"))
    return "◈";
  if (l.includes("video") || l.includes("youtube") || l.includes("watch"))
    return "▷";
  if (l.includes("news") || l.includes("article")) return "◉";
  if (l.includes("design") || l.includes("ui") || l.includes("css")) return "◆";
  if (
    l.includes("ai") ||
    l.includes("ml") ||
    l.includes("neural") ||
    l.includes("llm")
  )
    return "⬡";
  if (l.includes("shop") || l.includes("buy") || l.includes("amazon"))
    return "◎";
  if (l.includes("health") || l.includes("medical") || l.includes("drug"))
    return "◇";
  return "◈";
}

export default function SessionCard({ session }) {
  const [expanded, setExpanded] = useState(false);
  const [pages, setPages] = useState(session.pages || []);

  const deleteCapture = async (id) => {
    try {
      await axios.delete(`/captures/${id}`);
      setPages(pages.filter((p) => p.id !== id));
    } catch (e) {
      alert("Failed to delete memory");
    }
  };

  const startDate = session.start_time
    ? format(new Date(session.start_time), "MMM d, yyyy")
    : "Unknown";
  const pageCount = pages.length || session.page_count || 0;

  return (
    <div className={`session-card ${expanded ? "expanded" : ""}`}>
      <div className="session-header" onClick={() => setExpanded((e) => !e)}>
        <div className="session-icon">{sessionEmoji(session.label || "")}</div>
        <div className="session-info">
          <div className="session-label">
            {session.label || "Unnamed Session"}
          </div>
          <div className="session-meta">
            <span>{startDate}</span>
            <span className="session-meta-dot" />
            <span style={{ color: "var(--ice)" }}>{pageCount}</span>
            <span>page{pageCount !== 1 ? "s" : ""}</span>
          </div>
        </div>
        <span className="session-chevron">▼</span>
      </div>

      {expanded && pages && pages.length > 0 && (
        <div className="session-pages">
          {pages.map((page, i) => (
            <div key={i} className="page-item">
              <img
                className="page-favicon"
                src={faviconUrl(page.domain)}
                alt=""
                onError={(e) => {
                  e.target.style.display = "none";
                }}
              />

              <div className="page-title">
                <a
                  href={page.url}
                  target="_blank"
                  rel="noreferrer"
                  title={page.url}
                >
                  {page.title || page.url}
                </a>
              </div>
              <span className="page-time">
                {page.timestamp
                  ? format(new Date(page.timestamp), "h:mm a")
                  : ""}
              </span>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  deleteCapture(page.id);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--crimson)",
                  cursor: "pointer",
                  opacity: 0.6,
                  fontSize: 14,
                  marginLeft: 12,
                }}
                onMouseOver={(e) => (e.currentTarget.style.opacity = "1")}
                onMouseOut={(e) => (e.currentTarget.style.opacity = "0.6")}
                title="Delete Memory"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {expanded && (!pages || pages.length === 0) && (
        <div className="session-pages">
          <div
            className="page-item"
            style={{ color: "var(--text-ghost)", justifyContent: "center" }}
          >
            No pages loaded for this session
          </div>
        </div>
      )}
    </div>
  );
}
