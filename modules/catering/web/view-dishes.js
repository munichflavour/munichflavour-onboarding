// Speisenkatalog: Füllmenge pro Glas, Gebinde, Lieferant, Garnitur, bestätigte Rentman-Namen
CAT.register('speisen', async root => {
  const { $, $$, esc, fmt, api, field, options, unitOptions, modal, confirmDialog, toast } = CAT;
  let suppliers = await api('GET', '/suppliers');
  let dishes = [];

  root.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <input id="q" type="search" placeholder="Speise suchen" autocomplete="off">
        <button class="btn btn-primary" id="newBtn">Neue Speise</button>
      </div>
      <div id="hint"></div>
      <label style="display:flex;gap:8px;align-items:center;text-transform:none;font-weight:400;margin-bottom:8px;">
        <input type="checkbox" id="showArchived" style="width:20px;height:20px"> Archivierte anzeigen</label>
      <div id="list"></div>
    </div>`;

  const render = () => {
    const q = $('#q').value.trim().toLowerCase();
    const list = dishes.filter(d => !q || d.name.toLowerCase().includes(q));
    $('#hint').innerHTML = dishes.length ? '' : `<div class="warn-box">Noch keine Speisen angelegt. Du kannst die Salate der Menükarte vom 20.10. anlegen
      (Gebinde und Artikelnummern aus dem Kugler-Shop, Füllmengen aus der Bestellübersicht zurückgerechnet, bitte prüfen) oder eine neue Speise erfassen.
      <div style="margin-top:8px"><button class="btn btn-secondary btn-sm" id="exampleBtn">Salate (Kugler) anlegen</button></div></div>`;
    const ex = $('#exampleBtn');
    if (ex) ex.onclick = async () => {
      ex.disabled = true;
      try { const r = await api('POST', '/dishes/import-example'); toast(`${r.created.length} Speisen angelegt`); await load(); } catch (e) { toast(e.message); ex.disabled = false; }
    };
    $('#list').innerHTML = list.length ? list.map(d => `
      <div class="row" data-id="${d.id}">
        <div class="row-main">
          <div class="row-title">${esc(d.name)} ${d.archived ? '<span class="pill">archiviert</span>' : ''}</div>
          <div class="row-meta">${esc(d.supplierName || 'ohne Lieferant')}${d.articleNo ? ' (Art. ' + esc(d.articleNo) + ')' : ''} · ${d.garnish.length ? 'Garnitur: ' + esc(d.garnish.map(g => g.name).join(', ')) : 'ohne Garnitur'}</div>
        </div>
        <div style="text-align:right">
          <span class="pill ${d.fillGrams ? '' : 'warn'}">${d.fillGrams ? esc(fmt(d.fillGrams)) + ' g pro Glas' : 'Füllmenge fehlt'}</span>
          <div class="row-meta">${d.stepGrams ? 'Gebinde ' + esc(fmt(d.stepGrams)) + ' g' : 'kein Gebinde'}</div>
        </div>
      </div>`).join('') : (dishes.length ? '<div class="note">Keine Speisen gefunden.</div>' : '');
    $$('.row', root).forEach(r => r.onclick = () => edit(dishes.find(d => String(d.id) === r.dataset.id)));
  };
  const load = async () => { dishes = await api('GET', '/dishes' + ($('#showArchived').checked ? '?archived=1' : '')); render(); };

  const garnishRow = (g = {}) => `
    <div class="line" data-garnish>
      <div class="line-grid">
        <div class="span2"><label>Garnitur / Beilage</label><input type="text" data-g="name" value="${esc(g.name)}" maxlength="100"></div>
        <div><label>Menge pro Glas</label><input type="text" inputmode="decimal" data-g="qtyPerGlass" value="${esc(fmt(g.qtyPerGlass))}" placeholder="offen"></div>
        <div><label>Einheit</label><select data-g="unit">${unitOptions(g.unit || 'stk', ['stk', 'g', 'kg', 'ml', 'l', 'pkg'])}</select></div>
        <div><label>Gebinde (Einheit)</label><input type="text" inputmode="decimal" data-g="packSize" value="${esc(fmt(g.packSize))}" placeholder="keins"></div>
        <div class="span2"><label>Lieferant</label><select data-g="supplierId">${options(suppliers.map(s => [s.id, s.name]), g.supplierId, 'ohne Lieferant')}</select></div>
        <div><button class="btn btn-secondary btn-sm" data-rm style="width:100%">Entfernen</button></div>
      </div>
    </div>`;

  async function edit(d) {
    // Lieferanten frisch laden: Sie können sich seit dem Öffnen der Seite geändert haben (z. B. durch das Anlegen des Katalogs).
    // Mit veralteter Liste würde beim Speichern der Lieferant der Speise verloren gehen.
    try { suppliers = await api('GET', '/suppliers'); } catch (e) { toast(e.message); return; }
    const isNew = !d;
    d = d || { garnish: [], aliases: [] };
    const m = modal(isNew ? 'Neue Speise' : 'Speise bearbeiten', `
      ${field('Name der Speise', `<input type="text" id="d-name" value="${esc(d.name)}" maxlength="120">`)}
      <div class="grid2">
        ${field('Lieferant', `<select id="d-supplier">${options(suppliers.map(s => [s.id, s.name]), d.supplierId, 'ohne')}</select>`)}
        ${field('Artikelnummer beim Lieferanten', `<input type="text" id="d-article" value="${esc(d.articleNo)}" maxlength="40">`, 'Erscheint auf der Einkaufsliste.')}
        ${field('Füllmenge pro Glas (g)', `<input type="text" inputmode="decimal" id="d-fill" value="${esc(fmt(d.fillGrams))}" placeholder="z. B. 40">`, 'Ohne Füllmenge kann nicht gerechnet werden.')}
        ${field('Gebinde / Bestellschritt (g)', `<input type="text" inputmode="decimal" id="d-step" value="${esc(fmt(d.stepGrams))}" placeholder="leer = nicht runden">`, 'Die Bestellmenge wird auf ein Vielfaches aufgerundet.')}
      </div>
      <h3 style="font-size:15px;margin:8px 0;">Garnitur / Beilage (pro Glas)</h3>
      <div id="garnish">${d.garnish.map(garnishRow).join('')}</div>
      <button class="btn btn-secondary btn-sm" id="addG" type="button">+ Garnitur hinzufügen</button>
      <div style="height:12px"></div>
      ${field('Bestätigte Namen aus Rentman (einer pro Zeile)', `<textarea id="d-alias" rows="3">${esc((d.aliases || []).join('\n'))}</textarea>`,
        'Wird beim Zuordnen einer Bestellung automatisch ergänzt. Gespeichert in vereinfachter Schreibweise.')}
      ${field('Bemerkung', `<textarea id="d-note" maxlength="1000">${esc(d.note)}</textarea>`)}`, {
      extraButtons: isNew ? '' : `<button class="btn btn-secondary" data-archive>${d.archived ? 'Wiederherstellen' : 'Archivieren'}</button>`,
      onSave: async el => {
        const v = id => $('#' + id, el).value.trim();
        const garnish = $$('[data-garnish]', el).map(g => {
          const f = k => $(`[data-g="${k}"]`, g).value.trim();
          return { name: f('name'), qtyPerGlass: f('qtyPerGlass') || null, unit: f('unit'), packSize: f('packSize') || null, supplierId: f('supplierId') || null };
        });
        const body = { name: v('d-name'), supplierId: v('d-supplier') || null, articleNo: v('d-article') || null, fillGrams: v('d-fill') || null, stepGrams: v('d-step') || null,
          note: v('d-note') || null, aliases: v('d-alias').split('\n').map(s => s.trim()).filter(Boolean), garnish, category: 'weckglas', rev: d.rev };
        await (isNew ? api('POST', '/dishes', body) : api('PUT', '/dishes/' + d.id, body));
        toast('Gespeichert'); await load(); return true;
      },
    });
    const bind = el => { $('[data-rm]', el).onclick = () => el.remove(); };
    $$('[data-garnish]', m.el).forEach(bind);
    $('#addG', m.el).onclick = () => { $('#garnish', m.el).insertAdjacentHTML('beforeend', garnishRow()); bind($('#garnish', m.el).lastElementChild); };
    const arch = $('[data-archive]', m.el);
    if (arch) arch.onclick = async () => {
      try { await api('POST', `/dishes/${d.id}/archive`, { archived: !d.archived }); m.close(); await load(); } catch (e) { m.showError(e.message); }
    };
  }

  $('#q').oninput = render;
  $('#showArchived').onchange = load;
  $('#newBtn').onclick = () => edit(null);
  await load();
});
