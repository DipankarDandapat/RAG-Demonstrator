from __future__ import annotations

import hashlib
import io
import json
import os
import re
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

import chromadb
import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from pypdf import PdfReader
from sentence_transformers import CrossEncoder, SentenceTransformer
from langchain_text_splitters import RecursiveCharacterTextSplitter
from bs4 import BeautifulSoup
from docx import Document
from openai import OpenAI

load_dotenv()

BASE_DIR = Path(__file__).resolve().parents[1]
PERSIST_DIR = Path(os.getenv("CHROMA_PERSIST_DIRECTORY", str(BASE_DIR / "data" / "chroma")))
PERSIST_DIR.mkdir(parents=True, exist_ok=True)
COLLECTION_NAME = os.getenv("CHROMA_COLLECTION", "qa_knowledge_base")
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "700"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "120"))
TOP_K = int(os.getenv("TOP_K", "5"))

app = FastAPI(title="QA RAG Demonstrator", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

client = chromadb.PersistentClient(path=str(PERSIST_DIR))
collection = client.get_or_create_collection(COLLECTION_NAME, metadata={"hnsw:space": "cosine"})
_embedding_model: SentenceTransformer | None = None
_reranker: CrossEncoder | None = None
_feedback: list[dict[str, Any]] = []

# ── History DB (SQLite) ──
HISTORY_DB = BASE_DIR / "data" / "history.db"
HISTORY_DB.parent.mkdir(parents=True, exist_ok=True)

def _get_db() -> sqlite3.Connection:
    con = sqlite3.connect(str(HISTORY_DB))
    con.row_factory = sqlite3.Row
    con.execute("""CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        provider TEXT,
        confidence REAL,
        timing_ms TEXT,
        sources TEXT,
        feedback TEXT,
        session_id TEXT,
        created_at TEXT NOT NULL
    )""")
    # migrate: add session_id column if it doesn't exist yet
    existing = {row[1] for row in con.execute("PRAGMA table_info(history)")}
    if "session_id" not in existing:
        con.execute("ALTER TABLE history ADD COLUMN session_id TEXT")
    con.execute("""CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""")
    con.execute("CREATE INDEX IF NOT EXISTS idx_sessions_sid ON sessions(session_id)")
    con.commit()
    return con

def _get_session_turns(session_id: str) -> list[dict[str, str]]:
    with _get_db() as con:
        rows = con.execute(
            "SELECT role, content FROM sessions WHERE session_id=? ORDER BY id DESC LIMIT ?",
            (session_id, SESSION_TURNS * 2)
        ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]

def _append_session_turn(session_id: str, role: str, content: str) -> None:
    with _get_db() as con:
        con.execute(
            "INSERT INTO sessions (session_id, role, content, created_at) VALUES (?,?,?,?)",
            (session_id, role, content, time.strftime("%Y-%m-%dT%H:%M:%SZ"))
        )

def _save_history(question: str, result: dict[str, Any], session_id: str | None = None) -> str:
    hid = uuid.uuid4().hex[:12]
    with _get_db() as con:
        con.execute(
            "INSERT INTO history (id, question, answer, provider, confidence, timing_ms, sources, feedback, session_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (hid, question, result["answer"], result.get("provider"), result.get("confidence"),
             json.dumps(result.get("timing_ms")), json.dumps(result.get("sources", [])), None,
             session_id, time.strftime("%Y-%m-%dT%H:%M:%SZ"))
        )
    return hid

STEPS = [
    (1, "Data sources", "Collect PDFs, DOCX, TXT, web pages, databases, APIs, and test artifacts."),
    (2, "Data ingestion", "Load source content and preserve source identity for traceability."),
    (3, "Text extraction", "Extract readable text while removing file-format noise."),
    (4, "Text splitting", "Split text into overlapping LangChain chunks so context is retrievable."),
    (5, "Cleaning & normalization", "Normalize whitespace, control characters, and repeated boilerplate."),
    (6, "Metadata enrichment", "Attach source, title, type, page, timestamp, and chunk metadata."),
    (7, "Embedding generation", "Convert each chunk into a dense semantic vector."),
    (8, "Vector store ingestion", "Persist vectors, text, and metadata in ChromaDB."),
    (9, "Indexing", "Use Chroma’s similarity index to make nearest-neighbor retrieval fast."),
    (10, "Knowledge base ready", "Verify that indexed content can be searched and cited."),
    (11, "User question", "Accept a natural-language QA, test-case, defect, or release question."),
    (12, "Query embedding", "Embed the question using the same embedding space as the chunks."),
    (13, "Retrieval", "Fetch the most semantically similar chunks from ChromaDB."),
    (14, "Re-ranking", "Optionally score question/chunk pairs with a cross-encoder."),
    (15, "Context assembly", "Combine top chunks, the question, and source labels into context."),
    (16, "Prompt creation", "Apply grounded-answer instructions and QA response constraints."),
    (17, "LLM generation", "Generate an answer using OpenAI, with a safe fallback when unavailable."),
    (18, "Response", "Return answer, confidence, latency, and structured QA observations."),
    (19, "Sources / citations", "Expose the exact source chunks used for the answer."),
    (20, "Feedback & improvement", "Capture helpfulness, missing evidence, and follow-up improvement data."),
]

SESSION_TURNS = int(os.getenv("SESSION_TURNS", "6"))  # max prior turns injected into prompt

class QueryRequest(BaseModel):
    question: str = Field(min_length=3)
    top_k: int = Field(default=TOP_K, ge=1, le=12)
    rerank: bool = True
    doc_ids: list[str] | None = None
    session_id: str | None = None

class FeedbackRequest(BaseModel):
    question: str
    answer: str
    rating: str = Field(pattern="^(helpful|not_helpful)$")
    comment: str = ""

class TextIngestRequest(BaseModel):
    text: str = Field(min_length=10)
    source: str = "manual-test-note.txt"
    title: str = "Manual test note"


def embedding_model() -> SentenceTransformer:
    global _embedding_model
    if _embedding_model is None:
        _embedding_model = SentenceTransformer(
            os.getenv("HUGGINGFACE_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"),
            token=os.getenv("HF_TOKEN") or None,
        )
    return _embedding_model


# ── Step 5: Cleaning & normalization ──────────────────────────────────────────
# Normalizes whitespace and punctuation spacing in extracted text
def clean_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "")
    return re.sub(r"\s([,.;:!?])", r"\1", text).strip()


# ── Step 3: Text extraction ───────────────────────────────────────────────────
# Extracts plain text from PDF, DOCX, HTML, TXT, and Markdown files
def extract_file(filename: str, data: bytes) -> tuple[str, dict[str, Any]]:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(pages), {"file_type": "pdf", "pages": len(pages)}
    if suffix == ".docx":
        doc = Document(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs), {"file_type": "docx"}
    if suffix in {".html", ".htm"}:
        return BeautifulSoup(data.decode("utf-8", errors="ignore"), "html.parser").get_text(" "), {"file_type": "html"}
    return data.decode("utf-8", errors="ignore"), {"file_type": suffix.lstrip(".") or "txt"}


# ── Steps 4–9: Split → Clean → Enrich → Embed → Store → Index ────────────────
# Splits text into overlapping chunks, generates embeddings, upserts into ChromaDB
def ingest_text(text: str, source: str, title: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    normalized = clean_text(text)
    splitter = RecursiveCharacterTextSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP, separators=["\n\n", "\n", ". ", " ", ""])
    chunks = splitter.split_text(normalized)
    if not chunks:
        raise HTTPException(400, "No readable text was found")
    vectors = embedding_model().encode(chunks, normalize_embeddings=True).tolist()
    ids, documents, metadatas = [], [], []
    doc_id = hashlib.sha1(f"{source}:{title}".encode()).hexdigest()[:16]
    for i, chunk in enumerate(chunks):
        digest = hashlib.sha1(f"{source}:{i}:{chunk}".encode()).hexdigest()[:16]
        ids.append(digest); documents.append(chunk)
        meta = {"source": source, "title": title, "chunk_index": i, "file_type": (extra or {}).get("file_type", "text"), "ingested_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "doc_id": doc_id}
        metadatas.append(meta)
    collection.upsert(ids=ids, documents=documents, embeddings=vectors, metadatas=metadatas)
    return {"source": source, "title": title, "chunks_created": len(chunks), "steps_completed": list(range(1, 11)), "sample_chunks": chunks[:3]}


# ── Steps 12–14: Query embedding → Retrieval → Re-ranking ────────────────────
# Embeds the question, queries ChromaDB for top-K chunks, optionally re-ranks with CrossEncoder
def retrieve(question: str, top_k: int, rerank: bool, doc_ids: list[str] | None = None) -> tuple[list[dict[str, Any]], float]:
    started = time.perf_counter()
    if collection.count() == 0:
        return [], 0.0
    qvec = embedding_model().encode([question], normalize_embeddings=True).tolist()[0]
    where = {"doc_id": {"$in": doc_ids}} if doc_ids else None
    # count available chunks in scope to avoid n_results > available error
    if where:
        scoped_count = len(collection.get(where=where, include=["metadatas"])["ids"])
    else:
        scoped_count = collection.count()
    n = min(top_k * 2 if rerank else top_k, max(scoped_count, 1))
    q_kwargs: dict[str, Any] = dict(query_embeddings=[qvec], n_results=n, include=["documents", "metadatas", "distances"])
    if where:
        q_kwargs["where"] = where
    result = collection.query(**q_kwargs)
    items = [{"text": d, "metadata": m, "distance": float(dist)} for d, m, dist in zip(result["documents"][0], result["metadatas"][0], result["distances"][0])]
    if rerank and len(items) > 1 and os.getenv("RERANK_ENABLED", "true").lower() == "true":
        global _reranker
        try:
            if _reranker is None: _reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
            scores = _reranker.predict([(question, x["text"]) for x in items])
            for item, score in zip(items, scores): item["rerank_score"] = float(score)
            items.sort(key=lambda x: x.get("rerank_score", -999), reverse=True)
        except Exception:
            pass
    elapsed = (time.perf_counter() - started) * 1000
    return items[:top_k], round(elapsed, 2)


QA_SYSTEM_PROMPT = """You are a senior software quality engineer helping a QA team. Use the numbered evidence chunks to answer the question.

Rules:
- Base your answer strictly on the evidence provided.
- Only cite a chunk number e.g. [1], [2] when you are directly quoting or paraphrasing that specific chunk. Never cite a chunk number if the information does not come from that chunk.
- If the evidence does not contain information relevant to the question, respond with exactly: "This answer is not available in the knowledge base." Do not guess, infer, or use outside knowledge.
- For generative tasks (create test cases, write test scenarios, generate a test plan) — use the evidence as the domain context and produce the requested output.
- For analytical tasks (risks, regression impact, release readiness) — structure your answer with relevant sections from: **Test Scenarios**, **Regression Tests to Run**, **Highest Risks**, **Release Gate Criteria**, **Recommendation**. Only include sections relevant to the question.
- Keep answers practical and actionable for a QA engineer."""


# ── Steps 15–17: Context assembly → Prompt creation → LLM generation ─────────
# Assembles evidence context, builds grounded prompt, calls OpenAI to generate answer
NOT_IN_KB = "This answer is not available in the knowledge base."

def _is_grounded(answer: str, sources: list[dict[str, Any]]) -> bool:
    """Check if any meaningful content from sources appears in the answer."""
    if not sources:
        return False
    answer_lower = answer.lower()
    for s in sources:
        # take key phrases (4+ word sequences) from each chunk
        words = s["text"].lower().split()
        for i in range(len(words) - 3):
            phrase = " ".join(words[i:i+4])
            if phrase in answer_lower:
                return True
    return False

def generate_answer(question: str, sources: list[dict[str, Any]], prior_turns: list[dict[str, str]] | None = None) -> tuple[str, str]:
    context = "\n\n".join(f"[{i+1}] (source: {s['metadata'].get('title', s['metadata'].get('source'))})\n{s['text']}" for i, s in enumerate(sources))
    if not os.getenv("OPENAI_API_KEY"):
        return ("OPENAI_API_KEY is not configured. Retrieval completed successfully; use the cited evidence below to inspect the answer path.", "not_configured")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    kwargs: dict[str, Any] = {"api_key": os.getenv("OPENAI_API_KEY")}
    if os.getenv("OPENAI_BASE_URL"): kwargs["base_url"] = os.getenv("OPENAI_BASE_URL")
    llm = OpenAI(**kwargs)
    messages: list[dict[str, str]] = [{"role": "system", "content": QA_SYSTEM_PROMPT}]
    if prior_turns:
        messages.extend(prior_turns)
    messages.append({"role": "user", "content": f"Evidence:\n{context}\n\nQuestion: {question}"})
    response = llm.chat.completions.create(model=model, messages=messages, temperature=0.1, max_tokens=900)
    answer = response.choices[0].message.content or "No answer returned."
    # if not grounded in evidence, return the standard not-in-kb message (no fake citations)
    if not _is_grounded(answer, sources):
        return NOT_IN_KB, "openai"
    # strip any stray [N] citations that reference non-existent chunks
    answer = re.sub(r"\[\d+\]", "", answer).strip()
    return answer, "openai"

# ── Step 10: Knowledge base ready ────────────────────────────────────────────
# Returns backend status and total indexed chunk/file counts
@app.get("/api/health")
def health():
    total_chunks = collection.count()
    file_count = 0
    if total_chunks > 0:
        metas = collection.get(include=["metadatas"])["metadatas"]
        file_count = len({m.get("doc_id") or m.get("source", "") for m in metas})
    return {"status": "ok", "collection": COLLECTION_NAME, "documents": total_chunks, "files": file_count, "embedding_provider": os.getenv("EMBEDDING_PROVIDER", "huggingface")}

@app.get("/api/steps")
def steps():
    return [{"step": n, "name": name, "description": desc, "phase": "offline" if n <= 10 else "online"} for n, name, desc in STEPS]

# ── Steps 1–2: Data sources & ingestion (text paste) ─────────────────────────
@app.post("/api/ingest/text")
def ingest_text_endpoint(req: TextIngestRequest):
    return ingest_text(req.text, req.source, req.title)

# ── Steps 1–2: Data sources & ingestion (file upload) ────────────────────────
@app.post("/api/ingest/file")
async def ingest_file_endpoint(file: UploadFile = File(...)):
    data = await file.read()
    text, extra = extract_file(file.filename or "upload.txt", data)
    return ingest_text(text, file.filename or "upload.txt", Path(file.filename or "upload.txt").stem, extra)

# ── Steps 1–10: Full offline pipeline with SSE progress events ───────────────
# Streams step-by-step status back to the frontend as Server-Sent Events
@app.post("/api/ingest/file/stream")
async def ingest_file_stream(file: UploadFile = File(...)):
    data = await file.read()
    filename = file.filename or "upload.txt"
    stem = Path(filename).stem

    import json

    def event(step: int, status: str, detail: str = ""):
        return f"data: {json.dumps({'step': step, 'status': status, 'detail': detail})}\n\n"

    def generate():
        yield event(1, "done", f"Source received: {filename}")
        yield event(2, "active", "Ingesting file…")
        try:
            text, extra = extract_file(filename, data)
        except Exception as exc:
            yield event(2, "error", str(exc)); return
        yield event(2, "done", f"File type: {extra.get('file_type')}")

        yield event(3, "active", "Extracting text…")
        normalized = clean_text(text)
        if not normalized:
            yield event(3, "error", "No readable text found"); return
        yield event(3, "done", f"{len(normalized)} characters extracted")

        yield event(4, "active", "Splitting into chunks…")
        splitter = RecursiveCharacterTextSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP, separators=["\n\n", "\n", ". ", " ", ""])
        chunks = splitter.split_text(normalized)
        if not chunks:
            yield event(4, "error", "Splitting produced no chunks"); return
        yield event(4, "done", f"{len(chunks)} chunks created")

        yield event(5, "done", "Whitespace and punctuation normalized")

        yield event(6, "active", "Enriching metadata…")
        ids, documents, metadatas = [], [], []
        doc_id = hashlib.sha1(f"{filename}:{stem}".encode()).hexdigest()[:16]
        ingested_at = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        for i, chunk in enumerate(chunks):
            digest = hashlib.sha1(f"{filename}:{i}:{chunk}".encode()).hexdigest()[:16]
            ids.append(digest)
            documents.append(chunk)
            metadatas.append({"source": filename, "title": stem, "chunk_index": i, "file_type": extra.get("file_type", "text"), "ingested_at": ingested_at, "doc_id": doc_id})
        yield event(6, "done", "Source, title, type, timestamp attached")

        yield event(7, "active", "Generating embeddings…")
        try:
            vectors = embedding_model().encode(chunks, normalize_embeddings=True).tolist()
        except Exception as exc:
            yield event(7, "error", str(exc)); return
        yield event(7, "done", f"{len(vectors)} vectors generated")

        yield event(8, "active", "Upserting into ChromaDB…")
        try:
            collection.upsert(ids=ids, documents=documents, embeddings=vectors, metadatas=metadatas)
        except Exception as exc:
            yield event(8, "error", str(exc)); return
        yield event(8, "done", f"{len(ids)} documents stored")

        yield event(9, "done", "Similarity index updated")
        yield event(10, "done", f"Knowledge base ready · {collection.count()} total chunks")
        yield f"data: {json.dumps({'step': 0, 'status': 'complete', 'chunks_created': len(chunks), 'total': collection.count()})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

# ── Steps 11–19: Online RAG pipeline ─────────────────────────────────────────
# Accepts user question, retrieves evidence, generates grounded answer, saves to history
MIN_CONFIDENCE = float(os.getenv("MIN_CONFIDENCE", "0.0"))

@app.post("/api/query")
def query(req: QueryRequest):
    started = time.perf_counter()
    sources, retrieval_ms = retrieve(req.question, req.top_k, req.rerank, req.doc_ids)
    if not sources: raise HTTPException(400, "Knowledge base is empty. Ingest a QA document first.")
    similarities = [1 - s["distance"] for s in sources]
    confidence = round(float(np.mean(similarities[:3])), 3) if similarities else 0.0
    session_id = req.session_id or uuid.uuid4().hex[:16]
    prior_turns = _get_session_turns(session_id)
    answer, provider = generate_answer(req.question, sources, prior_turns)
    _append_session_turn(session_id, "user", req.question)
    _append_session_turn(session_id, "assistant", answer)
    answer_ms = round((time.perf_counter() - started) * 1000, 2)
    result = {"answer": answer, "provider": provider, "confidence": confidence, "timing_ms": {"retrieval": retrieval_ms, "total": answer_ms}, "steps_completed": list(range(11, 20)), "sources": [{"rank": i+1, **s} for i, s in enumerate(sources)], "session_id": session_id}
    hid = _save_history(req.question, result, session_id)
    result["history_id"] = hid
    return result

# ── Multi-turn session management ────────────────────────────────────────────
# Clears stored conversation turns for a given session ID
@app.delete("/api/sessions/{session_id}")
def clear_session(session_id: str):
    with _get_db() as con:
        con.execute("DELETE FROM sessions WHERE session_id=?", (session_id,))
    return {"cleared": True}

# ── Step 20: Feedback & improvement ──────────────────────────────────────────
# Captures helpful/not-helpful rating and persists it to the history record
@app.post("/api/feedback")
def feedback(req: FeedbackRequest):
    item = req.model_dump(); item["created_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ"); _feedback.append(item)
    # also persist rating onto the matching history row
    with _get_db() as con:
        con.execute("UPDATE history SET feedback=? WHERE question=? ORDER BY created_at DESC LIMIT 1",
                    (req.rating, req.question))
    return {"saved": True, "feedback_count": len(_feedback), "message": "Feedback captured for prompt, retrieval, and test-coverage improvement."}

# ── Document management ───────────────────────────────────────────────────────
# Lists all ingested documents grouped by doc_id with chunk counts and metadata
@app.get("/api/documents")
def list_documents():
    total = collection.count()
    if total == 0:
        return []
    result = collection.get(include=["metadatas"])
    docs: dict[str, dict] = {}
    for meta in result["metadatas"]:
        key = meta.get("doc_id") or meta.get("source", "unknown")
        if key not in docs:
            docs[key] = {"doc_id": key, "source": meta.get("source", ""), "title": meta.get("title", ""), "file_type": meta.get("file_type", ""), "ingested_at": meta.get("ingested_at", ""), "chunk_count": 0}
        docs[key]["chunk_count"] += 1
    return sorted(docs.values(), key=lambda d: d["ingested_at"], reverse=True)

# Deletes all chunks belonging to a document from the vector store
@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str):
    result = collection.get(where={"doc_id": doc_id}, include=["metadatas"])
    if not result["ids"]:
        # fallback for old chunks without doc_id — match by source
        result2 = collection.get(include=["metadatas"])
        ids_to_delete = [id_ for id_, meta in zip(result2["ids"], result2["metadatas"]) if meta.get("source") == doc_id]
        if not ids_to_delete:
            raise HTTPException(404, "Document not found")
        collection.delete(ids=ids_to_delete)
        return {"deleted": len(ids_to_delete)}
    collection.delete(ids=result["ids"])
    return {"deleted": len(result["ids"])}

# ── Query history (SQLite) ────────────────────────────────────────────────────
# Returns past Q&A entries newest-first, including sources and feedback
@app.get("/api/history")
def list_history(limit: int = 50):
    with _get_db() as con:
        rows = con.execute("SELECT id, question, answer, provider, confidence, timing_ms, sources, feedback, created_at FROM history ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [{**dict(r), "timing_ms": json.loads(r["timing_ms"] or "null"), "sources": json.loads(r["sources"] or "[]")} for r in rows]

# Returns a single history entry by ID
@app.get("/api/history/{hid}")
def get_history(hid: str):
    with _get_db() as con:
        row = con.execute("SELECT * FROM history WHERE id=?", (hid,)).fetchone()
    if not row: raise HTTPException(404, "History entry not found")
    return {**dict(row), "timing_ms": json.loads(row["timing_ms"] or "null"), "sources": json.loads(row["sources"] or "[]")}

# Deletes a single history entry by ID
@app.delete("/api/history/{hid}")
def delete_history(hid: str):
    with _get_db() as con:
        cur = con.execute("DELETE FROM history WHERE id=?", (hid,))
    if cur.rowcount == 0: raise HTTPException(404, "History entry not found")
    return {"deleted": True}

# ── Metrics ───────────────────────────────────────────────────────────────────
# Returns aggregate stats: total chunks, feedback count, helpful rate, QA use cases
@app.get("/api/metrics")
def metrics():
    helpful = sum(1 for x in _feedback if x["rating"] == "helpful")
    return {"documents": collection.count(), "feedback_total": len(_feedback), "helpful_rate": round(helpful / len(_feedback), 3) if _feedback else None, "qa_use_cases": ["requirements-to-test generation", "defect triage", "regression impact analysis", "release-readiness evidence", "test documentation search"]}
