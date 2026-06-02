let checklist = [];
let sigPad = null;
let activeItemId = null;
let selectedEmpFile = null;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ===== Tabs =====
function showTab(tab) {
  ['checklist', 'documents'].forEach(t => {
    document.getElementById(`view-${t}`).classList.toggle('hidden', t !== tab);
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'documents') loadDocuments();
}

// ===== Init =====
async function init() {
  const me = await apiFetch('/api/me');
  if (!me) return;
  document.getElementById('headerSub').textContent = me.full_name;
  await loadChecklist();
}

// ===== Checklist =====
async function loadChecklist() {
  const items = await apiFetch('/api/employee/checklist');
  if (!items) return;
  checklist = items;

  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('progressCard').classList.remove('hidden');

  const done = items.filter(i => i.progress?.completed_at).length;
  const total = items.length;
  document.getElementById('progressFraction').textContent = `${done}/${total}`;
  document.getElementById('progressFill').style.width = total ? `${Math.round(done / total * 100)}%` : '0%';

  if (done === total && total > 0) {
    document.getElementById('completionBanner').classList.remove('hidden');
  } else {
    document.getElementById('completionBanner').classList.add('hidden');
  }

  renderChecklist(items);
}

function renderChecklist(items) {
  const container = document.getElementById('checklistContainer');
  container.innerHTML = '';
  items.forEach(item => {
    const done = !!item.progress?.completed_at;
    const el = document.createElement('div');
    el.className = 'checklist-item' + (done ? ' completed' : '');

    const dateStr = done
      ? new Date(item.progress.completed_at + 'Z').toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
      : '';

    el.innerHTML = `
      <div class="checklist-item-header">
        <div class="status-icon">${done ? '✓' : ''}</div>
        <div style="flex:1;min-width:0;">
          <div class="item-title">${escHtml(item.title)}</div>
          ${item.description ? `<div class="item-desc">${escHtml(item.description)}</div>` : ''}
        </div>
        ${!done ? `<button class="btn btn-secondary btn-sm" onclick="openSignModal(${item.id})">Abhaken</button>` : ''}
      </div>
      ${done ? `
        <div class="item-meta">
          <span class="meta-badge">✓ ${dateStr}</span>
          <span class="meta-badge">👤 ${escHtml(item.progress.countersigned_by)}</span>
          ${item.progress.signature_data_url ? `<span class="sig-preview"><img src="${item.progress.signature_data_url}" alt="Unterschrift"></span>` : ''}
        </div>` : ''}`;
    container.appendChild(el);
  });
}

// ===== Sign modal =====
function openSignModal(itemId) {
  activeItemId = itemId;
  const item = checklist.find(i => i.id === itemId);
  document.getElementById('signItemTitle').textContent = item?.title || '';
  document.getElementById('supervisorName').value = '';
  document.getElementById('signError').classList.add('hidden');
  document.getElementById('signModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  setTimeout(() => {
    const canvas = document.getElementById('sigCanvas');
    const wrap = canvas.parentElement;
    canvas.width = wrap.clientWidth;
    canvas.height = 180;
    if (sigPad) sigPad.off();
    sigPad = new SignaturePad(canvas, { penColor: '#000000' });
    sigPad.addEventListener('beginStroke', () => {
      document.getElementById('sigHint').style.display = 'none';
    });
  }, 50);
}

function closeSignModal() {
  document.getElementById('signModal').classList.add('hidden');
  document.body.style.overflow = '';
  activeItemId = null;
  if (sigPad) { sigPad.off(); sigPad = null; }
}

function clearSig() {
  if (sigPad) { sigPad.clear(); document.getElementById('sigHint').style.display = ''; }
}

async function confirmSign() {
  const errEl = document.getElementById('signError');
  errEl.classList.add('hidden');
  const name = document.getElementById('supervisorName').value.trim();
  if (!name) { errEl.textContent = 'Bitte den Namen des Vorgesetzten eintragen.'; errEl.classList.remove('hidden'); return; }
  if (!sigPad || sigPad.isEmpty()) { errEl.textContent = 'Bitte eine Unterschrift zeichnen.'; errEl.classList.remove('hidden'); return; }

  const sigDataUrl = sigPad.toDataURL('image/png');
  const btn = document.getElementById('confirmSignBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  const res = await fetch(`/api/employee/checklist/${activeItemId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ countersigned_by: name, signature_data_url: sigDataUrl })
  });

  btn.disabled = false;
  btn.textContent = 'Bestätigen';

  if (res.ok) { closeSignModal(); await loadChecklist(); }
  else { const d = await res.json(); errEl.textContent = d.error || 'Fehler.'; errEl.classList.remove('hidden'); }
}

// ===== PDF =====
async function downloadPDF(event) {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Wird erstellt…';
  try {
    const res = await fetch('/api/employee/report/pdf');
    if (!res.ok) { const d = await res.json(); alert(d.error || 'PDF-Fehler'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'onboarding-report.pdf'; a.click();
    URL.revokeObjectURL(url);
  } finally {
    btn.disabled = false;
    btn.textContent = 'PDF herunterladen';
  }
}

// ===== Documents =====
async function loadDocuments() {
  const [docsRes, uploadsRes] = await Promise.all([
    fetch('/api/documents').then(r => r.json()),
    fetch('/api/employee/uploads').then(r => r.json())
  ]);

  renderAdminDocs(docsRes);
  renderMyUploads(uploadsRes);
}

function renderAdminDocs(data) {
  const container = document.getElementById('adminDocsContainer');
  const { folders, documents } = data;

  if (folders.length === 0 && documents.length === 0) {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:#888;font-size:14px;">Noch keine Dokumente verfügbar.</div>';
    return;
  }

  container.innerHTML = '';

  const renderFolder = (folder) => {
    const children = folders.filter(f => f.parent_id === folder.id);
    const docs = documents.filter(d => d.folder_id === folder.id);

    const section = document.createElement('div');
    section.className = 'folder-section';
    section.style.borderBottom = '1px solid var(--gray-mid)';
    section.style.padding = '0 16px';

    const label = document.createElement('div');
    label.className = 'folder-label';
    label.innerHTML = `<span>📁</span><span>${escHtml(folder.name)}</span>`;

    const content = document.createElement('div');
    content.style.paddingLeft = '12px';
    let collapsed = false;
    label.addEventListener('click', () => {
      collapsed = !collapsed;
      content.style.display = collapsed ? 'none' : '';
      label.querySelector('span').textContent = collapsed ? '📁' : '📂';
    });

    children.forEach(child => content.appendChild(renderFolder(child)));
    docs.forEach(doc => content.appendChild(renderDocRow(doc)));

    if (children.length === 0 && docs.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px 0 12px;font-size:13px;color:#aaa;';
      empty.textContent = 'Leer';
      content.appendChild(empty);
    }

    section.appendChild(label);
    section.appendChild(content);
    return section;
  };

  const renderDocRow = (doc) => {
    const el = document.createElement('div');
    el.className = 'doc-row';
    const date = new Date(doc.uploaded_at + 'Z').toLocaleDateString('de-DE');
    el.innerHTML = `
      <span class="doc-row-icon">📄</span>
      <span class="doc-row-name" title="${escHtml(doc.original_name)}">${escHtml(doc.original_name)}</span>
      <span class="doc-row-date">${date}</span>
      <a href="/api/documents/${doc.id}/download" class="btn btn-secondary btn-sm">⬇</a>`;
    return el;
  };

  // Root folders
  folders.filter(f => !f.parent_id).forEach(f => container.appendChild(renderFolder(f)));

  // Root docs
  documents.filter(d => !d.folder_id).forEach(doc => container.appendChild(renderDocRow(doc)));
}

function renderMyUploads(uploads) {
  const container = document.getElementById('myUploadsContainer');
  if (!uploads.length) {
    container.innerHTML = '<div style="padding:16px;text-align:center;color:#888;font-size:14px;">Noch keine Uploads.</div>';
    return;
  }
  container.innerHTML = uploads.map(u => `
    <div class="doc-row">
      <span class="doc-row-icon">📄</span>
      <span class="doc-row-name">${escHtml(u.original_name)}</span>
      <span class="doc-row-date">${new Date(u.uploaded_at + 'Z').toLocaleDateString('de-DE')}</span>
      <a href="/api/employee/uploads/${u.id}/download" class="btn btn-secondary btn-sm">⬇</a>
      <button class="btn btn-danger btn-sm" onclick="deleteMyUpload(${u.id})">🗑</button>
    </div>`).join('');
}

// Employee file upload
function onEmpFileSelected(input) {
  selectedEmpFile = input.files[0];
  document.getElementById('empFileName').textContent = selectedEmpFile ? selectedEmpFile.name : '';
  document.getElementById('empUploadBtn').disabled = !selectedEmpFile;
}

async function uploadEmpFile() {
  const errEl = document.getElementById('empUploadError');
  errEl.classList.add('hidden');
  if (!selectedEmpFile) return;

  const btn = document.getElementById('empUploadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  const formData = new FormData();
  formData.append('file', selectedEmpFile);

  const res = await fetch('/api/employee/uploads', { method: 'POST', body: formData });
  btn.disabled = false;
  btn.textContent = 'Hochladen';

  if (res.ok) {
    selectedEmpFile = null;
    document.getElementById('empFileName').textContent = '';
    document.getElementById('empFileInput').value = '';
    document.getElementById('empUploadBtn').disabled = true;
    loadDocuments();
  } else {
    const d = await res.json();
    errEl.textContent = d.error || 'Upload fehlgeschlagen.';
    errEl.classList.remove('hidden');
  }
}

async function deleteMyUpload(id) {
  if (!confirm('Upload wirklich löschen?')) return;
  const res = await fetch(`/api/employee/uploads/${id}`, { method: 'DELETE' });
  if (res.ok) loadDocuments();
}

// Drag & drop upload zone
const empUploadZone = document.getElementById('empUploadZone');
empUploadZone.addEventListener('dragover', e => { e.preventDefault(); empUploadZone.classList.add('dragover'); });
empUploadZone.addEventListener('dragleave', () => empUploadZone.classList.remove('dragover'));
empUploadZone.addEventListener('drop', e => {
  e.preventDefault();
  empUploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) {
    selectedEmpFile = file;
    document.getElementById('empFileName').textContent = file.name;
    document.getElementById('empUploadBtn').disabled = false;
  }
});

// ===== Helpers =====
async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

async function apiFetch(url) {
  const res = await fetch(url);
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  return res.json();
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.getElementById('signModal').addEventListener('click', e => {
  if (e.target === document.getElementById('signModal')) closeSignModal();
});

init();
