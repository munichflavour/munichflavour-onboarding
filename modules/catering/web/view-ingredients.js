// Zutatenverwaltung
CAT.register('zutaten', async root => {
  const { $, esc, fmt, money, api, field, options, unitOptions, modal, confirmDialog, toast, meta } = CAT;
  const suppliers = await api('GET', '/suppliers');
  let items = [];

  root.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <input id="q" type="search" placeholder="Zutat suchen" autocomplete="off">
        <button class="btn btn-primary" id="newBtn">Neue Zutat</button>
      </div>
      <label style="display:flex;gap:8px;align-items:center;text-transform:none;font-weight:400;margin-bottom:8px;">
        <input type="checkbox" id="showArchived" style="width:20px;height:20px"> Archivierte anzeigen</label>
      <div id="list"></div>
    </div>`;

  const render = () => {
    const q = $('#q').value.trim().toLowerCase();
    const list = items.filter(i => !q || i.name.toLowerCase().includes(q));
    $('#list').innerHTML = list.length ? list.map(i => `
      <div class="row" data-id="${i.id}">
        <div class="row-main">
          <div class="row-title">${esc(i.name)} ${i.archived ? '<span class="pill">archiviert</span>' : ''}</div>
          <div class="row-meta">${esc(i.goodsGroup || 'ohne Warengruppe')} · Basis ${esc(meta.units[i.baseUnit])} · Einkauf ${esc(meta.units[i.purchaseUnit])}${i.packSize ? ', Gebinde ' + esc(fmt(i.packSize)) + ' ' + esc(meta.units[i.purchaseUnit]) : ', kein Gebinde'}${i.supplierName ? ' · ' + esc(i.supplierName) : ''}</div>
        </div>
        <span class="pill ${i.price ? '' : 'warn'}">${i.price ? esc(money(i.price)) + ' / ' + esc(meta.units[i.purchaseUnit]) : 'kein Preis'}</span>
      </div>`).join('') : '<div class="note">Keine Zutaten gefunden.</div>';
    CAT.$$('.row', root).forEach(r => r.onclick = () => edit(items.find(i => String(i.id) === r.dataset.id)));
  };
  const load = async () => { items = await api('GET', '/ingredients' + ($('#showArchived').checked ? '?archived=1' : '')); render(); };

  function form(i) {
    const d = i.discreteRules || {};
    const rule = k => d[k] || {};
    return `
      ${field('Name', `<input type="text" id="f-name" value="${esc(i.name)}" maxlength="120">`)}
      <div class="grid2">
        ${field('Warengruppe', `<select id="f-group">${options(meta.goodsGroups.map(g => [g.name, g.name]), i.goodsGroup, 'ohne')}</select>`)}
        ${field('Lieferant (Standard)', `<select id="f-supplier">${options(suppliers.map(s => [s.id, s.name]), i.supplierId, 'ohne')}</select>`)}
        ${field('Basiseinheit', `<select id="f-base">${unitOptions(i.baseUnit || 'g', meta.baseUnits)}</select>`, 'In dieser Einheit rechnet das System.')}
        ${field('Einkaufseinheit', `<select id="f-purchase">${unitOptions(i.purchaseUnit || 'kg')}</select>`)}
        ${field('Gebindegröße (in Einkaufseinheit)', `<input type="text" inputmode="decimal" id="f-pack" value="${esc(fmt(i.packSize))}" placeholder="leer = kein Gebinde">`, 'Ohne Gebinde wird die Menge nicht gerundet.')}
        ${field('Preis je Einkaufseinheit (EUR)', `<input type="text" inputmode="decimal" id="f-price" value="${esc(fmt(i.price))}" placeholder="leer = unbekannt">`)}
        ${field('Verlust bei der Zubereitung (%)', `<input type="text" inputmode="decimal" id="f-loss" value="${esc(fmt(i.lossPct))}" placeholder="z. B. 20 für Schälverlust">`, 'Standard; in der Rezeptur überschreibbar.')}
      </div>
      <details class="adv"><summary>Umrechnung zwischen Gewicht, Volumen, Stück und Packung</summary>
        ${field('Dichte (g pro ml)', `<input type="text" inputmode="decimal" id="f-density" value="${esc(fmt(i.densityGPerMl))}" placeholder="nur nötig für l ↔ kg">`)}
        <div class="grid2">
          ${field('1 Stück entspricht', `<input type="text" inputmode="decimal" id="f-stk-amount" value="${esc(fmt(rule('stk').amount))}">`)}
          ${field('Einheit', `<select id="f-stk-unit">${unitOptions(rule('stk').unit || 'g', ['g', 'kg', 'ml', 'l'])}</select>`)}
          ${field('1 Packung entspricht', `<input type="text" inputmode="decimal" id="f-pkg-amount" value="${esc(fmt(rule('pkg').amount))}">`)}
          ${field('Einheit', `<select id="f-pkg-unit">${unitOptions(rule('pkg').unit || 'stk', ['g', 'kg', 'ml', 'l', 'stk'])}</select>`)}
        </div>
        <div class="hint">Nur ausfüllen, wenn bekannt. Es werden keine Werte geraten.</div>
      </details>`;
  }
  function read(rev) {
    const v = id => $('#' + id).value.trim();
    const rules = {};
    if (v('f-stk-amount')) rules.stk = { amount: v('f-stk-amount'), unit: v('f-stk-unit') };
    if (v('f-pkg-amount')) rules.pkg = { amount: v('f-pkg-amount'), unit: v('f-pkg-unit') };
    return { name: v('f-name'), goodsGroup: v('f-group') || null, supplierId: v('f-supplier') || null, baseUnit: v('f-base'),
      purchaseUnit: v('f-purchase'), packSize: v('f-pack') || null, price: v('f-price') || null, lossPct: v('f-loss') || null,
      densityGPerMl: v('f-density') || null, discreteRules: Object.keys(rules).length ? rules : null, rev };
  }

  function edit(i) {
    const isNew = !i;
    i = i || {};
    const m = modal(isNew ? 'Neue Zutat' : 'Zutat bearbeiten', form(i), {
      extraButtons: isNew ? '' : `<button class="btn btn-secondary" data-archive>${i.archived ? 'Wiederherstellen' : 'Archivieren'}</button>`,
      onSave: async () => {
        const body = read(i.rev);
        await (isNew ? api('POST', '/ingredients', body) : api('PUT', '/ingredients/' + i.id, body));
        toast('Gespeichert');
        await load();
        return true;
      },
    });
    const arch = CAT.$('[data-archive]', m.el);
    if (arch) arch.onclick = async () => {
      if (!i.archived && i.usedInRecipes && !(await confirmDialog('Zutat archivieren', `Diese Zutat wird in ${i.usedInRecipes} Rezeptur(en) verwendet. Bestehende Rezepturen bleiben unverändert. Trotzdem archivieren?`))) return;
      try { await api('POST', `/ingredients/${i.id}/archive`, { archived: !i.archived }); m.close(); await load(); } catch (e) { m.showError(e.message); }
    };
  }

  $('#q').oninput = render;
  $('#showArchived').onchange = load;
  $('#newBtn').onclick = () => edit(null);
  await load();
});
