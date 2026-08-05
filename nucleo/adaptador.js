/**
 * Traductor entre la forma vieja de los registros y el modelo v3.
 *
 * app.js guarda los datos como se venían guardando desde el principio:
 * estados en minúscula ("ganado", "presupuestado"), el económico anidado, el
 * cliente embebido en cada registro. El núcleo trabaja con el modelo v3.
 *
 * Este módulo convierte en ambas direcciones. Existe para poder aplicar las
 * reglas de negocio sobre los datos actuales SIN reescribir las 2.879 líneas
 * de app.js de una sola vez: los formularios siguen produciendo la forma
 * vieja, se traduce, se valida contra el núcleo, y si pasa se guarda.
 *
 * Cuando la interfaz termine de pasarse al núcleo, este archivo se borra.
 * Mientras exista, la regla es: la traducción no puede perder información.
 * `aNuevo(aViejo(x))` tiene que devolver `x` en todos los campos que el
 * modelo v3 conoce — hay una prueba que lo verifica.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;

  // --------------------------------------------------------------------------
  // Vocabularios
  // --------------------------------------------------------------------------

  const TICKET_ESTADO_A_NUEVO = {
    abierto: "Nuevo",
    presupuestado: "EnNegociacion",
    ganado: "Cerrado",
    perdido: "Perdido",
  };
  const TICKET_ESTADO_A_VIEJO = {
    Nuevo: "abierto",
    EnPresupuesto: "presupuestado",
    EnNegociacion: "presupuestado",
    Cerrado: "ganado",
    Perdido: "perdido",
  };

  const PRESU_ESTADO_A_NUEVO = {
    borrador: "Borrador",
    enviado: "Enviado",
    ganado: "Aprobado",
    perdido: "Rechazado",
  };
  const PRESU_ESTADO_A_VIEJO = {
    Borrador: "borrador",
    Enviado: "enviado",
    Aprobado: "ganado",
    Rechazado: "perdido",
  };

  const TIPO_PEDIDO_A_NUEVO = {
    servicio: "Servicio", parte: "Producto", partes: "Producto",
    equipo: "Producto", mixto: "Mixto",
  };
  const TIPO_PEDIDO_A_VIEJO = {
    Servicio: "servicio", Producto: "parte", Mixto: "mixto",
  };

  const CONTRATO_ESTADO_A_NUEVO = {
    borrador: "Borrador", enviada: "EnRevision", en_revision: "EnRevision",
    firme_vigente: "Activo", firmado: "Firmado", finalizado: "Finalizado",
    anulado: "Anulado",
  };
  const CONTRATO_ESTADO_A_VIEJO = {
    Borrador: "borrador", EnRevision: "enviada", Firmado: "firmado",
    Activo: "firme_vigente", Finalizado: "finalizado", Anulado: "anulado",
  };

  /** Índice de clientes por nombre normalizado, para resolver clienteId. */
  function indiceClientes(clientes) {
    const m = new Map();
    for (const c of clientes || []) {
      m.set(E.claveCliente(c.nombreComercial || c.razonSocial), c.id);
      for (const a of c.alias || []) m.set(E.claveCliente(a), c.id);
    }
    return m;
  }

  // --------------------------------------------------------------------------
  // Viejo → nuevo
  // --------------------------------------------------------------------------

  /**
   * Índice de presupuestos por id.
   *
   * Sin esto, traducir N tickets hacía una búsqueda lineal sobre N presupuestos:
   * O(n²). Medido: 500 registros 3,9 ms · 2.000 30 ms · 5.000 174 ms ·
   * 12.000 950 ms, y esto corre en cada dibujado de pantalla.
   */
  function indicePresupuestos(presupuestos) {
    const m = new Map();
    for (const p of presupuestos || []) m.set(p.id, p);
    return m;
  }

  function ticketANuevo(t, ctx = {}) {
    const idx = ctx.indiceClientes || new Map();
    const pid = t.presupuestoIds?.[0];
    const presu = ctx.indicePresupuestos
      ? ctx.indicePresupuestos.get(pid)
      : (ctx.presupuestos || []).find((p) => p.id === pid);
    const eco = presu?.economico || {};
    const recurrencia = eco.recurrencia || "unica";
    const bruto = (presu?.items || []).reduce(
      (s, i) => s + (Number(i.cantidad) || 0) * (Number(i.unitario) || 0), 0);

    let estado = TICKET_ESTADO_A_NUEVO[t.estado] || "Nuevo";
    // "presupuestado" cubre dos situaciones distintas: el presupuesto todavía
    // interno y el ya enviado al cliente. Se desambigua con el presupuesto.
    if (t.estado === "presupuestado" && presu?.estado === "borrador") {
      estado = "EnPresupuesto";
    }
    const terminal = estado === "Cerrado" || estado === "Perdido";

    return E.ENTIDADES.tickets.normalizar({
      id: t.id,
      numero: t.numero,
      fecha: t.fecha,
      clienteId: idx.get(E.claveCliente(t.cliente?.nombreComercial)) || "",
      pais: t.pais,
      vendedor: t.vendedor || t.usuario,
      usuario: t.usuario,
      campanaId: t.campanaId || null,
      leadId: t.leadId || null,
      estado,
      tipo: TIPO_PEDIDO_A_NUEVO[t.tipoPedido] || "Servicio",
      prioridad: t.prioridad,
      descripcion: t.descripcion,
      montoEstimado: recurrencia === "mensual" ? bruto * 12 : bruto,
      moneda: eco.moneda || "USD",
      recurrencia,
      presupuestoIds: t.presupuestoIds || [],
      fechaCierre: terminal ? (t.fechaCierre || t.historial?.at(-1)?.fecha || t.fecha) : null,
      cierreEstimado: terminal && !t.fechaCierre,
      motivoPerdida: t.motivoPerdida ||
        (estado === "Perdido" ? "Migrado sin motivo registrado" : ""),
      historial: t.historial || [],
    });
  }

  function presupuestoANuevo(p, ctx = {}) {
    const idx = ctx.indiceClientes || new Map();
    return E.ENTIDADES.presupuestos.normalizar({
      id: p.id,
      numero: p.numero,
      ticketId: p.ticketId,
      fecha: p.fecha,
      validezDias: p.economico?.validezDias,
      tipo: p.tipo,
      subtipo: p.subtipo,
      titulo: p.titulo,
      clienteId: idx.get(E.claveCliente(p.cliente?.nombreComercial)) || "",
      // País de origen de la cotización: define la moneda de facturación.
      pais: p.pais,
      estado: PRESU_ESTADO_A_NUEVO[p.estado] || "Borrador",
      estadoOrigen: p.estadoOrigen,
      items: p.items || [],
      saas: p.saas || [],
      economico: p.economico || {},
      notas: p.notas,
      archivos: p.archivos || [],
      historialEstados: p.historialEstados || [],
      usuario: p.usuario,
    });
  }

  function contratoANuevo(c, ctx = {}) {
    const idx = ctx.indiceClientes || new Map();
    const estado = CONTRATO_ESTADO_A_NUEVO[c.estado] || "Borrador";
    const vigente = ["Firmado", "Activo", "Finalizado"].includes(estado);
    return E.ENTIDADES.contratos.normalizar({
      id: c.id,
      numero: c.numeroNuevo || c.numero,
      numeroLegado: c.numeroLegado || c.numero,
      origen: c.origen || (c.ticketId ? "comercial" : "independiente"),
      clienteId: idx.get(E.claveCliente(c.cliente?.nombreComercial)) || "",
      pais: c.pais,
      ticketId: c.ticketId || null,
      presupuestoId: c.presupuestoId || null,
      estado,
      tipo: c.tipo,
      fechaFirma: c.fechas?.firmado || (vigente ? c.vigencia?.inicio || c.fechas?.creado : null),
      vigencia: c.vigencia || {},
      economico: c.economico || {},
      // La forma vieja no tiene campo de recurrencia: todos los contratos
      // históricos son abonos de mantenimiento con canon mensual. Pero fijarlo
      // a "mensual" siempre haría que una venta única se valúe doce veces de
      // más al calcular comisiones. Se respeta el campo cuando existe.
      recurrencia: c.recurrencia === "unica" ? "unica" : "mensual",
      equipos: c.equipos || [],
      cobertura: c.cobertura || {},
      ajuste: c.ajuste || {},
      plan: c.plan || {},
      archivos: c.archivos || [],
      notas: c.notas,
      historialEstados: c.historialEstados || [],
    });
  }

  // --------------------------------------------------------------------------
  // Nuevo → viejo
  // --------------------------------------------------------------------------

  /** Devuelve el bloque `cliente` embebido que espera la forma vieja. */
  function bloqueCliente(clienteId, clientes) {
    const c = (clientes || []).find((x) => x.id === clienteId);
    if (!c) return { nombreComercial: "", razonesSociales: [], contacto: "" };
    return {
      nombreComercial: c.nombreComercial,
      razonesSociales: c.cuit
        ? [{ razonSocial: c.razonSocial, cuit: c.cuit, domicilio: "", principal: true }]
        : [],
      contacto: c.contacto || "",
      localidad: c.localidad || "",
      provincia: c.provincia || "",
    };
  }

  function ticketAViejo(t, ctx = {}) {
    return {
      id: t.id,
      numero: t.numero,
      fecha: t.fecha,
      cliente: bloqueCliente(t.clienteId, ctx.clientes),
      tipoPedido: TIPO_PEDIDO_A_VIEJO[t.tipo] || "servicio",
      descripcion: t.descripcion,
      estado: TICKET_ESTADO_A_VIEJO[t.estado] || "abierto",
      pais: t.pais,
      presupuestoIds: t.presupuestoIds,
      usuario: t.usuario || t.vendedor,
      historial: t.historial,
      // Campos que la forma vieja no tenía pero no se pueden perder: se
      // conservan tal cual para que el ida y vuelta sea sin pérdida.
      vendedor: t.vendedor,
      prioridad: t.prioridad,
      campanaId: t.campanaId,
      leadId: t.leadId,
      fechaCierre: t.fechaCierre,
      cierreEstimado: t.cierreEstimado,
      motivoPerdida: t.motivoPerdida,
    };
  }

  function presupuestoAViejo(p, ctx = {}) {
    return {
      id: p.id,
      numero: p.numero,
      tipo: p.tipo,
      subtipo: p.subtipo,
      titulo: p.titulo,
      estado: PRESU_ESTADO_A_VIEJO[p.estado] || "borrador",
      estadoOrigen: p.estadoOrigen,
      pais: p.pais,
      fecha: p.fecha,
      ticketId: p.ticketId,
      ticketNumero: ctx.ticketNumero || "",
      cliente: bloqueCliente(p.clienteId, ctx.clientes),
      items: p.items.map((i) => ({
        detalle: i.detalle, cantidad: i.cantidad, unitario: i.unitario,
      })),
      saas: p.saas,
      economico: p.economico,
      notas: p.notas,
      archivos: p.archivos,
      usuario: p.usuario,
      origen: p.origen || "",
      historialEstados: p.historialEstados,
    };
  }

  // --------------------------------------------------------------------------
  // Validación sobre datos en forma vieja
  // --------------------------------------------------------------------------

  /**
   * Traduce, valida contra el núcleo y devuelve los efectos derivados.
   *
   * Es el punto por el que pasan todas las escrituras de app.js. Si la regla
   * falla, lanza ErrorNexo y la escritura no ocurre.
   *
   * @param {string} entidad "tickets" | "presupuestos" | "contratos"
   * @param {string} accion  "crear" | "editar" | "borrar"
   * @param {object} nuevoViejo registro en forma vieja, tal como lo arma el formulario
   * @param {object} anteriorViejo registro previo en forma vieja, o null
   * @param {object} estado  { tickets, presupuestos, contratos, clientes, rol, usuario }
   */
  function validarEnFormaVieja(entidad, accion, nuevoViejo, anteriorViejo, estado) {
    // app.js todavía no tiene una colección de clientes: el cliente viene
    // embebido en cada registro. Si no la pasan, se deriva. Sin esto el
    // clienteId queda vacío y toda validación muere en "falta cliente" antes
    // de llegar a la regla que realmente importa.
    const clientes = estado.clientes?.length ? estado.clientes : clientesDesde(estado);
    const idx = indiceClientes(clientes);
    const ctx = { indiceClientes: idx, presupuestos: estado.presupuestos || [],
      indicePresupuestos: indicePresupuestos(estado.presupuestos) };

    const aNuevo = {
      tickets: ticketANuevo,
      presupuestos: presupuestoANuevo,
      contratos: contratoANuevo,
    }[entidad];
    if (!aNuevo) return { ok: true, efectos: [] };

    const nuevo = aNuevo(nuevoViejo, ctx);
    const anterior = anteriorViejo ? aNuevo(anteriorViejo, ctx) : null;

    // El contexto que necesitan las reglas, todo en forma nueva.
    const ctxReglas = {
      rol: estado.rol || "admin",
      usuario: estado.usuario || "",
      tickets: (estado.tickets || []).map((t) => ticketANuevo(t, ctx)),
      presupuestos: (estado.presupuestos || []).map((p) => presupuestoANuevo(p, ctx)),
      contratos: (estado.contratos || []).map((c) => contratoANuevo(c, ctx)),
      campanas: estado.campanas || [],
      estrategias: estado.estrategias || [],
      leads: estado.leads || [],
      tiposCambio: estado.tiposCambio || [],
    };

    global.NEXO_REGLAS.validar(entidad, accion, nuevo, anterior, ctxReglas);
    const efectos = global.NEXO_REGLAS.efectos(entidad, accion, nuevo, anterior, ctxReglas);
    return { ok: true, nuevo, anterior, efectos };
  }

  /**
   * Traduce todo el estado de app.js al modelo nuevo, para poder calcular los
   * KPIs con el motor del núcleo sin tocar los datos guardados.
   */
  function estadoANuevo(estado) {
    const clientes = estado.clientes || clientesDesde(estado);
    const idx = indiceClientes(clientes);
    const ctx = { indiceClientes: idx, presupuestos: estado.presupuestos || [],
      indicePresupuestos: indicePresupuestos(estado.presupuestos) };
    return {
      clientes,
      tickets: (estado.tickets || []).map((t) => ticketANuevo(t, ctx)),
      presupuestos: (estado.presupuestos || []).map((p) => presupuestoANuevo(p, ctx)),
      contratos: (estado.data || estado.contratos || []).map((c) => contratoANuevo(c, ctx)),
      campanas: estado.campanas || [],
      estrategias: estado.estrategias || [],
      leads: estado.leads || [],
      tiposCambio: estado.tiposCambio || [],
    };
  }

  /**
   * Deriva el padrón de clientes a partir de los registros, cuando todavía no
   * existe como colección propia. Deduplicado por clave normalizada.
   */
  function clientesDesde(estado) {
    const mapa = new Map();
    const agregar = (bloque) => {
      const nombre = (bloque?.nombreComercial || "").trim();
      if (!nombre) return;
      const clave = E.claveCliente(nombre);
      if (!mapa.has(clave)) {
        mapa.set(clave, E.ENTIDADES.clientes.normalizar({
          id: `cli_${clave.replace(/\s+/g, "-").slice(0, 32)}`,
          nombreComercial: nombre,
          razonSocial: nombre,
          localidad: bloque.localidad,
          provincia: bloque.provincia,
          contacto: bloque.contacto,
          alias: [nombre],
        }));
      }
      const c = mapa.get(clave);
      if (!c.alias.includes(nombre)) c.alias.push(nombre);
      const rs = (bloque.razonesSociales || []).find((r) => r.cuit);
      if (rs && !c.cuit) { c.cuit = rs.cuit; c.razonSocial = rs.razonSocial || c.razonSocial; }
    };
    for (const t of estado.tickets || []) agregar(t.cliente);
    for (const p of estado.presupuestos || []) agregar(p.cliente);
    for (const c of estado.data || estado.contratos || []) agregar(c.cliente);
    return [...mapa.values()];
  }

  global.NEXO_ADAPTADOR = {
    TICKET_ESTADO_A_NUEVO, TICKET_ESTADO_A_VIEJO,
    PRESU_ESTADO_A_NUEVO, PRESU_ESTADO_A_VIEJO,
    TIPO_PEDIDO_A_NUEVO, TIPO_PEDIDO_A_VIEJO,
    CONTRATO_ESTADO_A_NUEVO, CONTRATO_ESTADO_A_VIEJO,
    indiceClientes, indicePresupuestos, clientesDesde,
    ticketANuevo, presupuestoANuevo, contratoANuevo,
    ticketAViejo, presupuestoAViejo, bloqueCliente,
    validarEnFormaVieja, estadoANuevo,
  };
})(typeof window !== "undefined" ? window : globalThis);
