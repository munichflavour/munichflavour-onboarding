let editingItemId = null;
let checklistItems = [];
let docData = { folders: [], documents: [] };
let editingFolderId = null;
let uploadParentFolderId = null;
let selectedAdminFile = null;

// ===== Navigation =====
function showTab(tab) {
  ['employees', 'checklist', 'documents'].forEach(t => {
    document.getElementById(`view-${t}`).classList.toggle('hidden', t !== tab);
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'checklist') loadChecklistEditor();
  if (tab === 'employees') loadEmployees();
  if (tab === 'documents') loadDocuments();
}

// ===== Auth =====
async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401 || res.status === 403) { window.location.href = '/login.html'; return null; }
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : {};
  return { ok: res.ok, status: res.status, data };
}

// ===== Employee list =====
async function loadEmployees() {
  const r = await apiFetch('/api/admin/employees');
  if (!r) return;
  document.getElementById('empLoading').classList.add('hidden');
  const list = document.getElementById('employeeList');

  if (!r.data.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:#888;font-size:14px;">Noch keine Mitarbeiter angelegt.</div>';
    return;
  }

  list.innerHTML = r.data.map(emp => {
    const pct = emp.total ? Math.round(emp.completed / emp.total * 100) : 0;
    const initials = emp.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `
      <div class="employee-row">
        <div class="employee-avatar" onclick="showEmployeeDetail(${emp.id})" style="cursor:pointer;">${escHtml(initials)}</div>
        <div class="employee-info" onclick="showEmployeeDetail(${emp.id})" style="cursor:pointer;">
          <div class="employee-name">${escHtml(emp.full_name)}</div>
          <div class="employee-username">@${escHtml(emp.username)}${emp.start_date ? ' · Start: ' + fmtDate(emp.start_date) : ''}</div>
        </div>
        <div class="employee-progress" onclick="showEmployeeDetail(${emp.id})" style="cursor:pointer;">
          <div class="progress-fraction">${emp.completed}/${emp.total}</div>
          <div class="progress-bar-wrap progress-mini-bar" style="margin-top:4px;">
            <div class="progress-bar-fill" style="width:${pct}%"></div>
          </div>
        </div>
        <button class="btn btn-danger btn-sm" style="flex-shrink:0;" onclick="deleteEmployee(${emp.id},'${escHtml(emp.full_name)}')">🗑</button>
      </div>`;
  }).join('');
}

async function deleteEmployee(id, name) {
  if (!confirm(`Mitarbeiter "${name}" wirklich löschen?\n\nAlle Daten und Uploads werden unwiderruflich gelöscht.`)) return;
  const r = await apiFetch(`/api/admin/employees/${id}`, { method: 'DELETE' });
  if (r?.ok) loadEmployees();
  else alert(r?.data?.error || 'Fehler beim Löschen');
}

// ===== Employee detail =====
async function showEmployeeDetail(id) {
  document.getElementById('empListView').classList.add('hidden');
  document.getElementById('empDetailView').classList.remove('hidden');
  document.getElementById('empDetailContent').innerHTML = '<div style="padding:40px;text-align:center;"><span class="spinner" style="border-color:rgba(0,0,0,0.2);border-top-color:#000;"></span></div>';

  const [r, ru] = await Promise.all([
    apiFetch(`/api/admin/employees/${id}`),
    apiFetch(`/api/admin/employees/${id}/uploads`)
  ]);
  if (!r) return;
  const { user, checklist } = r.data;
  const uploads = ru?.data || [];
  const done = checklist.filter(i => i.progress?.completed_at).length;

  let html = `
    <div class="card" style="margin-bottom:16px;">
      <div style="font-size:18px;font-weight:700;margin-bottom:4px;">${escHtml(user.full_name)}</div>
      <div style="font-size:13px;color:#666;">@${escHtml(user.username)}${user.start_date ? ' · Startdatum: ' + fmtDate(user.start_date) : ''}</div>
      <div style="margin-top:12px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:13px;font-weight:600;">Fortschritt</span>
          <span style="font-size:13px;font-weight:700;">${done}/${checklist.length}</span>
        </div>
        <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${checklist.length ? Math.round(done/checklist.length*100) : 0}%"></div></div>
      </div>
    </div>

    <div class="section-title">Onboarding-Aufgaben</div>`;

  checklist.forEach(item => {
    const p = item.progress;
    const isDone = !!p?.completed_at;
    html += `
      <div class="admin-checklist-item ${isDone ? 'done' : ''}">
        <div class="admin-item-header">
          <div class="status-icon">${isDone ? '✓' : ''}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:15px;">${escHtml(item.title)}</div>
            ${item.description ? `<div style="font-size:13px;color:#666;margin-top:2px;">${escHtml(item.description)}</div>` : ''}
          </div>
        </div>
        ${isDone ? `
        <div class="admin-item-details">
          <span>✓ ${new Date(p.completed_at + 'Z').toLocaleString('de-DE', {dateStyle:'short',timeStyle:'short'})}</span>
          <span>👤 ${escHtml(p.countersigned_by)}</span>
          ${p.signature_data_url ? `<span class="sig-thumb"><img src="${p.signature_data_url}" alt="Unterschrift"></span>` : ''}
        </div>` : ''}
      </div>`;
  });

  if (uploads.length > 0) {
    html += `<div class="section-title" style="margin-top:20px;">Hochgeladene Dokumente (${uploads.length})</div>
    <div class="card" style="padding:0;overflow:hidden;">`;
    uploads.forEach(u => {
      html += `
        <div class="employee-row" style="cursor:default;">
          <div style="font-size:20px;">📄</div>
          <div class="employee-info">
            <div class="employee-name">${escHtml(u.original_name)}</div>
            <div class="employee-username">${new Date(u.uploaded_at + 'Z').toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'})}</div>
          </div>
          <a href="/api/admin/uploads/${u.id}/download" class="btn btn-secondary btn-sm">⬇ Download</a>
        </div>`;
    });
    html += '</div>';
  }

  document.getElementById('empDetailContent').innerHTML = html;
}

function showEmployeeList() {
  document.getElementById('empDetailView').classList.add('hidden');
  document.getElementById('empListView').classList.remove('hidden');
}

// ===== New employee modal =====
function openNewEmployeeModal() {
  ['newName','newUsername','newPassword'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('newStartDate').value = '';
  document.getElementById('newEmpError').classList.add('hidden');
  document.getElementById('newEmpModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeNewEmployeeModal() {
  document.getElementById('newEmpModal').classList.add('hidden');
  document.body.style.overflow = '';
}
async function createEmployee() {
  const errEl = document.getElementById('newEmpError');
  errEl.classList.add('hidden');
  const body = {
    full_name: document.getElementById('newName').value.trim(),
    username: document.getElementById('newUsername').value.trim(),
    password: document.getElementById('newPassword').value,
    start_date: document.getElementById('newStartDate').value || null
  };
  if (!body.full_name || !body.username || !body.password) {
    errEl.textContent = 'Bitte alle Pflichtfelder ausfüllen.';
    errEl.classList.remove('hidden');
    return;
  }
  const r = await apiFetch('/api/admin/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r) return;
  if (!r.ok) { errEl.textContent = r.data.error || 'Fehler'; errEl.classList.remove('hidden'); return; }
  closeNewEmployeeModal();
  loadEmployees();
}

// ===== Checklist editor =====
async function loadChecklistEditor() {
  const r = await apiFetch('/api/admin/checklist');
  if (!r) return;
  checklistItems = r.data;
  renderEditor();
}

function renderEditor() {
  const container = document.getElementById('checklistEditorList');
  container.innerHTML = '';
  checklistItems.forEach(item => {
    const el = document.createElement('div');
    el.className = 'editor-item';
    el.dataset.id = item.id;
    el.draggable = true;
    el.innerHTML = `
      <div class="drag-handle">⠿</div>
      <div class="editor-item-content">
        <div class="editor-item-title">${escHtml(item.title)}</div>
        ${item.description ? `<div class="editor-item-desc">${escHtml(item.description)}</div>` : ''}
      </div>
      <div class="editor-item-actions">
        <button class="btn btn-secondary btn-sm" onclick="openItemModal(${item.id})">Bearbeiten</button>
        <button class="btn btn-danger btn-sm" onclick="deleteItem(${item.id})">✕</button>
      </div>`;
    container.appendChild(el);
  });
  initDragSort(container);
}

function initDragSort(container) {
  let dragging = null;
  container.querySelectorAll('.editor-item').forEach(el => {
    el.addEventListener('dragstart', () => { dragging = el; setTimeout(() => el.style.opacity = '0.4', 0); });
    el.addEventListener('dragend', () => { el.style.opacity = ''; dragging = null; saveOrder(); });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      if (!dragging || dragging === el) return;
      const after = e.clientY > el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2;
      container.insertBefore(dragging, after ? el.nextSibling : el);
    });
  });
}

async function saveOrder() {
  const ids = [...document.querySelectorAll('.editor-item')].map(el => Number(el.dataset.id));
  await apiFetch('/api/admin/checklist/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
}

function openItemModal(id) {
  editingItemId = id || null;
  document.getElementById('itemModalTitle').textContent = id ? 'Aufgabe bearbeiten' : 'Aufgabe hinzufügen';
  document.getElementById('itemError').classList.add('hidden');
  if (id) {
    const item = checklistItems.find(i => i.id === id);
    document.getElementById('itemTitle').value = item?.title || '';
    document.getElementById('itemDesc').value = item?.description || '';
  } else {
    document.getElementById('itemTitle').value = '';
    document.getElementById('itemDesc').value = '';
  }
  document.getElementById('itemModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeItemModal() {
  document.getElementById('itemModal').classList.add('hidden');
  document.body.style.overflow = '';
  editingItemId = null;
}
async function saveItem() {
  const errEl = document.getElementById('itemError');
  errEl.classList.add('hidden');
  const title = document.getElementById('itemTitle').value.trim();
  const description = document.getElementById('itemDesc').value.trim();
  if (!title) { errEl.textContent = 'Titel ist erforderlich.'; errEl.classList.remove('hidden'); return; }
  let r;
  if (editingItemId) {
    const item = checklistItems.find(i => i.id === editingItemId);
    r = await apiFetch(`/api/admin/checklist/${editingItemId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, description, order_index: item?.order_index || 0 }) });
  } else {
    r = await apiFetch('/api/admin/checklist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, description }) });
  }
  if (!r || !r.ok) { errEl.textContent = r?.data?.error || 'Fehler'; errEl.classList.remove('hidden'); return; }
  closeItemModal();
  loadChecklistEditor();
}
async function deleteItem(id) {
  const item = checklistItems.find(i => i.id === id);
  if (!confirm(`Aufgabe "${item?.title}" wirklich löschen?`)) return;
  await apiFetch(`/api/admin/checklist/${id}`, { method: 'DELETE' });
  loadChecklistEditor();
}

// ===== DOCUMENTS =====
async function loadDocuments() {
  const r = await apiFetch('/api/documents');
  if (!r) return;
  docData = r.data;
  renderDocTree();
}

function renderDocTree() {
  const container = document.getElementById('docTree');
  container.innerHTML = '';

  // Build tree from flat list
  const rootFolders = docData.folders.filter(f => !f.parent_id);
  const rootDocs = docData.documents.filter(d => !d.folder_id);

  rootFolders.forEach(folder => {
    container.appendChild(renderFolder(folder, 0));
  });

  // Root-level documents
  if (rootDocs.length > 0) {
    const section = document.createElement('div');
    section.className = 'root-docs';
    if (rootFolders.length > 0) {
      const label = document.createElement('div');
      label.className = 'section-title';
      label.style.marginTop = '16px';
      label.textContent = 'Ohne Ordner';
      section.appendChild(label);
    }
    rootDocs.forEach(doc => section.appendChild(renderDocItem(doc)));
    container.appendChild(section);
  }

  if (rootFolders.length === 0 && rootDocs.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#888;font-size:14px;">Noch keine Dokumente. Erstelle einen Ordner oder lade eine Datei hoch.</div>';
  }
}

function renderFolder(folder, depth) {
  const children = docData.folders.filter(f => f.parent_id === folder.id);
  const docs = docData.documents.filter(d => d.folder_id === folder.id);

  const node = document.createElement('div');
  node.className = 'folder-node';

  const header = document.createElement('div');
  header.className = 'folder-header';
  header.innerHTML = `
    <span class="folder-icon">📁</span>
    <span class="folder-name">${escHtml(folder.name)}</span>
    <div class="folder-actions" onclick="event.stopPropagation()">
      <button class="btn btn-secondary btn-sm" onclick="openFolderModal(${folder.parent_id || 'null'}, ${folder.id})">✏️</button>
      <button class="btn btn-secondary btn-sm" onclick="openFolderModal(${folder.id})">+ Unterordner</button>
      <button class="btn btn-primary btn-sm" onclick="openUploadModal(${folder.id})">+ Datei</button>
      <button class="btn btn-danger btn-sm" onclick="deleteFolder(${folder.id}, '${escHtml(folder.name)}')">🗑</button>
    </div>`;

  // Toggle collapse
  let collapsed = false;
  const childrenEl = document.createElement('div');
  childrenEl.className = 'folder-children';
  children.forEach(child => childrenEl.appendChild(renderFolder(child, depth + 1)));
  docs.forEach(doc => childrenEl.appendChild(renderDocItem(doc)));

  header.addEventListener('click', () => {
    collapsed = !collapsed;
    childrenEl.style.display = collapsed ? 'none' : '';
    header.querySelector('.folder-icon').textContent = collapsed ? '📁' : '📂';
  });

  node.appendChild(header);
  node.appendChild(childrenEl);
  return node;
}

function renderDocItem(doc) {
  const el = document.createElement('div');
  el.className = 'doc-item';
  const date = new Date(doc.uploaded_at + 'Z').toLocaleDateString('de-DE');
  el.innerHTML = `
    <span class="doc-icon">📄</span>
    <span class="doc-name" title="${escHtml(doc.original_name)}">${escHtml(doc.original_name)}</span>
    ${doc.description ? `<span style="font-size:12px;color:#888;">${escHtml(doc.description)}</span>` : ''}
    <span class="doc-date">${date}</span>
    <a href="/api/documents/${doc.id}/download" class="btn btn-secondary btn-sm">⬇</a>
    <button class="btn btn-danger btn-sm" onclick="deleteDocument(${doc.id}, '${escHtml(doc.original_name)}')">🗑</button>`;
  return el;
}

// Folder modal
function openFolderModal(parentId, editId) {
  editingFolderId = editId || null;
  uploadParentFolderId = parentId;
  document.getElementById('folderModalTitle').textContent = editId ? 'Ordner umbenennen' : 'Neuer Ordner';
  document.getElementById('folderError').classList.add('hidden');
  if (editId) {
    const f = docData.folders.find(f => f.id === editId);
    document.getElementById('folderName').value = f?.name || '';
  } else {
    document.getElementById('folderName').value = '';
  }
  document.getElementById('folderModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('folderName').focus(), 100);
}
function closeFolderModal() {
  document.getElementById('folderModal').classList.add('hidden');
  document.body.style.overflow = '';
  editingFolderId = null;
}
async function saveFolder() {
  const errEl = document.getElementById('folderError');
  errEl.classList.add('hidden');
  const name = document.getElementById('folderName').value.trim();
  if (!name) { errEl.textContent = 'Name ist erforderlich.'; errEl.classList.remove('hidden'); return; }
  let r;
  if (editingFolderId) {
    r = await apiFetch(`/api/admin/folders/${editingFolderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  } else {
    r = await apiFetch('/api/admin/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parent_id: uploadParentFolderId }) });
  }
  if (!r || !r.ok) { errEl.textContent = r?.data?.error || 'Fehler'; errEl.classList.remove('hidden'); return; }
  closeFolderModal();
  loadDocuments();
}
async function deleteFolder(id, name) {
  if (!confirm(`Ordner "${name}" und alle enthaltenen Dokumente wirklich löschen?`)) return;
  const r = await apiFetch(`/api/admin/folders/${id}`, { method: 'DELETE' });
  if (r?.ok) loadDocuments();
}

// Upload modal
function openUploadModal(folderId) {
  uploadParentFolderId = folderId;
  selectedAdminFile = null;
  document.getElementById('adminFileName').textContent = '';
  document.getElementById('adminFileInput').value = '';
  document.getElementById('uploadDesc').value = '';
  document.getElementById('uploadError').classList.add('hidden');

  // Populate folder select
  const sel = document.getElementById('uploadFolderSelect');
  sel.innerHTML = '<option value="">— Kein Ordner (Wurzelebene) —</option>';
  const addOptions = (folders, depth) => {
    folders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = '  '.repeat(depth) + f.name;
      if (f.id === folderId) opt.selected = true;
      sel.appendChild(opt);
      addOptions(docData.folders.filter(c => c.parent_id === f.id), depth + 1);
    });
  };
  addOptions(docData.folders.filter(f => !f.parent_id), 0);

  document.getElementById('uploadModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeUploadModal() {
  document.getElementById('uploadModal').classList.add('hidden');
  document.body.style.overflow = '';
  selectedAdminFile = null;
}
function onAdminFileSelected(input) {
  selectedAdminFile = input.files[0];
  document.getElementById('adminFileName').textContent = selectedAdminFile ? selectedAdminFile.name : '';
}
async function uploadDocument() {
  const errEl = document.getElementById('uploadError');
  errEl.classList.add('hidden');
  if (!selectedAdminFile) { errEl.textContent = 'Bitte eine Datei auswählen.'; errEl.classList.remove('hidden'); return; }

  const btn = document.getElementById('uploadConfirmBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  const formData = new FormData();
  formData.append('file', selectedAdminFile);
  const folderId = document.getElementById('uploadFolderSelect').value;
  if (folderId) formData.append('folder_id', folderId);
  formData.append('description', document.getElementById('uploadDesc').value);

  const res = await fetch('/api/admin/documents', { method: 'POST', body: formData });
  btn.disabled = false;
  btn.textContent = 'Hochladen';

  if (res.ok) {
    closeUploadModal();
    loadDocuments();
  } else {
    const d = await res.json();
    errEl.textContent = d.error || 'Upload fehlgeschlagen.';
    errEl.classList.remove('hidden');
  }
}
async function deleteDocument(id, name) {
  if (!confirm(`Dokument "${name}" wirklich löschen?`)) return;
  const r = await apiFetch(`/api/admin/documents/${id}`, { method: 'DELETE' });
  if (r?.ok) loadDocuments();
}

// Drag & drop upload zone
const uploadZone = document.getElementById('adminUploadZone');
if (uploadZone) {
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) { selectedAdminFile = file; document.getElementById('adminFileName').textContent = file.name; }
  });
}

// ===== Helpers =====
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('de-DE');
}

// Modal backdrop close
['newEmpModal','itemModal','folderModal','uploadModal'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', e => {
    if (e.target.id === id) {
      if (id === 'newEmpModal') closeNewEmployeeModal();
      else if (id === 'itemModal') closeItemModal();
      else if (id === 'folderModal') closeFolderModal();
      else if (id === 'uploadModal') closeUploadModal();
    }
  });
});

// Init
(async () => {
  const r = await apiFetch('/api/me');
  if (!r || r.data.role !== 'admin') { window.location.href = '/login.html'; return; }
  loadEmployees();
})();
