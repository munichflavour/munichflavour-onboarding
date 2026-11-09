// Speisenkatalog: Zutaten und Garnituren (jeweils mit Lieferant), Speisenart, bestätigte Rentman-Namen
CAT.register('speisen', async root => {
  const { $, $$, esc, fmt, api, field, options, unitOptions, modal, confirmDialog, toast } = CAT;
  const CATEGORY_LABELS = { weckglas: 'Salat im Glas', brotzeit: 'Brotzeit', dessert: 'Dessert' };
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
    const brotHint = dishes.some(d => d.category === 'brotzeit') ? '' : `<div class="warn-box">Noch keine Brotzeit angelegt. Du kannst die sechs Brotzeiten vom Hausbau-Event anlegen
      (Mengen pro halber Brotscheibe aus deinem Einkauf für 50 Gäste zurückgerechnet, mit Lieferanten Kugler, METRO und Bäckerei Wimmer).
      <div style="margin-top:8px"><button class="btn btn-secondary btn-sm" id="brotBtn">Brotzeit Hausbau anlegen</button></div></div>`;
    $('#hint').innerHTML = (dishes.length ? '' : `<div class="warn-box">Noch keine Speisen angelegt. Du kannst die Salate der Menükarte vom 20.10. anlegen
      (Gebinde und Artikelnummern aus dem Kugler-Shop, Füllmengen aus der Bestellübersicht zurückgerechnet, bitte prüfen) oder eine neue Speise erfassen.
      <div style="margin-top:8px"><button class="btn btn-secondary btn-sm" id="exampleBtn">Salate (Kugler) anlegen</button></div></div>`) + brotHint;
    const bb = $('#brotBtn');
    if (bb) bb.onclick = async () => {
      bb.disabled = true;
      try { const r = await api('POST', '/dishes/import-brotzeit'); toast(`${r.created.length} Brotzeiten angelegt`); await load(); } catch (e) { toast(e.message); bb.disabled = false; }
    };
    const ex = $('#exampleBtn');
    if (ex) ex.onclick = async () => {
      ex.disabled = true;
      try { const r = await api('POST', '/dishes/import-example'); toast(`${r.created.length} Speisen angelegt`); await load(); } catch (e) { toast(e.message); ex.disabled = false; }
    };
    $('#list').innerHTML = list.length ? list.map(d => `
      <div class="row" data-id="${d.id}">
        <div class="row-main">
          <div class="row-title">${esc(d.name)} <span class="pill">${esc(CATEGORY_LABELS[d.category] || d.category)}</span> ${d.archived ? '<span class="pill">archiviert</span>' : ''}</div>
          <div class="row-meta">Zutaten: ${esc(d.ingredients.map(i => i.name).join(', '))} · ${d.garnish.length ? 'Garnitur: ' + esc(d.garnish.map(g => g.name).join(', ')) : 'ohne Garnitur'}</div>
        </div>
        <div style="text-align:right">
          ${d.missingSupplier ? '<span class="pill">teils ohne Lieferant</span>' : ''}
          ${d.ingredients.some(i => !i.qtyPerPortion) ? '<span class="pill warn">Menge fehlt</span>' : ''}
        </div>
      </div>`).join('') : (dishes.length ? '<div class="note">Keine Speisen gefunden.</div>' : '');
    $$('.row', root).forEach(r => r.onclick = () => edit(dishes.find(d => String(d.id) === r.dataset.id)));
  };
  const load = async () => { dishes = await api('GET', '/dishes' + ($('#showArchived').checked ? '?archived=1' : '')); render(); };

  const supplierSelect = (attr, selected) => `<select data-${attr}="supplierId">${options(suppliers.map(s => [s.id, s.name]), selected, 'ohne Lieferant')}</select>`;
  const ingredientRow = (g = {}) => `
    <div class="line" data-ingredient>
      <div class="line-grid">
        <div class="span2"><label>Zutat</label><input type="text" data-i="name" value="${esc(g.name)}" maxlength="100"></div>
        <div><label>Menge pro Portion</label><input type="text" inputmode="decimal" data-i="qtyPerPortion" value="${esc(fmt(g.qtyPerPortion))}" placeholder="offen"></div>
        <div><label>Einheit</label><select data-i="unit">${unitOptions(g.unit || 'g', ['g', 'kg', 'ml', 'l', 'stk', 'pkg', 'bund', 'hscheibe'])}</select></div>
        <div><label>Gebinde (Einheit)</label><input type="text" inputmode="decimal" data-i="packSize" value="${esc(fmt(g.packSize))}" placeholder="keins"></div>
        <div><label>Artikelnummer</label><input type="text" data-i="articleNo" value="${esc(g.articleNo)}" maxlength="40"></div>
        <div class="span2"><label>Lieferant</label>${supplierSelect('i', g.supplierId)}</div>
        <div><button class="btn btn-secondary btn-sm" data-rm style="width:100%">Entfernen</button></div>
      </div>
    </div>`;
  const garnishRow = (g = {}) => `
    <div class="line" data-garnish>
      <div class="line-grid">
        <div class="span2"><label>Garnitur / Beilage</label><input type="text" data-g="name" value="${esc(g.name)}" maxlength="100"></div>
        <div><label>Menge pro Portion</label><input type="text" inputmode="decimal" data-g="qtyPerGlass" value="${esc(fmt(g.qtyPerGlass))}" placeholder="offen"></div>
        <div><label>Einheit</label><select data-g="unit">${unitOptions(g.unit || 'stk', ['g', 'kg', 'ml', 'l', 'stk', 'pkg', 'bund', 'hscheibe'])}</select></div>
        <div><label>Gebinde (Einheit)</label><input type="text" inputmode="decimal" data-g="packSize" value="${esc(fmt(g.packSize))}" placeholder="keins"></div>
        <div class="span2"><label>Lieferant</label>${supplierSelect('g', g.supplierId)}</div>
        <div><button class="btn btn-secondary btn-sm" data-rm style="width:100%">Entfernen</button></div>
      </div>
    </div>`;

  async function edit(d) {
    // Lieferanten frisch laden: Sie können sich seit dem Öffnen der Seite geändert haben (z. B. durch das Anlegen des Katalogs).
    // Mit veralteter Liste würde beim Speichern der Lieferant der Speise verloren gehen.
    try { suppliers = await api('GET', '/suppliers'); } catch (e) { toast(e.message); return; }
    const isNew = !d;
    d = d || { ingredients: [{}], garnish: [], aliases: [], category: 'weckglas' };
    const m = modal(isNew ? 'Neue Speise' : 'Speise bearbeiten', `
      ${suppliers.length ? '' : '<div class="hint">Es gibt noch keine Lieferanten. Du kannst sie im Reiter Lieferanten anlegen, zum Beispiel auch "Supermarkt".</div>'}
      <div class="grid2">
        ${field('Name der Speise', `<input type="text" id="d-name" value="${esc(d.name)}" maxlength="120">`)}
        ${field('Speisenart', `<select id="d-cat">${options([['weckglas', CATEGORY_LABELS.weckglas], ['brotzeit', CATEGORY_LABELS.brotzeit]], d.category)}</select>`,
          'Bestimmt, ob mit Gläsern oder halben Brotscheiben pro Person gerechnet wird.')}
      </div>
      <h3 style="font-size:15px;margin:8px 0;">Zutaten (pro Portion)</h3>
      <div class="hint" style="margin:0 0 8px">Einkaufsartikel, aus denen eine Portion besteht, zum Beispiel Brot, Frischkäse oder der fertige Salat. Gleiche Zutaten verschiedener Speisen werden zusammengezählt und erst dann auf das Gebinde aufgerundet.</div>
      <div id="ingredients">${d.ingredients.map(ingredientRow).join('')}</div>
      <button class="btn btn-secondary btn-sm" id="addI" type="button">+ Zutat hinzufügen</button>
      <h3 style="font-size:15px;margin:16px 0 8px;">Garnitur / Beilage (pro Portion)</h3>
      <div id="garnish">${d.garnish.map(garnishRow).join('')}</div>
      <button class="btn btn-secondary btn-sm" id="addG" type="button">+ Garnitur hinzufügen</button>
      <div style="height:12px"></div>
      ${field('Bestätigte Namen aus Rentman (einer pro Zeile)', `<textarea id="d-alias" rows="3">${esc((d.aliases || []).join('\n'))}</textarea>`,
        'Wird beim Zuordnen einer Bestellung automatisch ergänzt. Gespeichert in vereinfachter Schreibweise.')}
      ${field('Bemerkung', `<textarea id="d-note" maxlength="1000">${esc(d.note)}</textarea>`)}`, {
      extraButtons: isNew ? '' : `<button class="btn btn-secondary" data-archive>${d.archived ? 'Wiederherstellen' : 'Archivieren'}</button>`,
      onSave: async el => {
        const v = id => $('#' + id, el).value.trim();
        const read = (sel, attr, keys) => $$(sel, el).map(row => {
          const f = k => $(`[data-${attr}="${k}"]`, row).value.trim();
          return Object.fromEntries(keys.map(k => [k, f(k) || null]));
        });
        const ingredients = read('[data-ingredient]', 'i', ['name', 'qtyPerPortion', 'unit', 'packSize', 'articleNo', 'supplierId']);
        const garnish = read('[data-garnish]', 'g', ['name', 'qtyPerGlass', 'unit', 'packSize', 'supplierId']);
        const body = { name: v('d-name'), category: v('d-cat'), note: v('d-note') || null, aliases: v('d-alias').split('\n').map(s => s.trim()).filter(Boolean),
          ingredients, garnish, rev: d.rev };
        await (isNew ? api('POST', '/dishes', body) : api('PUT', '/dishes/' + d.id, body));
        toast('Gespeichert'); await load(); return true;
      },
    });
    const bind = el => { $('[data-rm]', el).onclick = () => el.remove(); };
    $$('[data-ingredient], [data-garnish]', m.el).forEach(bind);
    $('#addI', m.el).onclick = () => { $('#ingredients', m.el).insertAdjacentHTML('beforeend', ingredientRow()); bind($('#ingredients', m.el).lastElementChild); };
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
