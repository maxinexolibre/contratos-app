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
  /**
   * "Anulado" no es "Rechazado": el rechazo lo decide el cliente y cuenta en la
   * tasa de aprobación; la anulación es nuestra (se reemplazó por otra versión,
   * el equipo se dio de baja, se cargó por error) y no habla de cómo vendemos.
   * Antes se registraban como rechazados y la tasa de aprobación daba peor.
   */
  const PRESUPUESTO_ESTADO = ["Borrador", "Enviado", "Aprobado", "Rechazado", "Anulado"];
  const CONTRATO_ESTADO = ["Borrador", "EnRevision", "Firmado", "Activo", "Finalizado", "Anulado"];

  /**
   * Ciclo de la propuesta comercial. Es la primera de las dos etapas: se vende
   * la idea de trabajar con Nexolibre. Recién cuando el cliente acepta se
   * redacta el contrato con cláusulas y coberturas.
   *
   * Separarlas permite medir cuántas propuestas hacen falta por cada contrato
   * y cuánto tarda una en convertirse — con un solo registro, una propuesta
   * rechazada y un contrato sin firmar eran indistinguibles.
   */
  const PROPUESTA_ESTADO = ["Borrador", "Enviada", "Aceptada", "Rechazada"];
  const CAMPANA_ESTADO = ["Planificada", "Activa", "Finalizada", "Cancelada"];
  const ESTRATEGIA_ESTADO = ["Planificada", "EnCurso", "Finalizada", "Cancelada"];
  const ESTRATEGIA_TIPO = ["Contenido", "Ads", "Influencer", "Evento"];
  const CANAL = ["Email", "Redes", "SEA", "Offline"];
  const LEAD_ESTADO = ["Nuevo", "Contactado", "Calificado", "Descartado", "Convertido"];
  const RECURRENCIA = ["unica", "mensual"];

  const VENDEDOR_ESTADO = ["Activo", "Inactivo"];
  const VENDEDOR_RELACION = ["Interno", "Externo", "Representante"];
  const COMISION_MODALIDAD = ["Porcentaje", "Escalonada", "Fija", "Mixta"];
  /**
   * Sobre qué se calcula. "Neto" es el criterio habitual de Nexolibre: el
   * valor de la venta sin IVA. Comisionar sobre el bruto pagaría comisión
   * sobre un impuesto que la empresa solo recauda para el fisco.
   */
  const COMISION_BASE = ["Neto", "Contrato", "Margen", "Cobrado"];
  /**
   * Alcance de un acuerdo. "Vendedor" es el trato con una persona;
   * "Area" es una asignación fija de la empresa (gerencia, marketing,
   * diseño, ventas) que corre sobre toda venta concretada.
   */
  const COMISION_ALCANCE = ["Vendedor", "Area"];
  const AREAS_COMISION = ["Gerencia comercial", "Marketing", "Diseño", "Ventas"];

  /**
   * Cómo entra la plata. No todo lo que se cobra se factura: hay operaciones
   * en efectivo que igual necesitan cierre formal, y sin registrarlas el
   * presupuesto queda eternamente "aprobado sin facturar".
   */
  const COMPROBANTE_TIPO = ["Factura", "Recibo", "Efectivo", "Transferencia", "NotaCredito"];

  /**
   * Tratamiento del IVA. El cliente exento y el precio con IVA incluido
   * cambian el importe final, y confundirlos factura de más o de menos.
   */
  const CONDICION_IVA = ["Gravado", "Exento", "IncluidoEnPrecio", "NoGravado"];

  /** Países donde opera Nexolibre. Todo se cotiza en USD. */
  const PAIS = ["AR", "CL", "CO", "UY", "US"];
  const PAIS_NOMBRE = {
    AR: "Argentina", CL: "Chile", CO: "Colombia", UY: "Uruguay", US: "Estados Unidos",
  };
  /**
   * Catálogo de partes y equipos a la venta. Reemplaza a la lista de
   * SharePoint que alimentaba el catálogo de nexolibre.com.
   */
  const CATALOGO_TIPO = ["Parte", "Equipo"];
  const CATALOGO_CONDICION = ["Nuevo", "Reacondicionado", "Usado", "ParaPartes"];
  /**
   * "APedido" es lo que se consigue a terceros cuando alguien lo pide (las
   * oportunidades de eBay). No es stock propio, y mezclarlos hacía que la web
   * ofreciera como disponible algo que no estaba en ningún depósito.
   */
  const CATALOGO_DISPONIBILIDAD = ["EnStock", "APedido", "Reservado", "SinStock", "Vendido", "Baja"];
  const CATALOGO_PROCEDENCIA = ["Propia", "Terceros"];
  /**
   * Lo importado de SharePoint entra "Pendiente": nadie confirmó todavía que
   * siga existiendo. Lo que se carga en la app nace "Confirmado".
   */
  const CATALOGO_AUDITORIA = ["Pendiente", "Confirmado"];

  const COMISION_ORIGEN = ["Contrato", "Presupuesto", "Facturacion"];
  const COMISION_ESTADO = ["Devengada", "Aprobada", "Liquidada", "Anulada"];
  const ROL = ["vendedor", "gerente_comercial", "gerente_administrativo", "direccion", "marketing", "admin"];

  /** Monedas de cotización. ARS/CLP solo se toleran en registros heredados. */
  const MONEDA_COTIZACION = ["USD", "UF"];
  /**
   * Un presupuesto puede salir en pesos: hay clientes que contratan y pagan en
   * ARS (mantenimientos grandes de hospitales). Es una excepción real, no un
   * resto heredado, así que no se marca como legado. Nunca se suma con USD.
   */
  const MONEDA_PRESUPUESTO = ["USD", "UF", "ARS"];
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
          pais: enumerado(r.pais, PAIS, "AR"),
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
          // Venta por intercambio: el cliente entrega la parte usada (core) y
          // rige el precio con intercambio. Sin guardar estos dos campos el
          // documento cotizaba el precio de lista y se facturaba de más.
          const intercambio = esBool(i.intercambio);
          // null significa "no se cotizó precio con intercambio". Tratarlo como
          // 0 haría que un ítem marcado como intercambio se cotice en cero.
          const unitarioIntercambio = i.unitarioIntercambio == null || i.unitarioIntercambio === ""
            ? null
            : money(i.unitarioIntercambio);
          const efectivo = intercambio && unitarioIntercambio != null ? unitarioIntercambio : unitario;
          return {
            detalle: esTexto(i.detalle || i.concepto),
            sku: esTexto(i.sku),
            cantidad,
            unitario,
            intercambio,
            unitarioIntercambio,
            total: money(cantidad * efectivo),
          };
        });
        const tipoPre = esTexto(r.tipo) || "servicio";

        // Garantía ofrecida. Aplica a la reparación y a la venta de partes:
        // son los dos casos donde el cliente recibe un trabajo o un componente
        // que puede fallar. Un abono mensual no la lleva —la cobertura ya está
        // en el contrato—, así que arranca apagada para lo recurrente.
        const g = r.garantia || {};
        const garantia = {
          aplica: g.aplica === undefined
            ? (tipoPre === "servicio" || tipoPre === "venta")
            : esBool(g.aplica),
          dias: esNumero(g.dias, 90),
          // Permite pisar el texto estándar en un caso puntual sin tocar código.
          texto: esTexto(g.texto),
        };

        const eco = r.economico || {};
        const moneda = esTexto(eco.moneda) || "USD";
        const descuentoPct = esNumero(eco.descuentoPct);
        const recurrencia = enumerado(eco.recurrencia, RECURRENCIA, "unica");
        const ivaPct = esNumero(eco.ivaPct, 21);
        const incluyeIVA = esBool(eco.incluyeIVA);

        const subtotal = money(items.reduce((s, i) => s + i.total, 0));
        const total = money(subtotal * (1 - descuentoPct / 100));
        // Valor neto: la base habitual de comisiones. Si el precio ya incluye
        // IVA hay que sacarlo, porque ese impuesto no es ingreso de la empresa.
        const neto = incluyeIVA ? money(total / (1 + ivaPct / 100)) : total;
        const validezDias = esNumero(eco.validezDias, 15);
        const f = fecha(r.fecha) || hoy();
        const estado = enumerado(r.estado, PRESUPUESTO_ESTADO, "Borrador");

        return {
          id: esTexto(r.id) || nuevoId("pre_"),
          numero: esTexto(r.numero),
          ticketId: esTexto(r.ticketId),
          fecha: f,
          validezDias,
          vence: sumarDias(f, validezDias),
          tipo: tipoPre,
          subtipo: esTexto(r.subtipo),
          titulo: esTexto(r.titulo),
          clienteId: esTexto(r.clienteId),
          // País de origen de la cotización. Define en qué moneda se factura:
          // se cotiza siempre en USD y se convierte recién al emitir.
          pais: enumerado(r.pais, PAIS, "AR"),
          // Cómo se factura este presupuesto. El cliente exento y el precio
          // con IVA incluido dan importes distintos: asumir "gravado" para
          // todos factura de más a unos y de menos a otros.
          condicionIVA: enumerado(r.condicionIVA, CONDICION_IVA,
            esBool(r.economico?.incluyeIVA) ? "IncluidoEnPrecio" : "Gravado"),
          estado,
          // Se conserva el estado tal como lo llevaba el usuario en su planilla.
          estadoOrigen: esTexto(r.estadoOrigen),
          items,
          garantia,
          economico: {
            moneda,
            recurrencia,
            descuentoPct,
            validezDias,
            ivaPct,
            incluyeIVA,
            formaPago: esTexto(eco.formaPago),
          },
          subtotal,
          total,
          neto,
          // Los importes se guardan calculados, no se recalculan al leer:
          // un presupuesto aprobado no puede cambiar de monto solo.
          esLegado: !MONEDA_PRESUPUESTO.includes(moneda),
          // Quién lo vendió. Vacío = venta directa de la dirección: no paga
          // comisión de vendedor (sí la del área comercial, según el cliente).
          vendedorId: esTexto(r.vendedorId),
          // Por qué se anuló: sin esto, un anulado y un rechazado vuelven a
          // verse iguales a los seis meses.
          motivoAnulacion: estado === "Anulado" ? esTexto(r.motivoAnulacion) : "",
          // Fecha en que salió al cliente. Distinta de `fecha` (emisión): el
          // seguimiento se mide desde el envío.
          fechaEnvio: fecha(r.fechaEnvio),
          hash: esTexto(r.hash),
          notas: esTexto(r.notas),
          archivos: esLista(r.archivos),
          historialEstados: esLista(r.historialEstados),
          usuario: esTexto(r.usuario),
        };
      },
    },

    /**
     * Propuesta comercial: la primera de las dos etapas del contrato.
     *
     * Lleva el plan, los equipos alcanzados, la cobertura ofrecida y el canon
     * propuesto — todo lo que hace falta para que el cliente decida— pero NO
     * las cláusulas legales. Esas viven en el contrato, que se redacta recién
     * cuando la propuesta se acepta.
     */
    propuestas: {
      archivo: "propuestas",
      particionado: false,
      idPrefijo: "prop_",
      normalizar(r) {
        const estado = enumerado(r.estado, PROPUESTA_ESTADO, "Borrador");
        return {
          id: esTexto(r.id) || nuevoId("prop_"),
          numero: esTexto(r.numero),
          // Número con el que circuló antes de la serie PR-. Se conserva para
          // poder reconciliar contra los documentos ya enviados al cliente.
          numeroLegado: esTexto(r.numeroLegado),
          clienteId: esTexto(r.clienteId),
          pais: enumerado(r.pais, PAIS, "AR"),
          ticketId: esTexto(r.ticketId) || null,
          estado,
          // Contrato al que dio lugar. Null mientras no se haya generado.
          contratoId: esTexto(r.contratoId) || null,
          fechas: {
            creado: fecha(r.fechas?.creado) || hoy(),
            enviado: fecha(r.fechas?.enviado),
            resuelto: fecha(r.fechas?.resuelto),
          },
          validezDias: esNumero(r.validezDias, 30),
          motivoRechazo: estado === "Rechazada" ? esTexto(r.motivoRechazo) : "",
          // Lo que se le ofrece al cliente
          plan: r.plan || {},
          equipos: esLista(r.equipos),
          cobertura: r.cobertura || {},
          economico: {
            canonMensual: money(r.economico?.canonMensual),
            moneda: esTexto(r.economico?.moneda) || "USD",
            ivaPct: esNumero(r.economico?.ivaPct, 21),
            incluyeIVA: esBool(r.economico?.incluyeIVA),
            formaPago: esTexto(r.economico?.formaPago),
          },
          vigenciaPropuesta: {
            meses: esNumero(r.vigenciaPropuesta?.meses, 12),
            inicioEstimado: fecha(r.vigenciaPropuesta?.inicioEstimado),
          },
          /**
           * Marca los registros que vienen del esquema anterior, donde una
           * misma ficha hacía de propuesta y de contrato. Estos quedaron
           * aceptados y operando sin que se redactara nunca el contrato: no se
           * les inventa un documento que no existió, se los deja visibles como
           * lo que son.
           */
          esquemaAnterior: esBool(r.esquemaAnterior),
          archivos: esLista(r.archivos),
          notas: esTexto(r.notas),
          historialEstados: esLista(r.historialEstados),
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
          // País de la operación. Define la moneda de facturación y qué
          // acuerdos de área del reparto interno le corresponden.
          pais: enumerado(r.pais, PAIS, "AR"),
          // Propuesta comercial que le dio origen. Null en los contratos que
          // se negociaron directo, sin propuesta previa.
          propuestaId: esTexto(r.propuestaId) || null,
          ticketId: origen === "comercial" ? esTexto(r.ticketId) : null,
          presupuestoId: origen === "comercial" ? esTexto(r.presupuestoId) : null,
          hashPresupuesto: esTexto(r.hashPresupuesto),
          estado,
          tipo: esTexto(r.tipo) || "contrato",
          fechaFirma: fecha(r.fechaFirma),
          // Las tres fechas del ciclo del documento. `fechaFirma` es la que
          // usan las reglas, pero creado y enviado también son datos reales
          // del registro: perderlos en la migración sería destruir información.
          fechas: {
            creado: fecha(r.fechas?.creado),
            enviado: fecha(r.fechas?.enviado),
            firmado: fecha(r.fechas?.firmado) || fecha(r.fechaFirma),
          },
          // Desviaciones negociadas respecto del texto base del contrato.
          negociacion: r.negociacion || { desviaciones: [] },
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
          pais: enumerado(r.pais, PAIS, "AR"),
          // Un cobro en efectivo no tiene número de factura pero sí cierra la
          // operación. Sin registrarlo, el presupuesto queda para siempre
          // "aprobado sin facturar" y ensucia todos los pendientes.
          // Período que se está cobrando. En un abono mensual hay un cobro por
          // mes: sin este campo, el primero daba la operación por cerrada y el
          // mes siguiente no quedaba nada por cobrar.
          periodoCobrado: esTexto(r.periodoCobrado) ||
            (fecha(r.fechaEmision) || hoy()).slice(0, 7),
          tipoComprobante: enumerado(r.tipoComprobante, COMPROBANTE_TIPO, "Factura"),
          condicionIVA: enumerado(r.condicionIVA, CONDICION_IVA, "Gravado"),
          ivaPct: esNumero(r.ivaPct, 21),
          montoIVA: money(r.montoIVA),
          montoNeto: money(r.montoNeto),
          // Equivalente en UF al emitir. Solo Chile; informativo.
          referenciaUF: r.referenciaUF === null || r.referenciaUF === undefined
            ? null : money(r.referenciaUF),
          monedaCotizacion: esTexto(r.monedaCotizacion) || "USD",
          montoCotizado: money(r.montoCotizado),
          // El tipo de cambio queda congelado acá. Sin esto no se puede
          // reconstruir por qué se facturó ese importe.
          tcUnidad: esTexto(r.tcUnidad),
          tcValor: esNumero(r.tcValor),
          tcFecha: fecha(r.tcFecha),
          tcFuente: esTexto(r.tcFuente),
          monedaLiquidacion: esTexto(r.monedaLiquidacion) || "ARS",
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

        const alcance = enumerado(r.alcance, COMISION_ALCANCE, "Vendedor");
        return {
          id: esTexto(r.id) || nuevoId("acu_"),
          alcance,
          // Un acuerdo de área no cuelga de una persona: corre sobre toda venta
          // concretada en los países que alcanza.
          vendedorId: alcance === "Vendedor" ? esTexto(r.vendedorId) : null,
          area: alcance === "Area" ? esTexto(r.area) : "",
          // Países alcanzados. Vacío = todos.
          paises: esLista(r.paises).filter((p) => PAIS.includes(p)),
          nombre: esTexto(r.nombre),
          modalidad,
          base: enumerado(r.base, COMISION_BASE, "Neto"),
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
        const alcance = enumerado(r.alcance, COMISION_ALCANCE, "Vendedor");
        return {
          id: esTexto(r.id) || nuevoId("com_"),
          alcance,
          // Las de área no corresponden a una persona sino a un equipo.
          vendedorId: alcance === "Vendedor" ? esTexto(r.vendedorId) : null,
          area: alcance === "Area" ? esTexto(r.area) : "",
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

    /**
     * Ítem del catálogo: una parte o un equipo a la venta.
     *
     * Mezcla a propósito datos públicos y privados en el mismo registro, porque
     * se cargan juntos. Lo que sale a la web lo decide una lista blanca en
     * nucleo/catalogo.js (`aParts`), nunca este esquema: un campo nuevo acá no
     * se publica hasta que alguien lo agrega allá a conciencia.
     */
    catalogo: {
      archivo: "catalogo",
      particionado: false,
      idPrefijo: "cat_",
      normalizar(r) {
        const disponibilidad = enumerado(r.disponibilidad, CATALOGO_DISPONIBILIDAD, "EnStock");
        const au = r.auditoria || {};
        return {
          id: esTexto(r.id) || nuevoId("cat_"),
          // Referencia pública (NX-AR-001). Es la clave que usan la web, el
          // link de WhatsApp y el SKU de DOTmed: no cambia una vez publicada.
          ref: esTexto(r.ref).trim().toUpperCase(),
          tipo: enumerado(r.tipo, CATALOGO_TIPO, "Parte"),

          // ---- públicos ----
          nombre: esTexto(r.nombre).trim(),
          categoria: esTexto(r.categoria).trim(),
          modalidad: esTexto(r.modalidad).trim(),
          marca: esTexto(r.marca).trim(),
          modeloCompatible: esTexto(r.modeloCompatible).trim(),
          nroParte: esTexto(r.nroParte).trim(),
          condicion: enumerado(r.condicion, CATALOGO_CONDICION, "Usado"),
          disponibilidad,
          pais: enumerado(r.pais, PAIS, "AR"),
          // null = sin garantía informada. No es lo mismo que 0 días.
          garantiaDias: r.garantiaDias == null || r.garantiaDias === "" ? null : esNumero(r.garantiaDias),
          // null = "Consultar". money(null) daría 0, que en la web se leería
          // como gratis: por eso el == null antes de convertir.
          precio: r.precio == null || r.precio === "" ? null : money(r.precio),
          moneda: enumerado(r.moneda, MONEDA_COTIZACION, "USD"),
          descripcion: esTexto(r.descripcion).trim(),
          // Cada foto es un archivo (NX-AR-001-1.jpg) o una URL externa.
          // `publicada` dice si ya está en assets/parts/ de la web; las que no,
          // esperan en el repo privado hasta que se publique.
          fotos: esLista(r.fotos).map((f) => (typeof f === "string"
            ? { archivo: f, publicada: true }
            : { archivo: esTexto(f?.archivo), publicada: esBool(f?.publicada) }))
            .filter((f) => f.archivo),
          publicarWeb: esBool(r.publicarWeb, true),
          // Canales externos: quedan apagados mientras los bots están en stand-by.
          canales: {
            dotmed: esBool(r.canales?.dotmed),
            ebay: esBool(r.canales?.ebay),
          },

          // ---- privados: nunca salen de la app ----
          procedencia: enumerado(r.procedencia, CATALOGO_PROCEDENCIA, "Propia"),
          proveedor: esTexto(r.proveedor),
          origenUrl: esTexto(r.origenUrl),
          costo: r.costo == null || r.costo === "" ? null : money(r.costo),
          nroSerie: esTexto(r.nroSerie),
          codigoInterno: esTexto(r.codigoInterno),
          ubicacionFisica: esTexto(r.ubicacionFisica),
          presupuestoId: esTexto(r.presupuestoId) || null,
          notas: esTexto(r.notas),

          auditoria: {
            estado: enumerado(au.estado, CATALOGO_AUDITORIA, "Confirmado"),
            fecha: fecha(au.fecha),
            usuario: esTexto(au.usuario),
          },
          // De dónde vino el registro: "app" o "sharepoint" (importación inicial).
          origen: esTexto(r.origen) || "app",
          creado: fecha(r.creado) || hoy(),
          actualizado: fecha(r.actualizado) || fecha(r.creado) || hoy(),
          usuario: esTexto(r.usuario),
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
    PROPUESTA_ESTADO,
    RECURRENCIA, ROL, MONEDA_COTIZACION, MONEDA_PRESUPUESTO, MONEDA_LIQUIDACION, PESO_ETAPA,
    VENDEDOR_ESTADO, VENDEDOR_RELACION, COMISION_MODALIDAD, COMISION_BASE,
    COMISION_ORIGEN, COMISION_ESTADO, COMISION_ALCANCE, AREAS_COMISION,
    PAIS, PAIS_NOMBRE, COMPROBANTE_TIPO, CONDICION_IVA,
    CATALOGO_TIPO, CATALOGO_CONDICION, CATALOGO_DISPONIBILIDAD, CATALOGO_PROCEDENCIA,
    CATALOGO_AUDITORIA,
    normalizarColeccion, periodoDe, periodo, fecha, sumarDias, hoy,
    money, claveCliente, nuevoId,
  };
})(typeof window !== "undefined" ? window : globalThis);
