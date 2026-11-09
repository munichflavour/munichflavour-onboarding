if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

function escHtml(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function goBack() {
  if (history.length > 1) { history.back(); return; }
  fetch('/api/me').then(r => r.json()).then(me => {
    window.location.href = me.role === 'admin' ? '/admin.html' : '/employee.html';
  }).catch(() => { window.location.href = '/employee.html'; });
}
document.getElementById('backBtn').addEventListener('click', goBack);

// PDFs werden mit pdf.js clientseitig auf <canvas> gerendert statt per <iframe> –
// eingebettete PDF-Vorschauen funktionieren in der installierten iOS-App (WKWebView,
// Standalone-Modus) sonst nicht zuverlässig (bleiben leer/grau).
async function renderPdf(url, container) {
  container.innerHTML = `<div class="view-loading"><span class="spinner"></span></div>`;
  try {
    const pdfjsLib = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const pdf = await pdfjsLib.getDocument(url).promise;
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'pdf-pages';
    container.appendChild(wrap);
    const maxWidth = Math.min(wrap.clientWidth || window.innerWidth, 900) - 24;
    const dpr = window.devicePixelRatio || 1;
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const unscaled = page.getViewport({ scale: 1 });
      const scale = maxWidth / unscaled.width;
      const viewport = page.getViewport({ scale: scale * dpr });
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / dpr}px`;
      canvas.style.height = `${viewport.height / dpr}px`;
      wrap.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
  } catch (err) {
    container.innerHTML = `<div class="view-fallback">
      <p>Vorschau konnte nicht geladen werden.</p>
      <a class="btn btn-primary" href="${url}" download>Datei herunterladen</a>
    </div>`;
  }
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

  if (ext === 'pdf') {
    renderPdf(url, main);
  } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
    main.innerHTML = `<div class="view-media"><img src="${url}" alt="${escHtml(name)}"></div>`;
  } else if (['mp4', 'mov', 'webm'].includes(ext)) {
    main.innerHTML = `<div class="view-media"><video src="${url}" controls playsinline></video></div>`;
  } else if (['mp3', 'wav', 'm4a'].includes(ext)) {
    main.innerHTML = `<div class="view-media"><audio src="${url}" controls></audio></div>`;
  } else {
    main.innerHTML = `<div class="view-fallback">
      <p>Vorschau für diesen Dateityp nicht verfügbar.</p>
      <a class="btn btn-primary" href="${url}" download="${escHtml(name)}">Datei herunterladen</a>
    </div>`;
  }
})();
