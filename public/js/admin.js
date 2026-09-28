if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

let docData = { folders: [], documents: [] };
let editingFolderId = null;
let uploadFolderId = null;
let selectedFiles = [];
let editingEmpId = null;

const NEW_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage
function isNew(dateStr) { return (Date.now() - Date.parse(dateStr + 'Z')) < NEW_THRESHOLD_MS; }

function showTab(tab) {
  ['documents','employees','announcements'].forEach(t => {
    document.getElementById(`view-${t}`).classList.toggle('hidden', t !== tab);
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'documents') loadDocuments();
  if (tab === 'employees') loadEmployees();
  if (tab === 'announcements') loadAnnouncementsAdmin();
}

async function logout() { await fetch('/api/logout', { method:'POST' }); window.location.href = '/login.html'; }

async function apiFetch(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    return null; // offline / Netzwerkfehler
  }
  if (res.status === 401 || res.status === 403) { window.location.href = '/login.html'; return null; }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : {};
  return { ok: res.ok, status: res.status, data };
}

// ===== PUSH AN/AUS =====
async function loadPushSetting() {
  const r = await apiFetch('/api/admin/settings');
  if (!r?.ok) return;
  document.getElementById('pushToggleInput').checked = r.data.pushEnabled;
  document.getElementById('pushToggleStatus').textContent = r.data.pushEnabled
    ? 'Aktiv – Mitarbeiter werden benachrichtigt'
    : 'Pausiert – es werden keine Benachrichtigungen verschickt';
}
async function togglePushSetting(enabled) {
  const statusEl = document.getElementById('pushToggleStatus');
  statusEl.textContent = 'Speichere…';
  const r = await apiFetch('/api/admin/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pushEnabled: enabled }) });
  if (!r?.ok) { alert('Fehler beim Speichern'); loadPushSetting(); return; }
  statusEl.textContent = enabled
    ? 'Aktiv – Mitarbeiter werden benachrichtigt'
    : 'Pausiert – es werden keine Benachrichtigungen verschickt';
}

// ===== OFFLINE-HINWEIS =====
function initOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;
  const update = () => banner.classList.toggle('hidden', navigator.onLine);
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

// ===== EMPLOYEES =====
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
    const initials = emp.full_name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    return `<div class="employee-row" style="cursor:default;">
      <div class="employee-avatar">${escHtml(initials)}</div>
      <div class="employee-info">
        <div class="employee-name">${escHtml(emp.full_name)}</div>
        <div class="employee-username">@${escHtml(emp.username)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button class="btn btn-secondary btn-sm" onclick="openEditEmpModal(${emp.id},'${escHtml(emp.full_name)}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteEmployee(${emp.id},'${escHtml(emp.full_name)}')">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function openNewEmpModal() {
  ['newName','newUsername','newPassword'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('newEmpError').classList.add('hidden');
  document.getElementById('newEmpModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeNewEmpModal() { document.getElementById('newEmpModal').classList.add('hidden'); document.body.style.overflow = ''; }

async function createEmployee() {
  const errEl = document.getElementById('newEmpError'); errEl.classList.add('hidden');
  const body = {
    full_name: document.getElementById('newName').value.trim(),
    username: document.getElementById('newUsername').value.trim(),
    password: document.getElementById('newPassword').value
  };
  if (!body.full_name || !body.username || !body.password) { errEl.textContent='Alle Felder ausfüllen.'; errEl.classList.remove('hidden'); return; }
  const r = await apiFetch('/api/admin/employees', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (!r) return;
  if (!r.ok) { errEl.textContent=r.data.error||'Fehler'; errEl.classList.remove('hidden'); return; }
  closeNewEmpModal(); loadEmployees();
}

function openEditEmpModal(id, name) {
  editingEmpId = id;
  document.getElementById('editName').value = name;
  document.getElementById('editPassword').value = '';
  document.getElementById('editEmpError').classList.add('hidden');
  document.getElementById('editEmpModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeEditEmpModal() { document.getElementById('editEmpModal').classList.add('hidden'); document.body.style.overflow = ''; editingEmpId = null; }

async function saveEmployee() {
  const errEl = document.getElementById('editEmpError'); errEl.classList.add('hidden');
  const body = { full_name: document.getElementById('editName').value.trim() };
  const pw = document.getElementById('editPassword').value;
  if (pw) body.password = pw;
  if (!body.full_name) { errEl.textContent='Name erforderlich.'; errEl.classList.remove('hidden'); return; }
  const r = await apiFetch(`/api/admin/employees/${editingEmpId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if (!r?.ok) { errEl.textContent=r?.data?.error||'Fehler'; errEl.classList.remove('hidden'); return; }
  closeEditEmpModal(); loadEmployees();
}

async function deleteEmployee(id, name) {
  if (!confirm(`Mitarbeiter „${name}" wirklich löschen?`)) return;
  const r = await apiFetch(`/api/admin/employees/${id}`, { method:'DELETE' });
  if (r?.ok) loadEmployees(); else alert(r?.data?.error || 'Fehler beim Löschen');
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
  const rootFolders = docData.folders.filter(f=>!f.parent_id);
  const rootDocs = docData.documents.filter(d=>!d.folder_id);
  if (!rootFolders.length && !rootDocs.length) {
    container.innerHTML = '<div style="text-align:center;padding:32px;color:#888;font-size:14px;">Noch keine Dokumente. Ordner oder Datei hinzufügen.</div>';
    return;
  }
  rootFolders.forEach(f => container.appendChild(renderFolder(f)));
  if (rootDocs.length) { const s=document.createElement('div'); rootDocs.forEach(d=>s.appendChild(renderDocItem(d))); container.appendChild(s); }
}

function renderFolder(folder) {
  const children = docData.folders.filter(f=>f.parent_id===folder.id);
  const docs = docData.documents.filter(d=>d.folder_id===folder.id);
  const node = document.createElement('div'); node.className='folder-node';
  const header = document.createElement('div'); header.className='folder-header';
  header.innerHTML=`<span class="folder-icon">📁</span><span class="folder-name">${escHtml(folder.name)}</span>
    <div class="folder-actions" onclick="event.stopPropagation()">
      <button class="btn btn-secondary btn-sm" title="Ordner umbenennen" onclick="openFolderModal(${folder.parent_id||'null'},${folder.id})">✏️</button>
      <button class="btn btn-secondary btn-sm" title="Unterordner hinzufügen" onclick="openFolderModal(${folder.id})">📂+</button>
      <button class="btn btn-primary btn-sm" title="Datei hochladen" onclick="openUploadModal(${folder.id})">📄+</button>
      <button class="btn btn-danger btn-sm" title="Ordner löschen" onclick="deleteFolder(${folder.id},'${escHtml(folder.name)}')">🗑</button>
    </div>`;
  const childrenEl = document.createElement('div'); childrenEl.className='folder-children';
  children.forEach(c=>childrenEl.appendChild(renderFolder(c)));
  docs.forEach(d=>childrenEl.appendChild(renderDocItem(d)));
  let collapsed=false;
  header.addEventListener('click', () => {
    collapsed=!collapsed;
    childrenEl.style.display=collapsed?'none':'';
    header.querySelector('.folder-icon').textContent=collapsed?'📁':'📂';
  });
  node.appendChild(header); node.appendChild(childrenEl); return node;
}

function renderDocItem(doc) {
  const el=document.createElement('div'); el.className='doc-item';
  const ext = doc.original_name.split('.').pop().toLowerCase();
  const icon = ['pdf'].includes(ext)?'📕':['doc','docx'].includes(ext)?'📘':['xls','xlsx'].includes(ext)?'📗':['jpg','jpeg','png','gif','webp'].includes(ext)?'🖼️':'📄';
  const badge = isNew(doc.uploaded_at) ? '<span class="badge-new">Neu</span>' : '';
  el.innerHTML=`<span style="font-size:20px;">${icon}</span>
    <span class="doc-name" title="${escHtml(doc.original_name)}">${escHtml(doc.original_name)}${badge}</span>
    ${doc.description?`<span class="doc-desc" title="${escHtml(doc.description)}">${escHtml(doc.description)}</span>`:''}
    <span style="font-size:12px;color:#aaa;flex-shrink:0;">${new Date(doc.uploaded_at+'Z').toLocaleDateString('de-DE')}</span>
    <a href="/api/documents/${doc.id}/download" class="btn btn-secondary btn-sm" style="flex-shrink:0;">⬇</a>
    <button class="btn btn-danger btn-sm" style="flex-shrink:0;" onclick="deleteDocument(${doc.id},'${escHtml(doc.original_name)}')">🗑</button>`;
  return el;
}

// ===== SUCHE (Dateiname + Beschreibung) =====
function onAdminSearch(val) {
  const clear = document.getElementById('adminSearchClear');
  if (!val.trim()) { clearAdminSearch(); return; }
  clear.classList.remove('hidden');
  const q = val.trim().toLowerCase();
  const results = docData.documents.filter(d =>
    d.original_name.toLowerCase().includes(q) || (d.description||'').toLowerCase().includes(q)
  );
  document.getElementById('docTree').classList.add('hidden');
  const resEl = document.getElementById('adminSearchResults');
  resEl.classList.remove('hidden');
  resEl.innerHTML = '';
  if (!results.length) {
    resEl.innerHTML = '<div style="text-align:center;padding:32px;color:#888;font-size:14px;">Keine Dokumente gefunden.</div>';
  } else {
    results.forEach(d => resEl.appendChild(renderDocItem(d)));
  }
}
function clearAdminSearch() {
  document.getElementById('adminSearchInput').value = '';
  document.getElementById('adminSearchClear').classList.add('hidden');
  document.getElementById('adminSearchResults').classList.add('hidden');
  document.getElementById('adminSearchResults').innerHTML = '';
  document.getElementById('docTree').classList.remove('hidden');
}

// ===== FOLDER MODAL =====
function openFolderModal(parentId, editId) {
  editingFolderId=editId||null; uploadFolderId=parentId;
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
  else r=await apiFetch('/api/admin/folders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,parent_id:uploadFolderId})});
  if (!r?.ok) { errEl.textContent=r?.data?.error||'Fehler'; errEl.classList.remove('hidden'); return; }
  closeFolderModal(); loadDocuments();
}
async function deleteFolder(id, name) {
  if (!confirm(`Ordner „${name}" und alle enthaltenen Dokumente löschen?`)) return;
  await apiFetch(`/api/admin/folders/${id}`,{method:'DELETE'}); loadDocuments();
}

// ===== UPLOAD MODAL =====
function openUploadModal(folderId) {
  uploadFolderId=folderId; selectedFiles=[];
  document.getElementById('adminFileName').innerHTML='';
  document.getElementById('adminFileInput').value='';
  document.getElementById('uploadDesc').value='';
  document.getElementById('uploadError').classList.add('hidden');
  document.getElementById('uploadConfirmBtn').disabled=false;
  document.getElementById('uploadConfirmBtn').textContent='Hochladen';
  const sel=document.getElementById('uploadFolderSelect');
  sel.innerHTML='<option value="">— Kein Ordner (Wurzel) —</option>';
  const addOpts=(folders,depth)=>folders.forEach(f=>{
    const opt=document.createElement('option'); opt.value=f.id;
    opt.textContent=' '.repeat(depth)+f.name;
    if(f.id===folderId) opt.selected=true;
    sel.appendChild(opt);
    addOpts(docData.folders.filter(c=>c.parent_id===f.id),depth+1);
  });
  addOpts(docData.folders.filter(f=>!f.parent_id),0);
  document.getElementById('uploadModal').classList.remove('hidden'); document.body.style.overflow='hidden';
}
function closeUploadModal() { document.getElementById('uploadModal').classList.add('hidden'); document.body.style.overflow=''; selectedFiles=[]; }
function setSelectedFiles(files) {
  selectedFiles = Array.from(files);
  const nameEl = document.getElementById('adminFileName');
  if (!selectedFiles.length) { nameEl.innerHTML=''; return; }
  nameEl.innerHTML = selectedFiles.length === 1
    ? escHtml(selectedFiles[0].name)
    : `${selectedFiles.length} Dateien ausgewählt:<br>` + selectedFiles.map(f=>escHtml(f.name)).join('<br>');
}
function onFileSelected(input) { setSelectedFiles(input.files); }
async function uploadDocument() {
  const errEl=document.getElementById('uploadError'); errEl.classList.add('hidden');
  if (!selectedFiles.length) { errEl.textContent='Bitte mindestens eine Datei auswählen.'; errEl.classList.remove('hidden'); return; }
  const btn=document.getElementById('uploadConfirmBtn'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  const formData=new FormData();
  selectedFiles.forEach(f=>formData.append('files',f));
  const folderId=document.getElementById('uploadFolderSelect').value;
  if (folderId) formData.append('folder_id',folderId);
  formData.append('description',document.getElementById('uploadDesc').value);
  const res=await fetch('/api/admin/documents',{method:'POST',body:formData});
  btn.disabled=false; btn.textContent='Hochladen';
  if (res.ok) { closeUploadModal(); loadDocuments(); }
  else { const d=await res.json(); errEl.textContent=d.error||'Fehler'; errEl.classList.remove('hidden'); }
}
async function deleteDocument(id,name) {
  if (!confirm(`„${name}" löschen?`)) return;
  await apiFetch(`/api/admin/documents/${id}`,{method:'DELETE'}); loadDocuments();
}

// Drag & drop
const uploadZone=document.getElementById('adminUploadZone');
if (uploadZone) {
  uploadZone.addEventListener('dragover',e=>{e.preventDefault();uploadZone.classList.add('dragover');});
  uploadZone.addEventListener('dragleave',()=>uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop',e=>{e.preventDefault();uploadZone.classList.remove('dragover');if(e.dataTransfer.files.length) setSelectedFiles(e.dataTransfer.files);});
}

// Modal backdrop close
['newEmpModal','editEmpModal','folderModal','uploadModal'].forEach(id=>{
  document.getElementById(id)?.addEventListener('click',e=>{if(e.target.id===id){
    if(id==='newEmpModal') closeNewEmpModal();
    else if(id==='editEmpModal') closeEditEmpModal();
    else if(id==='folderModal') closeFolderModal();
    else if(id==='uploadModal') closeUploadModal();
  }});
});

// ===== ANKÜNDIGUNGEN =====
async function loadAnnouncementsAdmin() {
  const r = await apiFetch('/api/announcements');
  if (!r) return;
  renderAnnouncementAdminList(r.data);
}
function renderAnnouncementAdminList(list) {
  const container = document.getElementById('announcementAdminList');
  if (!list.length) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:24px;color:#888;font-size:14px;">Noch keine Ankündigungen.</div>';
    return;
  }
  container.innerHTML = `<div class="card" style="padding:0;overflow:hidden;">${list.map(a => {
    const date = new Date(a.created_at+'Z').toLocaleDateString('de-DE');
    return `<div class="announcement-admin-row">
      <div class="announcement-admin-content">
        <div style="font-weight:700;font-size:15px;">${escHtml(a.title)}</div>
        ${a.body ? `<div style="font-size:13px;color:var(--gray-dark);margin-top:2px;">${escHtml(a.body)}</div>` : ''}
        <div style="font-size:12px;color:#aaa;margin-top:4px;">${date}</div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="deleteAnnouncement(${a.id})">🗑</button>
    </div>`;
  }).join('')}</div>`;
}
async function createAnnouncement() {
  const errEl = document.getElementById('annError'); errEl.classList.add('hidden');
  const title = document.getElementById('annTitle').value.trim();
  const body = document.getElementById('annBody').value.trim();
  if (!title) { errEl.textContent = 'Titel erforderlich.'; errEl.classList.remove('hidden'); return; }
  const r = await apiFetch('/api/admin/announcements', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title, body }) });
  if (!r?.ok) { errEl.textContent = r?.data?.error || 'Fehler'; errEl.classList.remove('hidden'); return; }
  document.getElementById('annTitle').value = '';
  document.getElementById('annBody').value = '';
  loadAnnouncementsAdmin();
}
async function deleteAnnouncement(id) {
  if (!confirm('Ankündigung löschen?')) return;
  await apiFetch(`/api/admin/announcements/${id}`, { method:'DELETE' });
  loadAnnouncementsAdmin();
}

// ===== PUSH =====
function urlBase64ToUint8Array(b64) {
  const pad='='.repeat((4-b64.length%4)%4);
  const base64=(b64+pad).replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from([...atob(base64)].map(c=>c.charCodeAt(0)));
}
async function initPushButton() {
  const btn=document.getElementById('pushBtn');
  if (!btn||!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)) return;
  btn.style.display='';
  try {
    const reg=await navigator.serviceWorker.ready;
    const sub=await reg.pushManager.getSubscription();
    if (sub && Notification.permission==='granted') {
      btn.textContent='🔔'; btn.style.opacity='1';
      await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub.toJSON())});
    } else { btn.textContent='🔕'; btn.style.opacity='0.6'; }
  } catch(e) { btn.style.display='none'; }
}
async function togglePush() {
  if (!('PushManager' in window)) { alert('Push nicht verfügbar.\n\nAuf iOS: App zum Home-Bildschirm hinzufügen.'); return; }
  try {
    const reg=await navigator.serviceWorker.ready;
    const btn=document.getElementById('pushBtn');
    const existing=await reg.pushManager.getSubscription();
    if (existing) {
      await fetch('/api/push/subscribe',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:existing.endpoint})});
      await existing.unsubscribe(); btn.textContent='🔕'; btn.style.opacity='0.6'; return;
    }
    const perm=await Notification.requestPermission();
    if (perm==='denied') { alert('Benachrichtigungen blockiert – bitte in den Einstellungen erlauben.'); return; }
    if (perm!=='granted') return;
    const {key}=await fetch('/api/push/vapid-public-key').then(r=>r.json());
    const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(key)});
    await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub.toJSON())});
    btn.textContent='🔔'; btn.style.opacity='1'; alert('✅ Benachrichtigungen aktiviert!');
  } catch(err) { alert('Fehler: '+err.message); }
}

function escHtml(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Init
(async () => {
  const r = await apiFetch('/api/me');
  if (!r || r.data.role !== 'admin') { window.location.href = '/login.html'; return; }
  initOfflineBanner();
  loadPushSetting();
  loadDocuments();
})();
