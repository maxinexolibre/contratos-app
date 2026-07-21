/* ============================================================
   Nexolibre · Modelo de contenido del Programa de Continuidad Operativa
   ------------------------------------------------------------
   Una sola fuente de verdad que consumen los dos renderizadores:
   el documento en pantalla (HTML → PDF) y la descarga editable (.docx).

   Dos decisiones de diseño:

   1) Las cláusulas NO llevan el ordinal escrito. Se numeran al armar el
      documento, así se puede sacar una (p. ej. el SLA) y el resto se
      renumera solo. Las referencias cruzadas se escriben como {{id}} y se
      resuelven contra la numeración final: nunca quedan colgadas.

   2) Modo `plantilla` vs modo final. En plantilla los datos faltantes se
      muestran como [campo] en naranja; en el documento final simplemente
      no aparecen, para no entregar un contrato con corchetes.
   ============================================================ */

const ORDINALES = [
  "PRIMERA", "SEGUNDA", "TERCERA", "CUARTA", "QUINTA", "SEXTA", "SÉPTIMA",
  "OCTAVA", "NOVENA", "DÉCIMA", "DECIMOPRIMERA", "DECIMOSEGUNDA", "DECIMOTERCERA",
  "DECIMOCUARTA", "DECIMOQUINTA", "DECIMOSEXTA", "DECIMOSÉPTIMA", "DECIMOCTAVA",
  "DECIMONOVENA", "VIGÉSIMA", "VIGESIMOPRIMERA", "VIGESIMOSEGUNDA",
];

function construirContrato(c, opts = {}) {
  const plantilla = !!opts.plantilla;
  const cov = c.cobertura || {};
  const eco = c.economico || {};
  const rss = c.cliente?.razonesSociales || [];
  const rsp = rsPrincipal(c);
  const esContrato = c.tipo === "contrato";
  const conRM = tieneMRI(c);
  const hayCT = (c.equipos || []).some((e) => e.modalidad === "CT");
  const incluirSLA = cov.incluirSLA !== false; // por defecto se incluye

  // Valor a mostrar: en plantilla marca el hueco, en final lo omite (null).
  // Escapan porque el modelo transporta HTML (los <b> de las cláusulas) y
  // lo consumen dos renderizadores. docgen revierte el escape al imprimir.
  const V = (v, campo) => (v || v === 0 ? esc(v) : plantilla ? `[${campo}]` : null);
  // Igual pero devuelve "" en vez de null, para interpolar dentro de un texto.
  const T = (v, campo) => V(v, campo) ?? "";

  const idx = LEGAL.indiceLabel[c.ajuste?.indice] || c.ajuste?.indice || "";
  const pctMora = eco.moneda === "ARS" ? "10% mensual" : "2% mensual";
  const slaDoc = c.plan?.id
    ? CAT.derivarDePlan(c.plan.id, c.plan.modulos || []).sla
    : { remoto: LEGAL.slaRemoto, onsite: LEGAL.slaOnsite, repuesto: LEGAL.slaRepuesto };
  const sufRM = conRM && hayCT ? " (aplicable a los equipos de resonancia)" : "";
  const fin = computeFin(c);

  // ---------- Encabezado ----------
  const etiquetaPub = esc(c.plan?.etiquetaPublica) || CAT.PLANES[c.plan?.id]?.etiquetaPublica || "Programa de Continuidad Operativa";
  const kicker = `${esContrato ? "PROGRAMA DE CONTINUIDAD OPERATIVA" : "PROPUESTA · PROGRAMA DE CONTINUIDAD OPERATIVA"}${V(c.numero, "N.º") ? " · " + V(c.numero, "N.º") : ""}`;

  // ---------- Datos del cliente ----------
  // Se arma la lista de campos con contenido y recién después se agrupan de a
  // dos por fila. Así un dato faltante no deja la etiqueta huérfana con un
  // guión: directamente no aparece.
  const vigTxt = [V(c.vigencia?.meses, "N") && `${V(c.vigencia?.meses, "N")} meses`, fin && `vence ${fmt(fin)}`].filter(Boolean).join(" · ");
  const campos = [
    ["Cliente", V(c.cliente?.nombreComercial, "nombre comercial")],
    ["Contacto", V(c.cliente?.contacto, "contacto")],
    [`Razón social${rss.length > 1 ? " (facturación)" : ""}`, V(rsp.razonSocial, "razón social")],
    ["CUIT", V(rsp.cuit, "CUIT")],
    ["Localidad", V(c.cliente?.localidad, "localidad")],
    ["Provincia", V(c.cliente?.provincia, "provincia")],
    ["Fecha", fmt(new Date())],
    ["Vigencia", vigTxt || (plantilla ? "[N] meses" : null)],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");
  const filasCliente = [];
  for (let i = 0; i < campos.length; i += 2) {
    const [l1, v1] = campos[i];
    const par2 = campos[i + 1];
    filasCliente.push(par2 ? [l1, v1, par2[0], par2[1]] : [l1, v1, null, null]);
  }
  // Las razones sociales adicionales van en una fila propia a todo el ancho.
  if (rss.length > 1) {
    filasCliente.splice(1, 0, ["Otras razones sociales alcanzadas",
      rss.filter((r) => !r.principal).map((r) => esc(r.razonSocial) + (r.cuit ? ` (CUIT ${esc(r.cuit)})` : "")).join(" · "), null, null]);
  }

  // ---------- Equipos ----------
  const equipos = (c.equipos || []).map((e, i) => ({
    n: i + 1,
    modelo: T(e.modelo, "modelo"), marca: T(e.marca, "marca"),
    modalidad: e.modalidad || "", ubicacion: T(e.ubicacion, "ubicación"),
  }));

  // ---------- Alcance ----------
  const reparaciones = (conRM ? (cov.reparacionesIncluidas || []) : []).map(esc);
  const alcance = [
    cov.preventivoInspeccionesAnuales && `Mantenimiento preventivo programado: ${cov.preventivoInspeccionesAnuales} inspecciones anuales por equipo, según normas del fabricante.`,
    cov.correctivoManoObra && "Mantenimiento correctivo de mano de obra, sin límite de llamados durante la vigencia del Programa.",
    (conRM && !reparaciones.length && cov.reparacionBobinasPorAnio) && (bobinasIlimitadas(c)
      ? `Diagnóstico y reparación electrónica de bobinas de RM${sufRM}: ${cov.reparacionBobinasPorAnio}.`
      : `Diagnóstico y reparación electrónica de bobinas de RM: hasta ${cov.reparacionBobinasPorAnio} reparación/es por año ${BOBINAS_ALCANCE[cov.bobinasAlcance || "flota"].largo}, no acumulables${cov.bobinasAlcance === "porEquipo" ? "" : " y no computables por equipo"}.`),
    cov.soporteRemoto && "Soporte técnico remoto por canal exclusivo en días hábiles.",
    (cov.saasMonitoreo && conRM) && `Acceso al SaaS Nexolibre de Gestión y Monitoreo Cryo${sufRM}: monitoreo continuo de los parámetros criogénicos del equipo (nivel de helio, presión, temperatura de cold-head y estado del compresor), con alertas tempranas y gestión de la base instalada.`,
    cov.stockReservado && "Disponibilidad garantizada de partes críticas para los Equipos cubiertos.",
    cov.bancoHoras && `Banco de ${cov.bancoHoras} horas de ingeniería aplicables a tareas fuera del alcance ordinario.`,
    cov.capacitacion && "Capacitación anual al personal técnico y de operación del Cliente.",
    cov.auditoria && "Auditoría periódica de performance y gestión de obsolescencia de la base instalada.",
    cov.viaticosIncluidos && "Viáticos y traslados del personal técnico incluidos.",
    cov.enviosRepuestosIncluidos && "Costo de envío de repuestos hacia y desde nuestras oficinas incluido.",
    "Documentación y reporte técnico por intervención.",
  ].filter(Boolean);

  // ---------- Exclusiones ----------
  const exclusiones = [
    !cov.partesIncluidas && "Provisión de repuestos y partes no reparables (cotizados y aprobados aparte). Los repuestos podrán ser nuevos, usados o reacondicionados según disponibilidad y contexto.",
    conRM && (cov.saasMonitoreo
      ? "Mantenimiento de la cadena de frío y criogenia (provisión y recarga de helio o nitrógeno, intervención sobre cold-head, compresores y líneas). El servicio contratado comprende el monitoreo y la gestión de la información criogénica, no su mantenimiento; las intervenciones se cotizan por separado."
      : "Cadena de frío y criogenia de los equipos (helio, nitrógeno, cold-head, compresores), tanto en monitoreo como en mantenimiento."),
    hayCT && "En los equipos de tomografía computada, el alcance comprende el mantenimiento preventivo programado y el correctivo de mano de obra; la reparación de bobinas y el monitoreo criogénico son propios de resonancia magnética y no resultan aplicables. El tubo de rayos X, el detector y demás componentes de desgaste se rigen por la {{repuestos}}.",
    "Reparaciones por uso inadecuado, instalación eléctrica/climatización fuera de especificación o intervención de terceros no autorizados.",
    "Chiller, obra civil e infraestructura del sitio; upgrades de versión, hardware o software.",
    !cov.viaticosIncluidos && "Viáticos asociados a servicios correctivos, salvo pacto expreso.",
  ].filter(Boolean);

  // ---------- Condiciones económicas ----------
  const economico = [];
  const canon = Number(eco.canonMensual) || 0;
  const pct = Number(eco.ivaPct ?? 21);
  if (canon && !eco.incluyeIVA) {
    const iva = Math.round(canon * pct / 100);
    economico.push(["Canon mensual (neto)", `${money(canon, eco.moneda)} + IVA`, true]);
    economico.push([`IVA ${pct}%`, money(iva, eco.moneda), false]);
    economico.push(["Total mensual c/ IVA", money(canon + iva, eco.moneda), true]);
  } else if (canon) {
    economico.push(["Canon mensual", `${money(canon, eco.moneda)} (IVA incl.)`, true]);
  } else if (plantilla) {
    economico.push(["Canon mensual (neto)", "[importe] + IVA", true]);
    economico.push(["IVA 21%", "[importe]", false]);
    economico.push(["Total mensual c/ IVA", "[importe]", true]);
  }
  const fp = V(eco.formaPago, "forma de pago");
  if (fp) economico.push(["Forma de pago", fp, false]);
  const aj = c.ajuste?.periodicidad && c.ajuste.periodicidad !== "ninguno"
    ? `${c.ajuste.periodicidad} según ${idx}` : (plantilla ? "[periodicidad] según [índice]" : null);
  if (aj) economico.push(["Ajuste", aj, false]);
  if (incluirSLA) {
    economico.push(["Niveles de servicio",
      plantilla ? "Remoto [N] h · on-site [N] h · repuesto en stock [N] h (hábiles)"
                : `Remoto ${slaDoc.remoto} h · on-site ${slaDoc.onsite} h · repuesto en stock ${slaDoc.repuesto} h (hábiles)`, false]);
  }

  // ---------- Cupo de bobinas (constancia expresa) ----------
  const cupoBobinas = (conRM && cov.reparacionBobinasPorAnio && !bobinasIlimitadas(c))
    ? ` Se deja expresa constancia de que el cupo de <b>${cov.reparacionBobinasPorAnio} (${numLetra(cov.reparacionBobinasPorAnio)}) reparación/es de bobinas por año</b> se computa ${BOBINAS_ALCANCE[cov.bobinasAlcance || "flota"].largo}${cov.bobinasAlcance === "porEquipo" ? `, es decir ${cov.reparacionBobinasPorAnio} por cada uno de los ${cantMRI(c)} equipo/s de resonancia (total ${bobinasTotal(c)} por año)` : `, y <b>no por cada equipo</b>: con ${cantMRI(c)} equipo/s de resonancia cubiertos, el total es de ${bobinasTotal(c)} reparación/es por año para el conjunto`}. Las reparaciones no utilizadas no se acumulan al período siguiente.`
    : "";

  // ---------- Preámbulo ----------
  const domic = rsp.domicilio ? `, con domicilio en ${esc(rsp.domicilio)}` : (plantilla ? ", con domicilio en [domicilio]" : "");
  const fantasia = c.cliente?.nombreComercial && c.cliente.nombreComercial !== rsp.razonSocial
    ? `, que gira comercialmente bajo la denominación «${esc(c.cliente.nombreComercial)}»` : "";
  const otras = rss.length > 1
    ? `, por sí y en representación de ${rss.filter((r) => !r.principal).map((r) => `<b>${esc(r.razonSocial)}</b>${r.cuit ? ` (CUIT ${esc(r.cuit)})` : ""}`).join(", ")}, sociedades alcanzadas por el presente` : "";
  const cuitPre = V(rsp.cuit, "CUIT");
  const preambulo = `Entre <b>Nexolibre</b> («El Prestador») y <b>${T(rsp.razonSocial, "razón social")}</b>${cuitPre ? `, CUIT ${cuitPre}` : ""}${domic}${fantasia}${otras} («El Cliente»), se celebra el presente Contrato de Prestación de Servicios bajo el <b>Programa de Continuidad Operativa NexoCare®</b> (en adelante, «el Programa»), que se regirá por las cláusulas siguientes:`;

  // ---------- Cláusulas ----------
  // `si: false` la deja fuera y renumera el resto automáticamente.
  const defs = [
    { id: "objeto", titulo: "OBJETO", cuerpo: `El Prestador se obliga a ejecutar el <b>Programa de Continuidad Operativa</b> sobre los equipos de diagnóstico por imágenes de propiedad del Cliente individualizados en la(s) Ficha(s) Técnica(s) (los «Equipos»), comprendiendo los servicios de mantenimiento preventivo y correctivo, conforme al alcance${incluirSLA ? ", niveles de servicio" : ""} y condiciones aquí establecidos.` },
    { id: "definiciones", titulo: "DEFINICIONES", cuerpo: `<b>Mantenimiento preventivo:</b> controles eléctricos, electrónicos y mecánicos, verificación de diagnósticos, calibración, limpieza técnica y ajustes conforme a las normas del fabricante, en forma programada. <b>Mantenimiento correctivo:</b> mano de obra necesaria para subsanar fallas durante la operación normal. <b>Reparación de componente:</b> recuperación en laboratorio de una pieza crítica (p. ej. bobina de RF) en lugar de su reemplazo. <b>Días y horas hábiles:</b> de lunes a viernes en horario comercial, excluyendo feriados nacionales.` },
    { id: "alcance", titulo: "ALCANCE DEL SERVICIO", cuerpo: `El Programa incluye, para cada Equipo: ${alcance.map((a) => a.replace(/\.$/, "")).join("; ")}.${reparaciones.length ? ` Reparaciones de partes expresamente incluidas: ${reparaciones.map((r) => r.replace(/\.$/, "")).join("; ")}.` : ""}${cupoBobinas} La provisión de repuestos y partes ${cov.partesIncluidas ? "se encuentra incluida según Ficha Técnica" : "<b>no está incluida</b> y se rige por la {{repuestos}}"}.` },
    { id: "sla", si: incluirSLA, titulo: "NIVELES DE SERVICIO (SLA)", cuerpo: `El Prestador se compromete a los siguientes tiempos objetivo, en horas y días hábiles desde la recepción del reclamo: respuesta de soporte remoto ${plantilla ? "[N]" : slaDoc.remoto} horas hábiles; asistencia on-site por equipo detenido ${plantilla ? "[N]" : slaDoc.onsite} horas hábiles; entrega de repuesto disponible en stock ${plantilla ? "[N]" : slaDoc.repuesto} horas hábiles. Los tiempos se suspenden mientras subsistan causas ajenas al Prestador.` },
    { id: "repuestos", titulo: "REPUESTOS, PARTES Y GARANTÍA DE REPARACIÓN", cuerpo: `Toda parte o pieza a reemplazar, y toda reparación no comprendida en el alcance, será cotizada y aprobada por el Cliente en forma previa e independiente. Los componentes que tras diagnóstico no resulten reparables serán presupuestados para su reemplazo por separado. Los repuestos provistos podrán ser nuevos, usados o reacondicionados según disponibilidad y contexto. ${cov.enviosRepuestosIncluidos ? "El costo de envío de repuestos hacia y desde las oficinas del Prestador se encuentra incluido. " : ""}Las reparaciones de componentes tienen garantía de ${LEGAL.garantiaReparacionDias} días corridos desde su reinstalación, salvo elementos fungibles o de desgaste natural.` },
    { id: "previas", titulo: "CONDICIONES PREVIAS AL INICIO", cuerpo: `Antes de la entrada en vigor se realizará una Visita de Relevamiento Técnico General. Toda reparación o reemplazo necesario para alcanzar la operatividad inicial será presupuestado en forma independiente. El Prestador no será responsable por fallas preexistentes ni por la recuperación de condiciones previas a la puesta en servicio.` },
    { id: "exclusiones", titulo: "EXCLUSIONES", cuerpo: `No se encuentran incluidos: ${exclusiones.map((a) => a.replace(/\.$/, "")).join("; ")}. Todo lo no detallado expresamente en el presente y sus Fichas Técnicas.` },
    { id: "oblCliente", titulo: "OBLIGACIONES DEL CLIENTE", cuerpo: `Garantizar el libre acceso del personal técnico autorizado en los horarios acordados; mantener las condiciones ambientales y eléctricas dentro de las especificaciones del fabricante; abstenerse de permitir la intervención de los Equipos por terceros no autorizados (cuyo incumplimiento faculta a rescindir de inmediato); comunicar por medio fehaciente, dentro de las 48 horas, toda situación que afecte a los Equipos; y abonar el precio en tiempo y forma.` },
    { id: "oblPrestador", titulo: "OBLIGACIONES DEL PRESTADOR", cuerpo: `Prestar los servicios con personal idóneo conforme a las normas del fabricante; ${incluirSLA ? "cumplir los niveles de servicio de la {{sla}}; " : ""}entregar documentación y reporte técnico de cada intervención; y mantener la confidencialidad conforme la {{confidencialidad}}.` },
    { id: "precio", titulo: "PRECIO, PAGO, AJUSTE Y MORA", cuerpo: `El Cliente abonará un canon mensual de ${canon ? money(canon, eco.moneda) : "[importe]"} ${eco.incluyeIVA ? "(IVA incluido)" : "más IVA"}, aun cuando en el período no se hubiere requerido servicio, ${eco.formaPago ? esc(eco.formaPago) : (plantilla ? "[forma de pago]" : "en la forma pactada")}. Los pagos en pesos se convierten al tipo de cambio vendedor del Banco de la Nación Argentina del día de la factura.${c.ajuste?.periodicidad && c.ajuste.periodicidad !== "ninguno" ? ` El canon se ajustará en forma ${c.ajuste.periodicidad} según ${idx}.` : plantilla ? " El canon se ajustará en forma [periodicidad] según [índice]." : ""} La mora se produce de forma automática, devengando un interés punitorio del ${pctMora}. Ante falta de pago a los 10 días corridos del vencimiento, el Prestador podrá suspender el servicio con previo aviso, sin extensión del plazo, hasta su regularización.` },
    { id: "responsabilidad", titulo: "RESPONSABILIDAD Y LÍMITE", cuerpo: `La obligación del Prestador se limita a la fiel ejecución de los servicios. No responderá por daños directos o indirectos, lucro cesante, pérdida de ingresos ni por el tiempo de indisponibilidad del Equipo derivados de fallas no causadas por su personal, demoras logísticas o aduaneras de terceros, uso inadecuado o intervención de terceros. La responsabilidad total y acumulada se limita al equivalente a los últimos ${LEGAL.limiteCanones} (tres) cánones mensuales efectivamente abonados.` },
    { id: "confidencialidad", titulo: "CONFIDENCIALIDAD Y PROTECCIÓN DE DATOS", cuerpo: `Cada parte mantendrá la confidencialidad de la información a la que acceda y la usará solo para la ejecución del contrato. El Prestador tratará todo dato personal o de paciente conforme a la Ley 25.326, con medidas técnicas y organizativas de seguridad. Esta obligación subsiste por ${LEGAL.confidAnios} (dos) años tras la finalización.` },
    { id: "cryo", titulo: "SaaS DE GESTIÓN Y MONITOREO CRYO", cuerpo: `${cov.saasMonitoreo ? "El servicio incluye el acceso a la plataforma <b>Nexolibre Cryo</b> de gestión y monitoreo de la base instalada, que releva en forma continua los parámetros criogénicos del Equipo (nivel de helio, presión, temperatura de cold-head y estado del compresor) y emite alertas tempranas ante desvíos. " : ""}Se deja expresa constancia de que la prestación comprende el <b>monitoreo, registro y gestión de la información criogénica</b>, y <b>no constituye servicio de mantenimiento de la cadena de frío</b>: la provisión y recarga de helio o nitrógeno, y toda intervención sobre cold-head, compresores y líneas criogénicas, se encuentran excluidas y se cotizan por separado. La alerta emitida por la plataforma no sustituye las obligaciones de operación y custodia del Equipo a cargo del Cliente. El acceso se otorga como licencia de uso no exclusiva, intransferible y limitada a la vigencia del Programa; la propiedad intelectual permanece en el Prestador, que podrá usar los datos de operación en forma agregada y anonimizada con fines de mantenimiento predictivo.` },
    { id: "vigencia", titulo: "VIGENCIA, RENOVACIÓN Y RESCISIÓN", cuerpo: `Duración inicial de ${T(c.vigencia?.meses, "N") || "[N]"} meses desde su suscripción${c.vigencia?.renovacionAutomatica ? `, con renovación automática por períodos iguales salvo notificación con ${LEGAL.preavisoNoRenovacion} días de anticipación al vencimiento` : ""}. Cualquiera de las partes podrá rescindir sin causa mediante notificación fehaciente con ${T(c.vigencia?.preavisoDias, "30") || "[30]"} días de anticipación, sin penalidad. Las reparaciones aprobadas y pendientes de pago siguen siendo exigibles.` },
    { id: "fuerzaMayor", titulo: "FUERZA MAYOR", cuerpo: `Ninguna parte será responsable por incumplimientos —salvo los de pago— derivados de caso fortuito o fuerza mayor (arts. 1730 y ss. del Código Civil y Comercial). La parte afectada lo notificará dentro de las 48 horas.` },
    { id: "cesion", titulo: "CESIÓN E INDEPENDENCIA", cuerpo: `El contrato no podrá cederse sin consentimiento previo y por escrito de la otra parte. La relación es civil y comercial; no configura vínculo laboral entre una parte y el personal de la otra. Cada parte es responsable exclusiva de las obligaciones laborales y previsionales de su personal.` },
    { id: "modificaciones", titulo: "MODIFICACIONES, DIVISIBILIDAD Y RENUNCIA", cuerpo: `Toda modificación deberá constar por escrito y suscribirse por ambas partes. La invalidez de una cláusula no afecta a las restantes. La tolerancia ante un incumplimiento no implica renuncia de derechos.` },
    // Sin domicilios cargados la cláusula se redacta en forma genérica en vez
    // de dejar corchetes vacíos en un documento que se firma.
    { id: "notificaciones", titulo: "NOTIFICACIONES", cuerpo: plantilla
        ? `Toda notificación se cursará por medio fehaciente a los domicilios y correos constituidos: Prestador, [domicilio / correo Nexolibre]; Cliente, [domicilio / correo del Cliente].`
        : (rsp.domicilio
            ? `Toda notificación se cursará por medio fehaciente a los domicilios y correos constituidos: Prestador, los indicados en el encabezado; Cliente, ${rsp.domicilio}.`
            : `Toda notificación se cursará por medio fehaciente a los domicilios y correos que las partes tengan constituidos, y a los que constan en el presente.`) },
    { id: "jurisdiccion", titulo: "LEY, MEDIACIÓN Y JURISDICCIÓN", cuerpo: `Rige la ley de la República Argentina. Toda controversia se procurará resolver de buena fe y, de subsistir, se someterá a mediación previa. Agotada ésta, las partes se someten a los Tribunales Ordinarios de ${plantilla ? "[jurisdicción]" : (c.cliente?.provincia ? esc(c.cliente.provincia) : "la jurisdicción que corresponda al domicilio del Cliente")}, con renuncia a todo otro fuero.` },
    { id: "aceptacion", titulo: "ACEPTACIÓN FORMAL", cuerpo: `La recepción de esta propuesta no constituye su aceptación. El contrato se perfecciona cuando el Cliente remita nota de aceptación${cuitPre ? ` consignando su CUIT ${cuitPre}` : ""}, firmada por representante con facultades suficientes, o suscriba el presente. La orden de compra o la recepción conforme del servicio importan aceptación de estos términos.` },
  ];

  const activas = defs.filter((d) => d.si !== false);
  const ordDe = {};
  activas.forEach((d, i) => (ordDe[d.id] = ORDINALES[i] || `N.º ${i + 1}`));
  // {{id}} → "cláusula X". Si la cláusula referida quedó fuera, se elimina
  // la referencia en vez de dejar un hueco.
  const resolver = (t) => t.replace(/\{\{(\w+)\}\}/g, (_, id) => (ordDe[id] ? `cláusula ${ordDe[id]}` : "cláusula correspondiente"));

  const clausulas = activas.map((d) => ({
    ordinal: ordDe[d.id],
    titulo: `${ordDe[d.id]} — ${d.titulo}`,
    cuerpo: resolver(d.cuerpo),
  }));

  // ---------- Fichas técnicas ----------
  const fichas = (c.equipos || []).map((e, i) => {
    const cobTxt = [
      cov.preventivoInspeccionesAnuales && `Preventivo ${cov.preventivoInspeccionesAnuales}/año`,
      cov.correctivoManoObra ? "correctivo (mano de obra)" : null,
      e.modalidad === "MRI" && cov.reparacionBobinasPorAnio && `rep. bobinas ${bobinasTexto(c)}`,
      e.modalidad === "MRI" && cov.saasMonitoreo && "monitoreo Cryo (SaaS)",
    ].filter(Boolean).join(" · ");
    return {
      n: i + 1,
      filas: (() => {
        const cps = [
          ["Equipo / Modelo", [T(e.marca, "marca"), T(e.modelo, "modelo")].filter(Boolean).join(" ") || (plantilla ? "[marca] [modelo]" : null)],
          ["Modalidad", e.modalidad || null],
          ["N.º de serie", V(e.serie, "serie")],
          ["Ubicación", V(e.ubicacion, "ubicación")],
        ].filter(([, v]) => v !== null && v !== undefined && v !== "");
        const fs = [];
        for (let k = 0; k < cps.length; k += 2) {
          const a = cps[k], b = cps[k + 1];
          fs.push(b ? [a[0], a[1], b[0], b[1]] : [a[0], a[1], null, null]);
        }
        if (cobTxt) fs.push(["Cobertura", cobTxt, null, null]);
        return fs;
      })(),
    };
  });

  return {
    esContrato, plantilla, etiquetaPub, kicker,
    subtitulo: "Programa de Continuidad Operativa · Diagnóstico por imágenes MRI / CT",
    filasCliente, equipos, alcance, reparaciones, economico, exclusiones,
    preambulo, clausulas, fichas,
    notaCT: hayCT ? "En los equipos de tomografía computada no se consignan bobinas ni monitoreo criogénico: no resultan aplicables a esa modalidad." : "",
    firmaCliente: esc(rsp.razonSocial || nombreCliente(c)) || (plantilla ? "[razón social]" : ""),
    pie: esContrato ? "Copia del contrato suscripto." : "Esta propuesta se rige por los Términos y Condiciones Generales del Programa aquí incluidos.",
  };
}

window.NEXO_CONTRATO = { construirContrato, ORDINALES };
