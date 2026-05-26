# ChronicleOS — Advanced Personal Memory OS & Semantic Search Engine

ChronicleOS is an advanced, production-ready "Memory OS" that passive-captures, organizes, clusters, and queries your complete web browsing history. Combining hybrid search precision with deep relational knowledge graph reasoning, it acts as a secure, stateless secondary brain.

---

## Technical Architecture Overview

```mermaid
graph TD
    Ext[Chrome Extension] -->|Queue & Batch Sync| API[FastAPI Backend]
    API -->|Dialect Dispatcher| DB[(Supabase PostgreSQL / SQLite)]
    DB -->|pgvector / SQLiteVector| DB
    API -->|NetworkX Graph Builder| Graph[graph.json]
    API -->|Synthesizer| LLM[Groq Llama-3.1 RAG]
    Dashboard[React Dashboard] -->|Stateless JWT API| API
    Ext -->|Auto-Sync Auth| Dashboard
```

---

## 1. Features & Architectural Upgrades

### Chrome Extension (Plasmo + React)
- **Passive Memory Capture**: Silently captures tab activity, titles, domains, highlighted snippets, and full-page text content.
- **Queue-and-Batch Sync Pipeline**: Accumulates captures in-memory and flushes them to the backend periodically (every 15s or immediately on 5 captures) to prevent page-loading lag and API spam.
- **Offline Network Resilience**: Automatically prepends failed batches back to the capture queue in case of connectivity loss.
- **Single Sign-On (SSO) Auto-Sync**: Automatically detects the dashboard authentication state from active tabs and signs into the extension popup without manual input.

### Backend (FastAPI + SQLAlchemy)
- **Dynamic Database Dialect**: Connects to **Supabase (PostgreSQL)** when `DATABASE_URL` is set, dynamically enabling the `vector` extension. Falls back to a local **SQLite** database for completely offline development.
- **pgvector Vector Database**: ChromaDB has been completely removed. Text embeddings (768-dimensional float arrays from Nomic AI) are stored natively inside the relational `captures` table.
  - *PostgreSQL*: Uses native `pgvector.sqlalchemy.Vector(768)` fields for fast database-level cosine similarity queries (`cosine_distance`).
  - *SQLite Fallback*: Automatically serializes embeddings to a JSON-mapped `SQLiteVector` text column and applies a high-fidelity brute-force cosine match in Python using `numpy`.
- **Stateless JWT Multi-Tenancy**: Secure `bcrypt` password hashing (bypassing passlib limits) and strict `user_id` context isolation. No user's semantic memory can contaminate another's.
- **Automated Unsupervised Clustering**: DBSCAN algorithm merges temporal and semantic distance matrices to group related pages into cohesive "Sessions" (labeled via Groq Llama-3).
- **Graph RAG (NetworkX)**: An asynchronous pipeline extracts entities and relationships in the background, building a multi-hop knowledge graph.

### React Dashboard (Vite + TailwindCSS)
- **Vibrant Glassmorphism Interface**: Sleek dark mode featuring blur filters, harmonic radial gradients, and interactive micro-animations.
- **Three-Stage Search Precision**:
  1. *Semantic Search*: Native `pgvector` or exact cosine vector retrieval.
  2. *Lexical Matching*: Normalised BM25 Okapi term matching.
  3. *Linear Hybrid Scoring*: Fusion of vector and BM25 scores (60/40 split) plus title matching bonuses.
- **Interactive Memory Q&A**: Asks questions grounded strictly in your personal history with tiered synthesis levels ("lite", "medium", "high").

---

## 2. Cloud Deployments Setup

### Backend Deployment (Render)
The backend is prepared for one-click deployment on **Render** (supporting long-running async background tasks like Graph extraction and clustering).
- Deployment configuration is handled by [render.yaml](file:///d:/ML/chronicalos/chronicleos/backend/render.yaml).
- Requires setting environment variables on Render: `GROQ_API_KEY`, `NOMIC_API_KEY`, `DATABASE_URL` (your Supabase URL), and `JWT_SECRET_KEY`.

### Frontend Dashboard Deployment (Vercel)
The dashboard React SPA is ready for static deployment on **Vercel**.
- Router redirects are configured in [vercel.json](file:///d:/ML/chronicalos/chronicleos/dashboard/vercel.json).
- Axios is configured to dynamically target `import.meta.env.VITE_API_URL` or fallback to `http://localhost:8000`.

---

## 3. Getting Started

### Backend Setup
1. Navigate to the `backend/` folder and create a `.env` file:
   ```env
   GROQ_API_KEY=your_groq_api_key
   NOMIC_API_KEY=your_nomic_api_key
   JWT_SECRET_KEY=your_secure_random_signing_key
   DATABASE_URL=postgresql://user:password@host:port/dbname # Optional (defaults to SQLite fallback)
   ```
2. Create a virtual environment and install dependencies:
   ```bash
   cd backend
   python -m venv .venv
   .venv\Scripts\activate  # On Linux/macOS: source .venv/bin/activate
   pip install -r requirements.txt
   ```
3. Start the FastAPI server:
   ```bash
   python main.py
   ```

### Dashboard Setup
1. Navigate to the `dashboard/` folder and install dependencies:
   ```bash
   cd dashboard
   pnpm install  # or npm install
   ```
2. Start the development server:
   ```bash
   pnpm dev
   ```

### Chrome Extension Setup
1. Navigate to the `extension/` folder:
   ```bash
   cd extension
   pnpm install
   pnpm dev
   ```
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `build/chrome-mv3-dev/` directory generated inside the extension folder.

---

## 4. Verification & Diagnostics

To run a full end-to-end integration test checking registration, auth headers, page capture, background vector embedding, SQL storage, exact hybrid similarity matching, and RAG answer synthesis, execute:
```bash
.venv\Scripts\python C:\Users\Lenovo\.gemini\antigravity-ide\scratch\test_flow.py
```

## License
MIT License.