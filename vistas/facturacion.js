/**
 * Vistas de facturación y tipos de cambio.
 *
 * Criterio comercial: todo se cotiza en USD y se convierte a la moneda del
 * país de origen recién al facturar. El tipo de cambio aplicado queda escrito
 * en cada comprobante con su fecha y su fuente.
 *
 * Las cotizaciones se traen de APIs públicas con CORS habilitado. Sin
 * servidor no hay proceso que las busque solo a una hora fija, así que la
 * actualización ocurre cuando alguien abre la pantalla —una vez por día como
 * máximo— y con un botón para forzarla.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;
  const C = global.NEXO_CAMBIO;
  const K = global.NEXO_KPI;
  const AD = global.NEXO_ADAPTADOR;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n, d = 0) => (n === null || n === undefined ? "—"
    : Number(n).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }));

  const SIM = { USD: "US$", ARS: "$", CLP: "CLP$", COP: "COP$", UYU: "$U", UF: "UF" };
  const money = (v, m) => (v === null || v === undefined ? "—"
    : `${SIM[m] || m} ${num(v, m === "USD" ? 2 : 0)}`);

  const serie = () => global.state?.tiposCambio || [];
  const presupuestosNuevos = () => AD.estadoANuevo(global.state || {}).presupuestos;

  /** Evita golpear las APIs en cada render: una vez por día alcanza. */
  const LS_ULTIMO = "nexo_tc_ultimo_intento";

  // --------------------------------------------------------------------------
  // Actualización automática
  // --------------------------------------------------------------------------

  async function actualizarCotizaciones(silencioso) {
    try {
      const r = await C.actualizarTodo(serie());
      if (r.actualizadas.length) {
        global.state.tiposCambio = r.serie;
        await global.persist(
          `Cotizaciones ${E.hoy()}: ${r.actualizadas.join(", ")}`, "tiposCambio");
      }
      localStorage.setItem(LS_ULTIMO, E.hoy());

      if (!silencioso) {
        const ok = r.actualizadas.length
          ? `Actualizadas: ${r.actualizadas.join(", ")}` : "No se pudo actualizar ninguna";
        const mal = r.fallidas.length
          ? ` · Sin respuesta: ${r.fallidas.map((f) => f.unidad).join(", ")}` : "";
        global.toast(ok + mal, r.fallidas.length > 0);
      }
      if (r.fallidas.length) {
        console.warn("Fuentes que no respondieron:", r.fallidas);
      }
      if (document.getElementById("view-cambio")) renderCambio();
      return r;
    } catch (e) {
      if (!silencioso) global.toast("Error al actualizar: " + e.message, true, true);
      return null;
    }
  }

  /**
   * Actualiza sola al abrir la pantalla, como mucho una vez por día.
   * Si falla, no molesta: la serie guardada sigue sirviendo y el panel ya
   * muestra qué está vencido.
   */
  function actualizarSiCorresponde() {
    if (global.state?.soloLectura) return;
    if (localStorage.getItem(LS_ULTIMO) === E.hoy()) return;
    actualizarCotizaciones(true);
  }

  // --------------------------------------------------------------------------
  // Tipos de cambio
  // --------------------------------------------------------------------------

  function renderCambio() {
    const est = C.estadoSerie(serie());
    const desactualizadas = est.filter((x) => !x.vigente);

    const tarjetas = est.map((x) => {
      const tono = x.vigente ? "" : (x.valor === null ? " danger" : " warn");
      const sub = x.valor === null ? "sin cargar"
        : `${x.fecha} · ${x.diasAtraso === 0 ? "hoy" : `hace ${x.diasAtraso} d`}`;
      return `<div class="kpi${tono}">
        <div class="label">${esc(x.unidad)}</div>
        <div class="num num-md">${x.valor === null ? "—" : num(x.valor, 2)}</div>
        <div class="sub">${esc(sub)}<br><span style="font-size:11px">${esc(x.fuente)}</span></div>
      </div>`;
    }).join("");

    const historial = [...serie()]
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.unidad.localeCompare(b.unidad))
      .slice(0, 40);

    document.getElementById("view-cambio").innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap">
        <div style="flex:1">
          <div class="kicker">Configuración</div>
          <h1>Tipos de <span class="hl">cambio</span></h1>
        </div>
        <button class="btn primary" onclick="actualizarCotizaciones()">↻ Actualizar ahora</button>
      </div>

      <p class="muted" style="max-width:72ch">
        Todo se cotiza en <b>USD</b>. Estas cotizaciones se usan únicamente al facturar,
        para convertir a la moneda del país de origen, y quedan grabadas en cada
        comprobante. Los indicadores comerciales no dependen de ellas.
      </p>

      <div class="grid-kpi" style="margin:18px 0">${tarjetas}</div>

      ${desactualizadas.length ? `<div class="card interno" style="margin-bottom:18px">
        <b>${desactualizadas.length} cotización(es) sin actualizar.</b>
        La facturación se bloquea cuando la cotización del país tiene más de
        ${C.TOLERANCIA_DIAS} días: un comprobante emitido con un valor viejo factura mal,
        y corregirlo después implica nota de crédito.
      </div>` : ""}

      <div class="card">
        <h3>Conversión por país</h3>
        <table class="data" style="margin-top:12px">
          <thead><tr><th>País</th><th>Factura en</th><th class="num">Cotización</th><th>Fuente</th></tr></thead>
          <tbody>${E.PAIS.map((p) => {
            const info = C.PAISES[p];
            const c = info.sinConversion ? null : C.cotizacion(serie(), info.moneda, E.hoy());
            return `<tr>
              <td><b>${esc(info.nombre)}</b></td>
              <td>${esc(info.moneda)}</td>
              <td class="num">${info.sinConversion
                ? `<span class="muted">sin conversión</span>`
                : (c ? num(c.tasa, 2) : `<span class="muted">—</span>`)}</td>
              <td class="muted" style="font-size:12px">${info.sinConversion ? "" : esc(c?.fuente || "sin cotización")}</td>
            </tr>`;
          }).join("")}</tbody>
        </table>
        <p class="muted" style="font-size:13px; margin-top:10px">
          Chile además muestra el equivalente en <b>UF</b> en cada comprobante: no se
          factura en UF, pero es la unidad con la que el cliente chileno piensa el contrato.
        </p>
      </div>

      <div class="card" style="margin-top:18px">
        <h3>Carga manual</h3>
        <p class="muted" style="font-size:13px; margin:4px 0 12px">
          Solo hace falta si una fuente deja de responder. Cargar dos veces la misma
          unidad y fecha reemplaza el valor, no lo duplica.
        </p>
        <div class="form-grid" style="align-items:end">
          <div class="field"><label for="tcUnidad">Unidad</label>
            <select id="tcUnidad">${C.UNIDADES.map((u) =>
              `<option value="${u}">${u} · ${esc(C.FUENTES[u]?.etiqueta || "")}</option>`).join("")}</select></div>
          <div class="field"><label for="tcValor">Valor</label>
            <input type="number" id="tcValor" step="0.01" min="0" /></div>
        </div>
        <div class="form-grid" style="align-items:end">
          <div class="field"><label for="tcFecha">Fecha</label>
            <input type="date" id="tcFecha" value="${E.hoy()}" max="${E.hoy()}" /></div>
          <div class="field" style="display:flex; align-items:flex-end">
            <button class="btn ghost" onclick="guardarCotizacion()">Guardar</button></div>
        </div>
      </div>

      <h3 style="margin-top:24px">Historial</h3>
      ${historial.length ? `<table class="data">
        <thead><tr><th>Fecha</th><th>Unidad</th><th class="num">Valor</th><th>Fuente</th></tr></thead>
        <tbody>${historial.map((x) => `<tr>
          <td>${esc(x.fecha)}</td>
          <td><span class="pill">${esc(x.unidad)}</span></td>
          <td class="num">${num(x.tasa, 2)}</td>
          <td class="muted" style="font-size:12px">${esc(x.fuente)}</td>
        </tr>`).join("")}</tbody>
      </table>` : `<p class="muted">Todavía no hay cotizaciones. Probá "Actualizar ahora".</p>`}
    `;

    actualizarSiCorresponde();
  }

  /** Enlaza los selectores de la barra de facturación. */
  function enlazarFiltroFac() {
    for (const [id, campo] of [["ffp", "pais"], ["ffm", "mes"], ["fft", "tipo"]]) {
      const e = document.getElementById(id);
      if (e) e.onchange = (x) => { filtro()[campo] = x.target.value; renderFacturacion(); };
    }
  }

  async function guardarCotizacion() {
    try {
      const cot = C.nuevaCotizacion(
        document.getElementById("tcUnidad").value,
        document.getElementById("tcValor").value,
        document.getElementById("tcFecha").value);
      global.state.tiposCambio = C.upsert(serie(), cot);
      await global.persist(`Cotización ${cot.unidad} ${cot.fecha}: ${cot.tasa}`, "tiposCambio");
      global.toast(`${cot.unidad} actualizado: ${num(cot.tasa, 2)}`);
      renderCambio();
    } catch (e) {
      global.toast(e.sugerencia ? `${e.message} — ${e.sugerencia}` : e.message, true, true);
    }
  }

  // --------------------------------------------------------------------------
  // Facturación
  // --------------------------------------------------------------------------

  /** Filtro de la pantalla de facturación. */
  const filtro = () => (global.state.filtroFac = global.state.filtroFac ||
    { pais: "", mes: "", tipo: "", pagina: 1 });

  function renderFacturacion() {
    const T = global.NEXO_TABLA;
    const presus = presupuestosNuevos();
    const facturas = global.state?.facturaciones || [];
    const f = filtro();
    // Período que se está cobrando. Por defecto el mes en curso; si hay un mes
    // filtrado, se cobra ese: sirve para ponerse al día con meses atrasados.
    const periodo = f.mes || E.hoy().slice(0, 7);

    // Un abono mensual vuelve a estar pendiente cada mes. Un pago único, no.
    const facturables = T.filtrar(
      presus.filter((p) => C.pendienteDeCobro(p, facturas, periodo)),
      { pais: f.pais },
      { pais: (p) => p.pais })
      .sort((a, b) => b.fecha.localeCompare(a.fecha));

    const emitidas = T.filtrar(facturas, f,
      { pais: (x) => x.pais, fecha: (x) => x.fechaEmision, tipo: (x) => x.tipoComprobante })
      .sort((a, b) => b.fechaEmision.localeCompare(a.fechaEmision));

    // Solo se avisa por las monedas que hacen falta para lo pendiente: un
    // aviso que aparece siempre deja de leerse.
    const necesarias = new Set(facturables
      .map((p) => C.PAISES[p.pais])
      .filter((x) => x && !x.sinConversion)
      .map((x) => x.moneda));
    const bloqueado = C.estadoSerie(serie()).filter((x) => !x.vigente && necesarias.has(x.unidad));

    const porMoneda = {};
    for (const x of emitidas) {
      porMoneda[x.monedaLiquidacion] = E.money(
        (porMoneda[x.monedaLiquidacion] || 0) + x.montoLiquidado);
    }
    const meses = T.mesesDisponibles(facturas, (x) => x.fechaEmision);
    const barra = `<div class="table-tools" style="margin:14px 0">
      <select id="ffp"><option value="">Todos los países</option>${E.PAIS.map((c) =>
        `<option value="${c}"${f.pais === c ? " selected" : ""}>${E.PAIS_NOMBRE[c]}</option>`).join("")}</select>
      <select id="ffm"><option value="">Todos los meses</option>${meses.map((m) =>
        `<option value="${m}"${f.mes === m ? " selected" : ""}>${T.etiquetaMes(m)}</option>`).join("")}</select>
      <select id="fft"><option value="">Todo comprobante</option>${E.COMPROBANTE_TIPO.map((c) =>
        `<option value="${c}"${f.tipo === c ? " selected" : ""}>${c}</option>`).join("")}</select>
      ${T.hayFiltro(f) ? `<button class="btn sm ghost" onclick="limpiarFiltroFac()">✕ Limpiar</button>` : ""}
      <button class="btn sm" onclick="exportarFacturacionCSV()">⬇ CSV</button>
    </div>`;

    document.getElementById("view-facturacion").innerHTML = `
      <div class="kicker">Administración</div>
      <h1>Factura<span class="hl">ción</span></h1>
      ${barra}

      <div class="grid-kpi" style="margin:18px 0">
        <div class="kpi">
          <div class="label">Pendiente de facturar</div>
          <div class="num num-lg">${facturables.length}</div>
          <div class="sub">presupuestos aprobados</div>
        </div>
        <div class="kpi">
          <div class="label">Emitido</div>
          <div class="num num-${K.textoMonedas(porMoneda).length > 15 ? "sm" : "md"}">${K.textoMonedas(porMoneda)}</div>
          <div class="sub">${emitidas.length} comprobante(s)</div>
        </div>
      </div>

      ${bloqueado.length ? `<div class="card interno" style="margin-bottom:18px">
        <b>Facturación bloqueada para ${bloqueado.map((x) => x.unidad).join(" y ")}.</b>
        ${bloqueado.map((x) => x.valor === null
          ? `No hay cotización de ${x.unidad}.`
          : `La de ${x.unidad} es del ${x.fecha} (hace ${x.diasAtraso} días).`).join(" ")}
        <a href="#cambio">Actualizar cotizaciones</a>.
      </div>` : ""}

      <h3>Pendientes</h3>
      ${facturables.length ? `<div style="overflow-x:auto"><table class="data">
        <thead><tr>
          <th>N.º</th><th>País</th><th>Fecha</th><th>Título</th><th>Cobra</th>
          <th class="num">Cotizado</th><th class="num">A cobrar</th><th></th>
        </tr></thead>
        <tbody>${facturables.map((p) => {
          let previsto = "—", puede = false, motivo = "", uf = null;
          try {
            const f = C.prepararFacturacion(p, { serie: serie(), periodoCobrado: periodo });
            previsto = money(f.montoLiquidado, f.monedaLiquidacion);
            uf = f.referenciaUF;
            puede = true;
          } catch (e) { motivo = e.message; }
          return `<tr>
            <td><b>${esc(p.numero)}</b></td>
            <td><span class="pill">${esc(p.pais)}</span></td>
            <td>${esc(p.fecha)}</td>
            <td>${esc(p.titulo || "—")}</td>
            <td>${p.economico.recurrencia === "mensual"
              ? `<span class="pill">${esc(T.etiquetaMes(periodo))}</span>`
              : `<span class="muted">pago único</span>`}</td>
            <td class="num">${money(p.total, p.economico.moneda)}${p.economico.recurrencia === "mensual"
              ? "<span class='muted'>/mes</span>" : ""}</td>
            <td class="num">${esc(previsto)}${uf ? `<br><span class="muted" style="font-size:11px">≈ UF ${num(uf, 2)}</span>` : ""}</td>
            <td>${puede
              ? `<button class="btn sm primary" onclick="facturar('${esc(p.id)}','${esc(periodo)}')">Registrar cobro</button>`
              : `<span class="muted" title="${esc(motivo)}">bloqueado</span>`}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>` : `<p class="muted">No hay presupuestos aprobados sin facturar.</p>`}

      <h3 style="margin-top:26px">Comprobantes emitidos</h3>
      ${emitidas.length ? `<div style="overflow-x:auto"><table class="data">
        <thead><tr>
          <th>Comprobante</th><th>Período</th><th>País</th><th>Fecha</th><th class="num">Cotizado</th>
          <th class="num">Tipo de cambio</th><th class="num">Facturado</th><th>Fuente</th>
        </tr></thead>
        <tbody>${emitidas.map((x) => `<tr>
            <td><b>${esc(x.numeroComprobante || "—")}</b><br>
              <span class="pill">${esc(x.tipoComprobante)}</span></td>
            <td>${esc(x.periodoCobrado || "—")}</td>
            <td><span class="pill">${esc(x.pais)}</span></td>
            <td>${esc(x.fechaEmision)}</td>
            <td class="num">${money(x.montoCotizado, x.monedaCotizacion)}</td>
            <td class="num">${x.tcValor === 1 ? "—" : num(x.tcValor, 2)}
              <span class="muted" style="font-size:11px">${esc(x.tcFecha)}</span></td>
            <td class="num"><b>${money(x.montoLiquidado, x.monedaLiquidacion)}</b>
              ${x.montoIVA > 0 ? `<br><span class="muted" style="font-size:11px">neto ${num(x.montoNeto, 0)} + IVA ${num(x.montoIVA, 0)}</span>`
                : `<br><span class="muted" style="font-size:11px">${esc(x.condicionIVA)}</span>`}
              ${x.referenciaUF ? `<br><span class="muted" style="font-size:11px">≈ UF ${num(x.referenciaUF, 2)}</span>` : ""}</td>
            <td class="muted" style="font-size:12px">${esc(x.tcFuente)}</td>
          </tr>`).join("")}</tbody>
      </table></div>
      <p class="muted" style="font-size:13px; margin-top:10px">
        El tipo de cambio queda congelado en cada comprobante. No se recalcula: si se
        reconvirtiera al consultar, el importe de una factura vieja cambiaría todos los días.
      </p>` : `<p class="muted">Todavía no se emitió ningún comprobante.</p>`}
    `;
  }

  /**
   * Diálogo de emisión. No alcanza con pedir un número: hay operaciones
   * exentas de IVA, otras con el impuesto ya incluido en el precio, y cobros
   * en efectivo que no llevan factura pero igual cierran la venta.
   */
  function facturar(presupuestoId, periodo) {
    const p = presupuestosNuevos().find((x) => x.id === presupuestoId);
    if (!p) return;
    const info = C.PAISES[p.pais] || C.PAISES.AR;
    const per = periodo || E.hoy().slice(0, 7);
    const esAbono = p.economico?.recurrencia === "mensual";

    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.id = "ovFacturar";
    ov.innerHTML = `<div class="modal">
      <div class="kicker">Emitir comprobante</div>
      <h2>${esc(p.numero)} · <span style="color:var(--orange)">${esc(info.nombre)}</span></h2>
      <p class="muted" style="font-size:14px;margin:4px 0 14px">
        Cotizado ${money(p.total, p.economico.moneda)} · se liquida en ${esc(info.moneda)}
        ${esAbono ? `<br><b>Abono mensual · se cobra ${esc(global.NEXO_TABLA.etiquetaMes(per))}</b>` : ""}
      </p>
      <input type="hidden" id="fPeriodo" value="${esc(per)}" />

      <div class="field"><label for="fTipo">Tipo de comprobante</label>
        <select id="fTipo">${E.COMPROBANTE_TIPO.map((t) =>
          `<option value="${t}">${({ Factura: "Factura", Recibo: "Recibo",
            Efectivo: "Efectivo · sin factura", Transferencia: "Transferencia",
            NotaCredito: "Nota de crédito" })[t]}</option>`).join("")}</select>
        <p class="muted" style="font-size:12px;margin:4px 0 0">
          Un cobro en efectivo se registra igual: cierra la operación aunque no
          haya factura, y sin eso el presupuesto queda como pendiente para siempre.
        </p></div>

      <div class="field"><label for="fIVA">Condición de IVA</label>
        <select id="fIVA">${E.CONDICION_IVA.map((c) =>
          `<option value="${c}"${(p.condicionIVA || "Gravado") === c ? " selected" : ""}>${
            ({ Gravado: "Gravado · el IVA se suma al precio",
               Exento: "Exento · el cliente no paga IVA",
               IncluidoEnPrecio: "IVA incluido en el precio cotizado",
               NoGravado: "No gravado" })[c]}</option>`).join("")}</select></div>

      <div class="form-grid">
        <div class="field"><label for="fNum">Número de comprobante</label>
          <input id="fNum" placeholder="A-0001-00000123" /></div>
        <div class="field"><label for="fIvaPct">Alícuota %</label>
          <input type="number" id="fIvaPct" value="${p.economico?.ivaPct ?? 21}" min="0" max="100" step="0.5" /></div>
      </div>

      <div class="field"><label for="fObs">Observaciones</label>
        <input id="fObs" placeholder="Opcional" /></div>

      <div class="card interno" id="fPreview" style="margin:12px 0"></div>

      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
        <button class="btn ghost" onclick="cerrarFacturar()">Cancelar</button>
        <button class="btn primary" onclick="confirmarFacturar('${esc(p.id)}')">Emitir</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    ov.style.display = "flex";

    const refrescar = () => {
      const prev = document.getElementById("fPreview");
      try {
        const f = C.prepararFacturacion(p, {
          serie: serie(),
          periodoCobrado: document.getElementById("fPeriodo").value,
          tipoComprobante: document.getElementById("fTipo").value,
          condicionIVA: document.getElementById("fIVA").value,
          ivaPct: document.getElementById("fIvaPct").value,
        });
        prev.innerHTML = `<b>${esc(C.explicar(f))}</b>` +
          (f.referenciaUF ? `<br><span class="muted">≈ UF ${num(f.referenciaUF, 2)}</span>` : "");
      } catch (e) {
        prev.innerHTML = `<b>No se puede emitir:</b> ${esc(e.message)}` +
          (e.sugerencia ? `<br><span class="muted">${esc(e.sugerencia)}</span>` : "");
      }
    };
    for (const id of ["fTipo", "fIVA", "fIvaPct"]) {
      document.getElementById(id).onchange = refrescar;
      document.getElementById(id).oninput = refrescar;
    }
    refrescar();
  }

  function cerrarFacturar() {
    document.getElementById("ovFacturar")?.remove();
  }

  async function confirmarFacturar(presupuestoId) {
    try {
      const p = presupuestosNuevos().find((x) => x.id === presupuestoId);
      const f = C.prepararFacturacion(p, {
        serie: serie(),
        periodoCobrado: document.getElementById("fPeriodo").value,
        tipoComprobante: document.getElementById("fTipo").value,
        condicionIVA: document.getElementById("fIVA").value,
        ivaPct: document.getElementById("fIvaPct").value,
        numeroComprobante: document.getElementById("fNum").value.trim(),
        observaciones: document.getElementById("fObs").value.trim(),
        usuario: global.state?.user || "",
      });
      global.state.facturaciones = [...(global.state.facturaciones || []), f];
      await global.persist(
        `${f.tipoComprobante} ${f.numeroComprobante || "s/n"} · ${p.numero}`, "facturaciones", f);
      cerrarFacturar();
      global.toast(C.explicar(f));
      renderFacturacion();
    } catch (e) {
      global.toast(e.sugerencia ? `${e.message} — ${e.sugerencia}` : e.message, true, true);
    }
  }

  function limpiarFiltroFac() {
    global.state.filtroFac = { pais: "", mes: "", tipo: "", pagina: 1 };
    renderFacturacion();
  }

  /** CSV de lo emitido, respetando el filtro activo. */
  function exportarFacturacionCSV() {
    const T = global.NEXO_TABLA;
    const filas = T.filtrar(global.state.facturaciones || [], filtro(),
      { pais: (x) => x.pais, fecha: (x) => x.fechaEmision, tipo: (x) => x.tipoComprobante });
    const n = T.exportarCSV(filas, [
      { titulo: "comprobante", valor: (x) => x.numeroComprobante },
      { titulo: "tipo", valor: (x) => x.tipoComprobante },
      { titulo: "fecha", valor: (x) => x.fechaEmision },
      { titulo: "periodo_cobrado", valor: (x) => x.periodoCobrado },
      { titulo: "pais", valor: (x) => x.pais },
      { titulo: "moneda_cotizacion", valor: (x) => x.monedaCotizacion },
      { titulo: "monto_cotizado", valor: (x) => x.montoCotizado },
      { titulo: "tipo_cambio", valor: (x) => x.tcValor },
      { titulo: "tc_fecha", valor: (x) => x.tcFecha },
      { titulo: "tc_fuente", valor: (x) => x.tcFuente },
      { titulo: "condicion_iva", valor: (x) => x.condicionIVA },
      { titulo: "neto", valor: (x) => x.montoNeto },
      { titulo: "iva", valor: (x) => x.montoIVA },
      { titulo: "total", valor: (x) => x.montoLiquidado },
      { titulo: "moneda", valor: (x) => x.monedaLiquidacion },
      { titulo: "observaciones", valor: (x) => x.observaciones },
    ], "facturacion");
    global.toast(`CSV: ${n} comprobante(s) · ${T.describirFiltro(filtro())}`);
  }

  // --------------------------------------------------------------------------

  global.NEXO_VISTAS = global.NEXO_VISTAS || {};
  global.NEXO_VISTAS.cambio = renderCambio;
  global.NEXO_VISTAS.facturacion = renderFacturacion;

  Object.assign(global, {
    guardarCotizacion, facturar, cerrarFacturar, confirmarFacturar,
    actualizarCotizaciones, limpiarFiltroFac, exportarFacturacionCSV,
  });
})(typeof window !== "undefined" ? window : globalThis);
