// Rentman-Übersicht: Projektliste und Diagnose. Ohne Token nur gekennzeichnete Testdaten.
CAT.register('rentman', async root => {
  const { $, esc, api } = CAT;
  root.innerHTML = `
    <div id="rentmanWarn" class="warn-box hidden"></div>
    <div class="card">
      <h2 style="font-size:16px;margin-bottom:8px;">Kommende Projekte</h2>
      <div class="toolbar">
        <input id="search" type="search" placeholder="Projektname oder Nummer" autocomplete="off">
        <button class="btn btn-secondary" id="refreshBtn">Mit Rentman abgleichen</button>
      </div>
      <div id="syncInfo" class="note" style="margin-bottom:8px;"></div>
      <div id="projects"></div>
    </div>
    <div class="card">
      <h2 style="font-size:16px;margin-bottom:8px;">Rentman-Diagnose</h2>
      <p class="note" style="margin-bottom:8px;">Zeigt die Rohdaten eines Projekts (nur lesend), um zu klären, wo Gästezahl, Kunde, Ort und Artikelnummern stehen.</p>
      <div class="toolbar">
        <input id="diagId" type="text" inputmode="numeric" placeholder="Rentman-Projekt-ID">
        <button class="btn btn-secondary" id="diagBtn">Abrufen</button>
      </div>
      <pre id="diagOut" class="pre hidden"></pre>
    </div>`;

  let projects = [];
  const fmtDate = iso => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : 'ohne Datum';
  };
  function render() {
    const q = $('#search').value.trim().toLowerCase();
    const today = new Date().setHours(0, 0, 0, 0);
    const list = projects
      .filter(p => !q || (p.name || '').toLowerCase().includes(q) || String(p.number || '').toLowerCase().includes(q))
      .sort((a, b) => {   // anstehende zuerst, danach vergangene (neueste zuerst), ohne Datum zuletzt
        const ta = a.start ? Date.parse(a.start) : null, tb = b.start ? Date.parse(b.start) : null;
        if (ta === null || tb === null) return (ta === null) - (tb === null);
        const fa = ta >= today, fb = tb >= today;
        if (fa !== fb) return fa ? -1 : 1;
        return fa ? ta - tb : tb - ta;
      }).slice(0, 100);
    $('#projects').innerHTML = list.length ? list.map(p => `
      <div class="row" style="cursor:default">
        <div class="row-main">
          <div class="row-title">${esc(p.name)} ${p.sample ? '<span class="pill sample">Testdaten</span>' : ''}</div>
          <div class="row-meta">Nr. ${esc(p.number ?? '-')} · ${fmtDate(p.start)} · Rentman-ID ${esc(p.id)}</div>
        </div>
        <span class="pill">${esc(p.status || '')}</span>
      </div>`).join('') : '<div class="note">Keine Projekte gefunden.</div>';
  }
  async function load(refresh) {
    $('#refreshBtn').disabled = true;
    try {
      const r = await api('GET', '/projects' + (refresh ? '?refresh=1' : ''));
      projects = r.projects;
      $('#rentmanWarn').classList.toggle('hidden', r.configured);
      if (!r.configured) $('#rentmanWarn').textContent = r.hinweis;
      $('#syncInfo').textContent = r.fetchedAt ? 'Letzter Abgleich mit Rentman: ' + new Date(r.fetchedAt).toLocaleString('de-DE') : '';
      render();
    } catch (e) {
      $('#projects').innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
    } finally { $('#refreshBtn').disabled = false; }
  }
  $('#search').oninput = render;
  $('#refreshBtn').onclick = () => load(true);
  $('#diagBtn').onclick = async () => {
    const out = $('#diagOut');
    out.classList.remove('hidden');
    out.textContent = 'Lädt…';
    try { out.textContent = JSON.stringify(await api('GET', '/rentman/diagnose/' + encodeURIComponent($('#diagId').value.trim())), null, 2); }
    catch (e) { out.textContent = e.message; }
  };
  load(false);
});
