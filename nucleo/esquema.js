/**
 * Esquema consolidado del modelo de datos.
 *
 * Una sola definición de qué es cada entidad, qué campos tiene, qué valores
 * admite y cómo se migra desde versiones anteriores. Antes esto vivía repartido
 * entre app.js, contrato.js y presupuesto.js, y cada lugar tenía su propia idea
 * de la forma de un registro.
 *
 * Sin base de datos no hay CHECK ni FK que garanticen nada: la integridad la
 * sostiene este archivo. Por eso `normalizar()` no confía en la entrada y
 * completa todo campo faltante con un default explícito.
 *
 * Este archivo vive en un repo público. Solo estructura, nunca datos reales.
 */
(function (global) {
  "use strict";

  /** Versión del modelo. Sube cuando cambia la forma de los registros. */
  const VERSION = 3;

  // --------------------------------------------------------------------------
  // Vocabularios cerrados
  // --------------------------------------------------------------------------

  const TICKET_ESTADO = ["Nuevo", "EnPresupuesto", "EnNegociacion", "Cerrado", "Perdido"];
  const TICKET_TIPO = ["Servicio", "Producto", "Mixto"];
  const PRIORIDAD = ["Baja", "Media", "Alta", "Critica"];
  const PRESUPUESTO_ESTADO = ["Borrador", "Enviado", "Aprobado", "Rechazado"];
  const CONTRATO_ESTADO = ["Borrador", "EnRevision", "Firmado", "Activo", "Finalizado", "Anulado"];
  const CAMPANA_ESTADO = ["Planificada", "Activa", "Finalizada", "Cancelada"];
  const ESTRATEGIA_ESTADO = ["Planificada", "EnCurso", "Finalizada", "Cancelada"];
  const ESTRATEGIA_TIPO = ["Contenido", "Ads", "Influencer", "Evento"];
  const CANAL = ["Email", "Redes", "SEA", "Offline"];
  const LEAD_ESTADO = ["Nuevo", "Contactado", "Calificado", "Descartado", "Convertido"];
  const RECURRENCIA = ["unica", "mensual"];

  const VENDEDOR_ESTADO = ["Activo", "Inactivo"];
  const VENDEDOR_RELACION = ["Interno", "Externo", "Representante"];
  const COMISION_MODALIDAD = ["Porcentaje", "Escalonada", "Fija", "Mixta"];
  /** Sobre qué se calcula: el valor del contrato o el margen declarado. */
  const COMISION_BASE = ["Contrato", "Margen", "Cobrado"];
  const COMISION_ORIGEN = ["Contrato", "Presupuesto", "Facturacion"];
  const COMISION_ESTADO = ["Devengada", "Aprobada", "Liquidada", "Anulada"];
  const ROL = ["vendedor", "gerente_comercial", "gerente_administrativo", "direccion", "marketing", "admin"];

  /** Monedas de cotización. ARS/CLP solo se toleran en registros heredados. */
  const MONEDA_COTIZACION = ["USD", "UF"];
  const MONEDA_LIQUIDACION = ["ARS", "CLP", "USD"];

  /** Probabilidad de cierre por etapa. Alimenta el pipeline ponderado. */
  const PESO_ETAPA = {
    Nuevo: 0.10, EnPresupuesto: 0.30, EnNegociacion: 0.60,
    Cerrado: 1.00, Perdido: 0.00,
  };

  // --------------------------------------------------------------------------
  // Utilidades de normalización
  // --------------------------------------------------------------------------

  const esTexto = (v) => (v === null || v === undefined ? "" : String(v));
  const esNumero = (v, def = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const esLista = (v) => (Array.isArray(v) ? v : []);
  const esBool = (v, def = false) => (typeof v === "boolean" ? v : def);

  /** Fuerza un valor dentro de un vocabulario cerrado. */
  const enumerado = (v, valores, def) => (valores.includes(v) ? v : def);

  /** Fecha ISO corta (AAAA-MM-DD). Devuelve null si no se puede interpretar. */
  function fecha(v) {
    if (!v) return null;
    const s = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }

  /** Período de partición al que pertenece una fecha: "AAAA-MM". */
  function periodo(v) {
    const f = fecha(v);
    return f ? f.slice(0, 7) : null;
  }

  /** Redondeo monetario a 2 decimales, evitando el error de coma flotante. */
  const money = (n) => Math.round((esNumero(n) + Number.EPSILON) * 100) / 100;

  /**
   * Clave de deduplicación de clientes: sin acentos, sin puntuación, minúsculas.
   * Dos fichas que solo difieren en mayúsculas, tildes o puntuación colapsan
   * en una sola: "Centro Médico" y "CENTRO MEDICO" son el mismo cliente.
   */
  function claveCliente(nombre) {
    return esTexto(nombre)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  // --------------------------------------------------------------------------
  // Entidades
  // --------------------------------------------------------------------------

  const ENTIDADES = {
    /** Padrón único. Ventas es dueño del cliente (decisión del 2026-08-04). */
    clientes: {
      archivo: "clientes",
      particionado: false,
      idPrefijo: "cli_",
      normalizar(r) {
        return {
          id: esTexto(r.id) || nuevoId("cli_"),
          razonSocial: esTexto(r.razonSocial || r.nombreComercial),
          nombreComercial: esTexto(r.nombreComercial || r.razonSocial),
          cuit: esTexto(r.cuit),
          pais: esTexto(r.pais) || "AR",
          localidad: esTexto(r.localidad),
          provincia: esTexto(r.provincia),
          contacto: esTexto(r.contacto),
          email: esTexto(r.email),
          telefono: esTexto(r.telefono),
          // Nombres alternativos con los que este cliente aparecía antes.
          alias: esLista(r.alias).map(esTexto).filter(Boolean),
          creado: fecha(r.creado) || hoy(),
        };
      },
    },

    tickets: {
      archivo: "tickets",
      particionado: true,
      campoPeriodo: "fecha",
      idPrefijo: "tk_",
      normalizar(r) {
        const estado = enumerado(r.estado, TICKET_ESTADO, "Nuevo");
        const terminal = estado === "Cerrado" || estado === "Perdido";
        return {
          id: esTexto(r.id) || nuevoId("tk_"),
          numero: esTexto(r.numero),
          fecha: fecha(r.fecha) || hoy(),
          clienteId: esTexto(r.clienteId),
          vendedor: esTexto(r.vendedor) || esTexto(r.usuario),
          campanaId: esTexto(r.campanaId) || null,
          leadId: esTexto(r.leadId) || null,
          estado,
          tipo: enumerado(r.tipo, TICKET_TIPO, "Servicio"),
          prioridad: enumerado(r.prioridad, PRIORIDAD, "Media"),
          descripcion: esTexto(r.descripcion),
          montoEstimado: money(r.montoEstimado),
          moneda: esTexto(r.moneda) || "USD",
          recurrencia: enumerado(r.recurrencia, RECURRENCIA, "unica"),
          presupuestoIds: esLista(r.presupuestoIds).map(esTexto).filter(Boolean),
          // Solo los terminales llevan fecha de cierre. Es lo que hace medible
          // el ciclo de venta: sin esto el KPI no existe.
          fechaCierre: terminal ? (fecha(r.fechaCierre) || fecha(r.fecha) || hoy()) : null,
          // Fecha de cierre deducida, no registrada. Los tickets migrados no
          // traen el momento real del cierre, así que su ciclo sería 0 días.
          // Un 0 inventado es peor que no tener el dato: estos quedan fuera
          // del KPI de ciclo en vez de aplanarlo.
          cierreEstimado: terminal ? esBool(r.cierreEstimado) : false,
          motivoPerdida: estado === "Perdido" ? esTexto(r.motivoPerdida) : "",
          historial: esLista(r.historial),
          usuario: esTexto(r.usuario),
        };
      },
    },

    presupuestos: {
      archivo: "presupuestos",
      particionado: true,
      campoPeriodo: "fecha",
      idPrefijo: "pre_",
      normalizar(r) {
        const items = esLista(r.items).map((i) => {
          const cantidad = esNumero(i.cantidad, 1);
          const unitario = money(i.unitario ?? i.precioUnitario);
          return {
            detalle: esTexto(i.detalle || i.concepto),
            cantidad,
            unitario,
            total: money(cantidad * unitario),
          };
        });
        const saas = esLista(r.saas).map((s) => ({
          producto: esTexto(s.producto),
          abonoMensual: money(s.abonoMensual),
        }));

        const eco = r.economico || {};
        const moneda = esTexto(eco.moneda) || "USD";
        const descuentoPct = esNumero(eco.descuentoPct);
        const recurrencia = enumerado(eco.recurrencia, RECURRENCIA, "unica");

        const subtotal = money(items.reduce((s, i) => s + i.total, 0));
        const total = money(subtotal * (1 - descuentoPct / 100));
        const validezDias = esNumero(eco.validezDias, 15);
        const f = fecha(r.fecha) || hoy();

        return {
          id: esTexto(r.id) || nuevoId("pre_"),
          numero: esTexto(r.numero),
          ticketId: esTexto(r.ticketId),
          fecha: f,
          validezDias,
          vence: sumarDias(f, validezDias),
          tipo: esTexto(r.tipo) || "servicio",
          subtipo: esTexto(r.subtipo),
          titulo: esTexto(r.titulo),
          clienteId: esTexto(r.clienteId),
          estado: enumerado(r.estado, PRESUPUESTO_ESTADO, "Borrador"),
          // Se conserva el estado tal como lo llevaba el usuario en su planilla.
          estadoOrigen: esTexto(r.estadoOrigen),
          items,
          saas,
          economico: {
            moneda,
            recurrencia,
            descuentoPct,
            validezDias,
            ivaPct: esNumero(eco.ivaPct, 21),
            incluyeIVA: esBool(eco.incluyeIVA),
            formaPago: esTexto(eco.formaPago),
          },
          subtotal,
          total,
          // Los importes se guardan calculados, no se recalculan al leer:
          // un presupuesto aprobado no puede cambiar de monto solo.
          esLegado: !MONEDA_COTIZACION.includes(moneda),
          hash: esTexto(r.hash),
          notas: esTexto(r.notas),
          archivos: esLista(r.archivos),
          historialEstados: esLista(r.historialEstados),
          usuario: esTexto(r.usuario),
        };
      },
    },

    contratos: {
      archivo: "contratos",
      particionado: false,
      idPrefijo: "ctr_",
      normalizar(r) {
        const estado = enumerado(r.estado, CONTRATO_ESTADO, "Borrador");
        const origen = r.origen === "independiente" ? "independiente" : "comercial";
        return {
          id: esTexto(r.id) || nuevoId("ctr_"),
          numero: esTexto(r.numero),
          // El número viejo no identificaba: "P20260721" estaba en tres
          // contratos distintos. Se conserva solo para reconciliar papeles.
          numeroLegado: esTexto(r.numeroLegado),
          origen,
          clienteId: esTexto(r.clienteId),
          ticketId: origen === "comercial" ? esTexto(r.ticketId) : null,
          presupuestoId: origen === "comercial" ? esTexto(r.presupuestoId) : null,
          hashPresupuesto: esTexto(r.hashPresupuesto),
          estado,
          tipo: esTexto(r.tipo) || "contrato",
          fechaFirma: fecha(r.fechaFirma),
          vigencia: {
            inicio: fecha(r.vigencia?.inicio),
            meses: esNumero(r.vigencia?.meses, 12),
            fin: fecha(r.vigencia?.fin),
            renovacionAutomatica: esBool(r.vigencia?.renovacionAutomatica, true),
            preavisoDias: esNumero(r.vigencia?.preavisoDias, 30),
          },
          economico: {
            canonMensual: money(r.economico?.canonMensual),
            moneda: esTexto(r.economico?.moneda) || "USD",
            ivaPct: esNumero(r.economico?.ivaPct, 21),
            incluyeIVA: esBool(r.economico?.incluyeIVA),
            formaPago: esTexto(r.economico?.formaPago),
          },
          recurrencia: enumerado(r.recurrencia, RECURRENCIA, "mensual"),
          equipos: esLista(r.equipos),
          cobertura: r.cobertura || {},
          ajuste: r.ajuste || {},
          plan: r.plan || {},
          archivos: esLista(r.archivos),
          notas: esTexto(r.notas),
          historialEstados: esLista(r.historialEstados),
        };
      },
    },

    campanas: {
      archivo: "campanas",
      particionado: false,
      idPrefijo: "cmp_",
      normalizar(r) {
        return {
          id: esTexto(r.id) || nuevoId("cmp_"),
          nombre: esTexto(r.nombre),
          objetivo: esTexto(r.objetivo),
          presupuestoAsignado: money(r.presupuestoAsignado),
          moneda: esTexto(r.moneda) || "USD",
          fechaInicio: fecha(r.fechaInicio) || hoy(),
          fechaFin: fecha(r.fechaFin),
          canales: esLista(r.canales).filter((c) => CANAL.includes(c)),
          responsable: esTexto(r.responsable),
          estado: enumerado(r.estado, CAMPANA_ESTADO, "Planificada"),
          notas: esTexto(r.notas),
        };
      },
    },

    estrategias: {
      archivo: "estrategias",
      particionado: false,
      idPrefijo: "est_",
      normalizar(r) {
        return {
          id: esTexto(r.id) || nuevoId("est_"),
          campanaId: esTexto(r.campanaId),
          tipo: enumerado(r.tipo, ESTRATEGIA_TIPO, "Contenido"),
          descripcion: esTexto(r.descripcion),
          kpiObjetivo: {
            metrica: esTexto(r.kpiObjetivo?.metrica),
            objetivo: esNumero(r.kpiObjetivo?.objetivo),
            unidad: esTexto(r.kpiObjetivo?.unidad),
          },
          kpiValorActual: r.kpiValorActual === null || r.kpiValorActual === undefined
            ? null : esNumero(r.kpiValorActual),
          inversion: money(r.inversion),
          fechaEjecucion: fecha(r.fechaEjecucion),
          // Sin este campo no se puede aplicar R5: una campaña solo cierra
          // cuando todas sus estrategias están finalizadas o canceladas.
          estado: enumerado(r.estado, ESTRATEGIA_ESTADO, "Planificada"),
        };
      },
    },

    leads: {
      archivo: "leads",
      particionado: true,
      campoPeriodo: "fechaCaptura",
      idPrefijo: "led_",
      normalizar(r) {
        const estado = enumerado(r.estado, LEAD_ESTADO, "Nuevo");
        return {
          id: esTexto(r.id) || nuevoId("led_"),
          campanaId: esTexto(r.campanaId) || null,
          estrategiaId: esTexto(r.estrategiaId) || null,
          // El canal vive en el lead, no en la campaña: una campaña multicanal
          // no permite atribuir el costo por lead sin este dato.
          canal: enumerado(r.canal, CANAL, "Offline"),
          origenDetalle: esTexto(r.origenDetalle),
          fechaCaptura: fecha(r.fechaCaptura) || hoy(),
          contactoNombre: esTexto(r.contactoNombre),
          contactoEmail: esTexto(r.contactoEmail).toLowerCase(),
          contactoTel: esTexto(r.contactoTel),
          pais: esTexto(r.pais) || "AR",
          clienteId: esTexto(r.clienteId) || null,
          ticketId: esTexto(r.ticketId) || null,
          estado,
          motivoDescarte: estado === "Descartado" ? esTexto(r.motivoDescarte) : "",
        };
      },
    },

    facturaciones: {
      archivo: "facturaciones",
      particionado: true,
      campoPeriodo: "fechaEmision",
      idPrefijo: "fac_",
      normalizar(r) {
        return {
          id: esTexto(r.id) || nuevoId("fac_"),
          presupuestoId: esTexto(r.presupuestoId),
          contratoId: esTexto(r.contratoId) || null,
          numeroComprobante: esTexto(r.numeroComprobante),
          fechaEmision: fecha(r.fechaEmision) || hoy(),
          monedaCotizacion: esTexto(r.monedaCotizacion) || "USD",
          montoCotizado: money(r.montoCotizado),
          // El tipo de cambio queda congelado acá. Sin esto no se puede
          // reconstruir por qué se facturó ese importe.
          tcUnidad: esTexto(r.tcUnidad),
          tcValor: esNumero(r.tcValor),
          tcFecha: fecha(r.tcFecha),
          tcFuente: esTexto(r.tcFuente),
          monedaLiquidacion: enumerado(r.monedaLiquidacion, MONEDA_LIQUIDACION, "ARS"),
          montoLiquidado: money(r.montoLiquidado),
          emitidoPor: esTexto(r.emitidoPor),
          creado: esTexto(r.creado) || new Date().toISOString(),
        };
      },
    },

    /** Serie de cotizaciones. ARS: BNA billete vendedor. UF: pesos por UF. */
    tiposCambio: {
      archivo: "tipos-cambio",
      particionado: false,
      idPrefijo: "tc_",
      normalizar(r) {
        return {
          id: esTexto(r.id) || `tc_${esTexto(r.unidad)}_${fecha(r.fecha)}`,
          fecha: fecha(r.fecha) || hoy(),
          unidad: esTexto(r.unidad),
          tasa: esNumero(r.tasa),
          fuente: esTexto(r.fuente),
        };
      },
    },

    /**
     * Vendedores. Distinto de `usuarios`: un usuario es alguien que entra a la
     * aplicación; un vendedor es alguien que cobra comisión. Un representante
     * externo comisiona sin tener acceso, y un gerente puede tener acceso sin
     * comisionar. Se relacionan por `usuarioId` cuando la persona es ambas cosas.
     */
    vendedores: {
      archivo: "vendedores",
      particionado: false,
      idPrefijo: "vnd_",
      normalizar(r) {
        const estado = enumerado(r.estado, VENDEDOR_ESTADO, "Activo");
        return {
          id: esTexto(r.id) || nuevoId("vnd_"),
          nombre: esTexto(r.nombre),
          usuarioId: esTexto(r.usuarioId) || null,
          relacion: enumerado(r.relacion, VENDEDOR_RELACION, "Interno"),
          email: esTexto(r.email),
          telefono: esTexto(r.telefono),
          documento: esTexto(r.documento),        // CUIT o DNI
          zona: esTexto(r.zona),                  // territorio asignado
          pais: esTexto(r.pais) || "AR",
          estado,
          fechaAlta: fecha(r.fechaAlta) || hoy(),
          fechaBaja: estado === "Inactivo" ? fecha(r.fechaBaja) : null,
          // Cuota comercial. Sirve para medir cumplimiento; 0 = sin cuota.
          metaMensual: money(r.metaMensual),
          metaMoneda: enumerado(r.metaMoneda, MONEDA_COTIZACION, "USD"),
          notas: esTexto(r.notas),
        };
      },
    },

    /**
     * Acuerdo de comisiones. Versionado por vigencia: cambiar las condiciones
     * NO edita el acuerdo anterior, crea uno nuevo. Así una comisión vieja
     * siempre se puede reconstruir con las reglas que regían ese día.
     */
    acuerdosComision: {
      archivo: "acuerdos-comision",
      particionado: false,
      idPrefijo: "acu_",
      normalizar(r) {
        const modalidad = enumerado(r.modalidad, COMISION_MODALIDAD, "Porcentaje");
        const escalones = esLista(r.escalones)
          .map((e) => ({
            desde: money(e.desde),
            // null = sin tope superior (último tramo)
            hasta: e.hasta === null || e.hasta === undefined || e.hasta === ""
              ? null : money(e.hasta),
            porcentaje: esNumero(e.porcentaje),
          }))
          .sort((a, b) => a.desde - b.desde);

        return {
          id: esTexto(r.id) || nuevoId("acu_"),
          vendedorId: esTexto(r.vendedorId),
          nombre: esTexto(r.nombre),
          modalidad,
          base: enumerado(r.base, COMISION_BASE, "Contrato"),
          porcentaje: esNumero(r.porcentaje),     // modalidad Porcentaje
          montoFijo: money(r.montoFijo),          // modalidad Fija
          escalones,                              // modalidad Escalonada
          moneda: enumerado(r.moneda, MONEDA_COTIZACION, "USD"),
          // Tope por operación. 0 = sin tope.
          tope: money(r.tope),
          // Regla comercial clave: si es true, la comisión se devenga con la
          // venta pero solo se liquida cuando el cliente pagó. Es lo que
          // evita pagar comisión por una venta que después no se cobra.
          pagoTrasCobro: esBool(r.pagoTrasCobro, true),
          // Para abonos mensuales: cuántos meses se comisiona. 0 = todos.
          mesesRecurrente: esNumero(r.mesesRecurrente),
          vigenciaDesde: fecha(r.vigenciaDesde) || hoy(),
          vigenciaHasta: fecha(r.vigenciaHasta),  // null = vigente sin fin
          notas: esTexto(r.notas),
          creado: fecha(r.creado) || hoy(),
        };
      },
    },

    /** Comisión devengada sobre una operación concreta. */
    comisiones: {
      archivo: "comisiones",
      particionado: true,
      campoPeriodo: "fechaDevengo",
      idPrefijo: "com_",
      normalizar(r) {
        const estado = enumerado(r.estado, COMISION_ESTADO, "Devengada");
        return {
          id: esTexto(r.id) || nuevoId("com_"),
          vendedorId: esTexto(r.vendedorId),
          acuerdoId: esTexto(r.acuerdoId),
          // De dónde salió: contrato firmado, presupuesto aprobado o factura.
          origenTipo: enumerado(r.origenTipo, COMISION_ORIGEN, "Contrato"),
          origenId: esTexto(r.origenId),
          origenNumero: esTexto(r.origenNumero),
          clienteId: esTexto(r.clienteId),
          periodo: esTexto(r.periodo) || (fecha(r.fechaDevengo) || hoy()).slice(0, 7),
          baseCalculo: money(r.baseCalculo),
          porcentajeAplicado: esNumero(r.porcentajeAplicado),
          monto: money(r.monto),
          moneda: enumerado(r.moneda, MONEDA_COTIZACION, "USD"),
          estado,
          fechaDevengo: fecha(r.fechaDevengo) || hoy(),
          fechaAprobacion: fecha(r.fechaAprobacion),
          fechaLiquidacion: estado === "Liquidada" ? (fecha(r.fechaLiquidacion) || hoy()) : null,
          // Trazabilidad del cálculo: qué escalón se aplicó, si hubo tope.
          detalleCalculo: esTexto(r.detalleCalculo),
          aprobadaPor: esTexto(r.aprobadaPor),
          motivoAnulacion: estado === "Anulada" ? esTexto(r.motivoAnulacion) : "",
          observaciones: esTexto(r.observaciones),
        };
      },
    },

    usuarios: {
      archivo: "usuarios",
      particionado: false,
      idPrefijo: "usr_",
      normalizar(r) {
        return {
          id: esTexto(r.id) || nuevoId("usr_"),
          nombre: esTexto(r.nombre).toLowerCase(),
          email: esTexto(r.email),
          rol: enumerado(r.rol, ROL, "vendedor"),
          activo: esBool(r.activo, true),
        };
      },
    },
  };

  // --------------------------------------------------------------------------
  // Helpers de fecha e id
  // --------------------------------------------------------------------------

  function hoy() {
    return new Date().toISOString().slice(0, 10);
  }

  function sumarDias(f, dias) {
    const d = new Date(f + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + esNumero(dias));
    return d.toISOString().slice(0, 10);
  }

  /** Id local con prefijo. No se usa uuid: estos ids se leen en los commits. */
  let contador = 0;
  function nuevoId(prefijo) {
    contador += 1;
    return `${prefijo}${Date.now().toString(36)}${contador.toString(36)}`;
  }

  // --------------------------------------------------------------------------
  // Normalización masiva
  // --------------------------------------------------------------------------

  /**
   * Normaliza una colección completa. Los registros que no se pueden interpretar
   * no se descartan en silencio: se devuelven aparte para que el llamador decida.
   */
  function normalizarColeccion(entidad, registros) {
    const def = ENTIDADES[entidad];
    if (!def) throw new Error(`Entidad desconocida: ${entidad}`);

    const ok = [];
    const fallidos = [];
    for (const r of esLista(registros)) {
      try {
        ok.push(def.normalizar(r));
      } catch (e) {
        fallidos.push({ registro: r, error: e.message });
      }
    }
    return { registros: ok, fallidos };
  }

  /** Período de partición de un registro según su entidad. */
  function periodoDe(entidad, registro) {
    const def = ENTIDADES[entidad];
    if (!def?.particionado) return null;
    return periodo(registro[def.campoPeriodo]) || periodo(hoy());
  }

  global.NEXO_ESQUEMA = {
    VERSION,
    ENTIDADES,
    TICKET_ESTADO, TICKET_TIPO, PRIORIDAD, PRESUPUESTO_ESTADO, CONTRATO_ESTADO,
    CAMPANA_ESTADO, ESTRATEGIA_ESTADO, ESTRATEGIA_TIPO, CANAL, LEAD_ESTADO,
    RECURRENCIA, ROL, MONEDA_COTIZACION, MONEDA_LIQUIDACION, PESO_ETAPA,
    VENDEDOR_ESTADO, VENDEDOR_RELACION, COMISION_MODALIDAD, COMISION_BASE,
    COMISION_ORIGEN, COMISION_ESTADO,
    normalizarColeccion, periodoDe, periodo, fecha, sumarDias, hoy,
    money, claveCliente, nuevoId,
  };
})(typeof window !== "undefined" ? window : globalThis);
