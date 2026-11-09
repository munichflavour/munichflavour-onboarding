if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

function escHtml(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function goBack() {
  if (history.length > 1) { history.back(); return; }
  fetch('/api/me').then(r => r.json()).then(me => {
    window.location.href = me.role === 'admin' ? '/admin.html' : '/employee.html';
  }).catch(() => { window.location.href = '/employee.html'; });
}

(async () => {
  try {
    const res = await fetch('/api/me');
    if (res.status === 401) { window.location.href = '/login.html'; return; }
  } catch (e) { /* offline – ggf. zwischengespeichertes Dokument trotzdem anzeigen */ }

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const name = params.get('name') || 'Dokument';
  document.getElementById('viewTitle').textContent = name;
  document.title = `${name} – MF Portal`;

  if (!id) {
    document.getElementById('viewMain').innerHTML = `<div class="view-fallback"><p>Kein Dokument angegeben.</p></div>`;
    return;
  }

  const url = `/api/documents/${id}/view`;
  const ext = name.split('.').pop().toLowerCase();
  const main = document.getElementById('viewMain');

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
    main.innerHTML = `<div class="view-media"><img src="${url}" alt="${escHtml(name)}"></div>`;
  } else if (ext === 'pdf') {
    main.innerHTML = `<iframe src="${url}" class="view-frame" title="${escHtml(name)}"></iframe>`;
  } else if (['mp4', 'mov', 'webm'].includes(ext)) {
    main.innerHTML = `<div class="view-media"><video src="${url}" controls></video></div>`;
  } else if (['mp3', 'wav', 'm4a'].includes(ext)) {
    main.innerHTML = `<div class="view-media"><audio src="${url}" controls></audio></div>`;
  } else {
    main.innerHTML = `<div class="view-fallback">
      <p>Vorschau für diesen Dateityp nicht verfügbar.</p>
      <a class="btn btn-primary" href="${url}" download="${escHtml(name)}">Datei herunterladen</a>
    </div>`;
  }
})();
