// Bestellungen: Liste (#/start), Neuanlage, Bestellseite (#/bestellung/<id>)
const fmtDateDe = iso => {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : 'ohne Datum';
};

CAT.register('start', async root => {
  const { $, $$, esc, fmt, api, field, modal, toast } = CAT;
  root.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div class="note" style="flex:1">Bestellungen für Salate im Glas und Brotzeit. Gästezahl und Speisen kommen aus Rentman, die Mengen rechnet das Tool.</div>
        <button class="btn btn-primary" id="newBtn">Neue Bestellung</button>
      </div>
      <div id="list"><div class="note">Lädt…</div></div>
    </div>`;
  const list = await api('GET', '/orders');
  $('#list').innerHTML = list.length ? list.map(o => `
    <div class="row" data-id="${o.id}">
      <div class="row-main">
        <div class="row-title">${esc(o.name)}</div>
        <div class="row-meta">${o.number ? 'Nr. ' + esc(o.number) + ' · ' : ''}${fmtDateDe(o.eventDate)} · ${o.guests ? esc(o.guests) + ' Gäste' : 'Gästezahl fehlt'} · ${esc(fmt(o.totalGlasses))} Portionen</div>
      </div>
      <div style="text-align:right">
        <span class="pill ${o.status === 'abgeschlossen' ? '' : 'sample'}">${o.status === 'abgeschlossen' ? 'abgeschlossen' : 'Entwurf'}</span>
        ${o.status === 'entwurf' && !o.complete ? '<div class="row-meta">unvollständig</div>' : ''}
      </div>
    </div>`).join('') : '<div class="note">Noch keine Bestellung angelegt.</div>';
  $$('.row', root).forEach(r => r.onclick = () => { location.hash = '#/bestellung/' + r.dataset.id; });
  $('#newBtn').onclick = () => newOrderDialog();

  function newOrderDialog() {
    const m = modal('Neue Bestellung', `
      <div class="tabs" id="mode"><button class="tab-btn active" data-m="rentman">Aus Rentman</button><button class="tab-btn" data-m="manuell">Manuell</button></div>
      <div id="pane"></div>`, {});
    const pane = $('#pane', m.el);
    const modes = { rentman: rentmanPane, manuell: manualPane };
    $$('[data-m]', m.el).forEach(b => b.onclick = () => {
      $$('[data-m]', m.el).forEach(x => x.classList.toggle('active', x === b));
      modes[b.dataset.m]();
    });
    rentmanPane();

    async function create(body) {
      try { const o = await api('POST', '/orders', body); m.close(); location.hash = '#/bestellung/' + o.id; }
      catch (e) {
        if (e.status === 409 && e.openOrderId) location.hash = '#/bestellung/' + e.openOrderId;
        m.showError(e.message);
      }
    }

    function manualPane() {
      pane.innerHTML = field('Name', '<input type="text" id="n-name" maxlength="200" placeholder="z. B. Firmenfeier Müller">') +
        '<div class="grid2">' + field('Datum', '<input type="date" id="n-date">') + field('Gäste', '<input type="text" inputmode="numeric" id="n-guests">') + '</div>' +
        '<div class="modal-actions"><button class="btn btn-primary" id="n-go" style="flex:1">Anlegen</button></div>';
      $('#n-go', pane).onclick = () => create({ name: $('#n-name', pane).value, eventDate: $('#n-date', pane).value || null,
        guests: $('#n-guests', pane).value || null, guestsSource: $('#n-guests', pane).value ? 'manuell eingegeben' : null });
    }

    async function rentmanPane() {
      pane.innerHTML = `<div class="toolbar"><input type="search" id="p-q" placeholder="Projektname oder Nummer"></div>
        <label style="display:flex;gap:8px;align-items:center;text-transform:none;font-weight:400;margin-bottom:8px;">
          <input type="checkbox" id="p-all" style="width:20px;height:20px"> auch vergangene und unbestätigte Projekte</label>
        <div class="hint" style="margin:0 0 8px">Angezeigt werden nur Projekte, die Speisen enthalten. <button class="btn btn-secondary btn-sm" id="p-refresh" type="button">Aktualisieren</button></div>
        <div id="p-list"><div class="note">Lädt Rentman-Projekte…</div></div><div id="p-detail"></div>`;
      let timer = null, seq = 0;
      const load = async (refresh = false) => {
        const mine = ++seq;                                  // nur die jeweils letzte Anfrage darf die Liste zeichnen
        $('#p-list', pane).innerHTML = '<div class="note">Prüft Rentman-Projekte auf Speisen…</div>';
        let r;
        try { r = await api('GET', `/rentman/projects-with-food?all=${$('#p-all', pane).checked ? 1 : 0}&q=${encodeURIComponent($('#p-q', pane).value.trim())}${refresh === true ? '&refresh=1' : ''}`); }
        catch (e) { if (mine === seq) $('#p-list', pane).innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; return; }
        if (mine !== seq) return;
        if (!r.configured) { pane.innerHTML = `<div class="warn-box">${esc(r.hinweis)}</div>`; return; }
        $('#p-list', pane).innerHTML = (r.projects.length ? r.projects.map(p => `<div class="row" data-pid="${esc(p.id)}"><div class="row-main"><div class="row-title">${esc(p.name)}</div>
          <div class="row-meta">Nr. ${esc(p.number ?? '-')} · ${fmtDateDe(p.start)} · ${p.speisen} Speisen</div></div><span class="pill">${esc(p.status)}</span></div>`).join('')
          : '<div class="note">Keine Projekte mit Speisen gefunden.</div>')
          + (r.fehler ? `<div class="hint">Bei ${r.fehler} Projekten war die Prüfung nicht möglich (Rentman). Bitte später erneut versuchen.</div>` : '')
          + (r.mehr ? '<div class="hint">Es gibt weitere Projekte. Bitte den Suchbegriff genauer eingeben.</div>' : '');
        $$('[data-pid]', pane).forEach(el => el.onclick = () => pick(r.projects.find(p => p.id === el.dataset.pid)));
      };
      $('#p-q', pane).oninput = () => { clearTimeout(timer); timer = setTimeout(load, 350); };
      $('#p-all', pane).onchange = () => load();
      $('#p-refresh', pane).onclick = () => load(true);
      load();

      async function pick(p) {
        $('#p-list', pane).classList.add('hidden');
        $('#p-q', pane).parentElement.classList.add('hidden');
        const det = $('#p-detail', pane);
        det.innerHTML = '<div class="note">Lädt Speisen aus Rentman…</div>';
        let data;
        try { data = await api('GET', '/orders/rentman/' + encodeURIComponent(p.id)); }
        catch (e) { det.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; return; }
        if (data.openOrderId) {
          det.innerHTML = `<div class="warn-box">Für dieses Projekt gibt es bereits eine offene Bestellung.</div>
            <button class="btn btn-primary btn-full" id="open-existing">Bestehende Bestellung öffnen</button>`;
          $('#open-existing', det).onclick = () => { m.close(); location.hash = '#/bestellung/' + data.openOrderId; };
          return;
        }
        const blocks = data.blocks;
        det.innerHTML = `<h3 style="font-size:16px;margin-bottom:4px;">${esc(data.project.name)}</h3>
          <div class="note" style="margin-bottom:10px;">Nr. ${esc(data.project.number ?? '-')} · ${fmtDateDe(data.project.start)}</div>
          ${blocks.length ? `<div class="warn-box">Die Personenzahl steht in Rentman als Menge der Blockzeile. Mehrere Blöcke dürfen nicht addiert werden.
            Wähle die Blöcke, deren Speisen berechnet werden sollen.</div>` + blocks.map(b => `
            <label class="line" style="display:block;text-transform:none;font-weight:400;cursor:pointer">
              <div style="display:flex;gap:10px;align-items:flex-start">
                <input type="checkbox" data-block="${esc(b.rowId)}" style="width:22px;height:22px;margin-top:2px">
                <div><div style="font-weight:600">${esc(b.name)}</div>
                <div class="row-meta">Menge in Rentman (Personen): <b>${esc(b.quantity)}</b> · ${b.dishes.length} Speisen</div>
                ${b.remark ? `<div class="row-meta">${esc(b.remark.slice(0, 160))}</div>` : ''}</div></div></label>`).join('')
            : '<div class="warn-box">In diesem Projekt wurden keine Speisenblöcke (Materialgruppe "Catering") gefunden. Du kannst die Bestellung trotzdem anlegen und Speisen später hinzufügen.</div>'}
          <div class="grid2" style="margin-top:12px">${field('Gäste', '<input type="text" inputmode="numeric" id="g-guests">')}
            ${field('Gläser pro Person', '<input type="text" inputmode="decimal" id="g-gpp" placeholder="z. B. 2,6">', 'Für Salate im Glas. Wird von dir festgelegt, es gibt keinen Standard.')}
            ${field('Halbe Scheiben pro Person', '<input type="text" inputmode="decimal" id="g-bpp" placeholder="z. B. 3">', 'Für Brotzeit. Leer lassen, wenn keine Brotzeit dabei ist.')}</div>
          <div class="hint">Die Portionen werden automatisch gleichmäßig auf die Speisen verteilt.</div>
          <div class="hint" id="g-src"></div>
          <div class="modal-actions"><button class="btn btn-primary" id="g-go" style="flex:1">Bestellung anlegen</button></div>`;
        let source = null;
        const update = () => {
          const sel = blocks.filter(b => $(`[data-block="${b.rowId}"]`, det).checked);
          const values = [...new Set(sel.map(b => b.quantity))];
          if (values.length === 1) { $('#g-guests', det).value = values[0]; source = `Rentman, Block "${sel[0].name}" (Menge ${values[0]})`; $('#g-src', det).textContent = 'Quelle der Gästezahl: ' + source; }
          else if (values.length > 1) { $('#g-guests', det).value = ''; source = null; $('#g-src', det).textContent = `Die gewählten Blöcke haben unterschiedliche Mengen (${values.join(', ')}). Bitte Gästezahl selbst eintragen.`; }
        };
        $$('[data-block]', det).forEach(c => c.onchange = update);
        $('#g-go', det).onclick = () => {
          const sel = blocks.filter(b => $(`[data-block="${b.rowId}"]`, det).checked);
          const guests = $('#g-guests', det).value.trim();
          const lines = sel.flatMap(b => b.dishes.map(d => ({ rentmanRowId: d.rowId, rentmanName: d.name, blockName: b.name })));
          create({ name: data.project.name, number: data.project.number, eventDate: data.project.start, rentmanProjectId: data.project.id,
            guests: guests || null, guestsSource: guests ? (guests === (sel[0] && sel.every(b => b.quantity === sel[0].quantity) ? sel[0].quantity : null) ? source : 'manuell eingegeben') : null,
            glassesPerPerson: $('#g-gpp', det).value.trim() || null, brotzeitPerPerson: $('#g-bpp', det).value.trim() || null, lines });
        };
      }
    }
  }
});

CAT.register('bestellung', async (root, arg) => {
  const { $, $$, esc, fmt, api, options, toast, confirmDialog } = CAT;
  let o = await api('GET', '/orders/' + encodeURIComponent(arg));
  const dishes = o.status === 'entwurf' ? await api('GET', '/dishes') : [];
  let locked = o.status === 'abgeschlossen';
  // Automatisches Speichern: `version` zählt jede Änderung der Eingaben, `savedVersion` den zuletzt gespeicherten Stand.
  let version = 0, savedVersion = 0, saving = false, timer = null;
  let autoSplit = o.autoSplit;      // true: Portionen werden automatisch gleichmäßig verteilt, bis jemand eine Zahl von Hand ändert
  const LABELS = { weckglas: ['Gläser', 'Gläser pro Person'], brotzeit: ['halbe Scheiben', 'halbe Scheiben pro Person'] };
  const dishById = id => dishes.find(d => String(d.id) === String(id)) || null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const dishOpts = sel => options(dishes.map(d => [d.id, d.name]), sel, 'Speise wählen');
  // Wie im PDF: nach Lieferant gruppiert (benannte alphabetisch, "ohne Lieferant" zuletzt), Speisen vor Garnitur
  const bySupplier = shopping => {
    const map = new Map();
    shopping.forEach(it => { const k = it.supplier || ''; if (!map.has(k)) map.set(k, []); map.get(k).push(it); });
    return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'de')))
      .map(([k, items]) => ({ supplier: k || null, items: items.slice().sort((x, y) => (x.kind === 'speise' ? 0 : 1) - (y.kind === 'speise' ? 0 : 1)) }));
  };
  const qty = (q, unit) => q === null ? 'offen' : unit === 'g' ? (Number(q) >= 1000 ? fmt(String(Number(q) / 1000)) + ' kg' : fmt(q) + ' g') : fmt(q) + ' ' + (CAT.meta.units[unit] || unit);

  // Hinweise unter einer Zeile: Vorschlag (nur wenn unklar), Rechenweg, und was noch offen ist (sachlich, nicht als Fehler)
  const hintsHtml = l => {
    const c = o.computed.lines.find(x => x.lineId === l.id);
    const warn = o.computed.warnings.filter(w => w.lineId === l.id).map(w => esc(w.text));
    return `${!locked && !l.dishId && l.suggestion && !l.suggestion.auto ? `<div class="hint">Vorschlag: <b>${esc(l.suggestion.name)}</b> (Ähnlichkeit ${Math.round(l.suggestion.score * 100)} %)
        <button class="btn btn-secondary btn-sm" data-sug="${l.suggestion.dishId}" type="button">Übernehmen</button></div>` : ''}
      ${c && c.weg.length ? `<div class="hint">${esc(c.weg.join(' · '))}</div>` : ''}
      ${warn.map(w => `<div class="hint open-hint">${w}</div>`).join('')}`;
  };

  const lineHtml = l => `<div class="line" data-line data-rname="${esc(l.rentmanName)}" data-rid="${esc(l.rentmanRowId)}" data-block="${esc(l.blockName)}">
      <div class="row-meta" style="margin-bottom:6px">${l.rentmanName ? 'Rentman: ' + esc(l.rentmanName) : 'manuell hinzugefügt'}${l.blockName ? ' · ' + esc(l.blockName) : ''}</div>
      <div class="line-grid" style="grid-template-columns:2fr 1fr auto">
        <div><label>Speise</label>${locked ? `<div>${esc(l.dish ? l.dish.name : '?')}</div>` : `<select data-f="dish">${dishOpts(l.dishId)}</select>`}</div>
        <div><label>${esc(((LABELS[l.dish && l.dish.category] || [])[0]) || 'Portionen')}</label>${locked ? `<div><b>${esc(l.glasses ?? '?')}</b></div>` : `<input type="text" inputmode="numeric" data-f="glasses" value="${esc(l.glasses)}" style="font-size:20px;font-weight:700">`}</div>
        ${locked ? '' : '<div><button class="btn btn-secondary btn-sm" data-rm>✕</button></div>'}
      </div>
      <div data-hints>${hintsHtml(l)}</div>
    </div>`;

  const resultHtml = () => {
    const c = o.computed;
    return `<h3 style="font-size:15px;margin-bottom:10px;">Ergebnis</h3>
        ${c.warnings.length || !c.complete ? `<div class="warn-box"><b ${c.complete ? '' : 'style="color:#cc0000"'}>${c.complete ? 'Hinweise' : 'Noch unvollständig, nicht zum Bestellen verwenden'}</b><ul style="margin:6px 0 0 18px">${c.warnings.map(w => `<li>${esc(w.text)}</li>`).join('')}</ul></div>` : ''}
        ${c.shopping.length ? `<div class="note" style="margin-bottom:6px">Einkaufsliste${c.complete ? '' : ' (unvollständig)'}</div>` + bySupplier(c.shopping).map(g => `
          <div style="margin:14px 0 2px;font-weight:700;font-size:15px">${esc(g.supplier || 'Ohne Lieferant')} <span class="pill">${g.items.length} Artikel</span></div>` + g.items.map(s => `
          <div class="row" style="cursor:default"><div class="row-main"><div class="row-title">${esc(s.name)}${s.kind === 'garnitur' ? ' <span class="pill">Garnitur</span>' : ''}${s.overridden ? ' <span class="pill sample">manuell</span>' : ''}</div>
          <div class="row-meta">${s.articleNo ? 'Art. ' + esc(s.articleNo) + ' · ' : ''}${s.sources && s.sources.length ? 'für ' + esc(s.sources.join(', ')) : ''}${s.overrideNote ? ' · ' + esc(s.overrideNote) : ''}</div></div>
          <div style="text-align:right"><b ${s.qty === null ? 'style="color:#cc0000"' : ''}>${esc(qty(s.qty, s.unit))}</b>${s.need !== null && s.qty !== null && (s.need !== s.qty || s.needUnit !== s.unit) ? `<div class="row-meta">${s.overridden ? 'berechnet' : 'Bedarf'} ${esc(qty(s.need, s.needUnit || s.unit))}</div>` : ''}${s.overridden && s.need === null ? '<div class="row-meta">Menge pro Portion offen</div>' : ''}
          ${s.kind === 'garnitur' && !locked ? `<button class="btn btn-secondary btn-sm" data-ov="${esc(s.key)}" style="margin-top:4px">${s.overridden ? 'Menge ändern' : s.qty === null ? 'Menge festlegen' : 'Menge ändern'}</button>` : ''}</div></div>`).join('')).join('')
          : '<div class="note">Noch nichts zu bestellen.</div>'}`;
  };

  function draw() {
    locked = o.status === 'abgeschlossen';      // nach Abschließen oder Wieder öffnen neu bestimmen
    const c = o.computed;
    root.innerHTML = `<div id="orderpage">
      <a href="#/start" class="back-btn" id="backlink" style="display:inline-flex;margin-bottom:12px;">← Zurück zu den Bestellungen</a>
      <div class="alert alert-error hidden" id="err"></div>
      <div class="card">
        <h2 style="font-size:18px;margin-bottom:4px;">${esc(o.name)} <span class="pill ${locked ? '' : 'sample'}">${locked ? 'abgeschlossen' : 'Entwurf'}</span></h2>
        <div class="note">${o.number ? 'Nr. ' + esc(o.number) + ' · ' : ''}${fmtDateDe(o.eventDate)}${o.finalizedAt ? ' · abgeschlossen am ' + new Date(o.finalizedAt).toLocaleString('de-DE') : ''}</div>
      </div>
      <div class="card">
        <div class="grid2">
          <div class="form-group"><label>Gäste</label>${locked ? `<div><b>${esc(o.guests ?? 'fehlt')}</b></div>` : '<input type="text" inputmode="numeric" id="guests" value="' + esc(o.guests) + '">'}
            <div class="hint">${o.guestsSource ? 'Quelle: ' + esc(o.guestsSource) : 'Quelle: nicht angegeben'}</div></div>
          <div class="form-group"><label>Gläser pro Person</label>${locked ? `<div><b>${esc(fmt(o.glassesPerPerson) || '-')}</b></div>` : '<input type="text" inputmode="decimal" id="gpp" value="' + esc(fmt(o.glassesPerPerson)) + '" placeholder="z. B. 2,6">'}
            <div class="hint">Salate im Glas. Wird von dir festgelegt (laut Angebot 2 bis 3).</div></div>
          <div class="form-group"><label>Halbe Scheiben pro Person</label>${locked ? `<div><b>${esc(fmt(o.brotzeitPerPerson) || '-')}</b></div>` : '<input type="text" inputmode="decimal" id="bpp" value="' + esc(fmt(o.brotzeitPerPerson)) + '" placeholder="z. B. 3">'}
            <div class="hint">Brotzeit. Leer lassen, wenn keine Brotzeit dabei ist.</div></div>
        </div>
        <div id="sumline" style="font-size:15px;font-weight:600"></div>
      </div>
      <div class="card">
        <h3 style="font-size:15px;margin-bottom:6px;">Speisen und Portionen</h3>
        <div class="hint" id="splitHint" style="margin:0 0 10px"></div>
        <div id="lines">${o.lines.map(lineHtml).join('') || '<div class="note">Keine Speisen. Füge unten Speisen hinzu.</div>'}</div>
        ${locked ? '' : `<div class="toolbar"><button class="btn btn-secondary" id="addLine">+ Speise hinzufügen</button>
          <button class="btn btn-secondary" id="spread">Automatisch gleichmäßig verteilen</button></div>`}
      </div>
      <div class="card" id="result">${resultHtml()}</div>
      <div class="sticky-bar">
        ${locked ? '' : '<div id="savestate" class="hint" style="flex:1 1 100%;margin:0;min-height:16px"></div>'}
        ${locked ? '<button class="btn btn-secondary" id="reopen">Wieder öffnen</button>' : `
          <button class="btn btn-primary" id="save">Speichern</button>
          <button class="btn btn-secondary" id="finalize" ${c.complete ? '' : 'disabled'}>Abschließen</button>`}
        <button class="btn btn-secondary" id="pdf">PDF Einkaufsliste</button>
        ${locked ? '' : '<button class="btn btn-secondary" id="del">Löschen</button>'}
      </div></div>`;
    bind();
    updateSum();
  }

  const showErr = msg => { const e = $('#err'); e.textContent = msg; e.classList.toggle('hidden', !msg); if (msg) e.scrollIntoView({ block: 'center' }); };
  const setState = text => { const el = $('#savestate'); if (el) el.textContent = text; };
  const readLines = () => $$('[data-line]', root).map(el => ({ rentmanName: el.dataset.rname || null, rentmanRowId: el.dataset.rid || null, blockName: el.dataset.block || null,
    dishId: $('[data-f="dish"]', el).value || null, glasses: $('[data-f="glasses"]', el).value.trim() || null }));
  const body = () => ({ name: o.name, number: o.number, eventDate: o.eventDate, guests: $('#guests').value.trim() || null, guestsSource: o.guestsSource,
    glassesPerPerson: $('#gpp').value.trim() || null, brotzeitPerPerson: $('#bpp').value.trim() || null, autoSplit, rev: o.rev, lines: readLines() });

  const splitHintText = () => (autoSplit
    ? 'Die Portionen werden automatisch gleichmäßig auf die Speisen verteilt. Wenn du eine Zahl selbst änderst, bleibt sie stehen.'
    : 'Die Portionen sind von Hand festgelegt. Mit "Automatisch gleichmäßig verteilen" rechnet das Tool sie neu.');

  function updateSum() {
    const el = $('#sumline');
    if (!el) return;
    const sh = $('#splitHint'); if (sh) sh.textContent = locked ? '' : splitHintText();
    if (locked) {
      el.innerHTML = o.computed.categories.map(c => `${esc(c.label)} verteilt: ${esc(c.total)}${c.target ? ' von ' + esc(fmt(c.target)) : ''}`).join(' · ');
      return;
    }
    // Live aus den Eingabefeldern: je Speisenart die Summe der Portionen gegen Gäste x Portionen pro Person
    const totals = {}, present = new Set();
    $$('[data-line]', root).forEach(line => {
      const d = dishById($('[data-f="dish"]', line).value);
      if (!d || !LABELS[d.category]) return;
      present.add(d.category);
      const i = $('[data-f="glasses"]', line), v = Number(i.value);
      totals[d.category] = (totals[d.category] || 0) + (i.value.trim() && Number.isFinite(v) ? v : 0);
    });
    if (!present.size) present.add('weckglas');
    const g = Number($('#guests').value);
    const pp = { weckglas: Number(($('#gpp').value || '').replace(',', '.')), brotzeit: Number(($('#bpp').value || '').replace(',', '.')) };
    el.innerHTML = [...present].map(cat => {
      const total = totals[cat] || 0, p = pp[cat], target = g > 0 && p > 0 ? g * p : null;
      const ok = target === null || Math.abs(total - target) < 1e-9 || total === Math.round(target);
      return `${esc(LABELS[cat][0])} verteilt: <span style="color:${ok ? 'inherit' : '#cc0000'}">${total}</span>${target !== null ? ` von ${fmt(String(Math.round(target * 100) / 100))} (${g} Gäste × ${fmt(String(p))})` : ` (Gästezahl oder ${esc(LABELS[cat][1])} fehlen noch)`}`;
    }).join('<br>');
  }

  // Nach dem Speichern nur die berechneten Teile erneuern (Hinweise, Ergebnis, Summe), nie die Eingabefelder:
  // So bleibt der Cursor stehen, und es werden keine veralteten Meldungen gezeigt.
  function refreshDynamic() {
    stale(false);
    $$('[data-line]', root).forEach((el, i) => {
      const l = o.lines[i];
      if (!l) return;
      if (autoSplit) $('[data-f="glasses"]', el).value = l.glasses ?? '';      // automatisch verteilte Zahlen anzeigen
      $('[data-hints]', el).innerHTML = hintsHtml(l);
    });
    $('#result').innerHTML = resultHtml();
    const fin = $('#finalize'); if (fin) fin.disabled = !o.computed.complete;
    bindOverrides();
    updateSum();
  }

  const stale = on => { const pg = $('#orderpage'); if (pg) pg.classList.toggle('stale', on); };
  function mark() { version++; stale(true); setState('Änderungen werden gespeichert …'); updateSum(); scheduleSave(500); }
  function scheduleSave(delay) { clearTimeout(timer); timer = setTimeout(() => { runSave(); }, delay); }

  // Speichert den aktuellen Stand der Eingaben. Wartet auf eine laufende Speicherung und speichert erneut, wenn inzwischen weiter geändert wurde.
  async function runSave() {
    while (saving) await sleep(50);
    if (version === savedVersion || !$('#orderpage')) return true;      // nichts zu speichern, oder die Seite wurde schon verlassen
    saving = true; showErr('');
    const v = version;
    try { o = await api('PUT', '/orders/' + o.id, body()); savedVersion = v; autoSplit = o.autoSplit; }
    catch (e) {
      saving = false;
      showErr(e.message + (e.status === 409 ? ' (Seite neu laden mit F5)' : ''));
      setState('Nicht gespeichert'); stale(false);
      return false;
    }
    saving = false;
    if (version !== v) return runSave();
    refreshDynamic(); setState('Gespeichert ✓');
    return true;
  }
  const flush = async () => { clearTimeout(timer); return runSave(); };

  function bindOverrides() {
    $$('[data-ov]', root).forEach(b => b.onclick = async () => {
      if (!(await flush())) return;               // der Versionsstand muss zum gespeicherten Stand passen
      const item = o.computed.shopping.find(x => x.key === b.dataset.ov);
      if (item) overrideDialog(item);
    });
  }

  function bind() {
    if (!locked) {
      const page = $('#orderpage');                  // Beobachter hängen an der Seite selbst und verschwinden mit ihr
      page.addEventListener('input', e => { if (e.target.matches('[data-f="glasses"]')) autoSplit = false; mark(); });
      page.addEventListener('change', e => { if (e.target.matches('[data-f]')) mark(); });
      $$('[data-rm]', root).forEach(b => b.onclick = () => { b.closest('[data-line]').remove(); mark(); });
      page.addEventListener('click', e => {
        const b = e.target.closest('[data-sug]');
        if (b) { $('[data-f="dish"]', b.closest('[data-line]')).value = b.dataset.sug; mark(); }
      });
      $('#addLine').onclick = () => {
        const tmp = { id: 'neu' + Date.now(), dishId: null, glasses: null, rentmanName: null, rentmanRowId: null, blockName: null, dish: null, suggestion: null };
        const lines = $('#lines'); if (!lines.querySelector('[data-line]')) lines.innerHTML = '';
        lines.insertAdjacentHTML('beforeend', lineHtml(tmp));
        const added = lines.lastElementChild;
        $('[data-rm]', added).onclick = () => { added.remove(); mark(); };
        mark();
      };
      $('#spread').onclick = () => { autoSplit = true; mark(); };
      $('#save').onclick = async () => { if (await flush()) toast('Gespeichert'); };
      $('#finalize').onclick = async () => {
        if (!(await flush())) return;
        if (!(await confirmDialog('Bestellung abschließen', 'Das Ergebnis wird eingefroren. Spätere Änderungen an den Speisen wirken sich nicht mehr darauf aus.', 'Abschließen'))) return;
        try { o = await api('POST', `/orders/${o.id}/finalize`, { rev: o.rev }); draw(); toast('Abgeschlossen'); } catch (e) { showErr(e.message); }
      };
      $('#del').onclick = async () => {
        if (!(await confirmDialog('Bestellung löschen', 'Diese Bestellung wird endgültig gelöscht.', 'Löschen'))) return;
        clearTimeout(timer); version = savedVersion;       // keine Speicherung mehr nach dem Löschen
        try { await api('DELETE', '/orders/' + o.id); location.hash = '#/start'; } catch (e) { showErr(e.message); }
      };
    } else {
      $('#reopen').onclick = async () => { try { o = await api('POST', `/orders/${o.id}/reopen`); location.reload(); } catch (e) { showErr(e.message); } };
    }
    bindOverrides();
    $('#backlink').onclick = async e => { if (!locked) { e.preventDefault(); await flush(); location.hash = '#/start'; } };
    $('#pdf').onclick = async () => {
      if (!locked && !(await flush())) return;      // PDF zeigt immer den gespeicherten Stand
      window.open(`/api/catering/orders/${o.id}/pdf`, '_blank');
    };
  }

  // Manuelle Gesamtmenge einer Garnitur, gilt nur für diese Bestellung
  function overrideDialog(item) {
    const units = ['stk', 'g', 'kg', 'ml', 'l', 'pkg', 'bund', 'hscheibe'];
    const m = CAT.modal(`${item.name}: Menge festlegen`, `
      <div class="note" style="margin-bottom:10px">${item.need !== null && item.need !== undefined ? 'Berechnet: ' + esc(qty(item.need, item.needUnit || item.unit)) : 'Die Menge pro Glas ist noch offen.'}
        Die Menge gilt nur für diese Bestellung und wird nicht auf ein Gebinde gerundet.</div>
      <div class="grid2">
        ${CAT.field('Menge', `<input type="text" inputmode="decimal" id="ov-qty" value="${item.overridden ? esc(fmt(item.qty)) : ''}" placeholder="z. B. 1">`)}
        ${CAT.field('Einheit', `<select id="ov-unit">${CAT.options(units.map(u => [u, CAT.meta.units[u]]), item.overridden ? item.unit : item.unit)}</select>`)}
      </div>
      ${CAT.field('Bemerkung (optional)', `<input type="text" id="ov-note" maxlength="200" value="${esc(item.overrideNote)}" placeholder="z. B. 1 Bund">`)}`, {
      extraButtons: item.overridden ? '<button class="btn btn-secondary" data-reset>Zurücksetzen</button>' : '',
      onSave: async el => {
        o = await api('POST', `/orders/${o.id}/garnish-override`, { rev: o.rev, key: item.key, qty: $('#ov-qty', el).value.trim(),
          unit: $('#ov-unit', el).value, note: $('#ov-note', el).value.trim() || null });
        savedVersion = version; draw(); toast('Menge festgelegt'); return true;
      },
    });
    const reset = CAT.$('[data-reset]', m.el);
    if (reset) reset.onclick = async () => {
      try { o = await api('POST', `/orders/${o.id}/garnish-override`, { rev: o.rev, key: item.key, qty: null }); m.close(); draw(); toast('Zurückgesetzt'); }
      catch (e) { m.showError(e.message); }
    };
  }

  draw();
  // Eindeutige Treffer aus Rentman (gleicher oder vorangestellter Name) werden ohne Zutun zugeordnet und gespeichert
  if (!locked) {
    let n = 0;
    $$('[data-line]', root).forEach((el, i) => {
      const l = o.lines[i];
      if (l && !l.dishId && l.suggestion && l.suggestion.auto) { $('[data-f="dish"]', el).value = l.suggestion.dishId; n++; }
    });
    if (n) { version++; scheduleSave(0); toast(`${n} Speisen aus Rentman zugeordnet`); }
  }
});
