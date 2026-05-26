# backend/rag.py

import os
from groq import Groq
from dotenv import load_dotenv
from search import search as hybrid_search
from database import SessionLocal, PageCapture
from datetime import datetime

load_dotenv()

LLM_MODEL = "llama-3.1-8b-instant"


def ask_memory(question: str, user_id: int, level: str = "high", groq_key: str | None = None, nomic_key: str | None = None) -> dict:
    """
    Full RAG pipeline:
    1. Retrieve relevant pages using hybrid search (with dynamic Nomic key support)
    2. Format context for LLM
    3. Generate answer using dynamic Groq client grounded in actual history
    """
    if level == "lite":
        top_k_retrieve = 4
        num_sources = 2
        chunk_size = 1000
        max_tokens = 256
        prompt_instruction = "Answer directly and very concisely in 1-2 sentences."
    elif level == "medium":
        top_k_retrieve = 6
        num_sources = 3
        chunk_size = 2000
        max_tokens = 512
        prompt_instruction = "Answer directly and accurately, providing a balanced summary."
    else:
        top_k_retrieve = 8
        num_sources = 4
        chunk_size = 2500
        max_tokens = 1024
        prompt_instruction = "Answer in a detailed and comprehensive manner, accurately summarizing the text from the history. Provide as much relevant technical detail as possible based on the text."

    # Step 1: retrieve
    results = hybrid_search(question, user_id=user_id, top_k=top_k_retrieve, nomic_key=nomic_key)
    if not results:
        return {
            "answer": "I couldn't find any relevant pages in your browsing history for this question.",
            "question": question
        }

    # Step 2: build context
    context_parts = []
    retrieved_urls = []
    # Only feed top sources to LLM to avoid Groq rate limit
    for i, r in enumerate(results[:num_sources]):
        retrieved_urls.append(r["url"])
        ts = datetime.fromtimestamp(r["timestamp"] / 1000).strftime("%b %d, %Y %H:%M")
        part = f"[{i+1}] Title: {r['title']}\nURL: {r['url']}\nVisited: {ts}"
        if r.get("selected_text"):
            part += f"\nHighlighted text: {r['selected_text'][:300]}"
        elif r.get("page_text"):
            part += f"\nPage content: {r['page_text'][:chunk_size]}"
        if r.get("cluster_label"):
            part += f"\nSession: {r['cluster_label']}"
        context_parts.append(part)

    context = "\n\n".join(context_parts)

    # Step 3: LLM prompt
    prompt = f"""You are ChronicleOS, a strictly-grounded AI memory assistant.
Answer the user's question based ONLY on the browsing history text provided below.
CRITICAL RULES:
- Do not use outside general knowledge.
- If the provided context contains information about MULTIPLE topics, you MUST answer ONLY about the specific topic the user asked about. Ignore unrelated context.
- If the answer is not contained in the provided page context, explicitly say that you don't have enough information in the history.

BROWSING HISTORY CONTEXT:
{context}

USER QUESTION: {question}

{prompt_instruction} Do NOT say "According to the context" or list the source URLs, as the UI will display the sources separately. Just give the factual answer:"""

    active_key = groq_key or os.getenv("GROQ_API_KEY")
    client = Groq(api_key=active_key)

    try:
        response = client.chat.completions.create(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=0.0,
        )
        answer = response.choices[0].message.content
    except Exception as e:
        answer = f"LLM unavailable: {str(e)}"

    return {
        "answer": answer,
        "sources": results[:6],
        "question": question,
    }


def reconstruct_workflow(topic: str, user_id: int, groq_key: str | None = None, nomic_key: str | None = None) -> dict:
    """
    Given a topic, reconstruct the chronological trail of pages
    showing HOW the user arrived at ideas related to that topic.
    """
    results = hybrid_search(topic, user_id=user_id, top_k=15, nomic_key=nomic_key)
    if not results:
        return {"trail": [], "topic": topic}

    # Sort by time to get chronological trail
    sorted_results = sorted(results, key=lambda x: x["timestamp"])

    # Format for LLM narrative
    trail_text = "\n".join([
        f"{datetime.fromtimestamp(r['timestamp']/1000).strftime('%b %d %H:%M')} → {r['title']}"
        for r in sorted_results
    ])

    prompt = f"""A user wants to understand how they arrived at ideas about: "{topic}"

Here is their chronological browsing trail:
{trail_text}

Write a brief narrative (3-5 sentences) explaining how their thinking evolved:
- What they started with
- How their research progressed
- What they ended up at

Be concise and specific."""

    active_key = groq_key or os.getenv("GROQ_API_KEY")
    client = Groq(api_key=active_key)

    try:
        response = client.chat.completions.create(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=256,
            temperature=0.4,
        )
        narrative = response.choices[0].message.content
    except Exception as e:
        narrative = f"Could not generate narrative: {str(e)}"

    return {
        "topic": topic,
        "trail": sorted_results,
        "narrative": narrative,
    }


def weekly_summary(user_id: int, groq_key: str | None = None) -> dict:
    """Generate a high-level summary of the user's research over the last 7 days."""
    db = SessionLocal()
    try:
        now = datetime.utcnow().timestamp() * 1000
        limit_ms = now - (7 * 24 * 60 * 60 * 1000)

        # 1. Fetch data
        pages = db.query(PageCapture).filter(PageCapture.timestamp >= limit_ms, PageCapture.user_id == user_id).all()
        if not pages:
            return {"summary": "No browsing data from the past week."}

        # Group by cluster label
        from collections import Counter
        labels = Counter(p.cluster_label for p in pages if p.cluster_label)
        top_topics = labels.most_common(5)

        domain_counts = Counter(p.domain for p in pages if p.domain)
        top_domains = domain_counts.most_common(5)

        topics_str = "\n".join(
            f"- {label} ({count} pages)" for label, count in top_topics
        )
        domains_str = "\n".join(
            f"- {domain} ({count} visits)" for domain, count in top_domains
        )

        prompt = f"""Generate a brief weekly browsing summary for a user.

Total pages visited: {len(pages)}
Top knowledge sessions:
{topics_str}

Most visited sites:
{domains_str}

Write 3-4 sentences summarizing what the user focused on this week, like a thoughtful weekly review.
CRITICAL: Do NOT use markdown headers or bold text (like **Weekly Summary**). Do NOT use conversational filler like "Here is your summary". Just write the 3-4 sentences directly."""

        active_key = groq_key or os.getenv("GROQ_API_KEY")
        client = Groq(api_key=active_key)

        response = client.chat.completions.create(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=256,
            temperature=0.5,
        )
        summary = response.choices[0].message.content

        return {
            "summary": summary,
            "total_pages": len(pages),
            "top_topics": [{"label": l, "count": c} for l, c in top_topics],
            "top_domains": [{"domain": d, "count": c} for d, c in top_domains],
        }
    finally:
        db.close()