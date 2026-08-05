/**
 * Tipos de cambio y facturación multi-país.
 *
 * Criterio comercial de Nexolibre (Maxi, 2026-08-05):
 *
 *   TODO se cotiza en USD.
 *   Al facturar se convierte a la moneda del país de origen de la cotización.
 *
 * De ahí se desprende algo que simplifica todo el sistema: los indicadores
 * comerciales no dependen del tipo de cambio, porque el importe cotizado YA
 * está en la moneda de referencia. El tipo de cambio aparece una sola vez, en
 * el momento de emitir el comprobante, y queda CONGELADO ahí con su fecha y su
 * fuente. Nunca se recalcula: si se reconvirtiera al consultar, el importe de
 * una factura de marzo cambiaría todos los días.
 *
 * Las cotizaciones se traen de APIs públicas con CORS habilitado, porque no
 * hay servidor que pueda hacerlo por detrás. Si una fuente no responde, la
 * serie guardada sigue sirviendo: se avisa que está vieja y, pasado el margen
 * de tolerancia, la facturación se bloquea sola.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;

  /** Días de tolerancia antes de considerar vieja una cotización. */
  const TOLERANCIA_DIAS = 3;

  /**
   * Países donde opera Nexolibre, con su moneda de liquidación.
   * `sinConversion` marca el país cuya moneda ya es la de cotización.
   */
  const PAISES = {
    AR: { nombre: "Argentina", moneda: "ARS", simbolo: "$" },
    CL: { nombre: "Chile", moneda: "CLP", simbolo: "CLP$", referenciaUF: true },
    CO: { nombre: "Colombia", moneda: "COP", simbolo: "COP$" },
    UY: { nombre: "Uruguay", moneda: "UYU", simbolo: "$U" },
    US: { nombre: "Estados Unidos", moneda: "USD", simbolo: "US$", sinConversion: true },
  };

  /** Unidades de la serie de cotizaciones. UF es unidad indexada, no moneda. */
  const UNIDADES = ["ARS", "CLP", "COP", "UYU", "UF"];

  /**
   * Fuentes públicas. Cada una declara cómo extraer el valor de su respuesta.
   *
   * Sobre ARS: el BNA no publica una API propia ni habilita CORS. dolarapi.com
   * expone la cotización oficial, que es la del Banco Nación. Se toma `venta`
   * —el tipo vendedor— que es el criterio pactado. La fuente queda escrita en
   * cada comprobante para que el origen del número sea auditable.
   */
  const FUENTES = {
    ARS: {
      url: "https://dolarapi.com/v1/dolares/oficial",
      etiqueta: "BNA vendedor (vía dolarapi)",
      extraer: (j) => ({ tasa: j.venta, fecha: (j.fechaActualizacion || "").slice(0, 10) }),
    },
    CLP: {
      url: "https://cl.dolarapi.com/v1/cotizaciones/usd",
      etiqueta: "USD/CLP vendedor",
      extraer: (j) => ({ tasa: j.venta, fecha: (j.fechaActualizacion || "").slice(0, 10) }),
    },
    UYU: {
      url: "https://uy.dolarapi.com/v1/cotizaciones/usd",
      etiqueta: "USD/UYU vendedor",
      extraer: (j) => ({ tasa: j.venta, fecha: (j.fechaActualizacion || "").slice(0, 10) }),
    },
    UF: {
      url: "https://mindicador.cl/api/uf",
      etiqueta: "UF · mindicador.cl (BCCh)",
      extraer: (j) => {
        const s = (j.serie || [])[0] || {};
        return { tasa: s.valor, fecha: (s.fecha || "").slice(0, 10) };
      },
    },
    COP: {
      url: "https://open.er-api.com/v6/latest/USD",
      etiqueta: "USD/COP · exchangerate-api",
      extraer: (j) => ({
        tasa: j?.rates?.COP,
        fecha: j?.time_last_update_utc
          ? new Date(j.time_last_update_utc).toISOString().slice(0, 10) : E.hoy(),
      }),
    },
  };

  const err = (codigo, mensaje, sugerencia) => {
    throw new global.NEXO_REGLAS.ErrorNexo(codigo, mensaje, sugerencia);
  };

  // --------------------------------------------------------------------------
  // Consulta de la serie
  // --------------------------------------------------------------------------

  /**
   * Última cotización conocida de una unidad en una fecha.
   * Toma la más reciente que no sea posterior: los fines de semana y feriados
   * no se publica, así que el viernes rige hasta el lunes.
   */
  function cotizacion(serie, unidad, fecha) {
    const f = E.fecha(fecha) || E.hoy();
    return (serie || [])
      .filter((x) => x.unidad === unidad && x.fecha <= f)
      .sort((a, b) => b.fecha.localeCompare(a.fecha))[0] || null;
  }

  function estaVigente(serie, unidad, hoy) {
    const c = cotizacion(serie, unidad, hoy || E.hoy());
    return Boolean(c) && c.fecha >= E.sumarDias(hoy || E.hoy(), -TOLERANCIA_DIAS);
  }

  /** Estado de cada unidad, para el panel. */
  function estadoSerie(serie, hoy) {
    const h = hoy || E.hoy();
    return UNIDADES.map((unidad) => {
      const c = cotizacion(serie, unidad, h);
      const dias = c
        ? Math.round((new Date(h + "T00:00:00Z") - new Date(c.fecha + "T00:00:00Z")) / 86400000)
        : null;
      return {
        unidad,
        fuente: FUENTES[unidad]?.etiqueta || "",
        valor: c?.tasa ?? null,
        fecha: c?.fecha ?? null,
        diasAtraso: dias,
        vigente: estaVigente(serie, unidad, h),
      };
    });
  }

  // --------------------------------------------------------------------------
  // Actualización automática
  // --------------------------------------------------------------------------

  /**
   * Trae una cotización de su fuente pública.
   * Devuelve el registro listo para guardar, o un objeto de error: no lanza,
   * porque una fuente caída no debe interrumpir la actualización de las demás.
   */
  async function traer(unidad) {
    const f = FUENTES[unidad];
    if (!f) return { unidad, ok: false, error: `Sin fuente definida para ${unidad}` };
    try {
      const r = await fetch(f.url, { cache: "no-store" });
      if (!r.ok) return { unidad, ok: false, error: `HTTP ${r.status}` };
      const { tasa, fecha } = f.extraer(await r.json());
      if (!(Number(tasa) > 0)) return { unidad, ok: false, error: "La fuente no devolvió un valor válido" };
      // Una fuente puede devolver una fecha futura por zona horaria: se acota.
      const fechaOk = E.fecha(fecha) && fecha <= E.hoy() ? fecha : E.hoy();
      return {
        unidad, ok: true,
        cotizacion: E.ENTIDADES.tiposCambio.normalizar({
          id: `tc_${unidad}_${fechaOk}`, fecha: fechaOk, unidad,
          tasa: Number(tasa), fuente: f.etiqueta,
        }),
      };
    } catch (e) {
      // Falla típica: la fuente cortó CORS o no hay conexión.
      return { unidad, ok: false, error: String(e.message || e).slice(0, 120) };
    }
  }

  /**
   * Actualiza todas las unidades. Devuelve la serie nueva y el detalle de qué
   * se pudo traer y qué no, para poder mostrarlo sin adivinar.
   */
  async function actualizarTodo(serie) {
    const resultados = await Promise.all(UNIDADES.map(traer));
    let nueva = serie || [];
    for (const r of resultados) {
      if (r.ok) nueva = upsert(nueva, r.cotizacion);
    }
    return {
      serie: nueva,
      actualizadas: resultados.filter((r) => r.ok).map((r) => r.unidad),
      fallidas: resultados.filter((r) => !r.ok).map((r) => ({ unidad: r.unidad, error: r.error })),
    };
  }

  // --------------------------------------------------------------------------
  // Conversión
  // --------------------------------------------------------------------------

  /** Moneda en la que se factura una cotización de un país dado. */
  function monedaDe(pais) {
    return PAISES[pais]?.moneda || "ARS";
  }

  /**
   * Convierte un importe cotizado en USD a la moneda del país.
   * Estados Unidos no convierte: ya está en la moneda de destino.
   */
  function convertir(montoUSD, pais, fecha, serie) {
    const p = PAISES[pais];
    if (!p) err("NX-032", `País desconocido: ${pais}`);
    if (p.sinConversion) {
      return { monto: E.money(montoUSD), moneda: "USD", tasa: 1, fecha: fecha || E.hoy(), fuente: "sin conversión" };
    }
    const c = cotizacion(serie, p.moneda, fecha);
    if (!c) {
      err("NX-030", `Sin cotización de ${p.moneda} al ${fecha || E.hoy()}`,
        "Actualizá los tipos de cambio antes de facturar");
    }
    return {
      monto: E.money(montoUSD * c.tasa), moneda: p.moneda,
      tasa: c.tasa, fecha: c.fecha, fuente: c.fuente,
    };
  }

  /**
   * Equivalente en UF de un importe en USD. Informativo: los contratos
   * chilenos suelen referenciarse en UF aunque se cotice y facture en otra
   * unidad, y tenerlo a la vista evita tener que calcularlo aparte.
   */
  function equivalenteUF(montoUSD, fecha, serie) {
    const clp = cotizacion(serie, "CLP", fecha);
    const uf = cotizacion(serie, "UF", fecha);
    if (!clp || !uf) return null;
    return E.money((montoUSD * clp.tasa) / uf.tasa);
  }

  // --------------------------------------------------------------------------
  // Facturación
  // --------------------------------------------------------------------------

  /**
   * Prepara el comprobante de un presupuesto aprobado, congelando el tipo de
   * cambio del día. No escribe nada: devuelve el registro para que pase por
   * las reglas.
   */
  function prepararFacturacion(presupuesto, opciones = {}) {
    const serie = opciones.serie || [];
    const hoy = opciones.hoy || E.hoy();

    if (presupuesto.estado !== "Aprobado") {
      err("NX-022", `Solo se factura un presupuesto aprobado (está ${presupuesto.estado})`);
    }

    const pais = opciones.pais || presupuesto.pais || "AR";
    const p = PAISES[pais];
    if (!p) err("NX-032", `País desconocido en el presupuesto: ${pais}`);

    // Estados Unidos factura en USD: no hay cotización que buscar ni que vencer.
    if (p.sinConversion) {
      return E.ENTIDADES.facturaciones.normalizar({
        presupuestoId: presupuesto.id, contratoId: opciones.contratoId || null,
        numeroComprobante: opciones.numeroComprobante || "",
        fechaEmision: hoy, pais,
        monedaCotizacion: "USD", montoCotizado: presupuesto.total,
        tcUnidad: "USD", tcValor: 1, tcFecha: hoy, tcFuente: "sin conversión",
        monedaLiquidacion: "USD", montoLiquidado: presupuesto.total,
        emitidoPor: opciones.usuario || "",
      });
    }

    const c = cotizacion(serie, p.moneda, hoy);
    if (!c) {
      err("NX-030", `No hay cotización de ${p.moneda} cargada`,
        "Actualizá los tipos de cambio en Configuración");
    }
    if (!estaVigente(serie, p.moneda, hoy)) {
      err("NX-031", `La cotización de ${p.moneda} es del ${c.fecha}`,
        "Actualizá antes de facturar: un comprobante con cotización vieja factura mal, " +
        "y corregirlo después implica nota de crédito");
    }

    return E.ENTIDADES.facturaciones.normalizar({
      presupuestoId: presupuesto.id,
      contratoId: opciones.contratoId || null,
      numeroComprobante: opciones.numeroComprobante || "",
      fechaEmision: hoy,
      pais,
      monedaCotizacion: "USD",
      montoCotizado: presupuesto.total,
      tcUnidad: p.moneda,
      tcValor: c.tasa,
      tcFecha: c.fecha,
      tcFuente: c.fuente,
      monedaLiquidacion: p.moneda,
      montoLiquidado: E.money(presupuesto.total * c.tasa),
      // Referencia en UF para Chile: no se factura en UF, pero es el número
      // con el que el cliente chileno piensa el contrato.
      referenciaUF: p.referenciaUF ? equivalenteUF(presupuesto.total, hoy, serie) : null,
      emitidoPor: opciones.usuario || "",
    });
  }

  /** Texto explicativo del cálculo, para mostrar en el comprobante. */
  function explicar(f) {
    const sim = { USD: "US$", ARS: "$", CLP: "CLP$", COP: "COP$", UYU: "$U", UF: "UF" };
    if (f.tcValor === 1 && f.monedaLiquidacion === "USD") {
      return `US$ ${f.montoCotizado.toLocaleString("es-AR")} · sin conversión`;
    }
    return `US$ ${f.montoCotizado.toLocaleString("es-AR")} × ` +
           `${f.tcValor.toLocaleString("es-AR")} = ` +
           `${sim[f.monedaLiquidacion]} ${Math.round(f.montoLiquidado).toLocaleString("es-AR")}` +
           `  ·  ${f.tcFuente}, ${f.tcFecha}`;
  }

  // --------------------------------------------------------------------------
  // Carga manual
  // --------------------------------------------------------------------------

  function nuevaCotizacion(unidad, tasa, fecha, fuente) {
    if (!UNIDADES.includes(unidad)) err("NX-040", `Unidad desconocida: ${unidad}`);
    const t = Number(tasa);
    if (!Number.isFinite(t) || t <= 0) err("NX-040", "La cotización tiene que ser un número positivo");
    const f = E.fecha(fecha) || E.hoy();
    if (f > E.hoy()) err("NX-040", "No se cargan cotizaciones a futuro");
    return E.ENTIDADES.tiposCambio.normalizar({
      id: `tc_${unidad}_${f}`, fecha: f, unidad, tasa: t,
      fuente: fuente || `${FUENTES[unidad]?.etiqueta || unidad} (carga manual)`,
    });
  }

  /** Inserta o reemplaza. Misma unidad y fecha pisa, no duplica. */
  function upsert(serie, cot) {
    const otras = (serie || []).filter(
      (x) => !(x.unidad === cot.unidad && x.fecha === cot.fecha));
    return [...otras, cot].sort(
      (a, b) => b.fecha.localeCompare(a.fecha) || a.unidad.localeCompare(b.unidad));
  }

  global.NEXO_CAMBIO = {
    TOLERANCIA_DIAS, PAISES, UNIDADES, FUENTES,
    cotizacion, estaVigente, estadoSerie,
    traer, actualizarTodo,
    monedaDe, convertir, equivalenteUF,
    prepararFacturacion, explicar,
    nuevaCotizacion, upsert,
  };
})(typeof window !== "undefined" ? window : globalThis);
