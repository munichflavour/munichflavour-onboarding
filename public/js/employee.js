if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

let allFolders = [], allDocuments = [];
let currentFolderId = null; // null = root
let searchTimeout = null;

const NEW_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage

let previousLoginAt = null;

async function init() {
  const me = await apiFetch('/api/me');
  if (me) {
    document.getElementById('headerSub').textContent = me.full_name;
    previousLoginAt = me.previousLoginAt;
  }
  await loadDocuments();
  await loadAnnouncements();
  await loadOvertime();
  renderVisitSummary();
  initPushButton();
  initOfflineBanner();
}

// ===== "SEIT DEINEM LETZTEN BESUCH" =====
function renderVisitSummary() {
  const el = document.getElementById('visitSummary');
  if (!el || !previousLoginAt) { if (el) el.classList.add('hidden'); return; }
  const since = Date.parse(previousLoginAt + 'Z');
  const newDocs = allDocuments.filter(d => Date.parse(d.uploaded_at + 'Z') > since).length;
  const newAnns = allAnnouncements.filter(a => Date.parse(a.created_at + 'Z') > since).length;
  if (!newDocs && !newAnns) { el.classList.add('hidden'); return; }
  const parts = [];
  if (newDocs) parts.push(`${newDocs} ${newDocs === 1 ? 'neues Dokument' : 'neue Dokumente'}`);
  if (newAnns) parts.push(`${newAnns} ${newAnns === 1 ? 'neue Ankündigung' : 'neue Ankündigungen'}`);
  el.textContent = `${parts.join(', ')} seit deinem letzten Besuch`;
  el.classList.remove('hidden');
}

// ===== ÜBERSTUNDENKONTO =====
function formatHours(hours) {
  const sign = hours > 0 ? '+' : '';
  return `${sign}${Number(hours).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} Std.`;
}
async function loadOvertime() {
  const data = await apiFetch('/api/overtime');
  const card = document.getElementById('overtimeCard');
  if (!data) { card.classList.add('hidden'); return; }
  document.getElementById('overtimeValue').textContent = formatHours(data.hours);
  document.getElementById('overtimeDate').textContent = `Stand: ${new Date(data.updated_at + 'Z').toLocaleDateString('de-DE')}`;
  const historyToggle = document.getElementById('overtimeHistoryToggle');
  const historyList = document.getElementById('overtimeHistoryList');
  if (data.history && data.history.length) {
    historyToggle.classList.remove('hidden');
    historyList.innerHTML = data.history.map(h => `<div class="overtime-history-row">
      <span>${new Date(h.created_at + 'Z').toLocaleDateString('de-DE')}${h.note ? ' · ' + escHtml(h.note) : ''}</span>
      <span>${formatHours(h.hours)}</span>
    </div>`).join('');
  } else {
    historyToggle.classList.add('hidden');
    historyList.classList.add('hidden');
  }
  card.classList.remove('hidden');
}
function toggleOvertimeHistory() {
  document.getElementById('overtimeHistoryList').classList.toggle('hidden');
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
  updateAnnouncementsVisibility();

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
    subFoldersEl.innerHTML = `<div class="folder-list">${subFolders.map(f => {
      const count = allDocuments.filter(d => d.folder_id === f.id).length;
      const childCount = allFolders.filter(c => c.parent_id === f.id).length;
      const total = count + childCount;
      const newDot = folderHasNew(f.id) ? '<span class="list-row-dot" title="Neue Inhalte"></span>' : '';
      return `<div class="list-row" onclick="openFolder(${f.id})">
        <div class="icon-badge">📁</div>
        <div class="list-row-info">
          <div class="list-row-title">${escHtml(f.name)}</div>
          <div class="list-row-sub">${total === 0 ? 'Leer' : total === 1 ? '1 Eintrag' : total + ' Einträge'}</div>
        </div>
        ${newDot}
        <span class="list-row-chevron">›</span>
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
  resultsEl.innerHTML = '<div style="padding:20px;text-align:center;"><span class="spinner"></span></div>';
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
  if (['pdf'].includes(ext)) return '📄';
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
  return `<a href="/view.html?id=${doc.id}&name=${encodeURIComponent(doc.original_name)}" class="file-item" title="Ansehen">
    <div class="file-type-icon">${fileIcon(doc.original_name)}</div>
    <div class="file-info">
      <div class="file-name" title="${escHtml(doc.original_name)}">${escHtml(doc.original_name)}${badge}</div>
      ${doc.description ? `<div class="file-desc">${escHtml(doc.description)}</div>` : ''}
      <div class="file-meta">${date}</div>
    </div>
    <span class="list-row-chevron">›</span>
  </a>`;
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

// Ankündigungen nur auf der Startseite zeigen – stören sonst beim Stöbern in Ordnern.
function updateAnnouncementsVisibility() {
  document.getElementById('announcementsSection').classList.toggle('hidden', !allAnnouncements.length || !!currentFolderId);
}

function renderAnnouncements() {
  const list = document.getElementById('announcementsList');
  const moreBtn = document.getElementById('announcementsMore');
  updateAnnouncementsVisibility();
  if (!allAnnouncements.length) return;
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
  const confirmArea = a.requires_confirmation
    ? (a.confirmed
        ? `<div class="announcement-confirmed">✓ Bestätigt</div>`
        : `<button class="btn btn-primary btn-sm" style="margin-top:8px;" onclick="confirmAnnouncement(${a.id})">Bestätigen</button>`)
    : '';
  return `<div class="announcement-card">
    <div class="announcement-title">📢 ${escHtml(a.title)}</div>
    ${a.body ? `<div class="announcement-body">${escHtml(a.body)}</div>` : ''}
    <div class="announcement-date">${date}</div>
    ${confirmArea}
  </div>`;
}
async function confirmAnnouncement(id) {
  const r = await apiFetch(`/api/announcements/${id}/confirm`, { method: 'POST' });
  if (!r?.ok) { alert('Fehler beim Bestätigen'); return; }
  const a = allAnnouncements.find(x => x.id === id);
  if (a) a.confirmed = true;
  renderAnnouncements();
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
    } else {
      btn.textContent = '🔕'; btn.style.opacity = '0.6';
      updatePushReminderBanner();
    }
  } catch(e) { btn.style.display = 'none'; }
}

// ===== PUSH-ERINNERUNGS-BANNER =====
// Erinnert Mitarbeiter ohne aktivierte Benachrichtigungen, diese einzuschalten. Ein
// Ausblenden wird 7 Tage im Browser gemerkt, danach taucht der Hinweis wieder auf.
const PUSH_BANNER_DISMISS_KEY = 'pushReminderDismissedUntil';
function updatePushReminderBanner() {
  const banner = document.getElementById('pushReminderBanner');
  if (!banner) return;
  try {
    const dismissedUntil = Number(localStorage.getItem(PUSH_BANNER_DISMISS_KEY) || 0);
    if (Date.now() < dismissedUntil) return;
  } catch (e) { /* localStorage evtl. nicht verfügbar – Banner trotzdem zeigen */ }
  banner.classList.remove('hidden');
}
function dismissPushBanner() {
  const banner = document.getElementById('pushReminderBanner');
  if (banner) banner.classList.add('hidden');
  try { localStorage.setItem(PUSH_BANNER_DISMISS_KEY, String(Date.now() + 7*24*60*60*1000)); } catch (e) {}
}
async function enablePushFromBanner() {
  await togglePush();
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub && Notification.permission === 'granted') {
    const banner = document.getElementById('pushReminderBanner');
    if (banner) banner.classList.add('hidden');
  }
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

async function apiFetch(url, opts) {
  try {
    const res = await fetch(url, opts);
    if (res.status === 401) { window.location.href = '/login.html'; return null; }
    if (!opts) return await res.json();
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : {};
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return null; // offline / Netzwerkfehler – Aufrufer zeigt ggf. zwischengespeicherte Inhalte
  }
}

function escHtml(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

init();
