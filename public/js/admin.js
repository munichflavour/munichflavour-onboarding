let editingItemId = null;
let checklistItems = [];
let docData = { folders: [], documents: [] };
let editingFolderId = null;
let uploadParentFolderId = null;
let selectedAdminFile = null;
let profiles = [];
let editingProfileId = null;
let sigPads = {};
let activeClothingUserId = null;
let activeReturnRecordId = null;
let activeReturnUserId = null;

// ===== Navigation =====
function showTab(tab) {
  ['employees','profiles','checklist','documents'].forEach(t => {
    document.getElementById(`view-${t}`).classList.toggle('hidden', t !== tab);
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'checklist') loadChecklistEditor();
  if (tab === 'employees') loadEmployees();
  if (tab === 'documents') loadDocuments();
  if (tab === 'profiles') loadProfiles();
}

async function logout() { await fetch('/api/logout', { method: 'POST' }); window.location.href = '/login.html'; }

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401 || res.status === 403) { window.location.href = '/login.html'; return null; }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : {};
  return { ok: res.ok, status: res.status, data };
}

// ===== EMPLOYEES =====
async function loadEmployees() {
  const [empRes, profRes] = await Promise.all([apiFetch('/api/admin/employees'), apiFetch('/api/admin/profiles')]);
  if (!empRes) return;
  profiles = profRes?.data || [];
  document.getElementById('empLoading').classList.add('hidden');
  const list = document.getElementById('employeeList');
  if (!empRes.data.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:#888;font-size:14px;">Noch keine Mitarbeiter angelegt.</div>';
    return;
  }
  list.innerHTML = empRes.data.map(emp => {
    const pct = emp.total ? Math.round(emp.completed / emp.total * 100) : 0;
    const initials = emp.full_name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    return `
      <div class="employee-row">
        <div class="employee-avatar" onclick="showEmployeeDetail(${emp.id})" style="cursor:pointer;">${escHtml(initials)}</div>
        <div class="employee-info" onclick="showEmployeeDetail(${emp.id})" style="cursor:pointer;">
          <div class="employee-name">${escHtml(emp.full_name)}</div>
          <div class="employee-username">@${escHtml(emp.username)} ${emp.profile_name ? '· '+escHtml(emp.profile_name) : ''}${emp.start_date ? ' · '+fmtDate(emp.start_date) : ''}</div>
        </div>
        <div class="employee-progress" onclick="showEmployeeDetail(${emp.id})" style="cursor:pointer;">
          <div class="progress-fraction">${emp.completed}/${emp.total}</div>
          <div class="progress-bar-wrap progress-mini-bar" style="margin-top:4px;"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
          ${emp.pending > 0 ? `<div style="margin-top:4px;background:#f0c040;color:#000;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:700;text-align:center;">⏳ ${emp.pending} ausstehend</div>` : ''}
          ${emp.rejected > 0 ? `<div style="margin-top:4px;background:#ffcccc;color:#cc0000;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:700;text-align:center;">✗ ${emp.rejected} abgelehnt</div>` : ''}
        </div>
        <button class="btn btn-danger btn-sm" style="flex-shrink:0;" onclick="deleteEmployee(${emp.id},'${escHtml(emp.full_name)}')">🗑</button>
      </div>`;
  }).join('');
}

async function deleteEmployee(id, name) {
  if (!confirm(`Mitarbeiter "${name}" wirklich löschen?`)) return;
  const r = await apiFetch(`/api/admin/employees/${id}`, { method: 'DELETE' });
  if (r?.ok) loadEmployees(); else alert(r?.data?.error || 'Fehler');
}

async function showEmployeeDetail(id) {
  document.getElementById('empListView').classList.add('hidden');
  document.getElementById('empDetailView').classList.remove('hidden');
  document.getElementById('empDetailContent').innerHTML = '<div style="padding:40px;text-align:center;"><span class="spinner" style="border-color:rgba(0,0,0,0.2);border-top-color:#000;"></span></div>';

  const [r, ru, rc] = await Promise.all([
    apiFetch(`/api/admin/employees/${id}`),
    apiFetch(`/api/admin/employees/${id}/uploads`),
    apiFetch(`/api/admin/employees/${id}/clothing`)
  ]);
  if (!r) return;
  const { user, checklist } = r.data;
  const uploads = ru?.data || [];
  const clothing = rc?.data || [];
  const done = checklist.filter(i => i.progress?.confirmed_at).length;
  activeClothingUserId = id;

  let html = `
    <div class="card" style="margin-bottom:16px;">
      <div style="font-size:18px;font-weight:700;margin-bottom:4px;">${escHtml(user.full_name)}</div>
      <div style="font-size:13px;color:#666;">@${escHtml(user.username)}${user.profile_name ? ' · Profil: '+escHtml(user.profile_name) : ''}${user.start_date ? ' · Start: '+fmtDate(user.start_date) : ''}</div>
      <div style="margin-top:12px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:13px;font-weight:600;">Fortschritt</span>
          <span style="font-size:13px;font-weight:700;">${done}/${checklist.length}</span>
        </div>
        <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${checklist.length ? Math.round(done/checklist.length*100) : 0}%"></div></div>
      </div>
    </div>`;

  // Checklist
  html += `<div class="section-title">Onboarding-Aufgaben</div>`;
  checklist.forEach(item => {
    const p = item.progress;
    const isConfirmed = !!p?.confirmed_at;
    const isCompleted = !!p?.completed_at;
    let borderStyle = 'border-color:var(--gray-mid)';
    if (isConfirmed) borderStyle = 'border-color:#000';
    else if (isCompleted) borderStyle = 'border-color:#f0c040';
    let statusIcon = isConfirmed ? '✓' : (isCompleted ? '⏳' : '');
    let actionHtml = '';
    if (isCompleted && !isConfirmed) {
      actionHtml = `
        <div style="padding:12px 16px;border-top:1px solid var(--gray-mid);background:#fffbea;">
          <div style="font-size:13px;color:#666;margin-bottom:10px;">⏳ Erledigt am ${new Date(p.completed_at+'Z').toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'})} – Bestätigung ausstehend</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <input type="text" id="confirmName-${item.id}" placeholder="Dein Name" style="width:100%;padding:12px;border:1.5px solid #ccc;border-radius:6px;font-size:16px;">
            <div style="display:flex;gap:8px;">
              <button class="btn btn-primary" style="flex:1;" onclick="confirmItem(${user.id}, ${item.id})">✓ Bestätigen</button>
              <button class="btn btn-danger" style="flex:1;" onclick="toggleRejectForm(${item.id})">✗ Ablehnen</button>
            </div>
            <div id="rejectForm-${item.id}" style="display:none;flex-direction:column;gap:8px;">
              <textarea id="rejectComment-${item.id}" placeholder="Kommentar für den Mitarbeiter (Pflicht)..." rows="3" style="width:100%;padding:12px;border:1.5px solid #cc0000;border-radius:6px;font-size:15px;resize:none;"></textarea>
              <button class="btn btn-danger btn-full" onclick="rejectItem(${user.id}, ${item.id})">Ablehnung absenden</button>
            </div>
          </div>
        </div>`;
    } else if (isConfirmed) {
      actionHtml = `
        <div style="padding:10px 16px;border-top:1px solid var(--gray-mid);display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;color:#666;">
          <span>✓ Erledigt: ${new Date(p.completed_at+'Z').toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'})}</span>
          <span style="background:#000;color:#fff;border-radius:4px;padding:2px 8px;">✓ Bestätigt: ${new Date(p.confirmed_at+'Z').toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'})} von ${escHtml(p.confirmed_by)}</span>
          <button class="btn btn-secondary btn-sm" onclick="unconfirmItem(${user.id}, ${item.id})">Zurücksetzen</button>
        </div>`;
    }
    html += `
      <div class="admin-checklist-item" style="${borderStyle}">
        <div class="admin-item-header">
          <div class="status-icon" style="${isConfirmed?'background:#000;border-color:#000;color:#fff;':isCompleted?'border-color:#f0c040;color:#b8860b;':''}">${statusIcon}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:15px;${isConfirmed?'text-decoration:line-through;color:#666;':''}">${escHtml(item.title)}</div>
            ${item.description ? `<div style="font-size:13px;color:#666;margin-top:2px;">${escHtml(item.description)}</div>` : ''}
          </div>
        </div>
        ${actionHtml}
      </div>`;
  });

  // Clothing
  html += `<div class="section-title" style="margin-top:24px;display:flex;align-items:center;justify-content:space-between;">
    <span>Arbeitskleidung</span>
    <button class="btn btn-primary btn-sm" onclick="openClothingModal(${user.id})">+ Ausgeben</button>
  </div>`;
  if (!clothing.length) {
    html += `<div class="card" style="text-align:center;color:#888;font-size:14px;">Noch keine Kleidung ausgegeben.</div>`;
  } else {
    clothing.forEach(rec => {
      const allSigned = rec.admin_signed_at && rec.employee_signed_at;
      const returned = !!rec.returned_at;
      const returnComplete = returned && rec.return_admin_signed_at && rec.return_employee_signed_at;
      html += `
        <div class="card" style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div>
              <div style="font-weight:700;">Ausgabe vom ${new Date(rec.issued_at+'Z').toLocaleDateString('de-DE')}</div>
              <div style="font-size:12px;color:#666;">
                Admin: ${rec.admin_signed_at?'✓ Unterschrieben':'⏳ Ausstehend'} &nbsp;|&nbsp;
                Mitarbeiter: ${rec.employee_signed_at?'✓ Unterschrieben':'⏳ Ausstehend'}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <a href="/api/clothing/${rec.id}/pdf" class="btn btn-secondary btn-sm">PDF</a>
              ${!returned ? `<button class="btn btn-secondary btn-sm" onclick="openReturnModal(${user.id},${rec.id},${JSON.stringify(rec.items).replace(/"/g,'&quot;')})">Rückgabe</button>` : ''}
            </div>
          </div>
          <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <tr style="background:#f5f5f5;"><th style="padding:6px;text-align:left;">Kleidungsstück</th><th style="padding:6px;">Größe</th><th style="padding:6px;">Anzahl</th>${returned?'<th style="padding:6px;">Zurück</th>':''}</tr>
            ${rec.items.map(it=>`<tr><td style="padding:6px;">${escHtml(it.name)}</td><td style="padding:6px;text-align:center;">${escHtml(it.size||'-')}</td><td style="padding:6px;text-align:center;">${it.quantity}</td>${returned?`<td style="padding:6px;text-align:center;">${it.returned?'✓':'✗'}</td>`:''}</tr>`).join('')}
          </table>
          ${returned ? `<div style="margin-top:8px;font-size:12px;color:#666;">Rückgabe: ${new Date(rec.returned_at+'Z').toLocaleDateString('de-DE')} ${rec.fee_applicable?'<span style="color:red;font-weight:700;">⚠ Gebühr fällig</span>':''}</div>` : ''}
        </div>`;
    });
  }

  // Uploads
  if (uploads.length > 0) {
    html += `<div class="section-title" style="margin-top:24px;">Hochgeladene Dokumente (${uploads.length})</div>
    <div class="card" style="padding:0;overflow:hidden;">`;
    uploads.forEach(u => {
      html += `<div class="employee-row" style="cursor:default;">
        <div style="font-size:20px;">📄</div>
        <div class="employee-info"><div class="employee-name">${escHtml(u.original_name)}</div><div class="employee-username">${new Date(u.uploaded_at+'Z').toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'})}</div></div>
        <a href="/api/admin/uploads/${u.id}/download" class="btn btn-secondary btn-sm">⬇</a>
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

function toggleRejectForm(itemId) {
  const form = document.getElementById(`rejectForm-${itemId}`);
  form.style.display = form.style.display === 'none' ? 'flex' : 'none';
  if (form.style.display === 'flex') document.getElementById(`rejectComment-${itemId}`)?.focus();
}

async function rejectItem(userId, itemId) {
  const comment = document.getElementById(`rejectComment-${itemId}`)?.value.trim();
  if (!comment) { alert('Bitte einen Kommentar eingeben.'); return; }
  const r = await apiFetch(`/api/admin/employees/${userId}/checklist/${itemId}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment })
  });
  if (r?.ok) showEmployeeDetail(userId);
  else alert(r?.data?.error || 'Fehler');
}

async function confirmItem(userId, itemId) {
  const input = document.getElementById(`confirmName-${itemId}`);
  const name = input?.value.trim();
  if (!name) { input.style.borderColor='red'; input.focus(); return; }
  const r = await apiFetch(`/api/admin/employees/${userId}/checklist/${itemId}/confirm`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ confirmed_by: name }) });
  if (r?.ok) showEmployeeDetail(userId); else alert(r?.data?.error || 'Fehler');
}
async function unconfirmItem(userId, itemId) {
  if (!confirm('Bestätigung zurücksetzen?')) return;
  const r = await apiFetch(`/api/admin/employees/${userId}/checklist/${itemId}/unconfirm`, { method:'POST' });
  if (r?.ok) showEmployeeDetail(userId);
}

// ===== NEW EMPLOYEE MODAL =====
async function openNewEmployeeModal() {
  ['newName','newUsername','newPassword'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('newStartDate').value = '';
  document.getElementById('newEmpError').classList.add('hidden');
  // Load profiles for select
  const profRes = await apiFetch('/api/admin/profiles');
  profiles = profRes?.data || [];
  const sel = document.getElementById('newProfileSelect');
  sel.innerHTML = '<option value="">— Kein Profil (alle Aufgaben) —</option>';
  profiles.forEach(p => sel.innerHTML += `<option value="${p.id}">${escHtml(p.name)}</option>`);
  document.getElementById('newEmpModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeNewEmployeeModal() { document.getElementById('newEmpModal').classList.add('hidden'); document.body.style.overflow = ''; }
async function createEmployee() {
  const errEl = document.getElementById('newEmpError');
  errEl.classList.add('hidden');
  const body = {
    full_name: document.getElementById('newName').value.trim(),
    username: document.getElementById('newUsername').value.trim(),
    password: document.getElementById('newPassword').value,
    start_date: document.getElementById('newStartDate').value || null,
    profile_id: document.getElementById('newProfileSelect').value || null
  };
  if (!body.full_name || !body.username || !body.password) { errEl.textContent='Pflichtfelder ausfüllen.'; errEl.classList.remove('hidden'); return; }
  const r = await apiFetch('/api/admin/employees', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (!r) return;
  if (!r.ok) { errEl.textContent=r.data.error||'Fehler'; errEl.classList.remove('hidden'); return; }
  closeNewEmployeeModal();
  loadEmployees();
}

// ===== PROFILES =====
async function loadProfiles() {
  const [profRes, itemRes] = await Promise.all([apiFetch('/api/admin/profiles'), apiFetch('/api/admin/checklist')]);
  if (!profRes) return;
  profiles = profRes.data;
  checklistItems = itemRes?.data || [];
  const container = document.getElementById('profileList');
  if (!profiles.length) {
    container.innerHTML = '<div class="card" style="text-align:center;color:#888;padding:32px;">Noch keine Profile. Erstelle ein Profil um Checklistenpunkte zu gruppieren.</div>';
    return;
  }
  container.innerHTML = '';
  for (const prof of profiles) {
    const itemsRes = await apiFetch(`/api/admin/profiles/${prof.id}/items`);
    const profItems = itemsRes?.data || [];
    const card = document.createElement('div');
    card.className = 'profile-card';
    card.innerHTML = `
      <div class="profile-card-header">
        <div style="flex:1;">
          <div class="profile-name">${escHtml(prof.name)}</div>
          ${prof.description ? `<div class="profile-desc">${escHtml(prof.description)}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm" onclick="openProfileModal(${prof.id})">Bearbeiten</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProfile(${prof.id},'${escHtml(prof.name)}')">🗑</button>
        </div>
      </div>
      <div class="profile-items-list">
        ${profItems.length ? profItems.map(i=>`<span class="profile-item-badge">${escHtml(i.title)}</span>`).join('') : '<span style="font-size:13px;color:#aaa;">Keine Aufgaben zugewiesen</span>'}
      </div>`;
    container.appendChild(card);
  }
}

async function openProfileModal(id) {
  editingProfileId = id || null;
  document.getElementById('profileModalTitle').textContent = id ? 'Profil bearbeiten' : 'Neues Profil';
  document.getElementById('profileError').classList.add('hidden');
  // Load checklist items
  const itemRes = await apiFetch('/api/admin/checklist');
  checklistItems = itemRes?.data || [];
  let selectedIds = [];
  if (id) {
    const profRes = await apiFetch(`/api/admin/profiles/${id}/items`);
    selectedIds = (profRes?.data || []).map(i => i.id);
    const profData = profiles.find(p => p.id === id);
    document.getElementById('profileName').value = profData?.name || '';
    document.getElementById('profileDesc').value = profData?.description || '';
  } else {
    document.getElementById('profileName').value = '';
    document.getElementById('profileDesc').value = '';
  }
  // Render checkboxes
  const container = document.getElementById('profileItemCheckboxes');
  container.innerHTML = checklistItems.map(item => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;cursor:pointer;">
      <input type="checkbox" value="${item.id}" ${selectedIds.includes(item.id)?'checked':''} style="width:18px;height:18px;flex-shrink:0;">
      <span style="font-size:14px;">${escHtml(item.title)}</span>
    </label>`).join('');
  document.getElementById('profileModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeProfileModal() { document.getElementById('profileModal').classList.add('hidden'); document.body.style.overflow = ''; editingProfileId = null; }
async function saveProfile() {
  const errEl = document.getElementById('profileError');
  errEl.classList.add('hidden');
  const name = document.getElementById('profileName').value.trim();
  const description = document.getElementById('profileDesc').value.trim();
  if (!name) { errEl.textContent='Name erforderlich.'; errEl.classList.remove('hidden'); return; }
  const item_ids = [...document.querySelectorAll('#profileItemCheckboxes input:checked')].map(cb => Number(cb.value));
  let r;
  if (editingProfileId) {
    r = await apiFetch(`/api/admin/profiles/${editingProfileId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, description, item_ids }) });
  } else {
    r = await apiFetch('/api/admin/profiles', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, description, item_ids }) });
  }
  if (!r || !r.ok) { errEl.textContent=r?.data?.error||'Fehler'; errEl.classList.remove('hidden'); return; }
  closeProfileModal();
  loadProfiles();
}
async function deleteProfile(id, name) {
  if (!confirm(`Profil "${name}" löschen? Mitarbeiter mit diesem Profil sehen dann alle Aufgaben.`)) return;
  await apiFetch(`/api/admin/profiles/${id}`, { method:'DELETE' });
  loadProfiles();
}

// ===== CHECKLIST EDITOR =====
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
    el.className = 'editor-item'; el.dataset.id = item.id; el.draggable = true;
    el.innerHTML = `<div class="drag-handle">⠿</div>
      <div class="editor-item-content"><div class="editor-item-title">${escHtml(item.title)}</div>${item.description?`<div class="editor-item-desc">${escHtml(item.description)}</div>`:''}</div>
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
    el.addEventListener('dragstart', () => { dragging = el; setTimeout(() => el.style.opacity='0.4', 0); });
    el.addEventListener('dragend', () => { el.style.opacity=''; dragging=null; saveOrder(); });
    el.addEventListener('dragover', e => { e.preventDefault(); if (!dragging||dragging===el) return; const after = e.clientY > el.getBoundingClientRect().top + el.getBoundingClientRect().height/2; container.insertBefore(dragging, after?el.nextSibling:el); });
  });
}
async function saveOrder() {
  const ids = [...document.querySelectorAll('.editor-item')].map(el => Number(el.dataset.id));
  await apiFetch('/api/admin/checklist/reorder', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ids }) });
}
function openItemModal(id) {
  editingItemId = id || null;
  document.getElementById('itemModalTitle').textContent = id ? 'Aufgabe bearbeiten' : 'Aufgabe hinzufügen';
  document.getElementById('itemError').classList.add('hidden');
  if (id) { const item = checklistItems.find(i=>i.id===id); document.getElementById('itemTitle').value=item?.title||''; document.getElementById('itemDesc').value=item?.description||''; }
  else { document.getElementById('itemTitle').value=''; document.getElementById('itemDesc').value=''; }
  document.getElementById('itemModal').classList.remove('hidden'); document.body.style.overflow='hidden';
}
function closeItemModal() { document.getElementById('itemModal').classList.add('hidden'); document.body.style.overflow=''; editingItemId=null; }
async function saveItem() {
  const errEl = document.getElementById('itemError'); errEl.classList.add('hidden');
  const title = document.getElementById('itemTitle').value.trim();
  const description = document.getElementById('itemDesc').value.trim();
  if (!title) { errEl.textContent='Titel erforderlich.'; errEl.classList.remove('hidden'); return; }
  let r;
  if (editingItemId) { const item = checklistItems.find(i=>i.id===editingItemId); r = await apiFetch(`/api/admin/checklist/${editingItemId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title, description, order_index: item?.order_index||0 }) }); }
  else { r = await apiFetch('/api/admin/checklist', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title, description }) }); }
  if (!r||!r.ok) { errEl.textContent=r?.data?.error||'Fehler'; errEl.classList.remove('hidden'); return; }
  closeItemModal(); loadChecklistEditor();
}
async function deleteItem(id) {
  const item = checklistItems.find(i=>i.id===id);
  if (!confirm(`"${item?.title}" löschen?`)) return;
  await apiFetch(`/api/admin/checklist/${id}`, { method:'DELETE' });
  loadChecklistEditor();
}

// ===== DOCUMENTS =====
async function loadDocuments() {
  const r = await apiFetch('/api/documents'); if (!r) return;
  docData = r.data; renderDocTree();
}
function renderDocTree() {
  const container = document.getElementById('docTree'); container.innerHTML='';
  const rootFolders = docData.folders.filter(f=>!f.parent_id);
  const rootDocs = docData.documents.filter(d=>!d.folder_id);
  rootFolders.forEach(f => container.appendChild(renderFolder(f)));
  if (rootDocs.length) { const s=document.createElement('div'); rootDocs.forEach(d=>s.appendChild(renderDocItem(d))); container.appendChild(s); }
  if (!rootFolders.length && !rootDocs.length) container.innerHTML='<div style="text-align:center;padding:40px;color:#888;font-size:14px;">Noch keine Dokumente.</div>';
}
function renderFolder(folder) {
  const children = docData.folders.filter(f=>f.parent_id===folder.id);
  const docs = docData.documents.filter(d=>d.folder_id===folder.id);
  const node = document.createElement('div'); node.className='folder-node';
  const header = document.createElement('div'); header.className='folder-header';
  header.innerHTML=`<span class="folder-icon">📁</span><span class="folder-name">${escHtml(folder.name)}</span>
    <div class="folder-actions" onclick="event.stopPropagation()">
      <button class="btn btn-secondary btn-sm" onclick="openFolderModal(${folder.parent_id||'null'},${folder.id})">✏️</button>
      <button class="btn btn-secondary btn-sm" onclick="openFolderModal(${folder.id})">+ Unterordner</button>
      <button class="btn btn-primary btn-sm" onclick="openUploadModal(${folder.id})">+ Datei</button>
      <button class="btn btn-danger btn-sm" onclick="deleteFolder(${folder.id},'${escHtml(folder.name)}')">🗑</button>
    </div>`;
  const childrenEl = document.createElement('div'); childrenEl.className='folder-children';
  children.forEach(c=>childrenEl.appendChild(renderFolder(c)));
  docs.forEach(d=>childrenEl.appendChild(renderDocItem(d)));
  let collapsed=false;
  header.addEventListener('click', () => { collapsed=!collapsed; childrenEl.style.display=collapsed?'none':''; header.querySelector('.folder-icon').textContent=collapsed?'📁':'📂'; });
  node.appendChild(header); node.appendChild(childrenEl); return node;
}
function renderDocItem(doc) {
  const el=document.createElement('div'); el.className='doc-item';
  el.innerHTML=`<span class="doc-icon">📄</span><span class="doc-name" title="${escHtml(doc.original_name)}">${escHtml(doc.original_name)}</span>
    ${doc.description?`<span style="font-size:12px;color:#888;">${escHtml(doc.description)}</span>`:''}
    <span style="font-size:12px;color:#aaa;">${new Date(doc.uploaded_at+'Z').toLocaleDateString('de-DE')}</span>
    <a href="/api/documents/${doc.id}/download" class="btn btn-secondary btn-sm">⬇</a>
    <button class="btn btn-danger btn-sm" onclick="deleteDocument(${doc.id},'${escHtml(doc.original_name)}')">🗑</button>`;
  return el;
}
function openFolderModal(parentId, editId) {
  editingFolderId=editId||null; uploadParentFolderId=parentId;
  document.getElementById('folderModalTitle').textContent=editId?'Ordner umbenennen':'Neuer Ordner';
  document.getElementById('folderError').classList.add('hidden');
  document.getElementById('folderName').value=editId?(docData.folders.find(f=>f.id===editId)?.name||''):'';
  document.getElementById('folderModal').classList.remove('hidden'); document.body.style.overflow='hidden';
}
function closeFolderModal() { document.getElementById('folderModal').classList.add('hidden'); document.body.style.overflow=''; editingFolderId=null; }
async function saveFolder() {
  const errEl=document.getElementById('folderError'); errEl.classList.add('hidden');
  const name=document.getElementById('folderName').value.trim();
  if (!name) { errEl.textContent='Name erforderlich.'; errEl.classList.remove('hidden'); return; }
  let r;
  if (editingFolderId) r=await apiFetch(`/api/admin/folders/${editingFolderId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
  else r=await apiFetch('/api/admin/folders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,parent_id:uploadParentFolderId})});
  if (!r||!r.ok) { errEl.textContent=r?.data?.error||'Fehler'; errEl.classList.remove('hidden'); return; }
  closeFolderModal(); loadDocuments();
}
async function deleteFolder(id, name) { if (!confirm(`Ordner "${name}" löschen?`)) return; await apiFetch(`/api/admin/folders/${id}`,{method:'DELETE'}); loadDocuments(); }
function openUploadModal(folderId) {
  uploadParentFolderId=folderId; selectedAdminFile=null;
  document.getElementById('adminFileName').textContent=''; document.getElementById('adminFileInput').value=''; document.getElementById('uploadDesc').value=''; document.getElementById('uploadError').classList.add('hidden');
  const sel=document.getElementById('uploadFolderSelect');
  sel.innerHTML='<option value="">— Kein Ordner —</option>';
  const addOpts=(folders,depth)=>folders.forEach(f=>{ const opt=document.createElement('option'); opt.value=f.id; opt.textContent='  '.repeat(depth)+f.name; if(f.id===folderId) opt.selected=true; sel.appendChild(opt); addOpts(docData.folders.filter(c=>c.parent_id===f.id),depth+1); });
  addOpts(docData.folders.filter(f=>!f.parent_id),0);
  document.getElementById('uploadModal').classList.remove('hidden'); document.body.style.overflow='hidden';
}
function closeUploadModal() { document.getElementById('uploadModal').classList.add('hidden'); document.body.style.overflow=''; selectedAdminFile=null; }
function onAdminFileSelected(input) { selectedAdminFile=input.files[0]; document.getElementById('adminFileName').textContent=selectedAdminFile?selectedAdminFile.name:''; }
async function uploadDocument() {
  const errEl=document.getElementById('uploadError'); errEl.classList.add('hidden');
  if (!selectedAdminFile) { errEl.textContent='Datei auswählen.'; errEl.classList.remove('hidden'); return; }
  const btn=document.getElementById('uploadConfirmBtn'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  const formData=new FormData(); formData.append('file',selectedAdminFile);
  const folderId=document.getElementById('uploadFolderSelect').value;
  if (folderId) formData.append('folder_id',folderId);
  formData.append('description',document.getElementById('uploadDesc').value);
  const res=await fetch('/api/admin/documents',{method:'POST',body:formData});
  btn.disabled=false; btn.textContent='Hochladen';
  if (res.ok) { closeUploadModal(); loadDocuments(); }
  else { const d=await res.json(); errEl.textContent=d.error||'Fehler'; errEl.classList.remove('hidden'); }
}
async function deleteDocument(id,name) { if (!confirm(`"${name}" löschen?`)) return; await apiFetch(`/api/admin/documents/${id}`,{method:'DELETE'}); loadDocuments(); }

// ===== CLOTHING =====
function initSigPad(canvasId, hintId, key) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const wrap = canvas.parentElement;
  canvas.width = wrap.clientWidth || 400;
  canvas.height = 150;
  if (sigPads[key]) sigPads[key].off();
  sigPads[key] = new SignaturePad(canvas, { penColor: '#000' });
  sigPads[key].addEventListener('beginStroke', () => { const h=document.getElementById(hintId); if(h) h.style.display='none'; });
}
function clearSig(key) { if (sigPads[key]) { sigPads[key].clear(); const hint=document.getElementById(key+'Hint'); if(hint) hint.style.display=''; } }

function addClothingItemRow(name='', size='', qty=1) {
  const list = document.getElementById('clothingItemsList');
  const row = document.createElement('div'); row.className='clothing-item-row';
  row.innerHTML=`<input type="text" placeholder="Bezeichnung (z.B. Schwarzes Hemd)" value="${escHtml(name)}">
    <input type="text" class="size-input" placeholder="Größe" value="${escHtml(size)}">
    <input type="number" class="qty-input" placeholder="Anz." value="${qty}" min="1">
    <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>`;
  list.appendChild(row);
}

function openClothingModal(userId) {
  activeClothingUserId = userId;
  document.getElementById('clothingItemsList').innerHTML='';
  document.getElementById('clothingAdminName').value='';
  document.getElementById('clothingError').classList.add('hidden');
  addClothingItemRow(); addClothingItemRow(); addClothingItemRow();
  document.getElementById('clothingModal').classList.remove('hidden'); document.body.style.overflow='hidden';
  setTimeout(() => initSigPad('clothingAdminSigCanvas','clothingAdminSigHint','clothingAdminSig'), 100);
}
function closeClothingModal() { document.getElementById('clothingModal').classList.add('hidden'); document.body.style.overflow=''; }

async function saveClothingIssue() {
  const errEl=document.getElementById('clothingError'); errEl.classList.add('hidden');
  const rows = [...document.querySelectorAll('#clothingItemsList .clothing-item-row')];
  const items = rows.map(row => {
    const inputs = row.querySelectorAll('input');
    return { name: inputs[0].value.trim(), size: inputs[1].value.trim(), quantity: parseInt(inputs[2].value)||1 };
  }).filter(i => i.name);
  if (!items.length) { errEl.textContent='Mindestens ein Kleidungsstück eintragen.'; errEl.classList.remove('hidden'); return; }
  const admin_name = document.getElementById('clothingAdminName').value.trim();
  if (!admin_name) { errEl.textContent='Name des Vorgesetzten erforderlich.'; errEl.classList.remove('hidden'); return; }
  if (!sigPads.clothingAdminSig || sigPads.clothingAdminSig.isEmpty()) { errEl.textContent='Bitte Unterschrift zeichnen.'; errEl.classList.remove('hidden'); return; }
  const admin_signature = sigPads.clothingAdminSig.toDataURL('image/png');
  const r = await apiFetch(`/api/admin/employees/${activeClothingUserId}/clothing`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ items, admin_name, admin_signature }) });
  if (!r||!r.ok) { errEl.textContent=r?.data?.error||'Fehler'; errEl.classList.remove('hidden'); return; }
  closeClothingModal(); showEmployeeDetail(activeClothingUserId);
}

function openReturnModal(userId, recordId, items) {
  activeReturnUserId=userId; activeReturnRecordId=recordId;
  document.getElementById('returnAdminName').value=''; document.getElementById('returnNotes').value=''; document.getElementById('feeApplicable').checked=false; document.getElementById('returnError').classList.add('hidden');
  const list=document.getElementById('returnItemsList'); list.innerHTML='';
  items.forEach(item => {
    const row=document.createElement('label'); row.style.cssText='display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;cursor:pointer;';
    row.innerHTML=`<input type="checkbox" data-id="${item.id}" checked style="width:18px;height:18px;flex-shrink:0;"><span style="font-size:14px;">${escHtml(item.name)} ${item.size?`(${escHtml(item.size)})`:''}  ×${item.quantity}</span>`;
    list.appendChild(row);
  });
  document.getElementById('returnModal').classList.remove('hidden'); document.body.style.overflow='hidden';
  setTimeout(() => initSigPad('returnAdminSigCanvas','returnAdminSigHint','returnAdminSig'), 100);
}
function closeReturnModal() { document.getElementById('returnModal').classList.add('hidden'); document.body.style.overflow=''; }

async function saveReturn() {
  const errEl=document.getElementById('returnError'); errEl.classList.add('hidden');
  const admin_name=document.getElementById('returnAdminName').value.trim();
  if (!admin_name) { errEl.textContent='Name erforderlich.'; errEl.classList.remove('hidden'); return; }
  if (!sigPads.returnAdminSig||sigPads.returnAdminSig.isEmpty()) { errEl.textContent='Bitte Unterschrift zeichnen.'; errEl.classList.remove('hidden'); return; }
  const return_admin_signature=sigPads.returnAdminSig.toDataURL('image/png');
  const returned_items=[...document.querySelectorAll('#returnItemsList input[type=checkbox]')].map(cb=>({ id:Number(cb.dataset.id), returned:cb.checked }));
  const fee_applicable=document.getElementById('feeApplicable').checked;
  const return_notes=document.getElementById('returnNotes').value.trim();
  const r=await apiFetch(`/api/admin/employees/${activeReturnUserId}/clothing/${activeReturnRecordId}/return`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({return_admin_name:admin_name,return_admin_signature,return_notes,returned_items,fee_applicable})});
  if (!r||!r.ok) { errEl.textContent=r?.data?.error||'Fehler'; errEl.classList.remove('hidden'); return; }
  closeReturnModal(); showEmployeeDetail(activeReturnUserId);
}

// Upload zone drag & drop
const uploadZone=document.getElementById('adminUploadZone');
if (uploadZone) {
  uploadZone.addEventListener('dragover',e=>{e.preventDefault();uploadZone.classList.add('dragover');});
  uploadZone.addEventListener('dragleave',()=>uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop',e=>{e.preventDefault();uploadZone.classList.remove('dragover');const f=e.dataTransfer.files[0];if(f){selectedAdminFile=f;document.getElementById('adminFileName').textContent=f.name;}});
}

// Modal backdrop close
['newEmpModal','itemModal','folderModal','uploadModal','profileModal','clothingModal','returnModal'].forEach(id=>{
  document.getElementById(id)?.addEventListener('click',e=>{if(e.target.id===id){
    if(id==='newEmpModal') closeNewEmployeeModal();
    else if(id==='itemModal') closeItemModal();
    else if(id==='folderModal') closeFolderModal();
    else if(id==='uploadModal') closeUploadModal();
    else if(id==='profileModal') closeProfileModal();
    else if(id==='clothingModal') closeClothingModal();
    else if(id==='returnModal') closeReturnModal();
  }});
});

function escHtml(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(iso) { if(!iso) return ''; return new Date(iso).toLocaleDateString('de-DE'); }

// ===== PUSH NOTIFICATIONS =====
async function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    // Check if already subscribed
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      // Re-register subscription with server (in case of new session)
      await fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON())
      });
      return;
    }
    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    // Get VAPID key
    const keyRes = await fetch('/api/push/vapid-public-key');
    const { key } = await keyRes.json();
    const applicationServerKey = urlBase64ToUint8Array(key);
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    await fetch('/api/push/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON())
    });
    console.log('✓ Push Notifications aktiviert');
  } catch (err) {
    console.warn('Push setup fehlgeschlagen:', err);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// Init
(async () => {
  const r=await apiFetch('/api/me');
  if (!r||r.data.role!=='admin') { window.location.href='/login.html'; return; }
  loadEmployees();
  initPushNotifications();
})();
