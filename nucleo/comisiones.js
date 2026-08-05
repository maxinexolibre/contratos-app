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
   * Reparto interno fijo de Nexolibre (definido por Maxi, 2026-08-05).
   *
   * Corre sobre toda venta concretada en los cinco países donde opera, en
   * paralelo a lo pactado con el vendedor. Suma 4,5% del neto.
   *
   * Se generan como acuerdos de alcance "Area" para que sigan las mismas
   * reglas que el resto: vigencia versionada, base explícita y trazabilidad
   * del cálculo. Cambiar un porcentaje cierra el acuerdo y abre otro, con lo
   * que las comisiones viejas se siguen explicando con sus propias reglas.
   */
  const REPARTO_INTERNO = [
    { area: "Gerencia comercial", porcentaje: 3 },
    { area: "Marketing", porcentaje: 0.5 },
    { area: "Diseño", porcentaje: 0.5 },
    { area: "Ventas", porcentaje: 0.5 },
  ];

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

  global.NEXO_COMISIONES = {
    rigeEn, alcanzaPais, acuerdoVigente, acuerdosDeArea, seSolapa, validarEscalones,
    calcular, calcularEscalonada, baseSegunAcuerdo,
    devengarPorContrato, puedeLiquidarse,
    resumen, resumenPorArea, panelVendedores,
    REPARTO_INTERNO, PAISES_REPARTO, acuerdosReparto,
  };
})(typeof window !== "undefined" ? window : globalThis);
