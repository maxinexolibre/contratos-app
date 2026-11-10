/**
 * Área de Presupuestos: listado, detalle, formulario, ítems, estados
 * y generación de documentos.
 *
 * Parte de la aplicación, dividida por dominio. Todos los archivos de
 * app/ comparten el ámbito global: se cargan en orden y las constantes
 * declaradas antes son visibles después. El orden importa.
 */

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
  for (const p of lista) {
    const v = valorPresu(p);
    out[v.moneda] = NEXO_ESQUEMA.money((out[v.moneda] || 0) + (v[campo] || 0));
  }
  return out; // { USD: n, ARS: m }
}
// Texto de un mapa {moneda: monto} para mostrar sin mezclar.
const textoMonedas = (m) => Object.entries(m).filter(([, v]) => v).map(([mon, v]) => money(v, mon)).join(" · ") || money(0);

/** Días desde el envío de un presupuesto que espera respuesta, o null. */
const diasSinRespuesta = (p) => NEXO_KPI.seguimiento(p)?.dias ?? null;
const requiereSeguimiento = (p) => !!NEXO_KPI.seguimiento(p)?.atrasado;

/** Filas de presupuestos que pasan el filtro activo, ya ordenadas. */
function presupuestosFiltrados() {
  // "Seguimiento" no es un estado: son los enviados que pasaron el plazo en
  // que el cliente suele decidir. Se filtra aparte y el resto del filtro sigue.
  const f = { ...state.filtroPre };
  let base = state.presupuestos;
  if (f.estado === "seguimiento") { base = base.filter(requiereSeguimiento); f.estado = ""; }
  return NEXO_TABLA.filtrar(base, f, {
    texto: (p) => `${p.numero} ${p.cliente?.nombreComercial || ""} ${p.titulo || ""} ` +
      (p.cliente?.razonesSociales || []).map((r) => r.razonSocial).join(" "),
    pais: (p) => p.pais || "AR",
  }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

function renderPresupuestos() {
  const el = document.getElementById("view-presupuestos");
  const rows = presupuestosFiltrados();
  const pag = NEXO_TABLA.paginar(rows, state.filtroPre.pagina || 1);

  // Los totales se calculan sobre lo FILTRADO, no sobre todo: un total que
  // ignora el filtro contradice lo que se está viendo en la tabla.
  const abiertos = rows.filter((p) => PRE_ABIERTOS.has(p.estado));
  const pipe = textoMonedas(totalesPorMoneda(abiertos));
  const meses = NEXO_TABLA.mesesDisponibles(state.presupuestos);

  el.innerHTML = `
    <div class="kicker">Cotizaciones</div>
    <div class="page-head">
      <h1>Todos los <span class="accent">presupuestos</span></h1>
      <div style="display:flex;gap:8px">
        <button class="btn sm" onclick="exportarPresuCSV()">⬇ CSV</button>
        ${state.soloLectura ? "" : `<button class="btn sm" onclick="location.hash='presuimportar'" title="Trae la planilla de Excel del área comercial">⬆ Importar planilla</button>`}
        ${state.soloLectura ? "" : `<button class="btn primary sm" onclick="location.hash='presuform/new'">+ Nuevo</button>`}
      </div>
    </div>
    <div class="table-tools">
      <input type="search" id="pq" placeholder="Buscar cliente, N° o título…" value="${esc(state.filtroPre.q)}" />
      <select id="pfe"><option value="">Todos los estados</option><option value="seguimiento" ${state.filtroPre.estado === "seguimiento" ? "selected" : ""}>⚠ Requieren seguimiento</option>${PRE_ESTADOS.filter((e) => e.id !== "negociacion" || state.presupuestos.some((p) => p.estado === "negociacion")).map((e) => `<option value="${e.id}" ${state.filtroPre.estado === e.id ? "selected" : ""}>${e.label}</option>`).join("")}</select>
      <select id="pft"><option value="">Todo tipo</option>${Object.entries(PRE_TIPOS).map(([k, v]) => `<option value="${k}" ${state.filtroPre.tipo === k ? "selected" : ""}>${v.label}</option>`).join("")}</select>
      <select id="pfp"><option value="">Todos los países</option>${NEXO_ESQUEMA.PAIS.map((c) => `<option value="${c}" ${state.filtroPre.pais === c ? "selected" : ""}>${NEXO_ESQUEMA.PAIS_NOMBRE[c]}</option>`).join("")}</select>
      <select id="pfm"><option value="">Todos los meses</option>${meses.map((m) => `<option value="${m}" ${state.filtroPre.mes === m ? "selected" : ""}>${NEXO_TABLA.etiquetaMes(m)}</option>`).join("")}</select>
      ${NEXO_TABLA.hayFiltro(state.filtroPre) ? `<button class="btn sm ghost" onclick="limpiarFiltroPre()">✕ Limpiar</button>` : ""}
      <span class="muted" style="font-size:13px">${abiertos.length} abiertos · ${pipe} anualizado en juego${(() => { const n = state.presupuestos.filter(requiereSeguimiento).length; return n ? ` · <a href="#" onclick="state.filtroPre.estado='seguimiento';state.filtroPre.pagina=1;renderPresupuestos();return false">${n} requieren seguimiento</a>` : ""; })()}</span>
    </div>
    <div class="overflow"><table class="data">
      <thead><tr><th>N°</th><th>Fecha</th><th>País</th><th>Cliente</th><th>Tipo</th><th>Estado</th><th>Total</th></tr></thead>
      <tbody>${pag.filas.map(presuRow).join("") || `<tr><td colspan="7" class="empty">${
        NEXO_TABLA.hayFiltro(state.filtroPre) ? "Ningún presupuesto coincide con el filtro." : "Sin presupuestos todavía."}</td></tr>`}</tbody>
    </table></div>
    ${NEXO_TABLA.pie(pag, "irPaginaPre")}`;

  const cambia = (id, campo) => {
    const e = document.getElementById(id);
    if (!e) return;
    const ev = e.tagName === "INPUT" ? "oninput" : "onchange";
    e[ev] = (x) => { state.filtroPre[campo] = x.target.value; state.filtroPre.pagina = 1; redibujarConFoco(renderPresupuestos); };
  };
  cambia("pq", "q"); cambia("pfe", "estado"); cambia("pft", "tipo");
  cambia("pfp", "pais"); cambia("pfm", "mes");
}
function irPaginaPre(n) { state.filtroPre.pagina = n; renderPresupuestos(); window.scrollTo(0, 0); }
function limpiarFiltroPre() { state.filtroPre = { q: "", estado: "", tipo: "", pais: "", mes: "", pagina: 1 }; renderPresupuestos(); }

function presuRow(p) {
  const v = valorPresu(p);
  const totalTxt = v.mensual && v.unaVez ? `${money(v.unaVez, v.moneda)} + ${money(v.mensual, v.moneda)}/mes`
    : v.mensual ? `${money(v.mensual, v.moneda)}/mes` : money(v.unaVez, v.moneda);
  return `<tr onclick="location.hash='presudetalle/${p.id}'">
    <td><b>${esc(p.numero)}</b></td>
    <td>${fmt(p.fecha)}</td>
    <td><span class="pill">${esc(p.pais || "AR")}</span></td>
    <td><b>${esc(p.cliente?.nombreComercial || "—")}</b>${p.titulo ? `<br><span class="muted" style="font-size:12px">${esc(p.titulo.slice(0, 62))}${p.titulo.length > 62 ? "…" : ""}</span>` : ""}</td>
    <td>${esc((PRE_TIPOS[p.tipo] || {}).label || p.tipo)}${p.subtipo ? `<br><span class="muted" style="font-size:12px">${esc(PRE_SUBTIPOS[p.subtipo] || p.subtipo)}</span>` : ""}</td>
    <td><span class="badge ${p.estado}">${PRE_ESTADO_LABEL[p.estado]}</span>${requiereSeguimiento(p) ? ` <span class="badge vencida" title="Pasó el plazo en que el cliente suele decidir">${diasSinRespuesta(p)} días sin respuesta</span>` : ""}</td>
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
        <button class="btn sm primary" onclick="verDocumento('presupuesto','${p.id}')">👁 Ver documento</button>
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
            <dt>Vendedor</dt><dd>${esc(nombreVendedor(p.vendedorId) || "Venta directa")}</dd>
            <dt>Enviado</dt><dd>${p.fechaEnvio ? fmt(p.fechaEnvio) : "—"}${diasSinRespuesta(p) != null ? ` · ${diasSinRespuesta(p)} días sin respuesta` : ""}</dd>
            ${p.estado === "anulado" ? `<dt>Motivo de anulación</dt><dd>${esc(p.motivoAnulacion || "—")}</dd>` : ""}
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
  if (m.notas.length) {
    html += `<h4 style="margin:12px 0 4px;color:var(--taupe)">Notas</h4><ul style="margin:0;padding-left:18px;font-size:13px">${m.notas.map((n) => `<li>${n}</li>`).join("")}</ul>`;
  }
  if (m.garantia) {
    html += `<h4 style="margin:12px 0 4px;color:var(--taupe)">Garantía · ${m.garantia.plazo}</h4>`;
    html += m.garantia.libre
      ? `<p style="font-size:13px;margin:0">${m.garantia.libre}</p>`
      : `<div class="overflow"><table class="data"><tbody>${m.garantia.puntos.map(([l, v]) => `<tr><th style="width:26%;text-align:left">${l}</th><td>${v}</td></tr>`).join("")}</tbody></table></div>`;
  }
  return html;
}
function estadoPresuBtns(p) {
  // El área no usa la etapa "negociación": un presupuesto sale y se aprueba,
  // se rechaza o se anula. Los viejos en negociación siguen pudiendo cerrarse.
  const b = [];
  if (p.estado === "borrador") b.push(`<button class="btn primary sm" onclick="cambiarEstadoPresu('${p.id}','enviado')">→ Enviado</button>`);
  if (p.estado === "enviado" || p.estado === "negociacion") {
    b.push(`<button class="btn primary sm" onclick="cambiarEstadoPresu('${p.id}','ganado')">✓ Aprobado</button>`);
    b.push(`<button class="btn sm danger" onclick="cambiarEstadoPresu('${p.id}','perdido')">✕ Rechazado</button>`);
  }
  if (PRE_ABIERTOS.has(p.estado)) b.push(`<button class="btn sm ghost" onclick="cambiarEstadoPresu('${p.id}','anulado')" title="Reemplazado por otra versión, equipo dado de baja o cargado por error">⊘ Anular</button>`);
  return b.join("");
}
async function cambiarEstadoPresu(id, nuevo) {
  const p = presuPorId(id);
  if (!p) return;
  let motivo = "";
  if (nuevo === "anulado") {
    motivo = (prompt("¿Por qué se anula? (ej.: reemplazado por P2026…, equipo dado de baja)") || "").trim();
    if (!motivo) return;
  }
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
  if (nuevo === "anulado") p.motivoAnulacion = motivo;
  // El seguimiento se mide desde el envío, no desde la emisión.
  if (nuevo === "enviado" && !p.fechaEnvio) p.fechaEnvio = new Date().toISOString().slice(0, 10);
  p.historialEstados = p.historialEstados || [];
  p.historialEstados.push({ estado: nuevo, fecha: new Date().toISOString().slice(0, 10), usuario: state.user || "—" });
  try {
    await persist(`Presupuesto ${p.numero} → ${nuevo}`, "presupuestos", p);
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
  // El SaaS ya no se cotiza por presupuesto: tiene documento propio. Un ticket
  // de ese tipo cae en "servicio" para no dejar el alta sin tipo válido.
  const tipoDeTk = { servicio: "servicio", parte: "venta", equipo: "venta", saas: "servicio" };
  return {
    id: "pre_" + Date.now(), numero: proxNumeroPresu(), tipo: tk ? (tipoDeTk[tk.tipoPedido] || "servicio") : "servicio",
    estado: "borrador", fecha: d, ticketId: tk?.id || "", ticketNumero: tk?.numero || "",
    subtipo: "", titulo: tk?.descripcion || "",
    cliente: tk ? structuredClone(tk.cliente) : { nombreComercial: "", razonesSociales: [{ razonSocial: "", cuit: "", domicilio: "", principal: true }], contacto: "", localidad: "", provincia: "" },
    items: [],
    garantia: { aplica: true, dias: 90, texto: "" },
    economico: { moneda: "USD", ivaPct: 21, incluyeIVA: false, validezDias: 15, formaPago: "", descuentoPct: 0, recurrencia: "unica" },
    notas: "", archivos: [], usuario: state.user || "—", historialEstados: [{ estado: "borrador", fecha: d, usuario: state.user || "—" }],
  };
}
/** Opciones del selector de vendedor: vacío = venta directa de la dirección. */
function opcionesVendedor(actual) {
  const activos = (state.vendedores || []).filter((v) => v.estado !== "Inactivo" || v.id === actual);
  return [["", "— Venta directa (sin vendedor) —"], ...activos.map((v) => [v.id, `${v.nombre}${v.pais ? " · " + v.pais : ""}`])];
}
const nombreVendedor = (id) => (state.vendedores || []).find((v) => v.id === id)?.nombre || "";

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
        ${sel("Vendedor", "vendedorId", p.vendedorId || "", opcionesVendedor(p.vendedorId))}
        ${inp("Fecha de envío al cliente", "fechaEnvio", p.fechaEnvio || "", "", "date")}
      </div>
      ${inp("Título del presupuesto", "titulo", p.titulo, "full")}
      ${sel("País de la operación", "pais", p.pais || "AR", Object.entries(NEXO_ESQUEMA.PAIS_NOMBRE))}
      ${sel("Condición de IVA", "condicionIVA", p.condicionIVA || "Gravado", NEXO_ESQUEMA.CONDICION_IVA.map((c) => [c, ({Gravado: "Gravado · IVA se suma", Exento: "Exento · sin IVA", IncluidoEnPrecio: "IVA incluido en el precio", NoGravado: "No gravado"})[c]]))}
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
        ${sel("Moneda", "economico.moneda", eco.moneda, [["USD", "USD"], ["UF", "UF (Chile)"], ["ARS", "ARS (excepción)"]])}
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
  const itemsLegend = tipo === "partes" ? "Partes a cotizar" : tipo === "equipos" ? "Equipo y conceptos" : "Ítems / servicios";
  const g = p.garantia || {};
  return `
    <fieldset><legend>${itemsLegend}</legend>
      <div class="items-list" id="preItems" data-tipo="${tipo}">${(p.items || []).map((it) => itemRow(tipo, it)).join("")}</div>
      <button type="button" class="btn sm" onclick="document.getElementById('preItems').insertAdjacentHTML('beforeend', itemRow(document.getElementById('preItems').dataset.tipo, {}));refrescarTotalesPresu()">+ Ítem</button>
    </fieldset>
    <fieldset><legend>Garantía</legend>
      <p class="hint" style="margin:0 0 8px">Se imprime como <b>Anexo I</b> del presupuesto. Cubre el trabajo realizado o la parte provista; el texto estándar sale de las condiciones que ya se venían ofreciendo.</p>
      <div class="check-row">${chk("Ofrecer garantía en este presupuesto", "garantia.aplica", g.aplica !== false)}</div>
      <div class="form-grid" style="margin-top:10px">
        ${inp("Plazo (días)", "garantia.dias", g.dias ?? 90, "", "number")}
      </div>
      <div class="field full" style="margin-top:10px">
        <label>Texto propio (opcional — si se completa, reemplaza el anexo estándar)</label>
        <textarea data-path="garantia.texto" rows="3" placeholder="Dejar vacío para usar las condiciones estándar de garantía.">${esc(g.texto || "")}</textarea>
      </div>
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
// Lee los ítems del DOM al draft (para recomputar o antes de re-render).
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
  // La garantía vive en la misma sección que los ítems, que se re-dibuja al
  // cambiar el tipo. Sin leerla acá, cambiar de tipo borraba el plazo cargado.
  p.garantia = p.garantia || {};
  document.querySelectorAll("#pform [data-path^='garantia.']").forEach((f) => {
    const k = f.dataset.path.split(".")[1];
    p.garantia[k] = f.type === "checkbox" ? f.checked : f.type === "number" ? (f.value === "" ? "" : Number(f.value)) : f.value;
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
  // Chile numera con sufijo: sin él, P20260709 de Chile y de Argentina eran
  // dos presupuestos distintos con el mismo número (pasó entre julio y octubre de 2026).
  if (isNew) p.numero = numeroConPais(p.numero, p.pais);
  if (isNew) state.presupuestos.push(p);
  else { const i = state.presupuestos.findIndex((x) => x.id === id); state.presupuestos[i] = p; }
  try {
    await persist(`${isNew ? "Alta" : "Edición"} ${p.numero} · ${p.cliente.nombreComercial}`, "presupuestos", p);
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
      #printRoot ul.notas { margin:6px 0 10px; padding-left:18px; font-size:12px; }
      #printRoot ul.notas li { margin-bottom:3px; break-inside:avoid; }
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
    <h2>Totales</h2>
    <table class="tot">${m.totales.map(([l, v, big]) => `<tr class="${big ? "big" : ""}"><td>${l}</td><td class="r">${v}</td></tr>`).join("")}</table>
    ${m.condiciones.length ? `<h2>Condiciones comerciales</h2><table class="eco">${m.condiciones.map(([l, v]) => `<tr><th style="width:28%">${l}</th><td class="cond">${v}</td></tr>`).join("")}</table>` : ""}
    ${m.notas.length ? `<h2>Notas</h2><ul class="notas">${m.notas.map((n) => `<li>${n}</li>`).join("")}</ul>` : ""}
    ${m.garantia ? `<h2>Anexo I · Garantía (${m.garantia.plazo})</h2>${
      m.garantia.libre
        ? `<p class="intro">${m.garantia.libre}</p>`
        : `<table class="eco">${m.garantia.puntos.map(([l, v]) => `<tr><th style="width:26%">${l}</th><td class="cond">${v}</td></tr>`).join("")}</table>`
    }` : ""}
    <div class="sign">
      <div><b>Por Nexolibre</b><br>Aclaración / cargo:</div>
      <div><b>Conformidad del Cliente · ${m.firmaCliente}</b><br>Aclaración / cargo:</div>
    </div>
    <div class="foot">${m.pie}${m.plantilla ? ' Los campos <span class="ph">[entre corchetes]</span> se completan al emitir.' : ""}<br>Nexolibre es miembro de <img src="${NEXO_BRAND.grupoNexo}" alt="Grupo Nexo" />.</div>`;
}
function exportarPresuCSV() {
  // Lo que se exporta es exactamente lo que se ve. Antes bajaba la lista
  // completa aunque hubiera filtros aplicados.
  const rows = presupuestosFiltrados();
  const cols = ["numero", "fecha", "pais", "tipo", "estado", "cliente", "razon_social", "ticket", "moneda", "neto_una_vez", "iva", "total_una_vez", "abono_mensual_neto", "total_mensual", "valor_anualizado"];
  const lines = [cols.join(",")];
  for (const p of rows) {
    const cc = NEXO_PRESUPUESTO.calcPresupuesto(p);
    const v = valorPresu(p);
    const vals = [p.numero, p.fecha, p.pais || "AR", (PRE_TIPOS[p.tipo] || {}).label || p.tipo, PRE_ESTADO_LABEL[p.estado],
      p.cliente?.nombreComercial, rsPrincipal(p).razonSocial, p.ticketNumero || "", cc.moneda,
      cc.netoUnaVez, cc.ivaUnaVez, cc.totalUnaVez, cc.abonoMensualNeto, cc.totalMensual, v.anual];
    lines.push(vals.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(","));
  }
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `presupuestos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  toast(`CSV: ${rows.length} presupuestos · ${NEXO_TABLA.describirFiltro(state.filtroPre)}`);
}

// ============================================================
//  DIRECCIÓN  (KPIs para CEO / COO)
// ============================================================
// Todos los números del tablero de dirección salen de acá, para que reporte
// e informe usen exactamente lo mismo.
/**
 * Recorta una lista al país activo. Sin país seleccionado devuelve todo:
 * la mirada consolidada sigue siendo la principal.
 */

// ============================================================
//  Importación de la planilla de Excel
// ============================================================
// La planilla se lee en el navegador: el archivo no se sube a ningún lado
// más que al repo privado de datos, ya traducido a registros. La lógica de
// qué se crea y qué se actualiza vive en nucleo/planilla.js (probada).

/** SheetJS pesa ~1 MB: se baja recién cuando alguien importa. */
let _sheetjs = null;
function cargarSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!_sheetjs) {
    _sheetjs = new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      s.onload = () => ok(window.XLSX);
      s.onerror = () => { _sheetjs = null; mal(new Error("No se pudo cargar el lector de Excel")); };
      document.head.appendChild(s);
    });
  }
  return _sheetjs;
}

/**
 * Filas de la planilla como objetos. Busca en cada hoja la fila de
 * encabezados (la que tiene "ID" y "Estado"): la planilla real arranca en la
 * fila 2 y tiene hojas de tablero que no son datos.
 */
async function leerPlanilla(file) {
  const XLSX = await cargarSheetJS();
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const filas = [];
  for (const nombre of wb.SheetNames) {
    const matriz = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: null });
    const iCab = matriz.findIndex((r) => r && r.some((c) => String(c).trim() === "ID") && r.some((c) => String(c).trim() === "Estado"));
    if (iCab < 0) continue;
    const cab = matriz[iCab].map((c) => (c == null ? "" : String(c).trim()));
    for (const r of matriz.slice(iCab + 1)) {
      const o = {};
      cab.forEach((h, i) => { if (h) o[h] = r[i] instanceof Date ? r[i].toISOString().slice(0, 10) : r[i]; });
      filas.push(o);
    }
  }
  return filas;
}

/**
 * Arma el plan completo: presupuestos de la planilla y acuerdos de
 * mantenimiento que pasan a Propuestas. Con filas vacías solo hace lo segundo.
 */
function armarPlanImport(filas, archivo) {
  const usuario = state.user || "importación";
  const plan = NEXO_PLANILLA.planImportacion(filas, state.presupuestos, { usuario });
  plan.archivo = archivo;
  plan.acu = NEXO_PLANILLA.planAcuerdos(plan.acuerdos, {
    propuestas: state.propuestas || [], contratos: state.data || [], tickets: state.tickets || [],
    clientes: state.clientes || [], usuario,
  });
  plan.avisos.push(...plan.acu.avisos);
  window._planImport = plan;
  renderPresuImportar();
}

function renderPresuImportar() {
  const el = document.getElementById("view-presuimportar");
  const plan = window._planImport;
  const acuerdosCargados = state.presupuestos.filter((p) => NEXO_PLANILLA.esAcuerdo(p.titulo)).length;
  el.innerHTML = `
    <div class="kicker">Presupuestos</div>
    <div class="page-head"><h1>Importar <span class="accent">planilla</span></h1></div>
    <div class="card">
      <p style="margin-top:0">Elegí la planilla de presupuestos (.xlsx o .csv) con las columnas
      <b>ID, Tipo, Título, Cliente, Monto s/iva, IVA, Total, Fecha de envío, Última nota, Estado</b>.
      Antes de guardar vas a ver qué se crea, qué cambia y qué conviene revisar. Lo que diga la planilla
      reemplaza estado, fecha de envío, notas e importe de lo ya cargado; ítems detallados, garantía y archivos no se tocan.</p>
      <input type="file" id="impArchivo" accept=".xlsx,.xls,.csv" />
      <span class="muted" id="impEstado" style="margin-left:8px"></span>
    </div>
    ${!plan && acuerdosCargados ? `<div class="card">
      <p style="margin-top:0">Hay <b>${acuerdosCargados}</b> propuestas de mantenimiento o Continuidad Operativa
      cargadas como presupuesto. Van a <b>Propuestas</b>, conservando su número original, ticket, archivos y contrato.</p>
      <button class="btn" onclick="armarPlanImport([], '')">Ver cómo quedarían en Propuestas</button></div>` : ""}
    ${plan ? renderPlanImport(plan) : ""}
    <p style="margin-top:14px"><a href="#presupuestos">← Volver a presupuestos</a></p>`;
  document.getElementById("impArchivo").onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const st = document.getElementById("impEstado");
    st.textContent = "Leyendo…";
    try {
      armarPlanImport(await leerPlanilla(f), f.name);
    } catch (err) { st.textContent = ""; toast("No se pudo leer: " + err.message, true, true); }
  };
}

function renderPlanImport(plan) {
  const acu = plan.acu || { propuestas: [], quitar: [], clientes: [] };
  const cli = [...(state.clientes || []), ...acu.clientes];
  const nombreCli = (id) => cli.find((c) => c.id === id)?.nombreComercial || "—";
  const nroContrato = (id) => (state.data || []).find((c) => c.id === id)?.numero || "";
  const total = plan.crear.length + plan.actualizar.length + acu.propuestas.length + acu.quitar.length;
  const fila = (n, txt) => `<tr><td><b>${esc(n)}</b></td><td>${txt}</td></tr>`;
  const lbl = { estado: "Estado", estadoOrigen: "Estado en planilla", fechaEnvio: "Enviado", notas: "Notas", moneda: "Moneda", neto: "Neto" };
  const val = (c, v) => c === "estado" ? (PRE_ESTADO_LABEL[v] || v || "—") : esc(String(v ?? "").slice(0, 80) || "—");
  return `
    <div class="grid-kpi" style="margin:14px 0">
      ${kpi("Nuevos", plan.crear.length)}${kpi("Con cambios", plan.actualizar.length)}
      ${kpi("Sin cambios", plan.iguales)}${kpi("A Propuestas", acu.propuestas.length)}
      ${kpi("Para revisar", plan.avisos.length, "", plan.avisos.length ? "warn" : "")}
    </div>
    ${plan.avisos.length ? `<div class="card"><h3>Para revisar después de importar</h3><div class="overflow"><table class="data"><tbody>
      ${plan.avisos.map((a) => fila(a.numero, esc(a.texto))).join("")}</tbody></table></div></div>` : ""}
    ${plan.crear.length ? `<div class="card"><h3>Se crean</h3><div class="overflow"><table class="data">
      <thead><tr><th>N°</th><th>Cliente</th><th>Título</th><th>Estado</th><th>Neto</th></tr></thead><tbody>
      ${plan.crear.map(({ presupuesto: p }) => `<tr><td><b>${esc(p.numero)}</b></td><td>${esc(p.cliente.nombreComercial)}</td><td>${esc(p.titulo)}</td>
        <td><span class="badge ${p.estado}">${PRE_ESTADO_LABEL[p.estado]}</span></td><td>${money(p.items[0].unitario, p.economico.moneda)}</td></tr>`).join("")}
      </tbody></table></div></div>` : ""}
    ${plan.actualizar.length ? `<div class="card"><h3>Se actualizan</h3><div class="overflow"><table class="data">
      <thead><tr><th>N°</th><th>Qué cambia</th></tr></thead><tbody>
      ${plan.actualizar.map((a) => fila(a.numero, a.cambios.map((c) => `${lbl[c.campo] || c.campo}: <span class="muted">${val(c.campo, c.antes)}</span> → ${val(c.campo, c.despues)}`).join("<br>"))).join("")}
      </tbody></table></div></div>` : ""}
    ${acu.propuestas.length ? `<div class="card"><h3>Pasan a Propuestas</h3>
      <p class="muted" style="margin-top:0">Dejan de figurar como presupuesto. El importe entra como canon mensual: revisalo en cada propuesta.</p>
      <div class="overflow"><table class="data">
      <thead><tr><th>Antes</th><th>Propuesta</th><th>Cliente</th><th>Estado</th><th>Importe</th><th>Contrato</th></tr></thead><tbody>
      ${acu.propuestas.map((p) => `<tr><td>${esc(p.numeroLegado)}</td><td><b>${esc(p.numero)}</b></td><td>${esc(nombreCli(p.clienteId))}</td>
        <td>${esc(p.estado)}</td><td>${p.economico.canonMensual ? money(p.economico.canonMensual, p.economico.moneda) : "—"}</td>
        <td>${esc(nroContrato(p.contratoId))}</td></tr>`).join("")}
      </tbody></table></div></div>` : ""}
    ${total ? `<div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn ghost" onclick="window._planImport=null;renderPresuImportar()">Descartar</button>
      <button class="btn primary" id="impAplicar" onclick="aplicarImportacion()">Aplicar</button></div>`
      : `<p class="muted">No hay nada nuevo para aplicar.</p>`}`;
}

async function aplicarImportacion() {
  const plan = window._planImport;
  if (!plan) return;
  const btn = document.getElementById("impAplicar");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
  const usuario = state.user || "importación";
  for (const { presupuesto, ticket } of plan.crear) {
    state.presupuestos.push(presupuesto);
    if (!ticketPorId(ticket.id)) state.tickets.push(ticket);
  }
  for (const a of plan.actualizar) {
    const i = state.presupuestos.findIndex((p) => p.id === a.id);
    if (i < 0) continue;
    const nuevo = NEXO_PLANILLA.aplicarActualizacion(state.presupuestos[i], a, { usuario });
    state.presupuestos[i] = nuevo;
    // El ticket acompaña al presupuesto: si se resolvió, se cierra igual.
    const tk = nuevo.ticketId ? ticketPorId(nuevo.ticketId) : null;
    const estTk = { ganado: "ganado", perdido: "perdido", anulado: "perdido" }[nuevo.estado];
    if (tk && estTk && tk.estado !== estTk) {
      tk.estado = estTk;
      tk.historial = [...(tk.historial || []), { estado: estTk, fecha: new Date().toISOString().slice(0, 10), usuario }];
    }
  }
  // Acuerdos de mantenimiento: pasan a Propuestas.
  const acu = plan.acu || { propuestas: [], quitar: [], clientes: [], contratos: [], tickets: [] };
  for (const t of acu.tickets) {
    const i = state.tickets.findIndex((x) => x.id === t.id);
    if (i >= 0) state.tickets[i] = t;
  }
  for (const c of acu.contratos) {
    const i = state.data.findIndex((x) => x.id === c.id);
    if (i >= 0) state.data[i] = c;
  }
  // Reemplazo por id y no agregado: si el guardado falla y se reintenta con
  // el mismo plan, no se duplican en memoria.
  const reemplazar = (lista, nuevos) => {
    const ids = new Set(nuevos.map((x) => x.id));
    return [...(lista || []).filter((x) => !ids.has(x.id)), ...nuevos];
  };
  if (acu.clientes.length) state.clientes = reemplazar(state.clientes, acu.clientes);
  state.propuestas = reemplazar(state.propuestas, acu.propuestas);
  const quitar = new Set(acu.quitar);
  state.presupuestos = state.presupuestos.filter((p) => !quitar.has(p.id));

  const ref = plan.archivo ? `Importación de planilla · ${plan.archivo}` : "Acuerdos de mantenimiento a Propuestas";
  try {
    // Una escritura por colección: importar 100 filas de a una serían 100 commits.
    // Primero lo que se crea y después lo que se quita: si algo falla a mitad,
    // un acuerdo queda duplicado (y el reintento no lo duplica de nuevo), nunca perdido.
    if (acu.clientes.length) await persist(`${ref} · ${acu.clientes.length} clientes`, "clientes");
    if (acu.propuestas.length) await persist(`${ref} · ${acu.propuestas.length} propuestas`, "propuestas");
    for (const c of acu.contratos) await persist(`${ref} · contrato ${c.numero} vinculado a su propuesta`, "contratos", c);
    if (plan.crear.length || acu.tickets.length) await persist(`${ref} · tickets`, "tickets");
    if (plan.crear.length || plan.actualizar.length) {
      await persist(`${ref} · ${plan.crear.length} nuevos, ${plan.actualizar.length} actualizados`, "presupuestos");
    }
    await eliminarRegistros("presupuestos", acu.quitar, `${ref} · ${acu.quitar.length} presupuestos pasan a Propuestas`);
    toast(`Listo: ${plan.crear.length} nuevos, ${plan.actualizar.length} actualizados, ${acu.propuestas.length} a Propuestas`);
    window._planImport = null;
    go("presupuestos");
  } catch (e) {
    toast("Error al guardar: " + e.message + " — recargá la página antes de reintentar", true, true);
    if (btn) { btn.disabled = false; btn.textContent = "Reintentar"; }
  }
}
