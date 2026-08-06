/* ============================================================
   Nexolibre · Plataforma de contratos — lógica de la SPA
   ============================================================ */
const CFG = window.NEXO_CONFIG;
// Núcleo v3. Las métricas y el redondeo monetario viven ahí: tener dos
// implementaciones de la misma cuenta garantiza que diverjan.
const NKPI = window.NEXO_KPI;
const NEXO_ESQUEMA = window.NEXO_ESQUEMA;
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
  propuestas: [], propuestasSha: null,
  clientes: [], clientesSha: null,
  vendedores: [], vendedoresSha: null,
  acuerdosComision: [], acuerdosSha: null,
  comisiones: [], comisionesSha: null,
  rol: "admin",      // sin servidor el rol es preferencia de interfaz, no permiso real
  // País activo en los tableros. "" = consolidado. Cada país tiene su moneda,
  // sus impuestos y sus acuerdos, así que el corte por país no es cosmético:
  // cambia el significado de casi todos los números.
  paisActivo: "",
  user: localStorage.getItem(LS.user) || "",
  ws: "contratos", // área de trabajo activa: 'contratos' | 'presupuestos'
  selected: new Set(),
  filtro: { q: "", estado: "", modalidad: "" },
  filtroPre: { q: "", estado: "", tipo: "", pais: "", mes: "", pagina: 1 },
  filtroTk: { q: "", estado: "", pais: "", mes: "", pagina: 1 },
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

// El símbolo sale del núcleo. La versión anterior mostraba TODO lo que no era
// USD como "$": con cinco países operando, ARS, CLP, COP y UYU se verían
// idénticos y no habría forma de saber qué moneda se está mirando.
const money = (n, m = "USD") => (n || n === 0
  ? `${NKPI.SIMBOLO[m] || m} ${Number(n).toLocaleString("es-AR")}` : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
