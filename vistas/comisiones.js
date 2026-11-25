/**
 * Seguimiento de comisiones por operación.
 *
 *   ¿Lleva comisión?   se pregunta al enviar el presupuesto o la propuesta.
 *   Comisiones         una fila por servicio o venta, quién cobra, cuánto y
 *                      en qué estado, con totales por moneda y alertas.
 *   Históricas         para cargar las operaciones anteriores al seguimiento.
 *
 * Toda la lógica está en nucleo/comisiones.js (lineas, elegibilidad,
 * alertas). Esta pantalla solo dibuja y guarda: en la migración se reescribe.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;
  const R = global.NEXO_REGLAS;
  const K = global.NEXO_KPI;
  const P = global.NEXO_PERMISOS;
  const CM = global.NEXO_COMISIONES;
  const AD = global.NEXO_ADAPTADOR;
  const T = global.NEXO_TABLA;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n, d = 0) => Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const SIM = { USD: "US$", UF: "UF", ARS: "$", CLP: "CLP$" };
  const money = (v, m = "USD") => (v == null ? "—" : `${SIM[m] || m} ${num(v, 0)}`);
  const pct = (v) => `${String(v).replace(".", ",")}%`;
  const rol = () => global.state?.rol || "admin";

  const ETIQUETA = {
    Prevista: "Prevista", Devengada: "Ganada", ACobrar: "A cobrar", Pagada: "Pagada", Anulada: "Anulada",
  };
  const AYUDA = {
    Prevista: "la propuesta salió y todavía no se cerró",
    Devengada: "el cliente aceptó y todavía no pagó",
    ACobrar: "el cliente pagó: ya se le puede pagar al comercial",
    Pagada: "comisión pagada",
    Anulada: "la operación se rechazó o se anuló",
  };
  const CLASE = { Prevista: "", Devengada: "", ACobrar: " warn", Pagada: "", Anulada: "", ACompensar: " warn" };
  ETIQUETA.ACompensar = "A compensar";
  /** Qué suma cada total (un pago parcial aporta a más de uno). */
  const TOTAL_AYUDA = {
    Prevista: "si se cierran las propuestas abiertas",
    Devengada: "ganado; falta que el cliente pague",
    ACobrar: "el cliente pagó: listo para pagarle al comercial",
    Pagada: "lo que efectivamente se pagó",
    ACompensar: "pagado de más: se descuenta de la próxima",
  };

  /** Contexto en modelo v3: lo que el núcleo necesita para calcular. */
  function ctx() {
    // El padrón puede no tener todavía a un cliente recién tipeado en un
    // ticket. Sin sumarlo, su presupuesto quedaba sin cliente y la app no
    // podía decir si era nuevo.
    const st = global.state || {};
    const derivados = AD.clientesDesde(st);
    const idx = AD.indiceClientes(st.clientes || []);
    const clientes = [...(st.clientes || []),
      ...derivados.filter((d) => !d.alias.some((a) => idx.has(E.claveCliente(a))))];
    const n = AD.estadoANuevo({ ...st, clientes });
    return {
      ...n,
      propuestas: global.state?.propuestas || [],
      vendedores: global.state?.vendedores || [],
      acuerdos: global.state?.acuerdosComision || [],
      acuerdosComision: global.state?.acuerdosComision || [],
      facturaciones: global.state?.facturaciones || [],
      marcasComision: global.state?.marcasComision || [],
      rol: rol(),
      usuario: global.state?.user || "",
    };
  }

  const coleccion = (tipo, c) => (tipo === "Propuesta" ? c.propuestas : c.presupuestos);
  const rutaOp = (tipo, id) => (tipo === "Propuesta" ? `#propdetalle/${id}` : `#presudetalle/${id}`);

  async function guardarMarca(marca, mensaje) {
    const c = ctx();
    const normalizado = E.ENTIDADES.marcasComision.normalizar(marca);
    const anterior = c.marcasComision.find((x) => x.id === normalizado.id) || null;
    try {
      R.validar("marcasComision", anterior ? "editar" : "crear", normalizado, anterior, c);
    } catch (e) {
      global.toast(e.sugerencia ? `${e.message} — ${e.sugerencia}` : e.message, true, true);
      return null;
    }
    const resto = (global.state.marcasComision || []).filter((x) => x.id !== normalizado.id);
    global.state.marcasComision = [...resto, normalizado];
    try {
      await global.persist(mensaje, "marcasComision", normalizado);
    } catch (e) {
      global.state.marcasComision = resto.concat(anterior ? [anterior] : []);
      global.toast("Error al guardar: " + e.message, true, true);
      return null;
    }
    return normalizado;
  }

  /**
   * Alta rápida de un comercial desde la ventana de la comisión. Si se carga
   * un %, queda como acuerdo vigente desde la fecha de la operación, así se
   * propone también acá.
   */
  async function altaComercial(datos, porcentaje, desde, moneda) {
    const c = ctx();
    const v = E.ENTIDADES.vendedores.normalizar({ ...datos, estado: "Activo", fechaAlta: E.hoy() });
    try { R.validar("vendedores", "crear", v, null, c); } catch (e) {
      global.toast(e.sugerencia ? `${e.message} — ${e.sugerencia}` : e.message, true, true);
      return null;
    }
    let acuerdo = null;
    if (porcentaje != null) {
      acuerdo = E.ENTIDADES.acuerdosComision.normalizar({
        vendedorId: v.id, modalidad: "Porcentaje", porcentaje, base: "Neto", moneda,
        nombre: `Acuerdo ${E.hoy()}`, vigenciaDesde: desde < E.hoy() ? desde : E.hoy(), pagoTrasCobro: true,
      });
      try { R.validar("acuerdosComision", "crear", acuerdo, null, { ...c, vendedores: [...c.vendedores, v] }); } catch (e) {
        global.toast(e.sugerencia ? `${e.message} — ${e.sugerencia}` : e.message, true, true);
        return null;
      }
    }
    global.state.vendedores = [...(global.state.vendedores || []), v];
    try {
      await global.persist(`Vendedor ${v.nombre}`, "vendedores", v);
      if (acuerdo) {
        global.state.acuerdosComision = [...(global.state.acuerdosComision || []), acuerdo];
        await global.persist(`Acuerdo de comisión · ${v.nombre}`, "acuerdosComision", acuerdo);
      }
    } catch (e) {
      global.toast("Error al guardar: " + e.message, true, true);
      return null;
    }
    return v;
  }

  /** Asigna en el ticket quién trajo el lead, con quién y cuándo. */
  async function asignarLead(ticket, vendedorId) {
    const antes = { traidoPor: ticket.traidoPor, traidoPorAsignacion: ticket.traidoPorAsignacion };
    ticket.traidoPor = vendedorId;
    ticket.traidoPorAsignacion = vendedorId ? { por: global.state?.user || "—", fecha: E.hoy() } : null;
    try {
      await global.persist(`Ticket ${ticket.numero}: trajo el lead ${vendedorId || "Nexo"}`, "tickets", ticket);
      return true;
    } catch (e) {
      Object.assign(ticket, antes);
      global.toast("No se pudo asignar en el ticket: " + e.message, true, true);
      return false;
    }
  }

  function cerrarModal() {
    document.getElementById("ovComision")?.remove();
  }

  // ==========================================================================
  // ¿Lleva comisión?
  // ==========================================================================

  /**
   * Abre la pregunta para una operación. Devuelve una promesa que resuelve en
   * true si se guardó la decisión y false si se canceló: quien envía el
   * presupuesto espera la respuesta antes de marcarlo como enviado.
   *
   * @param {"Presupuesto"|"Propuesta"} origenTipo
   * @param {string} origenId
   * @param {{historico?: boolean}} opciones  historico: carga a posteriori
   */
  async function marcarComision(origenTipo, origenId, opciones = {}) {
    // Para saber si el cliente es nuevo hay que ver toda su historia, no solo
    // los 12 meses que se cargan al entrar.
    try {
      if (await global.asegurarHistorico?.()) global.toast("Revisando la historia del cliente…");
    } catch (e) {
      global.toast("No se pudo cargar el historial completo: " + e.message, true, true);
      return false;
    }
    const c = ctx();
    const op = (coleccion(origenTipo, c) || []).find((o) => o.id === origenId);
    if (!op) { global.toast("No se encontró la operación", true, true); return false; }

    const existente = CM.marcaDe(origenTipo, origenId, c.marcasComision);
    const historico = !!(opciones.historico || existente?.historico);
    const sug = CM.sugerirMarca(origenTipo, op, c);
    const cliente = c.clientes.find((x) => x.id === op.clienteId);

    // Borrador de la decisión: lo existente, o lo que propone la app.
    const d = existente ? structuredClone(existente) : {
      origenTipo, origenId, origenNumero: op.numero, clienteId: op.clienteId,
      lleva: sug.lleva, area: sug.lleva !== false,
      externo: sug.externo ? { ...sug.externo } : null,
      criterio: historico ? "Historico" : sug.criterio,
      primeraActividad: sug.primeraActividad, historico, motivo: "", pagos: [],
    };
    const conPagos = (existente?.pagos || []).length > 0;

    // Quién trajo el lead se asigna desde acá mismo (Maxi, 2026-11-24): antes
    // había que salir, buscar el ticket, editarlo y volver a empezar.
    const ticket = sug.ticketId ? (global.state.tickets || []).find((t) => t.id === sug.ticketId) || null : null;
    const puedeAsignar = P.capacidad(rol(), "asignar_vendedor");
    const puedeAlta = !!P.puede(rol(), "vendedores", "crear");
    // Sin ticket no hay dónde asentar quién trajo el lead. En una carga
    // histórica alcanza con la comisión: la regla del ticket no se le aplica.
    // Quien no puede asignar igual elige si el que figura en el ticket cobra o no.
    const soloElTicket = !historico && !!ticket && !puedeAsignar;
    const extEditable = !conPagos && (historico || (!!ticket && (puedeAsignar || !!ticket.traidoPor)));
    const fechaOp = (origenTipo === "Propuesta" ? op.fechas?.creado : op.fecha) || E.hoy();
    const comerciales = () => (global.state.vendedores || [])
      .filter((v) => soloElTicket ? v.id === ticket.traidoPor
        : v.estado !== "Inactivo" || v.id === d.externo?.vendedorId || v.id === sug.traidoPor);
    // En una venta de equipo la comisión va sobre el precio menos los costos.
    const esEquipo = origenTipo === "Presupuesto" && op.tipo === "venta" && /equipo/i.test(op.subtipo || "");
    // Una venta en USD se factura en pesos al TC del día: los costos en pesos
    // se convierten con ese TC si no se carga otro.
    const monedaOp = op.economico?.moneda || "USD";
    const tcFactura = CM.cobros(origenTipo, op, c.facturaciones).find((x) => x.monto > 0 && x.tcValor > 0) || null;
    if (d.costosMoneda == null && d.costos == null && monedaOp !== "ARS") d.costosMoneda = "ARS";

    return new Promise((resolver) => {
      const ov = document.createElement("div");
      ov.className = "overlay";
      ov.id = "ovComision";
      const criterioTxt = {
        ClienteNuevo: "✓ Corresponde", ClienteExistente: "✕ No corresponde", Consulta: "? Hay que decidir",
      }[sug.criterio];

      ov.innerHTML = `<div class="modal" style="max-width:620px" id="mcModal">
        <div id="mcSub" style="display:none"></div>
        <div id="mcPrincipal">
        <div class="kicker">${historico ? "Carga histórica" : "Antes de enviar"}</div>
        <h2>¿Lleva comisión?</h2>
        <div style="display:flex;align-items:center;gap:10px;margin:2px 0 14px;flex-wrap:wrap">
          <span class="muted" style="flex:1">${esc(op.numero)} · ${esc(cliente?.nombreComercial || "cliente sin identificar")}</span>
          <button class="btn sm ghost" type="button" id="mcVerDoc">Ver ${origenTipo === "Propuesta" ? "propuesta" : "presupuesto"}</button>
        </div>

        <div class="card interno" style="margin-bottom:14px">
          <b>${criterioTxt}</b> · ${esc(sug.explicacion)}
          ${sug.previas.length ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:13px">${sug.previas.slice(0, 3).map((a) =>
            `<li>${esc(a.tipo)} ${esc(a.numero)} · ${esc(a.fecha)}</li>`).join("")}${sug.previas.length > 3
            ? `<li class="muted">y ${sug.previas.length - 3} más</li>` : ""}</ul>` : ""}
          <p class="muted" style="font-size:12px;margin:8px 0 0">
            Regla: el área comercial comisiona con clientes que entraron desde marzo de 2026 sin
            actividad anterior con Nexo. Si lo anterior es algo aislado de hace más de ${CM.ANIOS_AISLADO} años, se decide caso por caso.
          </p>
        </div>

        ${conPagos ? `<p class="muted" style="font-size:13px"><b>Ya tiene pagos registrados:</b> la decisión no se puede cambiar.</p>` : ""}

        <div class="field"><label>¿Lleva comisión esta operación?</label>
          <div style="display:flex;gap:18px;margin-top:4px">
            <label style="font-weight:400"><input type="radio" name="mcLleva" value="si"${d.lleva === true ? " checked" : ""}${conPagos ? " disabled" : ""}> Sí</label>
            <label style="font-weight:400"><input type="radio" name="mcLleva" value="no"${d.lleva === false ? " checked" : ""}${conPagos ? " disabled" : ""}> No</label>
          </div>
        </div>

        <div id="mcQuienes">
          <div class="field"><label style="font-weight:400">
            <input type="checkbox" id="mcArea"${d.area ? " checked" : ""}${conPagos ? " disabled" : ""}>
            Área comercial · ${pct(CM.PORCENTAJE_AREA)} del precio sin IVA
            <span class="muted">(${CM.REPARTO_INTERNO.map((r) => `${esc(r.area)} ${pct(r.porcentaje)}`).join(" · ")})</span>
          </label></div>

          <div class="form-grid">
            <div class="field"><label for="mcExt">Comercial que trajo el lead</label>
              <select id="mcExt"${extEditable ? "" : " disabled"}></select>
              <p class="muted" id="mcExtAyuda" style="font-size:12px;margin:4px 0 0"></p></div>
            <div class="field"><label for="mcPct">% sin IVA</label>
              <input type="number" id="mcPct" min="0" max="100" step="0.5" value="${d.externo?.porcentaje ?? ""}"${conPagos ? " disabled" : ""}
                placeholder="sin acuerdo cargado"></div>
          </div>

          <div class="form-grid">
            <div class="field"><label for="mcCostos">Costos a descontar <span class="muted">${esEquipo
              ? "· parte, flete, importación, viáticos" : "· viáticos, flete · opcional"}</span></label>
              <div style="display:flex;gap:6px">
                ${monedaOp !== "ARS" ? `<select id="mcCostosMon" style="width:auto"${conPagos ? " disabled" : ""}>
                  <option value="ARS"${d.costosMoneda === "ARS" ? " selected" : ""}>ARS</option>
                  <option value="${esc(monedaOp)}"${d.costosMoneda !== "ARS" ? " selected" : ""}>${esc(monedaOp)}</option></select>` : ""}
                <input type="number" id="mcCostos" min="0" step="1" value="${d.costos ?? ""}"${conPagos ? " disabled" : ""}
                  placeholder="se restan antes de calcular"></div></div>
            <div class="field" id="mcTCCampo"><label for="mcCostosTC">TC pesos por ${esc(monedaOp)} <span class="muted">${tcFactura
              ? `· vacío: el de la factura ${esc(tcFactura.comprobante || "")} (${esc(String(tcFactura.tcValor).replace(".", ","))})`
              : "· todavía no hay factura en pesos"}</span></label>
              <input type="number" id="mcCostosTC" min="0" step="0.01" value="${d.costosTC ?? ""}"${conPagos ? " disabled" : ""}
                placeholder="${tcFactura ? esc(String(tcFactura.tcValor)) : "el del día de la factura"}"></div>
          </div>
        </div>

        <div class="field"><label for="mcMotivo">Motivo <span class="muted" id="mcMotivoAyuda"></span></label>
          <textarea id="mcMotivo" rows="2" placeholder="Por qué corresponde o no corresponde">${esc(d.motivo || "")}</textarea></div>

        <div class="card" id="mcPrevia" style="margin:12px 0"></div>

        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
          <button class="btn ghost" id="mcCancelar">Cancelar</button>
          <button class="btn primary" id="mcGuardar">${opciones.alGuardar || "Guardar"}</button>
        </div>
        </div>
      </div>`;
      document.body.appendChild(ov);
      ov.style.display = "flex";

      const $ = (id) => document.getElementById(id);
      const leer = () => {
        const v = document.querySelector('input[name="mcLleva"]:checked')?.value;
        d.lleva = v === "si" ? true : v === "no" ? false : null;
        d.motivo = $("mcMotivo").value.trim();
        if (!d.lleva) { d.area = false; d.externo = null; d.costos = null; d.costosTC = null; return; }
        const cst = $("mcCostos").value;
        d.costos = cst === "" ? null : Number(cst);
        d.costosMoneda = $("mcCostosMon") ? $("mcCostosMon").value : null;
        if (d.costosMoneda === monedaOp) d.costosMoneda = null;
        const tcv = $("mcCostosTC").value;
        d.costosTC = d.costosMoneda === "ARS" && tcv !== "" ? Number(tcv) : null;
        d.area = $("mcArea").checked;
        const id = $("mcExt").value;
        const pv = $("mcPct").value;
        d.externo = id ? { vendedorId: id, porcentaje: pv === "" ? null : Number(pv) } : null;
      };
      const refrescar = () => {
        if (!$("mcExt") || $("mcPrincipal").style.display === "none") return;
        leer();
        ayudaComercial();
        $("mcQuienes").style.display = d.lleva ? "" : "none";
        $("mcTCCampo").style.display = d.costosMoneda === "ARS" ? "" : "none";
        const contradice = (sug.criterio === "ClienteNuevo" && d.lleva === false) ||
          (sug.criterio === "ClienteExistente" && d.lleva === true);
        $("mcMotivoAyuda").textContent = contradice || sug.criterio === "Consulta" || historico
          ? "· obligatorio" : "· opcional";
        const prev = $("mcPrevia");
        if (d.lleva == null) { prev.innerHTML = `<span class="muted">Elegí sí o no.</span>`; return; }
        if (!d.lleva) { prev.innerHTML = `<b>Sin comisión.</b> <span class="muted">Queda registrado para que no se reclame después.</span>`; return; }
        const ls = CM.lineas(E.ENTIDADES.marcasComision.normalizar(d), c);
        // Las comisiones se liquidan casi siempre en pesos: se muestra lo que
        // da al TC de la factura (o al que se cargó para los costos).
        const tcPesos = ls[0]?.moneda !== "ARS" ? (ls[0]?.costosTC || ls[0]?.tcSugerido?.valor || null) : null;
        prev.innerHTML = ls.length ? `<table class="data"><tbody>${ls.map((l) => `<tr>
            <td>${esc(l.nombre)}</td><td class="num">${pct(l.porcentaje)}</td>
            <td class="num"><b>${money(l.monto, l.moneda)}</b></td>${tcPesos
              ? `<td class="num">${money(l.montoPesos, "ARS")}</td>` : ""}</tr>`).join("")}
          </tbody></table><p class="muted" style="font-size:12px;margin:6px 0 0">Sobre ${esc(ls[0].detalle.split(" sobre ")[1] || "")}: ${money(ls[0].base, ls[0].moneda)}${
            ls[0].costosTC && ls[0].moneda !== "ARS" ? ` (${money(E.money(ls[0].base * ls[0].costosTC), "ARS")} al TC ${esc(ls[0].costosTC.toLocaleString("es-AR"))})` : ""}.
          ${ls[0].costosSinTC ? `<b>Los costos en pesos no se restaron: falta el TC.</b> Cargalo o esperá la factura.` : ""}
          ${ls[0].abono ? `Se paga mes a mes: ${money(ls[0].mensual, ls[0].moneda)} por mes al ${pct(ls[0].porcentaje)}, con cada cobro.`
            : "Se libera a medida que el cliente paga."}</p>`
          : `<span class="muted">Marcá quién cobra.</span>`;
      };
      // --- Comercial que trajo el lead ---------------------------------
      const NUEVO = "__nuevo";
      const pintarComerciales = (elegido) => {
        const sel = $("mcExt");
        sel.innerHTML = `<option value="">Ninguno · propio de Nexo</option>${comerciales().map((v) =>
          `<option value="${esc(v.id)}"${v.id === elegido ? " selected" : ""}>${esc(v.nombre)} · ${esc(v.relacion)}</option>`).join("")}${
          extEditable && puedeAlta && !soloElTicket ? `<option value="${NUEVO}">+ Dar de alta un comercial…</option>` : ""}`;
        sel.dataset.anterior = sel.value;
      };
      const ayudaComercial = () => {
        const id = $("mcExt").value || null;
        const nombreTk = ticket ? `el ticket ${esc(ticket.numero)}` : "";
        let txt;
        if (conPagos) txt = "Ya tiene pagos: no se puede cambiar.";
        else if (!ticket && !historico) txt = "La operación no salió de un ticket: no hay dónde asignar quién trajo el lead.";
        else if (!ticket) txt = "Carga histórica: queda solo en la comisión.";
        else if (!puedeAsignar) txt = `Quién trajo el lead lo asigna gerencia comercial en ${nombreTk}.`;
        else if (id === (ticket.traidoPor || null)) txt = id ? `Asignado en ${nombreTk}.` : "";
        else txt = `Al guardar queda asignado en ${nombreTk}.`;
        $("mcExtAyuda").innerHTML = txt;
      };
      // El % sale del acuerdo vigente del comercial; si no tiene, se carga a mano.
      const sugerirPct = (id) => {
        const habitual = id ? CM.porcentajeHabitual(id, fechaOp, global.state.acuerdosComision || []) : null;
        $("mcPct").value = habitual ?? "";
      };
      pintarComerciales(d.externo?.vendedorId || "");
      $("mcExt").addEventListener("change", (ev) => {
        const sel = ev.target;
        if (sel.value === NUEVO) {
          sel.value = sel.dataset.anterior || "";
          abrirAlta();
          return;
        }
        sel.dataset.anterior = sel.value;
        sugerirPct(sel.value);
      });

      // --- Navegación interna: se abre algo encima y se vuelve al mismo punto
      const abrirSub = (html, ancho = 620) => {
        $("mcPrincipal").style.display = "none";
        $("mcSub").innerHTML = html;
        $("mcSub").style.display = "";
        $("mcModal").style.maxWidth = ancho + "px";
        $("mcModal").scrollTop = 0;
      };
      const volver = () => {
        $("mcSub").style.display = "none";
        $("mcSub").innerHTML = "";
        $("mcPrincipal").style.display = "";
        $("mcModal").style.maxWidth = "620px";
        refrescar();
      };
      const barraVolver = (titulo) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <button class="btn sm ghost" type="button" id="mcVolver">← Volver</button>
          <b style="flex:1">${esc(titulo)}</b></div>`;

      $("mcVerDoc").onclick = () => {
        const doc = global.htmlDocumento?.(origenTipo === "Propuesta" ? "propuesta" : "presupuesto", origenId);
        abrirSub(`${barraVolver(doc?.titulo || op.numero)}
          ${doc ? `<div class="visor-doc" style="margin:0;max-height:70vh;overflow:auto;padding:24px 28px">${doc.html}</div>`
            : `<p class="muted">No se pudo armar el documento.</p>`}`, 900);
        $("mcVolver").onclick = volver;
      };

      function abrirAlta() {
        abrirSub(`${barraVolver("Nuevo comercial")}
          <div class="form-grid">
            <div class="field"><label for="mcNvNombre">Nombre y apellido</label><input id="mcNvNombre"></div>
            <div class="field"><label for="mcNvRel">Relación</label>
              <select id="mcNvRel">${E.VENDEDOR_RELACION.map((x) =>
                `<option${x === "Externo" ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
          </div>
          <div class="form-grid">
            <div class="field"><label for="mcNvEmail">Email</label><input type="email" id="mcNvEmail"></div>
            <div class="field"><label for="mcNvTel">Teléfono</label><input id="mcNvTel"></div>
          </div>
          <div class="field"><label for="mcNvPct">Comisión acordada <span class="muted">· % sin IVA, opcional</span></label>
            <input type="number" id="mcNvPct" min="0" max="100" step="0.5" placeholder="10">
            <p class="muted" style="font-size:12px;margin:4px 0 0">Queda como su acuerdo vigente y se propone en sus próximas operaciones.
            El resto de los datos se completa después en Vendedores.</p></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
            <button class="btn ghost" type="button" id="mcNvCancelar">Cancelar</button>
            <button class="btn primary" type="button" id="mcNvGuardar">Dar de alta y volver</button>
          </div>`);
        $("mcVolver").onclick = volver;
        $("mcNvCancelar").onclick = volver;
        $("mcNvNombre").focus();
        $("mcNvGuardar").onclick = async () => {
          const nombre = $("mcNvNombre").value.trim();
          if (!nombre) { global.toast("Falta el nombre", true, true); return; }
          const pctNv = $("mcNvPct").value;
          const nuevo = await altaComercial({
            nombre, relacion: $("mcNvRel").value, email: $("mcNvEmail").value.trim(),
            telefono: $("mcNvTel").value.trim(),
          }, pctNv === "" ? null : Number(pctNv), fechaOp, monedaOp);
          if (!nuevo) return;
          // El contexto de la vista previa se armó al abrir: sin esto, el
          // nuevo aparecía con su id en lugar del nombre.
          c.vendedores = global.state.vendedores;
          c.acuerdos = c.acuerdosComision = global.state.acuerdosComision;
          volver();
          pintarComerciales(nuevo.id);
          sugerirPct(nuevo.id);
          refrescar();
          global.toast(`${nuevo.nombre} dado de alta`);
        };
      }

      ov.addEventListener("input", refrescar);
      ov.addEventListener("change", refrescar);
      refrescar();

      $("mcCancelar").onclick = () => { cerrarModal(); resolver(false); };
      $("mcGuardar").onclick = async () => {
        leer();
        if (d.lleva == null) { global.toast("Elegí si lleva comisión o no", true, true); return; }
        // Primero el ticket: la regla de la comisión controla que el externo
        // sea el que figura ahí. Solo si lleva comisión; un «no» no le quita
        // a nadie el lead.
        const elegido = d.externo?.vendedorId || null;
        if (d.lleva && ticket && puedeAsignar && !conPagos && elegido !== (ticket.traidoPor || null)) {
          if (!(await asignarLead(ticket, elegido))) return;
        }
        const marca = {
          ...d,
          criterio: historico ? "Historico" : sug.criterio,
          decididoPor: existente?.decididoPor || global.state?.user || "",
          fecha: existente?.fecha || E.hoy(),
        };
        const ok = await guardarMarca(marca,
          `Comisión ${op.numero}: ${d.lleva ? "lleva" : "sin comisión"}`);
        if (!ok) return;
        cerrarModal();
        resolver(true);
      };
    });
  }

  // ==========================================================================
  // Registrar el pago
  // ==========================================================================

  /**
   * Registrar el pago de una comisión.
   *
   * Se paga en dólares o en pesos. En pesos rige el TC BNA vendedor de la
   * factura al cliente (Maxi, 2026-11-23): se propone el del último cobro y
   * queda guardado con el pago. Si la persona tiene saldo pagado de más en
   * otra operación, se ofrece descontarlo acá.
   */
  function registrarPago(marcaId, clave) {
    const c = ctx();
    const m = c.marcasComision.find((x) => x.id === marcaId);
    if (!m) return;
    const l = CM.lineas(m, c).find((x) => x.clave === clave);
    if (!l) return;
    const saldos = CM.saldosACompensar(c, clave, l.moneda).filter((x) => x.marcaId !== m.id);
    const totalSaldo = E.money(saldos.reduce((s2, x) => s2 + x.monto, 0));
    const C = global.NEXO_CAMBIO;
    const tcSerie = C?.cotizacion?.(global.state?.tiposCambio || [], "USD", E.hoy());
    const tc = l.tcSugerido || (tcSerie ? { valor: tcSerie.tasa, fecha: tcSerie.fecha, comprobante: "" } : null);
    const sugerido = l.pendiente > 0 ? l.pendiente : Math.max(0, E.money(l.monto - l.pagado));

    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.id = "ovComision";
    ov.innerHTML = `<div class="modal" style="max-width:600px">
      <div class="kicker">Registrar pago</div>
      <h2>${esc(l.nombre)}</h2>
      <p class="muted" style="margin:2px 0 14px">${esc(m.origenNumero)} · ${l.abono
        ? `${money(l.mensual, l.moneda)} por mes` : `le corresponden ${money(l.monto, l.moneda)}`}
        · liberado ${money(l.liberado, l.moneda)}${l.pagado ? ` · ya pagado ${money(l.pagado, l.moneda)}` : ""}</p>
      ${l.pendiente <= 0 ? `<p class="card interno" style="font-size:13px">El cliente todavía no pagó lo que liberaría esta comisión.
        Se puede registrar igual si se adelanta: quedará como saldo a compensar si la operación se cae.</p>` : ""}
      ${totalSaldo > 0 ? `<div class="card" style="margin-bottom:12px;border-left:4px solid var(--orange)">
        <label style="font-weight:400"><input type="checkbox" id="pgCompensar" checked>
        Descontar ${money(totalSaldo, l.moneda)} pagados de más (${saldos.map((x) => esc(x.numero)).join(", ")})</label></div>` : ""}
      <div class="form-grid">
        <div class="field"><label for="pgFecha">Fecha de pago</label><input type="date" id="pgFecha" value="${E.hoy()}"></div>
        <div class="field"><label for="pgMonto">Comisión que se cancela (${esc(l.moneda)})</label>
          <input type="number" id="pgMonto" min="0" step="0.01" value="${sugerido}"></div>
      </div>
      <div class="form-grid">
        <div class="field"><label for="pgMoneda">Se paga en</label>
          <select id="pgMoneda"><option value="USD">Dólares</option><option value="ARS">Pesos</option></select></div>
        <div class="field" id="pgTcCampo" style="display:none"><label for="pgTc">TC BNA vendedor</label>
          <input type="number" id="pgTc" min="0" step="0.01" value="${tc?.valor ?? ""}">
          <p class="muted" style="font-size:12px;margin:4px 0 0">${tc
            ? `${l.tcSugerido ? "De la factura al cliente" : "Último de la serie"}${tc.comprobante ? ` ${esc(tc.comprobante)}` : ""}, ${esc(tc.fecha || "")}`
            : "Cargá el de la fecha de la factura al cliente"}</p></div>
      </div>
      <div class="form-grid">
        <div class="field"><label for="pgFactura">Factura del comercial</label>
          <input id="pgFactura" placeholder="N° de factura, si facturó"></div>
        <div class="field"><label for="pgRef">Referencia del pago</label>
          <input id="pgRef" placeholder="Transferencia, recibo, efectivo…"></div>
      </div>
      <div class="card interno" id="pgResumen" style="margin:8px 0"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px">
        <button class="btn ghost" onclick="cerrarModalComision()">Cancelar</button>
        <button class="btn primary" id="pgOk">Registrar</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    ov.style.display = "flex";
    const $ = (id) => document.getElementById(id);

    const calcular = () => {
      const monto = Number($("pgMonto").value) || 0;
      const compensa = $("pgCompensar")?.checked ? Math.min(totalSaldo, monto) : 0;
      const efectivo = E.money(monto - compensa);
      const ars = $("pgMoneda").value === "ARS";
      const tcv = Number($("pgTc").value) || 0;
      return { monto, compensa, efectivo, ars, tcv, enPesos: ars ? E.money(efectivo * tcv) : null };
    };
    const refrescar = () => {
      const x = calcular();
      $("pgTcCampo").style.display = x.ars ? "" : "none";
      $("pgResumen").innerHTML = `${x.compensa ? `Se descuentan ${money(x.compensa, l.moneda)} del saldo a compensar. ` : ""}
        Se paga <b>${x.ars ? (x.tcv ? money(x.enPesos, "ARS") + ` (${money(x.efectivo, l.moneda)} × ${num(x.tcv, 2)})` : "— falta el TC")
          : money(x.efectivo, l.moneda)}</b>.`;
    };
    ov.addEventListener("input", refrescar);
    ov.addEventListener("change", refrescar);
    refrescar();

    $("pgOk").onclick = async () => {
      const x = calcular();
      if (!(x.monto > 0)) { global.toast("Indicá cuánto de la comisión se cancela", true, true); return; }
      const comun = {
        beneficiario: clave, beneficiarioNombre: l.nombre,
        fecha: $("pgFecha").value, moneda: l.moneda, registradoPor: global.state?.user || "",
      };
      const nuevos = [];
      // Compensación: cuenta como pagado acá y cierra el saldo en la otra
      // operación con un ajuste negativo, para que no se descuente dos veces.
      const cierres = [];
      if (x.compensa > 0) {
        let resto = x.compensa;
        for (const sd of saldos) {
          if (resto <= 0) break;
          const parte = E.money(Math.min(resto, sd.monto));
          resto = E.money(resto - parte);
          nuevos.push({ ...comun, tipo: "Compensacion", monto: parte, compensaOrigen: sd.numero,
            referencia: `Descontado de lo pagado de más en ${sd.numero}` });
          cierres.push({ marcaId: sd.marcaId, pago: { ...comun, tipo: "Ajuste", monto: -parte,
            referencia: `Compensado en ${m.origenNumero}` } });
        }
      }
      if (x.efectivo > 0) {
        nuevos.push({ ...comun, tipo: "Pago", monto: x.efectivo,
          monedaPago: x.ars ? "ARS" : "USD",
          montoPagado: x.ars ? x.enPesos : x.efectivo,
          tcValor: x.ars ? x.tcv : null, tcFecha: x.ars ? (l.tcSugerido?.fecha || tc?.fecha || $("pgFecha").value) : null,
          facturaComercial: $("pgFactura").value.trim(), referencia: $("pgRef").value.trim() });
      }
      if (!(await guardarMarca({ ...m, pagos: [...m.pagos, ...nuevos] },
          `Pago de comisión ${m.origenNumero} · ${l.nombre}`))) return;
      for (const ci of cierres) {
        const otra = (global.state.marcasComision || []).find((z) => z.id === ci.marcaId);
        if (otra) await guardarMarca({ ...otra, pagos: [...otra.pagos, ci.pago] },
          `Compensación de comisión ${otra.origenNumero} en ${m.origenNumero}`);
      }
      cerrarModal();
      global.toast("Pago registrado");
      global.router();
    };
  }

  // ==========================================================================
  // Apartado Comisiones
  // ==========================================================================

  const filtro = () => (global.state.filtroCom = global.state.filtroCom ||
    { persona: "", estado: "", pais: "", q: "", sinComision: false });

  /**
   * Quién es el usuario como beneficiario. Un comercial o quien cobra una
   * parte del reparto ve solo sus líneas: transparente entre las partes, sin
   * mostrarle a cada uno lo de los demás.
   */
  function soloPropias() {
    const a = P.alcance ? P.alcance(rol(), "marcasComision", "leer") : null;
    if (a !== "propios") return null;
    const u = global.state?.user || "";
    const yo = (global.state?.vendedores || []).find((v) => v.usuarioId === u || v.nombre === u);
    return yo?.id || "—";
  }

  /** Filas visibles: por persona y estado se filtran las líneas, no la operación. */
  function filasFiltradas(c) {
    const f = filtro();
    const q = E.claveCliente(f.q || "");
    const yo = soloPropias();
    return CM.filasSeguimiento(c)
      .map((r) => (yo ? { ...r, lineas: r.lineas.filter((l) => l.vendedorId === yo) } : r))
      .filter((r) => !yo || r.lineas.length)
      .filter((r) => !f.pais || r.pais === f.pais)
      .filter((r) => !q || E.claveCliente(`${r.numero} ${r.cliente}`).includes(q))
      .map((r) => ({ ...r, lineas: r.lineas.filter((l) =>
        (!f.persona || l.nombre === f.persona) && (!f.estado || l.estado === f.estado)) }))
      .filter((r) => r.lineas.length ||
        (f.sinComision && !r.marca.lleva && !f.persona && !f.estado));
  }

  async function renderComisiones() {
    const el = document.getElementById("view-comisiones");
    if (!P.puede(rol(), "marcasComision", "leer")) {
      el.innerHTML = `<h1>Comi<span class="hl">siones</span></h1><p class="muted">Tu rol no tiene acceso a este apartado.</p>`;
      return;
    }
    if (global.asegurarHistorico) {
      el.innerHTML = `<div class="kicker">Equipo comercial</div><h1>Comi<span class="hl">siones</span></h1>
        <p class="muted">Cargando el historial completo…</p>`;
      try { await global.asegurarHistorico(); } catch (e) {
        global.toast("No se pudo cargar el historial completo: " + e.message, true, true);
      }
      if (!location.hash.startsWith("#comisiones")) return;
    }

    const c = ctx();
    const f = filtro();
    const yo = soloPropias();
    const todas = yo ? filasFiltradas({ ...c }) : CM.filasSeguimiento(c);
    const filas = filasFiltradas(c);
    const tot = CM.totalesSeguimiento(filas);
    const alertas = yo ? [] : CM.alertas(c);
    const personas = [...new Set(todas.flatMap((r) => r.lineas.map((l) => l.nombre)))].sort((a, b) => a.localeCompare(b, "es"));
    const paga = !yo && P.capacidad(rol(), "liquidar_comision");
    const edita = !yo && P.puede(rol(), "marcasComision", "editar");
    const sinMarca = todas.filter((r) => !r.marca.lleva).length;

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="flex:1">
          <div class="kicker">Equipo comercial</div>
          <h1>Comi<span class="hl">siones</span></h1>
        </div>
        <button class="btn" onclick="exportarComisionesCSV()">⬇ Excel</button>
        ${edita ? `<a class="btn ghost" href="#comhistorico">Cargar históricas</a>` : ""}
      </div>

      ${alertas.length ? `<div class="card" style="margin-top:16px;border-left:4px solid var(--orange)">
        <h3>⚠ ${alertas.length} comisión(es) para revisar</h3>
        <ul style="margin:8px 0 0;padding-left:18px;font-size:14px;line-height:1.7">
          ${alertas.slice(0, 12).map((a) => `<li>${esc(a.texto)}
            ${a.tipo === "SinMarcar"
              ? ` <button class="btn sm ghost" onclick="marcarComisionYVolver('${esc(a.origenTipo)}','${esc(a.origenId)}')">Marcar</button>`
              : ` <a href="${rutaOp(a.origenTipo, a.origenId)}">ver</a>`}</li>`).join("")}
        </ul>
        ${alertas.length > 12 ? `<p class="muted" style="font-size:13px">y ${alertas.length - 12} más.</p>` : ""}
      </div>` : ""}

      <div class="grid-kpi" style="margin:18px 0">
        ${["Prevista", "Devengada", "ACobrar", "Pagada", ...(Object.keys(tot.ACompensar).length ? ["ACompensar"] : [])]
          .map((e) => `<div class="kpi${Object.keys(tot[e]).length ? CLASE[e] || "" : ""}">
          <div class="label">${ETIQUETA[e]}</div>
          <div class="num num-${K.textoMonedas(tot[e]).length > 15 ? "sm" : "md"}">${K.textoMonedas(tot[e]) || "—"}</div>
          <div class="sub">${esc(TOTAL_AYUDA[e])}</div>
        </div>`).join("")}
      </div>

      <div class="card" style="margin-bottom:14px">
        <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
          <div class="field"><label for="fcQ">Buscar</label>
            <input id="fcQ" value="${esc(f.q)}" placeholder="N° o cliente"></div>
          <div class="field"><label for="fcPersona">Quién cobra</label>
            <select id="fcPersona"><option value="">Todos</option>${personas.map((p) =>
              `<option${p === f.persona ? " selected" : ""}>${esc(p)}</option>`).join("")}</select></div>
          <div class="field"><label for="fcEstado">Estado</label>
            <select id="fcEstado"><option value="">Todos</option>${E.COMISION_SEGUIMIENTO.map((e) =>
              `<option value="${e}"${e === f.estado ? " selected" : ""}>${ETIQUETA[e]}</option>`).join("")}</select></div>
          <div class="field"><label for="fcPais">País</label>
            <select id="fcPais"><option value="">Todos</option>${E.PAIS.map((p) =>
              `<option value="${p}"${p === f.pais ? " selected" : ""}>${esc(E.PAIS_NOMBRE[p])}</option>`).join("")}</select></div>
        </div>
        <label style="font-size:13px;font-weight:400"><input type="checkbox" id="fcSin"${f.sinComision ? " checked" : ""}>
          Mostrar también las operaciones marcadas sin comisión (${sinMarca})</label>
      </div>

      ${filas.length ? `<div style="overflow-x:auto"><table class="data">
        <thead><tr><th>Operación</th><th>Cliente</th><th>Tipo</th><th class="num">Base</th>
          <th>Quién cobra</th><th class="num">Comisión</th><th>Estado</th><th></th></tr></thead>
        <tbody>${filas.map((r) => {
          const op = `<a href="${rutaOp(r.marca.origenTipo, r.marca.origenId)}"><b>${esc(r.numero)}</b></a>
            <br><span class="muted" style="font-size:12px">${esc(r.fecha || "")}${r.marca.historico ? " · histórica" : ""}</span>`;
          if (!r.marca.lleva) {
            return `<tr><td>${op}</td><td>${esc(r.cliente)}</td><td>${esc(r.tipo)}</td><td></td>
              <td colspan="3" class="muted">Sin comisión${r.marca.motivo ? ` · ${esc(r.marca.motivo)}` : ""}</td>
              <td>${edita ? `<button class="btn sm ghost" onclick="marcarComisionYVolver('${esc(r.marca.origenTipo)}','${esc(r.marca.origenId)}')">Editar</button>` : ""}</td></tr>`;
          }
          return r.lineas.map((l, i) => `<tr>
            ${i === 0 ? `<td rowspan="${r.lineas.length}">${op}</td>
              <td rowspan="${r.lineas.length}">${esc(r.cliente)}</td>
              <td rowspan="${r.lineas.length}">${esc(r.tipo)}</td>
              <td rowspan="${r.lineas.length}" class="num">${money(l.base, l.moneda)}</td>` : ""}
            <td>${esc(l.nombre)} <span class="muted">${pct(l.porcentaje)}</span></td>
            <td class="num"><b>${l.abono ? `${money(l.mensual, l.moneda)}/mes` : money(l.monto, l.moneda)}</b>
              ${l.liberado > 0 && (l.abono || l.liberado < l.monto) ? `<br><span class="muted" style="font-size:11px">liberado ${money(l.liberado, l.moneda)}</span>` : ""}
              ${l.pagado ? `<br><span class="muted" style="font-size:11px">pagado ${money(l.pagado, l.moneda)}</span>` : ""}
              ${l.aCompensar ? `<br><span class="badge vencida" style="font-size:11px">a compensar ${money(l.aCompensar, l.moneda)}</span>` : ""}</td>
            <td><span class="pill" title="${esc(AYUDA[l.estado])}">${ETIQUETA[l.estado]}</span>
              ${l.dias != null && ["Devengada", "ACobrar"].includes(l.estado)
                ? `<br><span class="muted" style="font-size:11px">hace ${l.dias} días</span>` : ""}</td>
            <td style="white-space:nowrap">
              ${paga && (["Devengada", "ACobrar"].includes(l.estado) || (l.abono && l.estado === "Pagada"))
                ? `<button class="btn sm${l.estado === "ACobrar" ? " primary" : " ghost"}" onclick="registrarPagoComision('${esc(r.marca.id)}','${esc(l.clave)}')">Pagar</button>` : ""}
              ${edita && i === 0 && !r.marca.pagos.length
                ? `<button class="btn sm ghost" onclick="marcarComisionYVolver('${esc(r.marca.origenTipo)}','${esc(r.marca.origenId)}')">Editar</button>` : ""}
            </td>
          </tr>`).join("");
        }).join("")}</tbody>
      </table></div>` : `<p class="muted">${todas.length
        ? "Ninguna comisión con estos filtros."
        : "Todavía no hay operaciones marcadas. Se marcan al enviar un presupuesto o una propuesta, o desde Cargar históricas."}</p>`}

      <p class="muted" style="font-size:13px;margin-top:12px;max-width:80ch">
        El estado avanza solo: <b>Prevista</b> cuando sale la propuesta, <b>Ganada</b> cuando el cliente
        acepta, <b>A cobrar</b> a medida que se registran los cobros en Facturación, y <b>Pagada</b> cuando se carga el pago.
        Se calcula sobre el precio sin IVA, menos los costos si se cargaron; un abono se paga mes a mes.
        Lo pagado de una operación que se anula queda <b>a compensar</b> con la próxima. Los totales nunca suman monedas distintas.
      </p>`;

    const set = (k, v) => { f[k] = v; renderComisiones(); };
    document.getElementById("fcQ").onchange = (e) => set("q", e.target.value);
    document.getElementById("fcPersona").onchange = (e) => set("persona", e.target.value);
    document.getElementById("fcEstado").onchange = (e) => set("estado", e.target.value);
    document.getElementById("fcPais").onchange = (e) => set("pais", e.target.value);
    document.getElementById("fcSin").onchange = (e) => set("sinComision", e.target.checked);
  }

  function exportarComisionesCSV() {
    const c = ctx();
    const filas = filasFiltradas(c).flatMap((r) => (r.lineas.length ? r.lineas : [null]).map((l) => ({ r, l })));
    const n = T.exportarCSV(filas, [
      { titulo: "operacion", valor: (x) => x.r.numero },
      { titulo: "fecha", valor: (x) => x.r.fecha },
      { titulo: "cliente", valor: (x) => x.r.cliente },
      { titulo: "pais", valor: (x) => x.r.pais },
      { titulo: "tipo", valor: (x) => x.r.tipo },
      { titulo: "lleva_comision", valor: (x) => (x.r.marca.lleva ? "si" : "no") },
      { titulo: "criterio", valor: (x) => x.r.marca.criterio },
      { titulo: "motivo", valor: (x) => x.r.marca.motivo },
      { titulo: "cobra", valor: (x) => x.l?.nombre || "" },
      { titulo: "porcentaje", valor: (x) => (x.l ? String(x.l.porcentaje).replace(".", ",") : "") },
      { titulo: "moneda", valor: (x) => x.l?.moneda || "" },
      { titulo: "base", valor: (x) => (x.l ? String(x.l.base).replace(".", ",") : "") },
      { titulo: "comision", valor: (x) => (x.l ? String(x.l.monto).replace(".", ",") : "") },
      { titulo: "liberado", valor: (x) => (x.l ? String(x.l.liberado).replace(".", ",") : "") },
      { titulo: "pagado", valor: (x) => (x.l ? String(x.l.pagado).replace(".", ",") : "") },
      { titulo: "a_compensar", valor: (x) => (x.l ? String(x.l.aCompensar).replace(".", ",") : "") },
      { titulo: "costos", valor: (x) => (x.l ? String(x.l.costos || 0).replace(".", ",") : "") },
      { titulo: "estado", valor: (x) => (x.l ? ETIQUETA[x.l.estado] : "") },
      { titulo: "desde", valor: (x) => x.l?.desde || "" },
    ], "comisiones");
    global.toast(`${n} fila(s) exportadas`);
  }

  async function marcarComisionYVolver(origenTipo, origenId) {
    if (await marcarComision(origenTipo, origenId)) {
      global.toast("Comisión guardada");
      global.router();
    }
  }

  // ==========================================================================
  // Carga histórica
  // ==========================================================================

  async function renderComHistorico() {
    const el = document.getElementById("view-comhistorico");
    el.innerHTML = `<p class="muted">Cargando el historial completo…</p>`;
    try { await global.asegurarHistorico?.(); } catch (e) {
      global.toast("No se pudo cargar el historial completo: " + e.message, true, true);
    }
    if (!location.hash.startsWith("#comhistorico")) return;
    const c = ctx();
    const q = E.claveCliente(global.state.filtroComHist || "");
    const clientes = new Map(c.clientes.map((x) => [x.id, x.nombreComercial]));
    const ops = [
      ...c.presupuestos.filter((p) => p.estado === "Aprobado").map((op) => ({ tipo: "Presupuesto", op, fecha: op.fecha })),
      ...c.propuestas.filter((p) => p.estado === "Aceptada").map((op) => ({ tipo: "Propuesta", op, fecha: op.fechas?.creado })),
    ].filter((x) => !CM.marcaDe(x.tipo, x.op.id, c.marcasComision))
      .filter((x) => !q || E.claveCliente(`${x.op.numero} ${x.op.numeroLegado || ""} ${clientes.get(x.op.clienteId) || ""}`).includes(q))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

    el.innerHTML = `
      <a href="#comisiones" class="muted">← Comisiones</a>
      <div class="kicker" style="margin-top:8px">Equipo comercial</div>
      <h1>Comisiones <span class="hl">históricas</span></h1>
      <p class="muted" style="max-width:75ch">
        Operaciones ganadas que todavía no tienen marcado si llevan comisión. Sirve para registrar
        las que se acordaron antes de que existiera el seguimiento y marcar cuáles ya se pagaron.
        Al cargarlas se puede elegir cualquier comercial, aunque el lead no se le haya asignado: por eso piden motivo.
      </p>
      <div class="field" style="max-width:360px;margin:14px 0"><label for="fhQ">Buscar</label>
        <input id="fhQ" value="${esc(global.state.filtroComHist || "")}" placeholder="N° de presupuesto o cliente"></div>
      ${ops.length ? `<table class="data"><thead><tr><th>Operación</th><th>Fecha</th><th>Cliente</th><th class="num">Neto</th><th></th></tr></thead>
        <tbody>${ops.slice(0, 100).map((x) => {
          const b = CM.baseOperacion(x.tipo, x.op, null);
          return `<tr><td><a href="${rutaOp(x.tipo, x.op.id)}"><b>${esc(x.op.numero)}</b></a>${x.op.numeroLegado ? ` <span class="muted">(${esc(x.op.numeroLegado)})</span>` : ""}</td>
            <td>${esc(x.fecha || "")}</td><td>${esc(clientes.get(x.op.clienteId) || "—")}</td>
            <td class="num">${money(b.base, b.moneda)}</td>
            <td><button class="btn sm primary" onclick="cargarComisionHistorica('${x.tipo}','${esc(x.op.id)}')">Cargar comisión</button></td></tr>`;
        }).join("")}</tbody></table>
        ${ops.length > 100 ? `<p class="muted">Se muestran 100 de ${ops.length}: buscá por número o cliente.</p>` : ""}`
        : `<p class="muted">No hay operaciones ganadas sin marcar${q ? " con esa búsqueda" : ""}.</p>`}`;
    document.getElementById("fhQ").onchange = (e) => { global.state.filtroComHist = e.target.value; renderComHistorico(); };
  }

  async function cargarComisionHistorica(tipo, id) {
    if (await marcarComision(tipo, id, { historico: true })) {
      global.toast("Comisión histórica cargada. Si ya se pagó, registralo desde Comisiones.");
      global.router();
    }
  }

  // ==========================================================================
  // Para las otras pantallas
  // ==========================================================================

  /** Tarjeta con la comisión de una operación, para su pantalla de detalle. */
  function tarjetaComision(origenTipo, origenId) {
    if (!P.puede(rol(), "marcasComision", "leer")) return "";
    const c = ctx();
    const m = CM.marcaDe(origenTipo, origenId, c.marcasComision);
    const puede = P.puede(rol(), "marcasComision", m ? "editar" : "crear");
    const boton = puede && !(m?.pagos.length)
      ? `<button class="btn sm ghost" onclick="marcarComisionYVolver('${origenTipo}','${esc(origenId)}')">${m ? "Editar" : "Marcar"}</button>` : "";
    if (!m) {
      return `<div class="card"><h3>Comisión</h3>
        <p class="muted" style="font-size:13px">Todavía no se marcó si lleva comisión. Se pregunta al enviar. ${boton}</p></div>`;
    }
    if (!m.lleva) {
      return `<div class="card"><h3>Comisión</h3><p style="font-size:14px"><b>Sin comisión</b>${m.motivo ? ` · ${esc(m.motivo)}` : ""}</p>${boton}</div>`;
    }
    const ls = CM.lineas(m, c);
    return `<div class="card"><h3>Comisión</h3>
      <table class="data"><tbody>${ls.map((l) => `<tr><td>${esc(l.nombre)} <span class="muted">${pct(l.porcentaje)}</span></td>
        <td class="num">${money(l.monto, l.moneda)}</td><td><span class="pill">${ETIQUETA[l.estado]}</span></td></tr>`).join("")}</tbody></table>
      <p style="margin-top:8px"><a href="#comisiones">Ver comisiones</a> ${boton}</p></div>`;
  }

  /** Cantidad de alertas, para el menú. */
  function cantidadAlertas() {
    try { return soloPropias() ? 0 : CM.alertas(ctx()).length; } catch { return 0; }
  }

  // ==========================================================================

  global.NEXO_VISTAS = global.NEXO_VISTAS || {};
  Object.assign(global.NEXO_VISTAS, {
    comisiones: renderComisiones,
    comhistorico: renderComHistorico,
  });

  Object.assign(global, {
    marcarComision, marcarComisionYVolver, registrarPagoComision: registrarPago,
    cerrarModalComision: cerrarModal, exportarComisionesCSV, cargarComisionHistorica,
    tarjetaComision, cantidadAlertasComision: cantidadAlertas,
  });
})(typeof window !== "undefined" ? window : globalThis);
