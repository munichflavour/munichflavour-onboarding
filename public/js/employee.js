let checklist = [];
let selectedEmpFile = null;
let empSigPad = null;
let activeClothingRecord = null;
let activeClothingAction = null; // 'sign' or 'return-sign'

if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(() => {}); }

function showTab(tab) {
  ['checklist','clothing','documents'].forEach(t => {
    document.getElementById(`view-${t}`).classList.toggle('hidden', t !== tab);
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'documents') loadDocuments();
  if (tab === 'clothing') loadClothing();
}

async function init() {
  const me = await apiFetch('/api/me');
  if (!me) return;
  document.getElementById('headerSub').textContent = me.full_name;
  await loadChecklist();
}

// ===== CHECKLIST =====
async function loadChecklist() {
  const items = await apiFetch('/api/employee/checklist');
  if (!items) return;
  checklist = items;
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('progressCard').classList.remove('hidden');
  const confirmed = items.filter(i => i.progress?.confirmed_at).length;
  const total = items.length;
  document.getElementById('progressFraction').textContent = `${confirmed}/${total} bestätigt`;
  document.getElementById('progressFill').style.width = total ? `${Math.round(confirmed/total*100)}%` : '0%';
  if (confirmed === total && total > 0) document.getElementById('completionBanner').classList.remove('hidden');
  else document.getElementById('completionBanner').classList.add('hidden');
  renderChecklist(items);
}

function renderChecklist(items) {
  const container = document.getElementById('checklistContainer');
  container.innerHTML = '';
  items.forEach(item => {
    const p = item.progress;
    const isConfirmed = !!p?.confirmed_at;
    const isCompleted = !!p?.completed_at;
    const el = document.createElement('div');
    el.className = 'checklist-item' + (isConfirmed ? ' completed' : '');
    let statusIcon = isConfirmed ? '✓' : (isCompleted ? '⏳' : '');
    let actionBtn = '';
    if (!isConfirmed && !isCompleted) actionBtn = `<button class="btn btn-secondary btn-sm" onclick="completeItem(${item.id}, event)">Abhaken</button>`;
    else if (isCompleted && !isConfirmed) actionBtn = `<button class="btn btn-secondary btn-sm" onclick="uncompleteItem(${item.id})" style="font-size:12px;">Rückgängig</button>`;
    let metaHtml = '';
    if (isConfirmed) {
      metaHtml = `<div class="item-meta">
        <span class="meta-badge">✓ Erledigt: ${new Date(p.completed_at+'Z').toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'})}</span>
        <span class="meta-badge" style="background:#000;color:#fff;">✓ Bestätigt: ${new Date(p.confirmed_at+'Z').toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'})} von ${escHtml(p.confirmed_by)}</span>
      </div>`;
    } else if (isCompleted) {
      metaHtml = `<div class="item-meta"><span class="meta-badge" style="background:#fff8e1;border:1px solid #f0c040;">⏳ Erledigt am ${new Date(p.completed_at+'Z').toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'})} – wartet auf Bestätigung</span></div>`;
    }
    el.innerHTML = `
      <div class="checklist-item-header">
        <div class="status-icon" style="${isConfirmed?'':''}${isCompleted&&!isConfirmed?'border-color:#f0c040;color:#b8860b;':''}">${statusIcon}</div>
        <div style="flex:1;min-width:0;">
          <div class="item-title">${escHtml(item.title)}</div>
          ${item.description?`<div class="item-desc">${escHtml(item.description)}</div>`:''}
        </div>
        ${actionBtn}
      </div>${metaHtml}`;
    container.appendChild(el);
  });
}

async function completeItem(itemId, event) {
  const btn = event.target; btn.disabled = true;
  const res = await fetch(`/api/employee/checklist/${itemId}/complete`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
  btn.disabled = false;
  if (res.ok) await loadChecklist(); else { const d=await res.json(); alert(d.error||'Fehler'); }
}
async function uncompleteItem(itemId) {
  if (!confirm('Abhakung rückgängig machen?')) return;
  const res = await fetch(`/api/employee/checklist/${itemId}/uncomplete`, { method:'POST' });
  if (res.ok) await loadChecklist(); else { const d=await res.json(); alert(d.error||'Fehler'); }
}

// ===== CLOTHING =====
async function loadClothing() {
  const records = await apiFetch('/api/employee/clothing');
  if (!records) return;
  const container = document.getElementById('clothingContainer');
  if (!records.length) {
    container.innerHTML = '<div class="card" style="text-align:center;padding:32px;color:#888;font-size:14px;">Noch keine Kleidung ausgegeben.</div>';
    return;
  }
  container.innerHTML = '';
  records.forEach(rec => {
    const needsEmpSign = rec.admin_signed_at && !rec.employee_signed_at;
    const needsReturnSign = rec.return_admin_signed_at && !rec.return_employee_signed_at;
    const returned = !!rec.returned_at && rec.return_admin_signed_at && rec.return_employee_signed_at;
    const card = document.createElement('div');
    card.className = 'clothing-card' + (needsEmpSign||needsReturnSign?' needs-sign':'') + (returned?' returned':'');

    let statusHtml = '';
    if (returned) statusHtml = '<span style="background:#000;color:#fff;border-radius:4px;padding:3px 10px;font-size:13px;">✓ Zurückgegeben</span>';
    else if (needsReturnSign) statusHtml = '<span style="background:#f0c040;border-radius:4px;padding:3px 10px;font-size:13px;font-weight:600;">✍ Rückgabe unterschreiben</span>';
    else if (needsEmpSign) statusHtml = '<span style="background:#f0c040;border-radius:4px;padding:3px 10px;font-size:13px;font-weight:600;">✍ Erhalt bestätigen</span>';
    else if (!returned) statusHtml = '<span style="background:#e8f5e9;color:#2e7d32;border-radius:4px;padding:3px 10px;font-size:13px;">✓ Ausgegeben</span>';

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
        <div>
          <div style="font-weight:700;font-size:15px;">Ausgabe ${new Date(rec.issued_at+'Z').toLocaleDateString('de-DE')}</div>
          <div style="margin-top:4px;">${statusHtml}</div>
        </div>
        <a href="/api/clothing/${rec.id}/pdf" class="btn btn-secondary btn-sm">PDF</a>
      </div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:12px;">
        <tr style="background:#f5f5f5;"><th style="padding:6px;text-align:left;">Kleidungsstück</th><th style="padding:6px;">Größe</th><th style="padding:6px;">Anzahl</th>${returned?'<th style="padding:6px;">Zurück</th>':''}</tr>
        ${rec.items.map(it=>`<tr><td style="padding:6px;">${escHtml(it.name)}</td><td style="padding:6px;text-align:center;">${escHtml(it.size||'-')}</td><td style="padding:6px;text-align:center;">${it.quantity}</td>${returned?`<td style="padding:6px;text-align:center;">${it.returned?'✓':'✗'}</td>`:''}</tr>`).join('')}
      </table>
      ${rec.fee_applicable ? '<div style="color:red;font-weight:700;font-size:13px;margin-bottom:8px;">⚠ Fehlende Stücke – Gebühr fällig</div>' : ''}
      ${needsEmpSign ? `<button class="btn btn-primary btn-full" onclick="openClothingSignModal(${rec.id},'sign')">✍ Erhalt mit Unterschrift bestätigen</button>` : ''}
      ${needsReturnSign ? `<button class="btn btn-primary btn-full" onclick="openClothingSignModal(${rec.id},'return-sign')">✍ Rückgabe mit Unterschrift bestätigen</button>` : ''}`;
    container.appendChild(card);
  });
}

function openClothingSignModal(recordId, action) {
  activeClothingRecord = recordId;
  activeClothingAction = action;
  const isReturn = action === 'return-sign';
  document.getElementById('clothingSignTitle').textContent = isReturn ? 'Rückgabe bestätigen' : 'Erhalt bestätigen';
  document.getElementById('clothingSignDesc').textContent = isReturn ? 'Bitte bestätige die Rückgabe der Arbeitskleidung mit deiner Unterschrift.' : 'Bitte bestätige den Erhalt der Arbeitskleidung mit deiner Unterschrift.';
  document.getElementById('clothingSignError').classList.add('hidden');
  document.getElementById('clothingSignModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    const canvas = document.getElementById('empClothingSigCanvas');
    canvas.width = canvas.parentElement.clientWidth || 400;
    canvas.height = 150;
    if (empSigPad) empSigPad.off();
    empSigPad = new SignaturePad(canvas, { penColor: '#000' });
    empSigPad.addEventListener('beginStroke', () => { document.getElementById('empClothingSigHint').style.display='none'; });
  }, 100);
}
function closeClothingSignModal() { document.getElementById('clothingSignModal').classList.add('hidden'); document.body.style.overflow=''; empSigPad=null; }
function clearEmpSig() { if (empSigPad) { empSigPad.clear(); document.getElementById('empClothingSigHint').style.display=''; } }

async function submitClothingSign() {
  const errEl = document.getElementById('clothingSignError'); errEl.classList.add('hidden');
  if (!empSigPad || empSigPad.isEmpty()) { errEl.textContent='Bitte Unterschrift zeichnen.'; errEl.classList.remove('hidden'); return; }
  const sig = empSigPad.toDataURL('image/png');
  const url = activeClothingAction === 'return-sign' ? `/api/employee/clothing/${activeClothingRecord}/return-sign` : `/api/employee/clothing/${activeClothingRecord}/sign`;
  const body = activeClothingAction === 'return-sign' ? { return_employee_signature: sig } : { employee_signature: sig };
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (res.ok) { closeClothingSignModal(); loadClothing(); }
  else { const d=await res.json(); errEl.textContent=d.error||'Fehler'; errEl.classList.remove('hidden'); }
}

// ===== DOCUMENTS =====
async function loadDocuments() {
  const [docsRes, uploadsRes] = await Promise.all([
    fetch('/api/documents').then(r=>r.json()),
    fetch('/api/employee/uploads').then(r=>r.json())
  ]);
  renderAdminDocs(docsRes);
  renderMyUploads(uploadsRes);
}

function renderAdminDocs(data) {
  const container = document.getElementById('adminDocsContainer');
  const { folders, documents } = data;
  if (!folders.length && !documents.length) { container.innerHTML='<div style="padding:24px;text-align:center;color:#888;font-size:14px;">Noch keine Dokumente verfügbar.</div>'; return; }
  container.innerHTML = '';
  const renderFolder = (folder) => {
    const children = folders.filter(f=>f.parent_id===folder.id);
    const docs = documents.filter(d=>d.folder_id===folder.id);
    const section = document.createElement('div');
    section.style.borderBottom='1px solid var(--gray-mid)';
    section.style.padding='0 16px';
    const label = document.createElement('div'); label.className='folder-label';
    label.innerHTML=`<span>📁</span><span>${escHtml(folder.name)}</span>`;
    const content = document.createElement('div'); content.style.paddingLeft='12px';
    let collapsed=false;
    label.addEventListener('click',()=>{ collapsed=!collapsed; content.style.display=collapsed?'none':''; label.querySelector('span').textContent=collapsed?'📁':'📂'; });
    children.forEach(c=>content.appendChild(renderFolder(c)));
    docs.forEach(d=>content.appendChild(renderDocRow(d)));
    if (!children.length&&!docs.length) { const e=document.createElement('div'); e.style.cssText='padding:8px 0 12px;font-size:13px;color:#aaa;'; e.textContent='Leer'; content.appendChild(e); }
    section.appendChild(label); section.appendChild(content); return section;
  };
  const renderDocRow = (doc) => {
    const el=document.createElement('div'); el.className='doc-row';
    el.innerHTML=`
      <span class="doc-row-icon">📄</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(doc.original_name)}</div>
        <div style="font-size:12px;color:#888;margin-top:2px;">${new Date(doc.uploaded_at+'Z').toLocaleDateString('de-DE')}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
        <a href="/api/documents/${doc.id}/view" target="_blank" class="btn btn-primary btn-sm" style="font-size:13px;padding:8px 12px;">Anzeigen</a>
        <a href="/api/documents/${doc.id}/download" class="btn btn-secondary btn-sm" style="font-size:13px;padding:8px 12px;">⬇ Download</a>
      </div>`;
    return el;
  };
  folders.filter(f=>!f.parent_id).forEach(f=>container.appendChild(renderFolder(f)));
  documents.filter(d=>!d.folder_id).forEach(d=>container.appendChild(renderDocRow(d)));
}

function renderMyUploads(uploads) {
  const container = document.getElementById('myUploadsContainer');
  if (!uploads.length) { container.innerHTML='<div style="padding:16px;text-align:center;color:#888;font-size:14px;">Noch keine Uploads.</div>'; return; }
  container.innerHTML = uploads.map(u=>`
    <div class="doc-row">
      <span class="doc-row-icon">📄</span>
      <span class="doc-row-name">${escHtml(u.original_name)}</span>
      <span class="doc-row-date">${new Date(u.uploaded_at+'Z').toLocaleDateString('de-DE')}</span>
      <a href="/api/employee/uploads/${u.id}/download" class="btn btn-secondary btn-sm">⬇</a>
      <button class="btn btn-danger btn-sm" onclick="deleteMyUpload(${u.id})">🗑</button>
    </div>`).join('');
}

function onEmpFileSelected(input) { selectedEmpFile=input.files[0]; document.getElementById('empFileName').textContent=selectedEmpFile?selectedEmpFile.name:''; document.getElementById('empUploadBtn').disabled=!selectedEmpFile; }
async function uploadEmpFile() {
  const errEl=document.getElementById('empUploadError'); errEl.classList.add('hidden');
  if (!selectedEmpFile) return;
  const btn=document.getElementById('empUploadBtn'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  const formData=new FormData(); formData.append('file',selectedEmpFile);
  const res=await fetch('/api/employee/uploads',{method:'POST',body:formData});
  btn.disabled=false; btn.textContent='Hochladen';
  if (res.ok) { selectedEmpFile=null; document.getElementById('empFileName').textContent=''; document.getElementById('empFileInput').value=''; document.getElementById('empUploadBtn').disabled=true; loadDocuments(); }
  else { const d=await res.json(); errEl.textContent=d.error||'Fehler'; errEl.classList.remove('hidden'); }
}
async function deleteMyUpload(id) { if (!confirm('Upload löschen?')) return; const res=await fetch(`/api/employee/uploads/${id}`,{method:'DELETE'}); if(res.ok) loadDocuments(); }

const empUploadZone=document.getElementById('empUploadZone');
empUploadZone.addEventListener('dragover',e=>{e.preventDefault();empUploadZone.classList.add('dragover');});
empUploadZone.addEventListener('dragleave',()=>empUploadZone.classList.remove('dragover'));
empUploadZone.addEventListener('drop',e=>{e.preventDefault();empUploadZone.classList.remove('dragover');const f=e.dataTransfer.files[0];if(f){selectedEmpFile=f;document.getElementById('empFileName').textContent=f.name;document.getElementById('empUploadBtn').disabled=false;}});

document.getElementById('clothingSignModal').addEventListener('click',e=>{ if(e.target.id==='clothingSignModal') closeClothingSignModal(); });

async function logout() { await fetch('/api/logout',{method:'POST'}); window.location.href='/login.html'; }
async function apiFetch(url) { const res=await fetch(url); if(res.status===401){window.location.href='/login.html';return null;} return res.json(); }
function escHtml(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

init();
