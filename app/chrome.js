/**
 * Arranque, router, navegación, tema claro/oscuro y alertas.
 *
 * Parte de la aplicación, dividida por dominio. Todos los archivos de
 * app/ comparten el ámbito global: se cargan en orden y las constantes
 * declaradas antes son visibles después. El orden importa.
 */

async function init() {
  bindChrome();
  const pat = localStorage.getItem(LS.pat);
  if (pat) {
    try {
      state.mode = "connected";
      await cargarDesdeRepositorio();
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
  contratos: [["dashboard", "Tablero"], ["pipeline", "Pipeline"], ["propuestas", "Propuestas"],
    ["listado", "Contratos"], ["agenda", "Vencimientos"]],
  presupuestos: [["ptablero", "Tablero"], ["presupuestos", "Presupuestos"], ["tickets", "Tickets"], ["facturacion", "Facturación"], ["reportes", "Reportes"]],
  marketing: [["mktablero", "Tablero"], ["campanas", "Campañas"], ["leads", "Leads"], ["canales", "Canales"]],
  equipo: [["vendedores", "Vendedores"], ["comisiones", "Comisiones"]],
};
// A qué área pertenece cada vista/ruta.
const VIEW_WS = {
  dashboard: "contratos", listado: "contratos", agenda: "contratos", detalle: "contratos", form: "contratos", pipeline: "contratos",
  propuestas: "contratos", propdetalle: "contratos", propform: "contratos",
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
