import { useState } from "react"
import axios from "axios"

interface LoginProps {
  onLogin: (token: string, username: string) => void
}

export default function Login({ onLogin }: LoginProps) {
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return

    setLoading(true)
    setError(null)

    try {
      if (isRegister) {
        const res = await axios.post("http://localhost:8000/register", {
          username,
          password
        })
        onLogin(res.data.access_token, username)
      } else {
        const formData = new URLSearchParams()
        formData.append("username", username)
        formData.append("password", password)
        const res = await axios.post("http://localhost:8000/login", formData, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" }
        })
        onLogin(res.data.access_token, username)
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Authentication failed. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      background: "#06060a",
      fontFamily: "'Space Grotesk', system-ui, sans-serif",
      backgroundImage: "radial-gradient(circle at 50% 0%, rgba(225, 29, 72, 0.15), transparent 50%)"
    }}>
      <div style={{
        width: "100%",
        maxWidth: 400,
        padding: "40px",
        background: "rgba(255, 255, 255, 0.02)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255, 255, 255, 0.05)",
        borderRadius: 16,
        boxShadow: "0 20px 40px rgba(0,0,0,0.4)"
      }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, background: "#e11d48",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 24, boxShadow: "0 0 20px rgba(225, 29, 72, 0.3)",
            color: "white", marginBottom: 16
          }}>◈</div>
          <h1 style={{ 
            margin: 0, fontSize: 28, fontFamily: "'Syne', sans-serif", 
            letterSpacing: "-0.02em", color: "white" 
          }}>
            Chronicle<span style={{ color: "#e11d48" }}>OS</span>
          </h1>
          <p style={{ color: "rgba(255,255,255,0.5)", marginTop: 8, fontSize: 14 }}>
            {isRegister ? "Create your semantic memory core." : "Access your semantic memory core."}
          </p>
        </div>

        {error && (
          <div style={{
            background: "rgba(225, 29, 72, 0.1)",
            border: "1px solid rgba(225, 29, 72, 0.3)",
            color: "#e11d48",
            padding: "12px 16px",
            borderRadius: 8,
            marginBottom: 20,
            fontSize: 14
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ display: "block", color: "rgba(255,255,255,0.7)", fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Username</label>
            <input 
              type="text" 
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="e.g. admin"
              style={{
                width: "100%", padding: "12px 16px", background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
                color: "white", fontSize: 15, outline: "none", boxSizing: "border-box",
                transition: "border-color 0.2s"
              }}
              onFocus={e => e.target.style.borderColor = "#e11d48"}
              onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
            />
          </div>
          <div>
            <label style={{ display: "block", color: "rgba(255,255,255,0.7)", fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Password</label>
            <input 
              type="password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: "100%", padding: "12px 16px", background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
                color: "white", fontSize: 15, outline: "none", boxSizing: "border-box",
                transition: "border-color 0.2s"
              }}
              onFocus={e => e.target.style.borderColor = "#e11d48"}
              onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
            />
          </div>
          <button 
            type="submit"
            disabled={loading}
            style={{
              marginTop: 8, width: "100%", padding: "14px",
              background: "#e11d48", border: "none", borderRadius: 8,
              color: "white", fontSize: 15, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
              boxShadow: "0 0 20px rgba(225, 29, 72, 0.4)",
              transition: "transform 0.1s, box-shadow 0.2s",
              opacity: loading ? 0.7 : 1
            }}
            onMouseOver={e => !loading && (e.currentTarget.style.transform = "translateY(-1px)")}
            onMouseOut={e => !loading && (e.currentTarget.style.transform = "none")}
          >
            {loading ? "Authenticating..." : (isRegister ? "Initialize Core" : "Access Core")}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 24 }}>
          <button 
            onClick={() => { setIsRegister(!isRegister); setError(null); }}
            style={{
              background: "none", border: "none", color: "rgba(255,255,255,0.5)",
              fontSize: 13, cursor: "pointer", textDecoration: "underline",
              fontFamily: "inherit"
            }}
          >
            {isRegister ? "Already have a core? Login instead." : "Need a core? Register here."}
          </button>
        </div>
      </div>
    </div>
  )
}
