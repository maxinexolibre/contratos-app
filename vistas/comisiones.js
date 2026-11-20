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
  const CLASE = { Prevista: "", Devengada: "", ACobrar: " warn", Pagada: "", Anulada: "" };

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
    const externos = c.vendedores.filter((v) => v.estado === "Activo" || v.id === existente?.externo?.vendedorId);
    const traido = c.vendedores.find((v) => v.id === sug.traidoPor);

    // Borrador de la decisión: lo existente, o lo que propone la app.
    const d = existente ? structuredClone(existente) : {
      origenTipo, origenId, origenNumero: op.numero, clienteId: op.clienteId,
      lleva: sug.lleva, area: sug.lleva !== false,
      externo: sug.externo ? { ...sug.externo } : null,
      criterio: historico ? "Historico" : sug.criterio,
      primeraActividad: sug.primeraActividad, historico, motivo: "", pagos: [],
    };
    const conPagos = (existente?.pagos || []).length > 0;

    return new Promise((resolver) => {
      const ov = document.createElement("div");
      ov.className = "overlay";
      ov.id = "ovComision";
      const criterioTxt = {
        ClienteNuevo: "✓ Corresponde", ClienteExistente: "✕ No corresponde", Consulta: "? Hay que decidir",
      }[sug.criterio];

      ov.innerHTML = `<div class="modal" style="max-width:620px">
        <div class="kicker">${historico ? "Carga histórica" : "Antes de enviar"}</div>
        <h2>¿Lleva comisión?</h2>
        <p class="muted" style="margin:2px 0 14px">${esc(op.numero)} · ${esc(cliente?.nombreComercial || "cliente sin identificar")}</p>

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
            Área comercial · ${pct(CM.PORCENTAJE_AREA)} del neto
            <span class="muted">(${CM.REPARTO_INTERNO.map((r) => `${esc(r.area)} ${pct(r.porcentaje)}`).join(" · ")})</span>
          </label></div>

          ${historico ? `<div class="form-grid">
            <div class="field"><label for="mcExt">Comercial externo</label>
              <select id="mcExt"${conPagos ? " disabled" : ""}><option value="">— Ninguno —</option>${externos.map((v) =>
                `<option value="${esc(v.id)}"${d.externo?.vendedorId === v.id ? " selected" : ""}>${esc(v.nombre)}</option>`).join("")}</select></div>
            <div class="field"><label for="mcPct">% del neto</label>
              <input type="number" id="mcPct" min="0" max="100" step="0.5" value="${d.externo?.porcentaje ?? ""}"${conPagos ? " disabled" : ""}></div>
          </div>` : traido ? `<div class="form-grid">
            <div class="field"><label style="font-weight:400">
              <input type="checkbox" id="mcExtOn"${d.externo ? " checked" : ""}${conPagos ? " disabled" : ""}>
              <b>${esc(traido.nombre)}</b> · trajo el lead</label></div>
            <div class="field"><label for="mcPct">% del neto</label>
              <input type="number" id="mcPct" min="0" max="100" step="0.5" value="${d.externo?.porcentaje ?? ""}"${conPagos ? " disabled" : ""}
                placeholder="sin acuerdo cargado"></div>
          </div>` : `<p class="muted" style="font-size:13px">
            El lead es propio de Nexo: no tiene asignado un comercial externo.
            ${sug.ticketId ? `Si lo trajo un externo, asignáselo en el <a href="#tkdetalle/${esc(sug.ticketId)}">ticket</a> antes de enviar.`
              : "Para que cobre un externo, la operación tiene que salir de un ticket con quién trajo el lead."}</p>`}
        </div>

        <div class="field"><label for="mcMotivo">Motivo <span class="muted" id="mcMotivoAyuda"></span></label>
          <textarea id="mcMotivo" rows="2" placeholder="Por qué corresponde o no corresponde">${esc(d.motivo || "")}</textarea></div>

        <div class="card" id="mcPrevia" style="margin:12px 0"></div>

        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
          <button class="btn ghost" id="mcCancelar">Cancelar</button>
          <button class="btn primary" id="mcGuardar">${opciones.alGuardar || "Guardar"}</button>
        </div>
      </div>`;
      document.body.appendChild(ov);
      ov.style.display = "flex";

      const $ = (id) => document.getElementById(id);
      const leer = () => {
        const v = document.querySelector('input[name="mcLleva"]:checked')?.value;
        d.lleva = v === "si" ? true : v === "no" ? false : null;
        d.motivo = $("mcMotivo").value.trim();
        if (!d.lleva) { d.area = false; d.externo = null; return; }
        d.area = $("mcArea").checked;
        const p = Number($("mcPct")?.value);
        if (historico) {
          const id = $("mcExt").value;
          d.externo = id ? { vendedorId: id, porcentaje: p } : null;
        } else if (traido) {
          d.externo = $("mcExtOn").checked ? { vendedorId: traido.id, porcentaje: p } : null;
        } else {
          d.externo = null;
        }
      };
      const refrescar = () => {
        leer();
        $("mcQuienes").style.display = d.lleva ? "" : "none";
        const contradice = (sug.criterio === "ClienteNuevo" && d.lleva === false) ||
          (sug.criterio === "ClienteExistente" && d.lleva === true);
        $("mcMotivoAyuda").textContent = contradice || sug.criterio === "Consulta" || historico
          ? "· obligatorio" : "· opcional";
        const prev = $("mcPrevia");
        if (d.lleva == null) { prev.innerHTML = `<span class="muted">Elegí sí o no.</span>`; return; }
        if (!d.lleva) { prev.innerHTML = `<b>Sin comisión.</b> <span class="muted">Queda registrado para que no se reclame después.</span>`; return; }
        const ls = CM.lineas(E.ENTIDADES.marcasComision.normalizar(d), c);
        prev.innerHTML = ls.length ? `<table class="data"><tbody>${ls.map((l) => `<tr>
            <td>${esc(l.nombre)}</td><td class="num">${pct(l.porcentaje)}</td>
            <td class="num"><b>${money(l.monto, l.moneda)}</b></td></tr>`).join("")}
          </tbody></table><p class="muted" style="font-size:12px;margin:6px 0 0">Sobre ${esc(ls[0].detalle.split(" sobre ")[1] || "")}: ${money(ls[0].base, ls[0].moneda)}</p>`
          : `<span class="muted">Marcá quién cobra.</span>`;
      };
      ov.addEventListener("input", refrescar);
      ov.addEventListener("change", refrescar);
      refrescar();

      $("mcCancelar").onclick = () => { cerrarModal(); resolver(false); };
      $("mcGuardar").onclick = async () => {
        leer();
        if (d.lleva == null) { global.toast("Elegí si lleva comisión o no", true, true); return; }
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

  function registrarPago(marcaId, clave) {
    const c = ctx();
    const m = c.marcasComision.find((x) => x.id === marcaId);
    if (!m) return;
    const l = CM.lineas(m, c).find((x) => x.clave === clave);
    if (!l) return;
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.id = "ovComision";
    ov.innerHTML = `<div class="modal">
      <div class="kicker">Registrar pago</div>
      <h2>${esc(l.nombre)}</h2>
      <p class="muted" style="margin:2px 0 14px">${esc(m.origenNumero)} · le corresponden ${money(l.monto, l.moneda)}
        ${l.pagado ? ` · ya se pagaron ${money(l.pagado, l.moneda)}` : ""}</p>
      ${l.estado === "Devengada" ? `<p class="card interno" style="font-size:13px">El cliente todavía no pagó esta operación.
        Se puede registrar igual si la comisión se adelantó.</p>` : ""}
      <div class="form-grid">
        <div class="field"><label for="pgFecha">Fecha de pago</label><input type="date" id="pgFecha" value="${E.hoy()}"></div>
        <div class="field"><label for="pgMonto">Monto (${esc(l.moneda)})</label>
          <input type="number" id="pgMonto" min="0" step="0.01" value="${l.pendiente}"></div>
      </div>
      <div class="field"><label for="pgRef">Referencia</label>
        <input id="pgRef" placeholder="Transferencia, recibo, factura del comercial…"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px">
        <button class="btn ghost" onclick="cerrarModalComision()">Cancelar</button>
        <button class="btn primary" id="pgOk">Registrar</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    ov.style.display = "flex";
    document.getElementById("pgOk").onclick = async () => {
      const pago = {
        beneficiario: clave,
        fecha: document.getElementById("pgFecha").value,
        monto: Number(document.getElementById("pgMonto").value),
        moneda: l.moneda,
        referencia: document.getElementById("pgRef").value.trim(),
        registradoPor: global.state?.user || "",
      };
      if (await guardarMarca({ ...m, pagos: [...m.pagos, pago] },
          `Pago de comisión ${m.origenNumero} · ${l.nombre}`)) {
        cerrarModal();
        global.toast("Pago registrado");
        global.router();
      }
    };
  }

  // ==========================================================================
  // Apartado Comisiones
  // ==========================================================================

  const filtro = () => (global.state.filtroCom = global.state.filtroCom ||
    { persona: "", estado: "", pais: "", q: "", sinComision: false });

  /** Filas filtradas: por persona y estado se filtran las líneas, no la operación. */
  function filasFiltradas(c) {
    const f = filtro();
    const q = E.claveCliente(f.q || "");
    return CM.filasSeguimiento(c)
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
    const todas = CM.filasSeguimiento(c);
    const filas = filasFiltradas(c);
    const tot = CM.totalesSeguimiento(filas);
    const alertas = CM.alertas(c);
    const personas = [...new Set(todas.flatMap((r) => r.lineas.map((l) => l.nombre)))].sort((a, b) => a.localeCompare(b, "es"));
    const paga = P.capacidad(rol(), "liquidar_comision");
    const sinMarca = todas.filter((r) => !r.marca.lleva).length;

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="flex:1">
          <div class="kicker">Equipo comercial</div>
          <h1>Comi<span class="hl">siones</span></h1>
        </div>
        <button class="btn" onclick="exportarComisionesCSV()">⬇ Excel</button>
        <a class="btn ghost" href="#comhistorico">Cargar históricas</a>
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
        ${["Prevista", "Devengada", "ACobrar", "Pagada"].map((e) => `<div class="kpi${Object.keys(tot[e]).length ? CLASE[e] : ""}">
          <div class="label">${ETIQUETA[e]}</div>
          <div class="num num-${K.textoMonedas(tot[e]).length > 15 ? "sm" : "md"}">${K.textoMonedas(tot[e]) || "—"}</div>
          <div class="sub">${esc(AYUDA[e])}</div>
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
              <td><button class="btn sm ghost" onclick="marcarComisionYVolver('${esc(r.marca.origenTipo)}','${esc(r.marca.origenId)}')">Editar</button></td></tr>`;
          }
          return r.lineas.map((l, i) => `<tr>
            ${i === 0 ? `<td rowspan="${r.lineas.length}">${op}</td>
              <td rowspan="${r.lineas.length}">${esc(r.cliente)}</td>
              <td rowspan="${r.lineas.length}">${esc(r.tipo)}</td>
              <td rowspan="${r.lineas.length}" class="num">${money(l.base, l.moneda)}</td>` : ""}
            <td>${esc(l.nombre)} <span class="muted">${pct(l.porcentaje)}</span></td>
            <td class="num"><b>${money(l.monto, l.moneda)}</b>${l.pagado && l.estado !== "Pagada"
              ? `<br><span class="muted" style="font-size:11px">pagado ${money(l.pagado, l.moneda)}</span>` : ""}</td>
            <td><span class="pill" title="${esc(AYUDA[l.estado])}">${ETIQUETA[l.estado]}</span>
              ${l.dias != null && ["Devengada", "ACobrar"].includes(l.estado)
                ? `<br><span class="muted" style="font-size:11px">hace ${l.dias} días</span>` : ""}</td>
            <td style="white-space:nowrap">
              ${paga && ["Devengada", "ACobrar"].includes(l.estado)
                ? `<button class="btn sm${l.estado === "ACobrar" ? " primary" : " ghost"}" onclick="registrarPagoComision('${esc(r.marca.id)}','${esc(l.clave)}')">Pagar</button>` : ""}
              ${i === 0 && !r.marca.pagos.length
                ? `<button class="btn sm ghost" onclick="marcarComisionYVolver('${esc(r.marca.origenTipo)}','${esc(r.marca.origenId)}')">Editar</button>` : ""}
            </td>
          </tr>`).join("");
        }).join("")}</tbody>
      </table></div>` : `<p class="muted">${todas.length
        ? "Ninguna comisión con estos filtros."
        : "Todavía no hay operaciones marcadas. Se marcan al enviar un presupuesto o una propuesta, o desde Cargar históricas."}</p>`}

      <p class="muted" style="font-size:13px;margin-top:12px;max-width:80ch">
        El estado avanza solo: <b>Prevista</b> cuando sale la propuesta, <b>Ganada</b> cuando el cliente
        acepta, <b>A cobrar</b> cuando se registra el cobro en Facturación, y <b>Pagada</b> cuando se carga el pago.
        Se calcula sobre el neto, sin IVA; un abono mensual, sobre 12 meses. Los totales nunca suman monedas distintas.
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
      { titulo: "pagado", valor: (x) => (x.l ? String(x.l.pagado).replace(".", ",") : "") },
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
    try { return CM.alertas(ctx()).length; } catch { return 0; }
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
