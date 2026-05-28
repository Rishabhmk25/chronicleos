import { useState, useEffect } from "react";
import axios from "axios";
import Timeline from "./components/Timeline";
import SearchBar from "./components/SearchBar";
import MemoryQA from "./components/MemoryQA";
import Login from "./components/Login";
import Settings from "./components/Settings";

// Setup axios base URL and automatically synchronize it to localStorage for the Chrome extension
const getBaseURL = () => {
  const url = import.meta.env.VITE_API_URL || "http://localhost:8000";
  localStorage.setItem("cos_backend_url", url);
  return url;
};
axios.defaults.baseURL = getBaseURL();

axios.interceptors.request.use((config) => {
  const token = localStorage.getItem("cos_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Attach custom BYOK headers if saved locally
  const groqKey = localStorage.getItem("cos_groq_api_key");
  const nomicKey = localStorage.getItem("cos_nomic_api_key");
  if (groqKey) {
    config.headers["X-Groq-Api-Key"] = groqKey;
  }
  if (nomicKey) {
    config.headers["X-Nomic-Api-Key"] = nomicKey;
  }

  return config;
});

const TABS = [
  { key: "timeline", icon: "◈", label: "Timeline" },
  { key: "search", icon: "⌕", label: "Search Memory" },
  { key: "memory", icon: "⬡", label: "Ask Memory" },
  { key: "settings", icon: "⚙", label: "Settings / BYOK" },
];

export default function App() {
  const [tab, setTab] = useState(
    () => localStorage.getItem("cos_tab") ?? "timeline",
  );
  const [backendStatus, setBackendStatus] = useState(null);
  const [connected, setConnected] = useState(false);
  const [token, setToken] = useState(localStorage.getItem("cos_token"));
  const [username, setUsername] = useState(
    localStorage.getItem("cos_username"),
  );

  // Handle global 401 responses
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          handleLogout();
        }
        return Promise.reject(error);
      },
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, []);

  const handleLogin = (newToken, newUsername) => {
    localStorage.setItem("cos_token", newToken);
    localStorage.setItem("cos_username", newUsername);
    setToken(newToken);
    setUsername(newUsername);
  };

  const handleLogout = () => {
    localStorage.removeItem("cos_token");
    localStorage.removeItem("cos_username");
    setToken(null);
    setUsername(null);
  };

  const navigate = (t) => {
    setTab(t);
    localStorage.setItem("cos_tab", t);
  };

  useEffect(() => {
    const check = () => {
      // Only ping if we have a token
      if (!token) return;
      axios
        .get("/status")
        .then((r) => {
          setBackendStatus(r.data);
          setConnected(true);
        })
        .catch((err) => {
          if (err.response?.status !== 401) {
            setConnected(false);
          }
        });
    };
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, [token]);

  const flushDB = async () => {
    if (
      window.confirm(
        "Are you sure you want to completely erase all memories? This cannot be undone.",
      )
    ) {
      try {
        await axios.delete("/flush");
        window.location.reload();
      } catch (e) {
        alert("Failed to flush database.");
      }
    }
  };

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">◈</div>
          <span className="sidebar-logo-text">
            Chronicle<span>OS</span>
          </span>
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
              {connected ? `Active as @${username}` : "Backend Offline"}
            </span>
          </div>
          {backendStatus && (
            <div className="sidebar-stats">
              <span>
                <strong>{backendStatus.total_captures}</strong> pages
              </span>
              <span>
                <strong>{backendStatus.sessions}</strong> sessions
              </span>
            </div>
          )}
          <button
            onClick={flushDB}
            style={{
              background: "none",
              border: "none",
              color: "var(--crimson)",
              fontSize: 12,
              marginTop: 16,
              cursor: "pointer",
              padding: 0,
              fontFamily: "var(--font-mono)",
              opacity: 0.7,
              textDecoration: "underline",
            }}
            onMouseOver={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseOut={(e) => (e.currentTarget.style.opacity = "0.7")}
          >
            Flush Database
          </button>

          <button
            onClick={handleLogout}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.5)",
              fontSize: 12,
              marginTop: 12,
              cursor: "pointer",
              padding: 0,
              fontFamily: "var(--font-mono)",
              textDecoration: "underline",
            }}
          >
            Logout
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
          {tab === "search" && <SearchBar />}
          {tab === "memory" && <MemoryQA />}
          {tab === "settings" && <Settings />}
        </main>
      </div>
    </div>
  );
}
