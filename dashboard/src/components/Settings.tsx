import { useState, useEffect } from "react"

export default function Settings() {
  const [groqKey, setGroqKey] = useState("")
  const [nomicKey, setNomicKey] = useState("")
  const [saved, setSaved] = useState(false)
  const [showGroq, setShowGroq] = useState(false)
  const [showNomic, setShowNomic] = useState(false)

  useEffect(() => {
    setGroqKey(localStorage.getItem("cos_groq_api_key") || "")
    setNomicKey(localStorage.getItem("cos_nomic_api_key") || "")
  }, [])

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (groqKey.trim()) {
      localStorage.setItem("cos_groq_api_key", groqKey.trim())
    } else {
      localStorage.removeItem("cos_groq_api_key")
    }

    if (nomicKey.trim()) {
      localStorage.setItem("cos_nomic_api_key", nomicKey.trim())
    } else {
      localStorage.removeItem("cos_nomic_api_key")
    }

    // Backend URL is dynamically synced on app boot based on VITE_API_URL

    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      window.location.reload() // Reload to apply new Axios base URL & headers
    }, 1000)
  }

  const handleClear = () => {
    localStorage.removeItem("cos_groq_api_key")
    localStorage.removeItem("cos_nomic_api_key")
    setGroqKey("")
    setNomicKey("")
    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      window.location.reload()
    }, 1000)
  }

  return (
    <div style={{ maxWidth: 650 }}>
      {/* Header */}
      <div className="section-header">
        <div>
          <h2 className="section-title">Settings & BYOK</h2>
          <p className="section-subtitle">
            Bring Your Own Keys (BYOK) to secure stateless memory extraction and RAG queries.
          </p>
        </div>
      </div>

      <div style={{
        background: "rgba(255, 255, 255, 0.02)",
        backdropFilter: "blur(20px)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "32px",
        marginTop: 24,
      }}>
        {saved && (
          <div style={{
            background: "rgba(52, 211, 153, 0.1)",
            border: "1px solid rgba(52, 211, 153, 0.3)",
            color: "#34d399",
            padding: "12px 16px",
            borderRadius: 8,
            marginBottom: 24,
            fontSize: 14
          }}>
            ✓ Configuration saved! Re-initializing core connection...
          </div>
        )}

        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Groq Key */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 500 }}>Groq API Key</label>
              <button 
                type="button"
                onClick={() => setShowGroq(!showGroq)}
                style={{ background: "none", border: "none", color: "var(--crimson)", cursor: "pointer", fontSize: 12 }}
              >
                {showGroq ? "Hide Key" : "Show Key"}
              </button>
            </div>
            <input 
              type={showGroq ? "text" : "password"} 
              value={groqKey}
              onChange={e => setGroqKey(e.target.value)}
              placeholder="gsk_..."
              style={{
                width: "100%", padding: "12px 16px", background: "rgba(0,0,0,0.4)",
                border: "1px solid var(--border)", borderRadius: 8,
                color: "white", fontSize: 14, outline: "none", boxSizing: "border-box"
              }}
            />
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, marginTop: 6, marginHeight: 0 }}>
              Powers Llama-3 background Knowledge Graph extraction, timeline clustering labels, and RAG synthesis.
            </p>
          </div>

          {/* Nomic Key */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 500 }}>Nomic AI API Key</label>
              <button 
                type="button"
                onClick={() => setShowNomic(!showNomic)}
                style={{ background: "none", border: "none", color: "var(--crimson)", cursor: "pointer", fontSize: 12 }}
              >
                {showNomic ? "Hide Key" : "Show Key"}
              </button>
            </div>
            <input 
              type={showNomic ? "text" : "password"} 
              value={nomicKey}
              onChange={e => setNomicKey(e.target.value)}
              placeholder="nk-..."
              style={{
                width: "100%", padding: "12px 16px", background: "rgba(0,0,0,0.4)",
                border: "1px solid var(--border)", borderRadius: 8,
                color: "white", fontSize: 14, outline: "none", boxSizing: "border-box"
              }}
            />
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, marginTop: 6, marginHeight: 0 }}>
              Generates high-performance 768-dimensional text embeddings stored directly inside pgvector.
            </p>
          </div>

          {/* Backend URL is dynamically resolved and synced automatically */}

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
            <button 
              type="submit"
              className="btn btn-primary"
              style={{ width: "auto", minWidth: 140 }}
            >
              Save Configuration
            </button>
            
            <button 
              type="button"
              onClick={handleClear}
              className="btn btn-secondary"
              style={{ width: "auto", minWidth: 140 }}
            >
              Reset to Defaults
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
