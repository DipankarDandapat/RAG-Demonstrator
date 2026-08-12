import './style.css';

const API = localStorage.getItem('qa_rag_api') || 'http://localhost:8000/api';
const state = {
  steps: [], queryResult: null, stepStatus: {}, stepDetail: {},
  pipelineOpen: false, historyOpen: false,
  sessionId: null,   // current chat session
  turns: [],         // [{question, data}] for rendering the thread
};
const app = document.querySelector('#app');

app.innerHTML = `
<main class="shell">

  <!-- Top bar -->
  <div class="topbar">
    <div class="topbar-left">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="12" fill="#EEF2FF"/>
        <circle cx="21" cy="21" r="9" stroke="#4F46E5" stroke-width="3"/>
        <path d="M27.5 27.5L34 34" stroke="#4F46E5" stroke-width="3" stroke-linecap="round"/>
        <path d="M34 12L35.3 15.7L39 17L35.3 18.3L34 22L32.7 18.3L29 17L32.7 15.7L34 12Z" fill="#7C3AED"/>
        <circle cx="13" cy="35" r="2.5" fill="#06B6D4"/>
        <circle cx="20" cy="38" r="2.5" fill="#06B6D4"/>
        <path d="M15 35.8L18 37.2" stroke="#06B6D4" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <div>
        <h1>RAG Demonstrator</h1>
        <p>Retrieval-Augmented Generation for Smarter, Context-Aware AI</p>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    </div>
  </div>

  <!-- Metrics strip -->
  <div class="metrics-strip">
    <a href="/knowledge.html" class="metric-item metric-item-clickable" id="docsMetricBtn" title="Manage knowledge base">
      <div class="metric-icon">📄</div>
      <div><div class="metric-label">Indexed files</div><div class="metric-value" id="metricDocs">—</div></div>
    </a>
    <div class="metric-item">
      <div class="metric-icon">👍</div>
      <div><div class="metric-label">Helpful rate</div><div class="metric-value" id="metricHelpful">—</div></div>
    </div>
    <div class="metric-item">
      <div class="metric-icon">🤖</div>
      <div><div class="metric-label">Embedding provider</div><div class="metric-value" id="metricProvider" style="font-size:.9rem">Hugging Face</div></div>
    </div>
    <div class="metric-item">
      <div class="metric-icon">⚡</div>
      <div><div class="metric-label">Vector DB</div><div class="metric-value" style="font-size:.9rem">ChromaDB</div></div>
    </div>
  </div>

  <!-- Pipeline accordion -->
  <div class="pipeline-bar">
    <div class="pipeline-header" id="pipelineToggle">
      <div class="pipeline-title">
        <h2>20-Step RAG Pipeline</h2>
        <div class="pipeline-badges">
          <span class="badge offline">01–10 Offline</span>
          <span class="badge online">11–20 Online</span>
        </div>
      </div>
      <button class="pipeline-toggle" id="pipelineToggleBtn">▼ Show steps</button>
    </div>
    <div id="pipelineBody" class="pipeline-body hidden">
      <div id="steps" class="steps"></div>
    </div>
  </div>

  <!-- Main work area: single full-width chat + slide-in ingest drawer -->
  <div class="app-layout">

    <!-- CENTER: Chat -->
    <div class="chat-container">

      <!-- Chat header bar -->
      <div class="chat-header">
        <div class="chat-header-left">
          <span class="chat-title">💬 Chat</span>
        </div>
        <div class="chat-header-right">
          <button id="newChatBtn" class="btn-ghost btn-sm">＋ New Chat</button>
          <button id="historyBtn" class="btn-ghost btn-sm">🕑 History</button>
          <button id="refreshBtn" class="btn-ghost btn-sm">↻ Refresh</button>
          <button id="ingestToggleBtn" class="btn-ghost btn-sm">📂 Add Knowledge</button>
        </div>
      </div>

      <!-- Thread -->
      <div id="chatThread" class="chat-thread"></div>

      <!-- Input area -->
      <div class="chat-input-area">
        <!-- Scope bar -->
        <div id="scopeWrap" class="scope-bar">
          <span class="scope-bar-label"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h3.172a1.5 1.5 0 0 1 1.06.44l.829.828A1.5 1.5 0 0 0 9.62 3.75H12.5A1.5 1.5 0 0 1 14 5.25v7.25A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5V3.5Z" fill="#EEF2FF" stroke="#4F46E5" stroke-width="1.2"/><path d="M2 6.5h12" stroke="#4F46E5" stroke-width="1.2"/></svg></span>
          <div id="scopeList" class="scope-list"></div>
          <span id="scopeCount" class="scope-bar-count">all files</span>
        </div>
        <!-- Textarea + controls -->
        <div class="chat-input-box">
          <textarea id="question" class="chat-input" rows="3" placeholder="Ask a question…"></textarea>
          <div class="chat-input-controls">
            <label class="rerank-label"><input id="rerank" type="checkbox" checked/> Re-rank</label>
            <button id="queryBtn" class="btn-send">&#9658; Send</button>
          </div>
        </div>
      </div>

      <!-- Feedback -->
      <div id="feedback" class="feedback hidden"></div>
    </div>

    <!-- RIGHT: Ingest drawer -->
    <div class="ingest-drawer hidden" id="ingestDrawer">
      <div class="ingest-drawer-header">
        <span class="ingest-drawer-title">📂 Add to Knowledge Base</span>
        <button id="ingestCloseBtn" class="hist-close">✕</button>
      </div>
      <div class="ingest-drawer-body">
        <p class="sub">Upload a PDF, DOCX, HTML, TXT, or Markdown document to add it to the knowledge base.</p>
        <label class="drop" id="dropLabel">
          <input id="fileInput" type="file" accept=".txt,.md,.pdf,.docx,.html,.htm"/>
          <span id="dropText">📎 Choose PDF, DOCX, HTML, TXT, or Markdown</span>
        </label>
        <div class="or">— or paste a QA note —</div>
        <div class="ingest-fields">
          <input id="title" placeholder="Title" value=""/>
          <textarea id="text" rows="4" placeholder="Paste any text to add to the knowledge base…"></textarea>
        </div>
        <button id="ingestBtn" class="btn-primary" style="width:100%">⬆ Upload & Index Document</button>
        <div id="ingestResult" class="ingest-result"></div>
      </div>
    </div>

  </div>

  <!-- Use cases strip -->
  <div class="use-cases-strip">
    <div class="use-case-card"><b>🔍 Semantic Search</b><p>Find relevant information across all ingested documents using natural language queries.</p></div>
    <div class="use-case-card"><b>📚 Grounded Answers</b><p>Every answer is backed by cited source chunks so you can verify the evidence directly.</p></div>
    <div class="use-case-card"><b>⚡ Fast Retrieval</b><p>ChromaDB vector similarity search with optional cross-encoder reranking for precision.</p></div>
    <div class="use-case-card"><b>🧠 Multi-turn Chat</b><p>Maintain conversation context across turns within a session for follow-up questions.</p></div>
  </div>

  <footer>FastAPI + Python · Hugging Face Sentence Transformers · ChromaDB · LangChain · OpenAI</footer>
</main>

<!-- History sidebar -->
<div id="historySidebar" class="hist-sidebar hidden">
  <div class="hist-header">
    <span class="hist-title">🕑 History</span>
    <button id="historyClose" class="hist-close">✕</button>
  </div>
  <div class="hist-search-wrap">
    <input id="histSearch" class="hist-search" type="text" placeholder="Search…"/>
  </div>
  <div id="histList" class="hist-list"><div class="hist-empty">Loading…</div></div>
</div>
<div id="histOverlay" class="hist-overlay hidden"></div>`;

/* ── Utilities ── */
async function api(path, options = {}) {
  const r = await fetch(`${API}${path}`, options);
  const data = await r.json();
  if (!r.ok) {
    const detail = data.detail;
    const msg = Array.isArray(detail)
      ? detail.map(d => d.msg || JSON.stringify(d)).join(', ')
      : (typeof detail === 'string' ? detail : JSON.stringify(detail));
    throw new Error(msg || 'Request failed');
  }
  return data;
}
function esc(s = '') {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderMarkdown(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^(#{1,3}) (.+)$/gm, (_, h, t) => `<strong class="md-h${h.length}">${t}</strong>`)
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/\n/g, '<br>');
}

/* ── Pipeline toggle ── */
document.querySelector('#pipelineToggle').onclick = () => {
  state.pipelineOpen = !state.pipelineOpen;
  const body = document.querySelector('#pipelineBody');
  const btn  = document.querySelector('#pipelineToggleBtn');
  body.classList.toggle('hidden', !state.pipelineOpen);
  btn.textContent = state.pipelineOpen ? '▲ Hide steps' : '▼ Show steps';
};

/* ── Steps rendering ── */
function renderSteps() {
  document.querySelector('#steps').innerHTML = state.steps.map(s => {
    const status = state.stepStatus[s.step] || 'idle';
    const detail = state.stepDetail[s.step] || '';
    const icon = { idle: '', active: '⟳', done: '✓', error: '✗' }[status] || '';
    return `<div class="step ${s.phase} step-${status}" id="step-${s.step}">
      <span class="step-num">${String(s.step).padStart(2, '0')}</span>
      <b>${esc(s.name)}</b>
      ${detail ? `<div class="step-detail">${esc(detail)}</div>` : ''}
      <span class="step-icon">${icon}</span>
    </div>`;
  }).join('');
}

function setStep(step, status, detail = '') {
  state.stepStatus[step] = status;
  state.stepDetail[step] = detail;
  const el = document.querySelector(`#step-${step}`);
  if (!el) return;
  const phase = state.steps.find(s => s.step === step)?.phase || '';
  el.className = `step ${phase} step-${status}`;
  el.querySelector('.step-icon').textContent = { idle: '', active: '⟳', done: '✓', error: '✗' }[status] || '';
  const existing = el.querySelector('.step-detail');
  if (detail) {
    if (existing) existing.textContent = detail;
    else el.insertAdjacentHTML('beforeend', `<div class="step-detail">${esc(detail)}</div>`);
  } else if (existing) existing.remove();
}

function resetSteps(range) {
  range.forEach(n => { state.stepStatus[n] = 'idle'; state.stepDetail[n] = ''; });
  renderSteps();
}

/* ── Refresh ── */
async function refresh() {
  const [steps, health, metrics] = await Promise.all([api('/steps'), api('/health'), api('/metrics')]);
  state.steps = steps;
  renderSteps();
  const pill = document.querySelector('#health');
  if (pill) {
    pill.textContent = `● Online · ${health.files} file${health.files !== 1 ? 's' : ''}`;
    pill.className = 'status-pill';
  }
  document.querySelector('#metricDocs').textContent = health.files ?? health.documents;
  document.querySelector('#metricHelpful').textContent =
    metrics.helpful_rate == null ? '—' : `${Math.round(metrics.helpful_rate * 100)}%`;
  renderScopeList();
}

async function renderScopeList() {
  try {
    const docs = await api('/documents');
    state.docs = docs;
    const list = document.querySelector('#scopeList');
    if (!docs.length) { list.innerHTML = '<span class="scope-empty">No files ingested yet</span>'; return; }
    list.innerHTML = docs.map(d => `
      <label class="scope-chip">
        <input type="checkbox" class="scope-cb" value="${esc(d.doc_id)}" data-title="${esc(d.title || d.source)}"/>
        <span>${esc(d.title || d.source)}</span>
        <span class="scope-chunks">${d.chunk_count}</span>
      </label>`).join('');
    list.querySelectorAll('.scope-cb').forEach(cb => cb.addEventListener('change', updateScopeCount));
    updateScopeCount();
  } catch (_) {}
}

function updateScopeCount() {
  const checked = document.querySelectorAll('.scope-cb:checked');
  document.querySelector('#scopeCount').textContent =
    checked.length === 0 ? 'all files' : `${checked.length} file${checked.length > 1 ? 's' : ''} selected`;
}

function selectedDocIds() {
  return [...document.querySelectorAll('.scope-cb:checked')].map(cb => cb.value);
}

document.querySelector('#refreshBtn').onclick = () => refresh().catch(e => showError(e));

/* ── Ingest drawer toggle ── */
document.querySelector('#ingestToggleBtn').onclick = () => {
  const drawer = document.querySelector('#ingestDrawer');
  const open = !drawer.classList.contains('hidden');
  drawer.classList.toggle('hidden', open);
  document.querySelector('#ingestToggleBtn').textContent = open ? '📂 Add Knowledge' : '✕ Close';
};
document.querySelector('#ingestCloseBtn').onclick = () => {
  document.querySelector('#ingestDrawer').classList.add('hidden');
  document.querySelector('#ingestToggleBtn').textContent = '📂 Add Knowledge';
};

/* ── File pick feedback ── */
document.querySelector('#fileInput').onchange = e => {
  const file = e.target.files[0];
  const dropText = document.querySelector('#dropText');
  if (file) {
    const kb = (file.size / 1024).toFixed(1);
    dropText.innerHTML = `✅ <strong>${esc(file.name)}</strong> <span style="color:#6B7280;font-weight:400">(${kb} KB)</span>`;
    document.querySelector('#dropLabel').style.borderColor = '#1e4ed8';
    document.querySelector('#dropLabel').style.background = '#f0f4ff';
  } else {
    dropText.textContent = '📎 Choose PDF, DOCX, HTML, TXT, or Markdown';
    document.querySelector('#dropLabel').style.borderColor = '';
    document.querySelector('#dropLabel').style.background = '';
  }
};

/* ── Ingest ── */
document.querySelector('#ingestBtn').onclick = async () => {
  const file = document.querySelector('#fileInput').files[0];
  const text = document.querySelector('#text').value.trim();
  const title = document.querySelector('#title').value.trim();
  const resultEl = document.querySelector('#ingestResult');
  const btn = document.querySelector('#ingestBtn');

  // ── Validation ──
  if (!file && !text) {
    resultEl.innerHTML = '<span class="error">⚠ Please choose a file or paste some text before ingesting.</span>';
    return;
  }
  if (!file && text.length < 10) {
    resultEl.innerHTML = '<span class="error">⚠ Text is too short — please enter at least 10 characters.</span>';
    return;
  }
  resultEl.innerHTML = '';
  resetSteps([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  if (!state.pipelineOpen) document.querySelector('#pipelineToggle').click();

  btn.disabled = true;
  btn.textContent = '⏳ Uploading…';

  try {
    if (file) {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`${API}/ingest/file/stream`, { method: 'POST', body: fd });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Ingest failed'); }
      const reader = res.body.getReader(); const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.step === 0 && ev.status === 'complete') {
            resultEl.innerHTML = `✅ <strong>${esc(file.name)}</strong> ingested. ${ev.chunks_created} chunks created · ${ev.total} total.`;
            // reset drop zone
            document.querySelector('#fileInput').value = '';
            document.querySelector('#dropText').textContent = '📎 Choose PDF, DOCX, HTML, TXT, or Markdown';
            document.querySelector('#dropLabel').style.borderColor = '';
            document.querySelector('#dropLabel').style.background = '';
            await refresh();
          } else {
            setStep(ev.step, ev.status, ev.detail);
          }
        }
      }
    } else {
      [1, 2, 3, 4, 5].forEach(n => setStep(n, 'active'));
      const data = await api('/ingest/text', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || 'Untitled', source: 'ui-manual-note.txt', text })
      });
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(n => setStep(n, 'done'));
      resultEl.innerHTML = `✅ <strong>Knowledge base updated.</strong> ${data.chunks_created} chunks created.`;
      await refresh();
    }
  } catch (e) {
    resultEl.innerHTML = `<span class="error">⚠ ${esc(e.message)}</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '⬆ Upload & Index Document';
  }
};

/* ── Chat thread rendering ── */
function renderThread() {
  const thread = document.querySelector('#chatThread');
  if (!state.turns.length) {
    thread.innerHTML = '';
    return;
  }
  thread.innerHTML = state.turns.map((turn, i) => {
    const d = turn.data;
    const sourcesHtml = (d.sources || []).length ? `
      <details class="chat-sources">
        <summary>${d.sources.length} source${d.sources.length > 1 ? 's' : ''}</summary>
        ${d.sources.map(s => `
          <div class="source">
            <span class="source-rank">[${s.rank}]</span>
            <div class="source-body">
              <b>${esc(s.metadata?.title || s.metadata?.source || '')}</b>
              <p>${esc(s.text)}</p>
              <small>chunk ${s.metadata?.chunk_index} · distance ${(s.distance ?? 0).toFixed(3)}</small>
            </div>
          </div>`).join('')}
      </details>` : '';
    return `
      <div class="chat-turn" data-turn="${i}">
        <div class="chat-bubble chat-bubble-user">${esc(turn.question)}</div>
        <div class="chat-bubble chat-bubble-ai">
          <div class="answer-meta">
            <span>${esc(d.provider || '')}</span>
            <span>Confidence ${d.confidence != null ? Math.round(d.confidence * 100) : '—'}%</span>
            <span>${d.timing_ms?.total ?? '—'} ms</span>
          </div>
          <div class="chat-answer-body">${renderMarkdown(d.answer)}</div>
          ${sourcesHtml}
        </div>
      </div>`;
  }).join('');
  thread.scrollTop = thread.scrollHeight;
}

function addThinkingBubble(question) {
  const thread = document.querySelector('#chatThread');
  const el = document.createElement('div');
  el.className = 'chat-turn chat-turn-pending';
  el.innerHTML = `
    <div class="chat-bubble chat-bubble-user">${esc(question)}</div>
    <div class="chat-bubble chat-bubble-ai chat-thinking">⋯ Thinking…</div>`;
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
}

/* ── New Chat ── */
async function startNewChat() {
  if (state.sessionId) {
    try { await api(`/sessions/${state.sessionId}`, { method: 'DELETE' }); } catch (_) {}
  }
  state.sessionId = null;
  state.turns = [];
  state.queryResult = null;
  document.querySelector('#question').focus();
}
document.querySelector('#newChatBtn').onclick = startNewChat;

/* ── Query ── */
async function sendQuestion() {
  const q = document.querySelector('#question').value.trim();
  if (!q) return;
  resetSteps([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  if (!state.pipelineOpen) document.querySelector('#pipelineToggle').click();
  document.querySelector('#feedback').classList.add('hidden');
  document.querySelector('#queryBtn').disabled = true;
  document.querySelector('#question').value = '';
  addThinkingBubble(q);

  try {
    const docIds = selectedDocIds();
    setStep(11, 'done', q.slice(0, 60));
    setStep(12, 'active', 'Embedding question…');
    const data = await api('/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, rerank: document.querySelector('#rerank').checked, doc_ids: docIds.length ? docIds : null, session_id: state.sessionId })
    });
    state.sessionId = data.session_id;
    state.queryResult = data;
    state.turns.push({ question: q, data });

    setStep(12, 'done', 'Query vector ready');
    setStep(13, 'done', `${data.sources.length} chunks retrieved · ${data.timing_ms.retrieval} ms`);
    setStep(14, data.sources[0]?.rerank_score != null ? 'done' : 'idle',
      data.sources[0]?.rerank_score != null ? 'Cross-encoder scores applied' : 'Skipped');
    setStep(15, 'done', 'Context assembled');
    setStep(16, 'done', 'Grounded prompt created');
    setStep(17, 'done', `Provider: ${data.provider}`);
    setStep(18, 'done', `Confidence ${(data.confidence * 100).toFixed(0)}% · ${data.timing_ms.total} ms`);
    setStep(19, 'done', `${data.sources.length} citations attached`);
    setStep(20, 'idle', 'Awaiting your feedback…');

    renderThread();
    const fb = document.querySelector('#feedback');
    fb.classList.remove('hidden');
    fb.innerHTML = '<span>Was this answer useful?</span><button data-rating="helpful">👍 Helpful</button><button data-rating="not_helpful">👎 Needs work</button>';
  } catch (e) {
    // remove pending bubble and show error
    document.querySelector('.chat-turn-pending')?.remove();
    const thread = document.querySelector('#chatThread');
    const err = document.createElement('div');
    err.className = 'chat-error';
    err.innerHTML = `⚠ ${esc(e.message)}`;
    thread.appendChild(err);
    thread.scrollTop = thread.scrollHeight;
  } finally {
    document.querySelector('#queryBtn').disabled = false;
    document.querySelector('#question').focus();
  }
}

document.querySelector('#queryBtn').onclick = sendQuestion;
document.querySelector('#question').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendQuestion(); }
});

/* ── Feedback ── */
document.querySelector('#feedback').onclick = async e => {
  if (!e.target.dataset.rating || !state.queryResult) return;
  const lastTurn = state.turns[state.turns.length - 1];
  await api('/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: lastTurn?.question || '', answer: state.queryResult.answer, rating: e.target.dataset.rating })
  });
  setStep(20, 'done', `Feedback: ${e.target.dataset.rating}`);
  e.target.parentElement.innerHTML = '<span>✅ Feedback saved — thank you!</span>';
  refresh();
};

function showError(e, target = null) {
  if (!target) { console.error(e.message); return; }
  const el = document.querySelector(target);
  if (!el) return;
  if (target === '#answer') { el.className = 'answer'; }
  el.innerHTML = `<span class="error">⚠ ${esc(e.message)}</span>`;
}

/* ── History sidebar ── */
let _allHistory = [];

async function loadHistory() {
  try {
    _allHistory = await api('/history?limit=100');
    renderHistory(_allHistory);
  } catch (_) {}
}

function renderHistory(items) {
  const list = document.querySelector('#histList');
  if (!items.length) { list.innerHTML = '<div class="hist-empty">No history yet. Ask a question first.</div>'; return; }
  list.innerHTML = items.map(h => `
    <div class="hist-item" data-id="${esc(h.id)}">
      <div class="hist-item-q">${esc(h.question)}</div>
      <div class="hist-item-meta">
        <span class="hist-conf">${h.confidence != null ? Math.round(h.confidence * 100) + '%' : '—'}</span>
        ${h.feedback ? `<span class="hist-fb hist-fb-${h.feedback}">${h.feedback === 'helpful' ? '👍' : '👎'}</span>` : ''}
        <span class="hist-date">${esc((h.created_at || '').replace('T', ' ').replace('Z', ''))}</span>
        <button class="hist-del" data-id="${esc(h.id)}" title="Delete">✕</button>
      </div>
    </div>`).join('');
}

function openHistory() {
  state.historyOpen = true;
  document.querySelector('#historySidebar').classList.remove('hidden');
  document.querySelector('#histOverlay').classList.remove('hidden');
  loadHistory();
}
function closeHistory() {
  state.historyOpen = false;
  document.querySelector('#historySidebar').classList.add('hidden');
  document.querySelector('#histOverlay').classList.add('hidden');
}

document.querySelector('#historyBtn').onclick = () => state.historyOpen ? closeHistory() : openHistory();
document.querySelector('#historyClose').onclick = closeHistory;
document.querySelector('#histOverlay').onclick = closeHistory;

document.querySelector('#histSearch').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  renderHistory(q ? _allHistory.filter(h => h.question.toLowerCase().includes(q)) : _allHistory);
});

document.querySelector('#histList').addEventListener('click', async e => {
  // delete button
  const delBtn = e.target.closest('.hist-del');
  if (delBtn) {
    const id = delBtn.dataset.id;
    try {
      await api(`/history/${id}`, { method: 'DELETE' });
      _allHistory = _allHistory.filter(h => h.id !== id);
      renderHistory(_allHistory);
    } catch (err) { alert('Delete failed: ' + err.message); }
    return;
  }
  // click on item — restore answer into chat thread
  const item = e.target.closest('.hist-item');
  if (!item) return;
  const id = item.dataset.id;
  const h = _allHistory.find(x => x.id === id);
  if (!h) return;

  // start a fresh visual session with this single restored turn
  state.sessionId = h.session_id || null;
  state.turns = [{ question: h.question, data: h }];
  state.queryResult = h;
  renderThread();
  const fb = document.querySelector('#feedback');
  fb.classList.remove('hidden');
  fb.innerHTML = '<span>Was this answer useful?</span><button data-rating="helpful">👍 Helpful</button><button data-rating="not_helpful">👎 Needs work</button>';
  closeHistory();
});

refresh().catch(e => showError(e));
