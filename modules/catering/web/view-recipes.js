// Rezepturverwaltung: Liste (#/rezepte) und Editor (#/rezept/<id> bzw. #/rezept/neu)
CAT.register('rezepte', async root => {
  const { $, esc, fmt, api, options, meta } = CAT;
  root.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <input id="q" type="search" placeholder="Rezeptur suchen" autocomplete="off">
        <select id="cat">${options(meta.categories.map(c => [c.id, c.name]), '', 'Alle Kategorien')}</select>
        <button class="btn btn-primary" id="newBtn">Neue Rezeptur</button>
      </div>
      <label style="display:flex;gap:8px;align-items:center;text-transform:none;font-weight:400;margin-bottom:8px;">
        <input type="checkbox" id="showArchived" style="width:20px;height:20px"> Archivierte anzeigen</label>
      <div class="warn-box">Alle Mengen, die hier eingetragen werden, sind eure eigenen Angaben. Das System erfindet keine Rezepturen.</div>
      <div id="list"></div>
    </div>`;
  async function load() {
    const params = new URLSearchParams();
    if ($('#q').value.trim()) params.set('q', $('#q').value.trim());
    if ($('#cat').value) params.set('categoryId', $('#cat').value);
    if ($('#showArchived').checked) params.set('archived', '1');
    const list = await api('GET', '/recipes?' + params);
    $('#list').innerHTML = list.length ? list.map(r => `
      <div class="row" data-id="${r.id}">
        <div class="row-main">
          <div class="row-title">${esc(r.name)} ${r.archived ? '<span class="pill">archiviert</span>' : ''}</div>
          <div class="row-meta">${esc(r.categoryName || 'ohne Kategorie')} · für ${esc(fmt(r.refQty))} ${esc(r.calcUnit)} · ${r.itemCount} Zutaten · Version ${r.version}</div>
        </div>
        ${r.rentmanItemId || r.articleNo ? '<span class="pill">zugeordnet</span>' : '<span class="pill warn">ohne Zuordnung</span>'}
      </div>`).join('') : '<div class="note">Keine Rezepturen gefunden.</div>';
    CAT.$$('.row', root).forEach(r => r.onclick = () => { location.hash = '#/rezept/' + r.dataset.id; });
  }
  let timer;
  $('#q').oninput = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  $('#cat').onchange = load;
  $('#showArchived').onchange = load;
  $('#newBtn').onclick = () => { location.hash = '#/rezept/neu'; };
  await load();
});

CAT.register('rezept', async (root, arg) => {
  const { $, $$, esc, fmt, api, field, options, unitOptions, toast, confirmDialog, meta } = CAT;
  const isNew = arg === 'neu';
  const ingredients = await api('GET', '/ingredients');
  const byId = Object.fromEntries(ingredients.map(i => [i.id, i]));
  let rec = null;
  let viewVersion = null;       // gesetzt = Anzeige einer älteren Version (nur lesen)

  if (!isNew) {
    const v = new URLSearchParams(location.search).get('v');
    rec = await api('GET', `/recipes/${encodeURIComponent(arg)}` + (v ? '?version=' + encodeURIComponent(v) : ''));
    if (v && Number(v) !== rec.latestVersion) viewVersion = Number(v);
    rec.items.forEach(i => { if (!byId[i.ingredientId]) byId[i.ingredientId] = { id: i.ingredientId, name: i.ingredientName, baseUnit: i.baseUnit, archived: true }; });
  }
  const ver = rec ? rec.version : {};
  const readOnly = viewVersion !== null;
  const dis = readOnly ? 'disabled' : '';

  const lineHtml = it => `
    <div class="line" data-line>
      <div class="line-grid">
        <div class="span2">${'<label>Zutat</label>'}<select data-f="ingredientId" ${dis}>${options(
          Object.values(byId).filter(i => !i.archived || i.id === it.ingredientId).sort((a, b) => a.name.localeCompare(b.name, 'de')).map(i => [i.id, i.name]),
          it.ingredientId, 'Zutat wählen')}</select></div>
        <div><label>Menge</label><input type="text" inputmode="decimal" data-f="qty" value="${esc(fmt(it.qty))}" ${dis}></div>
        <div><label>Einheit</label><select data-f="unit" ${dis}>${unitOptions(it.unit || 'g')}</select></div>
        <div><label>Verlust %</label><input type="text" inputmode="decimal" data-f="lossPct" value="${esc(fmt(it.lossPct))}" placeholder="Standard" ${dis}></div>
        <div class="span2"><label>Hinweis</label><input type="text" data-f="note" value="${esc(it.note)}" maxlength="300" ${dis}></div>
        ${readOnly ? '' : '<div><button class="btn btn-secondary btn-sm" data-remove style="width:100%">Entfernen</button></div>'}
      </div>
    </div>`;

  root.innerHTML = `
    <a href="#/rezepte" class="back-btn" style="display:inline-flex;margin-bottom:12px;">← Zurück zu den Rezepturen</a>
    ${readOnly ? `<div class="warn-box">Du siehst Version ${viewVersion} vom ${esc(rec.version.createdAt)}. Diese Ansicht ist schreibgeschützt.
      <a href="#/rezept/${rec.id}">Zur aktuellen Version</a></div>` : ''}
    ${rec && rec.archived ? '<div class="warn-box">Diese Rezeptur ist archiviert.</div>' : ''}
    <div class="alert alert-error hidden" id="err"></div>
    <div class="card">
      <h2 style="font-size:18px;margin-bottom:12px;">${isNew ? 'Neue Rezeptur' : esc(ver.name)} ${rec ? `<span class="pill">Version ${ver.version}</span>` : ''}</h2>
      ${field('Name der Speise', `<input type="text" id="r-name" value="${esc(ver.name)}" maxlength="120" ${dis}>`)}
      <div class="grid2">
        ${field('Kategorie', `<select id="r-cat" ${dis}>${options(meta.categories.map(c => [c.id, c.name]), rec?.categoryId, 'ohne')}</select>`)}
        ${field('Kalkulationseinheit', `<input type="text" id="r-unit" value="${esc(ver.calcUnit || 'Portionen')}" maxlength="30" ${dis}>`, 'z. B. Portionen, Stück')}
        ${field('Referenzmenge', `<input type="text" inputmode="decimal" id="r-ref" value="${esc(fmt(ver.refQty))}" placeholder="z. B. 10" ${dis}>`, 'Die Zutatenmengen unten gelten für diese Menge.')}
        ${field('Portionsgröße in Gramm (optional)', `<input type="text" inputmode="decimal" id="r-grams" value="${esc(fmt(ver.portionGrams))}" ${dis}>`, 'Nötig für die Kalkulation „Gramm pro Person“.')}
      </div>
      <h3 style="font-size:15px;margin:8px 0;">Zutaten</h3>
      <div id="lines">${(rec ? rec.items : [{}]).map(lineHtml).join('')}</div>
      ${readOnly ? '' : '<button class="btn btn-secondary" id="addLine">+ Zutat hinzufügen</button>'}
      <details class="adv" ${rec && (ver.description || ver.prepNotes || ver.allergens || rec.rentmanItemId || rec.articleNo || ver.defaultBufferPct || ver.defaultPortionFactor) ? 'open' : ''}>
        <summary>Weitere Angaben und Zuordnung zu Rentman</summary>
        <div class="grid2">
          ${field('Rentman-Artikel-ID', `<input type="text" id="r-rentman" value="${esc(rec?.rentmanItemId)}" ${dis}>`, 'Eindeutige Zuordnung zur gebuchten Speise.')}
          ${field('Interne Artikelnummer', `<input type="text" id="r-article" value="${esc(rec?.articleNo)}" ${dis}>`)}
          ${field('Standard-Sicherheitspuffer (%)', `<input type="text" inputmode="decimal" id="r-buffer" value="${esc(fmt(ver.defaultBufferPct))}" placeholder="leer = keiner" ${dis}>`)}
          ${field('Standard-Portionsfaktor', `<input type="text" inputmode="decimal" id="r-factor" value="${esc(fmt(ver.defaultPortionFactor))}" placeholder="leer = keiner" ${dis}>`)}
        </div>
        ${field('Allergene und Kennzeichnung', `<input type="text" id="r-allergens" value="${esc(ver.allergens)}" maxlength="300" ${dis}>`)}
        ${field('Beschreibung', `<textarea id="r-desc" maxlength="1000" ${dis}>${esc(ver.description)}</textarea>`)}
        ${field('Zubereitungshinweise', `<textarea id="r-prep" maxlength="4000" ${dis}>${esc(ver.prepNotes)}</textarea>`)}
      </details>
      ${readOnly ? '' : `<div class="sticky-bar">
        <button class="btn btn-primary" id="saveBtn">${isNew ? 'Rezeptur anlegen' : 'Als neue Version speichern'}</button>
        ${isNew ? '' : '<button class="btn btn-secondary" id="dupBtn">Duplizieren</button>'}
        ${isNew ? '' : `<button class="btn btn-secondary" id="archBtn">${rec.archived ? 'Wiederherstellen' : 'Archivieren'}</button>`}
      </div>`}
    </div>
    ${rec && rec.versions.length > 1 ? `<div class="card"><h3 style="font-size:15px;margin-bottom:8px;">Versionen</h3>${rec.versions.map(v =>
      `<div class="row" data-v="${v.version}"><div class="row-main"><div class="row-title">Version ${v.version}${v.version === rec.latestVersion ? ' (aktuell)' : ''}</div>
      <div class="row-meta">${esc(v.createdAt)} · ${esc(v.createdByName || 'unbekannt')}</div></div></div>`).join('')}
      <div class="hint">Bereits erstellte Kalkulationen behalten die Version, mit der sie berechnet wurden.</div></div>` : ''}`;

  const showErr = msg => { const e = $('#err'); e.textContent = msg; e.classList.toggle('hidden', !msg); if (msg) e.scrollIntoView({ block: 'center' }); };
  $$('[data-v]', root).forEach(r => r.onclick = () => {
    history.replaceState(null, '', `?v=${r.dataset.v}${location.hash}`);
    CAT.route();
  });
  if (readOnly) return;

  const lines = $('#lines');
  const bindLine = el => { $('[data-remove]', el).onclick = () => { el.remove(); }; };
  $$('[data-line]', lines).forEach(bindLine);
  $('#addLine').onclick = () => {
    lines.insertAdjacentHTML('beforeend', lineHtml({}));
    bindLine(lines.lastElementChild);
    lines.lastElementChild.scrollIntoView({ block: 'center' });
  };
  // Beim Wählen einer Zutat die passende Einheit vorschlagen (Basiseinheit)
  lines.addEventListener('change', e => {
    if (e.target.dataset.f !== 'ingredientId') return;
    const ing = byId[e.target.value];
    const unit = $('[data-f="unit"]', e.target.closest('[data-line]'));
    if (ing && unit && !unit.dataset.touched) unit.value = ing.baseUnit === 'g' ? 'g' : ing.baseUnit === 'ml' ? 'ml' : ing.baseUnit;
  });
  lines.addEventListener('input', e => { if (e.target.dataset.f === 'unit') e.target.dataset.touched = '1'; });

  function collect() {
    const v = id => $('#' + id).value.trim();
    const items = $$('[data-line]', lines).map(el => {
      const g = f => $(`[data-f="${f}"]`, el).value.trim();
      return { ingredientId: g('ingredientId'), qty: g('qty'), unit: g('unit'), lossPct: g('lossPct') || null, note: g('note') || null };
    });
    return { name: v('r-name'), categoryId: v('r-cat') || null, calcUnit: v('r-unit'), refQty: v('r-ref'), portionGrams: v('r-grams') || null,
      rentmanItemId: v('r-rentman') || null, articleNo: v('r-article') || null, defaultBufferPct: v('r-buffer') || null,
      defaultPortionFactor: v('r-factor') || null, allergens: v('r-allergens') || null, description: v('r-desc') || null,
      prepNotes: v('r-prep') || null, items };
  }

  $('#saveBtn').onclick = async e => {
    e.target.disabled = true; showErr('');
    try {
      const body = collect();
      if (isNew) {
        const created = await api('POST', '/recipes', body);
        toast('Rezeptur angelegt');
        location.hash = '#/rezept/' + created.id;
      } else {
        const saved = await api('PUT', '/recipes/' + rec.id, { ...body, baseVersion: rec.latestVersion });
        toast(saved.newVersionCreated ? `Version ${saved.latestVersion} gespeichert` : 'Keine Änderungen');
        history.replaceState(null, '', location.pathname + location.hash);
        CAT.route();
      }
    } catch (err) {
      showErr(err.message + (err.status === 409 ? ' (Seite neu laden mit F5; deine Eingaben gehen dabei verloren, bitte vorher notieren.)' : ''));
    } finally { e.target.disabled = false; }
  };
  if (!isNew) {
    $('#dupBtn').onclick = async () => {
      try { const c = await api('POST', `/recipes/${rec.id}/duplicate`); toast('Kopie angelegt'); location.hash = '#/rezept/' + c.id; }
      catch (err) { showErr(err.message); }
    };
    $('#archBtn').onclick = async () => {
      if (!rec.archived && !(await confirmDialog('Rezeptur archivieren', 'Archivierte Rezepturen werden bei neuen Kalkulationen nicht mehr angeboten. Bestehende Kalkulationen bleiben unverändert.', 'Archivieren'))) return;
      try { await api('POST', `/recipes/${rec.id}/archive`, { archived: !rec.archived }); CAT.route(); }
      catch (err) { showErr(err.message); }
    };
  }
});
