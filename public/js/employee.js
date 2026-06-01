let checklist = [];
let sigPad = null;
let activeItemId = null;

async function init() {
  const me = await apiFetch('/api/me');
  if (!me) return;
  document.getElementById('headerSub').textContent = me.full_name;
  await loadChecklist();
}

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
    el.id = `item-${item.id}`;

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
        </div>` : ''}
    `;
    container.appendChild(el);
  });
}

function openSignModal(itemId) {
  activeItemId = itemId;
  const item = checklist.find(i => i.id === itemId);
  document.getElementById('signItemTitle').textContent = item?.title || '';
  document.getElementById('supervisorName').value = '';
  document.getElementById('signError').classList.add('hidden');
  document.getElementById('signModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Init signature pad after modal is visible
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
  if (sigPad) {
    sigPad.clear();
    document.getElementById('sigHint').style.display = '';
  }
}

async function confirmSign() {
  const errEl = document.getElementById('signError');
  errEl.classList.add('hidden');

  const name = document.getElementById('supervisorName').value.trim();
  if (!name) {
    errEl.textContent = 'Bitte den Namen des Vorgesetzten eintragen.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!sigPad || sigPad.isEmpty()) {
    errEl.textContent = 'Bitte eine Unterschrift zeichnen.';
    errEl.classList.remove('hidden');
    return;
  }

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

  if (res.ok) {
    closeSignModal();
    await loadChecklist();
  } else {
    const data = await res.json();
    errEl.textContent = data.error || 'Fehler beim Speichern.';
    errEl.classList.remove('hidden');
  }
}

async function downloadPDF() {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Wird erstellt…';
  try {
    const res = await fetch('/api/employee/report/pdf');
    if (!res.ok) {
      const d = await res.json();
      alert(d.error || 'PDF-Fehler');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'onboarding-report.pdf';
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    btn.disabled = false;
    btn.textContent = 'PDF herunterladen';
  }
}

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

// Close modal on backdrop click
document.getElementById('signModal').addEventListener('click', e => {
  if (e.target === document.getElementById('signModal')) closeSignModal();
});

init();
