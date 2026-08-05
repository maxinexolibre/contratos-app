/* ============================================================
   Nexolibre · Plataforma de contratos — lógica de la SPA
   ============================================================ */
const CFG = window.NEXO_CONFIG;
const CAT = window.NEXO_CATALOGO;
const LS = {
  pat: "nexo_pat",
  user: "nexo_user",
  demo: "nexo_demo_data",
  demoPresu: "nexo_demo_presu",
  demoTickets: "nexo_demo_tickets",
  demoVer: "nexo_demo_ver",
  tema: "nexo_tema",
};
// Subir esto invalida la copia demo guardada en el navegador.
const DEMO_VERSION = "9";

// -------- estado global --------
const state = {
  mode: "demo", // 'connected' | 'demo'
  data: [],          // contratos / propuestas
  sha: null,
  presupuestos: [],  // presupuestos (servicio / partes / equipos / saas)
  presuSha: null,
  tickets: [],       // tickets de pedido de cliente
  ticketsSha: null,
  // Modelo v3
  campanas: [], campanasSha: null,
  estrategias: [], estrategiasSha: null,
  leads: [], leadsSha: null,
  facturaciones: [], facturacionesSha: null,
  tiposCambio: [], tiposCambioSha: null,
  vendedores: [], vendedoresSha: null,
  acuerdosComision: [], acuerdosSha: null,
  comisiones: [], comisionesSha: null,
  rol: "admin",      // sin servidor el rol es preferencia de interfaz, no permiso real
  user: localStorage.getItem(LS.user) || "",
  ws: "contratos", // área de trabajo activa: 'contratos' | 'presupuestos'
  selected: new Set(),
  filtro: { q: "", estado: "", modalidad: "" },
  filtroPre: { q: "", estado: "", tipo: "" },
  filtroTk: { q: "", estado: "" },
  editId: null,
  soloLectura: false, // se activa solo si el token no tiene permiso de escritura
};
// `const` no crea propiedad en window, y los módulos de vistas/ leen y
// escriben el estado. Se expone explícitamente para que la dependencia quede
// a la vista, en vez de depender de un accidente del ámbito global.
window.state = state;

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
const cantMRI = (c) => (c.equipos || []).filter((e) => e.modalidad === "MRI").length;

// Alcance del cupo de reparación de bobinas. Distinción con plata detrás:
// "flota" = N reparaciones para TODO el parque de RM (lo habitual);
// "porEquipo" = N reparaciones para CADA equipo de RM.
// Con 3 MRI y N=2 eso es la diferencia entre 2 y 6 reparaciones al año.
const BOBINAS_ALCANCE = {
  flota: { corto: "para la flota", largo: "para el conjunto de los equipos de resonancia cubiertos" },
  porEquipo: { corto: "por equipo", largo: "por cada equipo de resonancia cubierto" },
};
const bobinasIlimitadas = (c) => {
  const v = c?.cobertura?.reparacionBobinasPorAnio;
  return !!v && typeof v !== "number";
};
// Total efectivo de reparaciones al año, según el alcance elegido
function bobinasTotal(c) {
  const n = c?.cobertura?.reparacionBobinasPorAnio;
  if (typeof n !== "number" || !n) return null;
  return c?.cobertura?.bobinasAlcance === "porEquipo" ? n * Math.max(1, cantMRI(c)) : n;
}
// Texto corto para chips y tablas
function bobinasTexto(c, { largo = false } = {}) {
  const cov = c?.cobertura || {};
  const n = cov.reparacionBobinasPorAnio;
  if (!n) return "";
  if (bobinasIlimitadas(c)) return String(n);
  const alc = BOBINAS_ALCANCE[cov.bobinasAlcance] || BOBINAS_ALCANCE.flota;
  return `${n}/año ${largo ? alc.largo : alc.corto}`;
}
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
// ---- Control de ajustes de canon ----
// Un ajuste pactado que no se aplica no se recupera nunca, y además arrastra:
// el período siguiente arranca sobre una base vieja. Por eso el sistema no
// alcanza con mostrar "próximo ajuste": tiene que saber si el anterior se hizo.
function fechasAjusteVencidas(c) {
  const step = AJUSTE_STEP[c?.ajuste?.periodicidad] || 0;
  const inicio = parseDate(c?.vigencia?.inicio);
  if (!step || !inicio) return [];
  // `controlDesde` permite regularizar contratos cargados a mitad de vida,
  // sin arrastrar como pendientes ajustes que se aplicaron antes del sistema.
  const desde = parseDate(c?.ajuste?.controlDesde);
  const out = [];
  let d = addMonths(inicio, step), guard = 0;
  while (d <= hoy() && guard++ < 400) {
    if (!desde || d > desde) out.push(new Date(d));
    d = addMonths(d, step);
  }
  return out;
}
function ajustesPendientes(c) {
  if (!ACTIVOS.has(c?.estado)) return [];
  const step = AJUSTE_STEP[c?.ajuste?.periodicidad] || 0;
  const hist = (c?.ajuste?.historial || []).map((h) => parseDate(h.fecha)).filter(Boolean);
  return fechasAjusteVencidas(c).filter((d) => {
    // Se considera cubierta si hay un ajuste registrado en su ventana
    // (con un mes de tolerancia hacia atrás, por si se aplicó anticipado).
    const desde = addMonths(d, -1), hasta = addMonths(d, step);
    return !hist.some((h) => h >= desde && h < hasta);
  });
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
  if (c.cobertura) {
    c.cobertura.criogeniaIncluida = false;
    // Los contratos previos se pactaron con cupo de flota, que es lo habitual.
    if (c.cobertura.bobinasAlcance == null) c.cobertura.bobinasAlcance = "flota";
    if (c.cobertura.incluirSLA == null) c.cobertura.incluirSLA = true;
  }
  c.archivos = c.archivos || [];
  c.plan = c.plan || { id: "", etiquetaPublica: "", modulos: [], notasInternas: "" };
  // Renombre a la familia NexoCare: los registros viejos migran solos.
  const PLAN_VIEJO = { essential: "foundation", professional: "performance", enterprise: "assurance" };
  if (PLAN_VIEJO[c.plan.id]) c.plan.id = PLAN_VIEJO[c.plan.id];
  const ETIQ_VIEJA = {
    "Contrato Essential": "NexoCare Foundation", "Contrato Professional": "NexoCare Performance",
    "Contrato Enterprise": "NexoCare Assurance", "Contrato Nexo Custom": "NexoCare Custom",
  };
  if (ETIQ_VIEJA[c.plan.etiquetaPublica]) c.plan.etiquetaPublica = ETIQ_VIEJA[c.plan.etiquetaPublica];
  // La marca se escribe sin símbolo: se limpia lo ya guardado con él.
  if (typeof c.plan.etiquetaPublica === "string") c.plan.etiquetaPublica = c.plan.etiquetaPublica.replace(/[\u00AE\u2122]/g, "").replace(/\s{2,}/g, " ").trim();
  c.negociacion = c.negociacion || { desviaciones: [] };
  return c;
}
const migrarTodos = (arr) => (Array.isArray(arr) ? arr.map(migrar) : []);

// ---- migración de tickets y presupuestos ----
// Un ticket nace de un pedido de cliente y ata la trazabilidad: de él cuelgan
// los presupuestos que se le hacen.
const TK_ESTADOS = [
  { id: "abierto", label: "Abierto", grupo: "abierto" },
  { id: "presupuestado", label: "Presupuestado", grupo: "abierto" },
  { id: "ganado", label: "Ganado", grupo: "cerrado" },
  { id: "perdido", label: "Perdido", grupo: "cerrado" },
  { id: "cerrado", label: "Cerrado", grupo: "cerrado" },
];
const TK_ESTADO_LABEL = Object.fromEntries(TK_ESTADOS.map((e) => [e.id, e.label]));
const TK_TIPO_PEDIDO = {
  servicio: "Servicio", parte: "Venta de partes", equipo: "Venta de equipo",
  saas: "SaaS Cryo / Gestión", consulta: "Consulta general",
};
function migrarTicket(t) {
  t.cliente = t.cliente || {};
  const cl = t.cliente;
  if (!Array.isArray(cl.razonesSociales)) cl.razonesSociales = cl.razonSocial ? [{ razonSocial: cl.razonSocial, cuit: cl.cuit || "", principal: true }] : [];
  if (!cl.nombreComercial) cl.nombreComercial = cl.razonSocial || "";
  t.estado = t.estado || "abierto";
  t.tipoPedido = t.tipoPedido || "servicio";
  t.presupuestoIds = t.presupuestoIds || [];
  t.historial = t.historial || [];
  return t;
}
const migrarTickets = (arr) => (Array.isArray(arr) ? arr.map(migrarTicket) : []);

// Estados del presupuesto (pipeline comercial propio, distinto del de contratos).
const PRE_ESTADOS = [
  { id: "borrador", label: "Borrador", grupo: "abierto" },
  { id: "enviado", label: "Enviado", grupo: "abierto" },
  { id: "negociacion", label: "Negociación", grupo: "abierto" },
  { id: "ganado", label: "Ganado", grupo: "ganado" },
  { id: "perdido", label: "Perdido", grupo: "perdido" },
];
const PRE_ESTADO_LABEL = Object.fromEntries(PRE_ESTADOS.map((e) => [e.id, e.label]));
const PRE_ABIERTOS = new Set(["borrador", "enviado", "negociacion"]);
// Probabilidad de cierre por etapa, para ponderar el pipeline.
const PRE_PROB = { borrador: 0.2, enviado: 0.5, negociacion: 0.7, ganado: 1, perdido: 0 };
// Tipos según el registro comercial real: Servicio y Venta. La Venta se
// desglosa en subtipos para poder analizarla sin cambiar la nomenclatura.
const PRE_TIPOS = {
  servicio: { label: "Servicio", requiereTicket: true },
  venta: { label: "Venta", requiereTicket: true },
  saas: { label: "SaaS Cryo / Gestión", requiereTicket: false },
};
const PRE_SUBTIPOS = { "": "—", partes: "Partes", intercambio: "Partes por intercambio", equipo: "Equipo completo" };
// Tipos viejos del sistema → tipos reales.
const TIPO_VIEJO = { partes: ["venta", "partes"], equipos: ["venta", "equipo"] };
function migrarPresupuesto(p) {
  p.cliente = p.cliente || {};
  const cl = p.cliente;
  if (!Array.isArray(cl.razonesSociales)) cl.razonesSociales = cl.razonSocial ? [{ razonSocial: cl.razonSocial, cuit: cl.cuit || "", domicilio: "", principal: true }] : [];
  if (!cl.nombreComercial) cl.nombreComercial = cl.razonSocial || "";
  if (cl.razonesSociales.length && !cl.razonesSociales.some((r) => r.principal)) cl.razonesSociales[0].principal = true;
  p.tipo = p.tipo || "servicio";
  // Migración de los tipos viejos (partes/equipos) a Venta + subtipo.
  if (TIPO_VIEJO[p.tipo]) { const [t, s] = TIPO_VIEJO[p.tipo]; p.tipo = t; p.subtipo = p.subtipo || s; }
  if (p.subtipo == null) p.subtipo = "";
  if (p.titulo == null) p.titulo = "";
  p.estado = p.estado || "borrador";
  p.items = Array.isArray(p.items) ? p.items : [];
  p.saas = Array.isArray(p.saas) ? p.saas : [];
  p.economico = p.economico || { moneda: "USD", ivaPct: 21, validezDias: 15 };
  if (p.economico.moneda == null) p.economico.moneda = "USD";
  if (p.economico.ivaPct == null) p.economico.ivaPct = 21;
  if (p.economico.validezDias == null) p.economico.validezDias = 15;
  if (p.economico.recurrencia == null) p.economico.recurrencia = "unica";
  p.archivos = p.archivos || [];
  p.historialEstados = p.historialEstados || [];
  return p;
}
const migrarPresupuestos = (arr) => (Array.isArray(arr) ? arr.map(migrarPresupuesto) : []);
// Razón social que firma/factura
const rsPrincipal = (c) => (c.cliente?.razonesSociales || []).find((r) => r.principal) || (c.cliente?.razonesSociales || [])[0] || { razonSocial: "", cuit: "" };
// Nombre que se muestra en toda la app
const nombreCliente = (c) => c.cliente?.nombreComercial || rsPrincipal(c).razonSocial || "—";

// Número en letras para las cláusulas (uso contractual: "2 (dos)")
const NUM_LETRA = ["cero", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce"];
const numLetra = (n) => NUM_LETRA[n] || String(n);

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
// Registro de los tres archivos de datos del repo privado. Cada uno se
// carga y guarda por separado, con su propio sha, para que un cambio en
// presupuestos no pise una edición de contratos hecha en paralelo.
const STORE_DEF = {
  contratos: { path: () => CFG.dataPath, key: "data", shaKey: "sha", ls: LS.demo, seed: () => DEMO_SEED, migrate: (a) => migrarTodos(a) },
  presupuestos: { path: () => CFG.presupuestosPath, key: "presupuestos", shaKey: "presuSha", ls: LS.demoPresu, seed: () => DEMO_PRESU, migrate: (a) => migrarPresupuestos(a) },
  tickets: { path: () => CFG.ticketsPath, key: "tickets", shaKey: "ticketsSha", ls: LS.demoTickets, seed: () => DEMO_TICKETS, migrate: (a) => migrarTickets(a) },
  // Entidades del modelo v3. Se normalizan con el esquema del núcleo, que es
  // el único lugar donde está definida su forma. Arrancan vacías.
  campanas: { path: () => CFG.campanasPath, key: "campanas", shaKey: "campanasSha", ls: "nexo_demo_campanas", seed: () => [], migrate: (a) => normalizar("campanas", a) },
  estrategias: { path: () => CFG.estrategiasPath, key: "estrategias", shaKey: "estrategiasSha", ls: "nexo_demo_estrategias", seed: () => [], migrate: (a) => normalizar("estrategias", a) },
  leads: { path: () => CFG.leadsPath, key: "leads", shaKey: "leadsSha", ls: "nexo_demo_leads", seed: () => [], migrate: (a) => normalizar("leads", a) },
  facturaciones: { path: () => CFG.facturacionesPath, key: "facturaciones", shaKey: "facturacionesSha", ls: "nexo_demo_facturaciones", seed: () => [], migrate: (a) => normalizar("facturaciones", a) },
  tiposCambio: { path: () => CFG.tiposCambioPath, key: "tiposCambio", shaKey: "tiposCambioSha", ls: "nexo_demo_tc", seed: () => [], migrate: (a) => normalizar("tiposCambio", a) },
  vendedores: { path: () => CFG.vendedoresPath, key: "vendedores", shaKey: "vendedoresSha", ls: "nexo_demo_vnd", seed: () => [], migrate: (a) => normalizar("vendedores", a) },
  acuerdosComision: { path: () => CFG.acuerdosComisionPath, key: "acuerdosComision", shaKey: "acuerdosSha", ls: "nexo_demo_acu", seed: () => [], migrate: (a) => normalizar("acuerdosComision", a) },
  comisiones: { path: () => CFG.comisionesPath, key: "comisiones", shaKey: "comisionesSha", ls: "nexo_demo_com", seed: () => [], migrate: (a) => normalizar("comisiones", a) },
};

// Normaliza una colección con el esquema del núcleo. Los registros ilegibles
// se avisan por consola en vez de desaparecer en silencio.
function normalizar(entidad, arr) {
  const { registros, fallidos } = window.NEXO_ESQUEMA.normalizarColeccion(entidad, arr);
  if (fallidos.length) console.warn(`${fallidos.length} registro(s) ilegibles en ${entidad}`, fallidos);
  return registros;
}
async function ghLoadFile(path) {
  const url = `https://api.github.com/repos/${CFG.owner}/${CFG.dataRepo}/contents/${path}?ref=${CFG.branch}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (r.status === 404) return { arr: [], sha: null };
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json()).message || r.statusText}`);
  const j = await r.json();
  return { arr: JSON.parse(b64decode(j.content)), sha: j.sha };
}
async function ghSaveFile(path, arr, sha, msg) {
  const url = `https://api.github.com/repos/${CFG.owner}/${CFG.dataRepo}/contents/${path}`;
  const body = { message: msg, content: b64encode(JSON.stringify(arr, null, 2) + "\n"), branch: CFG.branch };
  if (sha) body.sha = sha;
  const r = await fetch(url, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json()).message || r.statusText}`);
  return (await r.json()).content.sha;
}
// Carga un store desde el repo y lo migra. Los archivos de presupuestos y
// tickets pueden no existir todavía (404) → arrancan vacíos.
async function loadStore(store) {
  const def = STORE_DEF[store];
  const { arr, sha } = await ghLoadFile(def.path());
  state[def.key] = def.migrate(arr);
  state[def.shaKey] = sha;
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

async function persist(msg, store = "contratos") {
  if (state.soloLectura) throw new Error("Tu acceso es de solo lectura: podés consultar y descargar, no modificar.");
  const def = STORE_DEF[store];
  if (state.mode === "connected") {
    state[def.shaKey] = await ghSaveFile(def.path(), state[def.key], state[def.shaKey], msg);
  } else {
    localStorage.setItem(def.ls, JSON.stringify(state[def.key]));
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
    plan: { id: "performance", etiquetaPublica: "NexoCare Performance", modulos: ["cryo"], notasInternas: "Registro de ejemplo para probar la interfaz." },
    equipos: [
      { modelo: "Modelo A 1.5T", marca: "GE", modalidad: "MRI", serie: "", ubicacion: "Sede central" },
      { modelo: "Modelo B", marca: "GE", modalidad: "CT", serie: "", ubicacion: "Sede central" },
    ],
    cobertura: { preventivoInspeccionesAnuales: 4, correctivoManoObra: true, reparacionBobinasPorAnio: 2, bobinasAlcance: "flota", soporteRemoto: true, saasMonitoreo: true, partesIncluidas: false, viaticosIncluidos: true, enviosRepuestosIncluidos: true, reparacionesIncluidas: ["Reparación electrónica de bobinas de RM: hasta 2 por año para el conjunto de los equipos de resonancia, no acumulables"] },
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
    plan: { id: "assurance", etiquetaPublica: "NexoCare Assurance", modulos: ["bobinas", "prioridad"], notasInternas: "Registro de ejemplo: muestra la composición interna." },
    equipos: [{ modelo: "Modelo C 1.5T", marca: "Philips", modalidad: "MRI", serie: "", ubicacion: "Sede única" }],
    cobertura: {
      preventivoInspeccionesAnuales: 4, correctivoManoObra: true, reparacionBobinasPorAnio: "sin límite", bobinasAlcance: "flota",
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

// Datasets demo de tickets y presupuestos: FICTICIOS a propósito (repo público).
const DEMO_TICKETS = [
  {
    id: "demo_tk1", numero: "TK-2026-001", fecha: "2026-02-10",
    cliente: { nombreComercial: "Centro de Imágenes Ejemplo", razonesSociales: [{ razonSocial: "Centro de Imágenes Ejemplo S.A.", cuit: "30-00000000-0", principal: true }], contacto: "Contacto de ejemplo" },
    tipoPedido: "servicio", descripcion: "Solicitan presupuesto de reparación de bobina de RF con falla intermitente.",
    estado: "presupuestado", presupuestoIds: ["demo_pre1"], usuario: "demo", historial: [{ estado: "abierto", fecha: "2026-02-10", usuario: "demo" }, { estado: "presupuestado", fecha: "2026-02-12", usuario: "demo" }],
  },
];
const DEMO_PRESU = [
  {
    id: "demo_pre1", numero: "PRE-2026-001", tipo: "servicio", estado: "enviado", fecha: "2026-02-12", ticketId: "demo_tk1",
    cliente: { nombreComercial: "Centro de Imágenes Ejemplo", razonesSociales: [{ razonSocial: "Centro de Imágenes Ejemplo S.A.", cuit: "30-00000000-0", domicilio: "Calle Ejemplo 100", principal: true }], contacto: "Contacto de ejemplo", localidad: "Ciudad Ejemplo", provincia: "Buenos Aires" },
    items: [
      { detalle: "Diagnóstico y reparación electrónica de bobina de RF", cantidad: 1, unitario: 3200 },
      { detalle: "Visita técnica y viáticos", cantidad: 1, unitario: 400 },
    ],
    saas: [],
    economico: { moneda: "USD", ivaPct: 21, incluyeIVA: false, validezDias: 15, formaPago: "50% anticipo, 50% contra entrega" },
    notas: "Registro de ejemplo. Los datos reales se cargan al conectar con el repositorio privado.",
    archivos: [], usuario: "demo", historialEstados: [{ estado: "borrador", fecha: "2026-02-12", usuario: "demo" }, { estado: "enviado", fecha: "2026-02-12", usuario: "demo" }],
  },
  {
    id: "demo_pre2", numero: "PRE-2026-002", tipo: "partes", estado: "borrador", fecha: "2026-03-01",
    cliente: { nombreComercial: "Diagnóstico Demo", razonesSociales: [{ razonSocial: "Diagnóstico Demo S.R.L.", cuit: "30-11111111-1", principal: true }], contacto: "Contacto de ejemplo", provincia: "Santa Fe" },
    items: [
      { detalle: "Gradient amplifier (reacondicionado)", sku: "GA-000", cantidad: 1, unitario: 18500, unitarioIntercambio: 12500, intercambio: true },
    ],
    saas: [],
    economico: { moneda: "USD", ivaPct: 10.5, incluyeIVA: false, validezDias: 20, formaPago: "Contado" },
    notas: "Registro de ejemplo.", archivos: [], usuario: "demo", historialEstados: [{ estado: "borrador", fecha: "2026-03-01", usuario: "demo" }],
  },
];

// ---- numeración ----
// TK-AAAA-NNN / PRE-AAAA-NNN, correlativo por año sobre lo ya existente.
// Numeración real del área comercial: P + AAAA + MM + correlativo del mes
// (P20260413 = cuarto mes de 2026, presupuesto 13). El ticket la espeja.
function proxSecuenciaMes() {
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const rx = new RegExp(`^(?:P|TK-)${ym}(\\d{2})`);
  // Se mira en los dos registros: ticket y presupuesto comparten correlativo,
  // así el pedido TK-20260805 se corresponde con el presupuesto P20260805.
  const max = [...(state.presupuestos || []), ...(state.tickets || [])].reduce((m, x) => {
    const g = String(x.numero || "").match(rx);
    return g ? Math.max(m, Number(g[1])) : m;
  }, 0);
  return { ym, n: String(max + 1).padStart(2, "0") };
}
function proxNumeroPresu() { const { ym, n } = proxSecuenciaMes(); return `P${ym}${n}`; }
function proxNumeroTicket() { const { ym, n } = proxSecuenciaMes(); return `TK-${ym}${n}`; }

// ============================================================
//  Init
// ============================================================
async function init() {
  bindChrome();
  const pat = localStorage.getItem(LS.pat);
  if (pat) {
    try {
      state.mode = "connected";
      await loadStore("contratos");
      await loadStore("presupuestos");
      await loadStore("tickets");
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
  const ver = localStorage.getItem(LS.demoVer);
  const vigente = ver === DEMO_VERSION;
  for (const store of Object.keys(STORE_DEF)) {
    const def = STORE_DEF[store];
    const saved = localStorage.getItem(def.ls);
    state[def.key] = vigente && saved ? def.migrate(JSON.parse(saved)) : def.migrate(structuredClone(def.seed()));
    state[def.shaKey] = null;
  }
  localStorage.setItem(LS.demoVer, DEMO_VERSION);
}
function resetDemo() {
  [LS.demo, LS.demoPresu, LS.demoTickets, LS.demoVer].forEach((k) => localStorage.removeItem(k));
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
// La app se divide en dos áreas de trabajo, cada una con su tablero y secciones.
const SUBNAV = {
  contratos: [["dashboard", "Tablero"], ["listado", "Registros"], ["agenda", "Vencimientos"]],
  presupuestos: [["ptablero", "Tablero"], ["presupuestos", "Presupuestos"], ["tickets", "Tickets"], ["facturacion", "Facturación"], ["reportes", "Reportes"]],
  marketing: [["mktablero", "Tablero"], ["campanas", "Campañas"], ["leads", "Leads"], ["canales", "Canales"]],
  equipo: [["vendedores", "Vendedores"], ["comisiones", "Comisiones"]],
};
// A qué área pertenece cada vista/ruta.
const VIEW_WS = {
  dashboard: "contratos", listado: "contratos", agenda: "contratos", detalle: "contratos", form: "contratos", pipeline: "contratos",
  ptablero: "presupuestos", presupuestos: "presupuestos", presudetalle: "presupuestos", presuform: "presupuestos",
  tickets: "presupuestos", tkdetalle: "presupuestos", tkform: "presupuestos", reportes: "presupuestos", direccion: "presupuestos",
  facturacion: "presupuestos", cambio: "presupuestos",
  mktablero: "marketing", campanas: "marketing", campdetalle: "marketing", campform: "marketing",
  leads: "marketing", leadform: "marketing", canales: "marketing",
  vendedores: "equipo", vnddetalle: "equipo", vndform: "equipo", comisiones: "equipo",
};
const WS_HOME = { contratos: "dashboard", presupuestos: "ptablero", marketing: "mktablero", equipo: "vendedores" };

function router() {
  const view = (location.hash.replace("#", "") || "dashboard").split("/");
  const name = view[0];
  state.ws = VIEW_WS[name] || state.ws;
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  // Las vistas nuevas (marketing, facturación) viven en módulos aparte y
  // crean su propia sección: así no hay que tocar index.html ni engordar más
  // este archivo cada vez que se suma una pantalla.
  const seccion = (id) => {
    let el = document.getElementById("view-" + id);
    if (!el && window.NEXO_VISTAS && window.NEXO_VISTAS[id]) {
      el = document.createElement("section");
      el.className = "view";
      el.id = "view-" + id;
      document.getElementById("contenido").insertBefore(
        el, document.querySelector(".footer-legend"));
    }
    return el;
  };
  // El home del área también puede ser una vista de módulo, así que pasa por
  // el mismo camino. Y si nada existe se cae al tablero de contratos, que
  // siempre está en el HTML: sin esto una ruta desconocida rompe la app.
  const target = seccion(name) || seccion(WS_HOME[state.ws]) ||
    document.getElementById("view-dashboard");
  target.classList.add("active");
  renderSubnav(name);
  const R = {
    dashboard: renderDashboard, ptablero: renderPTablero, pipeline: renderPipeline, listado: renderListado, agenda: renderAgenda,
    detalle: () => renderDetalle(view[1]), form: () => renderForm(view[1]),
    presupuestos: renderPresupuestos, presudetalle: () => renderPresuDetalle(view[1]), presuform: () => renderPresuForm(view[1], view[2]),
    tickets: renderTickets, tkdetalle: () => renderTicketDetalle(view[1]), tkform: () => renderTicketForm(view[1]),
    reportes: renderReportes, direccion: renderPTablero,
    // Vistas registradas por los módulos de nucleo/vistas.
    ...(window.NEXO_VISTAS || {}),
  };
  (R[name] || (() => go(WS_HOME[state.ws])))();
  enhanceA11y();
}
// Sub-nav contextual del área activa + estado del switch de área.
function renderSubnav(name) {
  const nav = document.getElementById("nav");
  nav.innerHTML = (SUBNAV[state.ws] || []).map(([v, l]) =>
    `<button type="button" data-view="${v}" class="${v === name ? "active" : ""}"${v === name ? ' aria-current="page"' : ""}>${l}</button>`).join("");
  nav.querySelectorAll("button").forEach((b) => (b.onclick = () => go(b.dataset.view)));
  document.querySelectorAll("#wsSwitch button").forEach((b) => {
    const on = b.dataset.ws === state.ws;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
}
// Hace accesibles por teclado las filas clicables generadas en cada render:
// las convierte en focusables con rol de botón (el keydown global las activa).
function enhanceA11y() {
  document.querySelectorAll("tr[onclick]").forEach((tr) => {
    if (tr.hasAttribute("tabindex")) return;
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
  });
}
// Enter / Espacio sobre una fila enfocada = click.
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("tr[onclick]")) {
    e.preventDefault();
    e.target.click();
  }
});
window.addEventListener("hashchange", router);
const go = (h) => (location.hash = h);

// ---- Tema claro / oscuro ----
// El oscuro es el taupe de marca (el mundo "software"). La preferencia queda
// en el navegador; sin elección guardada se sigue la del sistema.
const temaActual = () => document.documentElement.getAttribute("data-theme") || "light";
function alternarTema() {
  const nuevo = temaActual() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", nuevo);
  localStorage.setItem(LS.tema, nuevo);
  refrescarBotonTema();
  // Los gráficos llevan el color en atributos SVG, no en CSS: hay que repintarlos.
  router();
}
function refrescarBotonTema() {
  const b = document.getElementById("btnTema");
  if (!b) return;
  const oscuro = temaActual() === "dark";
  b.textContent = oscuro ? "☀" : "☾";
  b.title = oscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  b.setAttribute("aria-label", b.title);
}

// El botón "+ Nuevo" crea la entidad del área activa.
function nuevoDesdeContexto() {
  return go(state.ws === "presupuestos" ? "presuform/new" : "form/new");
}

function bindChrome() {
  document.querySelectorAll("#wsSwitch button").forEach((b) => (b.onclick = () => { state.ws = b.dataset.ws; go(WS_HOME[state.ws]); }));
  document.getElementById("btnNuevo").onclick = nuevoDesdeContexto;
  document.getElementById("btnTema").onclick = alternarTema;
  refrescarBotonTema();
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
  const venc = [], aum = [], pend = [];
  for (const c of state.data) {
    if (!ACTIVOS.has(c.estado)) continue;
    const fin = computeFin(c), dv = daysUntil(fin);
    if (dv !== null && dv <= 30) venc.push({ c, fin, dias: dv });
    const pa = computeProximoAjuste(c), da = daysUntil(pa);
    if (da !== null && da <= 15 && da >= -3) aum.push({ c, fecha: pa, dias: da });
    const p = ajustesPendientes(c);
    if (p.length) pend.push({ c, fechas: p, dias: -daysUntil(p[p.length - 1]) });
  }
  venc.sort((a, b) => a.dias - b.dias);
  aum.sort((a, b) => a.dias - b.dias);
  pend.sort((a, b) => b.dias - a.dias);
  return { venc, aum, pend };
}

// ============================================================
//  Vista: Dashboard
// ============================================================
function renderDashboard() {
  const el = document.getElementById("view-dashboard");
  const vigentes = state.data.filter((c) => ACTIVOS.has(c.estado));
  const pipeline = state.data.filter((c) => ["borrador", "enviada", "negociacion"].includes(c.estado));
  const mrr = vigentes.reduce((s, c) => s + (Number(c.economico?.canonMensual) || 0), 0);
  const { venc, aum, pend } = calcAlertas();
  // MRR por nivel NexoCare (dona)
  const nivelItems = CAT.PLAN_ORDEN.map((id) => {
    const v = vigentes.filter((c) => c.plan?.id === id).reduce((s, c) => s + (Number(c.economico?.canonMensual) || 0), 0);
    return { label: CAT.PLANES[id].label, value: v, text: moneyK(v) };
  }).filter((i) => i.value > 0);
  const sinNivel = vigentes.filter((c) => !c.plan?.id).reduce((s, c) => s + (Number(c.economico?.canonMensual) || 0), 0);
  if (sinNivel) nivelItems.push({ label: "Sin nivel", value: sinNivel, text: moneyK(sinNivel) });
  // Vencimientos por mes (próximos 6)
  const vmeses = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const n = vigentes.filter((c) => { const f = computeFin(c); return f && `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}` === key; }).length;
    vmeses.push({ label: d.toLocaleDateString("es-AR", { month: "short" }), value: n, text: String(n) });
  }

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
      ${kpi("Ingreso mensual (MRR)", money(mrr), `${money(mrr * 12)} anualizado`)}
      ${kpi("Por vencer", venc.length, "≤ 30 días", venc.length ? "warn" : "")}
      ${kpi("Ajustes sin registrar", pend.length, pend.length ? "revisar si se aplicaron" : "todo al día", pend.length ? "danger" : "")}
    </div>
    <div class="dir-2col">
      <div class="card"><h3>MRR por nivel NexoCare</h3>
        ${nivelItems.some((i) => i.value) ? `<div class="chart-donut-row">${chartDonut(nivelItems, { centro: moneyK(mrr) })}${chartLegend(nivelItems)}</div>` : `<p class="muted">Sin contratos vigentes con nivel asignado.</p>`}</div>
      <div class="card"><h3>Vencimientos por mes <span class="muted" style="font-weight:400">· próximos 6</span></h3>
        ${vmeses.some((m) => m.value) ? chartColumns(vmeses) : `<p class="muted">Sin vencimientos en los próximos 6 meses.</p>`}</div>
    </div>
    ${pend.length ? `<div class="card alert-panel danger">
      <h3>⚠ Ajustes de canon sin registrar</h3>
      <p class="muted" style="font-size:13.5px;margin:0 0 10px">Estas fechas de ajuste ya pasaron y el sistema no tiene registro de que se hayan aplicado. Un ajuste no aplicado no se recupera y arrastra la base del período siguiente.</p>
      ${pend.map((p) => `<div class="alert-row" onclick="location.hash='detalle/${p.c.id}'" style="cursor:pointer">
        <span class="tag pend">${p.fechas.length} sin registrar</span>
        <b>${esc(p.c.numero)}</b> · ${esc(nombreCliente(p.c))}
        <span style="flex:1"></span>
        <span class="muted">${p.fechas.map(fmt).join(" · ")}</span>
      </div>`).join("")}
    </div>` : ""}
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
// El número es el protagonista de la tarjeta, pero un importe largo
// ("US$ 19.700 · $ 800.000") no puede desbordarla: la escala baja por tramos
// según cuántos caracteres tenga el valor.
function kpi(label, num, sub, tone = "") {
  const txt = String(num);
  const size = txt.length > 22 ? "xs" : txt.length > 15 ? "sm" : txt.length > 9 ? "md" : "lg";
  return `<div class="kpi${tone ? " " + tone : ""}">
    <div class="label">${label}</div>
    <div class="num num-${size}">${num}</div>
    ${sub ? `<div class="sub">${sub}</div>` : ""}
  </div>`;
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
        <button class="btn sm" onclick="generarPDF('${c.id}')">🧾 Ver / imprimir</button>
        <button class="btn sm" onclick="generarDocx('${c.id}')" title="Descarga un .docx editable en Word">⬇ Descargar .docx</button>
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
        ${renderAjustes(c)}
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
// ---- Ajustes de canon: historial, pendientes y registro ----
function renderAjustes(c) {
  const step = AJUSTE_STEP[c.ajuste?.periodicidad] || 0;
  if (!step) return "";
  const pend = ajustesPendientes(c);
  const hist = (c.ajuste?.historial || []).slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const canon = Number(c.economico?.canonMensual) || 0;
  const m = c.economico?.moneda;
  const ro = state.soloLectura;
  return `<div class="card${pend.length ? " alerta" : ""}"><h3>Ajustes de canon</h3>
    ${pend.length ? `<div class="pend-box">
      <b>${pend.length} ajuste${pend.length > 1 ? "s" : ""} sin registrar</b>
      <div class="muted" style="font-size:12.5px;margin-top:2px">${pend.map(fmt).join(" · ")}</div>
      ${ro ? "" : `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn sm" onclick="regularizarAjustes('${c.id}')" title="Marca los anteriores como ya aplicados fuera del sistema, sin tocar el canon">Ya estaban aplicados</button>
      </div>`}
    </div>` : `<p class="muted" style="font-size:13px;margin:0 0 10px">Ajustes al día. ✅</p>`}

    ${ro ? "" : `<div class="aj-form">
      <div class="aj-row">
        <label>Fecha<input type="date" id="ajFecha" value="${(pend[0] ? pend[0] : hoy()).toISOString().slice(0, 10)}"></label>
        <label>%<input type="number" step="0.01" id="ajPct" placeholder="0.00" oninput="calcAjuste('${c.id}')"></label>
        <label>Canon nuevo<input type="number" step="0.01" id="ajCanon" placeholder="${canon}" oninput="calcAjustePct('${c.id}')"></label>
      </div>
      <button class="btn primary sm" onclick="registrarAjuste('${c.id}')">Registrar ajuste</button>
      <span class="muted" style="font-size:12px" id="ajHint">Canon actual: ${money(canon, m)}</span>
    </div>`}

    ${hist.length ? `<table class="aj-hist">
      <thead><tr><th>Fecha</th><th>%</th><th>Canon</th><th>Quién</th></tr></thead>
      <tbody>${hist.map((h) => `<tr>
        <td>${fmt(h.fecha)}</td>
        <td>${h.porcentaje != null && h.porcentaje !== "" ? `<b>${h.porcentaje > 0 ? "+" : ""}${h.porcentaje}%</b>` : "—"}</td>
        <td>${h.canonAnterior ? `<span class="muted">${money(h.canonAnterior, m)} →</span> ` : ""}${h.canonNuevo ? money(h.canonNuevo, m) : "—"}</td>
        <td class="muted">${esc(h.usuario || "—")}${h.nota ? ` · ${esc(h.nota)}` : ""}</td>
      </tr>`).join("")}</tbody></table>`
      : `<p class="muted" style="font-size:12.5px;margin:8px 0 0">Todavía no hay ajustes registrados.</p>`}
  </div>`;
}
// Los dos campos se completan entre sí: cargás el % y sale el canon, o al revés.
function calcAjuste(id) {
  const c = state.data.find((x) => x.id === id);
  const base = Number(c.economico?.canonMensual) || 0;
  const pct = parseFloat(document.getElementById("ajPct").value);
  if (isNaN(pct)) return;
  document.getElementById("ajCanon").value = Math.round(base * (1 + pct / 100) * 100) / 100;
  hintAjuste(c, base);
}
function calcAjustePct(id) {
  const c = state.data.find((x) => x.id === id);
  const base = Number(c.economico?.canonMensual) || 0;
  const nuevo = parseFloat(document.getElementById("ajCanon").value);
  if (isNaN(nuevo) || !base) return;
  document.getElementById("ajPct").value = Math.round((nuevo / base - 1) * 10000) / 100;
  hintAjuste(c, base);
}
function hintAjuste(c, base) {
  const nuevo = parseFloat(document.getElementById("ajCanon").value);
  const el = document.getElementById("ajHint");
  if (!el) return;
  el.textContent = isNaN(nuevo)
    ? `Canon actual: ${money(base, c.economico?.moneda)}`
    : `${money(base, c.economico?.moneda)} → ${money(nuevo, c.economico?.moneda)} · ${money(Math.round((nuevo - base) * 12), c.economico?.moneda)}/año de diferencia`;
}
async function registrarAjuste(id) {
  const c = state.data.find((x) => x.id === id);
  const fecha = document.getElementById("ajFecha").value;
  const pct = document.getElementById("ajPct").value;
  const nuevo = Number(document.getElementById("ajCanon").value);
  if (!fecha) { toast("Falta la fecha del ajuste", true, true); return; }
  if (!nuevo || nuevo <= 0) { toast("Falta el canon nuevo", true, true); return; }
  const anterior = Number(c.economico?.canonMensual) || 0;
  c.ajuste.historial = c.ajuste.historial || [];
  c.ajuste.historial.push({
    fecha, porcentaje: pct === "" ? null : Number(pct),
    canonAnterior: anterior, canonNuevo: nuevo,
    usuario: state.user || "—",
  });
  c.economico.canonMensual = nuevo;
  try {
    await persist(`Ajuste ${c.numero} · ${money(anterior)} → ${money(nuevo)}`);
    toast(`Ajuste registrado · canon ${money(nuevo)}`);
    router();
  } catch (e) { toast("Error: " + e.message, true, true); }
}
// Contratos cargados a mitad de vida: los ajustes previos ya se aplicaron
// fuera del sistema. Se marca la línea de corte sin tocar el canon.
async function regularizarAjustes(id) {
  const c = state.data.find((x) => x.id === id);
  const pend = ajustesPendientes(c);
  if (!confirm(`¿Marcar ${pend.length} ajuste(s) anterior(es) como ya aplicados fuera del sistema?\n\nNo modifica el canon actual (${money(c.economico?.canonMensual)}). A partir de acá el sistema controla solo los nuevos.`)) return;
  c.ajuste.controlDesde = new Date().toISOString().slice(0, 10);
  c.ajuste.historial = c.ajuste.historial || [];
  c.ajuste.historial.push({
    fecha: c.ajuste.controlDesde, porcentaje: null,
    canonAnterior: null, canonNuevo: Number(c.economico?.canonMensual) || null,
    usuario: state.user || "—", nota: "regularización de ajustes previos al sistema",
  });
  try {
    await persist(`Regulariza ajustes previos · ${c.numero}`);
    toast("Ajustes anteriores regularizados");
    router();
  } catch (e) { toast("Error: " + e.message, true, true); }
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
    bobinas: cov.reparacionBobinasPorAnio ? bobinasTexto(c) : false,
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
  ${(() => {
    const notas = [];
    const cov = c.cobertura || {};
    // Sin esta aclaración, ver "2/año" repetido en cada fila se lee como 2 por equipo.
    if (cov.reparacionBobinasPorAnio && !bobinasIlimitadas(c) && tieneMRI(c)) {
      const flota = cov.bobinasAlcance !== "porEquipo";
      notas.push(flota
        ? `<b>Bobinas:</b> el cupo de ${cov.reparacionBobinasPorAnio} reparación/es al año es <b>para el conjunto</b> de los ${cantMRI(c)} equipo/s de RM, no por cada uno. Total anual: <b>${bobinasTotal(c)}</b>.`
        : `<b>Bobinas:</b> ${cov.reparacionBobinasPorAnio} reparación/es al año <b>por cada</b> equipo de RM (${cantMRI(c)} equipos). Total anual: <b>${bobinasTotal(c)}</b>.`);
    }
    if ((c.equipos || []).some((e) => e.modalidad === "CT")) {
      notas.push(`<b>n/a</b>: la reparación de bobinas y el monitoreo criogénico son propios de resonancia; los equipos de CT quedan cubiertos por preventivo, correctivo y el resto del alcance.`);
    }
    return notas.length ? `<p class="muted" style="font-size:12px;margin:8px 0 0;line-height:1.6">${notas.join("<br>")}</p>` : "";
  })()}`;
}
function coberturaChips(c) {
  const cov = c.cobertura || {};
  const chips = [];
  if (cov.preventivoInspeccionesAnuales) chips.push(`Preventivo ${cov.preventivoInspeccionesAnuales}/año`);
  if (cov.correctivoManoObra) chips.push("Correctivo (mano de obra)");
  // Bobinas y criogenia solo se anuncian si hay al menos un equipo de RM.
  if (cov.reparacionBobinasPorAnio && tieneMRI(c)) chips.push(`Rep. bobinas ${bobinasTexto(c)}${bobinasIlimitadas(c) ? " (RM)" : ""}`);
  if (cov.soporteRemoto) chips.push("Soporte remoto");
  if (cov.incluirSLA === false) chips.push("Sin cláusula de SLA");
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

      <fieldset><legend>Programa NexoCare</legend>
        <div class="form-grid">
          ${sel("Nivel del Programa", "plan.id", c.plan?.id || "", [["", "— sin nivel —"], ...CAT.PLAN_ORDEN.map((p) => [p, `${CAT.PLANES[p].label} (${CAT.PLANES[p].precioTxt})`])])}
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
          ${sel("El cupo de bobinas es…", "cobertura.bobinasAlcance", cov.bobinasAlcance || "flota", [["flota", "Para toda la flota de RM"], ["porEquipo", "Por cada equipo de RM"]])}
        </div>
        <p class="hint" style="margin:6px 0 0">Con 3 RM y un cupo de 2: <b>para la flota</b> son 2 reparaciones al año en total; <b>por equipo</b> son 6. Dejalo en flota salvo que se haya pactado lo contrario. Si el cupo es «sin límite», este campo no aplica.</p>
        <div class="field full" style="margin-top:12px">
          <label>Reparaciones / partes incluidas <span class="hint">(una por línea — p. ej. módulo amplificador de gradientes, camilla paciente, host y software)</span></label>
          <textarea data-path="cobertura.reparacionesIncluidas" data-list="1" placeholder="Bobinas de RM: todas, sin límite&#10;1 Módulo Amplificador de Gradientes&#10;Reparaciones electromecánicas de camilla paciente">${esc((cov.reparacionesIncluidas || []).join("\n"))}</textarea>
        </div>
        <div class="check-row" style="margin-top:12px">
          ${chk("Incluir cláusula de SLA", "cobertura.incluirSLA", cov.incluirSLA !== false)}
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
    <button type="button" class="btn sm danger" aria-label="Quitar" title="Quitar" onclick="this.parentElement.remove()">✕</button>
  </div>`;
}
function addEquipo() { document.getElementById("equipos").insertAdjacentHTML("beforeend", eqRow()); }
function rsRow(r = {}) {
  return `<div class="rs-row">
    <input placeholder="Razón social" data-rs="razonSocial" value="${esc(r.razonSocial || "")}">
    <input placeholder="CUIT" data-rs="cuit" value="${esc(r.cuit || "")}">
    <input placeholder="Domicilio legal" data-rs="domicilio" value="${esc(r.domicilio || "")}">
    <label class="rs-pri" title="Factura y firma el contrato"><input type="radio" name="rsPrincipal" ${r.principal ? "checked" : ""}> firma</label>
    <button type="button" class="btn sm danger" aria-label="Quitar" title="Quitar" onclick="this.parentElement.remove()">✕</button>
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
    plan: { id: "performance", etiquetaPublica: "NexoCare Performance", modulos: [], notasInternas: "" },
    negociacion: { desviaciones: [] },
    equipos: [], cobertura: Object.assign(structuredClone(CAT.PLANES.performance.base), { incluirSLA: true }),
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
    go("detalle/" + c.id);
    // Recién creada: se ofrece el .docx para editarlo y mandarlo.
    if (isNew) {
      toast("Creada ✓ — generando el .docx…");
      setTimeout(() => generarDocx(c.id), 400);
    } else {
      toast("Guardado ✓");
    }
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
  if (!c) return;
  const m = NEXO_CONTRATO.construirContrato(c, { plantilla: false });
  document.getElementById("printRoot").innerHTML = renderContratoHTML(m);
  window.print();
}

// Renderiza el modelo de contrato.js a HTML imprimible.
// Misma puesta en página que el .docx: A4 y márgenes de la plantilla final.
function renderContratoHTML(m) {
  const filaCli = ([l1, v1, l2, v2]) => (l2 === null && v2 === null)
    ? `<tr><th>${l1}</th><td colspan="3">${v1 ?? "—"}</td></tr>`
    : `<tr><th>${l1}</th><td>${v1 ?? "—"}</td><th>${l2}</th><td>${v2 ?? "—"}</td></tr>`;
  const filaFicha = ([l1, v1, l2, v2]) => (l2 === null)
    ? `<tr><th>${l1}</th><td colspan="3">${v1 || "—"}</td></tr>`
    : `<tr><th>${l1}</th><td>${v1 || "—"}</td><th>${l2}</th><td>${v2 || "—"}</td></tr>`;

  return `
    <style>
      @page { size: A4; margin: 20mm 22mm 27mm 22mm; }
      #printRoot { font-family: var(--body); color: #211c16; font-size: 12.5px; line-height: 1.5; }
      #printRoot .hd { border-bottom: 3px solid #ef8f03; padding-bottom: 10px; margin-bottom: 16px; break-inside: avoid; }
      #printRoot .hd img { height: 30px; width: auto; display: block; margin-bottom: 6px; }
      #printRoot .kick { color:#ef8f03; font-weight:700; font-size:11px; letter-spacing:.12em; }
      #printRoot h1 { font-family: var(--head); font-weight: 800; color: #ef8f03; font-size: 26px; margin: 6px 0 4px; break-after: avoid; page-break-after: avoid; }
      #printRoot h2 { font-family: var(--head); font-weight:800; color: #645d56; font-size: 15px; text-transform: uppercase; letter-spacing: .04em; margin: 16px 0 6px; border-bottom: 1px solid #e0dacf; padding-bottom: 4px; break-after: avoid; page-break-after: avoid; break-inside: avoid; }
      #printRoot h3 { font-family: var(--head); font-weight:700; color:#645d56; font-size:12.5px; margin:12px 0 2px; break-after: avoid; page-break-after: avoid; }
      #printRoot table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 6px 0; break-inside: auto; }
      #printRoot thead { display: table-header-group; }
      #printRoot tr { break-inside: avoid; page-break-inside: avoid; }
      #printRoot td, #printRoot th { border: 1px solid #d9d3ca; padding: 6px 9px; text-align: left; vertical-align: top; }
      #printRoot th { background: #f4f1ec; color: #645d56; font-weight: 700; }
      #printRoot table.eq th, #printRoot table.eco th { background: #645d56; color: #fff; }
      #printRoot table.eco th { width: 32%; }
      #printRoot ul { font-size: 12px; padding-left: 18px; margin:4px 0; }
      #printRoot li { break-inside: avoid; color: #747474; }
      #printRoot li > span { color: #211c16; }
      #printRoot .foot { margin-top: 22px; color: #8c867d; font-size: 10.5px; border-top: 1px solid #e0dacf; padding-top: 8px; break-inside: avoid; }
      #printRoot .foot img { height: 18px; width: auto; vertical-align: middle; margin-left: 4px; }
      #printRoot .num { color: #ef8f03; font-weight: 800; }
      #printRoot .ph { color:#ef8f03; font-weight:700; }
      #printRoot p { orphans: 3; widows: 3; }
      #printRoot p.cl { margin: 0 0 8px; text-align: justify; }
      #printRoot .clause { break-inside: avoid; page-break-inside: avoid; margin: 12px 0 0; }
      #printRoot .pg { page-break-before: always; }
      #printRoot .sign { margin-top: 40px; display:flex; gap:40px; break-inside: avoid; page-break-inside: avoid; }
      #printRoot .sign div { flex:1; border-top:1px solid #211c16; padding-top:6px; font-size:11px; }
      #printRoot .blk { break-inside: avoid; page-break-inside: avoid; }
    </style>

    <div class="hd">
      <img src="${NEXO_BRAND.logo}" alt="Nexolibre" />
      <div style="color:#8c867d;font-size:12px">Ingeniería médica multimarca · Diagnóstico por imágenes MRI / CT</div>
    </div>
    <div class="kick">${m.kicker}</div>
    <h1>${m.etiquetaPub}</h1>
    <p style="color:#8c867d;margin:0 0 10px">${m.subtitulo}</p>

    ${m.filasCliente.length ? `<table>${m.filasCliente.map(filaCli).join("")}</table>` : ""}

    ${m.equipos.length ? `<div class="blk"><h2>Equipos cubiertos</h2>
    <table class="eq"><thead><tr><th>#</th><th>Equipo</th><th>Marca</th><th>Modalidad</th><th>Ubicación</th></tr></thead>
    <tbody>${m.equipos.map((e) => `<tr><td>${e.n}</td><td>${e.modelo || "—"}</td><td>${e.marca || "—"}</td><td>${e.modalidad}</td><td>${e.ubicacion || "—"}</td></tr>`).join("")}</tbody></table></div>` : ""}

    ${m.alcance.length ? `<h2>Alcance del servicio</h2><ul>${m.alcance.map((a) => `<li><span>${a}</span></li>`).join("")}</ul>` : ""}

    ${m.reparaciones.length ? `<h2>Reparaciones de partes incluidas</h2><ul>${m.reparaciones.map((r) => `<li><span>${r}</span></li>`).join("")}</ul>` : ""}

    ${m.economico.length ? `<div class="blk"><h2>Condiciones económicas</h2>
    <table class="eco">${m.economico.map(([l, v, destacado]) => `<tr><th>${l}</th><td${destacado ? ' class="num"' : ""}>${v}</td></tr>`).join("")}</table></div>` : ""}

    ${m.exclusiones.length ? `<h2>Exclusiones</h2><ul>${m.exclusiones.map((e) => `<li><span>${e}</span></li>`).join("")}</ul>` : ""}

    <div class="pg"></div>
    <div class="kick">Anexo I</div>
    <h1 style="font-size:22px;color:#645d56">Términos y Condiciones Generales del Programa</h1>
    <p class="cl">${m.preambulo}</p>
    ${m.clausulas.map((cl) => `<div class="clause"><h3>${cl.titulo}</h3><p class="cl">${cl.cuerpo}</p></div>`).join("")}
    <div class="sign">
      <div><b>Por el Prestador · Nexolibre</b><br>Aclaración / cargo:</div>
      <div><b>Por el Cliente · ${m.firmaCliente}</b><br>Aclaración / cargo:</div>
    </div>

    ${m.fichas.length ? `<div class="pg"></div>
    <div class="kick">Anexo II</div>
    <h1 style="font-size:22px;color:#645d56">Ficha Técnica por Equipo</h1>
    ${m.fichas.map((f) => `<div class="blk"><h3>Ficha Técnica N.º ${f.n}</h3>
      <table>${f.filas.map(filaFicha).join("")}</table></div>`).join("")}
    ${m.notaCT ? `<p style="font-size:11px;color:#8c867d;font-style:italic;margin-top:10px">${m.notaCT}</p>` : ""}` : ""}

    <div class="foot">${m.pie}${m.plantilla ? ' Los campos <span class="ph">[entre corchetes]</span> se completan al perfeccionar el acuerdo.' : ""}<br>Nexolibre es miembro de <img src="${NEXO_BRAND.grupoNexo}" alt="Grupo Nexo" />.</div>`;
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
  const cols = ["numero", "cliente", "razon_social", "cuit", "programa", "modulos_internos", "estado", "equipos", "modalidad", "bobinas_cupo", "bobinas_alcance", "bobinas_total_anual", "canon", "moneda", "inicio", "vence", "ajuste_periodicidad", "proximo_ajuste"];
  const lines = [cols.join(",")];
  for (const c of rows) {
    const fin = computeFin(c), pa = computeProximoAjuste(c);
    const vals = [
      c.numero, nombreCliente(c), rsPrincipal(c).razonSocial, rsPrincipal(c).cuit,
      CAT.PLANES[c.plan?.id]?.label || "", (c.plan?.modulos || []).map((m) => CAT.MODULOS[m]?.label).filter(Boolean).join(" + "),
      ESTADO_LABEL[c.estado], (c.equipos || []).length,
      [...new Set((c.equipos || []).map((e) => e.modalidad))].join("/"),
      c.cobertura?.reparacionBobinasPorAnio ?? "",
      c.cobertura?.reparacionBobinasPorAnio && !bobinasIlimitadas(c) ? (c.cobertura?.bobinasAlcance === "porEquipo" ? "por equipo" : "flota") : "",
      bobinasTotal(c) ?? (bobinasIlimitadas(c) ? "sin límite" : ""),
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
    if (v.reparacionBobinasPorAnio && tieneMRI(c)) t.push(`bobinas ${bobinasTexto(c)}${bobinasIlimitadas(c) ? " (RM)" : ""}`);
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

    <div class="grid-kpi">
      <div class="k"><div class="lb">Contratos vigentes</div><div class="vl">${vig.length}</div><div class="sb">${equipos} equipos en servicio</div></div>
      <div class="k"><div class="lb">Ingreso mensual</div><div class="vl">${money(mrr)}</div><div class="sb">${money(mrr * 12)} anualizado</div></div>
      <div class="k"><div class="lb">Propuestas abiertas</div><div class="vl">${pipe.length}</div><div class="sb">${money(potencial)}/mes potencial</div></div>
    </div>

    <h2>Contratos vigentes</h2>
    ${vig.length ? `<table><thead><tr><th style="width:20%">Cliente</th><th style="width:15%">Programa</th><th style="width:23%">Equipos cubiertos</th><th style="width:13%">Canon mensual</th><th style="width:14%">Vencimiento</th><th style="width:15%">Próximo ajuste</th></tr></thead>
      <tbody>${vig.map(filaVig).join("")}</tbody></table>` : `<p style="color:#8c867d">Sin contratos vigentes.</p>`}

    <h2>Propuestas en curso</h2>
    ${pipe.length ? `<table><thead><tr><th>Cliente</th><th>Programa propuesto</th><th>Estado</th><th>Equipos</th><th>Canon propuesto</th></tr></thead>
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
//  TICKETS  (pedidos de cliente — trazabilidad ligera)
// ============================================================
const ticketPorId = (id) => state.tickets.find((t) => t.id === id);
const presupuestosDeTicket = (tk) => state.presupuestos.filter((p) => p.ticketId === tk.id);

function renderTickets() {
  const el = document.getElementById("view-tickets");
  const q = state.filtroTk.q.toLowerCase();
  const rows = state.tickets.filter((t) => {
    if (state.filtroTk.estado && t.estado !== state.filtroTk.estado) return false;
    if (q && !(`${t.numero} ${t.cliente?.nombreComercial || ""} ${t.descripcion || ""}`.toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const abiertos = state.tickets.filter((t) => TK_ESTADOS.find((e) => e.id === t.estado)?.grupo === "abierto").length;
  el.innerHTML = `
    <div class="kicker">Pedidos de cliente</div>
    <div class="page-head">
      <h1><span class="accent">Tickets</span></h1>
      ${state.soloLectura ? "" : `<button class="btn primary sm" onclick="location.hash='tkform/new'">+ Nuevo ticket</button>`}
    </div>
    <div class="table-tools">
      <input type="search" id="tkq" placeholder="Buscar cliente, N° o descripción…" value="${esc(state.filtroTk.q)}" />
      <select id="tkfe"><option value="">Todos los estados</option>${TK_ESTADOS.map((e) => `<option value="${e.id}" ${state.filtroTk.estado === e.id ? "selected" : ""}>${e.label}</option>`).join("")}</select>
      <span class="muted" style="font-size:13px">${abiertos} abierto${abiertos === 1 ? "" : "s"} · ${rows.length} de ${state.tickets.length}</span>
    </div>
    <div class="overflow"><table class="data">
      <thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Pedido</th><th>Estado</th><th>Presup.</th></tr></thead>
      <tbody>${rows.map(ticketRow).join("") || `<tr><td colspan="6" class="empty">Sin tickets todavía.</td></tr>`}</tbody>
    </table></div>`;
  document.getElementById("tkq").oninput = (e) => { state.filtroTk.q = e.target.value; renderTickets(); };
  document.getElementById("tkfe").onchange = (e) => { state.filtroTk.estado = e.target.value; renderTickets(); };
}
function ticketRow(t) {
  const np = presupuestosDeTicket(t).length;
  return `<tr onclick="location.hash='tkdetalle/${t.id}'">
    <td><b>${esc(t.numero)}</b></td>
    <td>${fmt(t.fecha)}</td>
    <td><b>${esc(t.cliente?.nombreComercial || "—")}</b></td>
    <td>${esc(TK_TIPO_PEDIDO[t.tipoPedido] || t.tipoPedido)}<br><span class="muted" style="font-size:12px">${esc((t.descripcion || "").slice(0, 70))}${(t.descripcion || "").length > 70 ? "…" : ""}</span></td>
    <td><span class="badge ${t.estado}">${TK_ESTADO_LABEL[t.estado]}</span></td>
    <td>${np || "—"}</td></tr>`;
}
function renderTicketDetalle(id) {
  const t = ticketPorId(id);
  const el = document.getElementById("view-tkdetalle");
  if (!t) { el.innerHTML = `<p class="empty">No encontrado. <a href="#tickets">Volver</a></p>`; return; }
  const presus = presupuestosDeTicket(t);
  const ro = state.soloLectura;
  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="kicker">Ticket · <span class="badge ${t.estado}">${TK_ESTADO_LABEL[t.estado]}</span></div>
        <h1>${esc(t.cliente?.nombreComercial || "—")}</h1>
        <p class="muted">${esc(t.numero)} · ${fmt(t.fecha)} · ${esc(TK_TIPO_PEDIDO[t.tipoPedido] || "")}${t.cliente?.contacto ? " · " + esc(t.cliente.contacto) : ""}</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${ro ? "" : `<button class="btn sm" onclick="location.hash='tkform/${t.id}'">✎ Editar</button>`}
        ${ro ? "" : `<button class="btn primary sm" onclick="location.hash='presuform/new/${t.id}'">+ Presupuesto</button>`}
        ${ro ? "" : estadoTicketBtns(t)}
      </div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="card"><h3>Pedido</h3><p style="font-size:14px;white-space:pre-wrap">${esc(t.descripcion || "—")}</p></div>
        <div class="card"><h3>Presupuestos vinculados</h3>
          ${presus.length ? `<div class="overflow"><table class="data"><thead><tr><th>N°</th><th>Tipo</th><th>Estado</th><th>Total</th></tr></thead>
            <tbody>${presus.map((p) => { const v = valorPresu(p); return `<tr onclick="location.hash='presudetalle/${p.id}'">
              <td><b>${esc(p.numero)}</b></td><td>${esc((PRE_TIPOS[p.tipo] || {}).label || p.tipo)}</td>
              <td><span class="badge ${p.estado}">${PRE_ESTADO_LABEL[p.estado]}</span></td>
              <td>${money(v.unaVez || v.mensual, v.moneda)}${v.mensual ? "/mes" : ""}</td></tr>`; }).join("")}</tbody></table></div>`
            : `<p class="muted" style="font-size:13px">Todavía sin presupuestos. ${ro ? "" : `<a href="#presuform/new/${t.id}">Crear uno</a>.`}</p>`}
        </div>
      </div>
      <div>
        <div class="card"><h3>Cliente</h3>
          <dl class="kv">
            <dt>Nombre</dt><dd><b>${esc(t.cliente?.nombreComercial || "—")}</b></dd>
            <dt>Contacto</dt><dd>${esc(t.cliente?.contacto || "—")}</dd>
            <dt>Razón social</dt><dd>${esc(rsPrincipal(t).razonSocial || "—")}</dd>
          </dl>
        </div>
        <div class="card"><h3>Trazabilidad</h3>
          <ul class="tl">${(t.historial || []).slice().reverse().map((h) => `<li><span class="est">${TK_ESTADO_LABEL[h.estado] || h.estado}</span> <span class="fch">${fmt(h.fecha)} · ${esc(h.usuario || "")}</span></li>`).join("") || '<li class="muted">Sin movimientos</li>'}</ul>
        </div>
      </div>
    </div>
    <p style="margin-top:14px"><a href="#tickets">← Volver a tickets</a></p>`;
}
function estadoTicketBtns(t) {
  const b = [];
  if (t.estado === "abierto" || t.estado === "presupuestado") {
    b.push(`<button class="btn sm" onclick="cambiarEstadoTicket('${t.id}','ganado')">✔ Ganado</button>`);
    b.push(`<button class="btn sm danger" onclick="cambiarEstadoTicket('${t.id}','perdido')">✕ Perdido</button>`);
  }
  if (t.estado !== "cerrado" && t.estado !== "abierto") b.push(`<button class="btn sm" onclick="cambiarEstadoTicket('${t.id}','cerrado')">Cerrar</button>`);
  return b.join("");
}
/**
 * Comprueba una escritura contra las reglas del núcleo antes de aplicarla.
 *
 * Traduce el registro a la forma v3, valida y devuelve los efectos derivados
 * (lo que en una base de datos harían los triggers). Si la regla no se cumple
 * lanza ErrorNexo con su código NX y la escritura no ocurre.
 *
 * Sin servidor esto no es una barrera de seguridad —quien tenga el token puede
 * editar el JSON a mano— pero garantiza que todo lo que pasa por la aplicación
 * quede consistente.
 */
function validarEscritura(entidad, accion, nuevoViejo, anteriorViejo) {
  return window.NEXO_ADAPTADOR.validarEnFormaVieja(entidad, accion, nuevoViejo, anteriorViejo, {
    tickets: state.tickets, presupuestos: state.presupuestos, contratos: state.data,
    campanas: state.campanas, estrategias: state.estrategias, leads: state.leads,
    tiposCambio: state.tiposCambio,
    rol: state.rol, usuario: state.user,
  });
}

/** Muestra el rechazo de una regla con su código y la sugerencia. */
function avisarRegla(e) {
  if (e && e.codigo) {
    toast(e.sugerencia ? `${e.message} — ${e.sugerencia}` : e.message, true, true);
    return true;
  }
  return false;
}

async function cambiarEstadoTicket(id, nuevo) {
  const t = ticketPorId(id);
  if (!t) return;
  const antes = structuredClone(t);
  const propuesto = { ...structuredClone(t), estado: nuevo };

  try {
    validarEscritura("tickets", "editar", propuesto, antes);
  } catch (e) {
    if (avisarRegla(e)) return;   // la regla rechazó: no se toca nada
    throw e;
  }

  t.estado = nuevo;
  t.historial = t.historial || [];
  t.historial.push({ estado: nuevo, fecha: new Date().toISOString().slice(0, 10), usuario: state.user || "—" });
  try { await persist(`Ticket ${t.numero} → ${nuevo}`, "tickets"); toast(`${t.numero}: ${TK_ESTADO_LABEL[nuevo]}`); router(); }
  catch (e) { toast("Error: " + e.message, true, true); }
}
function nuevoTicket() {
  const d = new Date().toISOString().slice(0, 10);
  return {
    id: "tk_" + Date.now(), numero: proxNumeroTicket(), fecha: d,
    cliente: { nombreComercial: "", razonesSociales: [], contacto: "" },
    tipoPedido: "servicio", descripcion: "", estado: "abierto", presupuestoIds: [],
    usuario: state.user || "—", historial: [{ estado: "abierto", fecha: d, usuario: state.user || "—" }],
  };
}
function renderTicketForm(id) {
  const el = document.getElementById("view-tkform");
  const isNew = !id || id === "new";
  const t = isNew ? nuevoTicket() : structuredClone(ticketPorId(id));
  if (!t) { el.innerHTML = `<p class="empty">No encontrado</p>`; return; }
  window._draftTk = t;
  el.innerHTML = `
    <div class="kicker">${isNew ? "Alta" : "Edición"}</div>
    <div class="page-head"><h1>${isNew ? "Nuevo" : "Editar"} <span class="accent">ticket</span></h1></div>
    <form id="tkform">
      <fieldset><legend>Pedido</legend><div class="form-grid">
        ${inp("Cliente (nombre comercial)", "cliente.nombreComercial", t.cliente?.nombreComercial, "full")}
        ${inp("Contacto", "cliente.contacto", t.cliente?.contacto)}
        ${sel("Tipo de pedido", "tipoPedido", t.tipoPedido, Object.entries(TK_TIPO_PEDIDO))}
        ${!isNew ? sel("Estado", "estado", t.estado, TK_ESTADOS.map((e) => [e.id, e.label])) : ""}
      </div>
      <div class="field full" style="margin-top:12px"><label>Descripción del pedido</label>
        <textarea data-path="descripcion" rows="4" placeholder="Qué necesita el cliente, equipo involucrado, urgencia…">${esc(t.descripcion || "")}</textarea></div>
      </fieldset>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn ghost" onclick="location.hash='${isNew ? "tickets" : "tkdetalle/" + id}'">Cancelar</button>
        <button type="submit" class="btn primary">${isNew ? "Crear ticket" : "Guardar"}</button>
      </div>
    </form>`;
  document.getElementById("tkform").onsubmit = (e) => { e.preventDefault(); guardarTicket(isNew, id); };
}
async function guardarTicket(isNew, id) {
  const t = window._draftTk;
  const prev = isNew ? null : ticketPorId(id)?.estado;
  document.querySelectorAll("#tkform [data-path]").forEach((f) => setPath(t, f.dataset.path, f.value));
  if (!t.cliente.nombreComercial) { toast("Falta el nombre del cliente", true, true); return; }
  if (!t.cliente.razonesSociales) t.cliente.razonesSociales = [];
  if (!isNew && prev !== t.estado) t.historial.push({ estado: t.estado, fecha: new Date().toISOString().slice(0, 10), usuario: state.user || "—" });
  if (isNew) state.tickets.push(t);
  else { const i = state.tickets.findIndex((x) => x.id === id); state.tickets[i] = t; }
  try { await persist(`${isNew ? "Alta" : "Edición"} ticket ${t.numero} · ${t.cliente.nombreComercial}`, "tickets"); go("tkdetalle/" + t.id); toast(isNew ? "Ticket creado ✓" : "Guardado ✓"); }
  catch (e) { toast("Error: " + e.message, true, true); }
}

// ============================================================
//  PRESUPUESTOS
// ============================================================
const presuPorId = (id) => state.presupuestos.find((p) => p.id === id);
// Valor de un presupuesto, neto de IVA (para pipeline, dashboard y reportes).
function valorPresu(p) {
  const cc = NEXO_PRESUPUESTO.calcPresupuesto(p);
  return { unaVez: cc.netoUnaVez, mensual: cc.abonoMensualNeto, anual: cc.netoUnaVez + cc.abonoMensualNeto * 12, moneda: cc.moneda };
}
const CATEGORIAS_EQUIPO = ["Equipo", "Logística e instalación", "Puesta en marcha y garantía", "Capacitación", "Financiación"];
// Vencimiento de la validez de la oferta: fecha de emisión + validezDias.
function vencePresu(p) {
  const base = parseDate(p.fecha);
  const dias = Number(p?.economico?.validezDias);
  if (!base || !dias) return null;
  const d = new Date(base);
  d.setDate(d.getDate() + dias);
  return d;
}
// Un presupuesto abierto cuya validez ya pasó está "vencido" (hay que rehacerlo).
function presuVencido(p) {
  if (!PRE_ABIERTOS.has(p.estado)) return false;
  const v = vencePresu(p);
  return v ? v < hoy() : false;
}
// Suma de montos de una lista de presupuestos, agrupada por moneda (evita
// sumar USD y ARS en un mismo total, que sería incorrecto).
function totalesPorMoneda(lista, campo = "anual") {
  const out = {};
  for (const p of lista) { const v = valorPresu(p); out[v.moneda] = (out[v.moneda] || 0) + (v[campo] || 0); }
  return out; // { USD: n, ARS: m }
}
// Texto de un mapa {moneda: monto} para mostrar sin mezclar.
const textoMonedas = (m) => Object.entries(m).filter(([, v]) => v).map(([mon, v]) => money(v, mon)).join(" · ") || money(0);

function renderPresupuestos() {
  const el = document.getElementById("view-presupuestos");
  const q = state.filtroPre.q.toLowerCase();
  const rows = state.presupuestos.filter((p) => {
    if (state.filtroPre.tipo && p.tipo !== state.filtroPre.tipo) return false;
    if (state.filtroPre.estado && p.estado !== state.filtroPre.estado) return false;
    const rs = (p.cliente?.razonesSociales || []).map((r) => r.razonSocial).join(" ");
    if (q && !(`${p.numero} ${p.cliente?.nombreComercial || ""} ${rs}`.toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const abiertos = state.presupuestos.filter((p) => PRE_ABIERTOS.has(p.estado));
  const pipe = textoMonedas(totalesPorMoneda(abiertos));
  el.innerHTML = `
    <div class="kicker">Cotizaciones</div>
    <div class="page-head">
      <h1>Todos los <span class="accent">presupuestos</span></h1>
      <div style="display:flex;gap:8px">
        <button class="btn sm" onclick="exportarPresuCSV()">⬇ CSV</button>
        ${state.soloLectura ? "" : `<button class="btn primary sm" onclick="location.hash='presuform/new'">+ Nuevo</button>`}
      </div>
    </div>
    <div class="table-tools">
      <input type="search" id="pq" placeholder="Buscar cliente o N°…" value="${esc(state.filtroPre.q)}" />
      <select id="pfe"><option value="">Todos los estados</option>${PRE_ESTADOS.map((e) => `<option value="${e.id}" ${state.filtroPre.estado === e.id ? "selected" : ""}>${e.label}</option>`).join("")}</select>
      <select id="pft"><option value="">Todo tipo</option>${Object.entries(PRE_TIPOS).map(([k, v]) => `<option value="${k}" ${state.filtroPre.tipo === k ? "selected" : ""}>${v.label}</option>`).join("")}</select>
      <span class="muted" style="font-size:13px">${abiertos.length} abiertos · ${pipe} anualizado en juego</span>
    </div>
    <div class="overflow"><table class="data">
      <thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>Estado</th><th>Total</th></tr></thead>
      <tbody>${rows.map(presuRow).join("") || `<tr><td colspan="6" class="empty">Sin presupuestos todavía.</td></tr>`}</tbody>
    </table></div>`;
  document.getElementById("pq").oninput = (e) => { state.filtroPre.q = e.target.value; renderPresupuestos(); };
  document.getElementById("pfe").onchange = (e) => { state.filtroPre.estado = e.target.value; renderPresupuestos(); };
  document.getElementById("pft").onchange = (e) => { state.filtroPre.tipo = e.target.value; renderPresupuestos(); };
}
function presuRow(p) {
  const v = valorPresu(p);
  const totalTxt = v.mensual && v.unaVez ? `${money(v.unaVez, v.moneda)} + ${money(v.mensual, v.moneda)}/mes`
    : v.mensual ? `${money(v.mensual, v.moneda)}/mes` : money(v.unaVez, v.moneda);
  return `<tr onclick="location.hash='presudetalle/${p.id}'">
    <td><b>${esc(p.numero)}</b></td>
    <td>${fmt(p.fecha)}</td>
    <td><b>${esc(p.cliente?.nombreComercial || "—")}</b>${p.titulo ? `<br><span class="muted" style="font-size:12px">${esc(p.titulo.slice(0, 62))}${p.titulo.length > 62 ? "…" : ""}</span>` : ""}</td>
    <td>${esc((PRE_TIPOS[p.tipo] || {}).label || p.tipo)}${p.subtipo ? `<br><span class="muted" style="font-size:12px">${esc(PRE_SUBTIPOS[p.subtipo] || p.subtipo)}</span>` : ""}</td>
    <td><span class="badge ${p.estado}">${PRE_ESTADO_LABEL[p.estado]}</span>${presuVencido(p) ? ' <span class="badge vencida" title="La validez de la oferta ya venció">validez vencida</span>' : ""}</td>
    <td>${totalTxt}</td></tr>`;
}
function renderPresuDetalle(id) {
  const p = presuPorId(id);
  const el = document.getElementById("view-presudetalle");
  if (!p) { el.innerHTML = `<p class="empty">No encontrado. <a href="#presupuestos">Volver</a></p>`; return; }
  const cc = NEXO_PRESUPUESTO.calcPresupuesto(p);
  const tk = p.ticketId ? ticketPorId(p.ticketId) : null;
  const ro = state.soloLectura;
  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="kicker">${esc((PRE_TIPOS[p.tipo] || {}).label || p.tipo)} · <span class="badge ${p.estado}">${PRE_ESTADO_LABEL[p.estado]}</span></div>
        <h1>${esc(p.cliente?.nombreComercial || "—")}</h1>
        ${p.titulo ? `<p style="font-size:15px;margin:2px 0 4px;color:var(--taupe)">${esc(p.titulo)}</p>` : ""}
        <p class="muted">${esc(p.numero)} · ${fmt(p.fecha)}${p.estadoOrigen ? ` · registro: ${esc(p.estadoOrigen)}` : ""}${tk ? ` · <a href="#tkdetalle/${tk.id}">ticket ${esc(tk.numero)}</a>` : ""}</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${ro ? "" : `<button class="btn sm" onclick="location.hash='presuform/${p.id}'">✎ Editar</button>`}
        ${ro ? "" : `<button class="btn sm" onclick="duplicarPresu('${p.id}')" title="Crear una copia editable (revisión de negociación)">⧉ Duplicar</button>`}
        <button class="btn sm" onclick="generarPresuPDF('${p.id}')">🧾 Ver / imprimir</button>
        <button class="btn sm" onclick="generarPresupuestoDocx('${p.id}')" title="Descarga un .docx editable">⬇ Descargar .docx</button>
        ${ro ? "" : estadoPresuBtns(p)}
      </div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="card"><h3>Ítems</h3>${renderPresuItemsTabla(p)}</div>
        ${p.notas ? `<div class="card"><h3>Notas</h3><p style="font-size:14px;white-space:pre-wrap">${esc(p.notas)}</p></div>` : ""}
      </div>
      <div>
        <div class="card"><h3>Totales</h3>
          <dl class="kv">
            ${cc.hayUnaVez ? `<dt>Neto (única vez)</dt><dd>${money(cc.netoUnaVez, cc.moneda)}</dd>
              <dt>IVA ${cc.ivaPct}%</dt><dd>${money(cc.ivaUnaVez, cc.moneda)}</dd>
              <dt>Total única vez</dt><dd><b>${money(cc.totalUnaVez, cc.moneda)}</b></dd>` : ""}
            ${cc.hayRecurrente ? `<dt>Abono mensual neto</dt><dd>${money(cc.abonoMensualNeto, cc.moneda)}</dd>
              <dt>Total mensual c/IVA</dt><dd><b>${money(cc.totalMensual, cc.moneda)}</b></dd>` : ""}
          </dl>
        </div>
        <div class="card"><h3>Condiciones</h3>
          <dl class="kv">
            <dt>Forma de pago</dt><dd>${esc(p.economico?.formaPago || "—")}</dd>
            <dt>Validez</dt><dd>${p.economico?.validezDias ? `${p.economico.validezDias} días${vencePresu(p) ? ` · vence ${fmt(vencePresu(p))}` : ""}` : "—"}${presuVencido(p) ? ' <span class="badge vencida">vencida</span>' : ""}</dd>
            <dt>Moneda</dt><dd>${p.economico?.moneda || "USD"}</dd>
          </dl>
        </div>
        <div class="card"><h3>Trazabilidad</h3>
          <ul class="tl">${(p.historialEstados || []).slice().reverse().map((h) => `<li><span class="est">${PRE_ESTADO_LABEL[h.estado] || h.estado}</span> <span class="fch">${fmt(h.fecha)} · ${esc(h.usuario || "")}</span></li>`).join("") || '<li class="muted">Sin movimientos</li>'}</ul>
        </div>
      </div>
    </div>
    <p style="margin-top:14px"><a href="#presupuestos">← Volver a presupuestos</a></p>`;
}
function renderPresuItemsTabla(p) {
  const m = NEXO_PRESUPUESTO.construirPresupuesto(p, { plantilla: false });
  const t = m.tabla;
  let html = `<div class="overflow"><table class="data"><thead><tr>${t.head.map((h) => `<th${h.num ? ' style="text-align:right"' : ""}>${h.t}</th>`).join("")}</tr></thead><tbody>`;
  html += t.rows.map((r) => `<tr>${r.map((c, i) => `<td${t.head[i]?.num ? ' style="text-align:right"' : ""}>${c.strong ? `<b>${c.t}</b>` : c.t}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${t.head.length}" class="muted">Sin ítems</td></tr>`;
  html += `</tbody></table></div>`;
  if (m.saasTabla) {
    html += `<h4 style="margin:12px 0 4px;color:var(--taupe)">SaaS</h4><div class="overflow"><table class="data"><thead><tr>${m.saasTabla.head.map((h) => `<th${h.num ? ' style="text-align:right"' : ""}>${h.t}</th>`).join("")}</tr></thead><tbody>${m.saasTabla.rows.map((r) => `<tr>${r.map((c, i) => `<td${m.saasTabla.head[i]?.num ? ' style="text-align:right"' : ""}>${c.t}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  return html;
}
function estadoPresuBtns(p) {
  const flujo = ["borrador", "enviado", "negociacion", "ganado"];
  const b = [];
  const i = flujo.indexOf(p.estado);
  if (i >= 0 && i < flujo.length - 1) b.push(`<button class="btn primary sm" onclick="cambiarEstadoPresu('${p.id}','${flujo[i + 1]}')">→ ${PRE_ESTADO_LABEL[flujo[i + 1]]}</button>`);
  if (PRE_ABIERTOS.has(p.estado)) b.push(`<button class="btn sm danger" onclick="cambiarEstadoPresu('${p.id}','perdido')">✕ Perdido</button>`);
  return b.join("");
}
async function cambiarEstadoPresu(id, nuevo) {
  const p = presuPorId(id);
  if (!p) return;
  const antes = structuredClone(p);
  const propuesto = { ...structuredClone(p), estado: nuevo };

  // Las transiciones ilegales, el aprobar dos presupuestos del mismo ticket y
  // el aprobar uno vencido se cortan acá, antes de escribir nada.
  try {
    validarEscritura("presupuestos", "editar", propuesto, antes);
  } catch (e) {
    if (avisarRegla(e)) return;
    throw e;
  }

  p.estado = nuevo;
  p.historialEstados = p.historialEstados || [];
  p.historialEstados.push({ estado: nuevo, fecha: new Date().toISOString().slice(0, 10), usuario: state.user || "—" });
  try {
    await persist(`Presupuesto ${p.numero} → ${nuevo}`, "presupuestos");
    // Si se gana un presupuesto de un ticket, el ticket pasa a ganado.
    if (nuevo === "ganado" && p.ticketId) { const tk = ticketPorId(p.ticketId); if (tk && tk.estado !== "ganado") await cambiarEstadoTicket(tk.id, "ganado"); }
    toast(`${p.numero}: ${PRE_ESTADO_LABEL[nuevo]}`);
    router();
  } catch (e) { toast("Error: " + e.message, true, true); }
}

// Duplica un presupuesto como borrador nuevo: sirve para las revisiones que
// genera la negociación sin perder la versión anterior.
async function duplicarPresu(id) {
  const orig = presuPorId(id);
  if (!orig) return;
  const d = new Date().toISOString().slice(0, 10);
  const copia = structuredClone(orig);
  copia.id = "pre_" + Date.now();
  copia.numero = proxNumeroPresu();
  copia.estado = "borrador";
  copia.fecha = d;
  copia.historialEstados = [{ estado: "borrador", fecha: d, usuario: state.user || "—" }];
  copia.archivos = [];
  state.presupuestos.push(copia);
  try {
    await persist(`Duplicado ${orig.numero} → ${copia.numero}`, "presupuestos");
    // Si venía de un ticket, se le suma la nueva versión.
    const tk = copia.ticketId ? ticketPorId(copia.ticketId) : null;
    if (tk && !tk.presupuestoIds.includes(copia.id)) { tk.presupuestoIds.push(copia.id); await persist(`Ticket ${tk.numero}: revisión ${copia.numero}`, "tickets"); }
    toast(`Copia creada: ${copia.numero}`);
    go("presuform/" + copia.id);
  } catch (e) { toast("Error: " + e.message, true, true); }
}
function nuevoPresupuesto(ticketId) {
  const d = new Date().toISOString().slice(0, 10);
  const tk = ticketId ? ticketPorId(ticketId) : null;
  const tipoDeTk = { servicio: "servicio", parte: "venta", equipo: "venta", saas: "saas" };
  return {
    id: "pre_" + Date.now(), numero: proxNumeroPresu(), tipo: tk ? (tipoDeTk[tk.tipoPedido] || "servicio") : "servicio",
    estado: "borrador", fecha: d, ticketId: tk?.id || "", ticketNumero: tk?.numero || "",
    subtipo: "", titulo: tk?.descripcion || "",
    cliente: tk ? structuredClone(tk.cliente) : { nombreComercial: "", razonesSociales: [{ razonSocial: "", cuit: "", domicilio: "", principal: true }], contacto: "", localidad: "", provincia: "" },
    items: [], saas: [],
    economico: { moneda: "USD", ivaPct: 21, incluyeIVA: false, validezDias: 15, formaPago: "", descuentoPct: 0, recurrencia: "unica" },
    notas: "", archivos: [], usuario: state.user || "—", historialEstados: [{ estado: "borrador", fecha: d, usuario: state.user || "—" }],
  };
}
function renderPresuForm(id, ticketId) {
  const el = document.getElementById("view-presuform");
  const isNew = !id || id === "new";
  const p = isNew ? nuevoPresupuesto(ticketId) : structuredClone(presuPorId(id));
  if (!p) { el.innerHTML = `<p class="empty">No encontrado</p>`; return; }
  if (!p.cliente.razonesSociales?.length) p.cliente.razonesSociales = [{ razonSocial: "", cuit: "", domicilio: "", principal: true }];
  window._draftPre = p;
  const eco = p.economico;
  const ticketsAbiertos = state.tickets.filter((t) => TK_ESTADOS.find((e) => e.id === t.estado)?.grupo === "abierto" || t.id === p.ticketId);
  el.innerHTML = `
    <div class="kicker">${isNew ? "Alta" : "Edición"}</div>
    <div class="page-head"><h1>${isNew ? "Nuevo" : "Editar"} <span class="accent">presupuesto</span></h1></div>
    <form id="pform">
      <fieldset><legend>Tipo y pedido</legend><div class="form-grid">
        ${sel("Tipo de presupuesto", "tipo", p.tipo, Object.entries(PRE_TIPOS).map(([k, v]) => [k, v.label]))}
        ${sel("Subtipo (si es venta)", "subtipo", p.subtipo || "", Object.entries(PRE_SUBTIPOS))}
        <div class="field"><label>Ticket vinculado <span class="hint">(pedido del cliente)</span></label>
          <select data-path="ticketId" id="preTicket"><option value="">— sin ticket —</option>${ticketsAbiertos.map((t) => `<option value="${t.id}" ${p.ticketId === t.id ? "selected" : ""}>${esc(t.numero)} · ${esc(t.cliente?.nombreComercial || "")}</option>`).join("")}</select></div>
        ${!isNew ? sel("Estado", "estado", p.estado, PRE_ESTADOS.map((e) => [e.id, e.label])) : ""}
      </div>
      ${inp("Título del presupuesto", "titulo", p.titulo, "full")}
      <p class="hint" style="margin:4px 0 0">Es el que va al documento y al nombre del archivo: «Servicio de diagnóstico y reparación de bobina — MRI GE Profile 0.2T».</p>
      <p class="hint" id="tipoHint" style="margin:6px 0 0"></p>
      </fieldset>

      <fieldset><legend>Cliente</legend><div class="form-grid">
        ${inp("Nombre comercial", "cliente.nombreComercial", p.cliente.nombreComercial, "full")}
        ${inp("Contacto", "cliente.contacto", p.cliente.contacto)}
        ${inp("Localidad", "cliente.localidad", p.cliente.localidad)}
        ${inp("Provincia", "cliente.provincia", p.cliente.provincia)}
      </div>
      <div style="margin-top:14px">
        <label style="font-weight:700;font-size:13px">Razones sociales <span class="hint">— marcá la que factura.</span></label>
        <div class="rs-list" id="preRazones">${p.cliente.razonesSociales.map(rsRow).join("")}</div>
        <button type="button" class="btn sm" onclick="document.getElementById('preRazones').insertAdjacentHTML('beforeend', rsRow({}))">+ Razón social</button>
      </div></fieldset>

      <div id="itemsSection">${renderPresuItemsSection()}</div>

      <fieldset><legend>Condiciones económicas</legend><div class="form-grid">
        ${sel("Moneda", "economico.moneda", eco.moneda, [["USD", "USD"], ["ARS", "ARS"]])}
        ${sel("Cobro", "economico.recurrencia", eco.recurrencia || "unica", [["unica", "Pago único"], ["mensual", "Abono mensual"]])}
        ${inp("IVA %", "economico.ivaPct", eco.ivaPct, "", "number")}
        ${inp("Descuento % (única vez)", "economico.descuentoPct", eco.descuentoPct || 0, "", "number")}
        ${inp("Validez (días)", "economico.validezDias", eco.validezDias, "", "number")}
        ${inp("Forma de pago", "economico.formaPago", eco.formaPago, "full")}
      </div>
      <div class="check-row" style="margin-top:12px">${chk("Los precios ya incluyen IVA", "economico.incluyeIVA", eco.incluyeIVA)}</div>
      </fieldset>

      <fieldset><legend>Notas</legend><div class="field full"><textarea data-path="notas" rows="3">${esc(p.notas || "")}</textarea></div></fieldset>

      <div class="presu-totales card" id="preTotales"></div>

      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px">
        <button type="button" class="btn ghost" onclick="location.hash='${isNew ? "presupuestos" : "presudetalle/" + id}'">Cancelar</button>
        <button type="submit" class="btn primary">${isNew ? "Crear presupuesto" : "Guardar"}</button>
      </div>
    </form>`;
  const form = document.getElementById("pform");
  form.onsubmit = (e) => { e.preventDefault(); guardarPresu(isNew, id); };
  form.querySelector('[data-path="tipo"]').onchange = onTipoPresuChange;
  form.addEventListener("input", refrescarTotalesPresu);
  actualizarTipoHint();
  refrescarTotalesPresu();
}
// Sección de ítems (depende del tipo). Se re-renderiza al cambiar el tipo.
function renderPresuItemsSection() {
  const p = window._draftPre;
  const tipo = p.tipo;
  const itemsLegend = tipo === "partes" ? "Partes a cotizar" : tipo === "equipos" ? "Equipo y conceptos" : tipo === "saas" ? "Ítems adicionales (opcional)" : "Ítems / servicios";
  return `
    <fieldset><legend>${itemsLegend}</legend>
      <div class="items-list" id="preItems" data-tipo="${tipo}">${(p.items || []).map((it) => itemRow(tipo, it)).join("")}</div>
      <button type="button" class="btn sm" onclick="document.getElementById('preItems').insertAdjacentHTML('beforeend', itemRow(document.getElementById('preItems').dataset.tipo, {}));refrescarTotalesPresu()">+ Ítem</button>
    </fieldset>
    <fieldset><legend>Servicios SaaS ${tipo === "saas" ? "" : "(add-on opcional)"}</legend>
      <p class="hint" style="margin:0 0 8px">Abono mensual de Cryo / Gestión, con setup inicial si aplica. Se puede sumar a cualquier presupuesto.</p>
      <div class="items-list" id="preSaas">${(p.saas || []).map(saasRow).join("")}</div>
      <button type="button" class="btn sm" onclick="document.getElementById('preSaas').insertAdjacentHTML('beforeend', saasRow({}));refrescarTotalesPresu()">+ Servicio SaaS</button>
    </fieldset>`;
}
function itemRow(tipo, it = {}) {
  if (tipo === "partes") return `<div class="it-row it-partes">
    <input placeholder="Detalle de la parte" data-it="detalle" value="${esc(it.detalle || "")}">
    <input placeholder="SKU" data-it="sku" value="${esc(it.sku || "")}" style="max-width:110px">
    <input type="number" placeholder="Cant." data-it="cantidad" value="${it.cantidad ?? 1}" style="max-width:70px">
    <input type="number" placeholder="P. lista" data-it="unitario" value="${it.unitario ?? ""}" style="max-width:110px">
    <input type="number" placeholder="P. c/interc." data-it="unitarioIntercambio" value="${it.unitarioIntercambio ?? ""}" style="max-width:110px">
    <label class="rs-pri" title="Aplica el precio con intercambio"><input type="checkbox" data-it="intercambio" ${it.intercambio ? "checked" : ""}> interc.</label>
    <button type="button" class="btn sm danger" aria-label="Quitar ítem" title="Quitar ítem" onclick="this.parentElement.remove();refrescarTotalesPresu()">✕</button>
  </div>`;
  const catSel = tipo === "equipos"
    ? `<select data-it="categoria" style="max-width:150px">${CATEGORIAS_EQUIPO.map((c) => `<option ${it.categoria === c ? "selected" : ""}>${c}</option>`).join("")}</select>`
    : "";
  return `<div class="it-row">
    ${catSel}
    <input placeholder="Detalle" data-it="detalle" value="${esc(it.detalle || "")}">
    <input type="number" placeholder="Cant." data-it="cantidad" value="${it.cantidad ?? 1}" style="max-width:70px">
    <input type="number" placeholder="Unitario" data-it="unitario" value="${it.unitario ?? ""}" style="max-width:120px">
    <button type="button" class="btn sm danger" aria-label="Quitar ítem" title="Quitar ítem" onclick="this.parentElement.remove();refrescarTotalesPresu()">✕</button>
  </div>`;
}
function saasRow(x = {}) {
  return `<div class="it-row it-saas">
    <select data-sa="producto" style="max-width:150px"><option value="cryo" ${x.producto === "cryo" ? "selected" : ""}>Cryo</option><option value="gestion" ${x.producto === "gestion" ? "selected" : ""}>Gestión</option></select>
    <input placeholder="Detalle (opcional)" data-sa="detalle" value="${esc(x.detalle || "")}">
    <input type="number" placeholder="Abono/mes" data-sa="abonoMensual" value="${x.abonoMensual ?? ""}" style="max-width:110px">
    <input type="number" placeholder="Meses" data-sa="meses" value="${x.meses ?? ""}" style="max-width:80px">
    <input type="number" placeholder="Setup" data-sa="setup" value="${x.setup ?? ""}" style="max-width:100px">
    <button type="button" class="btn sm danger" aria-label="Quitar ítem" title="Quitar ítem" onclick="this.parentElement.remove();refrescarTotalesPresu()">✕</button>
  </div>`;
}
// Lee los ítems/SaaS del DOM al draft (para recomputar o antes de re-render).
function leerItemsPresu() {
  const p = window._draftPre;
  p.items = [...document.querySelectorAll("#preItems .it-row")].map((row) => {
    const o = {};
    row.querySelectorAll("[data-it]").forEach((f) => {
      if (f.type === "checkbox") o[f.dataset.it] = f.checked;
      else if (f.type === "number") o[f.dataset.it] = f.value === "" ? "" : Number(f.value);
      else o[f.dataset.it] = f.value;
    });
    return o;
  });
  p.saas = [...document.querySelectorAll("#preSaas .it-row")].map((row) => {
    const o = {};
    row.querySelectorAll("[data-sa]").forEach((f) => (o[f.dataset.sa] = f.type === "number" ? (f.value === "" ? "" : Number(f.value)) : f.value));
    return o;
  });
}
function onTipoPresuChange(e) {
  leerItemsPresu();
  window._draftPre.tipo = e.target.value;
  document.getElementById("itemsSection").innerHTML = renderPresuItemsSection();
  actualizarTipoHint();
  refrescarTotalesPresu();
}
function actualizarTipoHint() {
  const h = document.getElementById("tipoHint");
  if (!h) return;
  const t = window._draftPre.tipo;
  const req = (PRE_TIPOS[t] || {}).requiereTicket;
  h.innerHTML = req ? "Los presupuestos de servicio nacen de un pedido: vinculá el ticket correspondiente." : "";
}
function refrescarTotalesPresu() {
  if (!window._draftPre) return;
  leerItemsPresu();
  const eco = window._draftPre.economico;
  document.querySelectorAll("#pform [data-path^='economico']").forEach((f) => {
    const k = f.dataset.path.split(".")[1];
    eco[k] = f.type === "checkbox" ? f.checked : f.type === "number" ? (f.value === "" ? "" : Number(f.value)) : f.value;
  });
  const cc = NEXO_PRESUPUESTO.calcPresupuesto(window._draftPre);
  const box = document.getElementById("preTotales");
  if (!box) return;
  const M = cc.moneda;
  box.innerHTML = `<h3>Totales (previsualización)</h3><div class="totales-prev">
    ${cc.hayUnaVez ? `<div><span class="lb">Neto única vez</span><b>${money(cc.netoUnaVez, M)}</b></div>
      <div><span class="lb">IVA ${cc.ivaPct}%</span>${money(cc.ivaUnaVez, M)}</div>
      <div><span class="lb">Total única vez</span><b class="accent">${money(cc.totalUnaVez, M)}</b></div>` : ""}
    ${cc.hayRecurrente ? `<div><span class="lb">Abono mensual neto</span><b>${money(cc.abonoMensualNeto, M)}</b></div>
      <div><span class="lb">Total mensual c/IVA</span><b class="accent">${money(cc.totalMensual, M)}</b></div>` : ""}
    ${!cc.hayUnaVez && !cc.hayRecurrente ? '<div class="muted">Cargá ítems para ver los totales.</div>' : ""}
  </div>`;
}
async function guardarPresu(isNew, id) {
  const p = window._draftPre;
  const prev = isNew ? null : presuPorId(id)?.estado;
  document.querySelectorAll("#pform [data-path]").forEach((f) => {
    let v;
    if (f.type === "checkbox") v = f.checked;
    else if (f.type === "number") v = f.value === "" ? "" : Number(f.value);
    else v = f.value;
    setPath(p, f.dataset.path, v);
  });
  leerItemsPresu();
  // razones sociales
  p.cliente.razonesSociales = [...document.querySelectorAll("#preRazones .rs-row")].map((row) => {
    const o = {};
    row.querySelectorAll("[data-rs]").forEach((f) => (o[f.dataset.rs] = f.value.trim()));
    o.principal = !!row.querySelector('input[type="radio"]')?.checked;
    return o;
  }).filter((r) => r.razonSocial);
  if (p.cliente.razonesSociales.length && !p.cliente.razonesSociales.some((r) => r.principal)) p.cliente.razonesSociales[0].principal = true;
  // denormalizar número de ticket para el documento
  const tk = p.ticketId ? ticketPorId(p.ticketId) : null;
  p.ticketNumero = tk?.numero || "";
  if (!p.cliente.nombreComercial && !p.cliente.razonesSociales.length) { toast("Falta el cliente", true, true); return; }
  if (!p.cliente.nombreComercial && p.cliente.razonesSociales.length) p.cliente.nombreComercial = p.cliente.razonesSociales[0].razonSocial;
  if (!isNew && prev !== p.estado) p.historialEstados.push({ estado: p.estado, fecha: new Date().toISOString().slice(0, 10), usuario: state.user || "—" });
  if (isNew) state.presupuestos.push(p);
  else { const i = state.presupuestos.findIndex((x) => x.id === id); state.presupuestos[i] = p; }
  try {
    await persist(`${isNew ? "Alta" : "Edición"} ${p.numero} · ${p.cliente.nombreComercial}`, "presupuestos");
    // Al vincular un ticket, se lo marca presupuestado y se le ata el N°.
    if (tk && !tk.presupuestoIds.includes(p.id)) {
      tk.presupuestoIds.push(p.id);
      if (tk.estado === "abierto") { tk.estado = "presupuestado"; tk.historial.push({ estado: "presupuestado", fecha: new Date().toISOString().slice(0, 10), usuario: state.user || "—" }); }
      await persist(`Ticket ${tk.numero}: presupuesto ${p.numero}`, "tickets");
    }
    go("presudetalle/" + p.id);
    if (isNew) { toast("Creado ✓ — generando .docx…"); setTimeout(() => generarPresupuestoDocx(p.id), 400); }
    else toast("Guardado ✓");
  } catch (e) { toast("Error: " + e.message, true, true); }
}
// Impresión del presupuesto (misma línea que el contrato)
function generarPresuPDF(id) {
  const p = presuPorId(id);
  if (!p) return;
  const m = NEXO_PRESUPUESTO.construirPresupuesto(p, { plantilla: false });
  document.getElementById("printRoot").innerHTML = renderPresupuestoHTML(m);
  window.print();
}
function renderPresupuestoHTML(m) {
  const filaCli = ([l1, v1, l2, v2]) => (l2 === null && v2 === null)
    ? `<tr><th>${l1}</th><td colspan="3">${v1 ?? "—"}</td></tr>`
    : `<tr><th>${l1}</th><td>${v1 ?? "—"}</td><th>${l2}</th><td>${v2 ?? "—"}</td></tr>`;
  const tablaHTML = (t) => `<table class="items"><thead><tr>${t.head.map((h) => `<th${h.num ? ' class="r"' : ""}>${h.t}</th>`).join("")}</tr></thead>
    <tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => `<td${t.head[i]?.num ? ' class="r"' : ""}>${c.strong ? `<b>${c.t}</b>` : c.t}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${t.head.length}">—</td></tr>`}</tbody></table>`;
  return `
    <style>
      @page { size: A4; margin: 20mm 22mm 27mm 22mm; }
      #printRoot { font-family: var(--body); color:#211c16; font-size:12.5px; line-height:1.5; }
      #printRoot .hd { border-bottom:3px solid #ef8f03; padding-bottom:10px; margin-bottom:16px; break-inside:avoid; }
      #printRoot .hd img { height:30px; width:auto; display:block; margin-bottom:6px; }
      #printRoot .kick { color:#ef8f03; font-weight:700; font-size:11px; letter-spacing:.12em; }
      #printRoot h1 { font-family:var(--head); font-weight:800; color:#ef8f03; font-size:26px; margin:6px 0 4px; break-after:avoid; }
      #printRoot h2 { font-family:var(--head); font-weight:800; color:#645d56; font-size:15px; text-transform:uppercase; letter-spacing:.04em; margin:16px 0 6px; border-bottom:1px solid #e0dacf; padding-bottom:4px; break-after:avoid; break-inside:avoid; }
      #printRoot table { width:100%; border-collapse:collapse; font-size:12px; margin:6px 0; break-inside:auto; }
      #printRoot thead { display:table-header-group; }
      #printRoot tr { break-inside:avoid; }
      #printRoot td, #printRoot th { border:1px solid #d9d3ca; padding:6px 9px; text-align:left; vertical-align:top; }
      #printRoot th { background:#f4f1ec; color:#645d56; font-weight:700; }
      #printRoot table.items thead th { background:#645d56; color:#fff; }
      #printRoot .r { text-align:right; white-space:nowrap; }
      #printRoot table.tot { width:auto; min-width:55%; margin-left:auto; }
      #printRoot table.tot td { border:none; border-bottom:1px solid #eee; padding:5px 9px; }
      #printRoot table.tot td.r { text-align:right; }
      #printRoot table.tot tr.big td { font-weight:800; color:#ef8f03; font-size:14px; border-bottom:2px solid #645d56; }
      #printRoot p.intro { text-align:justify; margin:0 0 10px; }
      #printRoot .cond { font-size:11.5px; color:#645d56; }
      #printRoot .sign { margin-top:36px; display:flex; gap:40px; break-inside:avoid; }
      #printRoot .sign div { flex:1; border-top:1px solid #211c16; padding-top:6px; font-size:11px; }
      #printRoot .foot { margin-top:22px; color:#8c867d; font-size:10.5px; border-top:1px solid #e0dacf; padding-top:8px; break-inside:avoid; }
      #printRoot .foot img { height:18px; vertical-align:middle; margin-left:4px; }
      #printRoot .ph { color:#ef8f03; font-weight:700; }
    </style>
    <div class="hd"><img src="${NEXO_BRAND.logo}" alt="Nexolibre" />
      <div style="color:#8c867d;font-size:12px">Ingeniería médica multimarca · Diagnóstico por imágenes MRI / CT</div></div>
    <div class="kick">${m.kicker}</div>
    <h1>${m.titulo}</h1>
    <p style="color:#8c867d;margin:0 0 10px">${m.subtitulo}</p>
    ${m.filasCliente.length ? `<table>${m.filasCliente.map(filaCli).join("")}</table>` : ""}
    <p class="intro">${m.intro}</p>
    ${m.tabla.rows.length ? `<h2>Detalle</h2>${tablaHTML(m.tabla)}` : ""}
    ${m.saasTabla ? `<h2>Servicios SaaS</h2>${tablaHTML(m.saasTabla)}` : ""}
    <h2>Totales</h2>
    <table class="tot">${m.totales.map(([l, v, big]) => `<tr class="${big ? "big" : ""}"><td>${l}</td><td class="r">${v}</td></tr>`).join("")}</table>
    ${m.condiciones.length ? `<h2>Condiciones comerciales</h2><table class="eco">${m.condiciones.map(([l, v]) => `<tr><th style="width:28%">${l}</th><td class="cond">${v}</td></tr>`).join("")}</table>` : ""}
    ${m.notas ? `<p style="font-size:12px;margin-top:10px"><b>Notas:</b> ${m.notas}</p>` : ""}
    <div class="sign">
      <div><b>Por Nexolibre</b><br>Aclaración / cargo:</div>
      <div><b>Conformidad del Cliente · ${m.firmaCliente}</b><br>Aclaración / cargo:</div>
    </div>
    <div class="foot">${m.pie}${m.plantilla ? ' Los campos <span class="ph">[entre corchetes]</span> se completan al emitir.' : ""}<br>Nexolibre es miembro de <img src="${NEXO_BRAND.grupoNexo}" alt="Grupo Nexo" />.</div>`;
}
function exportarPresuCSV() {
  const rows = state.presupuestos;
  const cols = ["numero", "fecha", "tipo", "estado", "cliente", "razon_social", "ticket", "moneda", "neto_una_vez", "iva", "total_una_vez", "abono_mensual_neto", "total_mensual", "valor_anualizado"];
  const lines = [cols.join(",")];
  for (const p of rows) {
    const cc = NEXO_PRESUPUESTO.calcPresupuesto(p);
    const v = valorPresu(p);
    const vals = [p.numero, p.fecha, (PRE_TIPOS[p.tipo] || {}).label || p.tipo, PRE_ESTADO_LABEL[p.estado],
      p.cliente?.nombreComercial, rsPrincipal(p).razonSocial, p.ticketNumero || "", cc.moneda,
      cc.netoUnaVez, cc.ivaUnaVez, cc.totalUnaVez, cc.abonoMensualNeto, cc.totalMensual, v.anual];
    lines.push(vals.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(","));
  }
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `presupuestos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  toast(`CSV: ${rows.length} presupuestos`);
}

// ============================================================
//  DIRECCIÓN  (KPIs para CEO / COO)
// ============================================================
// Todos los números del tablero de dirección salen de acá, para que reporte
// e informe usen exactamente lo mismo.
function kpisDireccion() {
  const vig = state.data.filter((c) => ACTIVOS.has(c.estado));
  const mrr = vig.reduce((s, c) => s + (Number(c.economico?.canonMensual) || 0), 0);
  const equipos = vig.reduce((s, c) => s + (c.equipos || []).length, 0);

  const abiertos = state.presupuestos.filter((p) => PRE_ABIERTOS.has(p.estado));
  const pipeAnual = abiertos.reduce((s, p) => s + valorPresu(p).anual, 0);
  const pipePond = abiertos.reduce((s, p) => s + valorPresu(p).anual * (PRE_PROB[p.estado] || 0), 0);
  const ganados = state.presupuestos.filter((p) => p.estado === "ganado");
  const perdidos = state.presupuestos.filter((p) => p.estado === "perdido");
  const winRate = ganados.length + perdidos.length ? ganados.length / (ganados.length + perdidos.length) : null;

  // Los montos se agrupan por moneda: sumar USD con ARS daría un número falso.
  // Los tableros muestran la moneda principal (USD) y listan el resto aparte.
  const porTipoMon = {};   // { tipo: { USD: n, ARS: m } }
  for (const p of ganados) {
    const v = valorPresu(p);
    const e = porTipoMon[p.tipo] || (porTipoMon[p.tipo] = {});
    e[v.moneda] = (e[v.moneda] || 0) + v.anual;
  }
  const porTipo = Object.fromEntries(Object.entries(porTipoMon).map(([t, m]) => [t, m.USD || 0]).filter(([, v]) => v));
  const ventasTotal = Object.values(porTipo).reduce((a, b) => a + b, 0);
  const ventasOtrasMonedas = {};
  for (const m of Object.values(porTipoMon)) for (const [mon, v] of Object.entries(m)) if (mon !== "USD") ventasOtrasMonedas[mon] = (ventasOtrasMonedas[mon] || 0) + v;

  const pipePorEtapa = {};
  for (const p of abiertos) { const v = valorPresu(p); if (v.moneda === "USD") pipePorEtapa[p.estado] = (pipePorEtapa[p.estado] || 0) + v.anual; }

  const tkAbiertos = state.tickets.filter((t) => TK_ESTADOS.find((e) => e.id === t.estado)?.grupo === "abierto");
  // Antigüedad promedio de los tickets abiertos (días)
  const hoyN = hoy();
  const edad = tkAbiertos.map((t) => daysUntil(parseDate(t.fecha)) === null ? null : -daysUntil(parseDate(t.fecha))).filter((x) => x != null);
  const edadProm = edad.length ? Math.round(edad.reduce((a, b) => a + b, 0) / edad.length) : null;
  // Tiempo a presupuestar: ticket.fecha → fecha del primer presupuesto vinculado
  const tiempos = [];
  for (const t of state.tickets) {
    const ps = presupuestosDeTicket(t);
    if (!ps.length) continue;
    const prim = ps.map((p) => parseDate(p.fecha)).filter(Boolean).sort((a, b) => a - b)[0];
    const ft = parseDate(t.fecha);
    if (prim && ft) tiempos.push(Math.max(0, Math.round((prim - ft) / 86400000)));
  }
  const tProm = tiempos.length ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length) : null;

  return { vig, mrr, equipos, abiertos, pipeAnual, pipePond, ganados, perdidos, winRate, porTipo, porTipoMon, ventasOtrasMonedas, ventasTotal, pipePorEtapa, tkAbiertos, edadProm, tProm };
}
function barra(label, val, max, sub) {
  const pct = max > 0 ? Math.round((val / max) * 100) : 0;
  return `<div class="bar-row"><div class="bar-lb">${label}<span class="bar-sub">${sub || ""}</span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, pct)}%"></div></div>
    <div class="bar-val">${money(val)}</div></div>`;
}

// ---- Gráficos (SVG vanilla, paleta de marca, sin dependencias) ----
// El taupe #645d56 es el FONDO del tema oscuro: ahí se volvería invisible,
// así que cada tema tiene su propia serie (siempre dentro de la marca).
const CHART_PAL_LIGHT = ["#ef8f03", "#645d56", "#ffa62e", "#b26a00", "#8c867d", "#2e7d5b", "#c9c0b4"];
const CHART_PAL_DARK = ["#ffa62e", "#f4efe6", "#ef8f03", "#ff8a5c", "#c9c0b4", "#8fd6b4", "#a89e90"];
const paleta = () => (document.documentElement.getAttribute("data-theme") === "dark" ? CHART_PAL_DARK : CHART_PAL_LIGHT);
// Monto compacto para etiquetas de gráfico: US$ 36k / US$ 1,2M.
function moneyK(n, m = "USD") {
  const s = m === "USD" ? "US$" : "$";
  const a = Math.abs(Number(n) || 0);
  if (a >= 1e6) return `${s} ${(n / 1e6).toFixed(1).replace(".", ",")}M`;
  if (a >= 1e3) return `${s} ${Math.round(n / 1e3)}k`;
  return money(n, m);
}
// Dona: items = [{label, value, color?, text?}]. `centro` = texto central.
function chartDonut(items, { size = 148, thick = 24, centro = "" } = {}) {
  const data = items.filter((i) => i.value > 0);
  const total = data.reduce((s, i) => s + i.value, 0);
  const r = (size - thick) / 2, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
  if (!total) return `<div class="chart-empty">Sin datos</div>`;
  let off = 0;
  const segs = data.map((i, k) => {
    const len = C * (i.value / total);
    const s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${i.color || paleta()[k % paleta().length]}" stroke-width="${thick}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"><title>${esc(i.label)}: ${i.text || i.value}</title></circle>`;
    off += len; return s;
  }).join("");
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Gráfico de dona">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${thick}"/>${segs}
    ${centro ? `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="Exo" font-weight="800" font-size="${Math.round(size * 0.19)}" fill="var(--ink)">${esc(centro)}</text>` : ""}
  </svg>`;
}
// Leyenda para dona/series.
function chartLegend(items) {
  return `<div class="legend">${items.filter((i) => i.value > 0).map((i, k) =>
    `<span><i style="background:${i.color || paleta()[k % paleta().length]}"></i>${esc(i.label)} <b>${i.text != null ? i.text : i.value}</b></span>`).join("")}</div>`;
}
// Columnas verticales: items = [{label, value, color?, text?}].
function chartColumns(items, { h = 130 } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="cols" style="--ch:${h}px">${items.map((i, k) => `
    <div class="col" title="${esc(i.label)}: ${i.text != null ? i.text : i.value}">
      <div class="col-bar-wrap"><span class="col-val">${i.text != null ? i.text : i.value}</span>
        <div class="col-bar" style="height:${i.value > 0 ? Math.max(3, Math.round(i.value / max * 100)) : 0}%;background:${i.color || "var(--orange)"}"></div></div>
      <div class="col-lb">${esc(i.label)}</div></div>`).join("")}</div>`;
}
// Embudo: stages = [{label, value, text}]. Ancho proporcional al valor.
// El color va del naranja de marca al taupe a medida que avanza la etapa:
// se lee como un solo recorrido, no como categorías sueltas.
const FUNNEL_COLORS = ["#ffc98a", "#ffa62e", "#ef8f03", "#c47404"];
function chartFunnel(stages) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return `<div class="funnel">${stages.map((s, k) => `
    <div class="fn-row"><span class="fn-lb">${esc(s.label)}</span>
      <div class="fn-track">${s.value > 0 ? `<div class="fn-bar" style="width:${Math.max(4, Math.round(s.value / max * 100))}%;background:${FUNNEL_COLORS[k % FUNNEL_COLORS.length]}"></div>` : ""}</div>
      <span class="fn-val">${s.text != null ? s.text : s.value}</span></div>`).join("")}</div>`;
}
// ---- Tablero del área de Presupuestos ----
function renderPTablero() {
  const el = document.getElementById("view-ptablero");
  const k = kpisDireccion();
  const abiertos = state.presupuestos.filter((p) => PRE_ABIERTOS.has(p.estado));
  const pipeTxt = textoMonedas(totalesPorMoneda(abiertos));
  const pond = abiertos.reduce((s, p) => s + valorPresu(p).anual * (PRE_PROB[p.estado] || 0), 0);
  const pondTxt = money(Math.round(pond));
  const vencidos = state.presupuestos.filter(presuVencido).length;
  // Funnel del pipeline por etapa (monto anualizado)
  const etapas = ["borrador", "enviado", "negociacion", "ganado"];
  const stageAmt = (e) => state.presupuestos.filter((p) => p.estado === e).reduce((s, p) => { const v = valorPresu(p); return s + (v.moneda === "USD" ? v.anual : 0); }, 0);
  const funnelData = etapas.map((e) => { const v = stageAmt(e); return { label: PRE_ESTADO_LABEL[e], value: v, text: moneyK(v) }; });
  // Ventas cerradas por tipo (dona)
  const tipoItems = Object.entries(k.porTipo).map(([t, v]) => ({ label: (PRE_TIPOS[t] || {}).label || t, value: v, text: moneyK(v) }));
  // Presupuestos por mes (últimos 6)
  const meses = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const n = state.presupuestos.filter((p) => String(p.fecha || "").slice(0, 7) === key).length;
    meses.push({ label: d.toLocaleDateString("es-AR", { month: "short" }), value: n, text: String(n) });
  }
  // Tickets por estado
  const tkItems = TK_ESTADOS.map((e) => ({ label: e.label, value: state.tickets.filter((t) => t.estado === e.id).length, text: String(state.tickets.filter((t) => t.estado === e.id).length) }));
  el.innerHTML = `
    <div class="kicker">Presupuestos</div>
    <div class="page-head">
      <h1>Tablero de <span class="accent">presupuestos</span></h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" onclick="imprimirDireccion()">📄 Informe imprimible</button>
        <button class="btn sm" onclick="location.hash='presuform/new'">+ Nuevo presupuesto</button>
      </div>
    </div>
    <div class="grid-kpi">
      ${kpi("Presupuestos abiertos", abiertos.length, `${state.presupuestos.length} en total`)}
      ${kpi("Pipeline (anualizado)", pipeTxt, "en juego")}
      ${kpi("Pipeline ponderado", pondTxt || money(0), "por probabilidad")}
      ${kpi("Win-rate", k.winRate == null ? "—" : Math.round(k.winRate * 100) + "%", `${k.ganados.length}✓ / ${k.perdidos.length}✕`, k.winRate != null && k.winRate < 0.4 ? "warn" : "")}
      ${kpi("Validez vencida", vencidos, vencidos ? "rehacer oferta" : "todo vigente", vencidos ? "warn" : "")}
    </div>
    <div class="dir-2col">
      <div class="card"><h3>Pipeline por etapa <span class="muted" style="font-weight:400">· anualizado</span></h3>
        ${funnelData.some((s) => s.value) ? chartFunnel(funnelData) : `<p class="muted">Sin presupuestos cargados.</p>`}</div>
      <div class="card"><h3>Ventas cerradas por tipo <span class="muted" style="font-weight:400">· anualizado, USD</span></h3>
        ${tipoItems.some((i) => i.value) ? `<div class="chart-donut-row">${chartDonut(tipoItems, { centro: moneyK(k.ventasTotal) })}${chartLegend(tipoItems)}</div>` : `<p class="muted">Todavía sin presupuestos ganados.</p>`}
        ${Object.keys(k.ventasOtrasMonedas).length ? `<p class="muted" style="font-size:12.5px;margin:10px 0 0">Además, cerrado en otra moneda: <b>${Object.entries(k.ventasOtrasMonedas).map(([m, v]) => money(Math.round(v), m)).join(" · ")}</b> anualizado (no se suma al gráfico).</p>` : ""}</div>
    </div>
    <div class="dir-2col">
      <div class="card"><h3>Presupuestos por mes <span class="muted" style="font-weight:400">· últimos 6</span></h3>
        ${chartColumns(meses)}</div>
      <div class="card"><h3>Tickets por estado</h3>
        ${state.tickets.length ? chartColumns(tkItems) : `<p class="muted">Sin tickets todavía.</p>`}</div>
    </div>`;
}

// Versión imprimible del tablero de dirección (para pasarle al CEO/COO).
function imprimirDireccion() {
  const k = kpisDireccion();
  const maxTipo = Math.max(1, ...Object.values(k.porTipo));
  const filaTipo = ([t, v]) => `<tr><td>${(PRE_TIPOS[t] || {}).label || t}</td><td class="num">${money(v)}</td><td>${k.ventasTotal ? Math.round(v / k.ventasTotal * 100) : 0}%</td></tr>`;
  document.getElementById("printRoot").innerHTML = `
    <style>
      @page { margin: 16mm 14mm; }
      #printRoot { font-family: var(--body); color:#211c16; font-size:12px; line-height:1.5; }
      #printRoot .hd { border-bottom:3px solid #ef8f03; padding-bottom:10px; margin-bottom:16px; }
      #printRoot .hd img { height:30px; display:block; margin-bottom:6px; }
      #printRoot .kick { color:#ef8f03; font-weight:700; font-size:11px; letter-spacing:.12em; }
      #printRoot h1 { font-family:var(--head); font-weight:800; color:#645d56; font-size:26px; margin:6px 0 2px; }
      #printRoot h2 { font-family:var(--head); font-weight:800; color:#645d56; font-size:14px; text-transform:uppercase; letter-spacing:.05em; margin:22px 0 6px; border-bottom:1px solid #e0dacf; padding-bottom:4px; }
      #printRoot .kpis { display:flex; gap:10px; flex-wrap:wrap; margin:14px 0 4px; }
      #printRoot .k { flex:1; min-width:150px; border:1px solid #d9d3ca; border-radius:14px; padding:12px 14px; background:#f4f1ec; }
      #printRoot .k .lb { font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:#8c867d; font-weight:600; }
      #printRoot .k .vl { font-family:var(--head); font-weight:800; font-size:22px; color:#ef8f03; padding:3px 0; }
      #printRoot .k .sb { font-size:10.5px; color:#8c867d; }
      #printRoot table { width:100%; border-collapse:collapse; font-size:11.5px; margin:4px 0; }
      #printRoot td, #printRoot th { border:1px solid #d9d3ca; padding:6px 8px; text-align:left; }
      #printRoot th { background:#645d56; color:#fff; }
      #printRoot .num { font-weight:700; color:#ef8f03; white-space:nowrap; }
      #printRoot .foot { margin-top:24px; color:#8c867d; font-size:10.5px; border-top:1px solid #e0dacf; padding-top:8px; }
      #printRoot .foot img { height:18px; vertical-align:middle; margin-left:4px; }
    </style>
    <div class="hd"><img src="${NEXO_BRAND.logo}" alt="Nexolibre" /><div style="color:#8c867d;font-size:11.5px">Ingeniería médica multimarca · Diagnóstico por imágenes MRI / CT</div></div>
    <div class="kick">TABLERO DE DIRECCIÓN</div>
    <h1>Indicadores del negocio</h1>
    <p style="color:#8c867d;margin:0">${fmt(new Date())}</p>
    <h2>Recurrente y pipeline</h2>
    <div class="grid-kpi">
      <div class="k"><div class="lb">Contratos vigentes</div><div class="vl">${k.vig.length}</div><div class="sb">${k.equipos} equipos</div></div>
      <div class="k"><div class="lb">MRR</div><div class="vl">${money(k.mrr)}</div><div class="sb">${money(k.mrr * 12)} anual</div></div>
      <div class="k"><div class="lb">Pipeline anualizado</div><div class="vl">${money(k.pipeAnual)}</div><div class="sb">ponderado ${money(Math.round(k.pipePond))}</div></div>
      <div class="k"><div class="lb">Win-rate</div><div class="vl">${k.winRate == null ? "—" : Math.round(k.winRate * 100) + "%"}</div><div class="sb">${k.ganados.length}✓ / ${k.perdidos.length}✕</div></div>
    </div>
    <h2>Ventas cerradas por tipo (anualizado)</h2>
    ${k.ventasTotal ? `<table><thead><tr><th>Tipo</th><th>Monto</th><th>Participación</th></tr></thead><tbody>${Object.entries(k.porTipo).sort((a, b) => b[1] - a[1]).map(filaTipo).join("")}<tr><td><b>Total</b></td><td class="num">${money(k.ventasTotal)}</td><td>100%</td></tr></tbody></table>` : `<p style="color:#8c867d">Sin ventas cerradas.</p>`}
    <h2>Operación · Tickets</h2>
    <div class="grid-kpi">
      <div class="k"><div class="lb">Tickets abiertos</div><div class="vl">${k.tkAbiertos.length}</div><div class="sb">sin cerrar</div></div>
      <div class="k"><div class="lb">Antigüedad prom.</div><div class="vl">${k.edadProm == null ? "—" : k.edadProm + " d"}</div><div class="sb">tickets abiertos</div></div>
      <div class="k"><div class="lb">Tiempo a presupuestar</div><div class="vl">${k.tProm == null ? "—" : k.tProm + " d"}</div><div class="sb">pedido → cotización</div></div>
    </div>
    <div class="foot"><b>Documento de circulación interna.</b> Generado desde el sistema de gestión de Nexolibre. Importes netos de IVA. Nexolibre es miembro de <img src="${NEXO_BRAND.grupoNexo}" alt="Grupo Nexo" />.</div>`;
  window.print();
}

// ============================================================
//  REPORTES  (constructor de consultas / simulaciones)
// ============================================================
const REP = { desde: "", hasta: "", tipo: "", estado: "", moneda: "", cliente: "", agrupar: "tipo" };
function reporteFiltrado() {
  return state.presupuestos.filter((p) => {
    if (REP.tipo && p.tipo !== REP.tipo) return false;
    if (REP.estado && p.estado !== REP.estado) return false;
    if (REP.moneda && (p.economico?.moneda || "USD") !== REP.moneda) return false;
    if (REP.desde && String(p.fecha) < REP.desde) return false;
    if (REP.hasta && String(p.fecha) > REP.hasta) return false;
    if (REP.cliente && !((p.cliente?.nombreComercial || "").toLowerCase().includes(REP.cliente.toLowerCase()))) return false;
    return true;
  });
}
function reporteGrupos(rows) {
  const clave = (p) => {
    if (REP.agrupar === "tipo") return (PRE_TIPOS[p.tipo] || {}).label || p.tipo;
    if (REP.agrupar === "estado") return PRE_ESTADO_LABEL[p.estado] || p.estado;
    if (REP.agrupar === "cliente") return p.cliente?.nombreComercial || "—";
    if (REP.agrupar === "mes") return String(p.fecha || "").slice(0, 7) || "—";
    return "Total";
  };
  const g = {};
  for (const p of rows) {
    const key = clave(p);
    const v = valorPresu(p);
    const e = g[key] || (g[key] = { key, n: 0, cur: {} });
    e.n++;
    const c = e.cur[v.moneda] || (e.cur[v.moneda] = { n: 0, unaVez: 0, mensual: 0, anual: 0 });
    c.n++; c.unaVez += v.unaVez; c.mensual += v.mensual; c.anual += v.anual;
  }
  // Cada grupo puede tener varias monedas: se muestran sin sumarlas entre sí.
  return Object.values(g).map((e) => {
    const curs = Object.keys(e.cur);
    const txt = (f) => curs.length === 1 ? money(e.cur[curs[0]][f], curs[0]) : textoMonedas(Object.fromEntries(curs.map((k) => [k, e.cur[k][f]])));
    return { key: e.key, n: e.n, cur: e.cur, curs, unaVezTxt: txt("unaVez"), mensualTxt: txt("mensual"), anualTxt: txt("anual"), _ord: (e.cur.USD?.anual || 0) + curs.reduce((s, k) => s + e.cur[k].anual, 0) };
  }).sort((a, b) => b._ord - a._ord);
}
function renderReportes() {
  const el = document.getElementById("view-reportes");
  const rows = reporteFiltrado();
  const grupos = reporteGrupos(rows);
  const totN = rows.length;
  const totUna = totalesPorMoneda(rows, "unaVez"), totMen = totalesPorMoneda(rows, "mensual"), totAnu = totalesPorMoneda(rows, "anual");
  const monedas = [...new Set(rows.map((p) => valorPresu(p).moneda))];
  const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`;
  el.innerHTML = `
    <div class="kicker">Consultas</div>
    <div class="page-head">
      <h1>Generador de <span class="accent">reportes</span></h1>
      <div style="display:flex;gap:8px">
        <button class="btn sm" onclick="exportarReporteCSV()">⬇ CSV</button>
        <button class="btn primary sm" onclick="imprimirReporte()">📄 Imprimir</button>
      </div>
    </div>
    <p class="muted" style="margin-top:-6px">Combiná filtros y una agrupación para simular cualquier corte sobre los presupuestos.</p>
    <div class="card">
      <div class="rep-filtros">
        <div class="field"><label>Desde</label><input type="date" id="rDesde" value="${REP.desde}"></div>
        <div class="field"><label>Hasta</label><input type="date" id="rHasta" value="${REP.hasta}"></div>
        <div class="field"><label>Tipo</label><select id="rTipo"><option value="">Todos</option>${Object.entries(PRE_TIPOS).map(([k, v]) => opt(k, v.label, REP.tipo)).join("")}</select></div>
        <div class="field"><label>Estado</label><select id="rEstado"><option value="">Todos</option>${PRE_ESTADOS.map((e) => opt(e.id, e.label, REP.estado)).join("")}</select></div>
        <div class="field"><label>Moneda</label><select id="rMoneda"><option value="">Todas</option>${opt("USD", "USD", REP.moneda)}${opt("ARS", "ARS", REP.moneda)}</select></div>
        <div class="field"><label>Cliente</label><input type="search" id="rCliente" value="${esc(REP.cliente)}" placeholder="contiene…"></div>
        <div class="field"><label>Agrupar por</label><select id="rAgrupar">${opt("tipo", "Tipo", REP.agrupar)}${opt("estado", "Estado", REP.agrupar)}${opt("cliente", "Cliente", REP.agrupar)}${opt("mes", "Mes", REP.agrupar)}${opt("ninguno", "Sin agrupar", REP.agrupar)}</select></div>
        <button class="btn ghost sm" onclick="limpiarReporte()" style="align-self:flex-end">Limpiar</button>
      </div>
    </div>
    <div class="grid-kpi" style="margin-top:14px">
      ${kpi("Presupuestos", totN, "en el corte")}
      ${kpi("Única vez (neto)", textoMonedas(totUna), "suma del corte")}
      ${kpi("Mensual (neto)", textoMonedas(totMen), "recurrente")}
      ${kpi("Anualizado", textoMonedas(totAnu), "única vez + 12× mensual")}
    </div>
    ${monedas.length > 1 ? `<p class="muted" style="font-size:12.5px;margin:8px 0 0">⚠ El corte mezcla ${monedas.join(" y ")}: los totales se muestran separados por moneda (no se suman entre sí). Filtrá por moneda para un único total.</p>` : ""}
    <div class="overflow"><table class="data">
      <thead><tr><th>${REP.agrupar === "ninguno" ? "Presupuesto" : "Grupo"}</th><th>Cant.</th><th>Única vez</th><th>Mensual</th><th>Anualizado</th></tr></thead>
      <tbody>${REP.agrupar === "ninguno"
        ? (rows.length ? rows.map((p) => { const v = valorPresu(p); return `<tr onclick="location.hash='presudetalle/${p.id}'"><td><b>${esc(p.numero)}</b> · ${esc(p.cliente?.nombreComercial || "")}</td><td>1</td><td>${money(v.unaVez, v.moneda)}</td><td>${money(v.mensual, v.moneda)}</td><td>${money(v.anual, v.moneda)}</td></tr>`; }).join("") : `<tr><td colspan="5" class="empty">Sin resultados</td></tr>`)
        : (grupos.length ? grupos.map((g) => `<tr><td><b>${esc(g.key)}</b></td><td>${g.n}</td><td>${g.unaVezTxt}</td><td>${g.mensualTxt}</td><td>${g.anualTxt}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">Sin resultados</td></tr>`)}
      </tbody>
      <tfoot><tr><th>Total</th><th>${totN}</th><th>${textoMonedas(totUna)}</th><th>${textoMonedas(totMen)}</th><th>${textoMonedas(totAnu)}</th></tr></tfoot>
    </table></div>`;
  const bind = (id, key) => { const e = document.getElementById(id); e.oninput = e.onchange = () => { REP[key] = e.value; renderReportes(); }; };
  bind("rDesde", "desde"); bind("rHasta", "hasta"); bind("rTipo", "tipo"); bind("rEstado", "estado");
  bind("rMoneda", "moneda"); bind("rCliente", "cliente"); bind("rAgrupar", "agrupar");
}
function limpiarReporte() { Object.assign(REP, { desde: "", hasta: "", tipo: "", estado: "", moneda: "", cliente: "", agrupar: "tipo" }); renderReportes(); }
function exportarReporteCSV() {
  const grupos = reporteGrupos(reporteFiltrado());
  const lines = ["grupo,moneda,cantidad,una_vez_neto,mensual_neto,anualizado"];
  grupos.forEach((g) => g.curs.forEach((cur) => { const c = g.cur[cur]; lines.push([`"${g.key}"`, cur, c.n, c.unaVez, c.mensual, c.anual].join(",")); }));
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `reporte-presupuestos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  toast("Reporte exportado");
}
function imprimirReporte() {
  const rows = reporteFiltrado();
  const grupos = reporteGrupos(rows);
  const totN = rows.length;
  const totUna = totalesPorMoneda(rows, "unaVez"), totMen = totalesPorMoneda(rows, "mensual"), totAnu = totalesPorMoneda(rows, "anual");
  const agLabel = { tipo: "Tipo", estado: "Estado", cliente: "Cliente", mes: "Mes", ninguno: "Sin agrupar" }[REP.agrupar];
  const filtrosTxt = [REP.desde && `desde ${REP.desde}`, REP.hasta && `hasta ${REP.hasta}`, REP.tipo && `tipo ${(PRE_TIPOS[REP.tipo] || {}).label}`, REP.estado && `estado ${PRE_ESTADO_LABEL[REP.estado]}`, REP.moneda && REP.moneda, REP.cliente && `cliente «${REP.cliente}»`].filter(Boolean).join(" · ") || "sin filtros";
  document.getElementById("printRoot").innerHTML = `
    <style>
      @page { margin: 16mm 14mm; }
      #printRoot { font-family: var(--body); color:#211c16; font-size:12px; }
      #printRoot .hd { border-bottom:3px solid #ef8f03; padding-bottom:10px; margin-bottom:14px; }
      #printRoot .hd img { height:28px; display:block; margin-bottom:6px; }
      #printRoot .kick { color:#ef8f03; font-weight:700; font-size:11px; letter-spacing:.12em; }
      #printRoot h1 { font-family:var(--head); font-weight:800; color:#645d56; font-size:24px; margin:6px 0 2px; }
      #printRoot table { width:100%; border-collapse:collapse; font-size:11.5px; margin:8px 0; }
      #printRoot td, #printRoot th { border:1px solid #d9d3ca; padding:6px 8px; text-align:left; }
      #printRoot th { background:#645d56; color:#fff; }
      #printRoot tfoot th { background:#f4f1ec; color:#211c16; }
      #printRoot .num { text-align:right; white-space:nowrap; }
      #printRoot .foot { margin-top:20px; color:#8c867d; font-size:10.5px; border-top:1px solid #e0dacf; padding-top:8px; }
      #printRoot .foot img { height:18px; vertical-align:middle; margin-left:4px; }
    </style>
    <div class="hd"><img src="${NEXO_BRAND.logo}" alt="Nexolibre" /><div style="color:#8c867d;font-size:11.5px">Ingeniería médica multimarca · Diagnóstico por imágenes MRI / CT</div></div>
    <div class="kick">REPORTE DE PRESUPUESTOS</div>
    <h1>Reporte por ${agLabel.toLowerCase()}</h1>
    <p style="color:#8c867d;margin:0">${fmt(new Date())} · Filtros: ${esc(filtrosTxt)}</p>
    <table><thead><tr><th>${agLabel}</th><th class="num">Cant.</th><th class="num">Única vez</th><th class="num">Mensual</th><th class="num">Anualizado</th></tr></thead>
    <tbody>${grupos.map((g) => `<tr><td>${esc(g.key)}</td><td class="num">${g.n}</td><td class="num">${g.unaVezTxt}</td><td class="num">${g.mensualTxt}</td><td class="num">${g.anualTxt}</td></tr>`).join("")}</tbody>
    <tfoot><tr><th>Total</th><th class="num">${totN}</th><th class="num">${textoMonedas(totUna)}</th><th class="num">${textoMonedas(totMen)}</th><th class="num">${textoMonedas(totAnu)}</th></tr></tfoot></table>
    <div class="foot"><b>Documento de circulación interna.</b> Importes netos de IVA. Nexolibre es miembro de <img src="${NEXO_BRAND.grupoNexo}" alt="Grupo Nexo" />.</div>`;
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
  registrarAjuste, regularizarAjustes, calcAjuste, calcAjustePct,
});

// Si el arranque falla, el error tiene que verse completo y la aplicación
// tiene que quedar usable. Una promesa rechazada sin capturar deja la pantalla
// a medio dibujar y un mensaje truncado en la consola.
init().catch((e) => {
  console.error("Fallo en el arranque:", e);
  try {
    document.getElementById("view-dashboard")?.classList.add("active");
    toast("Error al iniciar: " + e.message, true, true);
  } catch (_) { /* si ni esto anda, ya quedó en la consola */ }
});
