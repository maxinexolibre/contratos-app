/**
 * Área de Tickets: listado, detalle, formulario y cambios de estado.
 *
 * Parte de la aplicación, dividida por dominio. Todos los archivos de
 * app/ comparten el ámbito global: se cargan en orden y las constantes
 * declaradas antes son visibles después. El orden importa.
 */

function ticketsFiltrados() {
  return NEXO_TABLA.filtrar(state.tickets, state.filtroTk, {
    texto: (t) => `${t.numero} ${t.cliente?.nombreComercial || ""} ${t.descripcion || ""}`,
    pais: (t) => t.pais || "AR",
  }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

function renderTickets() {
  const el = document.getElementById("view-tickets");
  const rows = ticketsFiltrados();
  const pag = NEXO_TABLA.paginar(rows, state.filtroTk.pagina || 1);
  const abiertos = rows.filter((t) => TK_ESTADOS.find((e) => e.id === t.estado)?.grupo === "abierto").length;
  const meses = NEXO_TABLA.mesesDisponibles(state.tickets);

  el.innerHTML = `
    <div class="kicker">Pedidos de cliente</div>
    <div class="page-head">
      <h1><span class="accent">Tickets</span></h1>
      <div style="display:flex;gap:8px">
        <button class="btn sm" onclick="exportarTicketsCSV()">⬇ CSV</button>
        ${state.soloLectura ? "" : `<button class="btn primary sm" onclick="location.hash='tkform/new'">+ Nuevo ticket</button>`}
      </div>
    </div>
    <div class="table-tools">
      <input type="search" id="tkq" placeholder="Buscar cliente, N° o descripción…" value="${esc(state.filtroTk.q)}" />
      <select id="tkfe"><option value="">Todos los estados</option>${TK_ESTADOS.map((e) => `<option value="${e.id}" ${state.filtroTk.estado === e.id ? "selected" : ""}>${e.label}</option>`).join("")}</select>
      <select id="tkfp"><option value="">Todos los países</option>${NEXO_ESQUEMA.PAIS.map((c) => `<option value="${c}" ${state.filtroTk.pais === c ? "selected" : ""}>${NEXO_ESQUEMA.PAIS_NOMBRE[c]}</option>`).join("")}</select>
      <select id="tkfm"><option value="">Todos los meses</option>${meses.map((m) => `<option value="${m}" ${state.filtroTk.mes === m ? "selected" : ""}>${NEXO_TABLA.etiquetaMes(m)}</option>`).join("")}</select>
      ${NEXO_TABLA.hayFiltro(state.filtroTk) ? `<button class="btn sm ghost" onclick="limpiarFiltroTk()">✕ Limpiar</button>` : ""}
      <span class="muted" style="font-size:13px">${abiertos} abierto${abiertos === 1 ? "" : "s"} · ${rows.length} de ${state.tickets.length}</span>
    </div>
    <div class="overflow"><table class="data">
      <thead><tr><th>N°</th><th>Fecha</th><th>País</th><th>Cliente</th><th>Pedido</th><th>Estado</th><th>Presup.</th></tr></thead>
      <tbody>${pag.filas.map(ticketRow).join("") || `<tr><td colspan="7" class="empty">${
        NEXO_TABLA.hayFiltro(state.filtroTk) ? "Ningún ticket coincide con el filtro." : "Sin tickets todavía."}</td></tr>`}</tbody>
    </table></div>
    ${NEXO_TABLA.pie(pag, "irPaginaTk")}`;

  const cambia = (id, campo) => {
    const e = document.getElementById(id);
    if (!e) return;
    const ev = e.tagName === "INPUT" ? "oninput" : "onchange";
    e[ev] = (x) => { state.filtroTk[campo] = x.target.value; state.filtroTk.pagina = 1; renderTickets(); };
  };
  cambia("tkq", "q"); cambia("tkfe", "estado"); cambia("tkfp", "pais"); cambia("tkfm", "mes");
}
function irPaginaTk(n) { state.filtroTk.pagina = n; renderTickets(); window.scrollTo(0, 0); }
function limpiarFiltroTk() { state.filtroTk = { q: "", estado: "", pais: "", mes: "", pagina: 1 }; renderTickets(); }

/** CSV de tickets. Exporta lo filtrado, igual que el resto de los listados. */
function exportarTicketsCSV() {
  const rows = ticketsFiltrados();
  const n = NEXO_TABLA.exportarCSV(rows, [
    { titulo: "numero", valor: (t) => t.numero },
    { titulo: "fecha", valor: (t) => t.fecha },
    { titulo: "pais", valor: (t) => t.pais || "AR" },
    { titulo: "cliente", valor: (t) => t.cliente?.nombreComercial || "" },
    { titulo: "tipo_pedido", valor: (t) => TK_TIPO_PEDIDO[t.tipoPedido] || t.tipoPedido },
    { titulo: "descripcion", valor: (t) => t.descripcion || "" },
    { titulo: "estado", valor: (t) => TK_ESTADO_LABEL[t.estado] || t.estado },
    { titulo: "vendedor", valor: (t) => t.vendedor || t.usuario || "" },
    { titulo: "presupuestos", valor: (t) => presupuestosDeTicket(t).map((p) => p.numero).join(" ") },
  ], "tickets");
  toast(`CSV: ${n} tickets · ${NEXO_TABLA.describirFiltro(state.filtroTk)}`);
}

function ticketRow(t) {
  const np = presupuestosDeTicket(t).length;
  return `<tr onclick="location.hash='tkdetalle/${t.id}'">
    <td><b>${esc(t.numero)}</b></td>
    <td>${fmt(t.fecha)}</td>
    <td><span class="pill">${esc(t.pais || "AR")}</span></td>
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
  try { await persist(`Ticket ${t.numero} → ${nuevo}`, "tickets", t); toast(`${t.numero}: ${TK_ESTADO_LABEL[nuevo]}`); router(); }
  catch (e) { toast("Error: " + e.message, true, true); }
}
function nuevoTicket() {
  const d = new Date().toISOString().slice(0, 10);
  return {
    id: "tk_" + Date.now(), numero: proxNumeroTicket(), fecha: d,
    cliente: { nombreComercial: "", razonesSociales: [], contacto: "" },
    tipoPedido: "servicio", pais: "AR", descripcion: "", estado: "abierto", presupuestoIds: [],
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
        ${sel("País", "pais", t.pais || "AR", Object.entries(NEXO_ESQUEMA.PAIS_NOMBRE))}
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
  try { await persist(`${isNew ? "Alta" : "Edición"} ticket ${t.numero} · ${t.cliente.nombreComercial}`, "tickets", t); go("tkdetalle/" + t.id); toast(isNew ? "Ticket creado ✓" : "Guardado ✓"); }
  catch (e) { toast("Error: " + e.message, true, true); }
}

// ============================================================
//  PRESUPUESTOS
// ============================================================
const presuPorId = (id) => state.presupuestos.find((p) => p.id === id);
// Valor de un presupuesto, neto de IVA (para pipeline, dashboard y reportes).
