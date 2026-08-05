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

  function renderFacturacion() {
    const presus = presupuestosNuevos();
    const facturas = global.state?.facturaciones || [];
    const facturados = new Set(facturas.map((f) => f.presupuestoId));

    const facturables = presus
      .filter((p) => p.estado === "Aprobado" && !facturados.has(p.id))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));

    // Solo se avisa por las monedas que hacen falta para lo pendiente: un
    // aviso que aparece siempre deja de leerse.
    const necesarias = new Set(facturables
      .map((p) => C.PAISES[p.pais])
      .filter((x) => x && !x.sinConversion)
      .map((x) => x.moneda));
    const bloqueado = C.estadoSerie(serie()).filter((x) => !x.vigente && necesarias.has(x.unidad));

    const porMoneda = {};
    for (const f of facturas) {
      porMoneda[f.monedaLiquidacion] = E.money(
        (porMoneda[f.monedaLiquidacion] || 0) + f.montoLiquidado);
    }

    document.getElementById("view-facturacion").innerHTML = `
      <div class="kicker">Administración</div>
      <h1>Factura<span class="hl">ción</span></h1>

      <div class="grid-kpi" style="margin:18px 0">
        <div class="kpi">
          <div class="label">Pendiente de facturar</div>
          <div class="num num-lg">${facturables.length}</div>
          <div class="sub">presupuestos aprobados</div>
        </div>
        <div class="kpi">
          <div class="label">Emitido</div>
          <div class="num num-${K.textoMonedas(porMoneda).length > 15 ? "sm" : "md"}">${K.textoMonedas(porMoneda)}</div>
          <div class="sub">${facturas.length} comprobante(s)</div>
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
          <th>N.º</th><th>País</th><th>Fecha</th><th>Título</th>
          <th class="num">Cotizado (USD)</th><th class="num">A facturar hoy</th><th></th>
        </tr></thead>
        <tbody>${facturables.map((p) => {
          let previsto = "—", puede = false, motivo = "", uf = null;
          try {
            const f = C.prepararFacturacion(p, { serie: serie() });
            previsto = money(f.montoLiquidado, f.monedaLiquidacion);
            uf = f.referenciaUF;
            puede = true;
          } catch (e) { motivo = e.message; }
          return `<tr>
            <td><b>${esc(p.numero)}</b></td>
            <td><span class="pill">${esc(p.pais)}</span></td>
            <td>${esc(p.fecha)}</td>
            <td>${esc(p.titulo || "—")}</td>
            <td class="num">${money(p.total, "USD")}${p.economico.recurrencia === "mensual"
              ? "<span class='muted'>/mes</span>" : ""}</td>
            <td class="num">${esc(previsto)}${uf ? `<br><span class="muted" style="font-size:11px">≈ UF ${num(uf, 2)}</span>` : ""}</td>
            <td>${puede
              ? `<button class="btn sm primary" onclick="facturar('${esc(p.id)}')">Facturar</button>`
              : `<span class="muted" title="${esc(motivo)}">bloqueado</span>`}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>` : `<p class="muted">No hay presupuestos aprobados sin facturar.</p>`}

      <h3 style="margin-top:26px">Comprobantes emitidos</h3>
      ${facturas.length ? `<div style="overflow-x:auto"><table class="data">
        <thead><tr>
          <th>Comprobante</th><th>País</th><th>Fecha</th><th class="num">Cotizado</th>
          <th class="num">Tipo de cambio</th><th class="num">Facturado</th><th>Fuente</th>
        </tr></thead>
        <tbody>${[...facturas].sort((a, b) => b.fechaEmision.localeCompare(a.fechaEmision))
          .map((f) => `<tr>
            <td><b>${esc(f.numeroComprobante || "—")}</b></td>
            <td><span class="pill">${esc(f.pais)}</span></td>
            <td>${esc(f.fechaEmision)}</td>
            <td class="num">${money(f.montoCotizado, "USD")}</td>
            <td class="num">${f.tcValor === 1 ? "—" : num(f.tcValor, 2)}
              <span class="muted" style="font-size:11px">${esc(f.tcFecha)}</span></td>
            <td class="num"><b>${money(f.montoLiquidado, f.monedaLiquidacion)}</b>
              ${f.referenciaUF ? `<br><span class="muted" style="font-size:11px">≈ UF ${num(f.referenciaUF, 2)}</span>` : ""}</td>
            <td class="muted" style="font-size:12px">${esc(f.tcFuente)}</td>
          </tr>`).join("")}</tbody>
      </table></div>
      <p class="muted" style="font-size:13px; margin-top:10px">
        El tipo de cambio queda congelado en cada comprobante. No se recalcula: si se
        reconvirtiera al consultar, el importe de una factura vieja cambiaría todos los días.
      </p>` : `<p class="muted">Todavía no se emitió ningún comprobante.</p>`}
    `;
  }

  async function facturar(presupuestoId) {
    try {
      const p = presupuestosNuevos().find((x) => x.id === presupuestoId);
      if (!p) throw new Error("Presupuesto no encontrado");

      const numero = prompt(
        `Número de comprobante para ${p.numero}\n\n` +
        `${money(p.total, "USD")} · ${C.PAISES[p.pais]?.nombre} · se factura en ${C.monedaDe(p.pais)}`, "");
      if (numero === null) return;

      const f = C.prepararFacturacion(p, {
        serie: serie(), numeroComprobante: numero.trim(), usuario: global.state?.user || "",
      });
      global.state.facturaciones = [...(global.state.facturaciones || []), f];
      await global.persist(`Comprobante ${f.numeroComprobante} · ${p.numero}`, "facturaciones");
      global.toast(C.explicar(f));
      renderFacturacion();
    } catch (e) {
      global.toast(e.sugerencia ? `${e.message} — ${e.sugerencia}` : e.message, true, true);
    }
  }

  // --------------------------------------------------------------------------

  global.NEXO_VISTAS = global.NEXO_VISTAS || {};
  global.NEXO_VISTAS.cambio = renderCambio;
  global.NEXO_VISTAS.facturacion = renderFacturacion;

  global.guardarCotizacion = guardarCotizacion;
  global.facturar = facturar;
  global.actualizarCotizaciones = actualizarCotizaciones;
})(typeof window !== "undefined" ? window : globalThis);
