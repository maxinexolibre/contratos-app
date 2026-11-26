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

  /**
   * Segmento del decisor al que apunta el lead. La misma institución se trabaja
   * distinto según a quién le hablamos: al de mantenimiento se le muestra el
   * laboratorio; al director médico, cobertura y riesgo defendible. Vacío
   * mientras no se definió a quién se apunta.
   */
  const SEGMENTO = ["DirectorMedico", "IngenieriaClinica", "GerenteGeneral", "Radiologo"];
  const SEGMENTO_NOMBRE = {
    DirectorMedico: "Director médico / Jefe de imágenes",
    IngenieriaClinica: "Ingeniería clínica / Mantenimiento",
    GerenteGeneral: "Gerente general / Dirección",
    Radiologo: "Radiólogo / Jefe de informes",
  };

  /**
   * Cadencia de recontacto de una secuencia de prospección. `gapDias[i]` son los
   * días a esperar desde el toque i hasta el i+1; `gapDias[0] = 0` hace que el
   * primer toque venza apenas se da de alta el lead. Cuatro toques en total
   * (0 · +4 · +11 · +21 días); el cuarto es el cierre ("breakup"). Agotada la
   * secuencia, no hay próximo toque y el lead espera respuesta o se descarta.
   */
  const CADENCIA = { toques: 4, gapDias: [0, 4, 7, 10] };
  const TOQUE_CANAL = ["Email", "Llamada", "LinkedIn", "WhatsApp", "Visita"];

  /**
   * Fecha del próximo toque dado cuántos ya se dieron.
   * @param {number} paso   toques ya registrados (0 = ninguno).
   * @param {string} desde  fecha base; por defecto hoy.
   * @returns {string|null} AAAA-MM-DD, o null si la secuencia se agotó.
   */
  function proximoToque(paso, desde) {
    const p = esNumero(paso);
    if (p < 0 || p >= CADENCIA.gapDias.length) return null;
    return sumarDias(fecha(desde) || hoy(), CADENCIA.gapDias[p]);
  }

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
  /**
   * Seguimiento de comisiones por operación. Lo que se guarda es la DECISIÓN
   * (lleva o no, quién cobra, con qué porcentaje) y los pagos; el estado de
   * cada comisión se deduce de la operación y de la facturación. Guardarlo
   * aparte obligaba a alguien a acordarse de "devengar" a mano en cada firma,
   * y por eso nadie lo hacía.
   */
  const MARCA_ORIGEN = ["Presupuesto", "Propuesta"];
  /**
   * Por qué una operación lleva o no comisión. "Consulta" es el cliente que
   * tuvo algo aislado hace años: la app no decide sola, pregunta.
   */
  const MARCA_CRITERIO = ["ClienteNuevo", "ClienteExistente", "Consulta", "Historico"];
  /** Estados de una comisión, en el orden en que avanzan. */
  const COMISION_SEGUIMIENTO = ["Prevista", "Devengada", "ACobrar", "Pagada", "Anulada"];
  const PAGO_TIPO = ["Pago", "Compensacion", "Ajuste"];
  /** La comisión se paga en dólares (efectivo) o en pesos al TC de la factura. */
  const PAGO_MONEDA = ["USD", "ARS"];
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


  // --------------------------------------------------------------------------
  // Canon por tramos y equipos que entran más adelante
  // --------------------------------------------------------------------------

  /**
   * Tramos de canon: períodos en los que se factura algo distinto del canon
   * pactado. Caso típico: uno de los equipos sigue en garantía del fabricante
   * y entra al contrato recién cuando vence, así que hasta entonces se cobra
   * menos. `canonMensual` sigue siendo el canon pleno acordado; el tramo dice
   * cuánto se cobra mientras dura. `desde` o `hasta` vacíos = sin límite.
   */
  function normalizarTramos(v) {
    return esLista(v).map((t) => ({
      desde: fecha(t?.desde),
      hasta: fecha(t?.hasta),
      // Se admite 0 (período bonificado), pero no un tramo sin importe:
      // money(null) daría 0 y un tramo sin cargar se leería como "gratis".
      canonMensual: t?.canonMensual == null || t.canonMensual === "" ? null : money(t.canonMensual),
      motivo: esTexto(t?.motivo),
    })).filter((t) => t.canonMensual !== null && (t.desde || t.hasta))
      .sort((a, b) => String(a.desde || "").localeCompare(String(b.desde || "")));
  }

  /** Tramo que rige en una fecha, o null si rige el canon pleno. */
  function tramoVigente(registro, f = hoy()) {
    return normalizarTramos(registro?.economico?.tramos)
      .find((t) => (!t.desde || t.desde <= f) && (!t.hasta || f <= t.hasta)) || null;
  }

  /** Lo que se factura por mes en una fecha dada. */
  function canonVigente(registro, f = hoy()) {
    const t = tramoVigente(registro, f);
    return t ? t.canonMensual : money(registro?.economico?.canonMensual);
  }

  /**
   * Vida de un equipo dentro de un contrato que no se reescribe. Un contrato
   * de varios equipos rara vez termina como empezó: uno pasa al post venta del
   * fabricante y se da de baja, otro queda en pausa meses porque el cliente no
   * aprueba una reparación, después se reanuda. Antes eso no quedaba en ningún
   * lado: el contrato seguía diciendo cuatro equipos cuando quedaba uno.
   *
   * Cada cambio es un evento con fecha y motivo; el estado no se guarda, se
   * calcula reproduciendo los eventos (igual que las comisiones).
   */
  const EVENTO_EQUIPO = ["Baja", "Pausa", "Reanudacion"];
  const FACTURACION_CONTRATO = ["ConFactura", "SinFactura"];
  const FACTURACION_LABEL = { ConFactura: "Con factura", SinFactura: "Sin factura" };
  const EVENTO_EQUIPO_LABEL = { Baja: "Baja", Pausa: "Pausa", Reanudacion: "Reanudación" };

  function normalizarEventosEquipo(v) {
    return esLista(v).map((ev) => ({
      fecha: fecha(ev?.fecha),
      tipo: enumerado(ev?.tipo, EVENTO_EQUIPO, null),
      motivo: esTexto(ev?.motivo),
      usuario: esTexto(ev?.usuario),
      // Canon del contrato antes y después del cambio, si se modificó.
      // null = el canon no se tocó (no es lo mismo que pasar a 0).
      canonAntes: ev?.canonAntes == null || ev.canonAntes === "" ? null : money(ev.canonAntes),
      canonDespues: ev?.canonDespues == null || ev.canonDespues === "" ? null : money(ev.canonDespues),
      registrado: fecha(ev?.registrado),
    })).filter((ev) => ev.fecha && ev.tipo)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  /** "Activo" | "PorIngresar" | "Pausado" | "Baja" en una fecha. */
  function estadoEquipo(equipo, f = hoy()) {
    const ing = fecha(equipo?.ingreso);
    let est = ing && ing > f ? "PorIngresar" : "Activo";
    for (const ev of normalizarEventosEquipo(equipo?.eventos)) {
      if (ev.fecha > f) break;
      est = ev.tipo === "Baja" ? "Baja" : ev.tipo === "Pausa" ? "Pausado" : "Activo";
    }
    return est;
  }

  /**
   * Por qué no se puede registrar un evento, o "" si se puede. Los eventos van
   * en orden: registrar uno con fecha anterior al último reescribiría la
   * historia que ya se usó para facturar.
   */
  function motivoNoEvento(equipo, tipo, f) {
    if (!EVENTO_EQUIPO.includes(tipo)) return "Tipo de movimiento desconocido";
    if (!fecha(f)) return "Falta la fecha";
    const evs = normalizarEventosEquipo(equipo?.eventos);
    const ult = evs[evs.length - 1];
    if (ult && f < ult.fecha) return `El último movimiento del equipo es del ${ult.fecha}: no se puede registrar uno anterior`;
    const est = estadoEquipo(equipo, f);
    if (est === "Baja") return "El equipo ya está dado de baja";
    if (tipo === "Pausa" && est !== "Activo") return est === "Pausado" ? "El equipo ya está en pausa" : "El equipo todavía no entró al contrato";
    if (tipo === "Reanudacion" && est !== "Pausado") return "Solo se reanuda un equipo en pausa";
    return "";
  }

  /** Días que lleva en pausa un equipo, o null si no está pausado. */
  function diasEnPausa(equipo, f = hoy()) {
    if (estadoEquipo(equipo, f) !== "Pausado") return null;
    const p = normalizarEventosEquipo(equipo?.eventos).filter((ev) => ev.tipo === "Pausa" && ev.fecha <= f).pop();
    return p ? Math.round((Date.parse(f) - Date.parse(p.fecha)) / 86400000) : null;
  }

  /**
   * Un equipo está cubierto si entró al contrato y no está en pausa ni de
   * baja: hasta su ingreso, durante una pausa o después de la baja no se le
   * debe servicio ni se cuenta en la flota.
   */
  function equipoCubierto(equipo, f = hoy()) {
    return estadoEquipo(equipo, f) === "Activo";
  }

  /**
   * Aplica un ajuste de canon en una fecha. `nuevo` es lo que se va a
   * facturar desde esa fecha: si rige un tramo reducido, es el tramo el que se
   * ajusta, y el pleno y los demás tramos que siguen corriendo suben en la
   * misma proporción. Antes se tomaba siempre el pleno como base y un
   * contrato que pagaba 4M por un tramo se ajustaba sobre 4,8M.
   */
  function ajustarCanon(registro, f, nuevo) {
    const eco = registro?.economico || {};
    const anterior = canonVigente(registro, f);
    const factor = anterior > 0 ? Number(nuevo) / anterior : 1;
    const plenoAnterior = money(eco.canonMensual);
    const vig = tramoVigente(registro, f);
    const plenoNuevo = vig ? money(plenoAnterior * factor) : money(nuevo);
    const tramos = normalizarTramos(eco.tramos).map((t) => {
      if (vig && t.desde === vig.desde && t.hasta === vig.hasta) return { ...t, canonMensual: money(nuevo) };
      return (!t.hasta || t.hasta >= f) ? { ...t, canonMensual: money(t.canonMensual * factor) } : t;
    });
    return { economico: { ...eco, canonMensual: plenoNuevo, tramos }, anterior, nuevo: money(nuevo),
      plenoAnterior, plenoNuevo, enTramo: !!vig, factor };
  }

  /**
   * Ajuste que se puede deshacer: solo el último del historial, y solo si es
   * un ajuste de canon (no una baja de equipo ni una regularización) y nada
   * cambió el canon después. Deshacer uno del medio dejaría los posteriores
   * calculados sobre una base que ya no existe.
   */
  function ajusteDeshacible(registro) {
    const hist = esLista(registro?.ajuste?.historial);
    const h = hist[hist.length - 1];
    if (!h) return { ok: false, motivo: "No hay ajustes registrados." };
    if (h.origen && h.origen !== "ajuste") return { ok: false, motivo: "El último movimiento no es un ajuste." };
    if (!h.origen && (!(Number(h.canonAnterior) > 0) || /^baja de /.test(h.nota || "")))
      return { ok: false, motivo: "El último movimiento no es un ajuste: es una baja de equipo o una regularización." };
    if (Math.abs(canonVigente(registro, h.fecha) - money(h.canonNuevo)) > 0.01)
      return { ok: false, motivo: "El canon cambió después de ese ajuste; corregilo a mano desde Editar." };
    return { ok: true, entrada: h, indice: hist.length - 1 };
  }

  /**
   * Vuelve `economico` a como estaba antes del último ajuste. Los ajustes
   * nuevos guardan una foto (`economicoAntes`); los anteriores a eso se
   * revierten dividiendo por el mismo factor, que es la inversa exacta de
   * ajustarCanon salvo centavos de redondeo.
   */
  function deshacerAjuste(registro) {
    const d = ajusteDeshacible(registro);
    if (!d.ok) return d;
    const h = d.entrada;
    const eco = registro.economico || {};
    let economico;
    if (h.economicoAntes) {
      economico = { ...eco, canonMensual: money(h.economicoAntes.canonMensual), tramos: normalizarTramos(h.economicoAntes.tramos) };
    } else {
      const factor = money(h.canonNuevo) / money(h.canonAnterior);
      const vig = tramoVigente(registro, h.fecha);
      const tramos = normalizarTramos(eco.tramos).map((t) => {
        if (vig && t.desde === vig.desde && t.hasta === vig.hasta) return { ...t, canonMensual: money(h.canonAnterior) };
        return (!t.hasta || t.hasta >= h.fecha) ? { ...t, canonMensual: money(t.canonMensual / factor) } : t;
      });
      economico = { ...eco, canonMensual: vig ? money(money(eco.canonMensual) / factor) : money(h.canonAnterior), tramos };
    }
    const historial = esLista(registro.ajuste?.historial).slice(0, d.indice);
    return { ok: true, economico, historial, deshecho: h };
  }

  /** Equipos con servicio vigente en una fecha. */
  function equiposActivos(registro, f = hoy()) {
    return esLista(registro?.equipos).filter((e) => equipoCubierto(e, f));
  }

  /** Equipos que entran después de una fecha (los "pendientes de toma"). */
  function equiposPorIngresar(registro, f = hoy()) {
    return esLista(registro?.equipos).filter((e) => estadoEquipo(e, f) === "PorIngresar");
  }

  /**
   * Una versión de la negociación de una propuesta. Guarda las condiciones
   * tal como salieron al cliente en esa vuelta: si después se edita la
   * propuesta, lo que se mandó antes no se pierde.
   */
  function normalizarVersion(v) {
    return {
      n: esNumero(v?.n, 1),
      creado: fecha(v?.creado),
      enviado: fecha(v?.enviado),
      cerrado: fecha(v?.cerrado),
      usuario: esTexto(v?.usuario),
      // Qué pidió el cliente o qué cambió para la vuelta siguiente.
      motivo: esTexto(v?.motivo),
      economico: v?.economico || {},
      equipos: esLista(v?.equipos),
      plan: v?.plan || {},
      cobertura: v?.cobertura || {},
      vigenciaPropuesta: v?.vigenciaPropuesta || {},
      validezDias: v?.validezDias == null ? null : esNumero(v.validezDias),
      notas: esTexto(v?.notas),
    };
  }

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
          // Grupo al que pertenece (una red de sedes o un prestador con
          // varios hospitales) y nombre de la sede. Texto y no id: un grupo no
          // tiene datos propios, es solo cómo se suman sus sedes en reportes.
          grupo: esTexto(r.grupo),
          sede: esTexto(r.sede),
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
          // Quién trajo el lead (id de vendedor). Vacío = propio de Nexo. De
          // esto depende la comisión de un externo: si no está asignado acá,
          // nadie puede agregarlo después a mano en el presupuesto.
          traidoPor: esTexto(r.traidoPor) || null,
          // Quién lo asignó y cuándo: una comisión de un externo tiene que
          // poder rastrearse hasta una decisión con nombre y fecha.
          traidoPorAsignacion: r.traidoPorAsignacion?.fecha
            ? { por: esTexto(r.traidoPorAsignacion.por), fecha: fecha(r.traidoPorAsignacion.fecha) }
            : null,
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
            // Primer envío. Con renegociaciones no se pisa: es el que mide
            // cuánto tardó la propuesta en convertirse.
            enviado: fecha(r.fechas?.enviado),
            // Envío de la versión vigente.
            ultimoEnvio: fecha(r.fechas?.ultimoEnvio) || fecha(r.fechas?.enviado),
            resuelto: fecha(r.fechas?.resuelto),
          },
          // Vuelta de la negociación en la que está la propuesta. Antes cada
          // contraoferta obligaba a hacer una propuesta nueva y el historial
          // quedaba repartido en varias fichas sin vínculo entre sí.
          version: Math.max(1, esNumero(r.version, 1)),
          // Versiones anteriores, congeladas como salieron al cliente.
          versiones: esLista(r.versiones).map(normalizarVersion),
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
            // Precio de lista del programa, para mostrar la condición
            // especial contra él. `null` = no se muestra; money(null) daría 0,
            // que en el documento se leería como "valor de referencia: gratis".
            valorReferencia: r.economico?.valorReferencia == null || r.economico.valorReferencia === ""
              ? null : money(r.economico.valorReferencia),
            // Cómo se ajusta el canon, en el texto que lee el cliente.
            ajuste: esTexto(r.economico?.ajuste),
            tramos: normalizarTramos(r.economico?.tramos),
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
            // Sin propagarlo acá, el tramo se perdía al guardar: el esquema
            // arma `economico` campo por campo (ver "campo anidado sin
            // propagar" en CLAUDE.md).
            tramos: normalizarTramos(r.economico?.tramos),
            // Si el canon se cobra con factura o no. Es dato interno: no se
            // imprime en el documento del cliente. Sirve para leer la cartera
            // separada, que hasta ahora se mezclaba en un solo número.
            facturacion: enumerado(r.economico?.facturacion, FACTURACION_CONTRATO, "ConFactura"),
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
        // La institución es el ancla del prospecto: existe desde antes de
        // conocer a la persona. Si no vino nombre de contacto, la institución
        // hace de nombre para que el lead sea legible igual.
        const institucion = esTexto(r.institucion);
        const historialToques = esLista(r.historialToques).map((t) => ({
          fecha: fecha(t.fecha) || hoy(),
          paso: esNumero(t.paso),
          canal: enumerado(t.canal, TOQUE_CANAL, "Email"),
          nota: esTexto(t.nota),
          resultado: esTexto(t.resultado),
        }));
        // El paso es la cantidad de toques efectivamente dados: nunca menos que
        // el largo del historial, para que no se desincronicen.
        const paso = Math.max(esNumero(r.paso), historialToques.length);
        return {
          id: esTexto(r.id) || nuevoId("led_"),
          campanaId: esTexto(r.campanaId) || null,
          estrategiaId: esTexto(r.estrategiaId) || null,
          // El canal vive en el lead, no en la campaña: una campaña multicanal
          // no permite atribuir el costo por lead sin este dato.
          canal: enumerado(r.canal, CANAL, "Offline"),
          origenDetalle: esTexto(r.origenDetalle),
          fechaCaptura: fecha(r.fechaCaptura) || hoy(),
          contactoNombre: esTexto(r.contactoNombre) || institucion,
          contactoEmail: esTexto(r.contactoEmail).toLowerCase(),
          contactoTel: esTexto(r.contactoTel),
          institucion,
          sitioWeb: esTexto(r.sitioWeb),
          tier: esTexto(r.tier),
          segmento: enumerado(r.segmento, SEGMENTO, ""),
          pais: esTexto(r.pais) || "AR",
          clienteId: esTexto(r.clienteId) || null,
          ticketId: esTexto(r.ticketId) || null,
          estado,
          // Capa de secuencia de prospección. Un prospecto recién sembrado
          // tiene paso 0 y vence hoy: entra en "esta semana" desde el día uno.
          paso,
          fechaUltimoToque: historialToques.length
            ? historialToques[historialToques.length - 1].fecha
            : fecha(r.fechaUltimoToque),
          // Si no vino próximo toque, se deriva de la cadencia. Un lead ya
          // respondido (Calificado/Convertido/Descartado) sale de la secuencia.
          proximoToque: ["Calificado", "Convertido", "Descartado"].includes(estado)
            ? null
            : (fecha(r.proximoToque) || proximoToque(paso, historialToques.length
                ? historialToques[historialToques.length - 1].fecha
                : r.fechaCaptura)),
          historialToques,
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
     * Índices de precios para sugerir ajustes de canon: un registro por índice
     * y por mes, con la variación mensual en %. Se guarda la variación y no el
     * nivel porque es lo que publica INDEC y lo que se carga a mano sin errores
     * de base.
     */
    indices: {
      archivo: "indices",
      particionado: false,
      idPrefijo: "ix_",
      normalizar(r) {
        const mes = /^\d{4}-\d{2}/.test(esTexto(r.mes)) ? esTexto(r.mes).slice(0, 7) : "";
        return {
          id: esTexto(r.id) || `ix_${esTexto(r.indice)}_${mes}`,
          indice: esTexto(r.indice),
          mes,
          // Mes sin dato: null, no 0. Un 0% es "no hubo inflación".
          variacion: r.variacion == null || r.variacion === "" ? null : esNumero(r.variacion),
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
          // Parte del reparto del área comercial que cobra esta persona
          // ("Gerencia comercial", "Diseño", "Marketing"). Vacío = ninguna.
          areaComision: esTexto(r.areaComision),
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

    /**
     * Comisión de una operación: la decisión tomada al enviar el presupuesto
     * o la propuesta, más los pagos. Una por operación.
     *
     * No guarda montos ni estados: se calculan contra la operación cada vez.
     * Si el presupuesto se edita antes de aprobarse, la comisión acompaña sin
     * que nadie tenga que recalcular nada.
     */
    marcasComision: {
      archivo: "marcas-comision",
      particionado: false,
      idPrefijo: "mco_",
      normalizar(r) {
        const ext = r.externo || {};
        return {
          id: esTexto(r.id) || nuevoId("mco_"),
          origenTipo: enumerado(r.origenTipo, MARCA_ORIGEN, "Presupuesto"),
          origenId: esTexto(r.origenId),
          origenNumero: esTexto(r.origenNumero),
          clienteId: esTexto(r.clienteId),
          lleva: esBool(r.lleva),
          criterio: enumerado(r.criterio, MARCA_CRITERIO, "Consulta"),
          // Por qué se decidió así. Obligatorio cuando la decisión va contra
          // lo que dice la historia del cliente o cuando hubo que preguntar.
          motivo: esTexto(r.motivo),
          // Primera actividad del cliente con Nexo, tal como se vio al decidir.
          primeraActividad: fecha(r.primeraActividad),
          externo: esTexto(ext.vendedorId)
            ? { vendedorId: esTexto(ext.vendedorId), porcentaje: esNumero(ext.porcentaje) }
            : null,
          // El 4,5% del área comercial. Sigue a `lleva` salvo decisión explícita.
          area: r.area === undefined ? esBool(r.lleva) : esBool(r.area),
          // null = la base sale de la operación. money(null) daría 0, que
          // dejaría la comisión en cero sin que nadie lo note.
          baseManual: r.baseManual == null || r.baseManual === "" ? null : money(r.baseManual),
          // Costos que se descuentan antes de calcular (venta de equipo: parte,
          // flete, importación). null = no se cargaron.
          costos: r.costos == null || r.costos === "" ? null : money(r.costos),
          // Los costos se pagan casi siempre en pesos (viáticos, flete local)
          // aunque la operación se cotice en USD. null = en la moneda de la
          // operación, como se cargaba antes.
          costosMoneda: r.costosMoneda == null ? null : enumerado(r.costosMoneda, PAGO_MONEDA, null),
          // Pesos por dólar para pasar los costos a la moneda de la operación.
          // null = se usa el TC de la factura al cliente, que es el que pesificó
          // la venta (Maxi, 2026-11-24).
          costosTC: r.costosTC == null || r.costosTC === "" ? null : esNumero(r.costosTC, null),
          // Cargada después de los hechos (operaciones anteriores al seguimiento).
          historico: esBool(r.historico),
          pagos: esLista(r.pagos).map((p) => {
            const monedaPago = enumerado(p.monedaPago, PAGO_MONEDA, "USD");
            return {
              beneficiario: esTexto(p.beneficiario),
              // A quién se le pagó, con nombre: la parte del reparto puede
              // cambiar de persona y el pago tiene que seguir explicándose.
              beneficiarioNombre: esTexto(p.beneficiarioNombre),
              // Pago: plata que sale. Compensacion: se descuenta de un saldo
              // pagado de más en otra operación. Ajuste: corrección con motivo
              // (la única que puede ser negativa).
              tipo: enumerado(p.tipo, PAGO_TIPO, "Pago"),
              fecha: fecha(p.fecha) || hoy(),
              // En la moneda de la comisión (la de la operación).
              monto: money(p.monto),
              moneda: esTexto(p.moneda) || "USD",
              // Cómo se pagó de verdad: en pesos se guarda el TC usado.
              monedaPago,
              montoPagado: p.montoPagado == null || p.montoPagado === "" ? money(p.monto) : money(p.montoPagado),
              tcValor: monedaPago === "ARS" ? esNumero(p.tcValor) : null,
              tcFecha: monedaPago === "ARS" ? fecha(p.tcFecha) : null,
              facturaComercial: esTexto(p.facturaComercial),
              referencia: esTexto(p.referencia),
              compensaOrigen: esTexto(p.compensaOrigen),
              registradoPor: esTexto(p.registradoPor),
            };
          }).filter((p) => p.beneficiario),
          decididoPor: esTexto(r.decididoPor),
          fecha: fecha(r.fecha) || hoy(),
          notas: esTexto(r.notas),
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
    SEGMENTO, SEGMENTO_NOMBRE, CADENCIA, TOQUE_CANAL, proximoToque,
    PROPUESTA_ESTADO,
    RECURRENCIA, ROL, MONEDA_COTIZACION, MONEDA_PRESUPUESTO, MONEDA_LIQUIDACION, PESO_ETAPA,
    VENDEDOR_ESTADO, VENDEDOR_RELACION, COMISION_MODALIDAD, COMISION_BASE,
    COMISION_ORIGEN, COMISION_ESTADO, COMISION_ALCANCE, AREAS_COMISION,
    MARCA_ORIGEN, MARCA_CRITERIO, COMISION_SEGUIMIENTO, PAGO_TIPO, PAGO_MONEDA,
    PAIS, PAIS_NOMBRE, COMPROBANTE_TIPO, CONDICION_IVA,
    CATALOGO_TIPO, CATALOGO_CONDICION, CATALOGO_DISPONIBILIDAD, CATALOGO_PROCEDENCIA,
    CATALOGO_AUDITORIA,
    normalizarColeccion, periodoDe, periodo, fecha, sumarDias, hoy,
    money, claveCliente, nuevoId,
    normalizarTramos, tramoVigente, canonVigente, ajustarCanon, ajusteDeshacible, deshacerAjuste, equipoCubierto, equiposPorIngresar,
    EVENTO_EQUIPO, EVENTO_EQUIPO_LABEL, normalizarEventosEquipo, estadoEquipo, motivoNoEvento,
    diasEnPausa, equiposActivos, FACTURACION_CONTRATO, FACTURACION_LABEL,
    normalizarVersion,
  };
})(typeof window !== "undefined" ? window : globalThis);
