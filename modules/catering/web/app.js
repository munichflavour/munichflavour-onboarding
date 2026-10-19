let projects = [];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url) {
  const res = await fetch(url);
  if (res.status === 401 || res.status === 403) { window.location.href = '/login.html'; throw new Error('Nicht angemeldet'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Fehler ${res.status}`);
  return body;
}

function fmtDate(iso) {
  if (!iso) return 'ohne Datum';
  const d = new Date(iso);
  return isNaN(d) ? 'ohne Datum' : d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function render() {
  const q = $('search').value.trim().toLowerCase();
  const today = new Date().setHours(0, 0, 0, 0);
  const list = projects
    .filter(p => !q || (p.name || '').toLowerCase().includes(q) || String(p.number || '').toLowerCase().includes(q))
    // anstehende zuerst (nach Datum), danach vergangene (neueste zuerst), ohne Datum zuletzt
    .sort((a, b) => {
      const ta = a.start ? Date.parse(a.start) : null, tb = b.start ? Date.parse(b.start) : null;
      if (ta === null || tb === null) return (ta === null) - (tb === null);
      const fa = ta >= today, fb = tb >= today;
      if (fa !== fb) return fa ? -1 : 1;
      return fa ? ta - tb : tb - ta;
    })
    .slice(0, 100);
  $('projects').innerHTML = list.length ? list.map(p => `
    <div class="proj">
      <div>
        <div class="proj-name">${esc(p.name)} ${p.sample ? '<span class="pill sample">Testdaten</span>' : ''}</div>
        <div class="proj-meta">Nr. ${esc(p.number ?? '-')} · ${fmtDate(p.start)} · Rentman-ID ${esc(p.id)}</div>
      </div>
      <div><span class="pill">${esc(p.status || '')}</span></div>
    </div>`).join('') : '<div class="note">Keine Projekte gefunden.</div>';
}

async function loadProjects(refresh) {
  $('refreshBtn').disabled = true;
  try {
    const r = await api('/api/catering/projects' + (refresh ? '?refresh=1' : ''));
    projects = r.projects;
    const warn = $('rentmanWarn');
    warn.classList.toggle('hidden', r.configured);
    if (!r.configured) warn.textContent = r.hinweis;
    $('syncInfo').textContent = r.fetchedAt ? 'Letzter Abgleich mit Rentman: ' + new Date(r.fetchedAt).toLocaleString('de-DE') : '';
    render();
  } catch (e) {
    $('projects').innerHTML = `<div class="warn">${esc(e.message)}</div>`;
  } finally {
    $('refreshBtn').disabled = false;
  }
}

$('search').addEventListener('input', render);
$('refreshBtn').addEventListener('click', () => loadProjects(true));
$('diagBtn').addEventListener('click', async () => {
  const id = $('diagId').value.trim();
  const out = $('diagOut');
  out.classList.remove('hidden');
  out.textContent = 'Lädt…';
  try { out.textContent = JSON.stringify(await api('/api/catering/rentman/diagnose/' + encodeURIComponent(id)), null, 2); }
  catch (e) { out.textContent = e.message; }
});

loadProjects(false);
