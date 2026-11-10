/**
 * Motor de KPIs.
 *
 * Funciones puras: reciben colecciones, devuelven números. Sin DOM, sin estado
 * global, sin fetch. Eso las hace testeables de a una y reutilizables tanto en
 * el tablero como en los reportes.
 *
 * Tres criterios que definen si los números sirven o mienten:
 *
 * 1. DENOMINADOR. La conversión se mide sobre tickets RESUELTOS (ganados +
 *    perdidos), no sobre todos: un ticket de ayer todavía no perdió, e
 *    incluirlo hunde la tasa. El ciclo de venta promedia solo GANADOS: los
 *    perdidos se pierden rápido y bajarían el promedio falsamente.
 *
 * 2. DIVISIÓN POR CERO. Devuelve null, nunca 0. En el tablero se muestra "—".
 *    Un 0% se lee como "pésimo"; un "—" se lee como "todavía no hay datos".
 *
 * 3. MONEDAS Y RECURRENCIAS NO SE MEZCLAN. Sumar USD con ARS da un número
 *    inventado, y sumar un abono mensual con una venta única también. Los
 *    totales se devuelven segmentados por moneda, y los abonos se anualizan
 *    solo cuando se lo pide explícitamente.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;

  // --------------------------------------------------------------------------
  // Primitivas seguras
  // --------------------------------------------------------------------------

  /** División que devuelve null si el denominador es cero o no existe. */
  const div = (a, b) => (!b ? null : a / b);

  /** Porcentaje con 2 decimales, o null. */
  const pct = (a, b) => {
    const r = div(a, b);
    return r === null ? null : Math.round(r * 10000) / 100;
  };

  const redondear = (n, d = 2) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return null;
    const f = Math.pow(10, d);
    return Math.round(n * f) / f;
  };

  const suma = (lista, fn) => lista.reduce((s, x) => s + (Number(fn(x)) || 0), 0);

  /** Días entre dos fechas ISO. */
  function dias(desde, hasta) {
    if (!desde || !hasta) return null;
    const a = new Date(desde + "T00:00:00Z").getTime();
    const b = new Date(hasta + "T00:00:00Z").getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return (b - a) / 86400000;
  }

  function mediana(valores) {
    const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  /**
   * Agrupa importes por moneda. Nunca devuelve un único número.
   *
   * `campoMoneda` acepta un nombre de campo o una función. Hace falta porque
   * la moneda no está en el mismo lugar en todas las entidades: los tickets la
   * tienen en la raíz y los presupuestos dentro de `economico`. Cuando esto
   * era solo un nombre de campo, los presupuestos caían al default USD y
   * sumaban pesos con dólares en un mismo total.
   *
   * @returns {{ARS?:number, USD?:number, UF?:number, CLP?:number}}
   */
  function porMoneda(lista, campoMonto, campoMoneda = "moneda") {
    const leer = typeof campoMoneda === "function"
      ? campoMoneda
      : (x) => x[campoMoneda];
    const acc = {};
    for (const x of lista) {
      const m = leer(x);
      if (!m) {
        // Sin moneda no se puede clasificar. Se agrupa aparte en vez de
        // asumir una: asumir es como se fabrican los totales falsos.
        acc.SIN_MONEDA = E.money((acc.SIN_MONEDA || 0) + (Number(x[campoMonto]) || 0));
        continue;
      }
      acc[m] = E.money((acc[m] || 0) + (Number(x[campoMonto]) || 0));
    }
    return acc;
  }

  /** Moneda de un presupuesto: vive dentro de `economico`. */
  const monedaPresupuesto = (p) => p.economico?.moneda;

  /** Texto legible de un mapa de monedas: "US$ 128.400 · $ 6.060.000". */
  const SIMBOLO = { USD: "US$", ARS: "$", CLP: "CLP$", COP: "COP$", UYU: "$U", UF: "UF" };
  function textoMonedas(mapa) {
    const partes = Object.entries(mapa)
      .filter(([, v]) => v)
      .map(([m, v]) => `${SIMBOLO[m] || m} ${Math.round(v).toLocaleString("es-AR")}`);
    return partes.length ? partes.join(" · ") : "—";
  }

  // --------------------------------------------------------------------------
  // Normalización de tickets para cálculo
  // --------------------------------------------------------------------------

  /**
   * Enriquece los tickets con los campos derivados que usan todos los KPIs.
   * Se calcula una sola vez y se reutiliza, en vez de recorrer en cada métrica.
   */
  function prepararTickets(tickets, ctx) {
    ctx = ctx || {};
    const contratos = ctx.contratos || [];
    const porTicket = new Map();
    for (const c of contratos) {
      if (c.ticketId) porTicket.set(c.ticketId, c);
    }

    return tickets.map((t) => {
      const contrato = porTicket.get(t.id) || null;
      const ganado = t.estado === "Cerrado";
      const perdido = t.estado === "Perdido";
      return {
        ...t,
        ganado,
        perdido,
        resuelto: ganado || perdido,
        abierto: !ganado && !perdido,
        peso: E.PESO_ETAPA[t.estado] ?? 0,
        contrato,
        // Valor realizado: lo que efectivamente se firmó. Si el contrato es
        // recurrente, se anualiza para poder compararlo con ventas únicas.
        valorGanado: contrato
          ? (contrato.recurrencia === "mensual"
              ? E.money(contrato.economico.canonMensual * 12)
              : E.money(contrato.economico.canonMensual))
          : (ganado ? t.montoEstimado : 0),
        // El ciclo solo existe si la fecha de cierre fue registrada de verdad.
        // Con cierre estimado el resultado sería 0 días, que aplana el promedio
        // y hace parecer instantáneo un proceso que lleva semanas.
        ciclo: (t.fechaCierre && !t.cierreEstimado) ? dias(t.fecha, t.fechaCierre) : null,
        // Los registros migrados sin origen real distorsionan el ciclo.
        sintetico: /\[migracion\]|\[sintetico\]/i.test(t.descripcion || ""),
      };
    });
  }

  // --------------------------------------------------------------------------
  // KPIs comerciales
  // --------------------------------------------------------------------------

  /**
   * Métricas comerciales sobre un conjunto de tickets ya filtrado por período.
   */
  function comercial(tickets, ctx) {
    const T = prepararTickets(tickets, ctx);

    const resueltos = T.filter((t) => t.resuelto);
    const ganados = T.filter((t) => t.ganado);
    const perdidos = T.filter((t) => t.perdido);
    const abiertos = T.filter((t) => t.abierto);

    // El ciclo excluye sintéticos: su fecha de creación es inventada.
    const ciclos = ganados.filter((t) => !t.sintetico && t.ciclo !== null).map((t) => t.ciclo);

    return {
      totales: T.length,
      ganados: ganados.length,
      perdidos: perdidos.length,
      abiertos: abiertos.length,
      resueltos: resueltos.length,

      // Sobre resueltos: es la medida justa del desempeño.
      tasaConversion: pct(ganados.length, resueltos.length),
      // Sobre todos: sirve para forecast, no para evaluar a nadie.
      conversionGlobal: pct(ganados.length, T.length),

      ingresos: porMoneda(ganados, "valorGanado"),
      ticketPromedio: ganados.length
        ? porMoneda(
            ganados.map((t) => ({ ...t, prom: t.valorGanado / ganados.length })),
            "prom")
        : {},

      cicloPromedio: redondear(div(ciclos.reduce((s, c) => s + c, 0), ciclos.length), 1),
      cicloMediana: redondear(mediana(ciclos), 1),
      cicloMuestra: ciclos.length,

      pipeline: porMoneda(abiertos, "montoEstimado"),
      pipelinePonderado: porMoneda(
        abiertos.map((t) => ({ ...t, pond: E.money(t.montoEstimado * t.peso) })), "pond"),

      estancados: abiertos.filter((t) => {
        const d = dias(t.fecha, E.hoy());
        return d !== null && d > 45;
      }).length,
    };
  }

  /** Desglose por vendedor. Incluye `muestra` para no leer mal porcentajes. */
  function porVendedor(tickets, ctx) {
    const T = prepararTickets(tickets, ctx);
    const grupos = new Map();
    for (const t of T) {
      const k = t.vendedor || "(sin asignar)";
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(t);
    }
    return [...grupos.entries()]
      .map(([vendedor, lista]) => ({ vendedor, ...comercial(lista, ctx) }))
      .sort((a, b) => (b.ganados || 0) - (a.ganados || 0));
  }

  /** Win rate por tipo. El `resueltos` es el tamaño de muestra: sin él no se lee. */
  function porTipo(tickets, ctx) {
    const T = prepararTickets(tickets, ctx);
    return E.TICKET_TIPO.map((tipo) => {
      const lista = T.filter((t) => t.tipo === tipo);
      const m = comercial(lista, ctx);
      return { tipo, winRate: m.tasaConversion, ...m };
    }).filter((x) => x.totales > 0);
  }

  /** Estado del pipeline por etapa, para el Kanban y el tablero. */
  function pipelinePorEtapa(tickets, ctx) {
    const T = prepararTickets(tickets, ctx).filter((t) => t.abierto);
    return E.TICKET_ESTADO
      .filter((e) => !["Cerrado", "Perdido"].includes(e))
      .map((estado) => {
        const lista = T.filter((t) => t.estado === estado);
        return {
          estado,
          probabilidad: E.PESO_ETAPA[estado],
          tickets: lista.length,
          valor: porMoneda(lista, "montoEstimado"),
          ponderado: porMoneda(
            lista.map((t) => ({ ...t, p: E.money(t.montoEstimado * t.peso) })), "p"),
        };
      });
  }

  /**
   * Forecast en banda. Un número único transmite una precisión que no existe.
   *   piso     = ya cerrado + lo que está en negociación, ponderado
   *   esperado = ya cerrado + todo el pipeline ponderado por etapa
   *   techo    = ya cerrado + todo el pipeline sin ponderar
   */
  function forecast(tickets, ctx, dias30 = [30, 60, 90]) {
    const T = prepararTickets(tickets, ctx);
    const cerrado = porMoneda(T.filter((t) => t.ganado), "valorGanado");
    const abiertos = T.filter((t) => t.abierto);
    const cicloMediano = mediana(
      T.filter((t) => t.ganado && !t.sintetico && t.ciclo !== null).map((t) => t.ciclo)) || 45;

    return dias30.map((ventana) => {
      // Solo entra al forecast lo que puede cerrar dentro de la ventana según
      // el ciclo observado. Un ticket nuevo no cierra en 30 días si el ciclo
      // mediano es 60.
      const alcanzables = abiertos.filter((t) => {
        const transcurrido = dias(t.fecha, E.hoy()) || 0;
        return (cicloMediano - transcurrido) <= ventana;
      });
      const negociacion = alcanzables.filter((t) => t.estado === "EnNegociacion");

      const sumar = (base, extra) => {
        const r = { ...base };
        for (const [m, v] of Object.entries(extra)) r[m] = E.money((r[m] || 0) + v);
        return r;
      };

      return {
        ventana,
        cerrado,
        piso: sumar(cerrado, porMoneda(
          negociacion.map((t) => ({ ...t, v: E.money(t.montoEstimado * 0.6) })), "v")),
        esperado: sumar(cerrado, porMoneda(
          alcanzables.map((t) => ({ ...t, v: E.money(t.montoEstimado * t.peso) })), "v")),
        techo: sumar(cerrado, porMoneda(alcanzables, "montoEstimado")),
        cicloMediano: redondear(cicloMediano, 1),
        // Si el ciclo excede la ventana, el número es orientativo y hay que decirlo.
        parcial: cicloMediano > ventana,
      };
    });
  }

  // --------------------------------------------------------------------------
  // KPIs de marketing
  // --------------------------------------------------------------------------

  /**
   * Métricas por campaña. `inversion` sale de las estrategias, no del
   * presupuesto asignado: lo asignado es plan, lo de las estrategias es gasto.
   */
  function porCampana(campanas, ctx) {
    ctx = ctx || {};
    const estrategias = ctx.estrategias || [];
    const leads = ctx.leads || [];
    const T = prepararTickets(ctx.tickets || [], ctx);

    return campanas.map((c) => {
      const est = estrategias.filter((e) => e.campanaId === c.id);
      const inversion = E.money(suma(est, (e) => e.inversion));

      const ld = leads.filter((l) => l.campanaId === c.id);
      const convertidos = ld.filter((l) => l.ticketId);
      const tickets = T.filter((t) => t.campanaId === c.id);
      const ganados = tickets.filter((t) => t.ganado);
      const ingresos = porMoneda(ganados, "valorGanado");

      // El ROI solo se compara contra ingresos en la misma moneda que la
      // inversión. Mezclar acá es el error más caro de todo el tablero.
      const ingresoMismaMoneda = ingresos[c.moneda] || 0;

      const cicloMediano = mediana(
        tickets.filter((t) => t.ganado && t.ciclo !== null).map((t) => t.ciclo));
      const antiguedad = dias(c.fechaInicio, c.fechaFin || E.hoy());

      return {
        id: c.id,
        nombre: c.nombre,
        estado: c.estado,
        canales: c.canales,
        moneda: c.moneda,
        presupuestoAsignado: c.presupuestoAsignado,
        inversion,
        ejecucionPct: pct(inversion, c.presupuestoAsignado),
        leads: ld.length,
        leadsCalificados: ld.filter((l) => ["Calificado", "Convertido"].includes(l.estado)).length,
        tickets: tickets.length,
        contratos: ganados.length,
        ingresos,
        costoPorLead: redondear(div(inversion, ld.length)),
        tasaLeadTicket: pct(convertidos.length, ld.length),
        cac: redondear(div(inversion, ganados.length)),
        roi: pct(ingresoMismaMoneda - inversion, inversion),
        estrategiasPendientes: est.filter(
          (e) => !["Finalizada", "Cancelada"].includes(e.estado)).length,
        // Una campaña más nueva que el ciclo de venta siempre parece un fracaso.
        roiParcial: Boolean(cicloMediano && antiguedad && cicloMediano > antiguedad),
      };
    });
  }

  /**
   * Comparativa por canal. La inversión se imputa por estrategia, no por
   * campaña: una campaña multicanal no permite atribuir su gasto a un canal.
   */
  function porCanal(ctx) {
    ctx = ctx || {};
    const leads = ctx.leads || [];
    const estrategias = ctx.estrategias || [];
    const T = prepararTickets(ctx.tickets || [], ctx);

    // Inversión por canal: cada estrategia aporta a los canales de sus leads.
    // Si una estrategia no generó leads, su gasto queda sin canal y se reporta
    // aparte en vez de repartirse con un criterio inventado.
    const invPorEstrategia = new Map(estrategias.map((e) => [e.id, e.inversion]));
    const canalesDeEstrategia = new Map();
    for (const l of leads) {
      if (!l.estrategiaId) continue;
      if (!canalesDeEstrategia.has(l.estrategiaId)) canalesDeEstrategia.set(l.estrategiaId, new Set());
      canalesDeEstrategia.get(l.estrategiaId).add(l.canal);
    }
    const invCanal = {};
    let sinAtribuir = 0;
    for (const [estId, monto] of invPorEstrategia) {
      const canales = canalesDeEstrategia.get(estId);
      if (!canales || !canales.size) { sinAtribuir += monto; continue; }
      const parte = monto / canales.size;
      for (const c of canales) invCanal[c] = E.money((invCanal[c] || 0) + parte);
    }

    const filas = E.CANAL.map((canal) => {
      const ld = leads.filter((l) => l.canal === canal);
      const tickets = T.filter((t) => ld.some((l) => l.ticketId === t.id));
      const ganados = tickets.filter((t) => t.ganado);
      const inversion = invCanal[canal] || 0;
      return {
        canal,
        leads: ld.length,
        descartados: ld.filter((l) => l.estado === "Descartado").length,
        tickets: tickets.length,
        contratos: ganados.length,
        ingresos: porMoneda(ganados, "valorGanado"),
        inversion,
        costoPorLead: redondear(div(inversion, ld.length)),
        tasaLeadTicket: pct(tickets.length, ld.length),
      };
    }).filter((f) => f.leads > 0 || f.inversion > 0);

    return { filas, inversionSinAtribuir: E.money(sinAtribuir) };
  }

  // --------------------------------------------------------------------------
  // Presupuestos y cobranza
  // --------------------------------------------------------------------------

  function presupuestos(lista) {
    const hoyStr = E.hoy();
    const porEstado = {};
    for (const e of E.PRESUPUESTO_ESTADO) {
      porEstado[e] = lista.filter((p) => p.estado === e).length;
    }
    const vigentes = lista.filter((p) => p.estado === "Enviado");

    // Únicos y recurrentes se cuentan por separado: un abono de US$ 4.000/mes
    // no es una venta de US$ 4.000.
    const unicos = lista.filter((p) => p.economico.recurrencia === "unica");
    const mensuales = lista.filter((p) => p.economico.recurrencia === "mensual");

    return {
      total: lista.length,
      porEstado,
      montoUnico: porMoneda(unicos, "total", monedaPresupuesto),
      montoMensual: porMoneda(mensuales, "total", monedaPresupuesto),
      aprobadoUnico: porMoneda(unicos.filter((p) => p.estado === "Aprobado"), "total", monedaPresupuesto),
      aprobadoMensual: porMoneda(mensuales.filter((p) => p.estado === "Aprobado"), "total", monedaPresupuesto),
      vencidos: vigentes.filter((p) => p.vence && p.vence < hoyStr).length,
      porVencer: vigentes.filter((p) => {
        if (!p.vence) return false;
        const d = dias(hoyStr, p.vence);
        return d !== null && d >= 0 && d <= 7;
      }).length,
      tasaAprobacion: pct(
        porEstado.Aprobado,
        porEstado.Aprobado + porEstado.Rechazado),
    };
  }

  /** Ingreso recurrente contratado. Solo cuenta lo firmado y vigente. */
  function recurrente(contratos) {
    const vivos = contratos.filter(
      (c) => c.recurrencia === "mensual" && ["Firmado", "Activo"].includes(c.estado));
    const mensual = {};
    for (const c of vivos) {
      const m = c.economico.moneda || "USD";
      mensual[m] = E.money((mensual[m] || 0) + c.economico.canonMensual);
    }
    const anual = {};
    for (const [m, v] of Object.entries(mensual)) anual[m] = E.money(v * 12);
    return { contratos: vivos.length, mensual, anual };
  }

  // --------------------------------------------------------------------------
  // Alertas
  // --------------------------------------------------------------------------

  /** Desvíos que ameritan atención. Cada uno con destino y enlace. */
  function alertas(ctx) {
    ctx = ctx || {};
    const out = [];
    const T = prepararTickets(ctx.tickets || [], ctx);
    const presus = ctx.presupuestos || [];
    const hoyStr = E.hoy();

    const sinVendedor = T.filter((t) => t.abierto && !t.vendedor);
    if (sinVendedor.length) {
      out.push({ nivel: "aviso", clave: "sin_vendedor",
        texto: `${sinVendedor.length} ticket(s) sin vendedor asignado`,
        destino: "pipeline" });
    }

    const estancados = T.filter((t) => t.abierto && (dias(t.fecha, hoyStr) || 0) > 45);
    if (estancados.length) {
      out.push({ nivel: "aviso", clave: "estancados",
        texto: `${estancados.length} ticket(s) sin movimiento hace más de 45 días · ` +
               textoMonedas(porMoneda(estancados, "montoEstimado")),
        destino: "pipeline" });
    }

    const vencidos = presus.filter((p) => p.estado === "Enviado" && p.vence && p.vence < hoyStr);
    if (vencidos.length) {
      out.push({ nivel: "aviso", clave: "vencidos",
        texto: `${vencidos.length} presupuesto(s) vencidos siguen figurando como enviados`,
        destino: "presupuestos" });
    }

    // Cotización vieja: bloquea la facturación, así que es crítico.
    const tc = ctx.tiposCambio || [];
    for (const unidad of ["ARS", "UF"]) {
      const ultimo = tc.filter((x) => x.unidad === unidad)
        .sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
      const limite = E.sumarDias(hoyStr, -global.NEXO_REGLAS.TC_DIAS_TOLERANCIA);
      if (!ultimo || ultimo.fecha < limite) {
        out.push({ nivel: "critico", clave: `tc_${unidad}`,
          texto: ultimo
            ? `Cotización de ${unidad} desactualizada (última: ${ultimo.fecha})`
            : `Sin cotización de ${unidad} cargada`,
          destino: "configuracion" });
      }
    }

    const campanas = porCampana(ctx.campanas || [], ctx);
    for (const c of campanas) {
      if (c.roi !== null && c.roi < 0 && c.leads >= 10 && !c.roiParcial) {
        out.push({ nivel: "aviso", clave: `roi_${c.id}`,
          texto: `Campaña "${c.nombre}" con ROI ${c.roi}%`,
          destino: "campanas" });
      }
    }

    return out;
  }

  // --------------------------------------------------------------------------
  // Seguimiento de presupuestos enviados
  // --------------------------------------------------------------------------

  /**
   * Plazo en que una oportunidad suele definirse, en días desde el envío.
   *
   * No es la validez de la oferta (10 a 15 días, impresa en el documento):
   * es cuánto tarda el cliente en decidir. Reparaciones y partes se definen
   * dentro del mes; un equipo puede llevar meses. Con un solo umbral para
   * todo, o se perseguía de más a un equipo o se dejaba enfriar una reparación.
   */
  const PLAZO_DEFINICION = { servicio: 30, partes: 30, intercambio: 30, equipo: 180 };

  /**
   * Situación de seguimiento de un presupuesto. Acepta la forma vieja
   * (estado "enviado") y la v3 ("Enviado").
   *
   * @returns {null | {dias, plazo, atrasado}}  null si no está esperando respuesta
   *          o si no se sabe cuándo salió (sin fecha no se inventa una antigüedad).
   */
  function seguimiento(p, hoyStr = E.hoy()) {
    const est = String(p?.estado || "").toLowerCase();
    if (est !== "enviado" && est !== "negociacion") return null;
    const desde = p.fechaEnvio || p.fecha;
    const d = dias(desde, hoyStr);
    if (d == null) return null;
    const clave = p.subtipo === "equipo" ? "equipo" : (PLAZO_DEFINICION[p.subtipo] ? p.subtipo : "servicio");
    const plazo = PLAZO_DEFINICION[clave];
    return { dias: d, plazo, atrasado: d > plazo };
  }

  global.NEXO_KPI = {
    seguimiento, PLAZO_DEFINICION,
    // primitivas, exportadas para los reportes libres
    div, pct, redondear, suma, dias, mediana, porMoneda, textoMonedas, SIMBOLO,
    // motores
    prepararTickets, comercial, porVendedor, porTipo, pipelinePorEtapa, forecast,
    porCampana, porCanal, presupuestos, recurrente, alertas,
  };
})(typeof window !== "undefined" ? window : globalThis);
