/**
 * Tipos de cambio y facturación.
 *
 * Criterio comercial de Nexolibre (definido por Maxi, 2026-08-04):
 *
 *   Se COTIZA en USD (Argentina y USA) o en UF (Chile).
 *   Se FACTURA en moneda local, convirtiendo al tipo de cambio del día.
 *
 * De ahí se desprenden dos cosas que este módulo garantiza:
 *
 * 1. Los KPIs no dependen del tipo de cambio. El importe cotizado YA está en
 *    la moneda de referencia. El tipo de cambio aparece recién al facturar.
 *
 * 2. El tipo de cambio aplicado queda CONGELADO en el comprobante, con su
 *    fecha y su fuente. Nunca se recalcula: si se reconvirtiera al consultar,
 *    el importe de una factura de marzo cambiaría todos los días.
 *
 * Unidades de la serie:
 *   ARS  pesos por 1 USD · BNA billete VENDEDOR
 *   CLP  pesos chilenos por 1 USD
 *   UF   pesos chilenos por 1 UF · SII / Banco Central de Chile
 *
 * La UF no es una moneda: es una unidad indexada. Para llevarla a USD hay que
 * pasar por CLP, así que un importe en UF necesita las dos cotizaciones.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;

  /** Días de tolerancia antes de considerar vieja una cotización. */
  const TOLERANCIA_DIAS = 3;

  const FUENTES = {
    ARS: "BNA billete vendedor",
    CLP: "Banco Central de Chile",
    UF: "SII / BCCh",
  };

  const UNIDADES = ["ARS", "CLP", "UF"];

  /** Moneda de liquidación según la de cotización. */
  const LIQUIDACION = { USD: "ARS", UF: "CLP" };

  // --------------------------------------------------------------------------
  // Consulta de la serie
  // --------------------------------------------------------------------------

  /**
   * Última cotización conocida de una unidad en una fecha dada.
   * Usa la más reciente que no sea posterior: los fines de semana y feriados
   * el BNA no publica, así que el viernes rige hasta el lunes.
   */
  function cotizacion(serie, unidad, fecha) {
    const f = E.fecha(fecha) || E.hoy();
    const candidatas = (serie || [])
      .filter((x) => x.unidad === unidad && x.fecha <= f)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
    return candidatas[0] || null;
  }

  /** ¿Está la serie lo bastante fresca para facturar? */
  function estaVigente(serie, unidad, hoy) {
    const c = cotizacion(serie, unidad, hoy || E.hoy());
    if (!c) return false;
    return c.fecha >= E.sumarDias(hoy || E.hoy(), -TOLERANCIA_DIAS);
  }

  /** Estado de la serie por unidad, para el panel de configuración. */
  function estadoSerie(serie, hoy) {
    const h = hoy || E.hoy();
    return UNIDADES.map((unidad) => {
      const c = cotizacion(serie, unidad, h);
      const dias = c ? Math.round((new Date(h) - new Date(c.fecha)) / 86400000) : null;
      return {
        unidad,
        fuente: FUENTES[unidad],
        valor: c?.tasa ?? null,
        fecha: c?.fecha ?? null,
        diasAtraso: dias,
        vigente: estaVigente(serie, unidad, h),
      };
    });
  }

  // --------------------------------------------------------------------------
  // Conversión
  // --------------------------------------------------------------------------

  /**
   * Lleva un importe cotizado a USD, la moneda de referencia de los KPIs.
   * USD devuelve el mismo número: no hay conversión que hacer.
   */
  function aUSD(monto, moneda, fecha, serie) {
    if (monto === null || monto === undefined) return null;
    if (moneda === "USD") return E.money(monto);

    if (moneda === "UF") {
      const uf = cotizacion(serie, "UF", fecha);
      const clp = cotizacion(serie, "CLP", fecha);
      if (!uf || !clp) {
        throw new global.NEXO_REGLAS.ErrorNexo("NX-030",
          `Falta cotización de UF y/o CLP al ${fecha}`,
          "Cargá la serie antes de operar en Chile");
      }
      return E.money((monto * uf.tasa) / clp.tasa);
    }

    // ARS/CLP solo aparecen en registros heredados.
    const c = cotizacion(serie, moneda, fecha);
    if (!c) {
      throw new global.NEXO_REGLAS.ErrorNexo("NX-030",
        `Sin cotización de ${moneda} al ${fecha}`);
    }
    return E.money(monto / c.tasa);
  }

  /** Cuántos pesos chilenos son N UF en una fecha. */
  function ufACLP(uf, fecha, serie) {
    const c = cotizacion(serie, "UF", fecha);
    if (!c) throw new global.NEXO_REGLAS.ErrorNexo("NX-030", `Sin valor de UF al ${fecha}`);
    return Math.round(uf * c.tasa);
  }

  // --------------------------------------------------------------------------
  // Facturación
  // --------------------------------------------------------------------------

  /**
   * Prepara el comprobante de un presupuesto aprobado, congelando el tipo de
   * cambio del día. No escribe nada: devuelve el registro listo para guardar,
   * que después pasa por las reglas.
   */
  function prepararFacturacion(presupuesto, opciones = {}) {
    const serie = opciones.serie || [];
    const hoy = opciones.hoy || E.hoy();

    if (presupuesto.estado !== "Aprobado") {
      throw new global.NEXO_REGLAS.ErrorNexo("NX-022",
        `Solo se factura un presupuesto aprobado (está ${presupuesto.estado})`);
    }

    const monedaCotizacion = presupuesto.economico.moneda;
    const unidad = monedaCotizacion === "UF" ? "UF" : "ARS";
    const monedaLiquidacion = LIQUIDACION[monedaCotizacion] || "ARS";

    const c = cotizacion(serie, unidad, hoy);
    if (!c) {
      throw new global.NEXO_REGLAS.ErrorNexo("NX-030",
        `No hay cotización de ${unidad} cargada`,
        "Cargala en Configuración → Tipos de cambio");
    }
    if (!estaVigente(serie, unidad, hoy)) {
      throw new global.NEXO_REGLAS.ErrorNexo("NX-031",
        `La cotización de ${unidad} es del ${c.fecha}`,
        "Actualizá el tipo de cambio antes de facturar: un comprobante emitido " +
        "con cotización vieja factura mal");
    }

    const montoCotizado = presupuesto.total;
    const montoLiquidado = E.money(montoCotizado * c.tasa);

    return E.ENTIDADES.facturaciones.normalizar({
      presupuestoId: presupuesto.id,
      contratoId: opciones.contratoId || null,
      numeroComprobante: opciones.numeroComprobante || "",
      fechaEmision: hoy,
      monedaCotizacion,
      montoCotizado,
      tcUnidad: unidad,
      tcValor: c.tasa,
      tcFecha: c.fecha,
      tcFuente: c.fuente || FUENTES[unidad],
      monedaLiquidacion,
      montoLiquidado,
      emitidoPor: opciones.usuario || "",
    });
  }

  /** Texto explicativo del cálculo, para mostrar en el comprobante. */
  function explicar(f) {
    const sim = { USD: "US$", UF: "UF", ARS: "$", CLP: "CLP$" };
    return `${sim[f.monedaCotizacion]} ${f.montoCotizado.toLocaleString("es-AR")} × ` +
           `${f.tcValor.toLocaleString("es-AR")} = ` +
           `${sim[f.monedaLiquidacion]} ${Math.round(f.montoLiquidado).toLocaleString("es-AR")}` +
           `  ·  ${f.tcFuente}, ${f.tcFecha}`;
  }

  // --------------------------------------------------------------------------
  // Carga de la serie
  // --------------------------------------------------------------------------

  /**
   * Registro de cotización listo para guardar.
   *
   * La carga es manual: sin servidor no hay proceso que salga a buscar el dato
   * a las 11 y a las 17. El panel avisa cuando la serie se pone vieja, y sin
   * cotización fresca la facturación se bloquea sola.
   */
  function nuevaCotizacion(unidad, tasa, fecha, fuente) {
    if (!UNIDADES.includes(unidad)) {
      throw new global.NEXO_REGLAS.ErrorNexo("NX-040", `Unidad desconocida: ${unidad}`);
    }
    const t = Number(tasa);
    if (!Number.isFinite(t) || t <= 0) {
      throw new global.NEXO_REGLAS.ErrorNexo("NX-040", "La cotización tiene que ser un número positivo");
    }
    const f = E.fecha(fecha) || E.hoy();
    if (f > E.hoy()) {
      throw new global.NEXO_REGLAS.ErrorNexo("NX-040", "No se cargan cotizaciones a futuro");
    }
    return E.ENTIDADES.tiposCambio.normalizar({
      id: `tc_${unidad}_${f}`,   // determinístico: recargar el mismo día pisa, no duplica
      fecha: f, unidad, tasa: t, fuente: fuente || FUENTES[unidad],
    });
  }

  /** Inserta o reemplaza una cotización en la serie. */
  function upsert(serie, cot) {
    const otras = (serie || []).filter(
      (x) => !(x.unidad === cot.unidad && x.fecha === cot.fecha));
    return [...otras, cot].sort(
      (a, b) => b.fecha.localeCompare(a.fecha) || a.unidad.localeCompare(b.unidad));
  }

  global.NEXO_CAMBIO = {
    TOLERANCIA_DIAS, FUENTES, UNIDADES, LIQUIDACION,
    cotizacion, estaVigente, estadoSerie,
    aUSD, ufACLP,
    prepararFacturacion, explicar,
    nuevaCotizacion, upsert,
  };
})(typeof window !== "undefined" ? window : globalThis);
