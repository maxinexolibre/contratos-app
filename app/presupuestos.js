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

/** Filas de presupuestos que pasan el filtro activo, ya ordenadas. */
function presupuestosFiltrados() {
  return NEXO_TABLA.filtrar(state.presupuestos, state.filtroPre, {
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
        ${state.soloLectura ? "" : `<button class="btn primary sm" onclick="location.hash='presuform/new'">+ Nuevo</button>`}
      </div>
    </div>
    <div class="table-tools">
      <input type="search" id="pq" placeholder="Buscar cliente, N° o título…" value="${esc(state.filtroPre.q)}" />
      <select id="pfe"><option value="">Todos los estados</option>${PRE_ESTADOS.map((e) => `<option value="${e.id}" ${state.filtroPre.estado === e.id ? "selected" : ""}>${e.label}</option>`).join("")}</select>
      <select id="pft"><option value="">Todo tipo</option>${Object.entries(PRE_TIPOS).map(([k, v]) => `<option value="${k}" ${state.filtroPre.tipo === k ? "selected" : ""}>${v.label}</option>`).join("")}</select>
      <select id="pfp"><option value="">Todos los países</option>${NEXO_ESQUEMA.PAIS.map((c) => `<option value="${c}" ${state.filtroPre.pais === c ? "selected" : ""}>${NEXO_ESQUEMA.PAIS_NOMBRE[c]}</option>`).join("")}</select>
      <select id="pfm"><option value="">Todos los meses</option>${meses.map((m) => `<option value="${m}" ${state.filtroPre.mes === m ? "selected" : ""}>${NEXO_TABLA.etiquetaMes(m)}</option>`).join("")}</select>
      ${NEXO_TABLA.hayFiltro(state.filtroPre) ? `<button class="btn sm ghost" onclick="limpiarFiltroPre()">✕ Limpiar</button>` : ""}
      <span class="muted" style="font-size:13px">${abiertos.length} abiertos · ${pipe} anualizado en juego</span>
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
    e[ev] = (x) => { state.filtroPre[campo] = x.target.value; state.filtroPre.pagina = 1; renderPresupuestos(); };
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
