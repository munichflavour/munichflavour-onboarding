// Gemeinsamer Kern: API-Aufrufe, Dialoge, Hinweise, Navigation per URL-Hash (#/rezepte, #/rezept/12).
const CAT = (() => {
  const views = {};
  let meta = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = s => (s === null || s === undefined || s === '' ? '' : String(s).replace('.', ','));   // Anzeige mit Komma
  const money = s => (s === null || s === undefined || s === '' ? 'kein Preis' : Number(s).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));

  async function api(method, url, body) {
    let res;
    try {
      res = await fetch('/api/catering' + url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new Error('Keine Verbindung zum Server. Es wurde nichts gespeichert.'); }
    if (res.status === 423) { window.location.reload(); throw new Error('Gesperrt'); }     // gesperrt: Seite zeigt wieder die Passwortabfrage
    if (res.status === 401 || (res.status === 403 && !(await res.clone().json().catch(() => ({}))).error?.includes('Anfrage'))) {
      window.location.href = '/login.html';
      throw new Error('Nicht angemeldet');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `Fehler ${res.status}`); e.status = res.status; e.openOrderId = data.openOrderId; throw e; }
    return data;
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  // Dialog im Stil des Portals. build(el) befüllt den Inhalt, onSave(el) gibt bei Erfolg true zurück.
  function modal(title, html, { saveLabel = 'Speichern', onSave, extraButtons = '' } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal"><div class="modal-title">${esc(title)}</div>
      <div class="alert alert-error hidden" data-err></div>
      <div data-body>${html}</div>
      <div class="modal-actions">${extraButtons}<button class="btn btn-secondary" data-cancel style="flex:1">Abbrechen</button>
      ${onSave ? `<button class="btn btn-primary" data-save style="flex:1">${esc(saveLabel)}</button>` : ''}</div></div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    const showError = msg => { const e = $('[data-err]', overlay); e.textContent = msg; e.classList.toggle('hidden', !msg); if (msg) e.scrollIntoView({ block: 'nearest' }); };
    $('[data-cancel]', overlay).onclick = close;
    if (onSave) {
      const btn = $('[data-save]', overlay);
      btn.onclick = async () => {
        btn.disabled = true; showError('');
        try { if (await onSave(overlay)) close(); } catch (e) { showError(e.message); }
        finally { btn.disabled = false; }
      };
    }
    return { el: overlay, close, showError };
  }

  const confirmDialog = (title, text, label = 'Ja') => new Promise(resolve => {
    const m = modal(title, `<p>${esc(text)}</p>`, { saveLabel: label, onSave: () => { resolve(true); return true; } });
    $('[data-cancel]', m.el).addEventListener('click', () => resolve(false));
  });

  const field = (label, inner, hint) => `<div class="form-group"><label>${esc(label)}</label>${inner}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
  const options = (items, selected, empty) => (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
    items.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(selected ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const unitOptions = (selected, only) => options(Object.entries(meta.units).filter(([k]) => !only || only.includes(k)), selected);

  async function loadMeta(force) {
    if (!meta || force) meta = await api('GET', '/meta');
    return meta;
  }

  function register(name, fn) { views[name] = fn; }

  async function route() {
    const [name, arg] = (location.hash.replace(/^#\/?/, '') || 'start').split('/');
    const tab = name === 'bestellung' ? 'start' : name;
    $$('#nav .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === tab));
    const root = $('#view');
    const fn = views[name] || views.start;
    root.innerHTML = '<div class="note">Lädt…</div>';
    try { await loadMeta(); await fn(root, arg); }
    catch (e) { root.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; }
  }

  function start() {
    $$('#nav .tab-btn').forEach(b => b.onclick = () => { location.hash = '#/' + b.dataset.view; });
    window.addEventListener('hashchange', route);
    route();
  }

  return { $, $$, esc, fmt, money, api, toast, modal, confirmDialog, field, options, unitOptions, loadMeta, register, start, route,
           get meta() { return meta; } };
})();
