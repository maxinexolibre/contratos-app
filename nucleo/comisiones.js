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

  /**
   * Acuerdo aplicable a un vendedor en una fecha. Si hubiera más de uno
   * vigente —que las reglas impiden— toma el más reciente y no falla en
   * silencio: la ambigüedad se reporta.
   */
  function acuerdoVigente(acuerdos, vendedorId, f) {
    const candidatos = (acuerdos || [])
      .filter((a) => a.vendedorId === vendedorId && rigeEn(a, f))
      .sort((a, b) => b.vigenciaDesde.localeCompare(a.vigenciaDesde));
    if (candidatos.length > 1) {
      console.warn(
        `Hay ${candidatos.length} acuerdos vigentes para ${vendedorId} al ${f}. ` +
        `Se aplica ${candidatos[0].id}. Revisar las vigencias.`);
    }
    return candidatos[0] || null;
  }

  /** Dos acuerdos del mismo vendedor no pueden pisarse en el tiempo. */
  function seSolapa(a, b) {
    if (a.vendedorId !== b.vendedorId || a.id === b.id) return false;
    const finA = a.vigenciaHasta || "9999-12-31";
    const finB = b.vigenciaHasta || "9999-12-31";
    return a.vigenciaDesde <= finB && b.vigenciaDesde <= finA;
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
   * Genera la comisión que corresponde a un contrato firmado.
   * No escribe nada: devuelve el registro para que pase por las reglas.
   *
   * @param {object} ctx { contrato, ticket, vendedores, acuerdos, comisiones }
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
    const vendedorId = ctx.vendedorId || ticket?.vendedor;
    if (!vendedorId) {
      err("NX-064",
        `No se puede saber a qué vendedor corresponde ${contrato.numero}`,
        "El contrato no tiene ticket de origen o el ticket no tiene vendedor asignado");
    }

    const vendedor = (ctx.vendedores || []).find(
      (v) => v.id === vendedorId || v.usuarioId === vendedorId || v.nombre === vendedorId);
    if (!vendedor) err("NX-064", `El vendedor "${vendedorId}" no está dado de alta`);

    const fechaDevengo = contrato.fechaFirma || E.hoy();
    const acuerdo = acuerdoVigente(ctx.acuerdos, vendedor.id, fechaDevengo);
    if (!acuerdo) {
      err("NX-061",
        `${vendedor.nombre} no tiene acuerdo de comisión vigente al ${fechaDevengo}`,
        "Cargá el acuerdo antes de devengar");
    }

    // Base: un abono mensual se comisiona sobre lo que efectivamente se
    // comisiona según el acuerdo (N meses o el año), no sobre "el contrato"
    // como si fuera una venta única.
    let base = contrato.economico.canonMensual;
    let notaBase = "";
    if (contrato.recurrencia === "mensual") {
      const meses = acuerdo.mesesRecurrente > 0
        ? acuerdo.mesesRecurrente
        : (contrato.vigencia?.meses || 12);
      base = E.money(base * meses);
      notaBase = ` (${meses} meses de abono)`;
    }

    if (contrato.economico.moneda !== acuerdo.moneda) {
      err("NX-065",
        `El contrato está en ${contrato.economico.moneda} y el acuerdo en ${acuerdo.moneda}`,
        "Convertir monedas acá inventaría un tipo de cambio: alineá el acuerdo o registrala a mano");
    }

    const r = calcular(acuerdo, base);

    return E.ENTIDADES.comisiones.normalizar({
      vendedorId: vendedor.id,
      acuerdoId: acuerdo.id,
      origenTipo: "Contrato",
      origenId: contrato.id,
      origenNumero: contrato.numero,
      clienteId: contrato.clienteId || ticket?.clienteId || "",
      periodo: fechaDevengo.slice(0, 7),
      baseCalculo: base,
      porcentajeAplicado: r.porcentaje,
      monto: r.monto,
      moneda: acuerdo.moneda,
      estado: "Devengada",
      fechaDevengo,
      detalleCalculo: r.detalle + notaBase,
    });
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

  global.NEXO_COMISIONES = {
    rigeEn, acuerdoVigente, seSolapa, validarEscalones,
    calcular, calcularEscalonada,
    devengarPorContrato, puedeLiquidarse,
    resumen, panelVendedores,
  };
})(typeof window !== "undefined" ? window : globalThis);
