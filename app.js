/* ============================================================
   Nexolibre · Plataforma de contratos — lógica de la SPA
   ============================================================ */
const CFG = window.NEXO_CONFIG;
const CAT = window.NEXO_CATALOGO;
const LS = {
  pat: "nexo_pat",
  user: "nexo_user",
  demo: "nexo_demo_data",
  demoVer: "nexo_demo_ver",
};
// Subir esto invalida la copia demo guardada en el navegador.
const DEMO_VERSION = "4";

// -------- estado global --------
const state = {
  mode: "demo", // 'connected' | 'demo'
  data: [],
  sha: null,
  user: localStorage.getItem(LS.user) || "",
  selected: new Set(),
  filtro: { q: "", estado: "", modalidad: "" },
  editId: null,
  soloLectura: false, // se activa solo si el token no tiene permiso de escritura
};

// -------- constantes de dominio --------
const ESTADOS = [
  { id: "borrador", label: "Borrador", grupo: "propuesta" },
  { id: "enviada", label: "Enviada", grupo: "propuesta" },
  { id: "negociacion", label: "Negociación", grupo: "propuesta" },
  { id: "firme_vigente", label: "Firme / Vigente", grupo: "contrato" },
  { id: "por_vencer", label: "Por vencer", grupo: "contrato" },
  { id: "vencida", label: "Vencida", grupo: "cerrado" },
  { id: "rescindida", label: "Rescindida", grupo: "cerrado" },
  { id: "perdida", label: "Perdida", grupo: "cerrado" },
];
const ESTADO_LABEL = Object.fromEntries(ESTADOS.map((e) => [e.id, e.label]));
const KANBAN_COLS = ["borrador", "enviada", "negociacion", "firme_vigente", "vencida"];
const ACTIVOS = new Set(["firme_vigente", "por_vencer"]);
// `modalidades` limita el servicio a los equipos donde físicamente existe:
// las bobinas de RF y la criogenia son propias de resonancia. Un tomógrafo
// no tiene ni una ni otra, así que no se cubren ni se cobran.
const SERVICIOS = [
  { key: "preventivo", label: "Preventivo" },
  { key: "correctivo", label: "Correctivo" },
  { key: "bobinas", label: "Rep. bobinas", modalidades: ["MRI"] },
  { key: "cryo", label: "Monitoreo Cryo", modalidades: ["MRI"] },
  { key: "partes", label: "Partes" },
];
const aplicaA = (srv, modalidad) => !srv.modalidades || srv.modalidades.includes(modalidad);
const tieneMRI = (c) => (c.equipos || []).some((e) => e.modalidad === "MRI");
const soloCT = (c) => (c.equipos || []).length > 0 && !tieneMRI(c);
const TIPO_ARCHIVO = {
  propuesta_pdf: "Propuesta enviada",
  acuerdo_final: "Acuerdo final negociado",
  contrato_firmado: "Contrato firmado",
  anexo: "Anexo / adenda",
  otro: "Otro",
};
const AJUSTE_STEP = { trimestral: 3, semestral: 6, anual: 12, ninguno: 0 };

// -------- helpers de fecha --------
const hoy = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
function parseDate(s) {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d) ? null : d;
}
function addMonths(date, n) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0);
  return d;
}
function fmt(d) {
  if (!d) return "—";
  const x = typeof d === "string" ? parseDate(d) : d;
  return x ? x.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}
function daysUntil(d) {
  return d ? Math.round((d - hoy()) / 86400000) : null;
}
function computeFin(c) {
  let fin = parseDate(c?.vigencia?.fin);
  if (!fin) {
    const inicio = parseDate(c?.vigencia?.inicio);
    const meses = Number(c?.vigencia?.meses);
    if (!(inicio && meses)) return null;
    fin = addMonths(inicio, meses);
    // Contrato autorrenovable: el próximo vencimiento rueda hacia adelante
    if (c?.vigencia?.renovacionAutomatica) {
      let guard = 0;
      while (fin < hoy() && guard++ < 400) fin = addMonths(fin, meses);
    }
  }
  return fin;
}
function computeProximoAjuste(c) {
  const ex = parseDate(c?.ajuste?.proximoAjuste);
  if (ex && ex >= hoy()) return ex;
  const step = AJUSTE_STEP[c?.ajuste?.periodicidad] || 0;
  const base = parseDate(c?.vigencia?.inicio) || parseDate(c?.fechas?.firmado);
  if (!step || !base) return null;
  let next = new Date(base), guard = 0;
  while (next < hoy() && guard++ < 400) next = addMonths(next, step);
  return next;
}
// ---- identidad del cliente ----
// Un cliente tiene UN nombre comercial (fantasía) y N razones sociales.
// La marcada `principal` es la que factura y firma.
function migrar(c) {
  c.cliente = c.cliente || {};
  const cl = c.cliente;
  if (!Array.isArray(cl.razonesSociales)) {
    cl.razonesSociales = cl.razonSocial
      ? [{ razonSocial: cl.razonSocial, cuit: cl.cuit || "", domicilio: "", principal: true }]
      : [];
  }
  if (!cl.nombreComercial) cl.nombreComercial = cl.razonSocial || "";
  if (cl.razonesSociales.length && !cl.razonesSociales.some((r) => r.principal)) cl.razonesSociales[0].principal = true;
  // criogenia: ya no ofrecemos mantenimiento, solo monitoreo dentro del SaaS Cryo
  if (c.cobertura) c.cobertura.criogeniaIncluida = false;
  c.archivos = c.archivos || [];
  c.plan = c.plan || { id: "", etiquetaPublica: "", modulos: [], notasInternas: "" };
  c.negociacion = c.negociacion || { desviaciones: [] };
  return c;
}
const migrarTodos = (arr) => (Array.isArray(arr) ? arr.map(migrar) : []);
// Razón social que firma/factura
const rsPrincipal = (c) => (c.cliente?.razonesSociales || []).find((r) => r.principal) || (c.cliente?.razonesSociales || [])[0] || { razonSocial: "", cuit: "" };
// Nombre que se muestra en toda la app
const nombreCliente = (c) => c.cliente?.nombreComercial || rsPrincipal(c).razonSocial || "—";

const money = (n, m = "USD") => (n || n === 0 ? `${m === "USD" ? "US$" : "$"} ${Number(n).toLocaleString("es-AR")}` : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// -------- base64 utf-8 --------
const b64encode = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob((b64 || "").replace(/\n/g, "")), (c) => c.charCodeAt(0)));

// ============================================================
//  Capa de datos (GitHub API o demo local)
// ============================================================
function ghHeaders() {
  return {
    Authorization: `Bearer ${localStorage.getItem(LS.pat)}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
// ¿El token tiene permiso de escritura sobre el repo de datos?
// Si es de solo lectura, la app se pone en modo consulta en vez de dejar
// que el usuario cargue cosas y falle recién al guardar.
async function ghPuedeEscribir() {
  try {
    const r = await fetch(`https://api.github.com/repos/${CFG.owner}/${CFG.dataRepo}`, { headers: ghHeaders() });
    if (!r.ok) return false;
    const j = await r.json();
    return !!(j.permissions?.push || j.permissions?.admin);
  } catch { return false; }
}
async function ghLoad() {
  const url = `https://api.github.com/repos/${CFG.owner}/${CFG.dataRepo}/contents/${CFG.dataPath}?ref=${CFG.branch}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (r.status === 404) return { data: [], sha: null };
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json()).message || r.statusText}`);
  const j = await r.json();
  return { data: migrarTodos(JSON.parse(b64decode(j.content))), sha: j.sha };
}
async function ghSave(msg) {
  const url = `https://api.github.com/repos/${CFG.owner}/${CFG.dataRepo}/contents/${CFG.dataPath}`;
  const body = {
    message: msg,
    content: b64encode(JSON.stringify(state.data, null, 2) + "\n"),
    branch: CFG.branch,
  };
  if (state.sha) body.sha = state.sha;
  const r = await fetch(url, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json()).message || r.statusText}`);
  state.sha = (await r.json()).content.sha;
}
async function ghUploadFile(path, base64, msg) {
  const url = `https://api.github.com/repos/${CFG.owner}/${CFG.dataRepo}/contents/${path}`;
  // averiguar sha si ya existe
  let sha;
  const cur = await fetch(`${url}?ref=${CFG.branch}`, { headers: ghHeaders() });
  if (cur.ok) sha = (await cur.json()).sha;
  const body = { message: msg, content: base64, branch: CFG.branch };
  if (sha) body.sha = sha;
  const r = await fetch(url, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Upload ${r.status}`);
}

async function persist(msg) {
  if (state.soloLectura) throw new Error("Tu acceso es de solo lectura: podés consultar y descargar, no modificar.");
  if (state.mode === "connected") {
    await ghSave(msg);
  } else {
    localStorage.setItem(LS.demo, JSON.stringify(state.data));
    localStorage.setItem(LS.demoVer, DEMO_VERSION);
    toast("Modo demo: cambios guardados solo en este navegador", true, false);
  }
}

// Dataset demo embebido: clientes FICTICIOS, a propósito.
// Este archivo vive en un repo público. Nunca poner acá datos reales de
// clientes (nombres, contactos, canones): los datos reales viven solo en
// el repo privado y llegan por la API con el token de cada usuario.
const DEMO_SEED = [
  {
    id: "demo_propuesta", tipo: "propuesta", numero: "P20260101", estado: "enviada",
    cliente: {
      nombreComercial: "Centro de Imágenes Ejemplo",
      razonesSociales: [{ razonSocial: "Centro de Imágenes Ejemplo S.A.", cuit: "30-00000000-0", domicilio: "Calle Ejemplo 100", principal: true }],
      contacto: "Contacto de ejemplo", localidad: "Ciudad Ejemplo", provincia: "Buenos Aires",
    },
    plan: { id: "professional", etiquetaPublica: "Contrato Professional", modulos: ["cryo"], notasInternas: "Registro de ejemplo para probar la interfaz." },
    equipos: [
      { modelo: "Modelo A 1.5T", marca: "GE", modalidad: "MRI", serie: "", ubicacion: "Sede central" },
      { modelo: "Modelo B", marca: "GE", modalidad: "CT", serie: "", ubicacion: "Sede central" },
    ],
    cobertura: { preventivoInspeccionesAnuales: 4, correctivoManoObra: true, reparacionBobinasPorAnio: 2, soporteRemoto: true, saasMonitoreo: true, partesIncluidas: false, viaticosIncluidos: true, enviosRepuestosIncluidos: true, reparacionesIncluidas: ["Reparación electrónica de bobinas de RM (hasta 2 por año, no acumulables)"] },
    economico: { canonMensual: 2000, moneda: "USD", incluyeIVA: false, ivaPct: 21, formaPago: "Mensual, antes del 5º día hábil" },
    ajuste: { periodicidad: "trimestral", indice: "US_CPI", proximoAjuste: "", historial: [] },
    vigencia: { inicio: "", meses: 12, fin: "", renovacionAutomatica: true, preavisoDias: 30 },
    fechas: { creado: "2026-01-01", enviado: "2026-01-01", firmado: "" },
    archivos: [], notas: "Registro de ejemplo. Los datos reales se cargan al conectar con el repositorio privado.",
    negociacion: { desviaciones: [] },
    historialEstados: [{ estado: "borrador", fecha: "2026-01-01", usuario: "demo" }, { estado: "enviada", fecha: "2026-01-01", usuario: "demo" }],
  },
  {
    id: "demo_contrato", tipo: "contrato", numero: "P20250505", estado: "firme_vigente",
    cliente: {
      nombreComercial: "Diagnóstico Demo",
      razonesSociales: [
        { razonSocial: "Diagnóstico Demo S.R.L.", cuit: "30-11111111-1", domicilio: "Av. Ejemplo 200", principal: true },
        { razonSocial: "Demo Imágenes S.A.", cuit: "30-22222222-2", domicilio: "", principal: false },
      ],
      contacto: "Contacto de ejemplo", localidad: "Ciudad Ejemplo", provincia: "Santa Fe",
    },
    plan: { id: "enterprise", etiquetaPublica: "Contrato Enterprise", modulos: ["bobinas", "prioridad"], notasInternas: "Registro de ejemplo: muestra la composición interna." },
    equipos: [{ modelo: "Modelo C 1.5T", marca: "Philips", modalidad: "MRI", serie: "", ubicacion: "Sede única" }],
    cobertura: {
      preventivoInspeccionesAnuales: 4, correctivoManoObra: true, reparacionBobinasPorAnio: "sin límite",
      soporteRemoto: true, saasMonitoreo: true, partesIncluidas: false,
      viaticosIncluidos: true, enviosRepuestosIncluidos: true,
      reparacionesIncluidas: [
        "Bobinas de RM: todas las del equipo, sin límite de reparaciones",
        "Reparaciones electromecánicas de camilla paciente",
        "Host y recargas de software",
      ],
    },
    economico: { canonMensual: 3000, moneda: "USD", incluyeIVA: false, ivaPct: 21, formaPago: "Mensual (mes vencido), entre el día 1 y 10 de cada mes" },
    ajuste: { periodicidad: "semestral", indice: "US_CPI", proximoAjuste: "", historial: [] },
    vigencia: { inicio: "2025-05-05", meses: 12, fin: "", renovacionAutomatica: true, preavisoDias: 30 },
    fechas: { creado: "2025-05-05", enviado: "2025-05-05", firmado: "2025-05-05" },
    archivos: [], notas: "Registro de ejemplo.",
    negociacion: { desviaciones: [] },
    historialEstados: [
      { estado: "borrador", fecha: "2025-05-05", usuario: "demo" },
      { estado: "enviada", fecha: "2025-05-05", usuario: "demo" },
      { estado: "firme_vigente", fecha: "2025-05-05", usuario: "demo" },
    ],
  },
];

// ============================================================
//  Init
// ============================================================
async function init() {
  bindChrome();
  const pat = localStorage.getItem(LS.pat);
  if (pat) {
    try {
      const { data, sha } = await ghLoad();
      state.mode = "connected";
      state.data = data;
      state.sha = sha;
      state.soloLectura = !(await ghPuedeEscribir());
    } catch (e) {
      toast("No se pudo conectar: " + e.message + " — modo demo", true, true);
      loadDemo();
    }
  } else {
    loadDemo();
  }
  refreshWho();
  router();
}
function loadDemo() {
  state.mode = "demo";
  // Si la semilla cambió de versión, la copia guardada queda obsoleta y se descarta:
  // si no, un navegador con datos viejos nunca vería los registros nuevos.
  const saved = localStorage.getItem(LS.demo);
  const ver = localStorage.getItem(LS.demoVer);
  state.data = saved && ver === DEMO_VERSION ? migrarTodos(JSON.parse(saved)) : structuredClone(DEMO_SEED).map(migrar);
  localStorage.setItem(LS.demoVer, DEMO_VERSION);
}
function resetDemo() {
  localStorage.removeItem(LS.demo);
  localStorage.removeItem(LS.demoVer);
  loadDemo();
  toast("Datos demo restablecidos");
  closeSetup();
  router();
}
function refreshWho() {
  const el = document.getElementById("who");
  const modo = state.mode === "connected"
    ? `<b>${esc(state.user || "—")}</b> · conectado${state.soloLectura ? ' <span class="pill-ro">👁 solo lectura</span>' : ""}`
    : `<b>demo</b> · sin conexión`;
  el.innerHTML = modo;
  // En modo consulta no se ofrece dar de alta nada.
  const bn = document.getElementById("btnNuevo");
  if (bn) bn.style.display = state.soloLectura ? "none" : "";
}

// ============================================================
//  Router / navegación
// ============================================================
function router() {
  const view = (location.hash.replace("#", "") || "dashboard").split("/");
  const name = view[0];
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  const target = document.getElementById("view-" + name) || document.getElementById("view-dashboard");
  target.classList.add("active");
  const R = { dashboard: renderDashboard, pipeline: renderPipeline, listado: renderListado, agenda: renderAgenda, detalle: () => renderDetalle(view[1]), form: () => renderForm(view[1]) };
  (R[name] || renderDashboard)();
}
window.addEventListener("hashchange", router);
const go = (h) => (location.hash = h);

function bindChrome() {
  document.querySelectorAll("#nav button").forEach((b) => (b.onclick = () => go(b.dataset.view)));
  document.getElementById("btnNuevo").onclick = () => go("form/new");
  document.getElementById("btnConfig").onclick = openSetup;
  document.getElementById("setupCancel").onclick = closeSetup;
  document.getElementById("setupSave").onclick = saveSetup;
  document.getElementById("repoName").textContent = `${CFG.owner}/${CFG.dataRepo}`;
  document.getElementById("repoName2").textContent = `${CFG.owner}/${CFG.dataRepo}`;
}

// ============================================================
//  Alertas / cálculos de portfolio
// ============================================================
function calcAlertas() {
  const venc = [], aum = [];
  for (const c of state.data) {
    if (!ACTIVOS.has(c.estado)) continue;
    const fin = computeFin(c), dv = daysUntil(fin);
    if (dv !== null && dv <= 30) venc.push({ c, fin, dias: dv });
    const pa = computeProximoAjuste(c), da = daysUntil(pa);
    if (da !== null && da <= 15 && da >= -3) aum.push({ c, fecha: pa, dias: da });
  }
  venc.sort((a, b) => a.dias - b.dias);
  aum.sort((a, b) => a.dias - b.dias);
  return { venc, aum };
}

// ============================================================
//  Vista: Dashboard
// ============================================================
function renderDashboard() {
  const el = document.getElementById("view-dashboard");
  const vigentes = state.data.filter((c) => ACTIVOS.has(c.estado));
  const pipeline = state.data.filter((c) => ["borrador", "enviada", "negociacion"].includes(c.estado));
  const mrr = vigentes.reduce((s, c) => s + (Number(c.economico?.canonMensual) || 0), 0);
  const { venc, aum } = calcAlertas();

  el.innerHTML = `
    <div class="kicker">Panel general</div>
    <div class="page-head">
      <h1>Tablero de <span class="accent">contratos</span></h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" onclick="exportarInforme()">📄 Informe para dirección</button>
        <button class="btn sm" onclick="exportarCSV()">⬇ CSV</button>
      </div>
    </div>
    <div class="grid-kpi">
      ${kpi("Contratos vigentes", vigentes.length, "en servicio activo")}
      ${kpi("En pipeline", pipeline.length, "propuestas abiertas")}
      ${kpi("Ingreso mensual", money(mrr), "USD/mes recurrente")}
      ${kpi("Por vencer", venc.length, "≤ 30 días", venc.length ? "warn" : "")}
      ${kpi("Aumentos", aum.length, "≤ 15 días", aum.length ? "warn" : "")}
    </div>
    <div class="card alert-panel">
      <h3>🔔 Próximas acciones</h3>
      ${venc.length || aum.length ? [
        ...venc.map((v) => alertRow("venc", "Vence", v.c, `${fmt(v.fin)} · faltan ${v.dias} días`)),
        ...aum.map((a) => alertRow("aum", "Aumento", a.c, `${fmt(a.fecha)} · ${a.c.ajuste?.periodicidad} · faltan ${a.dias} días`)),
      ].join("") : `<p class="muted">Sin vencimientos ni aumentos dentro de los umbrales. ✅</p>`}
    </div>
    <div class="card">
      <h3>Cartera por estado</h3>
      ${renderBarras()}
    </div>`;
}
function kpi(label, num, sub, tone = "") {
  return `<div class="kpi"><div class="label">${label}</div><div class="num" ${tone === "warn" ? 'style="color:var(--warn)"' : ""}>${num}</div><div class="sub">${sub}</div></div>`;
}
function alertRow(tipo, tag, c, detail) {
  return `<div class="alert-row" onclick="location.hash='detalle/${c.id}'" style="cursor:pointer">
    <span class="tag ${tipo}">${tag}</span>
    <b>${esc(c.numero)}</b> · ${esc(nombreCliente(c))}
    <span class="spacer" style="flex:1"></span>
    <span class="muted">${detail}</span></div>`;
}
function renderBarras() {
  const counts = {};
  ESTADOS.forEach((e) => (counts[e.id] = 0));
  state.data.forEach((c) => (counts[c.estado] = (counts[c.estado] || 0) + 1));
  const max = Math.max(1, ...Object.values(counts));
  return `<div style="display:flex;flex-direction:column;gap:8px">${ESTADOS.filter((e) => counts[e.id]).map((e) => `
    <div style="display:flex;align-items:center;gap:10px">
      <span style="width:130px;font-size:13px;color:var(--taupe)">${e.label}</span>
      <div style="flex:1;background:var(--surface-2);border-radius:8px;height:22px;overflow:hidden">
        <div style="width:${(counts[e.id] / max) * 100}%;height:100%;background:var(--orange);border-radius:8px"></div>
      </div>
      <b style="width:26px;text-align:right">${counts[e.id]}</b>
    </div>`).join("")}</div>`;
}

// ============================================================
//  Vista: Pipeline (kanban)
// ============================================================
function renderPipeline() {
  const el = document.getElementById("view-pipeline");
  el.innerHTML = `
    <div class="kicker">Flujo comercial</div>
    <div class="page-head"><h1>Pipeline de <span class="accent">propuestas</span></h1></div>
    <div class="kanban">${KANBAN_COLS.map((estId) => {
      const items = state.data.filter((c) => c.estado === estId);
      return `<div class="kcol"><h4>${ESTADO_LABEL[estId]} <span class="count">${items.length}</span></h4>
        ${items.map(kcard).join("") || '<p class="muted" style="font-size:13px">—</p>'}</div>`;
    }).join("")}</div>`;
}
function kcard(c) {
  const next = nextEstado(c.estado);
  return `<div class="kcard">
    <div class="cli" onclick="location.hash='detalle/${c.id}'" style="cursor:pointer">${esc(nombreCliente(c))}</div>
    <div class="meta">${esc(c.numero)} · ${c.equipos?.length || 0} equipos</div>
    <div class="row"><span class="num-usd">${money(c.economico?.canonMensual)}/mes</span>
      ${next && !state.soloLectura ? `<button class="btn sm" onclick="avanzar('${c.id}')">→ ${ESTADO_LABEL[next]}</button>` : ""}
    </div></div>`;
}
function nextEstado(est) {
  const flujo = ["borrador", "enviada", "negociacion", "firme_vigente"];
  const i = flujo.indexOf(est);
  return i >= 0 && i < flujo.length - 1 ? flujo[i + 1] : null;
}
async function avanzar(id) {
  const c = state.data.find((x) => x.id === id);
  const next = nextEstado(c.estado);
  if (!next) return;
  if (next === "firme_vigente" && !c.vigencia?.inicio) {
    const f = prompt("Fecha de inicio de vigencia (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!f) return;
    c.vigencia.inicio = f;
    c.tipo = "contrato";
    c.fechas.firmado = f;
  }
  await cambiarEstado(c, next);
}
async function cambiarEstado(c, nuevo) {
  c.estado = nuevo;
  c.historialEstados = c.historialEstados || [];
  c.historialEstados.push({ estado: nuevo, fecha: new Date().toISOString().slice(0, 10), usuario: state.user || "—" });
  try {
    await persist(`Estado ${c.numero} → ${nuevo}`);
    toast(`${c.numero}: ${ESTADO_LABEL[nuevo]}`);
    router();
  } catch (e) { toast("Error: " + e.message, true, true); }
}

// ============================================================
//  Vista: Listado
// ============================================================
function renderListado() {
  const el = document.getElementById("view-listado");
  const rows = filtrados();
  el.innerHTML = `
    <div class="kicker">Base completa</div>
    <div class="page-head">
      <h1>Todos los <span class="accent">contratos</span></h1>
      <div style="display:flex;gap:8px">
        <button class="btn sm" onclick="exportarCSV()">⬇ CSV</button>
        <button class="btn sm" onclick="exportarInforme()">⬇ Informe PDF</button>
      </div>
    </div>
    <div class="table-tools">
      <input type="search" id="fq" placeholder="Buscar cliente o N°…" value="${esc(state.filtro.q)}" />
      <select id="festado"><option value="">Todos los estados</option>${ESTADOS.map((e) => `<option value="${e.id}" ${state.filtro.estado === e.id ? "selected" : ""}>${e.label}</option>`).join("")}</select>
      <select id="fmod"><option value="">Toda modalidad</option><option value="MRI" ${state.filtro.modalidad === "MRI" ? "selected" : ""}>MRI</option><option value="CT" ${state.filtro.modalidad === "CT" ? "selected" : ""}>CT</option></select>
      <span class="muted" style="font-size:13px">${rows.length} de ${state.data.length}</span>
    </div>
    <div class="overflow"><table class="data">
      <thead><tr>
        <th style="width:34px"><input type="checkbox" id="selAll"></th>
        <th>N°</th><th>Cliente</th><th>Equipos</th><th>Estado</th><th>Canon</th><th>Vence</th><th>Próx. ajuste</th>
      </tr></thead>
      <tbody>${rows.map(trContrato).join("") || `<tr><td colspan="8" class="empty">Sin resultados</td></tr>`}</tbody>
    </table></div>`;
  document.getElementById("fq").oninput = (e) => { state.filtro.q = e.target.value; renderListado(); };
  document.getElementById("festado").onchange = (e) => { state.filtro.estado = e.target.value; renderListado(); };
  document.getElementById("fmod").onchange = (e) => { state.filtro.modalidad = e.target.value; renderListado(); };
  document.getElementById("selAll").onclick = (e) => {
    rows.forEach((c) => (e.target.checked ? state.selected.add(c.id) : state.selected.delete(c.id)));
    renderListado();
  };
}
function filtrados() {
  return state.data.filter((c) => {
    const q = state.filtro.q.toLowerCase();
    // busca por N°, nombre de fantasía, cualquier razón social y cualquier CUIT
    const rs = (c.cliente?.razonesSociales || []).map((r) => `${r.razonSocial} ${r.cuit}`).join(" ");
    if (q && !(`${c.numero} ${c.cliente?.nombreComercial || ""} ${rs}`.toLowerCase().includes(q))) return false;
    if (state.filtro.estado && c.estado !== state.filtro.estado) return false;
    if (state.filtro.modalidad && !c.equipos?.some((e) => e.modalidad === state.filtro.modalidad)) return false;
    return true;
  });
}
function trContrato(c) {
  const fin = computeFin(c), dv = daysUntil(fin);
  const pa = computeProximoAjuste(c), da = daysUntil(pa);
  const vencTxt = fin ? `${fmt(fin)}${dv !== null && dv <= 30 ? ` <span class="badge por_vencer">${dv}d</span>` : ""}` : "—";
  const ajTxt = pa ? `${fmt(pa)}${da !== null && da <= 15 ? ` <span class="badge por_vencer">${da}d</span>` : ""}` : "—";
  return `<tr onclick="location.hash='detalle/${c.id}'">
    <td onclick="event.stopPropagation()"><input type="checkbox" ${state.selected.has(c.id) ? "checked" : ""} onclick="toggleSel('${c.id}',this.checked)"></td>
    <td><b>${esc(c.numero)}</b></td>
    <td><b>${esc(nombreCliente(c))}</b>${(() => {
      const rss = c.cliente?.razonesSociales || [];
      const p = rsPrincipal(c).razonSocial;
      if (!p || p === nombreCliente(c)) return "";
      return `<br><span class="muted" style="font-size:12px">${esc(p)}${rss.length > 1 ? ` · +${rss.length - 1} razón/es social/es` : ""}</span>`;
    })()}</td>
    <td>${(c.equipos || []).length} <span class="muted">(${[...new Set((c.equipos || []).map((e) => e.modalidad))].join("/")})</span></td>
    <td><span class="badge ${c.estado}">${ESTADO_LABEL[c.estado]}</span></td>
    <td>${money(c.economico?.canonMensual)}</td>
    <td>${vencTxt}</td>
    <td>${ajTxt}</td></tr>`;
}
function toggleSel(id, on) { on ? state.selected.add(id) : state.selected.delete(id); }

// ============================================================
//  Vista: Agenda (vencimientos y aumentos)
// ============================================================
function renderAgenda() {
  const el = document.getElementById("view-agenda");
  const items = [];
  for (const c of state.data) {
    if (!ACTIVOS.has(c.estado)) continue;
    const fin = computeFin(c);
    if (fin) items.push({ c, fecha: fin, tipo: "venc", dias: daysUntil(fin) });
    const pa = computeProximoAjuste(c);
    if (pa) items.push({ c, fecha: pa, tipo: "aum", dias: daysUntil(pa) });
  }
  items.sort((a, b) => a.fecha - b.fecha);
  el.innerHTML = `
    <div class="kicker">Calendario</div>
    <div class="page-head"><h1>Vencimientos y <span class="accent">aumentos</span></h1></div>
    <div class="card">
      ${items.length ? `<div class="overflow"><table class="data"><thead><tr><th>Fecha</th><th>Tipo</th><th>Contrato</th><th>Detalle</th><th>Faltan</th></tr></thead><tbody>
      ${items.map((i) => `<tr onclick="location.hash='detalle/${i.c.id}'">
        <td><b>${fmt(i.fecha)}</b></td>
        <td><span class="tag ${i.tipo}">${i.tipo === "venc" ? "Vencimiento" : "Aumento"}</span></td>
        <td>${esc(i.c.numero)} · ${esc(nombreCliente(i.c))}</td>
        <td class="muted">${i.tipo === "venc" ? "Fin de vigencia" : `Ajuste ${i.c.ajuste?.periodicidad} (${i.c.ajuste?.indice})`}</td>
        <td>${i.dias < 0 ? '<span class="badge vencida">vencido</span>' : `${i.dias} días${i.dias <= 15 ? ' <span class="badge por_vencer">pronto</span>' : ""}`}</td>
      </tr>`).join("")}
      </tbody></table></div>` : `<p class="empty">No hay contratos vigentes con fechas cargadas todavía.</p>`}
    </div>`;
}

// ============================================================
//  Vista: Detalle
// ============================================================
function renderDetalle(id) {
  const c = state.data.find((x) => x.id === id);
  const el = document.getElementById("view-detalle");
  if (!c) { el.innerHTML = `<p class="empty">No encontrado. <a href="#listado">Volver</a></p>`; return; }
  const fin = computeFin(c), pa = computeProximoAjuste(c);
  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="kicker">${c.tipo === "contrato" ? "Contrato" : "Propuesta"} · <span class="badge ${c.estado}">${ESTADO_LABEL[c.estado]}</span></div>
        <h1>${esc(nombreCliente(c))}</h1>
        <p class="muted">${esc(c.numero)} · ${esc(c.cliente?.contacto || "")} · ${esc(c.cliente?.localidad || "")}</p>
        ${c.plan?.id ? `<p style="margin:4px 0 0"><span class="pill-plan">${esc(CAT.PLANES[c.plan.id]?.label || c.plan.id)}</span>
          ${(c.plan.modulos || []).length ? `<span class="pill-int" title="Uso interno · no aparece en el documento del cliente">🔒 ${c.plan.modulos.length} módulo${c.plan.modulos.length > 1 ? "s" : ""} interno${c.plan.modulos.length > 1 ? "s" : ""}</span>` : ""}</p>` : ""}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${state.soloLectura ? "" : `<button class="btn sm" onclick="location.hash='form/${c.id}'">✎ Editar</button>`}
        <button class="btn sm" onclick="generarPDF('${c.id}')">🧾 Ver / descargar documento</button>
        ${!state.soloLectura && c.estado !== "firme_vigente" && ["enviada", "negociacion", "borrador"].includes(c.estado) ? `<button class="btn primary sm" onclick="hacerFirme('${c.id}')">✔ Marcar firme</button>` : ""}
      </div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="card"><h3>Cobertura por equipo</h3>${renderCoverage(c)}</div>
        ${(c.cobertura?.reparacionesIncluidas || []).length ? `<div class="card"><h3>Reparaciones / partes incluidas</h3>
          <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7">${c.cobertura.reparacionesIncluidas.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
        <div class="card"><h3>Alcance del servicio</h3><div class="check-row">
          ${coberturaChips(c)}
        </div></div>
        ${renderComposicionInterna(c)}
        ${renderArchivos(c)}
      </div>
      <div>
        <div class="card"><h3>Datos económicos</h3>
          <dl class="kv">
            <dt>Canon mensual</dt><dd><b>${money(c.economico?.canonMensual, c.economico?.moneda)}</b> ${c.economico?.incluyeIVA ? "(IVA incl.)" : "+ IVA"}</dd>
            ${!c.economico?.incluyeIVA && c.economico?.canonMensual ? `<dt>Total c/ IVA ${c.economico?.ivaPct ?? 21}%</dt><dd>${money(Math.round(Number(c.economico.canonMensual) * (1 + (Number(c.economico?.ivaPct ?? 21) / 100))), c.economico?.moneda)}</dd>` : ""}
            <dt>Forma de pago</dt><dd>${esc(c.economico?.formaPago || "—")}</dd>
            <dt>Ajuste</dt><dd>${c.ajuste?.periodicidad || "—"} · ${c.ajuste?.indice || ""}</dd>
            <dt>Próximo ajuste</dt><dd>${fmt(pa)}</dd>
          </dl>
        </div>
        <div class="card"><h3>Vigencia</h3>
          <dl class="kv">
            <dt>Inicio</dt><dd>${fmt(c.vigencia?.inicio)}</dd>
            <dt>Duración</dt><dd>${c.vigencia?.meses || "—"} meses</dd>
            <dt>Vencimiento</dt><dd><b>${fmt(fin)}</b></dd>
            <dt>Renovación</dt><dd>${c.vigencia?.renovacionAutomatica ? "Automática" : "Manual"} · preaviso ${c.vigencia?.preavisoDias || 0}d</dd>
          </dl>
        </div>
        <div class="card"><h3>Identidad del cliente</h3>
          <dl class="kv">
            <dt>Nombre comercial</dt><dd><b>${esc(c.cliente?.nombreComercial || "—")}</b></dd>
          </dl>
          <h4 style="margin:10px 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--taupe)">Razones sociales</h4>
          ${(c.cliente?.razonesSociales || []).length ? `<ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.7">
            ${c.cliente.razonesSociales.map((r) => `<li>${esc(r.razonSocial)} ${r.cuit ? `<span class="muted">· CUIT ${esc(r.cuit)}</span>` : ""} ${r.principal ? '<span class="pill-plan" style="font-size:10px">factura / firma</span>' : ""}</li>`).join("")}
          </ul>` : `<p class="muted" style="font-size:13px">Sin razones sociales cargadas.</p>`}
        </div>
        <div class="card"><h3>Trazabilidad</h3>
          <ul class="tl">${(c.historialEstados || []).slice().reverse().map((h) => `<li><span class="est">${ESTADO_LABEL[h.estado] || h.estado}</span> <span class="fch">${fmt(h.fecha)} · ${esc(h.usuario || "")}</span></li>`).join("")}</ul>
        </div>
        ${c.notas ? `<div class="card"><h3>Notas</h3><p style="font-size:14px">${esc(c.notas)}</p></div>` : ""}
      </div>
    </div>
    <p style="margin-top:14px"><a href="#listado">← Volver al listado</a></p>`;
}
// ---- Composición interna: SOLO para el equipo Nexolibre. No se imprime. ----
function renderComposicionInterna(c) {
  const plan = CAT.PLANES[c.plan?.id];
  if (!plan) return "";
  const mods = (c.plan.modulos || []).map((m) => CAT.MODULOS[m]).filter(Boolean);
  const der = CAT.derivarDePlan(c.plan.id, c.plan.modulos || []);
  const canon = Number(c.economico?.canonMensual) || 0;
  const delta = canon - der.valorSugerido;
  const desv = c.negociacion?.desviaciones || [];
  return `<div class="card interno">
    <h3>🔒 Composición interna <span class="muted" style="font-weight:400;font-size:12px">— no aparece en el documento del cliente</span></h3>
    <p style="font-size:14px;margin:0 0 10px">
      El cliente lee <b>«${esc(c.plan.etiquetaPublica || plan.etiquetaPublica)}»</b>. Por dentro es:
    </p>
    <div class="check-row">
      <span class="pill-plan">${esc(plan.label)}</span>
      ${mods.map((m) => `<span class="pill-int" title="${esc(m.desc)}">+ ${esc(m.label)}</span>`).join("")}
    </div>
    <dl class="kv" style="margin-top:12px">
      <dt>Valor de referencia</dt><dd>${money(der.valorSugerido)}/mes ${mods.length ? `<span class="muted">(base ${money(plan.desde || 0)} + módulos)</span>` : ""}</dd>
      <dt>Canon pactado</dt><dd><b>${money(canon)}</b>/mes</dd>
      <dt>Diferencia</dt><dd style="color:${delta < 0 ? "var(--warn)" : "inherit"}"><b>${delta >= 0 ? "+" : ""}${money(delta)}</b> ${delta < 0 ? "— por debajo de la referencia" : ""}</dd>
      <dt>SLA efectivo</dt><dd>remoto ${der.sla.remoto} h · on-site ${der.sla.onsite} h · repuesto ${der.sla.repuesto} h</dd>
    </dl>
    ${desv.length ? `<h4 style="margin:12px 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--taupe)">Cambios acordados en la negociación</h4>
      <ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.7">${desv.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
    ${c.plan.notasInternas ? `<p class="muted" style="font-size:13px;margin-top:10px">${esc(c.plan.notasInternas)}</p>` : ""}
  </div>`;
}

// ---- Documentos adjuntos (propuesta, acuerdo final negociado, firmado) ----
function renderArchivos(c) {
  const arr = c.archivos || [];
  const base = `https://github.com/${CFG.owner}/${CFG.dataRepo}/blob/${CFG.branch}/`;
  return `<div class="card"><h3>Documentos del expediente</h3>
    ${arr.length ? `<ul class="files">${arr.map((a, i) => `<li>
      <span class="pill-modal">${TIPO_ARCHIVO[a.tipo] || a.tipo || "Archivo"}</span>
      ${a.path ? `<a href="${base}${encodeURI(a.path)}" target="_blank" rel="noopener">${esc(a.nombre)}</a>` : `<span>${esc(a.nombre)}</span> <span class="muted">(sin subir)</span>`}
      ${a.fecha ? `<span class="muted"> · ${fmt(a.fecha)}</span>` : ""}
      ${state.soloLectura ? "" : `<button class="btn sm danger" onclick="quitarArchivo('${c.id}',${i})">✕</button>`}
    </li>`).join("")}</ul>` : `<p class="muted" style="font-size:13px">Todavía no hay documentos adjuntos.</p>`}
    ${state.soloLectura ? "" : `<div class="upload-row">
      <select id="upTipo">${Object.entries(TIPO_ARCHIVO).map(([k, v]) => `<option value="${k}" ${k === "acuerdo_final" ? "selected" : ""}>${v}</option>`).join("")}</select>
      <input type="file" id="upFile" accept=".pdf,.doc,.docx,.png,.jpg">
      <button class="btn sm primary" onclick="subirArchivo('${c.id}')">⬆ Adjuntar</button>
    </div>
    <p class="muted" style="font-size:12px;margin:8px 0 0">El contrato firmado casi nunca es idéntico al modelo: subí acá la versión final negociada para que quede como documento de referencia del expediente.</p>`}
  </div>`;
}

async function subirArchivo(id) {
  const c = state.data.find((x) => x.id === id);
  const inp = document.getElementById("upFile");
  const tipo = document.getElementById("upTipo").value;
  const file = inp.files[0];
  if (!file) { toast("Elegí un archivo primero", true, true); return; }
  if (state.mode !== "connected") { toast("Necesitás estar conectado para adjuntar archivos", true, true); return; }
  toast("Subiendo…");
  try {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const safe = file.name.replace(/[^\w.\- ]/g, "_");
    const path = `archivos/${c.numero}/${safe}`;
    await ghUploadFile(path, b64, `Adjunto ${TIPO_ARCHIVO[tipo]} · ${c.numero}`);
    c.archivos = c.archivos || [];
    c.archivos.push({ nombre: safe, path, tipo, fecha: new Date().toISOString().slice(0, 10), usuario: state.user || "—" });
    await persist(`Adjunto ${safe} · ${c.numero}`);
    toast("Adjuntado ✓");
    router();
  } catch (e) { toast("Error al subir: " + e.message, true, true); }
}
async function quitarArchivo(id, i) {
  const c = state.data.find((x) => x.id === id);
  if (!confirm(`¿Quitar «${c.archivos[i]?.nombre}» del expediente?\n(El archivo queda en el repositorio; solo se saca de la ficha.)`)) return;
  c.archivos.splice(i, 1);
  await persist(`Quita adjunto · ${c.numero}`);
  router();
}

function renderCoverage(c) {
  const cov = c.cobertura || {};
  const val = {
    preventivo: cov.preventivoInspeccionesAnuales ? `${cov.preventivoInspeccionesAnuales}×` : null,
    correctivo: cov.correctivoManoObra,
    bobinas: cov.reparacionBobinasPorAnio ? (typeof cov.reparacionBobinasPorAnio === "number" ? `${cov.reparacionBobinasPorAnio}×` : String(cov.reparacionBobinasPorAnio)) : false,
    cryo: cov.saasMonitoreo,
    partes: cov.partesIncluidas,
  };
  const cellFor = (srv, modalidad) => {
    // El servicio no existe en este tipo de equipo: no es una exclusión
    // comercial, es que físicamente no aplica.
    if (!aplicaA(srv, modalidad)) return `<span class="na" title="No aplica a ${modalidad}">n/a</span>`;
    const v = val[srv.key];
    if (typeof v === "string") return `<span class="chk">✓ ${v}</span>`;
    if (v === true) return `<span class="chk">✓</span>`;
    if (srv.key === "partes") return `<span class="exc">excl.</span>`;
    return `<span class="no">—</span>`;
  };
  return `<div class="overflow"><table class="cover">
    <thead><tr><th>Equipo</th>${SERVICIOS.map((s) => `<th>${s.label}</th>`).join("")}</tr></thead>
    <tbody>${(c.equipos || []).map((e) => `<tr><td><b>${esc(e.marca)} ${esc(e.modelo)}</b> <span class="pill-modal">${e.modalidad}</span></td>${SERVICIOS.map((s) => `<td>${cellFor(s, e.modalidad)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>
  ${(c.equipos || []).some((e) => e.modalidad === "CT") ? `<p class="muted" style="font-size:12px;margin:8px 0 0">
    <b>n/a</b>: la reparación de bobinas y el monitoreo criogénico son propios de resonancia; los equipos de CT quedan cubiertos por preventivo, correctivo y el resto del alcance.</p>` : ""}`;
}
function coberturaChips(c) {
  const cov = c.cobertura || {};
  const chips = [];
  if (cov.preventivoInspeccionesAnuales) chips.push(`Preventivo ${cov.preventivoInspeccionesAnuales}/año`);
  if (cov.correctivoManoObra) chips.push("Correctivo (mano de obra)");
  // Bobinas y criogenia solo se anuncian si hay al menos un equipo de RM.
  if (cov.reparacionBobinasPorAnio && tieneMRI(c)) chips.push(`Rep. bobinas ${cov.reparacionBobinasPorAnio}/año (RM)`);
  if (cov.soporteRemoto) chips.push("Soporte remoto");
  if (cov.saasMonitoreo && tieneMRI(c)) chips.push("SaaS Gestión y Monitoreo Cryo (RM)");
  if (cov.viaticosIncluidos) chips.push("Viáticos incluidos");
  if (cov.enviosRepuestosIncluidos) chips.push("Envío de repuestos incluido");
  if (cov.stockReservado) chips.push("Partes críticas disponibles");
  if (cov.capacitacion) chips.push("Capacitación anual");
  if (cov.auditoria) chips.push("Auditoría de performance");
  if (cov.bancoHoras) chips.push(`Banco de ${cov.bancoHoras} h de ingeniería`);
  chips.push(cov.partesIncluidas ? "Partes incluidas" : "Partes NO incluidas");
  // Ofrecemos MONITOREO criogénico (dentro del SaaS Cryo), no mantenimiento de criogenia.
  if (tieneMRI(c)) chips.push(cov.saasMonitoreo ? "Criogenia: monitoreo (no mantenimiento)" : "Criogenia no cubierta");
  if (soloCT(c)) chips.push("Solo CT: sin bobinas ni criogenia");
  return chips.map((t) => `<span class="pill-modal" style="padding:5px 10px">${esc(t)}</span>`).join("");
}
async function hacerFirme(id) {
  const c = state.data.find((x) => x.id === id);
  const f = prompt("Fecha de inicio de vigencia / firma (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
  if (!f) return;
  c.vigencia.inicio = f;
  c.fechas.firmado = f;
  c.tipo = "contrato";
  await cambiarEstado(c, "firme_vigente");
  go("detalle/" + id);
}

// ============================================================
//  Vista: Formulario (alta / edición)
// ============================================================
function renderForm(id) {
  const el = document.getElementById("view-form");
  const isNew = !id || id === "new";
  const c = isNew ? nuevoContrato() : structuredClone(state.data.find((x) => x.id === id));
  if (!c) { el.innerHTML = `<p class="empty">No encontrado</p>`; return; }
  state.editId = isNew ? null : id;
  window._draft = c;
  const cov = c.cobertura || {};
  el.innerHTML = `
    <div class="kicker">${isNew ? "Alta" : "Edición"}</div>
    <div class="page-head"><h1>${isNew ? "Nueva" : "Editar"} <span class="accent">propuesta</span></h1></div>
    <form id="cform">
      <fieldset><legend>Cliente</legend><div class="form-grid">
        ${inp("Nombre comercial / fantasía", "cliente.nombreComercial", c.cliente.nombreComercial, "full")}
        ${inp("Contacto", "cliente.contacto", c.cliente.contacto)}
        ${inp("Localidad", "cliente.localidad", c.cliente.localidad)}
        ${inp("Provincia", "cliente.provincia", c.cliente.provincia)}
      </div>
      <div style="margin-top:14px">
        <label style="font-weight:700;font-size:13px">Razones sociales <span class="hint">— un mismo cliente puede tener varias. Marcá cuál factura y firma el contrato.</span></label>
        <div class="rs-list" id="razones">${(c.cliente.razonesSociales || []).map(rsRow).join("")}</div>
        <button type="button" class="btn sm" onclick="addRazon()">+ Razón social</button>
      </div></fieldset>

      <fieldset><legend>Plan comercial</legend>
        <div class="form-grid">
          ${sel("Plan", "plan.id", c.plan?.id || "", [["", "— sin plan —"], ...CAT.PLAN_ORDEN.map((p) => [p, `${CAT.PLANES[p].label} (${CAT.PLANES[p].precioTxt})`])])}
          ${inp("Etiqueta que ve el cliente", "plan.etiquetaPublica", c.plan?.etiquetaPublica, "", "text")}
        </div>
        <p class="hint" style="margin:8px 0 0">La etiqueta es el único nombre que aparece en el documento. Podés vender un armado a medida bajo el rótulo «Contrato Professional».</p>
        <div class="modulos-box">
          <label style="font-weight:700;font-size:13px">🔒 Módulos internos <span class="hint">— no se imprimen. Suman alcance y precio de referencia.</span></label>
          <div class="check-row" style="margin-top:8px">
            ${CAT.MODULO_ORDEN.map((m) => {
              const mod = CAT.MODULOS[m];
              return `<label title="${esc(mod.desc)}"><input type="checkbox" data-mod="${m}" ${(c.plan?.modulos || []).includes(m) ? "checked" : ""}> ${esc(mod.label)} <span class="muted">+${money(mod.valor)}</span></label>`;
            }).join("")}
          </div>
          <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button type="button" class="btn sm" onclick="aplicarPlanAForm()">↻ Aplicar plan + módulos a la cobertura</button>
            <span class="muted" style="font-size:12.5px" id="valorRef"></span>
          </div>
        </div>
        <div class="field full" style="margin-top:12px">
          <label>Notas internas <span class="hint">(no se imprimen)</span></label>
          <textarea data-path="plan.notasInternas" rows="2">${esc(c.plan?.notasInternas || "")}</textarea>
        </div>
        <div class="field full">
          <label>Cambios acordados en la negociación <span class="hint">(uno por línea — desvíos respecto del modelo)</span></label>
          <textarea data-path="negociacion.desviaciones" data-list="1" rows="3" placeholder="SLA on-site llevado a 12 h a pedido del cliente&#10;Se excluye el equipo de Baradero del primer semestre">${esc((c.negociacion?.desviaciones || []).join("\n"))}</textarea>
        </div>
      </fieldset>

      <fieldset><legend>Equipos</legend>
        <div class="equipos-list" id="equipos">${(c.equipos || []).map(eqRow).join("")}</div>
        <button type="button" class="btn sm" onclick="addEquipo()">+ Equipo</button>
      </fieldset>

      <fieldset><legend>Cobertura</legend>
        <div class="form-grid">
          ${inp("Inspecciones preventivas / año", "cobertura.preventivoInspeccionesAnuales", cov.preventivoInspeccionesAnuales, "", "number")}
          ${inp("Rep. bobinas / año", "cobertura.reparacionBobinasPorAnio", cov.reparacionBobinasPorAnio)}
        </div>
        <div class="field full" style="margin-top:12px">
          <label>Reparaciones / partes incluidas <span class="hint">(una por línea — p. ej. módulo amplificador de gradientes, camilla paciente, host y software)</span></label>
          <textarea data-path="cobertura.reparacionesIncluidas" data-list="1" placeholder="Bobinas de RM: todas, sin límite&#10;1 Módulo Amplificador de Gradientes&#10;Reparaciones electromecánicas de camilla paciente">${esc((cov.reparacionesIncluidas || []).join("\n"))}</textarea>
        </div>
        <div class="check-row" style="margin-top:12px">
          ${chk("Correctivo mano de obra", "cobertura.correctivoManoObra", cov.correctivoManoObra)}
          ${chk("Soporte remoto", "cobertura.soporteRemoto", cov.soporteRemoto)}
          ${chk("SaaS Gestión y Monitoreo Cryo", "cobertura.saasMonitoreo", cov.saasMonitoreo)}
          ${chk("Partes incluidas", "cobertura.partesIncluidas", cov.partesIncluidas)}
          ${chk("Viáticos incluidos", "cobertura.viaticosIncluidos", cov.viaticosIncluidos)}
          ${chk("Envío de repuestos incluido", "cobertura.enviosRepuestosIncluidos", cov.enviosRepuestosIncluidos)}
        </div>
      </fieldset>

      <fieldset><legend>Económico y ajuste</legend><div class="form-grid">
        ${inp("Canon mensual", "economico.canonMensual", c.economico.canonMensual, "", "number")}
        ${sel("Moneda", "economico.moneda", c.economico.moneda, [["USD", "USD"], ["ARS", "ARS"]])}
        ${inp("IVA %", "economico.ivaPct", c.economico.ivaPct ?? 21, "", "number")}
        ${inp("Forma de pago", "economico.formaPago", c.economico.formaPago)}
        ${sel("Periodicidad de ajuste", "ajuste.periodicidad", c.ajuste.periodicidad, [["ninguno", "Ninguno"], ["trimestral", "Trimestral"], ["semestral", "Semestral"], ["anual", "Anual"]])}
        ${sel("Índice", "ajuste.indice", c.ajuste.indice, [["US_CPI", "US CPI"], ["IPC_INDEC", "IPC INDEC"]])}
      </div>
      <div class="check-row" style="margin-top:12px">${chk("Canon incluye IVA", "economico.incluyeIVA", c.economico.incluyeIVA)}</div>
      </fieldset>

      <fieldset><legend>Vigencia</legend><div class="form-grid">
        ${inp("Inicio", "vigencia.inicio", c.vigencia.inicio, "", "date")}
        ${inp("Duración (meses)", "vigencia.meses", c.vigencia.meses, "", "number")}
        ${inp("Preaviso (días)", "vigencia.preavisoDias", c.vigencia.preavisoDias, "", "number")}
        ${sel("Estado", "estado", c.estado, ESTADOS.map((e) => [e.id, e.label]))}
      </div>
      <div class="check-row" style="margin-top:12px">${chk("Renovación automática", "vigencia.renovacionAutomatica", c.vigencia.renovacionAutomatica)}</div>
      </fieldset>

      <fieldset><legend>Notas</legend>
        <div class="field full"><textarea data-path="notas">${esc(c.notas || "")}</textarea></div>
      </fieldset>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn ghost" onclick="location.hash='${isNew ? "listado" : "detalle/" + id}'">Cancelar</button>
        <button type="submit" class="btn primary">${isNew ? "Crear" : "Guardar"}</button>
      </div>
    </form>`;
  document.getElementById("cform").onsubmit = (e) => { e.preventDefault(); guardarForm(isNew); };
}
function inp(label, path, val, cls = "", type = "text") {
  return `<div class="field ${cls}"><label>${label}</label><input type="${type}" data-path="${path}" value="${val === 0 ? 0 : esc(val || "")}"></div>`;
}
function sel(label, path, val, opts) {
  return `<div class="field"><label>${label}</label><select data-path="${path}">${opts.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select></div>`;
}
function chk(label, path, val) {
  return `<label><input type="checkbox" data-path="${path}" ${val ? "checked" : ""}> ${label}</label>`;
}
function eqRow(e = {}) {
  return `<div class="eq-row">
    <input placeholder="Marca" data-eq="marca" value="${esc(e.marca || "")}">
    <input placeholder="Modelo" data-eq="modelo" value="${esc(e.modelo || "")}">
    <select data-eq="modalidad"><option ${e.modalidad === "MRI" ? "selected" : ""}>MRI</option><option ${e.modalidad === "CT" ? "selected" : ""}>CT</option></select>
    <input placeholder="Ubicación" data-eq="ubicacion" value="${esc(e.ubicacion || "")}">
    <button type="button" class="btn sm danger" onclick="this.parentElement.remove()">✕</button>
  </div>`;
}
function addEquipo() { document.getElementById("equipos").insertAdjacentHTML("beforeend", eqRow()); }
function rsRow(r = {}) {
  return `<div class="rs-row">
    <input placeholder="Razón social" data-rs="razonSocial" value="${esc(r.razonSocial || "")}">
    <input placeholder="CUIT" data-rs="cuit" value="${esc(r.cuit || "")}">
    <input placeholder="Domicilio legal" data-rs="domicilio" value="${esc(r.domicilio || "")}">
    <label class="rs-pri" title="Factura y firma el contrato"><input type="radio" name="rsPrincipal" ${r.principal ? "checked" : ""}> firma</label>
    <button type="button" class="btn sm danger" onclick="this.parentElement.remove()">✕</button>
  </div>`;
}
function addRazon() {
  const box = document.getElementById("razones");
  box.insertAdjacentHTML("beforeend", rsRow({ principal: !box.querySelector(".rs-row") }));
}
// Rellena la cobertura a partir del plan elegido + módulos internos.
function aplicarPlanAForm() {
  const planId = document.querySelector('[data-path="plan.id"]').value;
  if (!planId) { toast("Elegí un plan primero", true, true); return; }
  const mods = [...document.querySelectorAll("[data-mod]")].filter((x) => x.checked).map((x) => x.dataset.mod);
  const der = CAT.derivarDePlan(planId, mods);
  const set = (path, v) => {
    const f = document.querySelector(`#cform [data-path="${path}"]`);
    if (!f) return;
    if (f.type === "checkbox") f.checked = !!v;
    else f.value = v ?? "";
  };
  const cov = der.cobertura;
  set("cobertura.preventivoInspeccionesAnuales", cov.preventivoInspeccionesAnuales);
  set("cobertura.reparacionBobinasPorAnio", cov.reparacionBobinasPorAnio);
  set("cobertura.correctivoManoObra", cov.correctivoManoObra);
  set("cobertura.soporteRemoto", cov.soporteRemoto);
  set("cobertura.saasMonitoreo", cov.saasMonitoreo);
  set("cobertura.partesIncluidas", cov.partesIncluidas);
  set("cobertura.viaticosIncluidos", cov.viaticosIncluidos);
  set("cobertura.enviosRepuestosIncluidos", cov.enviosRepuestosIncluidos);
  set("cobertura.reparacionesIncluidas", (cov.reparacionesIncluidas || []).join("\n"));
  const et = document.querySelector('[data-path="plan.etiquetaPublica"]');
  if (et && !et.value) et.value = CAT.PLANES[planId].etiquetaPublica;
  const ref = document.getElementById("valorRef");
  if (ref) ref.textContent = `Valor de referencia: ${money(der.valorSugerido)}/mes · SLA on-site ${der.sla.onsite} h`;
  toast("Cobertura actualizada desde el plan");
}

function nuevoContrato() {
  const d = new Date().toISOString().slice(0, 10);
  return {
    id: "ctr_" + Date.now(), tipo: "propuesta", numero: "P" + d.replace(/-/g, ""), estado: "borrador",
    cliente: { nombreComercial: "", razonesSociales: [{ razonSocial: "", cuit: "", domicilio: "", principal: true }], contacto: "", localidad: "", provincia: "" },
    plan: { id: "professional", etiquetaPublica: "Contrato Professional", modulos: [], notasInternas: "" },
    negociacion: { desviaciones: [] },
    equipos: [], cobertura: structuredClone(CAT.PLANES.professional.base),
    economico: { canonMensual: 0, moneda: "USD", incluyeIVA: false, ivaPct: 21, formaPago: "Mensual, antes del 5º día hábil" },
    ajuste: { periodicidad: "trimestral", indice: "US_CPI", proximoAjuste: "", historial: [] },
    vigencia: { inicio: "", meses: 12, fin: "", renovacionAutomatica: true, preavisoDias: 30 },
    fechas: { creado: d, enviado: "", firmado: "" }, archivos: [], notas: "",
    historialEstados: [{ estado: "borrador", fecha: d, usuario: state.user || "—" }],
  };
}
function setPath(obj, path, val) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] = o[keys[i]] || {};
  o[keys[keys.length - 1]] = val;
}
async function guardarForm(isNew) {
  const c = window._draft;
  const prevEstado = isNew ? null : state.data.find((x) => x.id === state.editId)?.estado;
  document.querySelectorAll("#cform [data-path]").forEach((f) => {
    let v;
    if (f.dataset.list) v = f.value.split("\n").map((s) => s.trim()).filter(Boolean);
    else if (f.type === "checkbox") v = f.checked;
    else if (f.type === "number") v = f.value === "" ? "" : Number(f.value);
    else v = f.value;
    setPath(c, f.dataset.path, v);
  });
  c.equipos = [...document.querySelectorAll("#equipos .eq-row")].map((row) => {
    const o = {};
    row.querySelectorAll("[data-eq]").forEach((f) => (o[f.dataset.eq] = f.value));
    return o;
  });
  // razones sociales (repetibles) — la marcada con el radio es la que firma/factura
  const rsRows = [...document.querySelectorAll("#razones .rs-row")];
  c.cliente.razonesSociales = rsRows.map((row) => {
    const o = {};
    row.querySelectorAll("[data-rs]").forEach((f) => (o[f.dataset.rs] = f.value.trim()));
    o.principal = !!row.querySelector('input[type="radio"]')?.checked;
    return o;
  }).filter((r) => r.razonSocial);
  if (c.cliente.razonesSociales.length && !c.cliente.razonesSociales.some((r) => r.principal)) c.cliente.razonesSociales[0].principal = true;
  // módulos internos
  c.plan = c.plan || {};
  c.plan.modulos = [...document.querySelectorAll("[data-mod]")].filter((x) => x.checked).map((x) => x.dataset.mod);
  // el modelo viejo ya no se usa
  delete c.cliente.razonSocial; delete c.cliente.cuit;
  if (c.cobertura) c.cobertura.criogeniaIncluida = false;

  if (!c.cliente.nombreComercial && !c.cliente.razonesSociales.length) { toast("Falta el nombre del cliente o una razón social", true, true); return; }
  if (!c.cliente.nombreComercial) c.cliente.nombreComercial = c.cliente.razonesSociales[0].razonSocial;
  if (!isNew && prevEstado !== c.estado) {
    c.historialEstados = c.historialEstados || [];
    c.historialEstados.push({ estado: c.estado, fecha: new Date().toISOString().slice(0, 10), usuario: state.user || "—" });
  }
  if (isNew) state.data.push(c);
  else { const i = state.data.findIndex((x) => x.id === state.editId); state.data[i] = c; }
  try {
    await persist(`${isNew ? "Alta" : "Edición"} ${c.numero} · ${nombreCliente(c)}`);
    toast("Guardado ✓");
    go("detalle/" + c.id);
  } catch (e) { toast("Error: " + e.message, true, true); }
}

// ============================================================
//  PDF de marca (propuesta / contrato) vía impresión
// ============================================================
// Parámetros legales por defecto (editables acá o, a futuro, por contrato)
const LEGAL = {
  slaRemoto: 2, slaOnsite: 24, slaRepuesto: 48,
  garantiaReparacionDias: 90, limiteCanones: 3, confidAnios: 2,
  preavisoNoRenovacion: 60, indiceLabel: { US_CPI: "US CPI", IPC_INDEC: "IPC INDEC" },
};
function generarPDF(id) {
  const c = state.data.find((x) => x.id === id);
  const fin = computeFin(c), pa = computeProximoAjuste(c);
  const cov = c.cobertura || {};
  const esContrato = c.tipo === "contrato";
  const ph = (v, txt) => (v || v === 0 ? esc(v) : `<span class="ph">[${txt}]</span>`);
  const idx = LEGAL.indiceLabel[c.ajuste?.indice] || c.ajuste?.indice || "";
  const pctMora = c.economico?.moneda === "ARS" ? "10% mensual" : "2% mensual";

  const rss = c.cliente?.razonesSociales || [];
  const rsp = rsPrincipal(c);
  // Lo único que el cliente lee sobre el "plan": el rótulo público. Los módulos internos nunca salen del sistema.
  const etiquetaPub = c.plan?.etiquetaPublica || CAT.PLANES[c.plan?.id]?.etiquetaPublica || "Programa de Mantenimiento MRI / CT";
  // El SLA publicado sale del plan (el módulo Prioridad lo mejora sin nombrarse).
  const slaDoc = c.plan?.id
    ? CAT.derivarDePlan(c.plan.id, c.plan.modulos || []).sla
    : { remoto: LEGAL.slaRemoto, onsite: LEGAL.slaOnsite, repuesto: LEGAL.slaRepuesto };
  // Bobinas y criogenia solo existen en resonancia: si el contrato no tiene
  // ningún equipo de RM, no se ofrecen ni se mencionan.
  const conRM = tieneMRI(c);
  const hayCT = (c.equipos || []).some((e) => e.modalidad === "CT");
  const suf = conRM && hayCT ? " (aplicable a los equipos de resonancia)" : "";
  const reparaciones = conRM ? (cov.reparacionesIncluidas || []) : [];
  const alcance = [
    cov.preventivoInspeccionesAnuales && `Mantenimiento preventivo programado: ${cov.preventivoInspeccionesAnuales} inspecciones anuales por equipo, según normas del fabricante.`,
    cov.correctivoManoObra && "Mantenimiento correctivo de mano de obra, sin límite de llamados durante la vigencia.",
    (conRM && !reparaciones.length && cov.reparacionBobinasPorAnio) && `Diagnóstico y reparación electrónica de bobinas de RM${suf}: ${typeof cov.reparacionBobinasPorAnio === "number" ? cov.reparacionBobinasPorAnio + " por año (no acumulables)" : cov.reparacionBobinasPorAnio}.`,
    cov.soporteRemoto && "Soporte técnico remoto por canal exclusivo en días hábiles.",
    (cov.saasMonitoreo && conRM) && `Acceso al SaaS Nexolibre de Gestión y Monitoreo Cryo${suf}: monitoreo continuo de los parámetros criogénicos del equipo (nivel de helio, presión, temperatura de cold-head y estado del compresor), con alertas tempranas y gestión de la base instalada.`,
    cov.stockReservado && "Disponibilidad garantizada de partes críticas para los Equipos cubiertos.",
    cov.bancoHoras && `Banco de ${cov.bancoHoras} horas de ingeniería aplicables a tareas fuera del alcance ordinario.`,
    cov.capacitacion && "Capacitación anual al personal técnico y de operación del Cliente.",
    cov.auditoria && "Auditoría periódica de performance y gestión de obsolescencia de la base instalada.",
    cov.viaticosIncluidos && "Viáticos y traslados del personal técnico incluidos.",
    cov.enviosRepuestosIncluidos && "Costo de envío de repuestos hacia y desde nuestras oficinas incluido.",
    "Documentación y reporte técnico por intervención.",
  ].filter(Boolean);
  const exclus = [
    !cov.partesIncluidas && "Provisión de repuestos y partes no reparables (cotizados y aprobados aparte). Los repuestos podrán ser nuevos, usados o reacondicionados según disponibilidad y contexto.",
    // Ofrecemos monitoreo criogénico, no mantenimiento de criogenia: se dice explícito para que no haya lectura ambigua.
    // Si no hay equipos de RM, la criogenia no existe y no corresponde ni nombrarla.
    conRM && (cov.saasMonitoreo
      ? "Mantenimiento de la cadena de frío y criogenia (provisión y recarga de helio o nitrógeno, intervención sobre cold-head, compresores y líneas). El servicio contratado comprende el monitoreo y la gestión de la información criogénica, no su mantenimiento; las intervenciones se cotizan por separado."
      : "Cadena de frío y criogenia de los equipos (helio, nitrógeno, cold-head, compresores), tanto en monitoreo como en mantenimiento."),
    hayCT && "En los equipos de tomografía computada, el alcance comprende el mantenimiento preventivo programado y el correctivo de mano de obra; la reparación de bobinas y el monitoreo criogénico son propios de resonancia magnética y no resultan aplicables. El tubo de rayos X, el detector y demás componentes de desgaste se rigen por la cláusula QUINTA.",
    "Reparaciones por uso inadecuado, instalación eléctrica/climatización fuera de especificación o intervención de terceros no autorizados.",
    "Chiller, obra civil e infraestructura del sitio; upgrades de versión, hardware o software.",
    !cov.viaticosIncluidos && "Viáticos asociados a servicios correctivos, salvo pacto expreso.",
  ].filter(Boolean);

  // ---- Términos y Condiciones Generales (20 cláusulas) ----
  const clausulas = [
    ["PRIMERA — OBJETO", `El Prestador se obliga a prestar los servicios de mantenimiento preventivo y correctivo sobre los equipos de diagnóstico por imágenes de propiedad del Cliente individualizados en la(s) Ficha(s) Técnica(s) (los «Equipos»), conforme al alcance, niveles de servicio y condiciones aquí establecidos.`],
    ["SEGUNDA — DEFINICIONES", `<b>Mantenimiento preventivo:</b> controles eléctricos, electrónicos y mecánicos, verificación de diagnósticos, calibración, limpieza técnica y ajustes conforme a las normas del fabricante, en forma programada. <b>Mantenimiento correctivo:</b> mano de obra necesaria para subsanar fallas durante la operación normal. <b>Reparación de componente:</b> recuperación en laboratorio de una pieza crítica (p. ej. bobina de RF) en lugar de su reemplazo. <b>Días y horas hábiles:</b> de lunes a viernes en horario comercial, excluyendo feriados nacionales.`],
    ["TERCERA — ALCANCE DEL SERVICIO", `El servicio incluye, para cada Equipo: ${alcance.map((a) => a.replace(/\.$/, "")).join("; ")}.${reparaciones.length ? ` Reparaciones de partes expresamente incluidas: ${reparaciones.map((r) => r.replace(/\.$/, "")).join("; ")}.` : ""} La provisión de repuestos y partes ${cov.partesIncluidas ? "se encuentra incluida según Ficha Técnica" : "<b>no está incluida</b> y se rige por la cláusula QUINTA"}.`],
    ["CUARTA — NIVELES DE SERVICIO (SLA)", `El Prestador se compromete a los siguientes tiempos objetivo, en horas y días hábiles desde la recepción del reclamo: respuesta de soporte remoto ${slaDoc.remoto} horas hábiles; asistencia on-site por equipo detenido ${slaDoc.onsite} horas hábiles; entrega de repuesto disponible en stock ${slaDoc.repuesto} horas hábiles. Los tiempos se suspenden mientras subsistan causas ajenas al Prestador.`],
    ["QUINTA — REPUESTOS, PARTES Y GARANTÍA DE REPARACIÓN", `Toda parte o pieza a reemplazar, y toda reparación no comprendida en el alcance, será cotizada y aprobada por el Cliente en forma previa e independiente. Los componentes que tras diagnóstico no resulten reparables serán presupuestados para su reemplazo por separado. Los repuestos provistos podrán ser nuevos, usados o reacondicionados según disponibilidad y contexto. ${cov.enviosRepuestosIncluidos ? "El costo de envío de repuestos hacia y desde las oficinas del Prestador se encuentra incluido. " : ""}Las reparaciones de componentes tienen garantía de ${LEGAL.garantiaReparacionDias} días corridos desde su reinstalación, salvo elementos fungibles o de desgaste natural.`],
    ["SEXTA — CONDICIONES PREVIAS AL INICIO", `Antes de la entrada en vigor se realizará una Visita de Relevamiento Técnico General. Toda reparación o reemplazo necesario para alcanzar la operatividad inicial será presupuestado en forma independiente. El Prestador no será responsable por fallas preexistentes ni por la recuperación de condiciones previas a la puesta en servicio.`],
    ["SÉPTIMA — EXCLUSIONES", `No se encuentran incluidos: ${exclus.map((a) => a.replace(/\.$/, "")).join("; ")}. Todo lo no detallado expresamente en este contrato y sus Fichas Técnicas.`],
    ["OCTAVA — OBLIGACIONES DEL CLIENTE", `Garantizar el libre acceso del personal técnico autorizado en los horarios acordados; mantener las condiciones ambientales y eléctricas dentro de las especificaciones del fabricante; abstenerse de permitir la intervención de los Equipos por terceros no autorizados (cuyo incumplimiento faculta a rescindir de inmediato); comunicar por medio fehaciente, dentro de las 48 horas, toda situación que afecte a los Equipos; y abonar el precio en tiempo y forma.`],
    ["NOVENA — OBLIGACIONES DEL PRESTADOR", `Prestar los servicios con personal idóneo conforme a las normas del fabricante; cumplir los niveles de servicio de la cláusula CUARTA; entregar documentación y reporte técnico de cada intervención; y mantener la confidencialidad conforme la cláusula DUODÉCIMA.`],
    ["DÉCIMA — PRECIO, PAGO, AJUSTE Y MORA", `El Cliente abonará un canon mensual de ${money(c.economico?.canonMensual, c.economico?.moneda)} ${c.economico?.incluyeIVA ? "(IVA incluido)" : "más IVA"}, aun cuando en el período no se hubiere requerido servicio, ${esc(c.economico?.formaPago || "en la forma pactada")}. Los pagos en pesos se convierten al tipo de cambio vendedor del Banco de la Nación Argentina del día de la factura. El canon se ajustará en forma ${c.ajuste?.periodicidad || "—"} según ${idx || "[índice]"}. La mora se produce de forma automática, devengando un interés punitorio del ${pctMora}. Ante falta de pago a los 10 días corridos del vencimiento, el Prestador podrá suspender el servicio con previo aviso, sin extensión del plazo, hasta su regularización.`],
    ["DECIMOPRIMERA — RESPONSABILIDAD Y LÍMITE", `La obligación del Prestador se limita a la fiel ejecución de los servicios. No responderá por daños directos o indirectos, lucro cesante, pérdida de ingresos ni por el tiempo de indisponibilidad del Equipo derivados de fallas no causadas por su personal, demoras logísticas o aduaneras de terceros, uso inadecuado o intervención de terceros. La responsabilidad total y acumulada se limita al equivalente a los últimos ${LEGAL.limiteCanones} (tres) cánones mensuales efectivamente abonados.`],
    ["DECIMOSEGUNDA — CONFIDENCIALIDAD Y PROTECCIÓN DE DATOS", `Cada parte mantendrá la confidencialidad de la información a la que acceda y la usará solo para la ejecución del contrato. El Prestador tratará todo dato personal o de paciente conforme a la Ley 25.326, con medidas técnicas y organizativas de seguridad. Esta obligación subsiste por ${LEGAL.confidAnios} (dos) años tras la finalización.`],
    ["DECIMOTERCERA — SaaS DE GESTIÓN Y MONITOREO CRYO", `${cov.saasMonitoreo ? "El servicio incluye el acceso a la plataforma <b>Nexolibre Cryo</b> de gestión y monitoreo de la base instalada, que releva en forma continua los parámetros criogénicos del Equipo (nivel de helio, presión, temperatura de cold-head y estado del compresor) y emite alertas tempranas ante desvíos. " : ""}Se deja expresa constancia de que la prestación comprende el <b>monitoreo, registro y gestión de la información criogénica</b>, y <b>no constituye servicio de mantenimiento de la cadena de frío</b>: la provisión y recarga de helio o nitrógeno, y toda intervención sobre cold-head, compresores y líneas criogénicas, se encuentran excluidas y se cotizan por separado. La alerta emitida por la plataforma no sustituye las obligaciones de operación y custodia del Equipo a cargo del Cliente. El acceso se otorga como licencia de uso no exclusiva, intransferible y limitada a la vigencia del contrato; la propiedad intelectual permanece en el Prestador, que podrá usar los datos de operación en forma agregada y anonimizada con fines de mantenimiento predictivo.`],
    ["DECIMOCUARTA — VIGENCIA, RENOVACIÓN Y RESCISIÓN", `Duración inicial de ${ph(c.vigencia?.meses, "N")} meses desde su suscripción${c.vigencia?.renovacionAutomatica ? ", con renovación automática por períodos iguales salvo notificación con " + LEGAL.preavisoNoRenovacion + " días de anticipación al vencimiento" : ""}. Cualquiera de las partes podrá rescindir sin causa mediante notificación fehaciente con ${ph(c.vigencia?.preavisoDias, "30")} días de anticipación, sin penalidad. Las reparaciones aprobadas y pendientes de pago siguen siendo exigibles.`],
    ["DECIMOQUINTA — FUERZA MAYOR", `Ninguna parte será responsable por incumplimientos —salvo los de pago— derivados de caso fortuito o fuerza mayor (arts. 1730 y ss. del Código Civil y Comercial). La parte afectada lo notificará dentro de las 48 horas.`],
    ["DECIMOSEXTA — CESIÓN E INDEPENDENCIA", `El contrato no podrá cederse sin consentimiento previo y por escrito de la otra parte. La relación es civil y comercial; no configura vínculo laboral entre una parte y el personal de la otra. Cada parte es responsable exclusiva de las obligaciones laborales y previsionales de su personal.`],
    ["DECIMOSÉPTIMA — MODIFICACIONES, DIVISIBILIDAD Y RENUNCIA", `Toda modificación deberá constar por escrito y suscribirse por ambas partes. La invalidez de una cláusula no afecta a las restantes. La tolerancia ante un incumplimiento no implica renuncia de derechos.`],
    ["DECIMOCTAVA — NOTIFICACIONES", `Toda notificación se cursará por medio fehaciente a los domicilios y correos constituidos: Prestador, ${ph(null, "domicilio / correo Nexolibre")}; Cliente, ${ph(null, "domicilio / correo del Cliente")}.`],
    ["DECIMONOVENA — LEY, MEDIACIÓN Y JURISDICCIÓN", `Rige la ley de la República Argentina. Toda controversia se procurará resolver de buena fe y, de subsistir, se someterá a mediación previa. Agotada ésta, las partes se someten a los Tribunales Ordinarios de ${ph(null, "jurisdicción")}, con renuncia a todo otro fuero.`],
    ["VIGÉSIMA — ACEPTACIÓN FORMAL", `La recepción de esta propuesta no constituye su aceptación. El contrato se perfecciona cuando el Cliente remita nota de aceptación consignando su CUIT ${ph(rsp.cuit, "CUIT")}, firmada por representante con facultades suficientes, o suscriba el presente. La orden de compra o la recepción conforme del servicio importan aceptación de estos términos.`],
  ];

  document.getElementById("printRoot").innerHTML = `
    <style>
      @page { margin: 18mm 16mm; }
      #printRoot { font-family: var(--body); color: #211c16; font-size: 12.5px; line-height: 1.5; }
      #printRoot .hd { border-bottom: 3px solid #ef8f03; padding-bottom: 10px; margin-bottom: 16px; break-inside: avoid; }
      #printRoot .hd img { height: 30px; width: auto; display: block; margin-bottom: 6px; }
      #printRoot .kick { color:#ef8f03; font-weight:700; font-size:11px; letter-spacing:.12em; }
      #printRoot h1 { font-family: var(--head); font-weight: 800; color: #645d56; font-size: 26px; margin: 6px 0 4px; break-after: avoid; page-break-after: avoid; }
      #printRoot h2 { font-family: var(--head); font-weight:800; color: #645d56; font-size: 15px; text-transform: uppercase; letter-spacing: .04em; margin: 16px 0 6px; border-bottom: 1px solid #e0dacf; padding-bottom: 4px; break-after: avoid; page-break-after: avoid; break-inside: avoid; }
      #printRoot h3 { font-family: var(--head); font-weight:700; color:#645d56; font-size:12.5px; margin:12px 0 2px; break-after: avoid; page-break-after: avoid; }
      #printRoot table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 6px 0; break-inside: auto; }
      #printRoot thead { display: table-header-group; }
      #printRoot tr { break-inside: avoid; page-break-inside: avoid; }
      #printRoot td, #printRoot th { border: 1px solid #d9d3ca; padding: 6px 9px; text-align: left; vertical-align: top; }
      #printRoot th { background: #f4f1ec; color: #645d56; }
      #printRoot ul { font-size: 12px; padding-left: 18px; margin:4px 0; }
      #printRoot li { break-inside: avoid; }
      #printRoot .eco th { background: #645d56; color: #fff; width: 32%; }
      #printRoot .foot { margin-top: 22px; color: #8c867d; font-size: 10.5px; border-top: 1px solid #e0dacf; padding-top: 8px; break-inside: avoid; }
      #printRoot .foot img { height: 18px; width: auto; vertical-align: middle; margin-left: 4px; }
      #printRoot .num { color: #ef8f03; font-weight: 800; }
      #printRoot .ph { color:#ef8f03; font-weight:700; }
      #printRoot p { orphans: 3; widows: 3; }
      #printRoot p.cl { margin: 0 0 8px; text-align: justify; }
      /* Cada cláusula (título + cuerpo) se mantiene unida: nada de títulos
         colgando al final de una página con el texto en la siguiente. */
      #printRoot .clause { break-inside: avoid; page-break-inside: avoid; margin: 12px 0 0; }
      #printRoot .pg { page-break-before: always; }
      #printRoot .sign { margin-top: 40px; display:flex; gap:40px; break-inside: avoid; page-break-inside: avoid; }
      #printRoot .sign div { flex:1; border-top:1px solid #211c16; padding-top:6px; font-size:11px; }
      /* Bloque "sección + su tabla/lista": no se separan del encabezado. */
      #printRoot .blk { break-inside: avoid; page-break-inside: avoid; }
    </style>

    <!-- Portada / Propuesta -->
    <div class="hd">
      <img src="${NEXO_BRAND.logo}" alt="Nexolibre" />
      <div style="color:#8c867d;font-size:12px">Ingeniería médica multimarca · Diagnóstico por imágenes MRI / CT</div>
    </div>
    <div class="kick">${esContrato ? "CONTRATO DE SERVICIO" : "PROPUESTA DE SERVICIO"} · ${esc(c.numero)}</div>
    <h1>${esc(etiquetaPub)}</h1>
    <p style="color:#8c867d;margin:0 0 10px">Programa de mantenimiento preventivo y correctivo · MRI / CT</p>
    <table><tr><th>Cliente</th><td>${esc(nombreCliente(c))}</td><th>Contacto</th><td>${esc(c.cliente.contacto || "—")}</td></tr>
    <tr><th>Razón social${rss.length > 1 ? " (facturación)" : ""}</th><td>${ph(rsp.razonSocial, "razón social")}</td><th>CUIT</th><td>${ph(rsp.cuit, "CUIT")}</td></tr>
    ${rss.length > 1 ? `<tr><th>Otras razones sociales alcanzadas</th><td colspan="3">${rss.filter((r) => !r.principal).map((r) => esc(r.razonSocial) + (r.cuit ? ` (CUIT ${esc(r.cuit)})` : "")).join(" · ")}</td></tr>` : ""}
    <tr><th>Localidad</th><td>${esc(c.cliente.localidad || "—")}</td><th>Provincia</th><td>${esc(c.cliente.provincia || "—")}</td></tr>
    <tr><th>Fecha</th><td>${fmt(new Date())}</td><th>Vigencia</th><td>${c.vigencia?.meses || "—"} meses${fin ? " · vence " + fmt(fin) : ""}</td></tr></table>

    <div class="blk"><h2>Equipos cubiertos</h2>
    <table><thead><tr><th>#</th><th>Equipo</th><th>Marca</th><th>Modalidad</th><th>Ubicación</th></tr></thead>
    <tbody>${(c.equipos || []).map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.modelo)}</td><td>${esc(e.marca)}</td><td>${e.modalidad}</td><td>${esc(e.ubicacion || "—")}</td></tr>`).join("") || `<tr><td colspan="5">Sin equipos cargados</td></tr>`}</tbody></table></div>

    <h2>Alcance del servicio</h2><ul>${alcance.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>

    ${reparaciones.length ? `<h2>Reparaciones de partes incluidas</h2><ul>${reparaciones.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}

    <div class="blk"><h2>Condiciones económicas</h2>
    ${(() => {
      const canon = Number(c.economico.canonMensual) || 0;
      const pct = Number(c.economico.ivaPct ?? 21);
      const m = c.economico.moneda;
      let rows = "";
      if (canon && !c.economico.incluyeIVA) {
        const iva = Math.round(canon * pct / 100), tot = canon + iva;
        rows = `<tr><th>Canon mensual (neto)</th><td class="num">${money(canon, m)} + IVA</td></tr>
        <tr><th>IVA ${pct}%</th><td>${money(iva, m)}</td></tr>
        <tr><th>Total mensual c/ IVA</th><td class="num">${money(tot, m)}</td></tr>`;
      } else {
        rows = `<tr><th>Canon mensual</th><td class="num">${money(canon, m)} (IVA incl.)</td></tr>`;
      }
      return `<table class="eco">${rows}
      <tr><th>Forma de pago</th><td>${esc(c.economico.formaPago || "—")}</td></tr>
      <tr><th>Ajuste</th><td>${c.ajuste.periodicidad} según ${idx}</td></tr>
      <tr><th>Niveles de servicio</th><td>Remoto ${slaDoc.remoto} h · on-site ${slaDoc.onsite} h · repuesto en stock ${slaDoc.repuesto} h (hábiles)</td></tr></table>`;
    })()}</div>

    <h2>Exclusiones</h2><ul>${exclus.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>

    <!-- Términos y Condiciones -->
    <div class="pg"></div>
    <div class="kick">Anexo I</div>
    <h1 style="font-size:22px">Términos y Condiciones Generales del Servicio</h1>
    <p class="cl">Entre <b>Nexolibre</b> («El Prestador») y <b>${ph(rsp.razonSocial, "razón social")}</b>, CUIT ${ph(rsp.cuit, "CUIT")}${rsp.domicilio ? `, con domicilio en ${esc(rsp.domicilio)}` : ""}${c.cliente.nombreComercial && c.cliente.nombreComercial !== rsp.razonSocial ? `, que gira comercialmente bajo la denominación «${esc(c.cliente.nombreComercial)}»` : ""}${rss.length > 1 ? `, por sí y en representación de ${rss.filter((r) => !r.principal).map((r) => `<b>${esc(r.razonSocial)}</b>${r.cuit ? ` (CUIT ${esc(r.cuit)})` : ""}`).join(", ")}, sociedades alcanzadas por el presente` : ""} («El Cliente»), se celebra el presente Contrato de Prestación de Servicios de Mantenimiento, que se regirá por las cláusulas siguientes:</p>
    ${clausulas.map(([t, body]) => `<div class="clause"><h3>${t}</h3><p class="cl">${body}</p></div>`).join("")}
    <div class="sign">
      <div><b>Por el Prestador · Nexolibre</b><br>Aclaración / cargo:</div>
      <div><b>Por el Cliente · ${esc(rsp.razonSocial || nombreCliente(c))}</b><br>Aclaración / cargo:</div>
    </div>

    <!-- Ficha técnica por equipo -->
    <div class="pg"></div>
    <div class="kick">Anexo II</div>
    <h1 style="font-size:22px">Ficha Técnica por Equipo</h1>
    ${(c.equipos || []).map((e, i) => `
      <div class="blk"><h3>Ficha Técnica N.º ${i + 1}</h3>
      <table>
        <tr><th>Equipo / Modelo</th><td>${esc(e.marca)} ${esc(e.modelo)}</td><th>Modalidad</th><td>${e.modalidad}</td></tr>
        <tr><th>N.º de serie</th><td>${ph(e.serie, "serie")}</td><th>Ubicación</th><td>${esc(e.ubicacion || "—")}</td></tr>
        <tr><th>Cobertura</th><td colspan="3">${[
          `Preventivo ${cov.preventivoInspeccionesAnuales || 0}/año`,
          cov.correctivoManoObra ? "correctivo (mano de obra)" : "sin correctivo",
          // Solo en RM: un tomógrafo no tiene bobinas de RF ni criogenia.
          e.modalidad === "MRI" && cov.reparacionBobinasPorAnio && `rep. bobinas ${cov.reparacionBobinasPorAnio}${typeof cov.reparacionBobinasPorAnio === "number" ? "/año" : ""}`,
          e.modalidad === "MRI" && cov.saasMonitoreo && "monitoreo Cryo (SaaS)",
        ].filter(Boolean).join(" · ")}</td></tr>
      </table></div>`).join("") || "<p>Sin equipos cargados.</p>"}

    <div class="foot">${esContrato ? "Copia del contrato suscripto." : "Esta propuesta se rige por los Términos y Condiciones Generales del Servicio aquí incluidos."} Los campos <span class="ph">[entre corchetes]</span> se completan al perfeccionar el acuerdo.<br>Nexolibre es miembro de <img src="${NEXO_BRAND.grupoNexo}" alt="Grupo Nexo" />.</div>`;
  window.print();
}

// ============================================================
//  Exportaciones
// ============================================================
function seleccionOTodo() {
  const sel = state.data.filter((c) => state.selected.has(c.id));
  return sel.length ? sel : filtrados();
}
function exportarCSV() {
  const rows = seleccionOTodo();
  const cols = ["numero", "cliente", "razon_social", "cuit", "plan", "modulos_internos", "estado", "equipos", "modalidad", "canon", "moneda", "inicio", "vence", "ajuste_periodicidad", "proximo_ajuste"];
  const lines = [cols.join(",")];
  for (const c of rows) {
    const fin = computeFin(c), pa = computeProximoAjuste(c);
    const vals = [
      c.numero, nombreCliente(c), rsPrincipal(c).razonSocial, rsPrincipal(c).cuit,
      CAT.PLANES[c.plan?.id]?.label || "", (c.plan?.modulos || []).map((m) => CAT.MODULOS[m]?.label).filter(Boolean).join(" + "),
      ESTADO_LABEL[c.estado], (c.equipos || []).length,
      [...new Set((c.equipos || []).map((e) => e.modalidad))].join("/"),
      c.economico?.canonMensual, c.economico?.moneda, c.vigencia?.inicio || "",
      fin ? fin.toISOString().slice(0, 10) : "", c.ajuste?.periodicidad, pa ? pa.toISOString().slice(0, 10) : "",
    ];
    lines.push(vals.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
  }
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `contratos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  toast(`CSV: ${rows.length} registros · uso interno (incluye módulos)`);
}
// ------------------------------------------------------------
//  Informe ejecutivo para dirección (CEO / Gerencia)
//  Es el canal por el que Gabriel y Geraldine ven la información:
//  ellos no entran al sistema. Por eso muestra SOLO el rótulo público
//  del plan — jamás los módulos internos ni las notas internas.
// ------------------------------------------------------------
function exportarInforme() {
  const rows = seleccionOTodo();
  const vig = rows.filter((c) => ACTIVOS.has(c.estado));
  const pipe = rows.filter((c) => ["borrador", "enviada", "negociacion"].includes(c.estado));
  const cerrados = rows.filter((c) => ["vencida", "rescindida", "perdida"].includes(c.estado));
  const mrr = vig.reduce((s, c) => s + (Number(c.economico?.canonMensual) || 0), 0);
  const potencial = pipe.reduce((s, c) => s + (Number(c.economico?.canonMensual) || 0), 0);
  const equipos = vig.reduce((s, c) => s + (c.equipos || []).length, 0);
  const planPub = (c) => c.plan?.etiquetaPublica || CAT.PLANES[c.plan?.id]?.label || "—";

  // Agenda de los próximos 180 días: vencimientos y aumentos pactados
  const agenda = [];
  for (const c of vig) {
    const fin = computeFin(c), dv = daysUntil(fin);
    if (dv !== null && dv <= 180) agenda.push({ c, tipo: "Vencimiento", fecha: fin, dias: dv });
    const pa = computeProximoAjuste(c), da = daysUntil(pa);
    if (da !== null && da <= 180 && da >= -5) agenda.push({ c, tipo: "Aumento", fecha: pa, dias: da });
  }
  agenda.sort((a, b) => a.fecha - b.fecha);

  // Qué cubre cada contrato, en lenguaje de negocio
  const coberturaTxt = (c) => {
    const v = c.cobertura || {}, t = [];
    if (v.preventivoInspeccionesAnuales) t.push(`${v.preventivoInspeccionesAnuales} preventivos/año`);
    if (v.correctivoManoObra) t.push("correctivo ilimitado");
    // Bobinas y criogenia solo si el contrato tiene equipos de resonancia
    if (v.reparacionBobinasPorAnio && tieneMRI(c)) t.push(`bobinas ${typeof v.reparacionBobinasPorAnio === "number" ? v.reparacionBobinasPorAnio + "/año" : v.reparacionBobinasPorAnio} (RM)`);
    if (v.saasMonitoreo && tieneMRI(c)) t.push("monitoreo Cryo (RM)");
    if (soloCT(c)) t.push("sin bobinas ni criogenia (CT)");
    if (v.viaticosIncluidos) t.push("viáticos incl.");
    t.push(v.partesIncluidas ? "partes incl." : "partes no incl.");
    return t.join(" · ");
  };

  const filaVig = (c) => {
    const fin = computeFin(c), pa = computeProximoAjuste(c);
    const iva = Number(c.economico?.ivaPct ?? 21);
    const canon = Number(c.economico?.canonMensual) || 0;
    return `<tr>
      <td><b>${esc(nombreCliente(c))}</b><br><span class="sub">${esc(rsPrincipal(c).razonSocial || "")}${rsPrincipal(c).cuit ? " · CUIT " + esc(rsPrincipal(c).cuit) : ""}</span></td>
      <td>${esc(planPub(c))}<br><span class="sub">${esc(c.numero)}</span></td>
      <td>${(c.equipos || []).map((e) => `${esc(e.marca)} ${esc(e.modelo)} <span class="sub">(${e.modalidad})</span>`).join("<br>") || "—"}</td>
      <td class="num">${money(canon, c.economico?.moneda)}<br><span class="sub">c/IVA ${money(Math.round(canon * (1 + iva / 100)), c.economico?.moneda)}</span></td>
      <td>${fmt(fin)}<br><span class="sub">${c.vigencia?.renovacionAutomatica ? "renov. automática" : "renov. manual"}</span></td>
      <td>${fmt(pa)}<br><span class="sub">${c.ajuste?.periodicidad || "—"} · ${LEGAL.indiceLabel[c.ajuste?.indice] || c.ajuste?.indice || ""}</span></td>
    </tr>
    <tr class="cov"><td colspan="6"><b>Cobertura:</b> ${esc(coberturaTxt(c))}</td></tr>`;
  };

  document.getElementById("printRoot").innerHTML = `
    <style>
      @page { margin: 16mm 14mm; }
      #printRoot { font-family: var(--body); color: #211c16; font-size: 12px; line-height: 1.5; }
      #printRoot .hd { border-bottom: 3px solid #ef8f03; padding-bottom: 10px; margin-bottom: 16px; break-inside: avoid; }
      #printRoot .hd img { height: 30px; width: auto; display: block; margin-bottom: 6px; }
      #printRoot h1 { font-family: var(--head); font-weight: 800; color: #645d56; font-size: 26px; margin: 6px 0 2px; break-after: avoid; page-break-after: avoid; }
      #printRoot h2 { font-family: var(--head); font-weight: 800; color: #645d56; font-size: 14px;
        text-transform: uppercase; letter-spacing: .05em; margin: 24px 0 6px;
        border-bottom: 1px solid #e0dacf; padding-bottom: 4px; break-after: avoid; page-break-after: avoid; }
      #printRoot table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin: 4px 0; break-inside: auto; }
      #printRoot thead { display: table-header-group; }
      #printRoot tr { break-inside: avoid; page-break-inside: avoid; }
      #printRoot td, #printRoot th { border: 1px solid #d9d3ca; padding: 6px 8px; text-align: left; vertical-align: top; }
      #printRoot th { background: #645d56; color: #fff; font-weight: 700; }
      #printRoot .sub { color: #8c867d; font-size: 10.5px; }
      #printRoot .num { font-weight: 700; color: #ef8f03; white-space: nowrap; }
      #printRoot tr.cov td { background: #f7f5f1; font-size: 10.5px; color: #645d56; }
      #printRoot .kpis { display: flex; gap: 10px; margin: 14px 0 4px; break-inside: avoid; }
      #printRoot .k { flex: 1; border: 1px solid #d9d3ca; border-radius: 14px; padding: 12px 14px; background: #f4f1ec; }
      #printRoot .k .lb { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #8c867d; font-weight: 600; }
      #printRoot .k .vl { font-family: var(--head); font-weight: 800; font-size: 22px; color: #ef8f03; padding: 3px 0; }
      #printRoot .k .sb { font-size: 10.5px; color: #8c867d; }
      #printRoot .foot { margin-top: 26px; color: #8c867d; font-size: 10.5px; border-top: 1px solid #e0dacf; padding-top: 8px; break-inside: avoid; }
      #printRoot .foot img { height: 18px; width: auto; vertical-align: middle; margin-left: 4px; }
      #printRoot .kick { color: #ef8f03; font-weight: 700; font-size: 11px; letter-spacing: .12em; }
    </style>

    <div class="hd">
      <img src="${NEXO_BRAND.logo}" alt="Nexolibre" />
      <div style="color:#8c867d;font-size:11.5px">Ingeniería médica multimarca · Diagnóstico por imágenes MRI / CT</div>
    </div>

    <div class="kick">INFORME EJECUTIVO</div>
    <h1>Estado de la cartera de contratos</h1>
    <p style="color:#8c867d;margin:0">${fmt(new Date())}${rows.length !== state.data.length ? ` · selección de ${rows.length} de ${state.data.length} registros` : ""}</p>

    <div class="kpis">
      <div class="k"><div class="lb">Contratos vigentes</div><div class="vl">${vig.length}</div><div class="sb">${equipos} equipos en servicio</div></div>
      <div class="k"><div class="lb">Ingreso mensual</div><div class="vl">${money(mrr)}</div><div class="sb">${money(mrr * 12)} anualizado</div></div>
      <div class="k"><div class="lb">Propuestas abiertas</div><div class="vl">${pipe.length}</div><div class="sb">${money(potencial)}/mes potencial</div></div>
    </div>

    <h2>Contratos vigentes</h2>
    ${vig.length ? `<table><thead><tr><th style="width:20%">Cliente</th><th style="width:15%">Plan</th><th style="width:23%">Equipos cubiertos</th><th style="width:13%">Canon mensual</th><th style="width:14%">Vencimiento</th><th style="width:15%">Próximo ajuste</th></tr></thead>
      <tbody>${vig.map(filaVig).join("")}</tbody></table>` : `<p style="color:#8c867d">Sin contratos vigentes.</p>`}

    <h2>Propuestas en curso</h2>
    ${pipe.length ? `<table><thead><tr><th>Cliente</th><th>Plan propuesto</th><th>Estado</th><th>Equipos</th><th>Canon propuesto</th></tr></thead>
      <tbody>${pipe.map((c) => `<tr>
        <td><b>${esc(nombreCliente(c))}</b><br><span class="sub">${esc(c.numero)}</span></td>
        <td>${esc(planPub(c))}</td>
        <td>${ESTADO_LABEL[c.estado]}</td>
        <td>${(c.equipos || []).length} <span class="sub">(${[...new Set((c.equipos || []).map((e) => e.modalidad))].join("/")})</span></td>
        <td class="num">${money(c.economico?.canonMensual, c.economico?.moneda)}</td></tr>`).join("")}</tbody></table>` : `<p style="color:#8c867d">Sin propuestas abiertas.</p>`}

    <h2>Agenda — próximos 180 días</h2>
    ${agenda.length ? `<table><thead><tr><th style="width:14%">Fecha</th><th style="width:14%">Qué</th><th>Contrato</th><th style="width:14%">Faltan</th><th style="width:18%">Acción</th></tr></thead>
      <tbody>${agenda.map((a) => `<tr>
        <td><b>${fmt(a.fecha)}</b></td>
        <td style="color:${a.tipo === "Aumento" ? "#ef8f03" : "#645d56"};font-weight:700">${a.tipo}</td>
        <td>${esc(nombreCliente(a.c))} <span class="sub">· ${esc(a.c.numero)}</span></td>
        <td>${a.dias < 0 ? "vencido" : a.dias + " días"}</td>
        <td class="sub">${a.tipo === "Aumento" ? `Aplicar ajuste ${a.c.ajuste?.periodicidad || ""}` : a.c.vigencia?.renovacionAutomatica ? "Renueva sola salvo preaviso" : "Requiere renovación"}</td></tr>`).join("")}</tbody></table>`
      : `<p style="color:#8c867d">Sin vencimientos ni ajustes en los próximos 180 días.</p>`}

    ${cerrados.length ? `<h2>Contratos cerrados</h2>
      <table><thead><tr><th>Cliente</th><th>Estado</th><th>Último canon</th></tr></thead>
      <tbody>${cerrados.map((c) => `<tr><td>${esc(nombreCliente(c))}</td><td>${ESTADO_LABEL[c.estado]}</td><td>${money(c.economico?.canonMensual)}</td></tr>`).join("")}</tbody></table>` : ""}

    <div class="foot">
      Informe generado desde el sistema de gestión de contratos de Nexolibre.
      Los importes son netos de IVA salvo donde se indica lo contrario.<br>
      <b>Documento de circulación interna.</b> Nexolibre es miembro de <img src="${NEXO_BRAND.grupoNexo}" alt="Grupo Nexo" />.
    </div>`;
  window.print();
}

// ============================================================
//  Setup (PAT)
// ============================================================
function openSetup() {
  document.getElementById("patInput").value = localStorage.getItem(LS.pat) || "";
  document.getElementById("userInput").value = state.user || "";
  document.getElementById("setupOverlay").style.display = "flex";
}
function closeSetup() { document.getElementById("setupOverlay").style.display = "none"; }
async function saveSetup() {
  const pat = document.getElementById("patInput").value.trim();
  const user = document.getElementById("userInput").value.trim();
  if (user) { localStorage.setItem(LS.user, user); state.user = user; }
  if (pat) localStorage.setItem(LS.pat, pat);
  else localStorage.removeItem(LS.pat);
  closeSetup();
  toast("Conectando…");
  await init();
}

// ============================================================
//  Toast
// ============================================================
let toastT;
function toast(msg, show = true, isErr = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show" + (isErr ? " err" : "");
  clearTimeout(toastT);
  toastT = setTimeout(() => (el.className = "toast"), 3200);
}

// exponer handlers usados en HTML inline
Object.assign(window, {
  avanzar, toggleSel, exportarCSV, exportarInforme, generarPDF, hacerFirme, addEquipo,
  addRazon, aplicarPlanAForm, subirArchivo, quitarArchivo, resetDemo,
});

init();
