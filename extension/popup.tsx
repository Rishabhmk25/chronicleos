import { useState, useEffect } from "react"

export default function Popup() {
  const [status, setStatus] = useState<"connected" | "disconnected">("disconnected")
  const [count, setCount] = useState(0)
  const [token, setToken] = useState<string | null>(null)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  const [backendUrl, setBackendUrl] = useState("https://chronicalos.onrender.com")

  useEffect(() => {
    chrome.storage.local.get(["cos_token", "cos_backend_url"], (res) => {
      if (res.cos_token) setToken(res.cos_token)
      if (res.cos_backend_url) setBackendUrl(res.cos_backend_url)
    })
  }, [])

  // Auto-sync token from active dashboard tab if unauthenticated
  useEffect(() => {
    if (token) return

    chrome.tabs.query({}, async (tabs) => {
      for (const tab of tabs) {
        if (!tab.id || !tab.url) continue
        const isDashboard = tab.url.includes("localhost:5173") || 
                            tab.url.includes("localhost:5174") || 
                            tab.url.includes("vercel.app")
        if (isDashboard) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                return {
                  token: localStorage.getItem("cos_token"),
                  username: localStorage.getItem("cos_username"),
                  groqKey: localStorage.getItem("cos_groq_api_key"),
                  nomicKey: localStorage.getItem("cos_nomic_api_key"),
                  backendUrl: localStorage.getItem("cos_backend_url"),
                }
              }
            })
            if (results && results[0] && results[0].result) {
              const { token: dashToken, groqKey, nomicKey, backendUrl: dashBackendUrl } = results[0].result
              const updates: Record<string, string> = {}
              if (dashToken) updates.cos_token = dashToken
              if (groqKey) updates.cos_groq_api_key = groqKey
              if (nomicKey) updates.cos_nomic_api_key = nomicKey
              if (dashBackendUrl) updates.cos_backend_url = dashBackendUrl
              
              if (Object.keys(updates).length > 0) {
                await chrome.storage.local.set(updates)
                if (dashToken) setToken(dashToken)
                if (dashBackendUrl) setBackendUrl(dashBackendUrl)
                break
              }
            }
          } catch (e) {
            console.log("Auto-sync script failed:", e)
          }
        }
      }
    })
  }, [token])

  useEffect(() => {
    if (!token) return
    fetch(`${backendUrl}/status`, {
      headers: { "Authorization": `Bearer ${token}` }
    })
      .then(r => {
        if (r.status === 401) {
          chrome.storage.local.remove("cos_token")
          setToken(null)
          throw new Error("Unauthorized")
        }
        return r.json()
      })
      .then(data => {
        setStatus("connected")
        setCount(data.total_captures)
      })
      .catch(() => setStatus("disconnected"))
  }, [token, backendUrl])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const formData = new URLSearchParams()
    formData.append("username", username)
    formData.append("password", password)
    
    try {
      const res = await fetch(`${backendUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData
      })
      if (!res.ok) throw new Error("Login failed")
      const data = await res.json()
      chrome.storage.local.set({ cos_token: data.access_token })
      setToken(data.access_token)
    } catch (err) {
      setError("Invalid credentials or backend offline")
    }
  }

  return (
    <div style={{ 
      width: 300, 
      padding: 20, 
      fontFamily: "'Space Grotesk', system-ui, sans-serif",
      backgroundColor: "#06060a",
      color: "#ffffff",
      margin: 0,
      border: "1px solid rgba(255,255,255,0.07)"
    }}>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700&family=Space+Grotesk:wght@500&family=Geist+Mono:wght@500;700&display=swap');
          body { margin: 0; background: #06060a; overflow: hidden; }
          .status-dot {
            width: 6px; height: 6px; border-radius: 50%;
            display: inline-block; margin-right: 8px;
            animation: pulse 2s infinite;
          }
          .online { background: #34d399; box-shadow: 0 0 6px rgba(52,211,153,0.5); }
          .offline { background: #e11d48; box-shadow: 0 0 6px rgba(225,29,72,0.5); }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
          
          .btn {
            display: flex; align-items: center; justify-content: center;
            width: 100%; padding: 12px; margin-top: 16px;
            background: rgba(225, 29, 72, 0.1); border: 1px solid rgba(225, 29, 72, 0.35);
            color: #e11d48; border-radius: 6px; text-decoration: none;
            font-size: 13px; font-weight: 500; transition: all 0.2s;
            box-sizing: border-box;
          }
          .btn:hover {
            background: #e11d48; color: #fff; box-shadow: 0 0 16px rgba(225,29,72,0.3);
          }
        `}
      </style>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <div style={{ 
          width: 32, height: 32, borderRadius: 6, background: "#e11d48",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16, boxShadow: "0 0 12px rgba(225, 29, 72, 0.25)"
        }}>◈</div>
        <h2 style={{ margin: 0, fontSize: 18, fontFamily: "'Syne', sans-serif", letterSpacing: "-0.02em" }}>
          Chronicle<span style={{ color: "#e11d48" }}>OS</span>
        </h2>
      </div>

      {!token ? (
        <div>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", marginBottom: 16 }}>
            Login to link your browsing history to your core.
          </p>
          {error && <div style={{ color: "#e11d48", fontSize: 12, marginBottom: 10 }}>{error}</div>}
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input 
              type="text" value={username} onChange={e => setUsername(e.target.value)} 
              placeholder="Username" 
              style={{ padding: 8, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", color: "white", borderRadius: 4 }} 
            />
            <input 
              type="password" value={password} onChange={e => setPassword(e.target.value)} 
              placeholder="Password" 
              style={{ padding: 8, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", color: "white", borderRadius: 4 }} 
            />
            <button type="submit" className="btn" style={{ marginTop: 5 }}>Authenticate</button>
          </form>
        </div>
      ) : (
        <>
          <div style={{ 
            padding: "16px", borderRadius: 8, 
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)"
          }}>
        <div style={{ fontSize: 11, color: "rgba(150,180,200,0.5)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'Geist Mono', monospace" }}>
          Engine Status
        </div>
        <div style={{ fontSize: 14, display: "flex", alignItems: "center", fontWeight: 500 }}>
          <span className={`status-dot ${status === "connected" ? "online" : "offline"}`}></span>
          {status === "connected" ? "Backend Active" : "Backend Offline"}
        </div>

        {status === "connected" && (
           <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
             <span style={{ fontSize: 13, color: "rgba(150,180,200,0.5)" }}>Memory Size</span>
             <span style={{ fontFamily: "'Geist Mono', monospace", color: "#22d3ee", fontWeight: 700, fontSize: 15 }}>
               {count} pages
             </span>
           </div>
        )}
      </div>

          <a href="https://chronicalos.vercel.app/" target="_blank" rel="noreferrer" className="btn">
            Open Dashboard ↗
          </a>
          <button 
            onClick={() => { chrome.storage.local.remove("cos_token"); setToken(null); }}
            style={{
              background: "none", border: "none", color: "rgba(255,255,255,0.5)", 
              fontSize: 11, marginTop: 12, cursor: "pointer", width: "100%", textDecoration: "underline"
            }}
          >
            Logout Ext
          </button>
        </>
      )}
    </div>
  )
}