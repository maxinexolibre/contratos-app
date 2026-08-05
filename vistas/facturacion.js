/**
 * Vistas de facturación y tipos de cambio.
 *
 * Se registran solas en window.NEXO_VISTAS; el router de app.js las toma de
 * ahí y crea la sección. No hay que tocar index.html ni app.js para sumar
 * una pantalla.
 *
 * Regla de negocio que gobierna esta pantalla: se cotiza en USD o UF, se
 * factura en moneda local al tipo de cambio del día, y ese tipo de cambio
 * queda escrito en el comprobante junto con su fecha y su fuente.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;
  const C = global.NEXO_CAMBIO;
  const K = global.NEXO_KPI;
  const AD = global.NEXO_ADAPTADOR;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const num = (n, d = 0) => Number(n || 0).toLocaleString("es-AR",
    { minimumFractionDigits: d, maximumFractionDigits: d });

  const SIM = { USD: "US$", UF: "UF", ARS: "$", CLP: "CLP$" };
  const money = (v, m) => `${SIM[m] || m} ${num(v, m === "USD" || m === "UF" ? 2 : 0)}`;

  /** Serie de cotizaciones guardada en el estado de la app. */
  const serie = () => global.state?.tiposCambio || [];

  /** Presupuestos en forma nueva, para poder usar el núcleo. */
  function presupuestosNuevos() {
    const n = AD.estadoANuevo(global.state || {});
    return n.presupuestos;
  }

  // --------------------------------------------------------------------------
  // Tipos de cambio
  // --------------------------------------------------------------------------

  function renderCambio() {
    const est = C.estadoSerie(serie());
    const hayProblema = est.some((x) => !x.vigente);

    const tarjetas = est.map((x) => {
      const tono = x.vigente ? "" : (x.valor === null ? " danger" : " warn");
      const valor = x.valor === null ? "—" : num(x.valor, x.unidad === "UF" ? 2 : 2);
      const sub = x.valor === null
        ? "sin cargar"
        : `${x.fecha} · ${x.diasAtraso === 0 ? "hoy" : `hace ${x.diasAtraso} d`}`;
      return `<div class="kpi${tono}">
        <div class="label">${esc(x.unidad)} <span class="muted" style="font-weight:400">· ${esc(x.fuente)}</span></div>
        <div class="num num-md">${valor}</div>
        <div class="sub">${esc(sub)}</div>
      </div>`;
    }).join("");

    const historial = [...serie()]
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.unidad.localeCompare(b.unidad))
      .slice(0, 30);

    document.getElementById("view-cambio").innerHTML = `
      <div class="kicker">Configuración</div>
      <h1>Tipos de <span class="hl">cambio</span></h1>
      <p class="muted" style="max-width:70ch">
        Cotizamos en USD y en UF. Estas cotizaciones se usan únicamente al facturar,
        y quedan grabadas en cada comprobante. Los indicadores comerciales no dependen
        de ellas.
      </p>

      <div class="grid-kpi" style="margin:18px 0">${tarjetas}</div>

      ${hayProblema ? `<div class="card interno" style="margin-bottom:18px">
        <b>Hay cotizaciones sin actualizar.</b> La facturación se bloquea cuando la
        cotización tiene más de ${C.TOLERANCIA_DIAS} días: un comprobante emitido con
        un valor viejo factura mal, y corregirlo después implica nota de crédito.
      </div>` : ""}

      <div class="card">
        <h3>Cargar cotización</h3>
        <div class="form-grid" style="gap:12px; align-items:end">
          <div class="field">
            <label for="tcUnidad">Unidad</label>
            <select id="tcUnidad">
              <option value="ARS">ARS · pesos por 1 USD (BNA vendedor)</option>
              <option value="CLP">CLP · pesos chilenos por 1 USD</option>
              <option value="UF">UF · pesos chilenos por 1 UF</option>
            </select>
          </div>
          <div class="field">
            <label for="tcValor">Valor</label>
            <input type="number" id="tcValor" step="0.01" min="0" placeholder="1412.50" />
          </div>
          <div class="field">
            <label for="tcFecha">Fecha</label>
            <input type="date" id="tcFecha" value="${E.hoy()}" max="${E.hoy()}" />
          </div>
        </div>
        <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px">
          <button class="btn primary" onclick="guardarCotizacion()">Guardar</button>
        </div>
        <p class="muted" style="font-size:13px; margin-top:10px">
          BNA: <a href="https://www.bna.com.ar/Personas" target="_blank" rel="noopener">bna.com.ar</a>,
          columna <b>billete vendedor</b>.
          UF: <a href="https://www.sii.cl/valores_y_fechas/uf/uf2026.htm" target="_blank" rel="noopener">sii.cl</a>.
          Cargar dos veces la misma unidad y fecha reemplaza el valor, no lo duplica.
        </p>
      </div>

      <h3 style="margin-top:24px">Historial</h3>
      ${historial.length ? `<table class="data">
        <thead><tr><th>Fecha</th><th>Unidad</th><th class="num">Valor</th><th>Fuente</th></tr></thead>
        <tbody>${historial.map((x) => `<tr>
          <td>${esc(x.fecha)}</td>
          <td><span class="pill">${esc(x.unidad)}</span></td>
          <td class="num">${num(x.tasa, 2)}</td>
          <td class="muted">${esc(x.fuente)}</td>
        </tr>`).join("")}</tbody>
      </table>` : `<p class="muted">Todavía no hay cotizaciones cargadas.</p>`}
    `;
  }

  async function guardarCotizacion() {
    try {
      const unidad = document.getElementById("tcUnidad").value;
      const valor = document.getElementById("tcValor").value;
      const fecha = document.getElementById("tcFecha").value;
      const cot = C.nuevaCotizacion(unidad, valor, fecha);

      global.state.tiposCambio = C.upsert(serie(), cot);
      await global.persist(`Cotización ${unidad} ${cot.fecha}: ${cot.tasa}`, "tiposCambio");
      global.toast(`${unidad} actualizado: ${num(cot.tasa, 2)}`);
      renderCambio();
    } catch (e) {
      global.toast(e.sugerencia ? `${e.message} — ${e.sugerencia}` : e.message, true);
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

    // Solo se avisa por las unidades que hacen falta para lo que hay pendiente.
    // Advertir por UF cuando no hay nada en UF para facturar convierte el aviso
    // en ruido, y un aviso que aparece siempre deja de leerse.
    const est = C.estadoSerie(serie());
    const necesarias = new Set(facturables.map(
      (p) => (p.economico.moneda === "UF" ? "UF" : "ARS")));
    const bloqueado = est.filter((x) => !x.vigente && necesarias.has(x.unidad));

    // Totales de lo ya facturado, por moneda de liquidación. Nunca un solo número.
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
          ? `No hay cotización de ${x.unidad} cargada.`
          : `La cotización de ${x.unidad} es del ${x.fecha} (hace ${x.diasAtraso} días).`).join(" ")}
        <a href="#cambio">Cargar cotización</a>.
      </div>` : ""}

      <h3>Pendientes</h3>
      ${facturables.length ? `<table class="data">
        <thead><tr>
          <th>N.º</th><th>Fecha</th><th>Título</th>
          <th class="num">Cotizado</th><th class="num">A facturar hoy</th><th></th>
        </tr></thead>
        <tbody>${facturables.map((p) => {
          let previsto = "—", puede = false, motivo = "";
          try {
            const f = C.prepararFacturacion(p, { serie: serie() });
            previsto = money(f.montoLiquidado, f.monedaLiquidacion);
            puede = true;
          } catch (e) { motivo = e.message; }
          return `<tr>
            <td><b>${esc(p.numero)}</b></td>
            <td>${esc(p.fecha)}</td>
            <td>${esc(p.titulo || "—")}</td>
            <td class="num">${money(p.total, p.economico.moneda)}${p.economico.recurrencia === "mensual" ? "<span class='muted'>/mes</span>" : ""}</td>
            <td class="num">${esc(previsto)}</td>
            <td>${puede
              ? `<button class="btn sm primary" onclick="facturar('${esc(p.id)}')">Facturar</button>`
              : `<span class="muted" title="${esc(motivo)}">bloqueado</span>`}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>` : `<p class="muted">No hay presupuestos aprobados sin facturar.</p>`}

      <h3 style="margin-top:26px">Comprobantes emitidos</h3>
      ${facturas.length ? `<table class="data">
        <thead><tr>
          <th>Comprobante</th><th>Fecha</th><th class="num">Cotizado</th>
          <th class="num">Tipo de cambio</th><th class="num">Facturado</th><th>Fuente</th>
        </tr></thead>
        <tbody>${[...facturas].sort((a, b) => b.fechaEmision.localeCompare(a.fechaEmision))
          .map((f) => `<tr>
            <td><b>${esc(f.numeroComprobante || "—")}</b></td>
            <td>${esc(f.fechaEmision)}</td>
            <td class="num">${money(f.montoCotizado, f.monedaCotizacion)}</td>
            <td class="num">${num(f.tcValor, 2)} <span class="muted">${esc(f.tcFecha)}</span></td>
            <td class="num"><b>${money(f.montoLiquidado, f.monedaLiquidacion)}</b></td>
            <td class="muted" style="font-size:12px">${esc(f.tcFuente)}</td>
          </tr>`).join("")}</tbody>
      </table>
      <p class="muted" style="font-size:13px; margin-top:10px">
        El tipo de cambio queda congelado en cada comprobante. No se recalcula:
        si se reconvirtiera al consultar, el importe de una factura vieja cambiaría
        todos los días.
      </p>` : `<p class="muted">Todavía no se emitió ningún comprobante.</p>`}
    `;
  }

  async function facturar(presupuestoId) {
    try {
      const p = presupuestosNuevos().find((x) => x.id === presupuestoId);
      if (!p) throw new Error("Presupuesto no encontrado");

      const numero = prompt(
        `Número de comprobante para ${p.numero}\n\n` +
        `${money(p.total, p.economico.moneda)} al cambio de hoy.`, "");
      if (numero === null) return;

      const f = C.prepararFacturacion(p, {
        serie: serie(),
        numeroComprobante: numero.trim(),
        usuario: global.state?.user || "",
      });

      global.state.facturaciones = [...(global.state.facturaciones || []), f];
      await global.persist(`Comprobante ${f.numeroComprobante} · ${p.numero}`, "facturaciones");
      global.toast(C.explicar(f));
      renderFacturacion();
    } catch (e) {
      global.toast(e.sugerencia ? `${e.message} — ${e.sugerencia}` : e.message, true);
    }
  }

  // --------------------------------------------------------------------------

  global.NEXO_VISTAS = global.NEXO_VISTAS || {};
  global.NEXO_VISTAS.cambio = renderCambio;
  global.NEXO_VISTAS.facturacion = renderFacturacion;

  global.guardarCotizacion = guardarCotizacion;
  global.facturar = facturar;
})(typeof window !== "undefined" ? window : globalThis);
