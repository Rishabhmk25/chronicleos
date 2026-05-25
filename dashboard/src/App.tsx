import { useState, useEffect } from "react"
import axios from "axios"
import Timeline from "./components/Timeline"
import SearchBar from "./components/SearchBar"
import MemoryQA from "./components/MemoryQA"

type Tab = "timeline" | "search" | "memory"

interface BackendStatus {
  total_captures: number
  sessions: number
  status: string
}

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: "timeline", icon: "◈", label: "Timeline" },
  { key: "search",   icon: "⌕", label: "Search Memory" },
  { key: "memory",   icon: "⬡", label: "Ask Memory" },
]

export default function App() {
  const [tab, setTab] = useState<Tab>(
    () => (localStorage.getItem("cos_tab") as Tab) ?? "timeline"
  )
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null)
  const [connected, setConnected] = useState(false)

  const navigate = (t: Tab) => {
    setTab(t)
    localStorage.setItem("cos_tab", t)
  }

  useEffect(() => {
    const check = () => {
      fetch("http://localhost:8000/status")
        .then(r => r.json())
        .then(d => { setBackendStatus(d); setConnected(true) })
        .catch(() => setConnected(false))
    }
    check()
    const interval = setInterval(check, 10000)
    return () => clearInterval(interval)
  }, [])

  const flushDB = async () => {
    if (window.confirm("Are you sure you want to completely erase all memories? This cannot be undone.")) {
      try {
        await axios.delete("http://localhost:8000/flush")
        window.location.reload()
      } catch (e) {
        alert("Failed to flush database.")
      }
    }
  }

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">◈</div>
          <span className="sidebar-logo-text">Chronicle<span>OS</span></span>
        </div>
        <p className="sidebar-tagline">Memory OS</p>

        <nav className="sidebar-nav">
          {TABS.map(({ key, icon, label }) => (
            <button
              key={key}
              className={`nav-item ${tab === key ? "active" : ""}`}
              onClick={() => navigate(key)}
            >
              <span className="nav-item-icon">{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-status">
            <div className={`status-dot ${connected ? "online" : "offline"}`} />
            <span className="status-label">
              {connected ? "Backend Active" : "Backend Offline"}
            </span>
          </div>
          {backendStatus && (
            <div className="sidebar-stats">
              <span><strong>{backendStatus.total_captures}</strong> pages</span>
              <span><strong>{backendStatus.sessions}</strong> sessions</span>
            </div>
          )}
          <button 
            onClick={flushDB}
            style={{
              background: "none", border: "none", color: "var(--crimson)", 
              fontSize: 12, marginTop: 16, cursor: "pointer", padding: 0,
              fontFamily: "var(--font-mono)", opacity: 0.7, textDecoration: "underline"
            }}
            onMouseOver={e => e.currentTarget.style.opacity = "1"}
            onMouseOut={e => e.currentTarget.style.opacity = "0.7"}
          >
            Flush Database
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="main-area">
        <main className="main-content">
          {!connected && (
            <div className="error-box" style={{ marginBottom: 24 }}>
              ⚠ Backend offline — run <code>cd backend && python main.py</code>
            </div>
          )}
          {tab === "timeline" && <Timeline />}
          {tab === "search"   && <SearchBar />}
          {tab === "memory"   && <MemoryQA />}
        </main>
      </div>
    </div>
  )
}