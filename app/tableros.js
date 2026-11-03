/**
 * Tableros y reportes: KPIs de dirección, gráficos SVG, tablero de
 * presupuestos, reportes, acceso y avisos.
 *
 * Parte de la aplicación, dividida por dominio. Todos los archivos de
 * app/ comparten el ámbito global: se cargan en orden y las constantes
 * declaradas antes son visibles después. El orden importa.
 */

function porPaisActivo(lista, leerPais) {
  if (!state.paisActivo) return lista;
  const leer = leerPais || ((r) => r.pais || "AR");
  return (lista || []).filter((r) => leer(r) === state.paisActivo);
}

/** Barra de países para los tableros. */
function barraPais() {
  return `<div class="table-tools" style="margin:0 0 16px">
    ${NEXO_TABLA.selectorPais(state.paisActivo, "elegirPais")}
    ${state.paisActivo ? `<span class="muted" style="font-size:13px">Mostrando solo ${
      NEXO_ESQUEMA.PAIS_NOMBRE[state.paisActivo]} · moneda, impuestos y acuerdos propios</span>`
      : `<span class="muted" style="font-size:13px">Consolidado de todos los países</span>`}
  </div>`;
}

function elegirPais(p) {
  state.paisActivo = p;
  router();
}

function kpisDireccion() {
  const vig = porPaisActivo(state.data).filter((c) => ACTIVOS.has(c.estado));
  const mrr = vig.reduce((s, c) => s + (Number(c.economico?.canonMensual) || 0), 0);
  const equipos = vig.reduce((s, c) => s + (c.equipos || []).length, 0);

  const abiertos = porPaisActivo(state.presupuestos).filter((p) => PRE_ABIERTOS.has(p.estado));
  const pipeAnual = abiertos.reduce((s, p) => s + valorPresu(p).anual, 0);
  const pipePond = abiertos.reduce((s, p) => s + valorPresu(p).anual * (PRE_PROB[p.estado] || 0), 0);
  const ganados = porPaisActivo(state.presupuestos).filter((p) => p.estado === "ganado");
  const perdidos = porPaisActivo(state.presupuestos).filter((p) => p.estado === "perdido");
  // El win rate lo calcula el núcleo: la división segura, el denominador sobre
  // resueltos y el null cuando no hay muestra están definidos en un solo lugar.
  const winRatePct = NKPI.pct(ganados.length, ganados.length + perdidos.length);
  const winRate = winRatePct === null ? null : winRatePct / 100;

  // Los montos se agrupan por moneda: sumar USD con ARS daría un número falso.
  // Los tableros muestran la moneda principal (USD) y listan el resto aparte.
  const porTipoMon = {};   // { tipo: { USD: n, ARS: m } }
  for (const p of ganados) {
    const v = valorPresu(p);
    const e = porTipoMon[p.tipo] || (porTipoMon[p.tipo] = {});
    e[v.moneda] = NEXO_ESQUEMA.money((e[v.moneda] || 0) + v.anual);
  }
  const porTipo = Object.fromEntries(Object.entries(porTipoMon).map(([t, m]) => [t, m.USD || 0]).filter(([, v]) => v));
  const ventasTotal = Object.values(porTipo).reduce((a, b) => a + b, 0);
  const ventasOtrasMonedas = {};
  for (const m of Object.values(porTipoMon)) for (const [mon, v] of Object.entries(m)) if (mon !== "USD") ventasOtrasMonedas[mon] = (ventasOtrasMonedas[mon] || 0) + v;

  const pipePorEtapa = {};
  for (const p of abiertos) { const v = valorPresu(p); if (v.moneda === "USD") pipePorEtapa[p.estado] = (pipePorEtapa[p.estado] || 0) + v.anual; }

  const tkAbiertos = porPaisActivo(state.tickets).filter((t) => TK_ESTADOS.find((e) => e.id === t.estado)?.grupo === "abierto");
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
  // Todo el tablero se calcula sobre el país activo: mezclar países junta
  // monedas, impuestos y acuerdos distintos en un mismo número.
  const presus = porPaisActivo(state.presupuestos);
  const abiertos = presus.filter((p) => PRE_ABIERTOS.has(p.estado));
  const pipeTxt = textoMonedas(totalesPorMoneda(abiertos));
  const pond = abiertos.reduce((s, p) => s + valorPresu(p).anual * (PRE_PROB[p.estado] || 0), 0);
  const pondTxt = money(Math.round(pond));
  const vencidos = presus.filter(presuVencido).length;
  // Funnel del pipeline por etapa (monto anualizado)
  const etapas = ["borrador", "enviado", "negociacion", "ganado"];
  const stageAmt = (e) => presus.filter((p) => p.estado === e).reduce((s, p) => { const v = valorPresu(p); return s + (v.moneda === "USD" ? v.anual : 0); }, 0);
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
    ${barraPais()}
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
  irPaginaPre, limpiarFiltroPre, irPaginaTk, limpiarFiltroTk, exportarTicketsCSV,
  elegirPais, porPaisActivo,
  // `go` es un const de chrome.js: los const de nivel superior no quedan en
  // window, así que los módulos de vistas/ que llamaban global.go() fallaban
  // después de guardar y la pantalla quedaba en el formulario.
  go,
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
