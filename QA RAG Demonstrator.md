# QA RAG Demonstrator

This repository is a complete, separately runnable demonstration of the 20-step Retrieval-Augmented Generation flow shown in the supplied reference image. It is designed for software testing and quality assurance teams that need answers grounded in requirements, defect history, test plans, release notes, and evidence artifacts.

## Architecture

| Layer | Implementation | Responsibility |
|---|---|---|
| Frontend | Vite + browser JavaScript | Visualize all 20 steps, ingest artifacts, ask questions, show citations, capture feedback |
| API | FastAPI + Python | File extraction, normalization, chunking, embeddings, retrieval, reranking, generation |
| Chunking | LangChain `RecursiveCharacterTextSplitter` | Context-preserving overlapping chunks |
| Embeddings | Hugging Face Sentence Transformers | Local semantic vectors using `all-MiniLM-L6-v2` by default |
| Vector database | ChromaDB | Persistent documents, embeddings, metadata, and similarity search |
| LLM | OpenAI-compatible Chat Completions | Grounded answer generation; configurable model and base URL |
| Optional reranking | Hugging Face CrossEncoder | Question/chunk pair scoring after initial vector retrieval |

## The 20 steps

| Steps | Flow | Demonstration in this application |
|---|---|---|
| 1–2 | Data sources and ingestion | Upload PDF, DOCX, HTML, TXT, Markdown, or paste a QA note |
| 3 | Text extraction | Format-specific extraction in `extract_file` |
| 4 | Text splitting | LangChain recursive splitter with configurable overlap |
| 5 | Cleaning and normalization | Whitespace and punctuation normalization |
| 6 | Metadata enrichment | Source, title, type, chunk index, and ingestion timestamp |
| 7 | Embedding generation | Hugging Face sentence-transformer embeddings |
| 8 | Vector store ingestion | ChromaDB `upsert` of text, vectors, and metadata |
| 9 | Indexing | Chroma persistent similarity index |
| 10 | Knowledge base ready | Health endpoint and indexed-chunk metric |
| 11 | User question | Frontend QA question box |
| 12 | Query embedding | Same embedding model as document chunks |
| 13 | Retrieval | Chroma similarity query |
| 14 | Re-ranking | Optional cross-encoder, enabled in the UI by default |
| 15 | Context assembly | Top chunks are labeled and assembled as evidence |
| 16 | Prompt creation | Grounded QA prompt with citation constraints |
| 17 | LLM generation | OpenAI model generates from evidence only |
| 18 | Response | Answer, provider, confidence estimate, and latency |
| 19 | Sources and citations | Exact source chunks are shown as numbered evidence |
| 20 | Feedback and improvement | Helpful/not-helpful feedback is captured by the API |

## Setup

### 1. Start the Python backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env .env
# Edit .env and set OPENAI_API_KEY=...
uvicorn app.main:app --reload --port 8000
```

The API is available at `http://localhost:8000`. The interactive API documentation is at `http://localhost:8000/docs`.

The first embedding or reranking request downloads the selected Hugging Face models. If you want a quicker demonstration, set `RERANK_ENABLED=false` in `.env`; retrieval still works with ChromaDB similarity search.

### 2. Start the JavaScript frontend in another terminal

```bash
cd frontend
npm install
npm run start
```

Open the Vite URL shown in the terminal, normally `http://localhost:5173`.

### 3. Load the included sample QA corpus

In the UI, upload `sample_data/checkout_qa_notes.md`. Then ask:

> Which regression tests should run before releasing the checkout change, and what are the highest risks?

The UI will show the retrieved chunks, citation numbers, confidence estimate, and timing. It will also let you record whether the answer was useful.

## Environment settings

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | empty | Required for live OpenAI generation |
| `OPENAI_BASE_URL` | empty | Optional OpenAI-compatible endpoint |
| `OPENAI_MODEL` | `gpt-4o-mini` | Generation model |
| `EMBEDDING_PROVIDER` | `huggingface` | Provider label for the local embedding path |
| `HUGGINGFACE_EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | Embedding model |
| `CHROMA_PERSIST_DIRECTORY` | `./data/chroma` | Persistent vector database path |
| `CHUNK_SIZE` | `700` | Target chunk size |
| `CHUNK_OVERLAP` | `120` | Overlap preserving context |
| `TOP_K` | `5` | Default retrieved chunk count |
| `RERANK_ENABLED` | `true` | Enable optional cross-encoder reranking |

## QA engineering applications

A RAG system is useful when a testing decision depends on many semi-structured artifacts. It can search acceptance criteria and historical defects while preserving evidence, propose regression coverage for a changed feature, summarize release-gate gaps, identify test data and environment requirements, and support defect triage from runbooks and incident notes. The citations are important: a QA engineer can inspect the exact chunk behind an answer rather than treating the model as an oracle.

A practical operating model is to keep the model responsible for synthesis, while deterministic checks remain responsible for quality gates. For example, use API contract tests, schema validation, duplicate-order assertions, severity rules, and release policies outside the LLM. Treat generated test ideas as reviewable suggestions, not as proof that a behavior is correct.

## API endpoints

| Endpoint | Method | Use |
|---|---|---|
| `/api/health` | GET | Backend and indexed-chunk status |
| `/api/steps` | GET | Definitions of all 20 steps |
| `/api/ingest/text` | POST | Ingest pasted QA text |
| `/api/ingest/file` | POST | Ingest a PDF, DOCX, HTML, TXT, or Markdown file |
| `/api/query` | POST | Retrieve evidence and generate a cited answer |
| `/api/feedback` | POST | Save helpfulness feedback |
| `/api/metrics` | GET | Basic indexed-content and feedback metrics |

## Limitations and production hardening

This demo keeps feedback in memory and uses a local persistent Chroma directory. For production, add authentication, tenant isolation, document deletion/versioning, ingestion queues, PII and secret scanning, audit logs, evaluation datasets, prompt/version tracking, rate limits, and a durable feedback store. Add automated RAG evaluation for retrieval recall, citation correctness, groundedness, answer relevance, and latency. Keep real release gates deterministic and integrate generated suggestions into the existing test-management workflow.

## Troubleshooting

If the frontend reports that the backend is offline, confirm that FastAPI is running on port 8000 and that the browser is opening the Vite frontend on port 5173. If the answer says that the key is not configured, copy `.env.example` to `.env` and set `OPENAI_API_KEY`. If model download is slow, disable reranking and allow the embedding model to finish its first download. If Chroma data must be reset, stop the backend and remove `backend/data/chroma` before restarting.
