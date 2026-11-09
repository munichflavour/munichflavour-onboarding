// Lieferantenverwaltung (Basis; Gebindegrößen je Lieferant folgen in Phase 5)
CAT.register('lieferanten', async root => {
  const { $, esc, api, field, modal, toast } = CAT;
  let items = [];
  root.innerHTML = `
    <div class="card">
      <div class="toolbar"><div class="note" style="flex:1">Standardlieferanten werden bei den Zutaten ausgewählt.</div>
        <button class="btn btn-primary" id="newBtn">Neuer Lieferant</button></div>
      <label style="display:flex;gap:8px;align-items:center;text-transform:none;font-weight:400;margin-bottom:8px;">
        <input type="checkbox" id="showArchived" style="width:20px;height:20px"> Archivierte anzeigen</label>
      <div id="list"></div>
    </div>`;
  const render = () => {
    $('#list').innerHTML = items.length ? items.map(s => `
      <div class="row" data-id="${s.id}"><div class="row-main">
        <div class="row-title">${esc(s.name)} ${s.archived ? '<span class="pill">archiviert</span>' : ''}</div>
        <div class="row-meta">${esc(s.contact || 'keine Kontaktdaten')}</div></div></div>`).join('') : '<div class="note">Noch keine Lieferanten angelegt.</div>';
    CAT.$$('.row', root).forEach(r => r.onclick = () => edit(items.find(s => String(s.id) === r.dataset.id)));
  };
  const load = async () => { items = await api('GET', '/suppliers' + ($('#showArchived').checked ? '?archived=1' : '')); render(); };
  function edit(s) {
    const isNew = !s;
    s = s || {};
    const m = modal(isNew ? 'Neuer Lieferant' : 'Lieferant bearbeiten',
      field('Name', `<input type="text" id="s-name" value="${esc(s.name)}" maxlength="120">`) +
      field('Kontaktdaten', `<textarea id="s-contact" maxlength="500">${esc(s.contact)}</textarea>`) +
      field('Bemerkung', `<textarea id="s-note" maxlength="1000">${esc(s.note)}</textarea>`), {
      extraButtons: isNew ? '' : `<button class="btn btn-secondary" data-archive>${s.archived ? 'Wiederherstellen' : 'Archivieren'}</button>`,
      onSave: async () => {
        const body = { name: $('#s-name').value, contact: $('#s-contact').value, note: $('#s-note').value, rev: s.rev };
        await (isNew ? api('POST', '/suppliers', body) : api('PUT', '/suppliers/' + s.id, body));
        toast('Gespeichert'); await load(); return true;
      },
    });
    const arch = CAT.$('[data-archive]', m.el);
    if (arch) arch.onclick = async () => {
      try { await api('POST', `/suppliers/${s.id}/archive`, { archived: !s.archived }); m.close(); await load(); } catch (e) { m.showError(e.message); }
    };
  }
  $('#showArchived').onchange = load;
  $('#newBtn').onclick = () => edit(null);
  await load();
});
