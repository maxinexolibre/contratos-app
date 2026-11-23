/**
 * Motor de comisiones.
 *
 * Separa tres cosas que en la práctica se confunden y generan discusiones con
 * los vendedores:
 *
 *   ACUERDO    las condiciones pactadas, versionadas por vigencia.
 *   DEVENGO    la comisión se gana cuando se firma el contrato.
 *   LIQUIDACIÓN la comisión se paga cuando corresponde, normalmente después
 *              de que el cliente pagó.
 *
 * Un acuerdo nunca se edita: cambiar condiciones crea uno nuevo con vigencia
 * desde la fecha del cambio. Así una comisión de hace seis meses siempre se
 * puede reconstruir con las reglas que regían ese día, que es lo único que
 * cierra una discusión sobre un pago.
 *
 * El cálculo deja registro de cómo llegó al número (`detalleCalculo`): qué
 * escalón se aplicó, si se topeó, sobre qué base. Un importe sin explicación
 * no se puede defender.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;

  const err = (codigo, mensaje, sugerencia) => {
    throw new global.NEXO_REGLAS.ErrorNexo(codigo, mensaje, sugerencia);
  };

  // --------------------------------------------------------------------------
  // Vigencia
  // --------------------------------------------------------------------------

  /** ¿El acuerdo rige en esa fecha? */
  function rigeEn(acuerdo, f) {
    if (!f) return false;
    if (acuerdo.vigenciaDesde > f) return false;
    if (acuerdo.vigenciaHasta && acuerdo.vigenciaHasta < f) return false;
    return true;
  }

  /** ¿El acuerdo alcanza a ese país? Sin países listados, alcanza a todos. */
  function alcanzaPais(acuerdo, pais) {
    return !acuerdo.paises?.length || acuerdo.paises.includes(pais);
  }

  /**
   * Acuerdo aplicable a un vendedor en una fecha. Si hubiera más de uno
   * vigente —que las reglas impiden— toma el más reciente y no falla en
   * silencio: la ambigüedad se reporta.
   */
  function acuerdoVigente(acuerdos, vendedorId, f) {
    const candidatos = (acuerdos || [])
      .filter((a) => a.alcance === "Vendedor" && a.vendedorId === vendedorId && rigeEn(a, f))
      .sort((a, b) => b.vigenciaDesde.localeCompare(a.vigenciaDesde));
    if (candidatos.length > 1) {
      console.warn(
        `Hay ${candidatos.length} acuerdos vigentes para ${vendedorId} al ${f}. ` +
        `Se aplica ${candidatos[0].id}. Revisar las vigencias.`);
    }
    return candidatos[0] || null;
  }

  /**
   * Acuerdos de área vigentes para un país y una fecha.
   * Son las asignaciones fijas de la empresa: corren sobre toda venta
   * concretada, en paralelo a lo pactado con el vendedor.
   */
  function acuerdosDeArea(acuerdos, pais, f) {
    return (acuerdos || [])
      .filter((a) => a.alcance === "Area" && rigeEn(a, f) && alcanzaPais(a, pais))
      .sort((a, b) => a.area.localeCompare(b.area));
  }

  /**
   * Dos acuerdos no pueden pisarse en el tiempo si aplican a lo mismo:
   * el mismo vendedor, o la misma área sobre países que se cruzan.
   */
  function seSolapa(a, b) {
    if (a.id === b.id || a.alcance !== b.alcance) return false;
    if (a.alcance === "Vendedor") {
      if (a.vendedorId !== b.vendedorId) return false;
    } else {
      if (a.area !== b.area) return false;
      // Sin países listados, alcanza a todos: siempre se cruza.
      const pa = a.paises?.length ? a.paises : null;
      const pb = b.paises?.length ? b.paises : null;
      if (pa && pb && !pa.some((p) => pb.includes(p))) return false;
    }
    const finA = a.vigenciaHasta || "9999-12-31";
    const finB = b.vigenciaHasta || "9999-12-31";
    return a.vigenciaDesde <= finB && b.vigenciaDesde <= finA;
  }

  /**
   * Reparto interno del área comercial: 4,5% del neto, repartido 6:2:1.
   *
   *   Gerencia comercial  6/9  → 3%
   *   Diseño              2/9  → 1%
   *   Marketing           1/9  → 0,5%
   *
   * Definido por Maxi el 2026-11-20. Reemplaza al reparto del 2026-08-05
   * (3 / 0,5 / 0,5 / 0,5 con un 0,5% para Ventas), y por decisión suya rige
   * para todas las operaciones, también las anteriores.
   *
   * Solo corresponde con clientes nuevos: ver `elegibilidad()`.
   */
  const PORCENTAJE_AREA = 4.5;
  const PROPORCION_AREA = [
    { area: "Gerencia comercial", partes: 6 },
    { area: "Diseño", partes: 2 },
    { area: "Marketing", partes: 1 },
  ];
  const PARTES_AREA = PROPORCION_AREA.reduce((s, r) => s + r.partes, 0);
  const REPARTO_INTERNO = PROPORCION_AREA.map((r) => ({
    area: r.area,
    partes: r.partes,
    porcentaje: Math.round((PORCENTAJE_AREA * r.partes / PARTES_AREA) * 1000) / 1000,
  }));

  const PAISES_REPARTO = ["AR", "CL", "CO", "UY", "US"];

  /** Genera los acuerdos del reparto interno, listos para guardar. */
  function acuerdosReparto(vigenciaDesde) {
    const desde = vigenciaDesde || E.hoy();
    return REPARTO_INTERNO.map((r) => E.ENTIDADES.acuerdosComision.normalizar({
      id: `acu_area_${r.area.toLowerCase().replace(/[^a-z]+/g, "-")}`,
      alcance: "Area",
      area: r.area,
      paises: PAISES_REPARTO,
      nombre: `${r.area} · ${r.porcentaje}% del neto`,
      modalidad: "Porcentaje",
      porcentaje: r.porcentaje,
      base: "Neto",
      moneda: "USD",
      // El reparto interno no espera al cobro: es asignación de resultado,
      // no un pago a un tercero.
      pagoTrasCobro: false,
      vigenciaDesde: desde,
      notas: "Reparto interno automático. Aplica a toda venta concretada.",
    }));
  }

  // --------------------------------------------------------------------------
  // Validación de escalones
  // --------------------------------------------------------------------------

  /**
   * Los escalones tienen que cubrir el rango sin huecos ni superposiciones.
   * Un hueco significa que una venta que cae ahí no comisiona nada, y nadie se
   * entera hasta que el vendedor reclama.
   */
  function validarEscalones(escalones) {
    if (!escalones.length) {
      err("NX-060", "Un acuerdo escalonado necesita al menos un tramo");
    }
    const orden = [...escalones].sort((a, b) => a.desde - b.desde);
    if (orden[0].desde !== 0) {
      err("NX-060", `El primer tramo tiene que arrancar en 0, arranca en ${orden[0].desde}`,
        "Si no, las ventas por debajo de ese monto no comisionan y nadie lo nota");
    }
    for (let i = 0; i < orden.length; i++) {
      const t = orden[i];
      if (t.porcentaje < 0 || t.porcentaje > 100) {
        err("NX-060", `Porcentaje fuera de rango en el tramo desde ${t.desde}: ${t.porcentaje}%`);
      }
      if (t.hasta !== null && t.hasta <= t.desde) {
        err("NX-060", `Tramo inválido: desde ${t.desde} hasta ${t.hasta}`);
      }
      const sig = orden[i + 1];
      if (!sig) {
        if (t.hasta !== null) {
          err("NX-060", "El último tramo tiene que quedar abierto (sin tope superior)",
            "Si no, una venta mayor al último tope no comisiona");
        }
        continue;
      }
      if (t.hasta === null) {
        err("NX-060", `El tramo desde ${t.desde} queda abierto pero hay tramos posteriores`);
      }
      if (sig.desde < t.hasta) {
        err("NX-060", `Los tramos se superponen entre ${t.desde}-${t.hasta} y ${sig.desde}`);
      }
      if (sig.desde > t.hasta) {
        err("NX-060", `Hay un hueco entre ${t.hasta} y ${sig.desde}: una venta en ese rango no comisionaría`);
      }
    }
    return true;
  }

  // --------------------------------------------------------------------------
  // Cálculo
  // --------------------------------------------------------------------------

  /**
   * Comisión escalonada MARGINAL: cada tramo se aplica solo a la porción del
   * monto que cae dentro de él, como el impuesto a las ganancias.
   *
   * La alternativa —aplicar el porcentaje del tramo alcanzado a todo el monto—
   * genera saltos absurdos: vender 1 peso más te haría ganar cientos más de
   * comisión, y crea el incentivo a esperar para cerrar.
   */
  function calcularEscalonada(monto, escalones) {
    let total = 0;
    const tramos = [];
    for (const t of [...escalones].sort((a, b) => a.desde - b.desde)) {
      if (monto <= t.desde) break;
      const techo = t.hasta === null ? monto : Math.min(monto, t.hasta);
      const porcion = techo - t.desde;
      if (porcion <= 0) continue;
      const parte = E.money((porcion * t.porcentaje) / 100);
      total += parte;
      tramos.push(`${t.porcentaje}% sobre ${Math.round(porcion).toLocaleString("es-AR")}`);
    }
    return { monto: E.money(total), detalle: tramos.join(" + ") };
  }

  /**
   * Calcula la comisión de una operación.
   *
   * @param {object} acuerdo
   * @param {number} base   monto sobre el que se comisiona, ya en la moneda del acuerdo
   * @returns {{monto:number, porcentaje:number, detalle:string}}
   */
  function calcular(acuerdo, base) {
    if (!acuerdo) err("NX-061", "No hay acuerdo de comisión vigente para esa fecha");
    if (!(base > 0)) return { monto: 0, porcentaje: 0, detalle: "base 0" };

    let monto = 0;
    let detalle = "";

    switch (acuerdo.modalidad) {
      case "Porcentaje":
        monto = E.money((base * acuerdo.porcentaje) / 100);
        detalle = `${acuerdo.porcentaje}% sobre ${Math.round(base).toLocaleString("es-AR")}`;
        break;

      case "Fija":
        monto = acuerdo.montoFijo;
        detalle = `monto fijo por operación`;
        break;

      case "Escalonada": {
        const r = calcularEscalonada(base, acuerdo.escalones);
        monto = r.monto; detalle = r.detalle;
        break;
      }

      case "Mixta": {
        const r = calcularEscalonada(base, acuerdo.escalones);
        monto = E.money(acuerdo.montoFijo + r.monto);
        detalle = `fijo ${acuerdo.montoFijo} + ${r.detalle}`;
        break;
      }

      default:
        err("NX-060", `Modalidad desconocida: ${acuerdo.modalidad}`);
    }

    // El tope se aplica al final y se deja dicho: una comisión recortada sin
    // aviso es la forma más rápida de perder la confianza del vendedor.
    if (acuerdo.tope > 0 && monto > acuerdo.tope) {
      detalle += ` · topeado en ${acuerdo.tope.toLocaleString("es-AR")} (calculado ${monto.toLocaleString("es-AR")})`;
      monto = acuerdo.tope;
    }

    const porcentaje = base > 0 ? E.money((monto / base) * 100) : 0;
    return { monto, porcentaje, detalle: `${detalle} · base ${acuerdo.base}` };
  }

  // --------------------------------------------------------------------------
  // Devengo
  // --------------------------------------------------------------------------

  /**
   * Base de cálculo según lo que diga el acuerdo.
   *
   * "Neto" es el criterio habitual: el valor de la venta sin IVA. Comisionar
   * sobre el bruto pagaría comisión sobre un impuesto que la empresa apenas
   * recauda para el fisco.
   */
  function baseSegunAcuerdo(acuerdo, { montoContrato, presupuesto, meses }) {
    let bruto = montoContrato;
    let nota = "";
    if (meses > 1) {
      bruto = E.money(bruto * meses);
      nota = ` (${meses} meses de abono)`;
    }

    if (acuerdo.base === "Neto") {
      // El neto sale del presupuesto, que es donde vive el IVA. Sin
      // presupuesto asociado no se puede saber si el importe lo incluye:
      // se toma tal cual y se deja dicho.
      if (!presupuesto) {
        return { base: bruto, nota: nota + " · sin presupuesto: se asume neto" };
      }
      const factor = presupuesto.total > 0 ? presupuesto.neto / presupuesto.total : 1;
      return { base: E.money(bruto * factor), nota: nota + (factor < 1 ? " · neto sin IVA" : "") };
    }
    return { base: bruto, nota };
  }

  /**
   * Genera TODAS las comisiones que corresponden a un contrato firmado:
   * la del vendedor según lo pactado, más el reparto interno por área.
   *
   * No escribe nada: devuelve los registros para que pasen por las reglas.
   *
   * @returns {Array} una comisión por acuerdo aplicable
   */
  function devengarPorContrato(contrato, ctx) {
    const vigente = ["Firmado", "Activo", "Finalizado"].includes(contrato.estado);
    if (!vigente) {
      err("NX-062",
        `El contrato ${contrato.numero} está en ${contrato.estado}`,
        "La comisión se devenga con la firma, no antes");
    }

    // ¿Ya existe? Devengar dos veces la misma operación es el error más caro.
    const ya = (ctx.comisiones || []).find(
      (c) => c.origenTipo === "Contrato" && c.origenId === contrato.id && c.estado !== "Anulada");
    if (ya) {
      err("NX-063",
        `El contrato ${contrato.numero} ya tiene una comisión devengada (${ya.id})`,
        "Anulá la anterior si querés recalcular");
    }

    const ticket = (ctx.tickets || []).find((t) => t.id === contrato.ticketId);
    const presupuesto = (ctx.presupuestos || []).find((p) => p.id === contrato.presupuestoId);
    const fechaDevengo = contrato.fechaFirma || E.hoy();
    // El país sale del presupuesto de origen: es donde se cotizó.
    const pais = contrato.pais || presupuesto?.pais || ticket?.pais || "AR";

    // Un abono mensual se comisiona sobre los meses pactados, no sobre el
    // canon como si fuera una venta única.
    const mesesDe = (acuerdo) => contrato.recurrencia === "mensual"
      ? (acuerdo.mesesRecurrente > 0 ? acuerdo.mesesRecurrente : (contrato.vigencia?.meses || 12))
      : 1;

    const comun = {
      origenTipo: "Contrato",
      origenId: contrato.id,
      origenNumero: contrato.numero,
      clienteId: contrato.clienteId || ticket?.clienteId || "",
      periodo: fechaDevengo.slice(0, 7),
      estado: "Devengada",
      fechaDevengo,
      pais,
    };

    const generadas = [];

    /** Arma una comisión a partir de un acuerdo aplicable. */
    const aplicar = (acuerdo, extra) => {
      if (contrato.economico.moneda !== acuerdo.moneda) {
        err("NX-065",
          `El contrato está en ${contrato.economico.moneda} y el acuerdo en ${acuerdo.moneda}`,
          "Convertir monedas acá inventaría un tipo de cambio: alineá el acuerdo");
      }
      const { base, nota } = baseSegunAcuerdo(acuerdo, {
        montoContrato: contrato.economico.canonMensual,
        presupuesto, meses: mesesDe(acuerdo),
      });
      const r = calcular(acuerdo, base);
      generadas.push(E.ENTIDADES.comisiones.normalizar({
        ...comun, ...extra,
        acuerdoId: acuerdo.id,
        baseCalculo: base,
        porcentajeAplicado: r.porcentaje,
        monto: r.monto,
        moneda: acuerdo.moneda,
        detalleCalculo: r.detalle + nota,
      }));
    };

    // --- Comisión del vendedor -------------------------------------------
    const vendedorId = ctx.vendedorId || ticket?.vendedor;
    const vendedor = vendedorId && (ctx.vendedores || []).find(
      (v) => v.id === vendedorId || v.usuarioId === vendedorId || v.nombre === vendedorId);

    if (vendedor) {
      const acuerdo = acuerdoVigente(ctx.acuerdos, vendedor.id, fechaDevengo);
      if (acuerdo) {
        aplicar(acuerdo, { alcance: "Vendedor", vendedorId: vendedor.id });
      } else if (!ctx.permitirSinAcuerdo) {
        err("NX-061",
          `${vendedor.nombre} no tiene acuerdo de comisión vigente al ${fechaDevengo}`,
          "Cargá el acuerdo, o devengá solo el reparto interno");
      }
    } else if (!ctx.permitirSinVendedor) {
      err("NX-064",
        `No se puede saber a qué vendedor corresponde ${contrato.numero}`,
        "El contrato no tiene ticket de origen, el ticket no tiene vendedor asignado, " +
        "o esa persona no está dada de alta como vendedor");
    }

    // --- Reparto interno por área ----------------------------------------
    // Corre siempre, con o sin vendedor: es asignación de resultado de la
    // empresa, no un pago a un tercero.
    for (const a of acuerdosDeArea(ctx.acuerdos, pais, fechaDevengo)) {
      aplicar(a, { alcance: "Area", area: a.area });
    }

    if (!generadas.length) {
      err("NX-061", `No hay ningún acuerdo aplicable a ${contrato.numero} al ${fechaDevengo}`);
    }
    return generadas;
  }

  // --------------------------------------------------------------------------
  // Liquidación
  // --------------------------------------------------------------------------

  /**
   * ¿Se puede liquidar? Con `pagoTrasCobro` hace falta que la operación esté
   * facturada. Es la regla que evita pagar comisión por una venta incobrable.
   */
  function puedeLiquidarse(comision, ctx) {
    if (comision.estado !== "Aprobada") {
      return { puede: false, motivo: `Está ${comision.estado}: primero hay que aprobarla` };
    }
    const acuerdo = (ctx.acuerdos || []).find((a) => a.id === comision.acuerdoId);
    if (acuerdo?.pagoTrasCobro) {
      const facturado = (ctx.facturaciones || []).some(
        (f) => f.contratoId === comision.origenId || f.presupuestoId === comision.origenId);
      if (!facturado) {
        return {
          puede: false,
          motivo: "El acuerdo condiciona el pago al cobro y la operación todavía no se facturó",
        };
      }
    }
    return { puede: true, motivo: "" };
  }

  // --------------------------------------------------------------------------
  // Resumen por vendedor
  // --------------------------------------------------------------------------

  /** Totales por estado, sin mezclar monedas. */
  function resumen(comisiones) {
    const out = {};
    for (const e of E.COMISION_ESTADO) out[e] = {};
    for (const c of comisiones || []) {
      const m = c.moneda;
      out[c.estado][m] = E.money((out[c.estado][m] || 0) + c.monto);
    }
    return out;
  }

  /**
   * Cuadro de mando por vendedor: lo que un gerente comercial necesita ver
   * para decidir sobre su equipo.
   */
  function panelVendedores(vendedores, ctx) {
    const K = global.NEXO_KPI;
    const comisiones = ctx.comisiones || [];
    const porVendedor = K.porVendedor(ctx.tickets || [], ctx);

    return (vendedores || []).map((v) => {
      // Los tickets guardan el nombre de usuario, no el id del vendedor.
      const kpi = porVendedor.find(
        (x) => x.vendedor === v.usuarioId || x.vendedor === v.nombre) || {};
      const suyas = comisiones.filter((c) => c.vendedorId === v.id);
      const res = resumen(suyas);

      const ingresos = kpi.ingresos || {};
      const devengado = res.Devengada[v.metaMoneda] || 0;
      const aprobado = res.Aprobada[v.metaMoneda] || 0;
      const liquidado = res.Liquidada[v.metaMoneda] || 0;
      const ganado = ingresos[v.metaMoneda] || 0;

      return {
        ...v,
        tickets: kpi.totales || 0,
        ganados: kpi.ganados || 0,
        abiertos: kpi.abiertos || 0,
        tasaConversion: kpi.tasaConversion ?? null,
        cicloPromedio: kpi.cicloPromedio ?? null,
        ingresos,
        pipeline: kpi.pipeline || {},
        comisiones: res,
        // Cumplimiento de cuota sobre lo efectivamente ganado en el período.
        cumplimiento: v.metaMensual > 0 ? K.pct(ganado, v.metaMensual) : null,
        // Costo comercial: cuánto de cada venta se va en comisión. Es el número
        // que dice si el esquema de comisiones es sostenible.
        costoComercial: ganado > 0
          ? K.pct(devengado + aprobado + liquidado, ganado) : null,
        pendienteDePago: E.money(devengado + aprobado),
      };
    }).sort((a, b) => (b.ganados || 0) - (a.ganados || 0));
  }

  /** Totales del reparto interno por área, sin mezclar monedas. */
  function resumenPorArea(comisiones) {
    const out = {};
    for (const c of comisiones || []) {
      if (c.alcance !== "Area" || c.estado === "Anulada") continue;
      out[c.area] = out[c.area] || {};
      out[c.area][c.moneda] = E.money((out[c.area][c.moneda] || 0) + c.monto);
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // Seguimiento por operación
  // --------------------------------------------------------------------------
  //
  // Cómo funciona, en simple:
  //
  //   1. Cuando entra el lead se anota quién lo trajo (ticket.traidoPor).
  //   2. Al ENVIAR el presupuesto o la propuesta se decide si lleva comisión.
  //      La app propone la respuesta mirando la historia del cliente, y se
  //      guarda una "marca" con esa decisión.
  //   3. De ahí en adelante el estado avanza solo, leyendo la operación:
  //        Prevista   la propuesta salió y no se cerró
  //        Devengada  el cliente aceptó
  //        ACobrar    el cliente pagó: ya se le puede pagar al comercial
  //        Pagada     se registró el pago de la comisión
  //        Anulada    la operación se rechazó o se anuló
  //
  // El estado no se guarda porque guardarlo exigía que alguien se acordara de
  // moverlo en cada firma y en cada cobro. Así fue como el circuito anterior
  // (devengar a mano al firmar el contrato) quedó sin usar.

  /**
   * Corte de "cliente nuevo" para el área comercial (Maxi, 2026-11-20):
   * corresponde comisión con clientes que entraron desde marzo de 2026 y no
   * tuvieron actividad anterior con Nexo.
   */
  const FECHA_CLIENTE_NUEVO = "2026-03-01";
  /**
   * Si la actividad anterior es de hace más de estos años, se toma como caso
   * aislado y se pregunta en vez de decidir: puede corresponder o no.
   */
  const ANIOS_AISLADO = 2;
  /** Días a partir de los cuales una comisión se considera colgada. */
  const PLAZOS_ALERTA = { aCobrarDias: 30, sinCobroDias: 60 };

  const restarAnios = (f, n) => `${Number(f.slice(0, 4)) - n}${f.slice(4)}`;
  const diasEntre = (desde, hasta) =>
    Math.round((Date.parse(hasta + "T00:00:00Z") - Date.parse(desde + "T00:00:00Z")) / 86400000);

  const claveBeneficiario = (tipo, id) => (tipo === "Area" ? `area:${id}` : `vnd:${id}`);

  /** Ids de cliente que cuentan como "el mismo": el cliente y las sedes de su grupo. */
  function clientesDelGrupo(clienteId, clientes) {
    const ids = new Set([clienteId]);
    const c = (clientes || []).find((x) => x.id === clienteId);
    if (c?.grupo) {
      const k = E.claveCliente(c.grupo);
      for (const x of clientes) if (x.grupo && E.claveCliente(x.grupo) === k) ids.add(x.id);
    }
    return ids;
  }

  const coleccion = (origenTipo) => (origenTipo === "Propuesta" ? "propuestas" : "presupuestos");
  const operacionDe = (marca, ctx) =>
    (ctx[coleccion(marca.origenTipo)] || []).find((o) => o.id === marca.origenId) || null;
  const fechaOperacion = (origenTipo, op) =>
    (origenTipo === "Propuesta" ? op.fechas?.creado : op.fecha) || E.hoy();
  const ticketDe = (op, ctx) =>
    op?.ticketId ? (ctx.tickets || []).find((t) => t.id === op.ticketId) || null : null;

  /**
   * Trabajos efectuados del cliente (o su grupo) con Nexo, ordenados por fecha.
   *
   * Solo cuentan trabajos hechos (Maxi, 2026-11-23): presupuestos aprobados,
   * propuestas aceptadas y contratos firmados. Un ticket o un presupuesto
   * rechazado es una consulta, no un cliente. No se exige el cobro: antes de
   * Facturación no se registraba, y exigirlo volvía "nuevos" a todos los
   * clientes viejos.
   *
   * Se excluye la operación misma y lo que viene del mismo pedido: el ticket
   * que la originó y las otras versiones del presupuesto. Si no, un lead que
   * entró en febrero y cerró en noviembre quedaría como "cliente existente"
   * por su propio ticket.
   */
  function actividadesCliente(clienteId, ctx, { excluirIds = [], excluirTicket = null, excluirNumeros = [] } = {}) {
    if (!clienteId) return [];
    const ids = clientesDelGrupo(clienteId, ctx.clientes);
    const fuera = new Set(excluirIds.filter(Boolean));
    const numerosFuera = new Set(excluirNumeros.filter(Boolean));
    const out = [];
    const sumar = (tipo, r, f) => {
      if (!f || !ids.has(r.clienteId) || fuera.has(r.id)) return;
      if (excluirTicket && (r.id === excluirTicket || r.ticketId === excluirTicket)) return;
      if (r.numero && numerosFuera.has(r.numero)) return;
      out.push({ tipo, id: r.id, numero: r.numero || "", fecha: f });
    };
    for (const p of ctx.presupuestos || []) {
      if (p.estado === "Aprobado") sumar("Presupuesto", p, p.fecha);
    }
    for (const p of ctx.propuestas || []) {
      if (p.estado === "Aceptada") sumar("Propuesta", p, p.fechas?.creado);
    }
    for (const c of ctx.contratos || []) {
      if (["Firmado", "Activo", "Finalizado"].includes(c.estado)) {
        sumar("Contrato", c, c.fechaFirma || c.fechas?.creado || c.vigencia?.inicio);
      }
    }
    return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  /**
   * ¿Corresponde comisión según la historia del cliente?
   *
   * @returns {{criterio, lleva, motivo, primeraActividad, previas}}
   *   lleva es true/false cuando la app puede decidir y null cuando pregunta.
   */
  function elegibilidad(origenTipo, op, ctx) {
    if (!op.clienteId) {
      return { criterio: "Consulta", lleva: null, primeraActividad: null, previas: [],
        motivo: "No se pudo identificar al cliente en el padrón: revisá si es nuevo." };
    }
    const fOp = fechaOperacion(origenTipo, op);
    const todas = actividadesCliente(op.clienteId, ctx, {
      excluirIds: [op.id],
      excluirTicket: op.ticketId,
      // Un acuerdo pasado a propuesta guarda el número que tuvo como presupuesto.
      excluirNumeros: [op.numeroLegado],
    });
    const primera = [todas[0]?.fecha, fOp].filter(Boolean).sort()[0];
    const previas = todas.filter((a) => a.fecha < FECHA_CLIENTE_NUEVO);
    const nombre = (a) => `${a.tipo.toLowerCase()} ${a.numero || ""}`.trim();

    if (!previas.length) {
      return { criterio: "ClienteNuevo", lleva: true, primeraActividad: primera, previas,
        motivo: todas.length
          ? `Cliente nuevo: empezó con Nexo el ${primera}, después de marzo de 2026.`
          : "Cliente nuevo: es su primera operación con Nexo." };
    }
    const ultima = previas[previas.length - 1];
    if (ultima.fecha < restarAnios(fOp, ANIOS_AISLADO)) {
      return { criterio: "Consulta", lleva: null, primeraActividad: primera, previas,
        motivo: `Tuvo actividad aislada hace años (${nombre(ultima)}, ${ultima.fecha}). ` +
          "La app no lo decide sola: ¿corresponde comisión?" };
    }
    return { criterio: "ClienteExistente", lleva: false, primeraActividad: primera, previas,
      motivo: `Cliente existente: trabaja con Nexo desde el ${previas[0].fecha} (${nombre(previas[0])}).` };
  }

  /** Porcentaje pactado con un vendedor a una fecha, si su acuerdo es un porcentaje simple. */
  function porcentajeHabitual(vendedorId, f, acuerdos) {
    const a = acuerdoVigente(acuerdos, vendedorId, f);
    return a && a.modalidad === "Porcentaje" ? a.porcentaje : null;
  }

  /**
   * Lo que la app propone al enviar: la decisión según la historia del
   * cliente y, si el lead tiene asignado quién lo trajo, su comisión.
   */
  function sugerirMarca(origenTipo, op, ctx) {
    const el = elegibilidad(origenTipo, op, ctx);
    const ticket = ticketDe(op, ctx);
    const traidoPor = ticket?.traidoPor || null;
    return {
      origenTipo,
      origenId: op.id,
      origenNumero: op.numero,
      clienteId: op.clienteId,
      criterio: el.criterio,
      lleva: el.lleva,
      area: el.lleva === true,
      explicacion: el.motivo,
      primeraActividad: el.primeraActividad,
      previas: el.previas,
      ticketId: ticket?.id || null,
      traidoPor,
      externo: traidoPor
        ? { vendedorId: traidoPor,
            porcentaje: porcentajeHabitual(traidoPor, fechaOperacion(origenTipo, op), ctx.acuerdos || ctx.acuerdosComision) }
        : null,
    };
  }

  /** ¿Se cobra mes a mes? */
  const esAbono = (origenTipo, op) =>
    origenTipo === "Propuesta" || op?.economico?.recurrencia === "mensual";

  /** Factor para pasar un importe cotizado a sin IVA. */
  function factorSinIVA(origenTipo, op) {
    if (origenTipo === "Propuesta") {
      const eco = op.economico || {};
      return eco.incluyeIVA ? 1 / (1 + (eco.ivaPct ?? 21) / 100) : 1;
    }
    return op.total > 0 ? op.neto / op.total : 1;
  }

  /**
   * Sobre qué se calcula: el precio sin IVA (Maxi, 2026-11-23). En una venta
   * de equipo se descuentan antes los costos (parte, flete, importación):
   * el 10% sobre el precio se comía el margen.
   *
   * Un abono se toma por 12 meses (o la vigencia de la propuesta) para mostrar
   * lo esperado, pero se libera mes a mes con cada cobro. Si en un caso se
   * pactó otra cosa, la marca guarda una base cargada a mano.
   *
   * @returns {{base, bruto, costos, moneda, mensual, detalle}}
   *   bruto: total sin IVA esperado; base: bruto menos costos; mensual: lo de
   *   un mes en un abono, null si es una venta única.
   */
  function baseOperacion(origenTipo, op, marca) {
    const moneda = op?.economico?.moneda || "USD";
    const costos = marca?.costos ?? 0;
    if (marca?.baseManual != null) {
      return { base: marca.baseManual, bruto: marca.baseManual, costos: 0, moneda, mensual: null,
        detalle: "base cargada a mano" };
    }
    if (!op) return { base: 0, bruto: 0, costos: 0, moneda, mensual: null, detalle: "operación no encontrada" };
    let bruto, mensual = null, detalle;
    if (origenTipo === "Propuesta") {
      const meses = op.vigenciaPropuesta?.meses || 12;
      mensual = E.money((op.economico?.canonMensual || 0) * factorSinIVA(origenTipo, op));
      bruto = E.money(mensual * meses);
      detalle = `canon sin IVA × ${meses} meses`;
    } else if (op.economico?.recurrencia === "mensual") {
      mensual = op.neto;
      bruto = E.money(op.neto * 12);
      detalle = "abono sin IVA × 12 meses";
    } else {
      bruto = op.neto;
      detalle = "precio sin IVA";
    }
    const base = E.money(Math.max(0, bruto - costos));
    if (costos > 0) detalle += ` menos costos ${Math.round(costos).toLocaleString("es-AR")}`;
    return { base, bruto, costos, moneda, mensual, detalle };
  }

  /** En qué quedó la operación: Abierta, Ganada o Perdida, y desde cuándo. */
  function etapaOperacion(origenTipo, op) {
    if (!op) return { etapa: "Abierta", fecha: null };
    if (origenTipo === "Propuesta") {
      if (op.estado === "Aceptada") return { etapa: "Ganada", fecha: op.fechas?.resuelto || op.fechas?.enviado || op.fechas?.creado };
      if (op.estado === "Rechazada") return { etapa: "Perdida", fecha: op.fechas?.resuelto || null };
      return { etapa: "Abierta", fecha: op.fechas?.enviado || null };
    }
    // El historial guarda los estados como los escribe la pantalla ("ganado").
    const hist = (op.historialEstados || []);
    const cuando = (...ests) => [...hist].reverse().find((h) => ests.includes(h.estado))?.fecha || null;
    if (op.estado === "Aprobado") return { etapa: "Ganada", fecha: cuando("ganado", "Aprobado") || op.fechaEnvio || op.fecha };
    if (op.estado === "Rechazado" || op.estado === "Anulado") {
      return { etapa: "Perdida", fecha: cuando("perdido", "anulado", "Rechazado", "Anulado") };
    }
    return { etapa: "Abierta", fecha: op.fechaEnvio || null };
  }

  /**
   * Cobros registrados de la operación, en orden, sin IVA y en la moneda en
   * que se cotizó. Una nota de crédito resta. Registrar un cobro en
   * Facturación es lo que libera la comisión.
   */
  function cobros(origenTipo, op, facturaciones) {
    if (!op) return [];
    const factor = factorSinIVA(origenTipo, op);
    return (facturaciones || [])
      .filter((x) => x.presupuestoId === op.id || (op.contratoId && x.contratoId === op.contratoId))
      .map((x) => ({
        fecha: x.fechaEmision,
        periodo: x.periodoCobrado,
        monto: E.money((x.tipoComprobante === "NotaCredito" ? -1 : 1) * x.montoCotizado * factor),
        // TC con que se facturó: es el que rige si la comisión se paga en pesos.
        tcValor: x.monedaLiquidacion === "ARS" && x.tcUnidad === "USD" ? x.tcValor : null,
        tcFecha: x.tcFecha,
        comprobante: x.numeroComprobante,
      }))
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  }

  /** Fecha del primer cobro, o null. */
  function fechaCobro(origenTipo, op, facturaciones) {
    return cobros(origenTipo, op, facturaciones).find((c) => c.monto > 0)?.fecha || null;
  }

  /**
   * Las comisiones de una operación, una por beneficiario.
   *
   * Se pagan a medida que el cliente paga (Maxi, 2026-11-23): lo "liberado"
   * es el porcentaje de lo cobrado, en proporción a la base si hubo costos.
   * En una venta única no pasa del total; en un abono sigue mes a mes
   * mientras el cliente pague (una renovación vuelve a comisionar).
   *
   *   Prevista    la propuesta salió y no se cerró
   *   Devengada   ganada; falta que el cliente pague (todo o una parte)
   *   ACobrar     hay comisión liberada sin pagar
   *   Pagada      se pagó todo lo liberado (en un abono: al día)
   *   Anulada     la operación se perdió; si algo se había pagado, queda
   *               como saldo a compensar con la próxima comisión
   */
  function lineas(marca, ctx, hoy = E.hoy()) {
    if (!marca.lleva) return [];
    const op = operacionDe(marca, ctx);
    if (!op && marca.baseManual == null) return [];
    const b = baseOperacion(marca.origenTipo, op, marca);
    const etapa = etapaOperacion(marca.origenTipo, op);
    const cs = cobros(marca.origenTipo, op, ctx.facturaciones);
    const abono = esAbono(marca.origenTipo, op);
    const proporcion = b.bruto > 0 ? b.base / b.bruto : 0;

    const items = [];
    if (marca.externo) {
      const v = (ctx.vendedores || []).find((x) => x.id === marca.externo.vendedorId);
      items.push({ clave: claveBeneficiario("Externo", marca.externo.vendedorId), tipo: "Externo",
        nombre: v?.nombre || marca.externo.vendedorId, vendedorId: marca.externo.vendedorId,
        porcentaje: marca.externo.porcentaje });
    }
    if (marca.area) {
      for (const r of REPARTO_INTERNO) {
        // El reparto va a personas: quien esté asignado a esa parte en Vendedores.
        const v = (ctx.vendedores || []).find((x) => x.areaComision === r.area && x.estado !== "Inactivo");
        items.push({ clave: claveBeneficiario("Area", r.area), tipo: "Area", area: r.area,
          nombre: v ? `${r.area} · ${v.nombre}` : `${r.area} · sin asignar`,
          vendedorId: v?.id || null, porcentaje: r.porcentaje });
      }
    }

    return items.map((it) => {
      const pct = it.porcentaje / 100;
      const monto = E.money(b.base * pct);
      // Liberado: acumulado cobro a cobro, para saber desde cuándo está pendiente.
      let acum = 0;
      const tramos = cs.map((c) => {
        acum = E.money(acum + c.monto * proporcion * pct);
        return { fecha: c.fecha, acum };
      });
      let liberado = Math.max(0, acum);
      if (!abono) liberado = Math.min(liberado, monto);
      liberado = E.money(liberado);
      const pagos = marca.pagos.filter((p) => p.beneficiario === it.clave);
      const pagado = E.money(pagos.reduce((s, p) => s + p.monto, 0));
      const perdida = etapa.etapa === "Perdida";
      // Si la operación se perdió, no hay nada liberado: lo pagado se compensa.
      const pendiente = E.money((perdida ? 0 : liberado) - pagado);

      let estado, desde;
      if (perdida) {
        estado = "Anulada"; desde = etapa.fecha;
      } else if (pendiente > 0.01) {
        estado = "ACobrar";
        desde = tramos.find((t) => t.acum > pagado + 0.01)?.fecha || null;
      } else if (pagado > 0 && (abono || pagado >= monto - 0.01)) {
        estado = "Pagada"; desde = pagos.map((p) => p.fecha).sort().pop();
      } else if (etapa.etapa === "Ganada") {
        estado = "Devengada"; desde = etapa.fecha;
      } else if (pagado > 0) {
        estado = "Pagada"; desde = pagos.map((p) => p.fecha).sort().pop();
      } else {
        estado = "Prevista"; desde = marca.fecha;
      }
      const ultimoCobro = [...cs].reverse().find((c) => c.monto > 0) || null;
      return {
        ...it, base: b.base, bruto: b.bruto, costos: b.costos, moneda: b.moneda, abono,
        monto, mensual: b.mensual != null ? E.money(b.mensual * proporcion * pct) : null,
        cobrado: E.money(cs.reduce((s, c) => s + c.monto, 0)),
        liberado, pagado,
        pendiente: Math.max(0, pendiente),
        // Pagado de más (operación anulada, o un adelanto que no se cobró):
        // se descuenta de la próxima comisión de la misma persona.
        aCompensar: pendiente < -0.01 ? E.money(-pendiente) : 0,
        // Plata que efectivamente salió: una compensación o un ajuste no son
        // pagos nuevos, solo mueven saldo entre operaciones.
        pagadoEfectivo: E.money(pagos.filter((p) => p.tipo === "Pago").reduce((s, p) => s + p.monto, 0)),
        // TC del último cobro en pesos: el que rige si se le paga en pesos.
        tcSugerido: ultimoCobro?.tcValor ? { valor: ultimoCobro.tcValor, fecha: ultimoCobro.tcFecha,
          comprobante: ultimoCobro.comprobante } : null,
        estado, desde: desde || null,
        dias: desde ? diasEntre(desde, hoy) : null,
        detalle: `${String(it.porcentaje).replace(".", ",")}% sobre ${b.detalle}`,
      };
    });
  }

  const marcaDe = (origenTipo, origenId, marcas) =>
    (marcas || []).find((m) => m.origenTipo === origenTipo && m.origenId === origenId) || null;

  /** Una fila por operación marcada, con sus comisiones. */
  function filasSeguimiento(ctx, hoy = E.hoy()) {
    const clientes = new Map((ctx.clientes || []).map((c) => [c.id, c]));
    return (ctx.marcasComision || []).map((m) => {
      const op = operacionDe(m, ctx);
      const cli = clientes.get(m.clienteId || op?.clienteId);
      return {
        marca: m,
        op,
        numero: m.origenNumero || op?.numero || "",
        cliente: cli?.nombreComercial || "—",
        pais: op?.pais || "",
        tipo: m.origenTipo === "Propuesta" ? "Acuerdo"
          : (op?.tipo === "venta" ? "Venta" : "Servicio"),
        fecha: op ? fechaOperacion(m.origenTipo, op) : m.fecha,
        etapa: etapaOperacion(m.origenTipo, op).etapa,
        lineas: lineas(m, ctx, hoy),
      };
    }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }

  /**
   * Totales separados por moneda, por concepto:
   *   Prevista    lo que pagarían las propuestas abiertas
   *   Devengada   lo ganado que el cliente todavía no pagó
   *   ACobrar     liberado sin pagar
   *   Pagada      plata que efectivamente salió
   *   ACompensar  pagado de más, a descontar de la próxima
   * Una misma línea puede aportar a varios (un pago parcial de una venta en
   * cuotas): por eso se suma por concepto y no por estado.
   */
  function totalesSeguimiento(filas) {
    const out = { Prevista: {}, Devengada: {}, ACobrar: {}, Pagada: {}, ACompensar: {} };
    const sumar = (k, m, v) => { if (v > 0.005) out[k][m] = E.money((out[k][m] || 0) + v); };
    for (const f of filas) {
      for (const l of f.lineas) {
        if (l.estado === "Prevista") sumar("Prevista", l.moneda, l.monto);
        else if (l.estado !== "Anulada") sumar("Devengada", l.moneda, Math.max(0, l.monto - l.liberado));
        sumar("ACobrar", l.moneda, l.pendiente);
        sumar("Pagada", l.moneda, l.pagadoEfectivo);
        sumar("ACompensar", l.moneda, l.aCompensar);
      }
    }
    return out;
  }

  /**
   * Saldos a compensar de una persona (o una parte del reparto), para
   * descontarlos cuando se le paga la próxima comisión.
   */
  function saldosACompensar(ctx, clave, moneda) {
    const out = [];
    for (const f of filasSeguimiento(ctx)) {
      for (const l of f.lineas) {
        if (l.clave === clave && l.moneda === moneda && l.aCompensar > 0) {
          out.push({ marcaId: f.marca.id, numero: f.numero, monto: l.aCompensar });
        }
      }
    }
    return out;
  }

  /**
   * Operaciones enviadas o ganadas desde el corte que nunca se marcaron con
   * o sin comisión. Las anteriores al corte no se reclaman: el área comercial
   * no comisiona con clientes de antes.
   */
  function operacionesPendientesDeMarca(ctx) {
    const marcas = ctx.marcasComision || [];
    const out = [];
    const revisar = (origenTipo, op, enviada) => {
      if (!enviada) return;
      if (fechaOperacion(origenTipo, op) < FECHA_CLIENTE_NUEVO) return;
      if (marcaDe(origenTipo, op.id, marcas)) return;
      out.push({ origenTipo, op, numero: op.numero, etapa: etapaOperacion(origenTipo, op) });
    };
    for (const p of ctx.presupuestos || []) revisar("Presupuesto", p, ["Enviado", "Aprobado"].includes(p.estado));
    for (const p of ctx.propuestas || []) revisar("Propuesta", p, ["Enviada", "Aceptada"].includes(p.estado));
    return out;
  }

  /**
   * Comisiones colgadas. Pasa seguido que nadie la reclama y queda ahí:
   * estas alertas son las que la sacan a la luz.
   */
  function alertas(ctx, hoy = E.hoy(), plazos = PLAZOS_ALERTA) {
    const out = [];
    const sim = (m) => ({ USD: "US$", UF: "UF", ARS: "$" }[m] || m);
    const fmt = (v, m) => `${sim(m)} ${Math.round(v).toLocaleString("es-AR")}`;
    for (const f of filasSeguimiento(ctx, hoy)) {
      // Una alerta por operación, no por beneficiario: si no, una venta con
      // reparto de área llenaba la lista con cuatro avisos iguales.
      const colgadas = f.lineas.filter((l) => l.estado === "ACobrar" && l.dias > plazos.aCobrarDias);
      if (colgadas.length) {
        const porMoneda = {};
        for (const l of colgadas) porMoneda[l.moneda] = (porMoneda[l.moneda] || 0) + l.pendiente;
        out.push({ tipo: "SinReclamar", numero: f.numero, origenId: f.marca.origenId,
          origenTipo: f.marca.origenTipo, dias: colgadas[0].dias,
          quienes: colgadas.map((l) => l.nombre),
          texto: `${f.numero} (${f.cliente}): ${Object.entries(porMoneda).map(([m, v]) => fmt(v, m)).join(" + ")} ` +
            `para pagar hace ${colgadas[0].dias} días a ${colgadas.map((l) => l.nombre).join(", ")}.` });
      }
      const sinCobro = f.lineas.find((l) => l.estado === "Devengada" && l.cobrado <= 0 && l.dias > plazos.sinCobroDias);
      if (sinCobro) {
        out.push({ tipo: "SinCobro", numero: f.numero, origenId: f.marca.origenId,
          origenTipo: f.marca.origenTipo, dias: sinCobro.dias,
          texto: `${f.numero} (${f.cliente}) se ganó hace ${sinCobro.dias} días y no tiene cobro registrado.` });
      }
    }
    for (const p of operacionesPendientesDeMarca(ctx)) {
      if (p.etapa.etapa !== "Ganada") continue;
      out.push({ tipo: "SinMarcar", numero: p.numero, origenId: p.op.id, origenTipo: p.origenTipo, dias: null,
        texto: `${p.numero} se ganó y nunca se marcó si lleva comisión.` });
    }
    const orden = { SinReclamar: 0, SinMarcar: 1, SinCobro: 2 };
    return out.sort((a, b) => orden[a.tipo] - orden[b.tipo] || (b.dias || 0) - (a.dias || 0));
  }

  global.NEXO_COMISIONES = {
    rigeEn, alcanzaPais, acuerdoVigente, acuerdosDeArea, seSolapa, validarEscalones,
    calcular, calcularEscalonada, baseSegunAcuerdo,
    devengarPorContrato, puedeLiquidarse,
    resumen, resumenPorArea, panelVendedores,
    REPARTO_INTERNO, PAISES_REPARTO, acuerdosReparto,
    PORCENTAJE_AREA, PROPORCION_AREA,
    FECHA_CLIENTE_NUEVO, ANIOS_AISLADO, PLAZOS_ALERTA,
    actividadesCliente, elegibilidad, sugerirMarca, baseOperacion, etapaOperacion,
    fechaCobro, cobros, lineas, saldosACompensar, filasSeguimiento, totalesSeguimiento, alertas,
    operacionesPendientesDeMarca, porcentajeHabitual, marcaDe, claveBeneficiario,
  };
})(typeof window !== "undefined" ? window : globalThis);
