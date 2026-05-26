import os
import json
import networkx as nx
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

GRAPH_FILE = "graph.json"

def load_graph() -> nx.Graph:
    if os.path.exists(GRAPH_FILE):
        try:
            with open(GRAPH_FILE, "r") as f:
                data = json.load(f)
                return nx.node_link_graph(data)
        except Exception as e:
            print(f"Error loading graph: {e}")
    return nx.Graph()

def save_graph(g: nx.Graph):
    data = nx.node_link_data(g)
    with open(GRAPH_FILE, "w") as f:
        json.dump(data, f)

def extract_entities_and_relationships(text: str, url: str):
    """Uses Groq to extract a knowledge graph from text."""
    if not text:
        return False
        
    prompt = f"""You are a Knowledge Graph extraction engine.
Extract core entities and their relationships from the text below.
Return ONLY a raw JSON object with this exact structure, nothing else:
{{
  "nodes": ["Entity1", "Entity2"],
  "edges": [
    {{"source": "Entity1", "target": "Entity2", "relation": "is related to"}}
  ]
}}

Text:
{text[:3000]}
"""
    try:
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=1024
        )
        content = response.choices[0].message.content
        data = json.loads(content)
        
        g = load_graph()
        
        for node in data.get("nodes", []):
            if not g.has_node(node):
                g.add_node(node, sources=[url])
            else:
                sources = g.nodes[node].get("sources", [])
                if url not in sources:
                    sources.append(url)
                g.nodes[node]["sources"] = sources
                
        for edge in data.get("edges", []):
            src = edge.get("source")
            tgt = edge.get("target")
            rel = edge.get("relation")
            if src and tgt and rel:
                # Ensure nodes exist
                if not g.has_node(src): g.add_node(src, sources=[url])
                if not g.has_node(tgt): g.add_node(tgt, sources=[url])
                g.add_edge(src, tgt, relation=rel)
                
        save_graph(g)
        print(f"Graph updated. Total nodes: {g.number_of_nodes()}, edges: {g.number_of_edges()}")
        return True
    except Exception as e:
        print(f"Graph extraction failed: {e}")
        return False

def get_graph_context_for_urls(urls: list[str]) -> str:
    """Finds all nodes related to the given URLs and returns their neighborhood connections."""
    g = load_graph()
    relevant_nodes = set()
    
    # Find nodes that came from these URLs
    for node, data in g.nodes(data=True):
        sources = data.get("sources", [])
        if any(url in sources for url in urls):
            relevant_nodes.add(node)
            
    if not relevant_nodes:
        return ""
        
    context_lines = []
    # Get immediate neighbors (1-hop)
    for node in relevant_nodes:
        neighbors = list(g.neighbors(node))
        for neighbor in neighbors[:5]: # Limit to prevent explosion
            edge_data = g.get_edge_data(node, neighbor)
            rel = edge_data.get("relation", "is related to") if edge_data else "is related to"
            context_lines.append(f"- {node} {rel} {neighbor}")
            
    if context_lines:
        return "\n--- Graph Knowledge Neighborhood ---\n" + "\n".join(list(set(context_lines)))
    return ""
