// Rentman Public API: ausschließlich lesend (nur GET). Der Token kommt aus der Umgebungsvariable
// RENTMAN_API, steht nie in Antworten, Logs oder im Frontend.
const API = 'https://api.rentman.net';
const PAGE = 300;
const CACHE_TTL_MS = 10 * 60 * 1000;

class RentmanError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Die Variable heißt RENTMAN_API; kleingeschrieben wird sie ebenfalls akzeptiert (wie im Kartengenerator).
const token = () => process.env.RENTMAN_API || process.env.rentman_api;
const isConfigured = () => !!token();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Einziger Zugang zur API. Es gibt bewusst keine Methode für POST, PUT oder DELETE.
async function get(path, params = {}) {
  const auth = token();
  if (!auth) throw new RentmanError('Rentman-Token (RENTMAN_API) ist nicht konfiguriert', 503);
  if (!/^\/[a-z0-9/_-]*$/i.test(path)) throw new RentmanError('Ungültiger Pfad', 400);
  const url = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${auth}` }, signal: AbortSignal.timeout(60000) });
    } catch (e) {
      if (attempt < 2) { await sleep(1000); continue; }
      throw new RentmanError('Rentman nicht erreichbar', 502);
    }
    if (res.status === 429 && attempt < 3) { await sleep(1500 * (attempt + 1)); continue; }
    if (!res.ok) throw new RentmanError(`Rentman antwortet mit Fehler ${res.status}`, res.status);
    return res.json();
  }
  throw new RentmanError('Rentman nicht erreichbar', 502);
}

// Alle Zeilen einer Liste (die API liefert höchstens 300 pro Seite und nennt keine Gesamtzahl).
async function getAll(path, params = {}) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const body = await get(path, { ...params, limit: PAGE, offset });
    const data = body.data || [];
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

const idOf = ref => (typeof ref === 'string' ? ref.split('/').pop() : null);

// Projektliste mit Status. Der Status hängt am Unterprojekt (so arbeitet auch der Kartengenerator).
async function fetchProjects() {
  const [statuses, subs, projects] = await Promise.all([
    getAll('/statuses'),
    getAll('/subprojects', { fields: 'id,project,status' }),
    getAll('/projects', { fields: 'id,number,name,planperiod_start' }),
  ]);
  const statusName = Object.fromEntries(statuses.map(s => [String(s.id), s.name]));
  const statusOf = {};
  subs.forEach(sp => { if (sp.project) statusOf[idOf(sp.project)] = idOf(sp.status); });
  return projects.map(p => {
    const sid = statusOf[String(p.id)] || null;
    return { id: String(p.id), number: p.number, name: (p.name || '').trim(), start: p.planperiod_start || null,
             statusId: sid ? Number(sid) : null, status: sid ? statusName[sid] || 'unbekannt' : 'ohne Status' };
  });
}

// Cache: Speicher plus Tabelle rentman_cache (überlebt Neustarts)
function createProjectCache(db) {
  let mem = null;
  const load = () => {
    const row = db.prepare("SELECT payload, fetched_at FROM rentman_cache WHERE key = 'projects'").get();
    return row ? { data: JSON.parse(row.payload), at: Date.parse(row.fetched_at + 'Z') } : null;
  };
  async function refresh() {
    const data = await fetchProjects();
    mem = { data, at: Date.now() };
    db.prepare("INSERT OR REPLACE INTO rentman_cache (key, payload, fetched_at) VALUES ('projects', ?, datetime('now'))").run(JSON.stringify(data));
    return mem;
  }
  return {
    async get({ force = false } = {}) {
      mem = mem || load();
      if (force || !mem) return { ...(await refresh()), fresh: true };
      if (Date.now() - mem.at > CACHE_TTL_MS) refresh().catch(() => {});   // veraltet: alte Liste sofort, neue im Hintergrund
      return { ...mem, fresh: false };
    },
    info() { mem = mem || load(); return mem ? { at: new Date(mem.at).toISOString(), count: mem.data.length } : null; },
  };
}

// Diagnose: Rohdaten eines Projekts, um ohne Raten zu klären, wo Gästezahl, Kunde, Ort, Artikelnummern
// und Custom Fields tatsächlich stehen. Jede Teilabfrage ist einzeln abgesichert.
async function diagnoseProject(id) {
  if (!/^\d+$/.test(String(id))) throw new RentmanError('Projekt-ID muss eine Zahl sein', 400);
  const out = { projectId: String(id), resources: {}, linked: {} };
  const attempt = async (key, fn) => {
    try { out.resources[key] = { ok: true, data: await fn() }; }
    catch (e) { out.resources[key] = { ok: false, error: e.message, status: e.status || null }; }
  };
  await attempt('project', async () => (await get(`/projects/${id}`)).data);
  await attempt('subprojects', () => getAll(`/projects/${id}/subprojects`));
  await attempt('projectequipment', () => getAll(`/projects/${id}/projectequipment`));
  await attempt('projectequipmentgroup', () => getAll(`/projects/${id}/projectequipmentgroup`));

  // Verknüpfungen des Projekts (z. B. Kunde, Ort) und einige Equipment-Stammdaten nachladen
  const links = new Set();
  const collect = (obj, max) => {
    for (const v of Object.values(obj || {})) {
      if (typeof v === 'string' && /^\/[a-z]+\/\d+$/.test(v) && !/^\/(projects|projectequipment|projectequipmentgroup|subprojects)\//.test(v)) links.add(v);
      if (links.size >= max) return;
    }
  };
  const project = out.resources.project.ok ? out.resources.project.data : null;
  collect(project, 12);
  const rows = out.resources.projectequipment.ok ? out.resources.projectequipment.data : [];
  const equipment = [...new Set(rows.map(r => r.equipment).filter(v => typeof v === 'string' && /^\/equipment\/\d+$/.test(v)))].slice(0, 3);
  equipment.forEach(e => links.add(e));
  for (const link of links) {
    try { out.linked[link] = (await get(link)).data; }
    catch (e) { out.linked[link] = { error: e.message }; }
  }
  return out;
}

module.exports = { RentmanError, isConfigured, get, getAll, fetchProjects, createProjectCache, diagnoseProject };
