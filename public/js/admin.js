let editingItemId = null;
let checklistItems = [];

// ===== Navigation =====
function showTab(tab) {
  ['employees', 'checklist'].forEach(t => {
    document.getElementById(`view-${t}`).classList.toggle('hidden', t !== tab);
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'checklist') loadChecklistEditor();
  if (tab === 'employees') loadEmployees();
}

// ===== Auth =====
async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401 || res.status === 403) { window.location.href = '/login.html'; return null; }
  return { ok: res.ok, status: res.status, data: await res.json() };
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
      <div class="employee-row" onclick="showEmployeeDetail(${emp.id})">
        <div class="employee-avatar">${escHtml(initials)}</div>
        <div class="employee-info">
          <div class="employee-name">${escHtml(emp.full_name)}</div>
          <div class="employee-username">@${escHtml(emp.username)}${emp.start_date ? ' · Start: ' + fmtDate(emp.start_date) : ''}</div>
        </div>
        <div class="employee-progress">
          <div class="progress-fraction">${emp.completed}/${emp.total}</div>
          <div class="progress-bar-wrap progress-mini-bar" style="margin-top:4px;">
            <div class="progress-bar-fill" style="width:${pct}%"></div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ===== Employee detail =====
async function showEmployeeDetail(id) {
  document.getElementById('empListView').classList.add('hidden');
  document.getElementById('empDetailView').classList.remove('hidden');
  document.getElementById('empDetailContent').innerHTML = '<div style="padding:40px;text-align:center;"><span class="spinner" style="border-color:rgba(0,0,0,0.2);border-top-color:#000;"></span></div>';

  const r = await apiFetch(`/api/admin/employees/${id}`);
  if (!r) return;
  const { user, checklist } = r.data;
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
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" style="width:${checklist.length ? Math.round(done/checklist.length*100) : 0}%"></div>
        </div>
      </div>
    </div>
    <div class="section-title">Aufgaben</div>`;

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
  const r = await apiFetch('/api/admin/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r) return;
  if (!r.ok) {
    errEl.textContent = r.data.error || 'Fehler beim Erstellen.';
    errEl.classList.remove('hidden');
    return;
  }
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
      <div class="drag-handle" title="Verschieben">⠿</div>
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
    el.addEventListener('dragend', () => {
      el.style.opacity = '';
      dragging = null;
      saveOrder();
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      if (!dragging || dragging === el) return;
      const rect = el.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      container.insertBefore(dragging, after ? el.nextSibling : el);
    });
  });
}

async function saveOrder() {
  const ids = [...document.querySelectorAll('.editor-item')].map(el => Number(el.dataset.id));
  await apiFetch('/api/admin/checklist/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });
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
  setTimeout(() => document.getElementById('itemTitle').focus(), 100);
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
  if (!title) {
    errEl.textContent = 'Titel ist erforderlich.';
    errEl.classList.remove('hidden');
    return;
  }

  let r;
  if (editingItemId) {
    const item = checklistItems.find(i => i.id === editingItemId);
    r = await apiFetch(`/api/admin/checklist/${editingItemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, order_index: item?.order_index || 0 })
    });
  } else {
    r = await apiFetch('/api/admin/checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description })
    });
  }

  if (!r || !r.ok) {
    errEl.textContent = r?.data?.error || 'Fehler beim Speichern.';
    errEl.classList.remove('hidden');
    return;
  }

  closeItemModal();
  loadChecklistEditor();
}

async function deleteItem(id) {
  const item = checklistItems.find(i => i.id === id);
  if (!confirm(`Aufgabe "${item?.title}" wirklich löschen?`)) return;
  await apiFetch(`/api/admin/checklist/${id}`, { method: 'DELETE' });
  loadChecklistEditor();
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
document.getElementById('newEmpModal').addEventListener('click', e => {
  if (e.target === document.getElementById('newEmpModal')) closeNewEmployeeModal();
});
document.getElementById('itemModal').addEventListener('click', e => {
  if (e.target === document.getElementById('itemModal')) closeItemModal();
});

// Init
(async () => {
  const r = await apiFetch('/api/me');
  if (!r || r.data.role !== 'admin') { window.location.href = '/login.html'; return; }
  loadEmployees();
})();
