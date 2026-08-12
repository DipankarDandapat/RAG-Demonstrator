import './style.css';

const API = localStorage.getItem('qa_rag_api') || 'http://localhost:8000/api';
const PAGE_SIZE = 10;

const kbState = {
  all: [],       // full list from API
  filtered: [],  // after search filter
  page: 1,
};

document.querySelector('#kb-app').innerHTML = `
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
      <div id="health" class="status-pill offline">Checking backend…</div>
      <a href="/" class="btn-ghost">← Back to Home</a>
    </div>
  </div>

  <!-- Page header -->
  <div class="kb-page-header">
    <div>
      <h2 class="kb-page-title">📚 Knowledge Base</h2>
      <p class="kb-page-sub">Manage ingested documents. Delete a document to remove all its chunks from the vector store.</p>
    </div>
    <div id="kbSummary" class="kb-summary"></div>
  </div>

  <!-- Toolbar: search + filter -->
  <div class="kb-toolbar">
    <div class="kb-search-wrap">
      <span class="kb-search-icon">🔎</span>
      <input id="kbSearch" class="kb-search" type="text" placeholder="Search by title, source, or file type…"/>
    </div>
    <select id="kbTypeFilter" class="kb-filter-select">
      <option value="">All types</option>
    </select>
    <button id="kbRefreshBtn" class="btn-ghost">↻ Refresh</button>
  </div>

  <!-- Table -->
  <div class="kb-table-wrap">
    <table class="kb-table">
      <thead>
        <tr>
          <th class="col-num">#</th>
          <th class="col-title sortable" data-col="title">Title <span class="sort-icon">↕</span></th>
          <th class="col-source">Source file</th>
          <th class="col-type sortable" data-col="file_type">Type <span class="sort-icon">↕</span></th>
          <th class="col-date sortable" data-col="ingested_at">Ingested <span class="sort-icon">↕</span></th>
          <th class="col-chunks sortable" data-col="chunk_count">Chunks <span class="sort-icon">↕</span></th>
          <th class="col-action">Action</th>
        </tr>
      </thead>
      <tbody id="kbTbody"></tbody>
    </table>
    <div id="kbEmpty" class="kb-empty hidden">No documents found.</div>
    <div id="kbLoading" class="kb-loading">Loading…</div>
  </div>

  <!-- Pagination -->
  <div class="kb-pagination" id="kbPagination"></div>

</main>

<!-- Custom confirm dialog -->
<div id="kbConfirm" class="kbc-overlay hidden">
  <div class="kbc-box">
    <div class="kbc-icon">⚠️</div>
    <div class="kbc-title" id="kbConfirmTitle"></div>
    <div class="kbc-msg" id="kbConfirmMsg"></div>
    <div class="kbc-actions">
      <button id="kbConfirmCancel" class="kbc-btn-cancel">Cancel</button>
      <button id="kbConfirmOk" class="kbc-btn-ok"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right:5px;vertical-align:middle"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Delete</button>
    </div>
  </div>
</div>

<!-- Toast -->
<div id="kbToast" class="kb-toast hidden"></div>`;

/* ── Utilities ── */
async function api(path, options = {}) {
  const r = await fetch(`${API}${path}`, options);
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail || 'Request failed');
  return data;
}
function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── Sort state ── */
let sortCol = 'ingested_at', sortDir = -1; // default: newest first

function applyFilterAndSort() {
  const q = document.querySelector('#kbSearch').value.trim().toLowerCase();
  const type = document.querySelector('#kbTypeFilter').value;
  kbState.filtered = kbState.all.filter(d => {
    const matchQ = !q || d.title.toLowerCase().includes(q) || d.source.toLowerCase().includes(q) || d.file_type.toLowerCase().includes(q);
    const matchType = !type || d.file_type === type;
    return matchQ && matchType;
  });
  kbState.filtered.sort((a, b) => {
    const av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
    return av < bv ? -sortDir : av > bv ? sortDir : 0;
  });
  kbState.page = 1;
  render();
}

function render() {
  const tbody = document.querySelector('#kbTbody');
  const empty = document.querySelector('#kbEmpty');
  const loading = document.querySelector('#kbLoading');
  loading.classList.add('hidden');

  if (!kbState.filtered.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    document.querySelector('#kbPagination').innerHTML = '';
    return;
  }
  empty.classList.add('hidden');

  const total = kbState.filtered.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  kbState.page = Math.min(kbState.page, totalPages);
  const start = (kbState.page - 1) * PAGE_SIZE;
  const page = kbState.filtered.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = page.map((d, i) => `
    <tr id="row-${esc(d.doc_id)}">
      <td class="col-num td-muted">${start + i + 1}</td>
      <td class="col-title"><span class="td-title">${esc(d.title)}</span></td>
      <td class="col-source td-source" title="${esc(d.source)}">${esc(d.source)}</td>
      <td class="col-type"><span class="type-badge type-${esc(d.file_type)}">${esc(d.file_type)}</span></td>
      <td class="col-date td-date">${esc(d.ingested_at.replace('T', ' ').replace('Z', ''))}</td>
      <td class="col-chunks"><span class="chunk-badge">${d.chunk_count}</span></td>
      <td class="col-action">
        <button class="btn-delete"
          data-docid="${esc(d.doc_id)}"
          data-source="${d.source.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"
          data-chunks="${d.chunk_count}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </td>
    </tr>`).join('');

  renderPagination(totalPages);
  updateSummary(total);
}

function renderPagination(totalPages) {
  const pg = document.querySelector('#kbPagination');
  if (totalPages <= 1) { pg.innerHTML = ''; return; }
  const cur = kbState.page;
  let html = `<button class="pg-btn" data-p="${cur - 1}" ${cur === 1 ? 'disabled' : ''}>‹ Prev</button>`;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - cur) <= 1) {
      html += `<button class="pg-btn ${p === cur ? 'pg-active' : ''}" data-p="${p}">${p}</button>`;
    } else if (Math.abs(p - cur) === 2) {
      html += `<span class="pg-ellipsis">…</span>`;
    }
  }
  html += `<button class="pg-btn" data-p="${cur + 1}" ${cur === totalPages ? 'disabled' : ''}>Next ›</button>`;
  html += `<span class="pg-info">${(cur - 1) * PAGE_SIZE + 1}–${Math.min(cur * PAGE_SIZE, kbState.filtered.length)} of ${kbState.filtered.length}</span>`;
  pg.innerHTML = html;
}

function updateSummary(filtered) {
  const total = kbState.all.length;
  const totalChunks = kbState.all.reduce((s, d) => s + d.chunk_count, 0);
  document.querySelector('#kbSummary').innerHTML =
    `<span class="kb-stat">${total} document${total !== 1 ? 's' : ''}</span>` +
    `<span class="kb-stat">${totalChunks} total chunks</span>` +
    (filtered !== total ? `<span class="kb-stat kb-stat-filter">${filtered} matching filter</span>` : '');
}

function populateTypeFilter() {
  const types = [...new Set(kbState.all.map(d => d.file_type).filter(Boolean))].sort();
  const sel = document.querySelector('#kbTypeFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All types</option>' +
    types.map(t => `<option value="${esc(t)}" ${t === cur ? 'selected' : ''}>${esc(t)}</option>`).join('');
}

/* ── Load data ── */
async function loadDocs() {
  document.querySelector('#kbLoading').classList.remove('hidden');
  document.querySelector('#kbEmpty').classList.add('hidden');
  document.querySelector('#kbTbody').innerHTML = '';
  document.querySelector('#kbPagination').innerHTML = '';
  try {
    const [docs, health] = await Promise.all([api('/documents'), api('/health')]);
    kbState.all = docs;
    populateTypeFilter();
    applyFilterAndSort();
    const pill = document.querySelector('#health');
    pill.textContent = `● Online · ${health.documents} chunks`;
    pill.className = 'status-pill';
  } catch (e) {
    document.querySelector('#kbLoading').classList.add('hidden');
    document.querySelector('#kbEmpty').textContent = '⚠ ' + e.message;
    document.querySelector('#kbEmpty').classList.remove('hidden');
  }
}

/* ── Sort headers ── */
document.querySelectorAll('.sortable').forEach(th => {
  th.style.cursor = 'pointer';
  th.onclick = () => {
    const col = th.dataset.col;
    if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = 1; }
    document.querySelectorAll('.sort-icon').forEach(ic => ic.textContent = '↕');
    th.querySelector('.sort-icon').textContent = sortDir === 1 ? '↑' : '↓';
    applyFilterAndSort();
  };
});

/* ── Search & filter ── */
document.querySelector('#kbSearch').addEventListener('input', applyFilterAndSort);
document.querySelector('#kbTypeFilter').addEventListener('change', applyFilterAndSort);
document.querySelector('#kbRefreshBtn').onclick = loadDocs;

/* ── Pagination clicks ── */
document.querySelector('#kbPagination').addEventListener('click', e => {
  const btn = e.target.closest('.pg-btn');
  if (!btn || btn.disabled) return;
  kbState.page = parseInt(btn.dataset.p);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ── Custom confirm dialog ── */
function showConfirm({ title, message, onConfirm }) {
  document.querySelector('#kbConfirmTitle').textContent = title;
  document.querySelector('#kbConfirmMsg').textContent = message;
  const dialog = document.querySelector('#kbConfirm');
  dialog.classList.remove('hidden');
  const confirmBtn = document.querySelector('#kbConfirmOk');
  const cancelBtn = document.querySelector('#kbConfirmCancel');
  function cleanup() {
    dialog.classList.add('hidden');
    confirmBtn.replaceWith(confirmBtn.cloneNode(true));
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
  }
  document.querySelector('#kbConfirmOk').onclick = () => { cleanup(); onConfirm(); };
  document.querySelector('#kbConfirmCancel').onclick = () => cleanup();
}

function showToast(message, type = 'error') {
  const t = document.querySelector('#kbToast');
  t.textContent = message;
  t.className = `kb-toast kb-toast-${type}`;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3500);
}

/* ── Delete ── */
document.querySelector('#kbTbody').addEventListener('click', async e => {
  const btn = e.target.closest('.btn-delete');
  if (!btn) return;
  const { docid, source, chunks } = btn.dataset;
  showConfirm({
    title: 'Delete document',
    message: `Delete all ${chunks} chunk(s) from "${source}"? This cannot be undone.`,
    onConfirm: async () => {
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      try {
        await api(`/documents/${encodeURIComponent(docid)}`, { method: 'DELETE' });
        kbState.all = kbState.all.filter(d => d.doc_id !== docid);
        populateTypeFilter();
        applyFilterAndSort();
        showToast(`Deleted "${source}" successfully.`, 'success');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '🗑 Delete';
        showToast('Delete failed: ' + err.message, 'error');
      }
    }
  });
});

loadDocs();
