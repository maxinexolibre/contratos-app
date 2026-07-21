/* ============================================================
   Nexolibre · Catálogo comercial
   ------------------------------------------------------------
   DOS CAPAS:
   1) PLANES  → lo que el cliente ve. Tres nombres públicos + un
      servicio a medida (Nexo Custom, sin precio publicado).
   2) MODULOS → lo que el cliente NO ve. Piezas internas con las
      que se arma la propuesta y se justifica el precio.

   Regla de oro: el documento que sale para el cliente imprime el
   NOMBRE DEL PLAN y el ALCANCE RESULTANTE. Nunca los módulos.
   ============================================================ */

const PLANES = {
  essential: {
    id: "essential",
    label: "Essential",
    etiquetaPublica: "Contrato Essential",
    claim: "Para quien quiere empezar.",
    precioTxt: "desde USD 890",
    desde: 890,
    hasta: null,
    base: {
      preventivoInspeccionesAnuales: 2,
      correctivoManoObra: true,
      soporteRemoto: true,
      reparacionBobinasPorAnio: 0,
      bobinasAlcance: "flota",
      saasMonitoreo: false,
      partesIncluidas: false,
      viaticosIncluidos: false,
      enviosRepuestosIncluidos: false,
      reparacionesIncluidas: [],
    },
    sla: { remoto: 4, onsite: 48, repuesto: 72 },
    resumenPublico: [
      "2 mantenimientos preventivos programados por año",
      "Mantenimiento correctivo de mano de obra, sin límite de llamados",
      "Soporte técnico remoto en días hábiles",
      "Reporte técnico por intervención",
    ],
  },

  professional: {
    id: "professional",
    label: "Professional",
    etiquetaPublica: "Contrato Professional",
    claim: "El equilibrio entre cobertura y costo. El que elige la mayoría.",
    precioTxt: "USD 1.800 – 2.500",
    desde: 1800,
    hasta: 2500,
    base: {
      preventivoInspeccionesAnuales: 4,
      correctivoManoObra: true,
      soporteRemoto: true,
      reparacionBobinasPorAnio: 2,
      // Cupo compartido por toda la flota de RM, no por equipo.
      bobinasAlcance: "flota",
      saasMonitoreo: true,
      partesIncluidas: false,
      viaticosIncluidos: true,
      enviosRepuestosIncluidos: true,
      reparacionesIncluidas: ["Reparación electrónica de bobinas de RM: hasta 2 por año para el conjunto de los equipos de resonancia, no acumulables"],
    },
    sla: { remoto: 2, onsite: 24, repuesto: 48 },
    resumenPublico: [
      "4 mantenimientos preventivos programados por año",
      "Mantenimiento correctivo de mano de obra, sin límite de llamados",
      "Reparación electrónica de bobinas de RM incluida (cupo anual para el conjunto de los equipos de resonancia)",
      "SaaS de Gestión y Monitoreo Cryo con alertas tempranas",
      "Viáticos y envío de repuestos incluidos",
      "Reporte técnico por intervención e informe trimestral de estado",
    ],
  },

  enterprise: {
    id: "enterprise",
    label: "Enterprise",
    etiquetaPublica: "Contrato Enterprise",
    claim: "Continuidad operativa como estándar.",
    precioTxt: "hasta USD 3.900",
    desde: 2500,
    hasta: 3900,
    base: {
      preventivoInspeccionesAnuales: 4,
      correctivoManoObra: true,
      soporteRemoto: true,
      reparacionBobinasPorAnio: "sin límite",
      bobinasAlcance: "flota",
      saasMonitoreo: true,
      partesIncluidas: false,
      viaticosIncluidos: true,
      enviosRepuestosIncluidos: true,
      reparacionesIncluidas: [
        "Bobinas de RM: todas las del equipo, sin límite de reparaciones",
        "Reparaciones electromecánicas de camilla paciente",
        "Host y recargas de software",
      ],
    },
    sla: { remoto: 1, onsite: 12, repuesto: 24 },
    resumenPublico: [
      "4 mantenimientos preventivos programados por año",
      "Mantenimiento correctivo de mano de obra, sin límite de llamados",
      "Reparación de bobinas de RM sin límite durante la vigencia",
      "Atención prioritaria con tiempos de respuesta reducidos",
      "SaaS de Gestión y Monitoreo Cryo con alertas tempranas",
      "Disponibilidad garantizada de partes críticas",
      "Capacitación anual al personal del Cliente",
      "Auditoría de performance y gestión de obsolescencia",
    ],
  },

  custom: {
    id: "custom",
    label: "Nexo Custom",
    etiquetaPublica: "Contrato Nexo Custom",
    claim: "Diseñamos un contrato exactamente para su operación.",
    precioTxt: "a medida",
    desde: null,
    hasta: null,
    aMedida: true,
    base: {
      preventivoInspeccionesAnuales: 4,
      correctivoManoObra: true,
      soporteRemoto: true,
      reparacionBobinasPorAnio: 0,
      bobinasAlcance: "flota",
      saasMonitoreo: false,
      partesIncluidas: false,
      viaticosIncluidos: false,
      enviosRepuestosIncluidos: false,
      reparacionesIncluidas: [],
    },
    sla: { remoto: 2, onsite: 24, repuesto: 48 },
    resumenPublico: [
      "Programa de mantenimiento diseñado sobre el relevamiento de su operación",
    ],
  },
};

const PLAN_ORDEN = ["essential", "professional", "enterprise", "custom"];

/* ------------------------------------------------------------
   MÓDULOS INTERNOS — NUNCA se nombran en el documento del cliente.
   `efecto` modifica la cobertura; `publico` es la línea que el
   cliente sí lee (redactada como beneficio, no como módulo).
   `valor` es la referencia interna de precio (USD/mes) para armar
   el número final.
   ------------------------------------------------------------ */
const MODULOS = {
  bobinas: {
    id: "bobinas", label: "Bobinas", valor: 450,
    desc: "Amplía la cobertura de reparación de bobinas de RF.",
    publico: "Reparación electrónica de bobinas de RM sin límite durante la vigencia",
    efecto: (cov) => {
      cov.reparacionBobinasPorAnio = "sin límite";
      cov.bobinasAlcance = "flota"; // irrelevante al ser ilimitado, se normaliza
      addRep(cov, "Bobinas de RM: todas las del equipo, sin límite de reparaciones");
    },
  },
  prioridad: {
    id: "prioridad", label: "Prioridad", valor: 350,
    desc: "Adelanta al cliente en la cola de despacho y reduce el SLA.",
    publico: "Atención prioritaria con tiempos de respuesta reducidos",
    sla: { remoto: 1, onsite: 12, repuesto: 24 },
    efecto: () => {},
  },
  horas: {
    id: "horas", label: "Horas adicionales", valor: 300,
    desc: "Banco de horas de ingeniería por fuera del alcance ordinario.",
    publico: "Banco de horas de ingeniería aplicable a tareas fuera del alcance ordinario",
    efecto: (cov) => { cov.bancoHoras = (cov.bancoHoras || 0) + 8; },
  },
  repuestos: {
    id: "repuestos", label: "Repuestos", valor: 900,
    desc: "Partes incluidas hasta un tope anual pactado.",
    publico: "Provisión de repuestos incluida hasta el tope anual acordado",
    efecto: (cov) => { cov.partesIncluidas = true; },
  },
  stock: {
    id: "stock", label: "Stock reservado", valor: 400,
    desc: "Se inmoviliza stock crítico a nombre del cliente.",
    publico: "Disponibilidad garantizada de partes críticas para sus equipos",
    efecto: (cov) => { cov.stockReservado = true; },
  },
  capacitacion: {
    id: "capacitacion", label: "Capacitación", valor: 200,
    desc: "Jornadas de formación al personal técnico y de operación.",
    publico: "Capacitación anual al personal del Cliente",
    efecto: (cov) => { cov.capacitacion = true; },
  },
  auditoria: {
    id: "auditoria", label: "Auditoría", valor: 250,
    desc: "Informe de performance, disponibilidad y obsolescencia.",
    publico: "Auditoría de performance y gestión de obsolescencia de la base instalada",
    efecto: (cov) => { cov.auditoria = true; },
  },
  cryo: {
    id: "cryo", label: "Monitoreo Cryo", valor: 300,
    desc: "SaaS de gestión y monitoreo criogénico (monitoreo, NO mantenimiento).",
    publico: "SaaS de Gestión y Monitoreo Cryo con alertas tempranas",
    efecto: (cov) => { cov.saasMonitoreo = true; },
  },
};

const MODULO_ORDEN = ["bobinas", "prioridad", "horas", "repuestos", "stock", "capacitacion", "auditoria", "cryo"];

function addRep(cov, txt) {
  cov.reparacionesIncluidas = cov.reparacionesIncluidas || [];
  if (!cov.reparacionesIncluidas.includes(txt)) cov.reparacionesIncluidas.push(txt);
}

/* ------------------------------------------------------------
   Deriva la cobertura efectiva = base del plan + módulos internos.
   Devuelve { cobertura, sla, resumenPublico, valorSugerido }.
   ------------------------------------------------------------ */
function derivarDePlan(planId, modulosIds = []) {
  const plan = PLANES[planId] || PLANES.professional;
  const cov = structuredClone(plan.base);
  let sla = { ...plan.sla };
  const publico = [...plan.resumenPublico];
  let valor = plan.desde || 0;

  for (const mid of modulosIds) {
    const m = MODULOS[mid];
    if (!m) continue;
    m.efecto(cov);
    if (m.sla) sla = { ...sla, ...m.sla };
    if (m.publico && !publico.includes(m.publico)) publico.push(m.publico);
    valor += m.valor;
  }
  return { cobertura: cov, sla, resumenPublico: publico, valorSugerido: valor };
}

/* Etiqueta que ve el cliente. Nexo Custom se presenta con el nombre
   del plan de referencia si se eligió uno, para que el cliente lea
   algo simple ("Contrato Professional") aunque por dentro sea otra cosa. */
function etiquetaCliente(planObj) {
  if (planObj?.etiquetaPublica) return planObj.etiquetaPublica;
  return PLANES[planObj?.id]?.etiquetaPublica || "Programa de Mantenimiento";
}

window.NEXO_CATALOGO = { PLANES, PLAN_ORDEN, MODULOS, MODULO_ORDEN, derivarDePlan, etiquetaCliente };
