/**
 * Área de Vendedores: legajo, acuerdos de comisión y liquidación.
 *
 * Lo que un gerente comercial necesita tener a mano sobre su equipo:
 *
 *   Quiénes son          alta, datos de contacto, relación (interno/externo),
 *                        zona, cuota mensual.
 *   Bajo qué condiciones acuerdo de comisión vigente, versionado por fecha.
 *   Cuánto rinden        conversión, ciclo, ticket promedio, cumplimiento de
 *                        cuota, pipeline propio.
 *   Cuánto se les debe   comisiones devengadas, aprobadas y liquidadas, y el
 *                        costo comercial que representan sobre lo vendido.
 *
 * El circuito de una comisión tiene cuatro estados y no se saltean:
 *   Devengada → Aprobada → Liquidada,  o  → Anulada (con motivo).
 * Nadie aprueba la propia, y con `pagoTrasCobro` no se liquida hasta que la
 * operación esté facturada.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;
  const R = global.NEXO_REGLAS;
  const K = global.NEXO_KPI;
  const P = global.NEXO_PERMISOS;
  const CM = global.NEXO_COMISIONES;
  const AD = global.NEXO_ADAPTADOR;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n, d = 0) => n === null || n === undefined
    ? "—" : Number(n).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pctTxt = (v) => (v === null || v === undefined ? "—" : `${num(v, 1)}%`);
  const SIM = { USD: "US$", UF: "UF", ARS: "$", CLP: "CLP$" };
  const money = (v, m = "USD") => (v === null || v === undefined ? "—" : `${SIM[m] || m} ${num(v, 0)}`);

  const vendedores = () => global.state?.vendedores || [];
  const acuerdos = () => global.state?.acuerdosComision || [];
  const comisiones = () => global.state?.comisiones || [];
  const rol = () => global.state?.rol || "admin";

  /** Contexto completo para reglas y KPIs. */
  function ctx() {
    const n = AD.estadoANuevo(global.state || {});
    return {
      ...n,
      vendedores: vendedores(),
      acuerdosComision: acuerdos(),
      acuerdos: acuerdos(),
      comisiones: comisiones(),
      facturaciones: global.state?.facturaciones || [],
      rol: rol(),
      usuario: global.state?.user || "",
    };
  }

  async function guardar(entidad, registro, mensaje) {
    const c = ctx();
    const normalizado = E.ENTIDADES[entidad].normalizar(registro);
    const anterior = (global.state[entidad] || []).find((x) => x.id === normalizado.id) || null;
    try {
      R.validar(entidad, anterior ? "editar" : "crear", normalizado, anterior, c);
    } catch (e) {
      global.toast(e.sugerencia ? `${e.message} — ${e.sugerencia}` : e.message, true, true);
      return false;
    }
    const resto = (global.state[entidad] || []).filter((x) => x.id !== normalizado.id);
    global.state[entidad] = [...resto, normalizado];
    await global.persist(mensaje, entidad);
    return true;
  }

  // ==========================================================================
  // Panel del equipo
  // ==========================================================================

  function renderVendedores() {
    const c = ctx();
    const panel = CM.panelVendedores(vendedores().filter((v) => v.estado === "Activo"), c);
    const inactivos = vendedores().filter((v) => v.estado === "Inactivo");
    const res = CM.resumen(comisiones());

    const totalPendiente = {};
    for (const est of ["Devengada", "Aprobada"]) {
      for (const [m, v] of Object.entries(res[est])) {
        totalPendiente[m] = E.money((totalPendiente[m] || 0) + v);
      }
    }

    const vacio = !vendedores().length;

    document.getElementById("view-vendedores").innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap">
        <div style="flex:1">
          <div class="kicker">Equipo comercial</div>
          <h1>Vende<span class="hl">dores</span></h1>
        </div>
        ${P.puede(rol(), "vendedores", "crear")
          ? `<a class="btn primary" href="#vndform">+ Nuevo vendedor</a>` : ""}
      </div>

      ${vacio ? `<div class="card" style="margin-top:18px">
        <h3>Todavía no hay vendedores cargados</h3>
        <p class="muted" style="max-width:65ch">
          Un vendedor es quien cobra comisión, que no es lo mismo que un usuario de
          la aplicación: un representante externo comisiona sin tener acceso, y un
          gerente puede tener acceso sin comisionar.
        </p>
        <p style="margin-top:12px"><a class="btn primary" href="#vndform">Dar de alta el primero</a></p>
      </div>` : `

      <div class="grid-kpi" style="margin:18px 0">
        <div class="kpi">
          <div class="label">Activos</div>
          <div class="num num-lg">${panel.length}</div>
          <div class="sub">${inactivos.length ? `${inactivos.length} inactivo(s)` : "equipo completo"}</div>
        </div>
        <div class="kpi${Object.keys(totalPendiente).length ? " warn" : ""}">
          <div class="label">Comisiones a pagar</div>
          <div class="num num-${K.textoMonedas(totalPendiente).length > 15 ? "sm" : "md"}">${K.textoMonedas(totalPendiente)}</div>
          <div class="sub">devengadas + aprobadas</div>
        </div>
        <div class="kpi">
          <div class="label">Liquidado</div>
          <div class="num num-${K.textoMonedas(res.Liquidada).length > 15 ? "sm" : "md"}">${K.textoMonedas(res.Liquidada)}</div>
          <div class="sub">histórico pagado</div>
        </div>
        <div class="kpi">
          <div class="label">Sin acuerdo vigente</div>
          <div class="num num-lg">${panel.filter((v) => !CM.acuerdoVigente(acuerdos(), v.id, E.hoy())).length}</div>
          <div class="sub">no pueden devengar</div>
        </div>
      </div>

      <div class="card">
        <h3>Rendimiento del equipo</h3>
        <div style="overflow-x:auto"><table class="data" style="margin-top:12px">
          <thead><tr>
            <th>Vendedor</th><th>Relación</th><th class="num">Tickets</th>
            <th class="num">Ganados</th><th class="num">Conversión</th><th class="num">Ciclo</th>
            <th class="num">Ingresos</th><th class="num">Cuota</th>
            <th class="num">Pendiente</th><th class="num">Costo com.</th>
          </tr></thead>
          <tbody>${panel.map((v) => {
            const acu = CM.acuerdoVigente(acuerdos(), v.id, E.hoy());
            return `<tr onclick="location.hash='vnddetalle/${esc(v.id)}'">
              <td><b>${esc(v.nombre)}</b>${acu ? "" : ` <span class="muted" title="Sin acuerdo de comisión vigente">⚠</span>`}
                  ${v.zona ? `<br><span class="muted" style="font-size:12px">${esc(v.zona)}</span>` : ""}</td>
              <td><span class="pill">${esc(v.relacion)}</span></td>
              <td class="num">${v.tickets}</td>
              <td class="num">${v.ganados}</td>
              <td class="num">${pctTxt(v.tasaConversion)}<br><span class="muted" style="font-size:11px">n=${(v.ganados || 0) + (v.tickets - v.ganados - v.abiertos)}</span></td>
              <td class="num">${v.cicloPromedio === null ? "—" : num(v.cicloPromedio, 0) + " d"}</td>
              <td class="num">${K.textoMonedas(v.ingresos)}</td>
              <td class="num">${v.metaMensual > 0 ? pctTxt(v.cumplimiento) : "—"}</td>
              <td class="num">${v.pendienteDePago > 0 ? money(v.pendienteDePago, v.metaMoneda) : "—"}</td>
              <td class="num">${pctTxt(v.costoComercial)}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
        <p class="muted" style="font-size:13px; margin-top:10px">
          La <b>conversión</b> se mide sobre tickets resueltos (ganados + perdidos), no sobre
          todos: un ticket abierto todavía no perdió. El <b>n</b> es el tamaño de muestra —
          un 60% sobre 3 casos y sobre 30 no significan lo mismo.
          El <b>costo comercial</b> es cuánto de lo vendido se va en comisión.
        </p>
      </div>

      ${panelReparto()}

      ${inactivos.length ? `<h3 style="margin-top:24px">Inactivos</h3>
      <table class="data">
        <thead><tr><th>Vendedor</th><th>Relación</th><th>Alta</th><th>Baja</th></tr></thead>
        <tbody>${inactivos.map((v) => `<tr onclick="location.hash='vnddetalle/${esc(v.id)}'">
          <td>${esc(v.nombre)}</td><td>${esc(v.relacion)}</td>
          <td>${esc(v.fechaAlta)}</td><td>${esc(v.fechaBaja || "—")}</td>
        </tr>`).join("")}</tbody>
      </table>` : ""}`}
    `;
  }

  /**
   * Reparto interno fijo: 3% gerencia comercial + 0,5% marketing +
   * 0,5% diseño + 0,5% ventas sobre el neto de toda venta concretada.
   *
   * Se muestra siempre, esté activo o no, porque es una regla de la empresa
   * y su ausencia también es información.
   */
  function panelReparto() {
    const activos = acuerdos().filter(
      (a) => a.alcance === "Area" && CM.rigeEn(a, E.hoy()));
    const totalPct = CM.REPARTO_INTERNO.reduce((s, r) => s + r.porcentaje, 0);
    const resArea = CM.resumenPorArea(comisiones());

    return `<div class="card" style="margin-top:18px">
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap">
        <h3 style="flex:1; margin:0">Reparto interno</h3>
        ${activos.length
          ? `<span class="pill">activo</span>`
          : (P.puede(rol(), "acuerdosComision", "crear")
            ? `<button class="btn sm primary" onclick="activarReparto()">Activar reparto</button>` : "")}
      </div>
      <p class="muted" style="font-size:13px; margin:8px 0 12px; max-width:72ch">
        Asignación fija sobre el <b>neto</b> de toda venta concretada en
        ${CM.PAISES_REPARTO.map((p) => E.PAIS_NOMBRE[p]).join(" · ")}.
        Corre en paralelo a lo pactado con el vendedor y no espera al cobro:
        es asignación de resultado, no un pago a un tercero.
      </p>
      <table class="data">
        <thead><tr><th>Área</th><th class="num">%</th><th>Vigencia</th><th class="num">Devengado</th></tr></thead>
        <tbody>${CM.REPARTO_INTERNO.map((r) => {
          const a = activos.find((x) => x.area === r.area);
          return `<tr>
            <td><b>${esc(r.area)}</b></td>
            <td class="num">${r.porcentaje}%</td>
            <td>${a ? esc(a.vigenciaDesde) + " → " + esc(a.vigenciaHasta || "sin fin")
              : `<span class="muted">sin activar</span>`}</td>
            <td class="num">${K.textoMonedas(resArea[r.area] || {})}</td>
          </tr>`;
        }).join("")}
        <tr style="font-weight:700">
          <td>Total</td><td class="num">${totalPct}%</td><td></td>
          <td class="num">${K.textoMonedas(
            Object.values(resArea).reduce((acc, m) => {
              for (const [k, v] of Object.entries(m)) acc[k] = E.money((acc[k] || 0) + v);
              return acc;
            }, {}))}</td>
        </tr></tbody>
      </table>
    </div>`;
  }

  /** Da de alta los cuatro acuerdos de área de una sola vez. */
  async function activarReparto() {
    const desde = prompt(
      "Desde qué fecha rige el reparto interno.\n\n" +
      "Las ventas anteriores a esta fecha no lo devengan: un acuerdo no se " +
      "aplica hacia atrás.", E.hoy());
    if (!desde) return;

    let alta = 0;
    for (const a of CM.acuerdosReparto(desde)) {
      if (await guardar("acuerdosComision", a, `Reparto interno · ${a.area} ${a.porcentaje}%`)) alta++;
    }
    global.toast(alta ? `Reparto interno activado (${alta} áreas)` : "No se activó ninguna", !alta);
    global.router();
  }

  // ==========================================================================
  // Legajo del vendedor
  // ==========================================================================

  function renderVndDetalle(id) {
    const v = vendedores().find((x) => x.id === id);
    if (!v) { global.go("vendedores"); return; }
    const c = ctx();
    const kpi = CM.panelVendedores([v], c)[0];
    const acus = acuerdos().filter((a) => a.vendedorId === id)
      .sort((a, b) => b.vigenciaDesde.localeCompare(a.vigenciaDesde));
    const vigente = CM.acuerdoVigente(acuerdos(), id, E.hoy());
    const coms = comisiones().filter((x) => x.vendedorId === id)
      .sort((a, b) => b.fechaDevengo.localeCompare(a.fechaDevengo));

    document.getElementById("view-vnddetalle").innerHTML = `
      <a href="#vendedores" class="muted">← Vendedores</a>
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:8px">
        <div style="flex:1">
          <div class="kicker">${esc(v.relacion)}${v.zona ? " · " + esc(v.zona) : ""}</div>
          <h1>${esc(v.nombre)}</h1>
          <p class="muted" style="margin:4px 0 0">
            ${[v.email, v.telefono, v.documento].filter(Boolean).map(esc).join(" · ") || "sin datos de contacto"}
            ${v.estado === "Inactivo" ? ` · <b>Baja ${esc(v.fechaBaja)}</b>` : ""}
          </p>
        </div>
        <a class="btn ghost" href="#vndform/${esc(v.id)}">Editar</a>
      </div>

      <div class="grid-kpi" style="margin:18px 0">
        <div class="kpi"><div class="label">Tickets ganados</div><div class="num num-lg">${kpi.ganados}</div><div class="sub">de ${kpi.tickets}</div></div>
        <div class="kpi"><div class="label">Conversión</div><div class="num num-lg">${pctTxt(kpi.tasaConversion)}</div><div class="sub">sobre resueltos</div></div>
        <div class="kpi"><div class="label">Ciclo</div><div class="num num-lg">${kpi.cicloPromedio === null ? "—" : num(kpi.cicloPromedio, 0) + " d"}</div><div class="sub">solo ganados</div></div>
        <div class="kpi"><div class="label">Ingresos</div><div class="num num-${K.textoMonedas(kpi.ingresos).length > 15 ? "sm" : "md"}">${K.textoMonedas(kpi.ingresos)}</div><div class="sub">contratos firmados</div></div>
        <div class="kpi"><div class="label">Pipeline propio</div><div class="num num-${K.textoMonedas(kpi.pipeline).length > 15 ? "sm" : "md"}">${K.textoMonedas(kpi.pipeline)}</div><div class="sub">${kpi.abiertos} abiertos</div></div>
        ${v.metaMensual > 0 ? `<div class="kpi${kpi.cumplimiento !== null && kpi.cumplimiento < 80 ? " warn" : ""}">
          <div class="label">Cuota</div><div class="num num-lg">${pctTxt(kpi.cumplimiento)}</div>
          <div class="sub">meta ${money(v.metaMensual, v.metaMoneda)}</div></div>` : ""}
      </div>

      <div class="card">
        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap">
          <h3 style="flex:1; margin:0">Acuerdos de comisión</h3>
          ${P.puede(rol(), "acuerdosComision", "crear")
            ? `<button class="btn sm ghost" onclick="nuevoAcuerdo('${esc(v.id)}')">+ Nuevo acuerdo</button>` : ""}
        </div>
        ${!vigente ? `<p class="muted" style="margin-top:10px">
          <b>Sin acuerdo vigente hoy.</b> No se le puede devengar comisión hasta cargar uno.
        </p>` : ""}
        ${acus.length ? `<table class="data" style="margin-top:12px">
          <thead><tr><th>Vigencia</th><th>Modalidad</th><th>Condiciones</th><th>Base</th><th>Pago</th><th></th></tr></thead>
          <tbody>${acus.map((a) => `<tr>
            <td>${esc(a.vigenciaDesde)} → ${esc(a.vigenciaHasta || "sin fin")}
              ${a.id === vigente?.id ? `<br><span class="pill">vigente</span>` : ""}</td>
            <td>${esc(a.modalidad)}</td>
            <td>${esc(describirAcuerdo(a))}</td>
            <td>${esc(a.base)}</td>
            <td>${a.pagoTrasCobro ? "tras cobro" : "al devengar"}</td>
            <td>${!a.vigenciaHasta && a.id === vigente?.id
              ? `<button class="btn sm ghost" onclick="cerrarAcuerdo('${esc(a.id)}')">Cerrar vigencia</button>` : ""}</td>
          </tr>`).join("")}</tbody>
        </table>
        <p class="muted" style="font-size:13px; margin-top:10px">
          Un acuerdo con comisiones ya calculadas no se edita: se le cierra la vigencia
          y se crea otro. Así una comisión vieja siempre se puede explicar con las
          reglas que regían ese día.
        </p>` : `<p class="muted" style="margin-top:12px">Sin acuerdos cargados.</p>`}
      </div>

      <div class="card" style="margin-top:18px">
        <h3>Comisiones</h3>
        ${coms.length ? tablaComisiones(coms) : `<p class="muted" style="margin-top:12px">Sin comisiones registradas.</p>`}
      </div>
    `;
  }

  /** Resumen legible de las condiciones de un acuerdo. */
  function describirAcuerdo(a) {
    const m = SIM[a.moneda] || a.moneda;
    switch (a.modalidad) {
      case "Porcentaje": return `${a.porcentaje}%` + (a.tope ? ` (tope ${m} ${num(a.tope)})` : "");
      case "Fija": return `${m} ${num(a.montoFijo)} por operación`;
      case "Escalonada":
      case "Mixta": {
        const tramos = a.escalones.map((e) =>
          `${e.porcentaje}% ${num(e.desde)}–${e.hasta === null ? "∞" : num(e.hasta)}`).join(" · ");
        return (a.modalidad === "Mixta" ? `${m} ${num(a.montoFijo)} + ` : "") + tramos;
      }
      default: return "—";
    }
  }

  function tablaComisiones(coms) {
    return `<div style="overflow-x:auto"><table class="data" style="margin-top:12px">
      <thead><tr>
        <th>Período</th><th>Origen</th><th class="num">Base</th><th class="num">%</th>
        <th class="num">Comisión</th><th>Estado</th><th>Cálculo</th><th></th>
      </tr></thead>
      <tbody>${coms.map((c) => {
        const puede = CM.puedeLiquidarse(c, ctx());
        return `<tr>
          <td>${esc(c.periodo)}</td>
          <td>${esc(c.origenNumero || c.origenId)}<br><span class="muted" style="font-size:11px">${esc(c.origenTipo)}</span></td>
          <td class="num">${money(c.baseCalculo, c.moneda)}</td>
          <td class="num">${num(c.porcentajeAplicado, 2)}%</td>
          <td class="num"><b>${money(c.monto, c.moneda)}</b></td>
          <td><span class="pill">${esc(c.estado)}</span></td>
          <td class="muted" style="font-size:11px; max-width:220px">${esc(c.detalleCalculo)}</td>
          <td style="white-space:nowrap">
            ${c.estado === "Devengada" && P.capacidad(rol(), "aprobar_comision")
              ? `<button class="btn sm ghost" onclick="aprobarComision('${esc(c.id)}')">Aprobar</button>` : ""}
            ${c.estado === "Aprobada" && P.capacidad(rol(), "liquidar_comision")
              ? (puede.puede
                  ? `<button class="btn sm primary" onclick="liquidarComision('${esc(c.id)}')">Liquidar</button>`
                  : `<span class="muted" title="${esc(puede.motivo)}">bloqueada</span>`) : ""}
            ${["Devengada", "Aprobada"].includes(c.estado)
              ? `<button class="btn sm ghost" onclick="anularComision('${esc(c.id)}')">Anular</button>` : ""}
          </td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  }

  // ==========================================================================
  // Formulario de vendedor
  // ==========================================================================

  function renderVndForm(id) {
    const v = id ? vendedores().find((x) => x.id === id) : null;
    const d = v || E.ENTIDADES.vendedores.normalizar({ fechaAlta: E.hoy() });
    document.getElementById("view-vndform").innerHTML = `
      <a href="#vendedores" class="muted">← Vendedores</a>
      <h1 style="margin-top:8px">${v ? "Editar" : "Nuevo"} <span class="hl">vendedor</span></h1>
      <div class="card" style="margin-top:16px">
        <div class="form-grid">
          <div class="field"><label for="vNombre">Nombre y apellido</label>
            <input id="vNombre" value="${esc(d.nombre)}" /></div>
          <div class="field"><label for="vRelacion">Relación</label>
            <select id="vRelacion">${E.VENDEDOR_RELACION.map((x) =>
              `<option value="${x}"${d.relacion === x ? " selected" : ""}>${x}</option>`).join("")}</select></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="vEmail">Email</label>
            <input type="email" id="vEmail" value="${esc(d.email)}" /></div>
          <div class="field"><label for="vTel">Teléfono</label>
            <input id="vTel" value="${esc(d.telefono)}" /></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="vDoc">CUIT / DNI</label>
            <input id="vDoc" value="${esc(d.documento)}" placeholder="20-12345678-9" /></div>
          <div class="field"><label for="vZona">Zona o territorio</label>
            <input id="vZona" value="${esc(d.zona)}" placeholder="AMBA · Litoral · Chile" /></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="vUsuario">Usuario de la aplicación</label>
            <input id="vUsuario" value="${esc(d.usuarioId || "")}" placeholder="gabriel" />
            <p class="muted" style="font-size:12px; margin:4px 0 0">
              Vacío si no usa la app. Sirve para vincular sus tickets.
            </p></div>
          <div class="field"><label for="vEstado">Estado</label>
            <select id="vEstado">${E.VENDEDOR_ESTADO.map((x) =>
              `<option value="${x}"${d.estado === x ? " selected" : ""}>${x}</option>`).join("")}</select></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="vMeta">Cuota mensual</label>
            <input type="number" id="vMeta" min="0" step="500" value="${d.metaMensual}" />
            <p class="muted" style="font-size:12px; margin:4px 0 0">0 = sin cuota asignada</p></div>
          <div class="field"><label for="vMetaMon">Moneda de la cuota</label>
            <select id="vMetaMon">${E.MONEDA_COTIZACION.map((x) =>
              `<option value="${x}"${d.metaMoneda === x ? " selected" : ""}>${x}</option>`).join("")}</select></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="vAlta">Fecha de alta</label>
            <input type="date" id="vAlta" value="${esc(d.fechaAlta)}" /></div>
          <div class="field"><label for="vBaja">Fecha de baja</label>
            <input type="date" id="vBaja" value="${esc(d.fechaBaja || "")}" /></div>
        </div>
        <div class="field"><label for="vNotas">Notas</label>
          <input id="vNotas" value="${esc(d.notas)}" /></div>
        <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px">
          <a class="btn ghost" href="#vendedores">Cancelar</a>
          <button class="btn primary" onclick="guardarVendedor(${v ? `'${esc(v.id)}'` : "null"})">Guardar</button>
        </div>
      </div>
    `;
  }

  async function guardarVendedor(id) {
    const val = (x) => document.getElementById(x).value.trim();
    const reg = {
      id: id || undefined,
      nombre: val("vNombre"), relacion: val("vRelacion"),
      email: val("vEmail"), telefono: val("vTel"), documento: val("vDoc"),
      zona: val("vZona"), usuarioId: val("vUsuario") || null,
      estado: val("vEstado"),
      metaMensual: val("vMeta"), metaMoneda: val("vMetaMon"),
      fechaAlta: val("vAlta"), fechaBaja: val("vBaja"),
      notas: val("vNotas"),
    };
    if (await guardar("vendedores", reg, `Vendedor ${reg.nombre}`)) {
      global.toast("Vendedor guardado");
      global.go("vendedores");
    }
  }

  // ==========================================================================
  // Acuerdos
  // ==========================================================================

  async function nuevoAcuerdo(vendedorId) {
    const v = vendedores().find((x) => x.id === vendedorId);
    const modalidad = prompt(
      `Acuerdo para ${v?.nombre}\n\nModalidad (${E.COMISION_MODALIDAD.join(" / ")})`, "Porcentaje");
    if (!modalidad) return;

    const reg = {
      vendedorId, modalidad,
      nombre: `Acuerdo ${E.hoy()}`,
      vigenciaDesde: E.hoy(),
      moneda: v?.metaMoneda || "USD",
      base: "Contrato",
      pagoTrasCobro: true,
      escalones: [],
    };

    if (modalidad === "Porcentaje") {
      const p = prompt("Porcentaje de comisión", "5");
      if (p === null) return;
      reg.porcentaje = p;
    } else if (modalidad === "Fija") {
      const m = prompt("Monto fijo por operación", "500");
      if (m === null) return;
      reg.montoFijo = m;
    } else {
      // Escalonada o Mixta: se piden los tramos en una línea.
      const txt = prompt(
        "Tramos, uno por línea: desde,hasta,porcentaje\n" +
        "El último se deja abierto poniendo la palabra 'fin' como tope.\n\n" +
        "Ejemplo:\n0,20000,3\n20000,50000,5\n50000,fin,7",
        "0,20000,3\n20000,50000,5\n50000,fin,7");
      if (!txt) return;
      reg.escalones = txt.split("\n").map((l) => {
        const [desde, hasta, pct] = l.split(",").map((s) => s.trim());
        return {
          desde, porcentaje: pct,
          hasta: /^(fin|inf|∞|)$/i.test(hasta || "") ? null : hasta,
        };
      });
      if (modalidad === "Mixta") {
        const m = prompt("Monto fijo que se suma al escalonado", "0");
        if (m === null) return;
        reg.montoFijo = m;
      }
    }

    const tope = prompt("Tope por operación (0 = sin tope)", "0");
    if (tope === null) return;
    reg.tope = tope;

    if (await guardar("acuerdosComision", reg, `Acuerdo de comisión · ${v?.nombre}`)) {
      global.toast("Acuerdo cargado");
      global.router();
    }
  }

  async function cerrarAcuerdo(id) {
    const a = acuerdos().find((x) => x.id === id);
    if (!a) return;
    const hasta = prompt(
      "Fecha de fin de vigencia\n\n" +
      "Cerrar la vigencia no borra nada: las comisiones ya calculadas siguen " +
      "explicándose con este acuerdo.", E.hoy());
    if (!hasta) return;
    if (await guardar("acuerdosComision", { ...a, vigenciaHasta: hasta },
        `Cierra vigencia del acuerdo ${a.id}`)) {
      global.toast("Vigencia cerrada");
      global.router();
    }
  }

  // ==========================================================================
  // Circuito de comisiones
  // ==========================================================================

  function renderComisiones() {
    const coms = [...comisiones()].sort((a, b) => b.fechaDevengo.localeCompare(a.fechaDevengo));
    const res = CM.resumen(coms);
    const mapaV = new Map(vendedores().map((v) => [v.id, v.nombre]));
    const c = ctx();

    // Contratos firmados sin comisión devengada: el trabajo pendiente real.
    const conComision = new Set(coms.filter((x) => x.estado !== "Anulada").map((x) => x.origenId));
    const sinDevengar = (c.contratos || []).filter(
      (ct) => ["Firmado", "Activo", "Finalizado"].includes(ct.estado) && !conComision.has(ct.id));

    document.getElementById("view-comisiones").innerHTML = `
      <div class="kicker">Equipo comercial</div>
      <h1>Comi<span class="hl">siones</span></h1>

      <div class="grid-kpi" style="margin:18px 0">
        ${E.COMISION_ESTADO.map((e) => `<div class="kpi${e === "Devengada" ? " warn" : ""}">
          <div class="label">${e}</div>
          <div class="num num-${K.textoMonedas(res[e]).length > 15 ? "sm" : "md"}">${K.textoMonedas(res[e])}</div>
          <div class="sub">${coms.filter((x) => x.estado === e).length} operación(es)</div>
        </div>`).join("")}
      </div>

      ${sinDevengar.length ? `<div class="card interno" style="margin-bottom:18px">
        <b>${sinDevengar.length} contrato(s) firmados sin comisión devengada.</b>
        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap">
          ${sinDevengar.map((ct) => `<button class="btn sm ghost" onclick="devengar('${esc(ct.id)}')">
            ${esc(ct.numero)} · devengar</button>`).join("")}
        </div>
      </div>` : ""}

      ${coms.length ? `<div style="overflow-x:auto"><table class="data">
        <thead><tr>
          <th>Vendedor</th><th>Período</th><th>Origen</th><th class="num">Base</th>
          <th class="num">Comisión</th><th>Estado</th><th></th>
        </tr></thead>
        <tbody>${coms.map((x) => {
          const puede = CM.puedeLiquidarse(x, c);
          return `<tr>
            <td><b>${esc(mapaV.get(x.vendedorId) || x.vendedorId)}</b></td>
            <td>${esc(x.periodo)}</td>
            <td>${esc(x.origenNumero || "—")}</td>
            <td class="num">${money(x.baseCalculo, x.moneda)}</td>
            <td class="num"><b>${money(x.monto, x.moneda)}</b><br>
              <span class="muted" style="font-size:11px">${esc(x.detalleCalculo)}</span></td>
            <td><span class="pill">${esc(x.estado)}</span></td>
            <td style="white-space:nowrap">
              ${x.estado === "Devengada" && P.capacidad(rol(), "aprobar_comision")
                ? `<button class="btn sm ghost" onclick="aprobarComision('${esc(x.id)}')">Aprobar</button>` : ""}
              ${x.estado === "Aprobada" && P.capacidad(rol(), "liquidar_comision")
                ? (puede.puede
                    ? `<button class="btn sm primary" onclick="liquidarComision('${esc(x.id)}')">Liquidar</button>`
                    : `<span class="muted" title="${esc(puede.motivo)}">bloqueada</span>`) : ""}
              ${["Devengada", "Aprobada"].includes(x.estado)
                ? `<button class="btn sm ghost" onclick="anularComision('${esc(x.id)}')">Anular</button>` : ""}
            </td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
      <p class="muted" style="font-size:13px; margin-top:10px">
        Circuito: <b>Devengada</b> al firmar el contrato → <b>Aprobada</b> por gerencia →
        <b>Liquidada</b> cuando se paga. Nadie aprueba la propia, y con acuerdos de pago
        tras cobro no se liquida hasta que la operación esté facturada.
      </p>` : `<p class="muted">Todavía no hay comisiones registradas.</p>`}
    `;
  }

  async function devengar(contratoId) {
    try {
      const c = ctx();
      const contrato = (c.contratos || []).find((x) => x.id === contratoId);
      if (!contrato) throw new Error("Contrato no encontrado");
      // Devuelve varias: la del vendedor más una por cada área del reparto interno.
      const generadas = CM.devengarPorContrato(contrato, c);
      let alta = 0;
      for (const com of generadas) {
        if (await guardar("comisiones", com, `Devenga comisión · ${contrato.numero} · ${com.area || "vendedor"}`)) alta++;
      }
      if (alta) {
        const total = generadas.reduce((t, x) => t + x.monto, 0);
        global.toast(`${alta} comisión(es) devengadas · total ${money(E.money(total), generadas[0].moneda)}`);
        global.router();
      }
    } catch (e) {
      global.toast(e.sugerencia ? `${e.message} — ${e.sugerencia}` : e.message, true, true);
    }
  }

  async function aprobarComision(id) {
    const c = comisiones().find((x) => x.id === id);
    if (!c) return;
    if (await guardar("comisiones",
        { ...c, estado: "Aprobada", fechaAprobacion: E.hoy(), aprobadaPor: global.state?.user || "" },
        `Aprueba comisión ${c.origenNumero || c.id}`)) {
      global.toast("Comisión aprobada");
      global.router();
    }
  }

  async function liquidarComision(id) {
    const c = comisiones().find((x) => x.id === id);
    if (!c) return;
    if (await guardar("comisiones", { ...c, estado: "Liquidada", fechaLiquidacion: E.hoy() },
        `Liquida comisión ${c.origenNumero || c.id}`)) {
      global.toast("Comisión liquidada");
      global.router();
    }
  }

  async function anularComision(id) {
    const c = comisiones().find((x) => x.id === id);
    if (!c) return;
    const motivo = prompt("Motivo de la anulación");
    if (!motivo) return;
    if (await guardar("comisiones", { ...c, estado: "Anulada", motivoAnulacion: motivo },
        `Anula comisión ${c.origenNumero || c.id}`)) {
      global.toast("Comisión anulada");
      global.router();
    }
  }

  // ==========================================================================

  global.NEXO_VISTAS = global.NEXO_VISTAS || {};
  Object.assign(global.NEXO_VISTAS, {
    vendedores: renderVendedores,
    vnddetalle: () => renderVndDetalle(location.hash.split("/")[1]),
    vndform: () => renderVndForm(location.hash.split("/")[1]),
    comisiones: renderComisiones,
  });

  Object.assign(global, {
    guardarVendedor, nuevoAcuerdo, cerrarAcuerdo, activarReparto,
    devengar, aprobarComision, liquidarComision, anularComision,
  });
})(typeof window !== "undefined" ? window : globalThis);
