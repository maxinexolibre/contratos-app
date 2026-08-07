/* ============================================================
   Nexolibre · Modelo de contenido del Presupuesto
   ------------------------------------------------------------
   Misma idea que contrato.js: una sola fuente de verdad que consumen
   los dos renderizadores (documento en pantalla y descarga .docx).

   Tres tipos de presupuesto:
     · servicio  — trabajo técnico, nace de un ticket
     · partes    — venta de partes, con precio con/sin intercambio
     · equipos   — venta de equipo MRI completo, por conceptos

   El SaaS de Gestión y Monitoreo Cryo NO se cotiza acá: tiene su propio
   documento. Lo que quedaba de ese tipo en la plantilla se quitó para que
   no haya dos piezas comerciales compitiendo por el mismo servicio.

   Las cuentas viven en calcPresupuesto() para que dashboard y reportes
   usen exactamente los mismos números que el documento.
   ============================================================ */

// Valor efectivo de una línea de partes: si se toma el intercambio, rige el
// precio con intercambio; si no, el de lista.
function unitarioEfectivo(it) {
  if (it.intercambio && it.unitarioIntercambio != null && it.unitarioIntercambio !== "")
    return Number(it.unitarioIntercambio) || 0;
  return Number(it.unitario) || 0;
}

// Cuentas del presupuesto. Separa lo que se cobra una vez de lo recurrente
// (el canon de un abono de mantenimiento), porque conviven en un mismo doc.
function calcPresupuesto(p) {
  const eco = p.economico || {};
  const ivaPct = Number(eco.ivaPct ?? 21);
  const incl = !!eco.incluyeIVA;
  const items = p.items || [];

  const itemsNeto = items.reduce((s, it) => s + (Number(it.cantidad) || 0) * unitarioEfectivo(it), 0);
  // Un presupuesto de abono (p. ej. mantenimiento) cotiza un valor MENSUAL:
  // sus ítems no son un pago único sino el canon que se factura cada mes.
  const esMensual = eco.recurrencia === "mensual";
  const descPct = Number(eco.descuentoPct) || 0;
  const brutoUnaVez = esMensual ? 0 : itemsNeto;
  const descuento = Math.round(brutoUnaVez * descPct / 100);
  const netoUnaVez = brutoUnaVez - descuento;

  const abonoMensualNeto = esMensual ? Math.round(itemsNeto * (1 - descPct / 100)) : 0;

  const ivaUnaVez = incl ? 0 : Math.round(netoUnaVez * ivaPct / 100);
  const ivaMensual = incl ? 0 : Math.round(abonoMensualNeto * ivaPct / 100);

  return {
    moneda: eco.moneda || "USD", ivaPct, incl, descuento, descPct, esMensual,
    netoUnaVez, ivaUnaVez, totalUnaVez: netoUnaVez + ivaUnaVez,
    abonoMensualNeto, ivaMensual, totalMensual: abonoMensualNeto + ivaMensual,
    hayUnaVez: netoUnaVez > 0, hayRecurrente: abonoMensualNeto > 0,
  };
}

// Anchos de columna de la tabla de ítems, según tipo. Suman 100.
function columnasItems(tipo, plantilla) {
  if (tipo === "partes") return [
    { t: "Detalle", w: 32 }, { t: "SKU", w: 12 }, { t: "Cant.", w: 8, num: true },
    { t: "P. lista", w: 16, num: true }, { t: "P. c/ intercambio", w: 16, num: true }, { t: "Total", w: 16, num: true },
  ];
  return [
    { t: "Detalle", w: 56 }, { t: "Cant.", w: 10, num: true },
    { t: "Unitario", w: 17, num: true }, { t: "Total", w: 17, num: true },
  ];
}

function construirPresupuesto(p, opts = {}) {
  const plantilla = !!opts.plantilla;
  const eco = p.economico || {};
  const rss = p.cliente?.razonesSociales || [];
  const rsp = rsPrincipal(p);
  const tipo = p.tipo || "servicio";
  const tipoLabel = (PRE_TIPOS[tipo] || { label: tipo }).label;
  const cc = calcPresupuesto(p);
  const M = cc.moneda;

  // En plantilla se marca el hueco; en el final se omite.
  const V = (v, campo) => (v || v === 0 ? esc(v) : plantilla ? `[${campo}]` : null);
  const T = (v, campo) => V(v, campo) ?? "";

  const numero = V(p.numero, "N.º");
  const kicker = `PRESUPUESTO · ${tipoLabel.toUpperCase()}${numero ? " · " + numero : ""}`;

  // ---------- Datos del cliente ----------
  const validezTxt = eco.validezDias ? `${eco.validezDias} días` : (plantilla ? "[N] días" : null);
  const campos = [
    ["Cliente", V(p.cliente?.nombreComercial, "nombre comercial")],
    ["Contacto", V(p.cliente?.contacto, "contacto")],
    [`Razón social${rss.length > 1 ? " (facturación)" : ""}`, V(rsp.razonSocial, "razón social")],
    ["CUIT", V(rsp.cuit, "CUIT")],
    ["Localidad", V(p.cliente?.localidad, "localidad")],
    ["Provincia", V(p.cliente?.provincia, "provincia")],
    ["Fecha", fmt(p.fecha ? parseDate(p.fecha) : new Date())],
    ["Validez de la oferta", validezTxt],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");
  const filasCliente = [];
  for (let i = 0; i < campos.length; i += 2) {
    const [l1, v1] = campos[i];
    const par2 = campos[i + 1];
    filasCliente.push(par2 ? [l1, v1, par2[0], par2[1]] : [l1, v1, null, null]);
  }

  // ---------- Introducción por tipo ----------
  const introPorTipo = {
    servicio: `A continuación se detalla el presupuesto por los servicios técnicos solicitados${p.ticketNumero ? ` (pedido ${esc(p.ticketNumero)})` : ""}. El presente comprende mano de obra e insumos indicados; toda tarea o repuesto no listado se cotiza por separado.`,
    partes: `A continuación se detalla el presupuesto por la provisión de las partes indicadas. Cuando corresponda, se consigna el precio de lista y el precio con intercambio de la parte usada (core). Los repuestos podrán ser nuevos, usados o reacondicionados según disponibilidad y contexto.`,
    equipos: `A continuación se detalla el presupuesto por la provisión del equipamiento indicado y los conceptos asociados (logística, instalación, puesta en marcha y capacitación según se detalle). La operación se rige por las condiciones comerciales al pie.`,
  };
  const intro = introPorTipo[tipo] || introPorTipo.servicio;

  // ---------- Tabla de ítems ----------
  const cols = columnasItems(tipo, plantilla);
  const itemRows = (p.items || []).map((it) => {
    const cant = Number(it.cantidad) || 0;
    const efe = unitarioEfectivo(it);
    const total = cant * efe;
    if (tipo === "partes") {
      return [
        { t: esc(it.detalle) || (plantilla ? "[detalle]" : "—") },
        { t: esc(it.sku) || "—" },
        { t: String(cant || (plantilla ? "[N]" : "")), num: true },
        { t: money(it.unitario, M), num: true },
        { t: it.unitarioIntercambio != null && it.unitarioIntercambio !== "" ? money(it.unitarioIntercambio, M) : "—", num: true },
        { t: money(total, M), num: true, strong: true },
      ];
    }
    // servicio / equipos / genérico
    const det = (it.categoria ? `<b>${esc(it.categoria)}:</b> ` : "") + (esc(it.detalle) || (plantilla ? "[detalle]" : "—"));
    return [
      { t: det },
      { t: String(cant || (plantilla ? "[N]" : "")), num: true },
      { t: money(efe, M), num: true },
      { t: money(total, M), num: true, strong: true },
    ];
  });
  const tabla = { head: cols, rows: itemRows };

  // ---------- Totales ----------
  const ivaLbl = `IVA ${cc.ivaPct}%`;
  const totales = [];
  if (cc.hayUnaVez || plantilla) {
    if (cc.descuento) {
      totales.push(["Subtotal", money(cc.netoUnaVez + cc.descuento, M), false]);
      totales.push([`Descuento ${cc.descPct}%`, "- " + money(cc.descuento, M), false]);
    }
    if (cc.incl) {
      totales.push(["Total (única vez, IVA incluido)", money(cc.totalUnaVez || 0, M), true]);
    } else {
      totales.push(["Subtotal neto", money(cc.netoUnaVez, M), false]);
      totales.push([ivaLbl, money(cc.ivaUnaVez, M), false]);
      totales.push(["Total única vez c/ IVA", money(cc.totalUnaVez, M), true]);
    }
  }
  if (cc.hayRecurrente) {
    const lbl = cc.esMensual ? "Costo mensual del servicio" : "Abono mensual";
    if (cc.incl) {
      totales.push([`${lbl} (IVA incluido)`, money(cc.totalMensual, M), true]);
    } else {
      totales.push([`${lbl} (neto)`, money(cc.abonoMensualNeto, M), false]);
      totales.push([ivaLbl + " (mensual)", money(cc.ivaMensual, M), false]);
      totales.push([`Total mensual c/ IVA`, money(cc.totalMensual, M), true]);
    }
  }

  // ---------- Condiciones ----------
  const condiciones = [];
  const fp = V(eco.formaPago, "forma de pago");
  if (fp) condiciones.push(["Forma de pago", fp]);
  if (validezTxt) condiciones.push(["Validez de la oferta", validezTxt]);
  condiciones.push(["Moneda", M === "USD" ? "Dólares estadounidenses (USD)" : "Pesos (ARS)"]);
  if (M === "USD") condiciones.push(["Conversión", "Los pagos en pesos se convierten al tipo de cambio vendedor del Banco de la Nación Argentina del día de la factura."]);

  // ---------- Notas ----------
  // Apartado propio, no un renglón al pie: acá van las aclaraciones de alcance
  // (qué está incluido, qué se factura aparte) que antes se perdían en letra
  // chica y después se discutían. Cada línea del texto es una nota.
  const notas = (p.notas || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-·•*]\s*/, "").trim())
    .filter(Boolean)
    .map((l) => esc(l));
  if (plantilla && !notas.length) notas.push("[nota de alcance, si corresponde]");

  // ---------- Anexo · Garantía ----------
  const gar = p.garantia || {};
  // El default vive en el esquema; acá solo se decide si el anexo se imprime.
  const aplicaGar = gar.aplica === undefined
    ? (tipo === "servicio" || tipo === "partes" || tipo === "equipos")
    : !!gar.aplica;
  let garantia = null;
  if (aplicaGar) {
    const dias = Number(gar.dias) || 90;
    const enLetras = { 30: "treinta", 60: "sesenta", 90: "noventa", 180: "ciento ochenta", 365: "trescientos sesenta y cinco" }[dias];
    const plazo = enLetras ? `${enLetras} (${dias}) días` : `${dias} días`;
    // Lo que se entrega es un trabajo o una parte, según el tipo. Nombrarlo
    // bien evita prometer garantía sobre algo que no se proveyó.
    const objeto = tipo === "servicio" ? "del trabajo realizado" : "de la parte provista";
    garantia = {
      plazo,
      // Un texto propio pisa el estándar, para el caso puntual que lo pida.
      libre: gar.texto ? esc(gar.texto) : "",
      puntos: gar.texto ? [] : [
        ["Plazo", `${plazo[0].toUpperCase()}${plazo.slice(1)} contados desde la fecha de entrega del equipo operativo.`],
        ["Cobertura", `Cubre únicamente desperfectos y defectos ${objeto} por Nexolibre, dentro del plazo indicado.`],
        ["Limitaciones", "No se cubren daños causados por mal uso, abuso, negligencia, accidentes, alteraciones no autorizadas, falta de mantenimiento, uso incorrecto ni desgaste natural."],
        ["Reclamo", "Para reclamar la garantía debe presentarse una descripción detallada del problema dentro del período de vigencia."],
        ["Evaluación y resolución", "Nexolibre evalúa el reclamo para determinar si está cubierto. De estarlo, repara o reemplaza la parte defectuosa sin costo adicional. Si la reparación no resulta posible, se considera un reemplazo equivalente y, en su caso, un nuevo presupuesto."],
        ["Exclusiones", "Quedan excluidos el desgaste normal, los daños por caso fortuito o fuerza mayor (incendio, inundación, sismo y similares) y las reparaciones o modificaciones efectuadas por terceros no autorizados."],
      ],
    };
  }

  return {
    plantilla, tipo, tipoLabel, kicker,
    etiqueta: "Presupuesto",
    // El título comercial manda; si no se cargó, se cae al nombre del tipo.
    titulo: esc(p.titulo) || tipoLabel,
    subtitulo: "Presupuesto comercial · Ingeniería médica MRI / CT",
    numeroTxt: numero || "",
    filasCliente, intro, tabla, totales, condiciones,
    notas, garantia,
    moneda: M,
    firmaCliente: esc(rsp.razonSocial || nombreCliente(p)) || (plantilla ? "[razón social]" : ""),
    pie: "Este presupuesto no constituye contrato. Su aceptación se perfecciona con la orden de compra o conformidad escrita del Cliente.",
  };
}

window.NEXO_PRESUPUESTO = { construirPresupuesto, calcPresupuesto, unitarioEfectivo };
