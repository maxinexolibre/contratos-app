/* ============================================================
   Nexolibre · Propuesta comercial del Programa de Continuidad Operativa
   ------------------------------------------------------------
   Primera etapa: el documento que vende. Cuenta qué problema resuelve el
   programa, qué incluye y cuánto cuesta, sin cláusulas. Si el cliente
   acepta, la propuesta se formaliza en el contrato (contrato.js), que sí
   lleva los términos legales.

   Antes la propuesta salía del mismo modelo que el contrato, con el Anexo
   de Términos y Condiciones incluido: el cliente recibía un contrato
   disfrazado de propuesta en la primera conversación.

   Igual que contrato.js, arma un modelo único que consumen el HTML
   (vista previa / PDF) y el .docx. Los textos usan <b> para negrita y
   <em> para el resaltado naranja de la marca.
   ============================================================ */

/** Primera letra en mayúscula: "cuatro" → "Cuatro". */
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "GE Signa Ovation 0.35T": marca y modelo, sin repetir la marca. */
function nombreEquipo(e) {
  const marca = String(e.marca || "").trim();
  const modelo = String(e.modelo || "").trim();
  return modelo.toLowerCase().startsWith(marca.toLowerCase()) ? modelo : [marca, modelo].filter(Boolean).join(" ");
}

function construirPropuesta(p, cli = {}) {
  const cov = p.cobertura || {};
  const eco = p.economico || {};
  const equipos = p.equipos || [];
  const cliente = esc(cli.nombreComercial || "el Cliente");
  const em = (t) => `<em>${t}</em>`;
  const CLI = em(cliente);

  const conRM = equipos.some((e) => e.modalidad === "MRI");
  const soloRM = equipos.length && equipos.every((e) => e.modalidad === "MRI");
  const soloCT = equipos.length && equipos.every((e) => e.modalidad === "CT");
  // Cómo se nombra el equipo en el texto. Con uno solo se habla de "el
  // resonador"; con varios, del parque.
  const uno = equipos.length === 1;
  const sujeto = uno ? (soloRM ? "un resonador magnético" : soloCT ? "un tomógrafo" : "un equipo de diagnóstico por imágenes")
    : "el parque de diagnóstico por imágenes";
  const elEquipo = uno ? (soloRM ? "el resonador" : soloCT ? "el tomógrafo" : "el equipo") : "los equipos";

  // ---------- Portada ----------
  const titulo = uno
    ? { pre: esc(equipos[0].modalidad || ""), resaltado: esc(nombreEquipo(equipos[0])) }
    : equipos.length
      ? { pre: "", resaltado: `${equipos.length} equipos de diagnóstico por imágenes` }
      : { pre: "", resaltado: "Programa de Continuidad Operativa" };

  const intro = {
    destacado: uno
      ? `${capital(sujeto)} no es un equipo más dentro de la institución: es infraestructura crítica. Su disponibilidad determina directamente la capacidad de diagnóstico, el flujo de pacientes y los ingresos asociados al servicio de imágenes.`
      : `Los equipos de diagnóstico por imágenes no son equipos más dentro de la institución: son infraestructura crítica. Su disponibilidad determina directamente la capacidad de diagnóstico, el flujo de pacientes y los ingresos asociados al servicio.`,
    parrafos: [
      "Cada hora de inactividad no planificada tiene un costo que va más allá del gasto de reparación: estudios reprogramados, pacientes derivados a otra institución y una carga de incertidumbre sobre el equipo médico y administrativo, que debe resolver la situación sin información técnica previa.",
      "La disponibilidad de un equipo de esta complejidad no depende del azar. Depende de la calidad de la planificación técnica que lo sostiene: mantenimiento preventivo ejecutado con la frecuencia correcta, respuesta correctiva rápida cuando ocurre una falla, y un historial técnico que permita anticipar problemas antes de que se conviertan en interrupciones.",
      `${CLI} ha construido, a lo largo de los años, un patrimonio tecnológico que representa una inversión significativa y una responsabilidad institucional. Cuidar ese patrimonio, prolongar su vida útil y sostener su rendimiento clínico es una decisión de administración, no solamente una decisión técnica.`,
      "Esto es lo que un Programa de Continuidad Operativa resuelve: previsibilidad presupuestaria, reducción de interrupciones, protección de la inversión y un acompañamiento técnico permanente que responde cuando la institución lo necesita, no cuando el proveedor tiene disponibilidad.",
      "Las páginas siguientes describen el alcance de este programa y las condiciones bajo las cuales la institución puede incorporarlo.",
    ],
  };

  // ---------- Alcance ----------
  // Cada ítem dice primero por qué importa y después qué se hace: la
  // propuesta la lee quien decide la compra, no sólo el jefe técnico.
  const nPrev = Number(cov.preventivoInspeccionesAnuales) || 0;
  const bob = cov.reparacionBobinasPorAnio;
  const nBob = Number(bob);
  // Las bobinas ya tienen su propio ítem: repetirlas en la lista de partes
  // hacía que la propuesta las ofreciera dos veces con distinta redacción.
  const reparaciones = (cov.reparacionesIncluidas || []).filter((r) => !(conRM && bob && /bobina/i.test(r)));
  const alcance = [
    nPrev && {
      titulo: `Mantenimiento preventivo — ${em(capital(numLetra(nPrev)))} ${nPrev === 1 ? "intervención anual" : "intervenciones anuales"}`,
      porque: `Los componentes de ${uno ? (soloRM ? "un resonador" : "un equipo") : "estos equipos"} se desgastan de forma progresiva y silenciosa. Sin una revisión periódica, una falla menor se detecta recién cuando ya interrumpió un estudio.`,
      que: `Se ${nPrev === 1 ? "realiza" : "realizan"} ${em(numLetra(nPrev))} ${nPrev === 1 ? "mantenimiento preventivo" : "mantenimientos preventivos"} al año${uno ? "" : " por equipo"}, que permiten identificar desgaste y corregirlo antes de que afecte la operación, siguiendo los intervalos que el fabricante define para ${uno ? "este modelo" : "cada modelo"}.`,
    },
    cov.correctivoManoObra && {
      titulo: "Atención correctiva prioritaria",
      porque: "Cuando un equipo crítico falla, cada hora sin respuesta técnica es una hora de estudios no realizados.",
      que: `${CLI} cuenta con atención prioritaria ante fallas, con mano de obra incluida, para reducir el tiempo entre la falla y la resolución.`,
    },
    conRM && bob && {
      titulo: Number.isFinite(nBob) && nBob > 0
        ? `Reparación electrónica de bobinas — hasta ${em(numLetra(nBob))} ${nBob === 1 ? "intervención incluida" : "intervenciones incluidas"} por año`
        : `Reparación electrónica de bobinas — ${em(esc(bob))}`,
      porque: "Las bobinas son uno de los componentes de mayor costo de reemplazo. La práctica habitual del mercado es sustituir el módulo completo, aun cuando buena parte de sus componentes todavía funcionan.",
      que: "Nexolibre repara a nivel de componente electrónico en su propio laboratorio siempre que es técnicamente posible. Esto recupera equipamiento que de otro modo se reemplazaría, y reduce el costo total de propiedad del resonador.",
    },
    cov.soporteRemoto && {
      titulo: "Soporte remoto y canal directo con Ingeniería",
      porque: "Muchas situaciones no requieren una visita técnica, pero sí una respuesta inmediata para decidir los próximos pasos con criterio correcto.",
      que: "El equipo de la institución cuenta con un canal directo con Ingeniería y soporte remoto especializado, sin intermediarios administrativos.",
    },
    (cov.saasMonitoreo && conRM) && {
      titulo: "Monitoreo criogénico continuo",
      porque: "Una pérdida de helio no avisa: cuando se nota en la imagen, el costo de recuperarla ya es alto.",
      que: "Acceso al SaaS Nexolibre de Gestión y Monitoreo Cryo: seguimiento continuo de nivel de helio, presión, temperatura del cold-head y estado del compresor, con alertas tempranas.",
    },
    cov.partesIncluidas && {
      titulo: "Repuestos incluidos",
      porque: "El costo de un repuesto imprevisto es lo que más desordena el presupuesto de un servicio de imágenes.",
      que: "La provisión de repuestos está incluida en el programa, según las condiciones que detalle el contrato.",
    },
    reparaciones.length && {
      titulo: "Reparaciones de partes incluidas",
      porque: "Algunas partes concentran la mayor parte del riesgo de falla de este equipo.",
      que: `El programa incluye: ${reparaciones.map(esc).join("; ")}.`,
    },
    {
      titulo: "Informes técnicos e historial del equipo",
      porque: "Sin registro técnico, cada nueva intervención empieza de cero, y la institución pierde la posibilidad de anticipar patrones de falla.",
      que: "Cada intervención genera un informe. El conjunto forma un historial técnico del equipo que respalda las decisiones futuras de mantenimiento, presupuesto y eventual renovación.",
    },
    cov.relevamientoInicial !== false && {
      titulo: "Relevamiento técnico inicial",
      porque: "Antes de definir cualquier plan de trabajo, es necesario conocer el estado real del equipo.",
      que: `El programa comienza con un relevamiento técnico completo de ${elEquipo}, que establece la línea base sobre la cual se planifican las intervenciones siguientes.`,
    },
  ].filter(Boolean);

  // Lo que no está incluido pero se puede sumar: abre la conversación de
  // venta adicional sin inflar el precio de entrada.
  const opcionales = [
    conRM && !cov.saasMonitoreo && "monitoreo remoto del equipo y mantenimiento preventivo de la cadena de frío",
    !cov.partesIncluidas && "provisión de repuestos con condiciones preferenciales",
  ].filter(Boolean);
  const textoOpcionales = opcionales.length
    ? `${capital(opcionales.join("; "))}, disponibles como complemento del programa según las necesidades de la institución.` : "";

  // ---------- Propuesta económica ----------
  const canon = Number(eco.canonMensual) || 0;
  const ref = eco.valorReferencia == null ? null : Number(eco.valorReferencia);
  const sufijo = eco.incluyeIVA ? " IVA incluido mensuales" : " + IVA mensuales";
  const importe = (v) => `${eco.moneda === "UF" ? "UF" : "USD"} ${em(`$${Number(v).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)}${sufijo}`;
  // El valor de referencia sólo tiene sentido si es mayor: mostrar uno igual
  // o menor que el canon anula el argumento de la condición especial.
  const conReferencia = ref && canon && ref > canon;

  const meses = Number(p.vigenciaPropuesta?.meses) || 12;
  const condiciones = [
    ["Duración", `${em(capital(numLetra(meses)))} meses, con renovación automática por períodos iguales salvo aviso previo de cualquiera de las partes.`],
    ["Forma de pago", esc(eco.formaPago || "Facturación mensual.")],
    ["Ajuste", esc(eco.ajuste || "Anual, según variación de costos.")],
    p.vigenciaPropuesta?.inicioEstimado && ["Inicio estimado", fmt(new Date(p.vigenciaPropuesta.inicioEstimado + "T12:00:00"))],
    cov.relevamientoInicial !== false && ["Relevamiento inicial", "Incluido en el primer mes del programa, sin cargo adicional."],
    ["Validez de la propuesta", `${Number(p.validezDias) || 30} días desde su emisión.`],
  ].filter(Boolean);

  return {
    kicker: "PROGRAMA DE CONTINUIDAD OPERATIVA",
    numero: esc(p.numero || ""),
    fecha: fmt(new Date((p.fechas?.creado || new Date().toISOString().slice(0, 10)) + "T12:00:00")),
    titulo, cliente, CLI,
    plan: p.plan?.id ? esc(p.plan.etiquetaPublica || CAT.PLANES[p.plan.id]?.etiquetaPublica || "") : "",
    equipos: equipos.length > 1 ? equipos.map((e, i) => ({ n: i + 1, equipo: esc(nombreEquipo(e)), modalidad: esc(e.modalidad || ""), ubicacion: esc(e.ubicacion || "") })) : [],
    intro,
    alcanceIntro: "El alcance del programa está diseñado alrededor de un principio simple: cada intervención debe reducir el riesgo de interrupción y extender la vida útil del equipo, en lugar de limitarse a resolver la falla del momento.",
    alcance, opcionales: textoOpcionales,
    economicaIntro: `Este programa reemplaza la incertidumbre de un mantenimiento reactivo por un costo previsible, planificado y sostenido en el tiempo. La institución pasa de administrar imprevistos a administrar un presupuesto conocido, con un equipo técnico que ya conoce ${elEquipo}, su historial y sus particularidades.`,
    referencia: conReferencia ? importe(ref) : "",
    precioTitulo: conReferencia ? `Condición Comercial Especial para ${CLI}` : `Inversión mensual del Programa`,
    precio: canon ? importe(canon) : "",
    precioNota: conReferencia
      ? `Esta condición responde al conocimiento técnico que Nexolibre tiene ${elEquipo.startsWith("el ") ? "del " + elEquipo.slice(3) : "de " + elEquipo}, a la relación construida entre ambas instituciones y a la intención de establecer con ${CLI} una relación técnica de largo plazo.`
      : "",
    condiciones,
    aviso: "Este documento resume el programa a efectos comerciales; no reemplaza el contrato de servicio, que detallará las condiciones operativas y comerciales definitivas.",
    cierre: `${CLI} administra un patrimonio tecnológico que sostiene su capacidad diagnóstica y su compromiso con los pacientes que atiende. Este programa está construido para acompañar esa responsabilidad de manera constante, con criterio técnico y con la transparencia que una relación de largo plazo requiere.`,
    nombreArchivo: [p.numero, cli.nombreComercial, "Propuesta de continuidad operativa",
      equipos.length === 1 ? nombreEquipo(equipos[0]) : ""].filter(Boolean).join(" - "),
  };
}

// Oficinas del membrete. Son los datos de contacto públicos de la empresa,
// los mismos que figuran en nexolibre.com.
const OFICINAS = [
  { pais: "ARGENTINA", lineas: ["Alfredo Palacios 1136, Victoria", "Tel.: +5491167410993", "contacto@nexolibre.com"] },
  { pais: "CHILE", lineas: ["Diagonal Oriente 1620, Providencia", "Tel.: +56 (2) 2473 7823", "contacto@nexolibre.com"] },
  { pais: "MIT Labs · EE.UU.", lineas: ["8405 NW 29 Street, Doral", "Tel.: 305 - 470 - 8013", "contacto@mitlabsusa.com"] },
];

/** Vista previa / PDF. Una hoja por sección, como el modelo en papel. */
function renderPropuestaHTML(m) {
  const membrete = `<div class="pp-hd"><span class="pp-lema">innovación<br>y crecimiento<br>continuo_</span><img src="${NEXO_BRAND.logo}" alt="Nexolibre" /></div>`;
  const pie = `<div class="pp-pie">${OFICINAS.map((o) => `<div><b>${o.pais}</b>${o.lineas.map((l) => `<br>${l}`).join("")}</div>`).join("")}
    <div class="pp-web">www.nexolibre.com</div></div>`;
  const hoja = (titulo, cuerpo, { portada = false } = {}) => `<section class="pp-hoja">
    ${membrete}
    <div class="pp-kick">${m.kicker}</div>
    ${portada ? titulo : `<h1>${titulo}</h1>`}
    <hr>
    ${cuerpo}
    ${pie}
  </section>`;

  return `
    <style>
      @page { size: A4; margin: 14mm 18mm 14mm 18mm; }
      #printRoot .pp-hoja, .visor-doc .pp-hoja { font-family: Helvetica, Arial, sans-serif; color: #2b2724; font-size: 12.5px; line-height: 1.45; }
      .pp-hoja { break-after: page; page-break-after: always; position: relative; padding-bottom: 8px; }
      .pp-hoja:last-child { break-after: auto; page-break-after: auto; }
      .pp-hd { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 26px; }
      .pp-hd img { height: 40px; width: auto; }
      .pp-lema { color: #ef8f03; font-style: italic; font-size: 13px; line-height: 1.15; }
      .pp-kick { color: #ef8f03; font-weight: 700; font-size: 10.5px; letter-spacing: .14em; margin-bottom: 4px; }
      .pp-hoja h1 { font-family: var(--head, Exo, sans-serif); font-weight: 700; color: #645d56; font-size: 21px; margin: 0 0 4px; }
      .pp-hoja h1 em, .pp-hoja em { color: #c47500; font-style: normal; font-weight: 700; }
      .pp-sub { color: #8c867d; margin: 0 0 4px; }
      .pp-hoja hr { border: 0; border-top: 1px solid #d9d3ca; margin: 14px 0 16px; }
      .pp-dest { font-weight: 700; font-size: 13.5px; color: #4a443e; margin: 0 0 12px; }
      .pp-hoja p { margin: 0 0 9px; text-align: justify; }
      .pp-item { break-inside: avoid; page-break-inside: avoid; margin: 0 0 10px; }
      .pp-item h3 { font-family: var(--head, Exo, sans-serif); font-size: 12.5px; color: #4a443e; margin: 0 0 3px; }
      .pp-item .pq { margin: 0; }
      .pp-item .qu { color: #8c867d; margin: 0; }
      .pp-precio-t { font-family: var(--head, Exo, sans-serif); font-weight: 700; font-size: 12px; color: #4a443e; margin: 14px 0 2px; }
      .pp-precio { font-weight: 700; font-size: 15px; margin: 0 0 8px; }
      .pp-hoja table { width: 100%; border-collapse: collapse; margin: 8px 0 6px; font-size: 12.5px; }
      .pp-hoja th, .pp-hoja td { border: 1px solid #2b2724; padding: 10px 12px; text-align: left; vertical-align: top; }
      .pp-hoja th { background: #f4f1ec; width: 38%; font-weight: 700; color: #4a443e; }
      .pp-hoja table.pp-eq th { width: auto; }
      .pp-aviso { font-style: italic; color: #8c867d; font-size: 10.5px; }
      .pp-pie { display: flex; gap: 22px; align-items: flex-end; margin-top: 28px; font-size: 9px; color: #645d56; line-height: 1.35; }
      .pp-pie b { color: #ef8f03; font-weight: 600; }
      .pp-web { margin-left: auto; color: #ef8f03; font-weight: 700; font-size: 13px; }
      /* En papel el pie va al fondo de cada hoja, como en el membrete. Un
         elemento fijo se repite en todas las páginas impresas; las tres
         copias (una por sección) quedan superpuestas e idénticas. Con
         min-height + flex Chrome no lo respetaba al fragmentar la página. */
      @media print {
        .pp-hoja { padding-bottom: 22mm; }
        .pp-pie { position: fixed; left: 0; right: 0; bottom: 0; margin: 0; background: #fff; }
      }
    </style>

    ${hoja(`<h1>${m.titulo.pre ? `${m.titulo.pre} ` : ""}<em>${m.titulo.resaltado}</em></h1>
      <p class="pp-sub">Preparado exclusivamente para <em>${m.cliente}</em>${m.plan ? ` · ${m.plan}` : ""}</p>
      <p class="pp-sub" style="font-size:11px">${m.numero ? `Propuesta ${m.numero} · ` : ""}${m.fecha}</p>`,
      `<p class="pp-dest">${m.intro.destacado}</p>
      ${m.intro.parrafos.map((t) => `<p>${t}</p>`).join("")}
      ${m.equipos.length ? `<table class="pp-eq"><thead><tr><th>#</th><th>Equipo</th><th>Modalidad</th><th>Ubicación</th></tr></thead>
        <tbody>${m.equipos.map((e) => `<tr><td>${e.n}</td><td>${e.equipo}</td><td>${e.modalidad}</td><td>${e.ubicacion || "—"}</td></tr>`).join("")}</tbody></table>` : ""}`,
      { portada: true })}

    ${hoja("Alcance del Programa", `<p>${m.alcanceIntro}</p>
      ${m.alcance.map((a) => `<div class="pp-item"><h3>${a.titulo}</h3><p class="pq">${a.porque}</p><p class="qu">${a.que}</p></div>`).join("")}
      ${m.opcionales ? `<div class="pp-item"><h3>Servicios opcionales</h3><p class="pq">${m.opcionales}</p></div>` : ""}`)}

    ${hoja("Propuesta Económica", `<p>${m.economicaIntro}</p>
      ${m.referencia ? `<div class="pp-precio-t">Valor de referencia del Programa</div><div class="pp-precio">${m.referencia}</div>` : ""}
      ${m.precio ? `<div class="pp-precio-t">${m.precioTitulo}</div><div class="pp-precio">${m.precio}</div>` : ""}
      ${m.precioNota ? `<p>${m.precioNota}</p>` : ""}
      <div class="pp-precio-t">Condiciones comerciales</div>
      <table>${m.condiciones.map(([l, v]) => `<tr><th>${l}</th><td>${v}</td></tr>`).join("")}</table>
      <p class="pp-aviso">${m.aviso}</p>
      <hr>
      <p>${m.cierre}</p>`)}`;
}

window.NEXO_PROPUESTA = { construirPropuesta, renderPropuestaHTML, OFICINAS };
