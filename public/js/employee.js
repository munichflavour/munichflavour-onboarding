if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

let allFolders = [], allDocuments = [];
let currentFolderId = null; // null = root
let searchTimeout = null;

const NEW_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage

async function init() {
  const me = await apiFetch('/api/me');
  if (me) document.getElementById('headerSub').textContent = me.full_name;
  await loadDocuments();
  await loadAnnouncements();
  initPushButton();
  initOfflineBanner();
}

async function loadDocuments() {
  const data = await apiFetch('/api/documents');
  if (!data) {
    document.getElementById('fileList').innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><p>Offline – noch keine Dokumente im Zwischenspeicher.</p></div>`;
    return;
  }
  allFolders = data.folders;
  allDocuments = data.documents;
  renderBrowser();
}

// ===== "NEU"-Kennzeichnung =====
function isNew(dateStr) {
  return (Date.now() - Date.parse(dateStr + 'Z')) < NEW_THRESHOLD_MS;
}

function folderHasNew(folderId) {
  const docs = allDocuments.filter(d => d.folder_id === folderId);
  if (docs.some(d => isNew(d.uploaded_at))) return true;
  const children = allFolders.filter(f => f.parent_id === folderId);
  return children.some(c => folderHasNew(c.id));
}

// ===== BROWSER =====
function renderBrowser() {
  const folder = currentFolderId ? allFolders.find(f => f.id === currentFolderId) : null;
  const breadcrumbRow = document.getElementById('breadcrumbRow');
  const folderTitle = document.getElementById('folderTitle');

  if (currentFolderId) {
    breadcrumbRow.classList.remove('hidden');
    folderTitle.textContent = folder?.name || '';
  } else {
    breadcrumbRow.classList.add('hidden');
  }

  // Sub-folders
  const subFolders = allFolders.filter(f => f.parent_id === currentFolderId);
  const subFoldersEl = document.getElementById('subFolders');
  if (subFolders.length) {
    subFoldersEl.innerHTML = `<div class="folder-grid">${subFolders.map(f => {
      const count = allDocuments.filter(d => d.folder_id === f.id).length;
      const childCount = allFolders.filter(c => c.parent_id === f.id).length;
      const total = count + childCount;
      const newDot = folderHasNew(f.id) ? '<span class="new-dot" title="Neue Inhalte"></span>' : '';
      return `<div class="folder-card" onclick="openFolder(${f.id})">
        ${newDot}
        <div class="folder-emoji">📁</div>
        <div class="folder-name">${escHtml(f.name)}</div>
        <div class="folder-count">${total === 0 ? 'Leer' : total === 1 ? '1 Eintrag' : total + ' Einträge'}</div>
      </div>`;
    }).join('')}</div>`;
  } else {
    subFoldersEl.innerHTML = '';
  }

  document.getElementById('fileSection').style.display = '';
  // Files in current folder
  const files = allDocuments.filter(d => d.folder_id === currentFolderId);
  const fileList = document.getElementById('fileList');
  if (!files.length && !subFolders.length) {
    fileList.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Noch keine Dokumente vorhanden.</p></div>`;
  } else if (!files.length) {
    fileList.innerHTML = '';
    document.getElementById('fileSection').style.display = 'none';
    return;
  } else {
    document.getElementById('fileSection').style.display = '';
    fileList.innerHTML = files.map(doc => fileItemHtml(doc)).join('');
  }
}

function openFolder(id) {
  currentFolderId = id;
  renderBrowser();
  window.scrollTo(0, 0);
}

function navigateBack() {
  const current = allFolders.find(f => f.id === currentFolderId);
  currentFolderId = current?.parent_id || null;
  renderBrowser();
  window.scrollTo(0, 0);
}

// ===== SEARCH (Dateiname + Beschreibung) =====
function onSearch(val) {
  clearTimeout(searchTimeout);
  const clear = document.getElementById('searchClear');
  if (!val.trim()) { clearSearch(); return; }
  clear.classList.remove('hidden');
  searchTimeout = setTimeout(() => doSearch(val.trim()), 300);
}

async function doSearch(q) {
  document.getElementById('browserView').classList.add('hidden');
  document.getElementById('searchView').classList.remove('hidden');
  document.getElementById('searchLabel').textContent = `Ergebnisse für „${q}"`;
  const resultsEl = document.getElementById('searchResults');
  resultsEl.innerHTML = '<div style="padding:20px;text-align:center;"><span class="spinner" style="border-color:rgba(0,0,0,0.2);border-top-color:#000;"></span></div>';
  try {
    const res = await fetch(`/api/documents/search?q=${encodeURIComponent(q)}`);
    const docs = await res.json();
    if (!docs.length) {
      resultsEl.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>Keine Dokumente gefunden.</p></div>`;
    } else {
      resultsEl.innerHTML = docs.map(doc => fileItemHtml(doc)).join('');
    }
  } catch (err) {
    resultsEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><p>Suche offline nicht verfügbar.</p></div>`;
  }
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('searchClear').classList.add('hidden');
  document.getElementById('searchView').classList.add('hidden');
  document.getElementById('browserView').classList.remove('hidden');
}

// ===== FILE ITEM =====
function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return '📕';
  if (['doc','docx'].includes(ext)) return '📘';
  if (['xls','xlsx','csv'].includes(ext)) return '📗';
  if (['ppt','pptx'].includes(ext)) return '📙';
  if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return '🖼️';
  if (['mp4','mov','avi','mkv'].includes(ext)) return '🎬';
  if (['mp3','wav','m4a'].includes(ext)) return '🎵';
  if (['zip','rar','7z'].includes(ext)) return '🗜️';
  return '📄';
}

function fileItemHtml(doc) {
  const date = new Date(doc.uploaded_at + 'Z').toLocaleDateString('de-DE');
  const badge = isNew(doc.uploaded_at) ? '<span class="badge-new">Neu</span>' : '';
  return `<div class="file-item">
    <div class="file-type-icon">${fileIcon(doc.original_name)}</div>
    <div class="file-info">
      <div class="file-name" title="${escHtml(doc.original_name)}">${escHtml(doc.original_name)}${badge}</div>
      ${doc.description ? `<div class="file-desc">${escHtml(doc.description)}</div>` : ''}
      <div class="file-meta">${date}</div>
    </div>
    <div class="file-actions">
      <a href="/api/documents/${doc.id}/view" target="_blank" class="file-btn file-btn-view" title="Ansehen">👁</a>
      <a href="/api/documents/${doc.id}/download" class="file-btn file-btn-dl" title="Herunterladen">⬇</a>
    </div>
  </div>`;
}

// ===== ANKÜNDIGUNGEN =====
let allAnnouncements = [];
let announcementsExpanded = false;

async function loadAnnouncements() {
  const data = await apiFetch('/api/announcements');
  if (!data) return;
  allAnnouncements = data;
  renderAnnouncements();
}

function renderAnnouncements() {
  const section = document.getElementById('announcementsSection');
  const list = document.getElementById('announcementsList');
  const moreBtn = document.getElementById('announcementsMore');
  if (!allAnnouncements.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  const visible = announcementsExpanded ? allAnnouncements : allAnnouncements.slice(0, 3);
  list.innerHTML = visible.map(a => announcementHtml(a)).join('');
  if (allAnnouncements.length > 3) {
    moreBtn.classList.remove('hidden');
    moreBtn.textContent = announcementsExpanded ? 'Weniger anzeigen' : `Weitere ${allAnnouncements.length - 3} anzeigen`;
  } else {
    moreBtn.classList.add('hidden');
  }
}

function toggleAnnouncements() {
  announcementsExpanded = !announcementsExpanded;
  renderAnnouncements();
}

function announcementHtml(a) {
  const date = new Date(a.created_at + 'Z').toLocaleDateString('de-DE');
  return `<div class="announcement-card">
    <div class="announcement-title">📢 ${escHtml(a.title)}</div>
    ${a.body ? `<div class="announcement-body">${escHtml(a.body)}</div>` : ''}
    <div class="announcement-date">${date}</div>
  </div>`;
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

// ===== PUSH =====
function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + pad).replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from([...atob(base64)].map(c => c.charCodeAt(0)));
}
async function initPushButton() {
  const btn = document.getElementById('pushBtn');
  if (!btn || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  btn.style.display = '';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub && Notification.permission === 'granted') {
      btn.textContent = '🔔'; btn.style.opacity = '1';
      await fetch('/api/push/subscribe', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(sub.toJSON()) });
    } else { btn.textContent = '🔕'; btn.style.opacity = '0.6'; }
  } catch(e) { btn.style.display = 'none'; }
}
async function togglePush() {
  if (!('PushManager' in window)) { alert('Push-Benachrichtigungen werden von diesem Browser nicht unterstützt.\n\nAuf iOS: App zum Home-Bildschirm hinzufügen.'); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const btn = document.getElementById('pushBtn');
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await fetch('/api/push/subscribe', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ endpoint: existing.endpoint }) });
      await existing.unsubscribe();
      btn.textContent = '🔕'; btn.style.opacity = '0.6'; return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'denied') { alert('Benachrichtigungen blockiert – bitte in den Browser-Einstellungen erlauben.'); return; }
    if (perm !== 'granted') return;
    const { key } = await fetch('/api/push/vapid-public-key').then(r => r.json());
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    await fetch('/api/push/subscribe', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(sub.toJSON()) });
    btn.textContent = '🔔'; btn.style.opacity = '1';
    alert('✅ Benachrichtigungen aktiviert!');
  } catch(err) { alert('Fehler: ' + err.message); }
}

async function logout() { await fetch('/api/logout', { method:'POST' }); window.location.href = '/login.html'; }

async function apiFetch(url) {
  try {
    const res = await fetch(url);
    if (res.status === 401) { window.location.href = '/login.html'; return null; }
    return await res.json();
  } catch (err) {
    return null; // offline / Netzwerkfehler – Aufrufer zeigt ggf. zwischengespeicherte Inhalte
  }
}

function escHtml(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

init();
