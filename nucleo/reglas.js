/**
 * Motor de reglas de negocio.
 *
 * Sin base de datos no hay CHECK ni trigger: las reglas viven acá y se ejecutan
 * antes de cada escritura. Esto NO es una barrera de seguridad — alguien con el
 * PAT puede editar el JSON a mano — pero sí garantiza que todo lo que pasa por
 * la aplicación quede consistente.
 *
 * Cada rechazo lleva un código NX-0xx estable, para que la interfaz pueda
 * mostrar el mensaje correcto sin parsear texto.
 *
 * Reglas de negocio vigentes:
 *   R1 · Un presupuesto pertenece a un solo ticket, y no se muda una vez emitido.
 *   R2 · Un ticket admite varios presupuestos (versiones), pero uno solo aprobado.
 *   R3 · Un ticket no se cierra sin presupuesto aprobado.
 *   R4 · El contrato firmado es lo que cierra el ticket.
 *   R5 · Una campaña solo se finaliza con todas sus estrategias resueltas.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;
  const P = global.NEXO_PERMISOS;

  /** Error de negocio con código estable. */
  class ErrorNexo extends Error {
    constructor(codigo, mensaje, sugerencia) {
      super(mensaje);
      this.name = "ErrorNexo";
      this.codigo = codigo;
      this.sugerencia = sugerencia || "";
    }
  }

  const CODIGOS = {
    "NX-001": "El presupuesto ya fue emitido y no puede cambiar de ticket",
    "NX-002": "El ticket ya tiene un presupuesto aprobado",
    "NX-003": "El ticket no tiene presupuesto aprobado",
    "NX-004": "El contrato requiere un presupuesto aprobado",
    "NX-005": "La campaña tiene estrategias sin finalizar",
    "NX-010": "Acción no permitida para este rol",
    "NX-011": "Esta aprobación corresponde a otro rol",
    "NX-012": "No se puede aprobar lo propio",
    "NX-020": "Transición de estado no válida",
    "NX-021": "El presupuesto está vencido",
    "NX-022": "Solo se factura un presupuesto aprobado",
    "NX-030": "Falta cotización para esa moneda y fecha",
    "NX-031": "La cotización está desactualizada",
    "NX-040": "Faltan datos obligatorios",
    "NX-041": "Referencia inexistente",
    // Comisiones
    "NX-060": "Acuerdo de comisión mal definido",
    "NX-061": "No hay acuerdo de comisión vigente",
    "NX-062": "La comisión se devenga con la firma del contrato",
    "NX-063": "Esa operación ya tiene comisión devengada",
    "NX-064": "No se puede determinar el vendedor",
    "NX-065": "La moneda del acuerdo no coincide con la de la operación",
    "NX-066": "El vendedor tiene comisiones sin liquidar",
    "NX-067": "El acuerdo se superpone con otro del mismo vendedor",
    "NX-068": "El acuerdo ya tiene comisiones calculadas",
    "NX-069": "La comisión todavía no puede liquidarse",
  };

  const fallar = (codigo, detalle, sugerencia) => {
    throw new ErrorNexo(codigo, detalle || CODIGOS[codigo] || codigo, sugerencia);
  };

  // --------------------------------------------------------------------------
  // Transiciones de estado permitidas
  // --------------------------------------------------------------------------

  const TRANSICION_PRESUPUESTO = {
    Borrador:  ["Borrador", "Enviado"],
    // Un presupuesto no se aprueba ni se rechaza sin haber salido.
    Enviado:   ["Enviado", "Aprobado", "Rechazado"],
    // Los resueltos son terminales: para renegociar se duplica en una versión nueva.
    Aprobado:  ["Aprobado"],
    Rechazado: ["Rechazado"],
  };

  const TRANSICION_TICKET = {
    Nuevo:         ["Nuevo", "EnPresupuesto", "EnNegociacion", "Perdido"],
    EnPresupuesto: ["EnPresupuesto", "EnNegociacion", "Perdido"],
    EnNegociacion: ["EnNegociacion", "Cerrado", "Perdido"],
    Cerrado:       ["Cerrado"],
    Perdido:       ["Perdido"],
  };

  const TRANSICION_CAMPANA = {
    Planificada: ["Planificada", "Activa", "Cancelada"],
    Activa:      ["Activa", "Finalizada", "Cancelada"],
    Finalizada:  ["Finalizada"],
    Cancelada:   ["Cancelada"],
  };

  /** Días de tolerancia antes de considerar vieja una cotización. */
  const TC_DIAS_TOLERANCIA = 3;

  // --------------------------------------------------------------------------
  // Validaciones por entidad
  // --------------------------------------------------------------------------

  /**
   * @param {object} ctx  { presupuestos, tickets, contratos, campanas, estrategias,
   *                        tiposCambio, usuario, rol }
   */

  function validarTicket(nuevo, anterior, ctx) {
    if (!nuevo.clienteId) fallar("NX-040", "El ticket necesita un cliente");
    if (!nuevo.descripcion) fallar("NX-040", "El ticket necesita una descripción del pedido");

    if (anterior && nuevo.estado !== anterior.estado) {
      const permitidas = TRANSICION_TICKET[anterior.estado] || [];
      if (!permitidas.includes(nuevo.estado)) {
        // Reabrir un terminal es posible, pero solo para gerencia comercial.
        const reabre = ["Cerrado", "Perdido"].includes(anterior.estado);
        if (!reabre || !P.capacidad(ctx.rol, "reabrir_ticket")) {
          fallar("NX-020",
            `El ticket ${nuevo.numero} no puede pasar de ${anterior.estado} a ${nuevo.estado}`,
            reabre ? "Reabrir un ticket cerrado requiere gerencia comercial" : "");
        }
      }

      // R3: no hay cierre sin presupuesto aprobado.
      if (nuevo.estado === "Cerrado") {
        const aprobado = (ctx.presupuestos || []).some(
          (p) => p.ticketId === nuevo.id && p.estado === "Aprobado");
        if (!aprobado) {
          fallar("NX-003",
            `El ticket ${nuevo.numero} no tiene ningún presupuesto aprobado`,
            "Aprobá el presupuesto antes de cerrar el ticket");
        }
      }
    }

    if (nuevo.estado === "Perdido" && !nuevo.motivoPerdida) {
      fallar("NX-040", "Un ticket perdido necesita motivo",
        "El motivo alimenta el análisis de pérdidas por causa");
    }

    const terminal = ["Cerrado", "Perdido"].includes(nuevo.estado);
    if (terminal && !nuevo.fechaCierre) {
      fallar("NX-040", "Un ticket cerrado o perdido necesita fecha de cierre",
        "Sin fecha de cierre no se puede medir el ciclo de venta");
    }
    if (!terminal && nuevo.fechaCierre) {
      fallar("NX-040", "Un ticket abierto no puede tener fecha de cierre");
    }
    return true;
  }

  function validarPresupuesto(nuevo, anterior, ctx) {
    if (!nuevo.ticketId) fallar("NX-040", "El presupuesto tiene que colgar de un ticket");

    const ticket = (ctx.tickets || []).find((t) => t.id === nuevo.ticketId);
    if (!ticket) {
      fallar("NX-041", `El ticket ${nuevo.ticketId} no existe`);
    }

    // R1 · el presupuesto emitido no se muda de ticket.
    if (anterior && anterior.ticketId !== nuevo.ticketId && anterior.estado !== "Borrador") {
      fallar("NX-001",
        `El presupuesto ${anterior.numero} ya fue emitido y no puede cambiar de ticket`,
        "Duplicalo como versión nueva sobre el ticket correcto");
    }

    if (anterior && nuevo.estado !== anterior.estado) {
      const permitidas = TRANSICION_PRESUPUESTO[anterior.estado] || [];
      if (!permitidas.includes(nuevo.estado)) {
        fallar("NX-020",
          `El presupuesto ${nuevo.numero} no puede pasar de ${anterior.estado} a ${nuevo.estado}`,
          anterior.estado === "Aprobado" || anterior.estado === "Rechazado"
            ? "Ya está resuelto: para renegociar, duplicalo en una versión nueva"
            : "");
      }
    }

    // Fuera de borrador hace falta contenido.
    if (nuevo.estado !== "Borrador" && (!nuevo.items || nuevo.items.length === 0)) {
      fallar("NX-040", `El presupuesto ${nuevo.numero} no tiene ítems`,
        "Un presupuesto sin ítems no puede enviarse ni aprobarse");
    }

    if (nuevo.estado === "Aprobado") {
      // R2 · un solo aprobado por ticket.
      const otroAprobado = (ctx.presupuestos || []).find(
        (p) => p.ticketId === nuevo.ticketId && p.estado === "Aprobado" && p.id !== nuevo.id);
      if (otroAprobado) {
        fallar("NX-002",
          `El ticket ya tiene aprobado el presupuesto ${otroAprobado.numero}`,
          "Rechazá el anterior antes de aprobar este");
      }

      // No se aprueba nada vencido: el precio ya no rige.
      if (nuevo.vence && nuevo.vence < E.hoy()) {
        fallar("NX-021",
          `El presupuesto ${nuevo.numero} venció el ${nuevo.vence}`,
          "Duplicalo con fecha y validez nuevas antes de aprobar");
      }

      if (!P.capacidad(ctx.rol, "aprobar_presupuesto")) {
        fallar("NX-011",
          "Aprobar presupuestos corresponde a gerencia comercial o administrativa");
      }
    }

    // Los importes se recalculan siempre en el servidor lógico, nunca se
    // aceptan los que manda el formulario.
    const subtotal = E.money((nuevo.items || []).reduce(
      (s, i) => s + E.money(i.cantidad * i.unitario), 0));
    const total = E.money(subtotal * (1 - (nuevo.economico?.descuentoPct || 0) / 100));
    if (Math.abs(subtotal - nuevo.subtotal) > 0.01 || Math.abs(total - nuevo.total) > 0.01) {
      fallar("NX-040",
        `Los totales de ${nuevo.numero} no coinciden con sus ítems`,
        "Los importes se calculan a partir de los ítems, no se cargan a mano");
    }
    return true;
  }

  function validarContrato(nuevo, anterior, ctx) {
    if (!nuevo.clienteId && !nuevo.ticketId) {
      fallar("NX-040", "El contrato necesita un cliente");
    }

    // Coherencia del origen: o viene de la cadena comercial completa, o es
    // independiente y no tiene ninguna de las dos puntas.
    if (nuevo.origen === "comercial" && (!nuevo.ticketId || !nuevo.presupuestoId)) {
      fallar("NX-040",
        "Un contrato de origen comercial necesita ticket y presupuesto",
        "Si el contrato no nació de un pedido nuestro, marcalo como independiente");
    }
    if (nuevo.origen === "independiente" && (nuevo.ticketId || nuevo.presupuestoId)) {
      fallar("NX-040",
        "Un contrato independiente no puede tener ticket ni presupuesto asociado");
    }

    // R4 · solo se firma sobre presupuesto aprobado.
    if (nuevo.origen === "comercial") {
      const presu = (ctx.presupuestos || []).find((p) => p.id === nuevo.presupuestoId);
      if (!presu) fallar("NX-041", "El presupuesto del contrato no existe");
      if (presu.ticketId !== nuevo.ticketId) {
        fallar("NX-041",
          `El presupuesto ${presu.numero} pertenece a otro ticket`);
      }
      const vigente = ["Firmado", "Activo", "Finalizado"].includes(nuevo.estado);
      if (vigente && presu.estado !== "Aprobado") {
        fallar("NX-004",
          `No se firma un contrato sobre un presupuesto en estado ${presu.estado}`);
      }
    }

    const vigente = ["Firmado", "Activo", "Finalizado"].includes(nuevo.estado);
    if (vigente && !nuevo.fechaFirma) {
      fallar("NX-040", "Un contrato firmado o vigente necesita fecha de firma");
    }
    return true;
  }

  function validarCampana(nuevo, anterior, ctx) {
    if (!nuevo.nombre) fallar("NX-040", "La campaña necesita nombre");
    if (nuevo.fechaFin && nuevo.fechaFin < nuevo.fechaInicio) {
      fallar("NX-040", "La fecha de fin no puede ser anterior al inicio");
    }
    if (!nuevo.canales || nuevo.canales.length === 0) {
      fallar("NX-040", "La campaña necesita al menos un canal",
        "Sin canal no se puede calcular costo por lead ni efectividad");
    }

    if (anterior && nuevo.estado !== anterior.estado) {
      const permitidas = TRANSICION_CAMPANA[anterior.estado] || [];
      if (!permitidas.includes(nuevo.estado)) {
        fallar("NX-020",
          `La campaña no puede pasar de ${anterior.estado} a ${nuevo.estado}`);
      }
    }

    // R5 · no se finaliza con estrategias abiertas.
    if (nuevo.estado === "Finalizada" && (!anterior || anterior.estado !== "Finalizada")) {
      const pendientes = (ctx.estrategias || []).filter(
        (e) => e.campanaId === nuevo.id && !["Finalizada", "Cancelada"].includes(e.estado));
      if (pendientes.length) {
        fallar("NX-005",
          `La campaña "${nuevo.nombre}" tiene ${pendientes.length} estrategia(s) sin finalizar`,
          pendientes.map((e) => e.descripcion || e.tipo).join(" · "));
      }
    }
    return true;
  }

  function validarEstrategia(nuevo, anterior, ctx) {
    if (!nuevo.campanaId) fallar("NX-040", "La estrategia tiene que colgar de una campaña");
    const campana = (ctx.campanas || []).find((c) => c.id === nuevo.campanaId);
    if (!campana) fallar("NX-041", "La campaña de la estrategia no existe");

    // La suma de inversiones no puede exceder el presupuesto de la campaña.
    const otras = (ctx.estrategias || [])
      .filter((e) => e.campanaId === nuevo.campanaId && e.id !== nuevo.id)
      .reduce((s, e) => s + e.inversion, 0);
    if (campana.presupuestoAsignado > 0 && otras + nuevo.inversion > campana.presupuestoAsignado) {
      fallar("NX-040",
        `La inversión excede el presupuesto de "${campana.nombre}": ` +
        `${E.money(otras + nuevo.inversion)} sobre ${campana.presupuestoAsignado}`,
        "Ajustá la inversión o ampliá el presupuesto de la campaña");
    }
    return true;
  }

  function validarLead(nuevo, anterior, ctx) {
    if (!nuevo.contactoNombre) fallar("NX-040", "El lead necesita nombre de contacto");
    if (!nuevo.contactoEmail && !nuevo.contactoTel) {
      fallar("NX-040", "El lead necesita email o teléfono");
    }
    if (nuevo.estado === "Convertido" && !nuevo.ticketId) {
      fallar("NX-040", "Un lead convertido tiene que apuntar a un ticket");
    }
    if (nuevo.estado === "Descartado" && !nuevo.motivoDescarte) {
      fallar("NX-040", "Un lead descartado necesita motivo");
    }

    // Deduplicación: el mismo mail en la misma campaña no son dos leads.
    // Sin esto el costo por lead sale artificialmente bajo.
    if (nuevo.contactoEmail) {
      const dup = (ctx.leads || []).find(
        (l) => l.id !== nuevo.id && l.campanaId === nuevo.campanaId &&
               l.contactoEmail && l.contactoEmail === nuevo.contactoEmail);
      if (dup) {
        fallar("NX-040",
          `Ya existe un lead con ${nuevo.contactoEmail} en esta campaña`,
          "Duplicar leads infla los KPI de captación");
      }
    }
    return true;
  }

  function validarFacturacion(nuevo, anterior, ctx) {
    const presu = (ctx.presupuestos || []).find((p) => p.id === nuevo.presupuestoId);
    if (!presu) fallar("NX-041", "El presupuesto a facturar no existe");
    if (presu.estado !== "Aprobado") {
      fallar("NX-022", `Solo se factura un presupuesto aprobado (está ${presu.estado})`);
    }
    if (!nuevo.tcValor || !nuevo.tcFecha) {
      fallar("NX-030", "Falta el tipo de cambio aplicado");
    }
    // Cotización vieja: se corta antes de emitir mal el comprobante.
    const limite = E.sumarDias(E.hoy(), -TC_DIAS_TOLERANCIA);
    if (nuevo.tcFecha < limite) {
      fallar("NX-031",
        `La cotización de ${nuevo.tcUnidad} es del ${nuevo.tcFecha}`,
        "Actualizá el tipo de cambio antes de facturar");
    }
    // El importe facturado tiene que explicarse por el TC registrado.
    const esperado = E.money(nuevo.montoCotizado * nuevo.tcValor);
    if (Math.abs(esperado - nuevo.montoLiquidado) > 1) {
      fallar("NX-040",
        `El importe facturado no coincide con cotizado × tipo de cambio ` +
        `(${nuevo.montoCotizado} × ${nuevo.tcValor} = ${esperado})`);
    }
    return true;
  }

  function validarVendedor(nuevo, anterior, ctx) {
    if (!nuevo.nombre) fallar("NX-040", "El vendedor necesita nombre");

    // Dos vendedores con el mismo nombre hacen imposible saber a quién se le
    // paga. El documento, cuando está, es la clave real.
    const dup = (ctx.vendedores || []).find((v) => v.id !== nuevo.id && (
      (nuevo.documento && v.documento === nuevo.documento) ||
      v.nombre.toLowerCase() === nuevo.nombre.toLowerCase()));
    if (dup) {
      fallar("NX-040", `Ya existe un vendedor "${dup.nombre}"`,
        dup.documento ? `Documento ${dup.documento}` : "Usá un nombre distinto o cargá el documento");
    }

    if (nuevo.estado === "Inactivo" && !nuevo.fechaBaja) {
      fallar("NX-040", "Un vendedor inactivo necesita fecha de baja");
    }
    if (nuevo.fechaBaja && nuevo.fechaBaja < nuevo.fechaAlta) {
      fallar("NX-040", "La baja no puede ser anterior al alta");
    }

    // Dar de baja con comisiones sin pagar es un problema, no un detalle.
    if (anterior?.estado === "Activo" && nuevo.estado === "Inactivo") {
      const pendientes = (ctx.comisiones || []).filter(
        (c) => c.vendedorId === nuevo.id && ["Devengada", "Aprobada"].includes(c.estado));
      if (pendientes.length) {
        fallar("NX-066",
          `${nuevo.nombre} tiene ${pendientes.length} comisión(es) sin liquidar`,
          "Liquidalas o anulalas antes de dar de baja");
      }
    }
    return true;
  }

  function validarAcuerdoComision(nuevo, anterior, ctx) {
    const C = global.NEXO_COMISIONES;
    if (!nuevo.vendedorId) fallar("NX-040", "El acuerdo tiene que ser de un vendedor");
    const v = (ctx.vendedores || []).find((x) => x.id === nuevo.vendedorId);
    if (!v) fallar("NX-041", "El vendedor del acuerdo no existe");

    if (nuevo.vigenciaHasta && nuevo.vigenciaHasta < nuevo.vigenciaDesde) {
      fallar("NX-040", "La vigencia no puede terminar antes de empezar");
    }

    // Dos acuerdos vigentes a la vez hacen ambiguo cuánto se le paga.
    const solapado = (ctx.acuerdosComision || []).find((a) => C.seSolapa(nuevo, a));
    if (solapado) {
      fallar("NX-067",
        `Se superpone con el acuerdo "${solapado.nombre || solapado.id}" ` +
        `(${solapado.vigenciaDesde} → ${solapado.vigenciaHasta || "sin fin"})`,
        "Cerrá la vigencia del anterior antes de abrir el nuevo");
    }

    if (nuevo.modalidad === "Porcentaje") {
      if (!(nuevo.porcentaje > 0)) fallar("NX-060", "El porcentaje tiene que ser mayor que 0");
      if (nuevo.porcentaje > 100) fallar("NX-060", "El porcentaje no puede superar 100");
    }
    if (nuevo.modalidad === "Fija" && !(nuevo.montoFijo > 0)) {
      fallar("NX-060", "El monto fijo tiene que ser mayor que 0");
    }
    if (["Escalonada", "Mixta"].includes(nuevo.modalidad)) {
      C.validarEscalones(nuevo.escalones);
    }

    // Un acuerdo ya usado no se edita: se cierra y se abre otro. Si no, una
    // comisión vieja deja de poder explicarse con sus propias reglas.
    if (anterior) {
      const usado = (ctx.comisiones || []).some(
        (c) => c.acuerdoId === nuevo.id && c.estado !== "Anulada");
      const cambioCondiciones = ["modalidad", "base", "porcentaje", "montoFijo",
        "tope", "moneda", "mesesRecurrente"].some((k) => anterior[k] !== nuevo[k]) ||
        JSON.stringify(anterior.escalones) !== JSON.stringify(nuevo.escalones);
      if (usado && cambioCondiciones) {
        fallar("NX-068",
          "Este acuerdo ya tiene comisiones calculadas y no se pueden cambiar sus condiciones",
          "Cerrale la vigencia y creá uno nuevo desde la fecha del cambio");
      }
    }
    return true;
  }

  function validarComision(nuevo, anterior, ctx) {
    if (!nuevo.vendedorId) fallar("NX-040", "La comisión necesita vendedor");
    if (!(ctx.vendedores || []).some((v) => v.id === nuevo.vendedorId)) {
      fallar("NX-041", "El vendedor de la comisión no existe");
    }
    if (nuevo.monto < 0) fallar("NX-040", "Una comisión no puede ser negativa");

    if (anterior && nuevo.estado !== anterior.estado) {
      const permitidas = {
        Devengada: ["Devengada", "Aprobada", "Anulada"],
        Aprobada: ["Aprobada", "Liquidada", "Anulada"],
        Liquidada: ["Liquidada"],       // pagada es terminal
        Anulada: ["Anulada"],
      }[anterior.estado] || [];
      if (!permitidas.includes(nuevo.estado)) {
        fallar("NX-020",
          `Una comisión ${anterior.estado} no puede pasar a ${nuevo.estado}`,
          anterior.estado === "Liquidada" ? "Ya se pagó: para corregir, anulá y devengá de nuevo" : "");
      }

      if (nuevo.estado === "Aprobada") {
        if (!P.capacidad(ctx.rol, "aprobar_comision")) {
          fallar("NX-011", "Aprobar comisiones corresponde a gerencia comercial o administrativa");
        }
        // Nadie se aprueba la propia comisión.
        const v = (ctx.vendedores || []).find((x) => x.id === nuevo.vendedorId);
        if (v && ctx.usuario && (v.usuarioId === ctx.usuario || v.nombre === ctx.usuario)) {
          fallar("NX-012", "No podés aprobar tu propia comisión");
        }
      }

      if (nuevo.estado === "Liquidada") {
        const r = global.NEXO_COMISIONES.puedeLiquidarse({ ...nuevo, estado: "Aprobada" }, ctx);
        if (!r.puede) fallar("NX-069", r.motivo);
      }
    }

    if (nuevo.estado === "Anulada" && !nuevo.motivoAnulacion) {
      fallar("NX-040", "Anular una comisión requiere motivo");
    }
    return true;
  }

  const VALIDADORES = {
    vendedores: validarVendedor,
    acuerdosComision: validarAcuerdoComision,
    comisiones: validarComision,
    tickets: validarTicket,
    presupuestos: validarPresupuesto,
    contratos: validarContrato,
    campanas: validarCampana,
    estrategias: validarEstrategia,
    leads: validarLead,
    facturaciones: validarFacturacion,
  };

  // --------------------------------------------------------------------------
  // Punto de entrada
  // --------------------------------------------------------------------------

  /**
   * Valida una escritura. Lanza ErrorNexo si algo no cumple.
   *
   * @param {string} entidad  clave de NEXO_ESQUEMA.ENTIDADES
   * @param {string} accion   "crear" | "editar" | "borrar"
   * @param {object} nuevo    registro ya normalizado
   * @param {object} anterior registro previo, o null si es alta
   * @param {object} ctx      colecciones relacionadas + { rol, usuario }
   */
  function validar(entidad, accion, nuevo, anterior, ctx) {
    ctx = ctx || {};
    const rol = ctx.rol || "vendedor";

    // Permisos primero: es lo más barato de comprobar.
    if (!P.puedeSobre(rol, entidad, accion, anterior || nuevo, ctx.usuario)) {
      fallar("NX-010",
        `Tu rol (${rol}) no puede ${accion} en ${entidad}`);
    }

    const fn = VALIDADORES[entidad];
    if (!fn) return true;               // entidades sin reglas propias
    if (accion === "borrar") return true;
    return fn(nuevo, anterior, ctx);
  }

  /**
   * Efectos derivados de una escritura: lo que en Postgres harían los triggers.
   * Devuelve una lista de cambios a aplicar sobre otras entidades.
   *
   * No muta nada: el llamador decide si los aplica. Así los efectos son
   * inspeccionables y testeables por separado.
   */
  function efectos(entidad, accion, nuevo, anterior, ctx) {
    const cambios = [];
    ctx = ctx || {};

    if (entidad === "presupuestos") {
      const ticket = (ctx.tickets || []).find((t) => t.id === nuevo.ticketId);
      if (ticket && !["Cerrado", "Perdido"].includes(ticket.estado)) {
        // El presupuesto empuja el estado del ticket hacia adelante.
        let destino = null;
        if (nuevo.estado === "Borrador" && ticket.estado === "Nuevo") destino = "EnPresupuesto";
        if (["Enviado", "Aprobado"].includes(nuevo.estado) &&
            ["Nuevo", "EnPresupuesto"].includes(ticket.estado)) destino = "EnNegociacion";
        if (destino) {
          cambios.push({ entidad: "tickets", id: ticket.id, campos: { estado: destino } });
        }
      }
      // Alta de presupuesto: queda referenciado desde el ticket.
      if (accion === "crear" && ticket && !ticket.presupuestoIds.includes(nuevo.id)) {
        cambios.push({
          entidad: "tickets", id: ticket.id,
          campos: { presupuestoIds: [...ticket.presupuestoIds, nuevo.id] },
        });
      }
    }

    if (entidad === "contratos") {
      const vigente = ["Firmado", "Activo", "Finalizado"].includes(nuevo.estado);
      const eraVigente = anterior && ["Firmado", "Activo", "Finalizado"].includes(anterior.estado);
      if (vigente && !eraVigente && nuevo.ticketId) {
        // R4 · la firma cierra el ticket.
        cambios.push({
          entidad: "tickets", id: nuevo.ticketId,
          campos: { estado: "Cerrado", fechaCierre: nuevo.fechaFirma || E.hoy() },
        });
        const lead = (ctx.leads || []).find((l) => l.ticketId === nuevo.ticketId);
        if (lead && lead.estado !== "Convertido") {
          cambios.push({ entidad: "leads", id: lead.id, campos: { estado: "Convertido" } });
        }
      }
      if (nuevo.estado === "Anulado" && eraVigente && nuevo.ticketId) {
        cambios.push({
          entidad: "tickets", id: nuevo.ticketId,
          campos: { estado: "EnNegociacion", fechaCierre: null },
        });
      }
    }

    return cambios;
  }

  global.NEXO_REGLAS = {
    ErrorNexo, CODIGOS, validar, efectos,
    TRANSICION_TICKET, TRANSICION_PRESUPUESTO, TRANSICION_CAMPANA,
    TC_DIAS_TOLERANCIA,
  };
})(typeof window !== "undefined" ? window : globalThis);
