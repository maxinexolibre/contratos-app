#!/usr/bin/env node
/**
 * Pruebas del núcleo sin navegador.
 *
 * Carga los módulos reales (no copias) en un contexto con los globals mínimos
 * y verifica esquema, reglas y KPIs. Datos sintéticos: este archivo vive en el
 * repo público.
 *
 *   node tools/probar-nucleo.mjs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- contexto mínimo -------------------------------------------------------
const almacenLocal = new Map();
const contexto = {
  console,
  localStorage: {
    getItem: (k) => almacenLocal.get(k) ?? null,
    setItem: (k, v) => almacenLocal.set(k, String(v)),
    removeItem: (k) => almacenLocal.delete(k),
  },
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  fetch: async () => { throw new Error("fetch no disponible en las pruebas"); },
  escape, unescape,
};
contexto.window = contexto;
contexto.globalThis = contexto;
vm.createContext(contexto);

for (const f of ["esquema", "permisos", "reglas", "kpi", "almacen", "adaptador", "cambio", "comisiones", "catalogo", "planilla"]) {
  vm.runInContext(readFileSync(resolve(RAIZ, `nucleo/${f}.js`), "utf8"), contexto, { filename: f });
}

const {
  NEXO_ESQUEMA: E, NEXO_PERMISOS: P, NEXO_REGLAS: R, NEXO_KPI: K,
  NEXO_ALMACEN: A, NEXO_ADAPTADOR: AD, NEXO_CAMBIO: C, NEXO_COMISIONES: CM,
  NEXO_CATALOGO_PARTES: CAT,
} = contexto;

// --- mini framework --------------------------------------------------------
let pasadas = 0, fallidas = 0;
const fallos = [];

function prueba(nombre, fn) {
  try {
    fn();
    pasadas++;
  } catch (e) {
    fallidas++;
    fallos.push(`${nombre}\n    ${e.message}`);
  }
}

/** Serializa con las claves ordenadas: el orden no es información. */
function estable(v) {
  if (Array.isArray(v)) return "[" + v.map(estable).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + estable(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
function igual(a, b, msg) {
  const sa = estable(a), sb = estable(b);
  if (sa !== sb) throw new Error(`${msg || "distinto"}: esperaba ${sb}, obtuve ${sa}`);
}
function cierto(v, msg) { if (!v) throw new Error(msg || "esperaba verdadero"); }
function rechaza(codigo, fn) {
  try { fn(); } catch (e) {
    if (e.codigo === codigo) return;
    throw new Error(`esperaba ${codigo}, obtuve ${e.codigo || e.message}`);
  }
  throw new Error(`esperaba que fallara con ${codigo}, no falló`);
}

// --- datos sintéticos ------------------------------------------------------
const ADMIN = { rol: "admin", usuario: "test" };

const ticketBase = (over = {}) => E.ENTIDADES.tickets.normalizar({
  id: "tk_1", numero: "TK-20260801", fecha: "2026-08-01", clienteId: "cli_1",
  vendedor: "test", estado: "Nuevo", tipo: "Servicio",
  descripcion: "Reemplazo de cold head", montoEstimado: 18500, moneda: "USD", ...over,
});

const presuBase = (over = {}) => E.ENTIDADES.presupuestos.normalizar({
  id: "pre_1", numero: "P20260801", ticketId: "tk_1", fecha: "2026-08-01",
  clienteId: "cli_1", estado: "Borrador",
  items: [{ detalle: "Cold head", cantidad: 1, unitario: 18500 }],
  economico: { moneda: "USD", validezDias: 15, descuentoPct: 0, recurrencia: "unica" }, ...over,
});

// ===========================================================================
// ESQUEMA
// ===========================================================================

prueba("normaliza y calcula totales del presupuesto", () => {
  const p = presuBase({ items: [{ detalle: "x", cantidad: 3, unitario: 100.005 }] });
  igual(p.items[0].total, 300.03, "total del ítem");
  igual(p.subtotal, 300.03, "subtotal");
});

prueba("aplica descuento sobre el subtotal", () => {
  const p = presuBase({ economico: { moneda: "USD", descuentoPct: 10, recurrencia: "unica", validezDias: 15 } });
  igual(p.total, 16650, "total con 10% de descuento");
});

prueba("calcula el vencimiento desde emisión + validez", () => {
  igual(presuBase().vence, "2026-08-16", "vencimiento");
});

prueba("marca legado lo que no está cotizado en USD, UF o ARS", () => {
  // ARS es una excepción real (clientes que contratan en pesos), no un resto heredado.
  cierto(!presuBase({ economico: { moneda: "ARS", recurrencia: "mensual", validezDias: 15, descuentoPct: 0 } }).esLegado);
  cierto(presuBase({ economico: { moneda: "CLP", recurrencia: "unica", validezDias: 15, descuentoPct: 0 } }).esLegado);
  cierto(!presuBase().esLegado);
});

prueba("presupuesto anulado: estado propio, con motivo, sin contar como rechazo", () => {
  const p = presuBase({ estado: "Anulado", motivoAnulacion: "Reemplazado por otra versión" });
  igual(p.estado, "Anulado");
  igual(p.motivoAnulacion, "Reemplazado por otra versión");
  igual(presuBase({ estado: "Enviado", motivoAnulacion: "x" }).motivoAnulacion, "", "solo un anulado lleva motivo");
  const k = K.presupuestos([presuBase({ estado: "Aprobado" }), presuBase({ estado: "Rechazado" }), p]);
  igual(k.porEstado.Anulado, 1);
  igual(k.tasaAprobacion, 50, "el anulado no entra en la tasa");
});

prueba("se anula desde borrador o enviado; un anulado no se reabre", () => {
  const ctx = { tickets: [ticketBase({ id: "tk1" })], presupuestos: [], rol: "admin" };
  const env = presuBase({ id: "p1", ticketId: "tk1", estado: "Enviado" });
  cierto(R.validar("presupuestos", "editar", { ...env, estado: "Anulado" }, env, ctx) !== false);
  const anu = { ...env, estado: "Anulado" };
  rechaza("NX-020", () => R.validar("presupuestos", "editar", { ...anu, estado: "Enviado" }, anu, ctx));
});

prueba("seguimiento: 30 días para reparaciones y partes, 180 para equipos", () => {
  const s = K.seguimiento({ estado: "enviado", fechaEnvio: "2026-09-01", subtipo: "" }, "2026-10-15");
  igual(s.dias, 44); igual(s.plazo, 30); cierto(s.atrasado);
  const eq = K.seguimiento({ estado: "Enviado", fechaEnvio: "2026-09-01", subtipo: "equipo" }, "2026-10-15");
  cierto(!eq.atrasado, "un equipo todavía está en plazo");
  igual(K.seguimiento({ estado: "ganado", fechaEnvio: "2026-01-01" }, "2026-10-15"), null, "lo resuelto no se sigue");
});

prueba("ticket abierto no lleva fecha de cierre; terminal sí", () => {
  igual(ticketBase({ estado: "EnNegociacion", fechaCierre: "2026-08-10" }).fechaCierre, null);
  cierto(ticketBase({ estado: "Cerrado" }).fechaCierre !== null);
});

prueba("rechaza valores fuera del vocabulario y cae al default", () => {
  igual(ticketBase({ estado: "Inventado" }).estado, "Nuevo");
  igual(ticketBase({ prioridad: "Urgentísima" }).prioridad, "Media");
});

prueba("deduplica clientes por clave normalizada", () => {
  // Nombres ficticios a propósito: este archivo vive en un repo público.
  igual(E.claveCliente("Imagen"), E.claveCliente("IMAGEN"), "solo difieren en mayúsculas");
  igual(E.claveCliente("Diagnóstico Ejemplo"), "diagnostico ejemplo", "sin tildes");
  igual(E.claveCliente("Centro  Médico S.A."), "centro medico s a", "sin puntuación ni dobles espacios");
});

prueba("asigna el período de partición por la fecha del registro", () => {
  igual(E.periodoDe("tickets", ticketBase({ fecha: "2026-08-14" })), "2026-08");
  igual(E.periodoDe("clientes", { id: "cli_1" }), null, "las no particionadas no tienen período");
});

// ===========================================================================
// PERMISOS
// ===========================================================================

prueba("el vendedor solo lee lo propio", () => {
  const mio = ticketBase({ vendedor: "gabriel" });
  const ajeno = ticketBase({ id: "tk_2", vendedor: "otro" });
  cierto(P.puedeSobre("vendedor", "tickets", "leer", mio, "gabriel"));
  cierto(!P.puedeSobre("vendedor", "tickets", "leer", ajeno, "gabriel"));
  igual(P.filtrarLectura("vendedor", "tickets", [mio, ajeno], "gabriel").length, 1);
});

prueba("el gerente comercial ve todo", () => {
  const ajeno = ticketBase({ vendedor: "otro" });
  cierto(P.puedeSobre("gerente_comercial", "tickets", "leer", ajeno, "maxi"));
});

prueba("marketing no ve tickets ni contratos", () => {
  cierto(!P.puede("marketing", "tickets", "leer"));
  cierto(!P.puede("marketing", "contratos", "leer"));
  cierto(P.puede("marketing", "campanas", "crear"));
});

prueba("aprobar presupuestos: comercial y administrativa, nadie más", () => {
  cierto(P.capacidad("gerente_comercial", "aprobar_presupuesto"));
  cierto(P.capacidad("gerente_administrativo", "aprobar_presupuesto"));
  cierto(!P.capacidad("direccion", "aprobar_presupuesto"));
  cierto(!P.capacidad("vendedor", "aprobar_presupuesto"));
});

prueba("cada rol aterriza en una pantalla con contenido", () => {
  for (const rol of E.ROL) {
    const inicio = P.inicioDe(rol);
    cierto(inicio, `${rol} sin pantalla de inicio`);
    cierto(P.areasDe(rol).length > 0, `${rol} sin ninguna área visible`);
  }
});

// ===========================================================================
// REGLAS
// ===========================================================================

prueba("R1 · el presupuesto emitido no cambia de ticket", () => {
  const antes = presuBase({ estado: "Enviado" });
  const despues = presuBase({ estado: "Enviado", ticketId: "tk_9" });
  rechaza("NX-001", () => R.validar("presupuestos", "editar", despues, antes, {
    ...ADMIN, tickets: [ticketBase(), ticketBase({ id: "tk_9" })],
  }));
});

prueba("R2 · un solo presupuesto aprobado por ticket", () => {
  const yaAprobado = presuBase({ id: "pre_0", numero: "P20260800", estado: "Aprobado" });
  const nuevo = presuBase({ id: "pre_1", estado: "Aprobado" });
  rechaza("NX-002", () => R.validar("presupuestos", "editar", nuevo,
    presuBase({ estado: "Enviado" }),
    { ...ADMIN, tickets: [ticketBase()], presupuestos: [yaAprobado] }));
});

prueba("R3 · no se cierra un ticket sin presupuesto aprobado", () => {
  rechaza("NX-003", () => R.validar("tickets", "editar",
    ticketBase({ estado: "Cerrado" }), ticketBase({ estado: "EnNegociacion" }),
    { ...ADMIN, presupuestos: [presuBase({ estado: "Enviado" })] }));
});

prueba("R3 · con presupuesto aprobado, cierra", () => {
  R.validar("tickets", "editar",
    ticketBase({ estado: "Cerrado" }), ticketBase({ estado: "EnNegociacion" }),
    { ...ADMIN, presupuestos: [presuBase({ estado: "Aprobado" })] });
});

prueba("R4 · no se firma contrato sobre presupuesto no aprobado", () => {
  const contrato = E.ENTIDADES.contratos.normalizar({
    id: "ctr_1", numero: "CT-2026-0001", origen: "comercial", clienteId: "cli_1",
    ticketId: "tk_1", presupuestoId: "pre_1", estado: "Firmado", fechaFirma: "2026-08-10",
  });
  rechaza("NX-004", () => R.validar("contratos", "crear", contrato, null, {
    ...ADMIN, presupuestos: [presuBase({ estado: "Enviado" })], tickets: [ticketBase()],
  }));
});

prueba("R5 · la campaña no cierra con estrategias abiertas", () => {
  const campana = E.ENTIDADES.campanas.normalizar({
    id: "cmp_1", nombre: "Congreso", fechaInicio: "2026-01-01",
    canales: ["Offline"], estado: "Finalizada", presupuestoAsignado: 10000,
  });
  rechaza("NX-005", () => R.validar("campanas", "editar", campana,
    { ...campana, estado: "Activa" },
    { ...ADMIN, estrategias: [{ id: "est_1", campanaId: "cmp_1", estado: "EnCurso" }] }));
});

prueba("transición ilegal de presupuesto se rechaza", () => {
  rechaza("NX-020", () => R.validar("presupuestos", "editar",
    presuBase({ estado: "Aprobado" }), presuBase({ estado: "Borrador" }),
    { ...ADMIN, tickets: [ticketBase()] }));
});

prueba("no se aprueba un presupuesto vencido", () => {
  const viejo = presuBase({ fecha: "2020-01-01", estado: "Aprobado" });
  rechaza("NX-021", () => R.validar("presupuestos", "editar", viejo,
    presuBase({ fecha: "2020-01-01", estado: "Enviado" }),
    { ...ADMIN, tickets: [ticketBase()] }));
});

prueba("un presupuesto sin ítems no sale de borrador", () => {
  rechaza("NX-040", () => R.validar("presupuestos", "editar",
    presuBase({ estado: "Enviado", items: [] }), presuBase({ items: [] }),
    { ...ADMIN, tickets: [ticketBase()] }));
});

prueba("no se aceptan totales que no salen de los ítems", () => {
  const manipulado = { ...presuBase({ estado: "Borrador" }), total: 1 };
  rechaza("NX-040", () => R.validar("presupuestos", "editar", manipulado,
    presuBase(), { ...ADMIN, tickets: [ticketBase()] }));
});

prueba("un ticket perdido exige motivo", () => {
  rechaza("NX-040", () => R.validar("tickets", "editar",
    ticketBase({ estado: "Perdido", motivoPerdida: "" }),
    ticketBase({ estado: "EnNegociacion" }), ADMIN));
});

prueba("el rol sin permiso no escribe", () => {
  rechaza("NX-010", () => R.validar("tickets", "crear", ticketBase(), null,
    { rol: "marketing", usuario: "gera" }));
});

prueba("el lead duplicado en la misma campaña se rechaza", () => {
  const lead = E.ENTIDADES.leads.normalizar({
    id: "led_2", campanaId: "cmp_1", canal: "Email",
    contactoNombre: "Juan", contactoEmail: "JUAN@x.com", fechaCaptura: "2026-08-01",
  });
  rechaza("NX-040", () => R.validar("leads", "crear", lead, null, {
    ...ADMIN,
    leads: [{ id: "led_1", campanaId: "cmp_1", contactoEmail: "juan@x.com" }],
  }));
});

prueba("no se factura con cotización vieja", () => {
  const f = E.ENTIDADES.facturaciones.normalizar({
    id: "fac_1", presupuestoId: "pre_1", numeroComprobante: "A-1",
    montoCotizado: 1000, monedaCotizacion: "USD",
    tcUnidad: "ARS", tcValor: 1400, tcFecha: "2020-01-01", tcFuente: "BNA",
    monedaLiquidacion: "ARS", montoLiquidado: 1400000, fechaEmision: E.hoy(),
  });
  rechaza("NX-031", () => R.validar("facturaciones", "crear", f, null, {
    ...ADMIN, presupuestos: [presuBase({ estado: "Aprobado" })],
  }));
});

prueba("efecto · el presupuesto enviado mueve el ticket a negociación", () => {
  const cambios = R.efectos("presupuestos", "editar", presuBase({ estado: "Enviado" }),
    presuBase({ estado: "Borrador" }), { tickets: [ticketBase({ estado: "EnPresupuesto" })] });
  cierto(cambios.some((c) => c.entidad === "tickets" && c.campos.estado === "EnNegociacion"));
});

prueba("efecto · el contrato firmado cierra el ticket", () => {
  const contrato = E.ENTIDADES.contratos.normalizar({
    id: "ctr_1", origen: "comercial", ticketId: "tk_1", presupuestoId: "pre_1",
    clienteId: "cli_1", estado: "Firmado", fechaFirma: "2026-08-12",
  });
  const cambios = R.efectos("contratos", "editar", contrato,
    { ...contrato, estado: "EnRevision" }, { tickets: [ticketBase()], leads: [] });
  const cierre = cambios.find((c) => c.entidad === "tickets");
  igual(cierre.campos.estado, "Cerrado");
  igual(cierre.campos.fechaCierre, "2026-08-12");
});

// ===========================================================================
// KPI
// ===========================================================================

const universo = [
  ticketBase({ id: "t1", estado: "Cerrado", fechaCierre: "2026-08-21", montoEstimado: 10000 }),
  ticketBase({ id: "t2", estado: "Cerrado", fechaCierre: "2026-08-11", montoEstimado: 20000 }),
  ticketBase({ id: "t3", estado: "Perdido", fechaCierre: "2026-08-03", montoEstimado: 5000, motivoPerdida: "precio" }),
  ticketBase({ id: "t4", estado: "EnNegociacion", montoEstimado: 30000 }),
  ticketBase({ id: "t5", estado: "Nuevo", montoEstimado: 8000 }),
];

prueba("la conversión se mide sobre resueltos, no sobre todos", () => {
  const m = K.comercial(universo, {});
  igual(m.resueltos, 3);
  igual(m.tasaConversion, 66.67, "2 ganados de 3 resueltos");
  igual(m.conversionGlobal, 40, "2 ganados de 5 totales");
});

prueba("el ciclo promedia solo los ganados", () => {
  const m = K.comercial(universo, {});
  igual(m.cicloMuestra, 2, "solo los dos cerrados");
  igual(m.cicloPromedio, 15, "(20 + 10) / 2");
});

prueba("el pipeline ponderado aplica la probabilidad de cada etapa", () => {
  const m = K.comercial(universo, {});
  igual(m.pipeline.USD, 38000, "30000 + 8000 sin ponderar");
  igual(m.pipelinePonderado.USD, 18800, "30000×0,6 + 8000×0,1");
});

prueba("división por cero devuelve null, nunca cero", () => {
  const m = K.comercial([ticketBase({ estado: "Nuevo" })], {});
  igual(m.tasaConversion, null, "sin resueltos no hay tasa");
  igual(m.cicloPromedio, null, "sin ganados no hay ciclo");
  igual(K.pct(5, 0), null);
});

prueba("los importes nunca se mezclan entre monedas", () => {
  const mixto = [
    ticketBase({ id: "a", estado: "Cerrado", fechaCierre: "2026-08-05", montoEstimado: 1000, moneda: "USD" }),
    ticketBase({ id: "b", estado: "Cerrado", fechaCierre: "2026-08-05", montoEstimado: 500000, moneda: "ARS" }),
  ];
  const m = K.comercial(mixto, {});
  igual(m.ingresos, { USD: 1000, ARS: 500000 }, "cada moneda por separado");
  cierto(!("total" in m.ingresos), "no existe un total único");
});

prueba("el contrato recurrente se anualiza para poder compararlo", () => {
  const contrato = E.ENTIDADES.contratos.normalizar({
    id: "c1", origen: "comercial", ticketId: "t1", presupuestoId: "p1", clienteId: "cli_1",
    estado: "Activo", fechaFirma: "2026-08-01", recurrencia: "mensual",
    economico: { canonMensual: 4000, moneda: "USD" },
  });
  const m = K.comercial([universo[0]], { contratos: [contrato] });
  igual(m.ingresos.USD, 48000, "4000 × 12");
});

prueba("el win rate por tipo lleva el tamaño de muestra", () => {
  const filas = K.porTipo(universo, {});
  const servicio = filas.find((f) => f.tipo === "Servicio");
  igual(servicio.resueltos, 3, "sin el n, un 66% no se puede interpretar");
});

prueba("el forecast devuelve una banda, no un número", () => {
  const [f30] = K.forecast(universo, {}, [30]);
  cierto(f30.piso.USD <= f30.esperado.USD, "piso ≤ esperado");
  cierto(f30.esperado.USD <= f30.techo.USD, "esperado ≤ techo");
});

prueba("el ROI de campaña no cruza monedas", () => {
  const campanas = [E.ENTIDADES.campanas.normalizar({
    id: "cmp_1", nombre: "Congreso", moneda: "USD", presupuestoAsignado: 12000,
    fechaInicio: "2026-01-01", canales: ["Offline"], estado: "Activa",
  })];
  const [c] = K.porCampana(campanas, {
    estrategias: [{ id: "e1", campanaId: "cmp_1", inversion: 12000, estado: "Finalizada" }],
    leads: [{ id: "l1", campanaId: "cmp_1", canal: "Offline", ticketId: "t1", estado: "Convertido" }],
    tickets: [ticketBase({ id: "t1", campanaId: "cmp_1", estado: "Cerrado", fechaCierre: "2026-08-05", montoEstimado: 96000 })],
    contratos: [],
  });
  igual(c.inversion, 12000);
  igual(c.roi, 700, "(96000 − 12000) / 12000");
  igual(c.costoPorLead, 12000);
});

prueba("ROI null cuando no hubo inversión", () => {
  const campanas = [E.ENTIDADES.campanas.normalizar({
    id: "c2", nombre: "Orgánico", fechaInicio: "2026-01-01", canales: ["Redes"], moneda: "USD",
  })];
  const [c] = K.porCampana(campanas, { estrategias: [], leads: [], tickets: [], contratos: [] });
  igual(c.roi, null, "dividir por cero no es ROI infinito");
});

prueba("la inversión sin leads no se reparte con criterio inventado", () => {
  const r = K.porCanal({
    estrategias: [{ id: "e1", campanaId: "c1", inversion: 5000, estado: "Finalizada" }],
    leads: [], tickets: [], contratos: [],
  });
  igual(r.inversionSinAtribuir, 5000);
});

prueba("los presupuestos separan pago único de abono mensual", () => {
  const m = K.presupuestos([
    presuBase({ id: "p1", estado: "Aprobado" }),
    presuBase({ id: "p2", estado: "Aprobado",
      items: [{ detalle: "abono", cantidad: 1, unitario: 4000 }],
      economico: { moneda: "USD", recurrencia: "mensual", descuentoPct: 0, validezDias: 15 } }),
  ]);
  igual(m.aprobadoUnico.USD, 18500);
  igual(m.aprobadoMensual.USD, 4000, "el abono no se suma con la venta única");
});

prueba("los presupuestos NO mezclan monedas: la moneda vive en economico", () => {
  // Regresión: cuando porMoneda buscaba `moneda` en la raíz del presupuesto,
  // no la encontraba y caía a USD, sumando pesos con dólares.
  const m = K.presupuestos([
    presuBase({ id: "p1", estado: "Aprobado",
      items: [{ detalle: "abono", cantidad: 1, unitario: 3100 }],
      economico: { moneda: "USD", recurrencia: "mensual", descuentoPct: 0, validezDias: 15 } }),
    presuBase({ id: "p2", estado: "Aprobado",
      items: [{ detalle: "abono", cantidad: 1, unitario: 6060000 }],
      economico: { moneda: "ARS", recurrencia: "mensual", descuentoPct: 0, validezDias: 15 } }),
  ]);
  igual(m.aprobadoMensual, { USD: 3100, ARS: 6060000 }, "cada moneda en su balde");
  cierto(m.aprobadoMensual.USD !== 6063100, "no puede existir el total mezclado");
});

prueba("un importe sin moneda no se asume USD", () => {
  const r = K.porMoneda([{ v: 100 }], "v", "moneda");
  igual(r, { SIN_MONEDA: 100 }, "asumir moneda es como se fabrican los totales falsos");
});

prueba("el cierre estimado no produce un ciclo de 0 días", () => {
  // Regresión: los tickets migrados traen fecha de cierre deducida igual a la
  // de alta. Contarlos daba un ciclo promedio de 0.
  const migrado = ticketBase({ id: "m1", estado: "Cerrado",
    fecha: "2026-08-01", fechaCierre: "2026-08-01", cierreEstimado: true });
  const real = ticketBase({ id: "r1", estado: "Cerrado",
    fecha: "2026-08-01", fechaCierre: "2026-08-21" });

  igual(K.comercial([migrado], {}).cicloPromedio, null, "sin dato real no hay ciclo");
  igual(K.comercial([migrado], {}).cicloMuestra, 0);

  const mezcla = K.comercial([migrado, real], {});
  igual(mezcla.cicloPromedio, 20, "solo promedia el que tiene cierre observado");
  igual(mezcla.cicloMuestra, 1);
});

prueba("el ingreso recurrente solo cuenta contratos vivos", () => {
  const mk = (id, estado, canon) => E.ENTIDADES.contratos.normalizar({
    id, origen: "independiente", clienteId: "cli_1", estado, recurrencia: "mensual",
    fechaFirma: "2026-01-01", economico: { canonMensual: canon, moneda: "USD" },
  });
  const r = K.recurrente([mk("c1", "Activo", 3000), mk("c2", "Borrador", 9999), mk("c3", "Firmado", 2000)]);
  igual(r.contratos, 2);
  igual(r.mensual.USD, 5000);
  igual(r.anual.USD, 60000);
});

prueba("alerta crítica si falta cotización", () => {
  const a = K.alertas({ tickets: [], presupuestos: [], campanas: [], tiposCambio: [] });
  cierto(a.some((x) => x.clave === "tc_ARS" && x.nivel === "critico"));
});

// ===========================================================================
// ALMACÉN
// ===========================================================================

prueba("el índice resume sin necesidad de abrir particiones", () => {
  const alm = new A.Almacen({ owner: "x", dataRepo: "y", branch: "main" });
  alm.indice = alm._indiceVacio();
  alm._registrarEnIndice("tickets", "2026-08", universo);

  const r = alm.resumen("tickets", ["2026-08"]);
  igual(r.cantidad, 5);
  igual(r.porEstado.Cerrado, 2);
  igual(r.montoPorEstado["EnNegociacion|USD"], 30000);
});

prueba("los períodos vienen del más reciente al más viejo", () => {
  const alm = new A.Almacen({ owner: "x", dataRepo: "y", branch: "main" });
  alm.indice = alm._indiceVacio();
  for (const p of ["2026-06", "2026-08", "2026-07"]) {
    alm._registrarEnIndice("tickets", p, [ticketBase({ fecha: `${p}-01` })]);
  }
  igual(alm.periodos("tickets"), ["2026-08", "2026-07", "2026-06"]);
  igual(alm.periodosRecientes("tickets", 2), ["2026-08", "2026-07"]);
});

prueba("la ruta de partición depende de si la entidad es particionada", () => {
  const alm = new A.Almacen({ owner: "x", dataRepo: "y", branch: "main" });
  igual(alm._ruta("tickets", "2026-08"), "data/tickets/2026-08.json");
  igual(alm._ruta("clientes", null), "data/clientes.json");
});

prueba("la numeración de contratos es anual y propia", () => {
  const alm = new A.Almacen({ owner: "x", dataRepo: "y", branch: "main" });
  alm.indice = alm._indiceVacio();
  const a = alm.proximoNumeroContrato("2026");
  igual(a.numero, "CT-2026-0001");
  alm.confirmarSecuencia(a.clave, a.n);
  igual(alm.proximoNumeroContrato("2026").numero, "CT-2026-0002");
  igual(alm.proximoNumeroContrato("2027").numero, "CT-2027-0001", "cada año arranca en 1");
});

prueba("tickets y presupuestos comparten la secuencia mensual", () => {
  const alm = new A.Almacen({ owner: "x", dataRepo: "y", branch: "main" });
  alm.indice = alm._indiceVacio();
  const s = alm.proximaSecuenciaMes();
  igual(s.ticket.slice(3), s.presupuesto.slice(1), "mismo sufijo AAAAMMNN");
});

// ===========================================================================
// ADAPTADOR · traducción entre la forma vieja y el modelo v3
// ===========================================================================

const ticketViejo = (over = {}) => ({
  id: "tk_1", numero: "TK-20260801", fecha: "2026-08-01",
  cliente: { nombreComercial: "Centro Ejemplo", razonesSociales: [], contacto: "" },
  tipoPedido: "servicio", descripcion: "Reemplazo de cold head",
  estado: "presupuestado", presupuestoIds: ["pre_1"], usuario: "test",
  historial: [{ estado: "abierto", fecha: "2026-08-01", usuario: "test" }], ...over,
});

const presuViejo = (over = {}) => ({
  id: "pre_1", numero: "P20260801", tipo: "servicio", subtipo: "",
  titulo: "Cold head", estado: "borrador", estadoOrigen: "No enviado",
  fecha: "2026-08-01", ticketId: "tk_1",
  cliente: { nombreComercial: "Centro Ejemplo", razonesSociales: [] },
  items: [{ detalle: "Cold head", sku: "", cantidad: 1, unitario: 18500,
            intercambio: false, unitarioIntercambio: null }],
  garantia: { aplica: true, dias: 90, texto: "" },
  economico: { moneda: "USD", ivaPct: 21, incluyeIVA: false, validezDias: 15,
               formaPago: "", descuentoPct: 0, recurrencia: "unica" },
  notas: "", archivos: [], usuario: "test", historialEstados: [], ...over,
});

prueba("deriva el padrón de clientes deduplicado desde los registros", () => {
  const cs = AD.clientesDesde({
    tickets: [ticketViejo(), ticketViejo({ id: "tk_2", cliente: { nombreComercial: "CENTRO EJEMPLO" } })],
    presupuestos: [], data: [],
  });
  igual(cs.length, 1, "dos grafías del mismo nombre son un solo cliente");
  cierto(cs[0].alias.length === 2, "conserva las dos grafías como alias");
});

prueba("traduce estados de ticket en ambas direcciones", () => {
  const idx = AD.indiceClientes(AD.clientesDesde({ tickets: [ticketViejo()] }));
  const ctx = { indiceClientes: idx, presupuestos: [presuViejo()] };
  // "presupuestado" con presupuesto en borrador es EnPresupuesto, no negociación.
  igual(AD.ticketANuevo(ticketViejo(), ctx).estado, "EnPresupuesto");
  igual(AD.ticketANuevo(ticketViejo(), { indiceClientes: idx,
    presupuestos: [presuViejo({ estado: "enviado" })] }).estado, "EnNegociacion");
  igual(AD.ticketANuevo(ticketViejo({ estado: "ganado" }), ctx).estado, "Cerrado");
});

// El precio con intercambio y la garantía son campos que el adaptador ya
// descartaba (o descartaría) en silencio. Los dos cambian plata o compromiso
// asumido, así que van con prueba propia en las dos direcciones.
prueba("conserva el precio con intercambio en el ida y vuelta", () => {
  const idx = AD.indiceClientes(AD.clientesDesde({ tickets: [ticketViejo()] }));
  const viejo = presuViejo({
    items: [{ detalle: "Amplificador RF S-30", sku: "S30", cantidad: 1,
              unitario: 34000, intercambio: true, unitarioIntercambio: 22900 }],
  });
  const nuevo = AD.presupuestoANuevo(viejo, { indiceClientes: idx });
  igual(nuevo.items[0].unitarioIntercambio, 22900, "guarda el precio con intercambio");
  cierto(nuevo.items[0].intercambio, "guarda que se toma el intercambio");
  // Con intercambio rige ese precio, no el de lista: 22.900, no 34.000.
  igual(nuevo.items[0].total, 22900, "el total usa el precio con intercambio");
  igual(nuevo.total, 22900, "el total del presupuesto no cotiza el precio de lista");
  const vuelta = AD.presupuestoAViejo(nuevo, {});
  igual(vuelta.items[0].unitarioIntercambio, 22900, "la vuelta conserva el precio");
  igual(vuelta.items[0].sku, "S30", "la vuelta conserva el SKU");
});

prueba("conserva la garantía acordada en el ida y vuelta", () => {
  const idx = AD.indiceClientes(AD.clientesDesde({ tickets: [ticketViejo()] }));
  const viejo = presuViejo({ garantia: { aplica: true, dias: 180, texto: "" } });
  const nuevo = AD.presupuestoANuevo(viejo, { indiceClientes: idx });
  igual(nuevo.garantia.dias, 180, "no vuelve al default de 90 días");
  igual(AD.presupuestoAViejo(nuevo, {}).garantia.dias, 180, "la vuelta la conserva");
  // Un presupuesto sin garantía explícita no puede quedar prometiendo una.
  const sin = AD.presupuestoANuevo(presuViejo({ garantia: { aplica: false } }), { indiceClientes: idx });
  igual(sin.garantia.aplica, false, "respeta que no se ofrezca garantía");
});

prueba("el ida y vuelta no pierde información", () => {
  const clientes = AD.clientesDesde({ tickets: [ticketViejo()] });
  const idx = AD.indiceClientes(clientes);
  const ctx = { indiceClientes: idx, presupuestos: [presuViejo()] };

  const nuevo = AD.ticketANuevo(ticketViejo({ estado: "ganado" }), ctx);
  const vuelta = AD.ticketAViejo(nuevo, { clientes });
  const otraVez = AD.ticketANuevo({ ...vuelta, presupuestoIds: nuevo.presupuestoIds }, ctx);

  for (const campo of ["id", "numero", "fecha", "clienteId", "estado", "tipo",
                       "descripcion", "fechaCierre", "motivoPerdida"]) {
    igual(otraVez[campo], nuevo[campo], `campo ${campo}`);
  }
});

prueba("el monto del ticket sale del presupuesto y anualiza los abonos", () => {
  const idx = AD.indiceClientes(AD.clientesDesde({ tickets: [ticketViejo()] }));
  const mensual = presuViejo({
    items: [{ detalle: "abono", cantidad: 1, unitario: 4000 }],
    economico: { moneda: "USD", recurrencia: "mensual", descuentoPct: 0, validezDias: 15 },
  });
  const t = AD.ticketANuevo(ticketViejo(), { indiceClientes: idx, presupuestos: [mensual] });
  igual(t.montoEstimado, 48000, "4000/mes × 12");
  igual(t.recurrencia, "mensual");
});

prueba("valida sobre la forma vieja: R3 corta el cierre", () => {
  rechaza("NX-003", () => AD.validarEnFormaVieja("tickets", "editar",
    ticketViejo({ estado: "ganado" }), ticketViejo(),
    { tickets: [ticketViejo()], presupuestos: [presuViejo({ estado: "enviado" })],
      contratos: [], rol: "admin", usuario: "test" }));
});

prueba("valida sobre la forma vieja: con aprobado, pasa y devuelve efectos", () => {
  const r = AD.validarEnFormaVieja("presupuestos", "editar",
    presuViejo({ estado: "enviado" }), presuViejo(),
    { tickets: [ticketViejo()], presupuestos: [presuViejo()], contratos: [],
      rol: "admin", usuario: "test" });
  cierto(r.ok);
  cierto(r.efectos.some((e) => e.entidad === "tickets" && e.campos.estado === "EnNegociacion"),
    "el envío empuja el ticket a negociación");
});

prueba("los KPIs se calculan sobre el estado viejo sin tocar los datos", () => {
  const estado = {
    tickets: [ticketViejo({ id: "a", estado: "ganado" }),
              ticketViejo({ id: "b", estado: "perdido", presupuestoIds: ["pre_2"] })],
    presupuestos: [presuViejo(), presuViejo({ id: "pre_2", ticketId: "b" })],
    data: [],
  };
  const n = AD.estadoANuevo(estado);
  const m = K.comercial(n.tickets, { contratos: n.contratos });
  igual(m.resueltos, 2);
  igual(m.tasaConversion, 50);
});

// ===========================================================================
// CAMBIO · tipos de cambio y facturación
// ===========================================================================

const serieBase = [
  { unidad: "ARS", fecha: E.hoy(), tasa: 1520, fuente: "BNA vendedor" },
  { unidad: "CLP", fecha: E.hoy(), tasa: 907.3, fuente: "USD/CLP vendedor" },
  { unidad: "COP", fecha: E.hoy(), tasa: 3900, fuente: "exchangerate-api" },
  { unidad: "UYU", fecha: E.hoy(), tasa: 41.3, fuente: "USD/UYU vendedor" },
  { unidad: "UF", fecha: E.hoy(), tasa: 40844.79, fuente: "mindicador.cl" },
].map((x) => E.ENTIDADES.tiposCambio.normalizar(x));

prueba("toma la última cotización no posterior a la fecha", () => {
  const serie = [
    E.ENTIDADES.tiposCambio.normalizar({ unidad: "ARS", fecha: "2026-08-01", tasa: 1400 }),
    E.ENTIDADES.tiposCambio.normalizar({ unidad: "ARS", fecha: "2026-08-03", tasa: 1420 }),
  ];
  igual(C.cotizacion(serie, "ARS", "2026-08-02").tasa, 1400, "el viernes rige hasta el lunes");
  igual(C.cotizacion(serie, "ARS", "2026-08-05").tasa, 1420);
  igual(C.cotizacion(serie, "ARS", "2026-07-30"), null, "no inventa hacia atrás");
});

prueba("Estados Unidos no convierte: ya está en la moneda de destino", () => {
  const r = C.convertir(18500, "US", E.hoy(), []);
  igual(r.monto, 18500);
  igual(r.moneda, "USD");
  igual(r.tasa, 1, "sin necesitar la serie");
});

prueba("cada país convierte con su propia cotización", () => {
  igual(C.convertir(1000, "AR", E.hoy(), serieBase).monto, 1520000);
  igual(C.convertir(1000, "CL", E.hoy(), serieBase).monto, 907300);
  igual(C.convertir(1000, "CO", E.hoy(), serieBase).monto, 3900000);
  igual(C.convertir(1000, "UY", E.hoy(), serieBase).monto, 41300);
});

prueba("sin cotización del país no se inventa un número", () => {
  rechaza("NX-030", () => C.convertir(1000, "AR", E.hoy(), []));
  rechaza("NX-032", () => C.convertir(1000, "XX", E.hoy(), serieBase));
});

prueba("el equivalente en UF es informativo y sale de CLP", () => {
  // 1.000 USD × 907,3 CLP = 907.300 CLP ÷ 40.844,79 CLP/UF
  igual(C.equivalenteUF(1000, E.hoy(), serieBase), 22.21);
  igual(C.equivalenteUF(1000, E.hoy(), []), null, "sin serie, no adivina");
});

prueba("factura congelando el tipo de cambio, la fecha y la fuente", () => {
  const p = presuBase({ estado: "Aprobado" });
  const f = C.prepararFacturacion(p, { serie: serieBase, numeroComprobante: "A-0001" });
  igual(f.monedaCotizacion, "USD");
  igual(f.montoCotizado, 18500);
  igual(f.tcValor, 1520);
  cierto(f.tcFuente.includes("BNA"));
  igual(f.monedaLiquidacion, "ARS");
  igual(f.montoNeto, 28120000, "18.500 × 1.520");
  igual(f.montoLiquidado, 34025200, "más 21% de IVA");
});

prueba("un presupuesto de Chile se factura en CLP con referencia en UF", () => {
  const p = presuBase({ estado: "Aprobado", pais: "CL" });
  const f = C.prepararFacturacion(p, { serie: serieBase });
  igual(f.monedaLiquidacion, "CLP");
  igual(f.montoNeto, 16785050, "18.500 USD × 907,30");
  cierto(f.referenciaUF > 0, "Chile lleva el equivalente en UF");
});

prueba("un presupuesto de Estados Unidos no necesita cotización", () => {
  const f = C.prepararFacturacion(presuBase({ estado: "Aprobado", pais: "US" }), { serie: [] });
  igual(f.monedaLiquidacion, "USD");
  igual(f.montoNeto, 18500, "el neto es el cotizado");
});

prueba("no se factura con cotización vieja", () => {
  const vieja = [E.ENTIDADES.tiposCambio.normalizar({
    unidad: "ARS", fecha: E.sumarDias(E.hoy(), -10), tasa: 1400 })];
  rechaza("NX-031", () => C.prepararFacturacion(
    presuBase({ estado: "Aprobado" }), { serie: vieja }));
});

prueba("no se factura un presupuesto que no está aprobado", () => {
  rechaza("NX-022", () => C.prepararFacturacion(
    presuBase({ estado: "Enviado" }), { serie: serieBase }));
});

prueba("recargar el mismo día pisa la cotización, no la duplica", () => {
  let s = C.upsert([], C.nuevaCotizacion("ARS", 1400, "2026-08-05"));
  s = C.upsert(s, C.nuevaCotizacion("ARS", 1412.5, "2026-08-05"));
  igual(s.length, 1);
  igual(s[0].tasa, 1412.5);
});

prueba("no se cargan cotizaciones a futuro ni negativas", () => {
  rechaza("NX-040", () => C.nuevaCotizacion("ARS", 1400, E.sumarDias(E.hoy(), 1)));
  rechaza("NX-040", () => C.nuevaCotizacion("ARS", -5, E.hoy()));
  rechaza("NX-040", () => C.nuevaCotizacion("EUR", 1, E.hoy()));
});

prueba("el estado de la serie reporta atraso por unidad", () => {
  const s = [E.ENTIDADES.tiposCambio.normalizar({
    unidad: "ARS", fecha: E.sumarDias(E.hoy(), -5), tasa: 1400 })];
  const est = C.estadoSerie(s);
  const ars = est.find((x) => x.unidad === "ARS");
  igual(ars.diasAtraso, 5);
  cierto(!ars.vigente, "5 días supera la tolerancia de 3");
  const uf = est.find((x) => x.unidad === "UF");
  igual(uf.valor, null, "sin cargar");
  cierto(!uf.vigente);
});

// ===========================================================================
// COMISIONES
// ===========================================================================

const VND = E.ENTIDADES.vendedores.normalizar({
  id: "vnd_1", nombre: "Vendedor Ejemplo", usuarioId: "vend", relacion: "Interno",
  fechaAlta: "2026-01-01", metaMensual: 20000, metaMoneda: "USD",
});

const acuerdoPct = (over = {}) => E.ENTIDADES.acuerdosComision.normalizar({
  id: "acu_1", vendedorId: "vnd_1", modalidad: "Porcentaje", porcentaje: 5,
  base: "Contrato", moneda: "USD", vigenciaDesde: "2026-01-01", ...over,
});

const ESCALONES = [
  { desde: 0, hasta: 20000, porcentaje: 3 },
  { desde: 20000, hasta: 50000, porcentaje: 5 },
  { desde: 50000, hasta: null, porcentaje: 7 },
];

prueba("comisión por porcentaje simple", () => {
  const r = CM.calcular(acuerdoPct(), 40000);
  igual(r.monto, 2000, "5% de 40.000");
  igual(r.porcentaje, 5);
});

prueba("el escalonado es marginal, no salta de golpe", () => {
  // 20.000×3% + 30.000×5% + 30.000×7% = 600 + 1500 + 2100
  const a = acuerdoPct({ modalidad: "Escalonada", escalones: ESCALONES });
  igual(CM.calcular(a, 80000).monto, 4200);
  // Vender 1 más no puede disparar la comisión: ese salto crea el incentivo
  // a demorar el cierre.
  const en50k = CM.calcular(a, 50000).monto;
  const en50k1 = CM.calcular(a, 50001).monto;
  cierto(en50k1 - en50k < 1, `salto de ${en50k1 - en50k} al pasar el tramo`);
});

prueba("el tope recorta y lo deja dicho", () => {
  const r = CM.calcular(acuerdoPct({ porcentaje: 10, tope: 3000 }), 100000);
  igual(r.monto, 3000);
  cierto(r.detalle.includes("topeado"), "el recorte tiene que quedar explicado");
});

prueba("modalidad mixta suma fijo más escalonado", () => {
  const a = acuerdoPct({ modalidad: "Mixta", montoFijo: 500, escalones: ESCALONES });
  igual(CM.calcular(a, 20000).monto, 1100, "500 + 3% de 20.000");
});

prueba("los escalones no pueden dejar huecos", () => {
  rechaza("NX-060", () => CM.validarEscalones([
    { desde: 0, hasta: 20000, porcentaje: 3 },
    { desde: 30000, hasta: null, porcentaje: 5 },   // hueco 20.000–30.000
  ]));
});

prueba("los escalones no pueden superponerse", () => {
  rechaza("NX-060", () => CM.validarEscalones([
    { desde: 0, hasta: 30000, porcentaje: 3 },
    { desde: 20000, hasta: null, porcentaje: 5 },
  ]));
});

prueba("el último escalón queda abierto y el primero arranca en 0", () => {
  rechaza("NX-060", () => CM.validarEscalones([{ desde: 0, hasta: 20000, porcentaje: 3 }]));
  rechaza("NX-060", () => CM.validarEscalones([{ desde: 100, hasta: null, porcentaje: 3 }]));
  CM.validarEscalones(ESCALONES);   // este sí es válido
});

prueba("la vigencia elige el acuerdo correcto por fecha", () => {
  const viejo = acuerdoPct({ id: "a1", porcentaje: 3, vigenciaDesde: "2026-01-01", vigenciaHasta: "2026-06-30" });
  const nuevo = acuerdoPct({ id: "a2", porcentaje: 6, vigenciaDesde: "2026-07-01" });
  igual(CM.acuerdoVigente([viejo, nuevo], "vnd_1", "2026-03-15").id, "a1");
  igual(CM.acuerdoVigente([viejo, nuevo], "vnd_1", "2026-08-15").id, "a2");
  igual(CM.acuerdoVigente([viejo, nuevo], "vnd_1", "2025-12-01"), null, "antes de todo: ninguno");
});

prueba("dos acuerdos del mismo vendedor no pueden solaparse", () => {
  const a = acuerdoPct({ id: "a1", vigenciaDesde: "2026-01-01", vigenciaHasta: "2026-12-31" });
  const b = acuerdoPct({ id: "a2", vigenciaDesde: "2026-06-01" });
  cierto(CM.seSolapa(b, a));
  rechaza("NX-067", () => R.validar("acuerdosComision", "crear", b, null,
    { ...ADMIN, vendedores: [VND], acuerdosComision: [a], comisiones: [] }));
});

prueba("un acuerdo ya usado no cambia de condiciones", () => {
  const a = acuerdoPct();
  const com = E.ENTIDADES.comisiones.normalizar({
    id: "com_1", vendedorId: "vnd_1", acuerdoId: "acu_1", origenId: "ctr_1",
    monto: 100, moneda: "USD", fechaDevengo: "2026-02-01" });
  rechaza("NX-068", () => R.validar("acuerdosComision", "editar",
    acuerdoPct({ porcentaje: 12 }), a,
    { ...ADMIN, vendedores: [VND], acuerdosComision: [a], comisiones: [com] }));
});

const contratoFirmado = (over = {}) => E.ENTIDADES.contratos.normalizar({
  id: "ctr_1", numero: "CT-2026-0001", origen: "comercial", clienteId: "cli_1",
  ticketId: "tk_1", presupuestoId: "pre_1", estado: "Firmado", fechaFirma: "2026-03-10",
  recurrencia: "unica", economico: { canonMensual: 40000, moneda: "USD" }, ...over,
});

prueba("devenga la comisión de un contrato firmado", () => {
  const [com] = CM.devengarPorContrato(contratoFirmado(), {
    vendedores: [VND], acuerdos: [acuerdoPct()], comisiones: [],
    tickets: [ticketBase({ id: "tk_1", vendedor: "vend" })],
  });
  igual(com.monto, 2000);
  igual(com.estado, "Devengada");
  igual(com.periodo, "2026-03");
  igual(com.origenNumero, "CT-2026-0001");
});

prueba("no devenga sobre un contrato sin firmar", () => {
  rechaza("NX-062", () => CM.devengarPorContrato(contratoFirmado({ estado: "Borrador", fechaFirma: null }), {
    vendedores: [VND], acuerdos: [acuerdoPct()], comisiones: [],
    tickets: [ticketBase({ id: "tk_1", vendedor: "vend" })] }));
});

prueba("no devenga dos veces la misma operación", () => {
  const ctxb = {
    vendedores: [VND], acuerdos: [acuerdoPct()],
    tickets: [ticketBase({ id: "tk_1", vendedor: "vend" })],
    comisiones: [E.ENTIDADES.comisiones.normalizar({
      id: "com_1", vendedorId: "vnd_1", acuerdoId: "acu_1",
      origenTipo: "Contrato", origenId: "ctr_1", monto: 2000, moneda: "USD" })],
  };
  rechaza("NX-063", () => CM.devengarPorContrato(contratoFirmado(), ctxb));
});

prueba("sin acuerdo vigente no se devenga", () => {
  rechaza("NX-061", () => CM.devengarPorContrato(contratoFirmado(), {
    vendedores: [VND], acuerdos: [acuerdoPct({ vigenciaHasta: "2026-01-31" })],
    comisiones: [], tickets: [ticketBase({ id: "tk_1", vendedor: "vend" })] }));
});

prueba("no se cruzan monedas entre contrato y acuerdo", () => {
  rechaza("NX-065", () => CM.devengarPorContrato(
    contratoFirmado({ economico: { canonMensual: 40000, moneda: "UF" } }), {
      vendedores: [VND], acuerdos: [acuerdoPct()], comisiones: [],
      tickets: [ticketBase({ id: "tk_1", vendedor: "vend" })] }));
});

prueba("un abono mensual comisiona sobre los meses pactados", () => {
  const [com] = CM.devengarPorContrato(
    contratoFirmado({ recurrencia: "mensual", economico: { canonMensual: 4000, moneda: "USD" },
      vigencia: { meses: 12 } }), {
      vendedores: [VND], acuerdos: [acuerdoPct({ mesesRecurrente: 6 })], comisiones: [],
      tickets: [ticketBase({ id: "tk_1", vendedor: "vend" })] });
  igual(com.baseCalculo, 24000, "4.000/mes × 6 meses pactados");
  igual(com.monto, 1200);
});

prueba("el circuito de estados no se saltea", () => {
  const base = E.ENTIDADES.comisiones.normalizar({
    id: "com_1", vendedorId: "vnd_1", acuerdoId: "acu_1", monto: 2000,
    moneda: "USD", fechaDevengo: "2026-03-10", origenId: "ctr_1" });
  const c = { ...ADMIN, vendedores: [VND], acuerdosComision: [acuerdoPct()],
    acuerdos: [acuerdoPct()], comisiones: [base], facturaciones: [] };
  // Devengada no salta directo a Liquidada
  rechaza("NX-020", () => R.validar("comisiones", "editar",
    { ...base, estado: "Liquidada" }, base, c));
  // Liquidada es terminal
  rechaza("NX-020", () => R.validar("comisiones", "editar",
    { ...base, estado: "Aprobada" }, { ...base, estado: "Liquidada" }, c));
});

prueba("nadie aprueba su propia comisión", () => {
  const base = E.ENTIDADES.comisiones.normalizar({
    id: "com_1", vendedorId: "vnd_1", acuerdoId: "acu_1", monto: 2000, moneda: "USD" });
  rechaza("NX-012", () => R.validar("comisiones", "editar",
    { ...base, estado: "Aprobada" }, base,
    { rol: "gerente_comercial", usuario: "vend", vendedores: [VND],
      acuerdosComision: [acuerdoPct()], comisiones: [base] }));
});

prueba("con pago tras cobro no se liquida sin factura", () => {
  const aprobada = E.ENTIDADES.comisiones.normalizar({
    id: "com_1", vendedorId: "vnd_1", acuerdoId: "acu_1", origenId: "ctr_1",
    monto: 2000, moneda: "USD", estado: "Aprobada" });
  const sinFactura = CM.puedeLiquidarse(aprobada, { acuerdos: [acuerdoPct()], facturaciones: [] });
  cierto(!sinFactura.puede);
  cierto(sinFactura.motivo.includes("cobro"));

  const conFactura = CM.puedeLiquidarse(aprobada, {
    acuerdos: [acuerdoPct()],
    facturaciones: [{ contratoId: "ctr_1", presupuestoId: "pre_1" }] });
  cierto(conFactura.puede);
});

prueba("sin pago tras cobro se liquida directo", () => {
  const aprobada = E.ENTIDADES.comisiones.normalizar({
    id: "com_1", vendedorId: "vnd_1", acuerdoId: "acu_1", origenId: "ctr_1",
    monto: 2000, moneda: "USD", estado: "Aprobada" });
  cierto(CM.puedeLiquidarse(aprobada,
    { acuerdos: [acuerdoPct({ pagoTrasCobro: false })], facturaciones: [] }).puede);
});

prueba("no se da de baja a un vendedor con comisiones sin liquidar", () => {
  const com = E.ENTIDADES.comisiones.normalizar({
    id: "com_1", vendedorId: "vnd_1", acuerdoId: "acu_1", monto: 2000,
    moneda: "USD", estado: "Aprobada" });
  rechaza("NX-066", () => R.validar("vendedores", "editar",
    { ...VND, estado: "Inactivo", fechaBaja: E.hoy() }, VND,
    { ...ADMIN, vendedores: [VND], comisiones: [com] }));
});

prueba("no se duplica un vendedor por documento", () => {
  const v1 = E.ENTIDADES.vendedores.normalizar({ id: "vnd_1", nombre: "Uno", documento: "20-1-9" });
  const v2 = E.ENTIDADES.vendedores.normalizar({ id: "vnd_2", nombre: "Otro", documento: "20-1-9" });
  rechaza("NX-040", () => R.validar("vendedores", "crear", v2, null,
    { ...ADMIN, vendedores: [v1], comisiones: [] }));
});

prueba("el resumen de comisiones no mezcla monedas", () => {
  const mk = (id, est, monto, mon) => E.ENTIDADES.comisiones.normalizar({
    id, vendedorId: "vnd_1", acuerdoId: "acu_1", estado: est, monto, moneda: mon });
  const r = CM.resumen([mk("c1", "Devengada", 2000, "USD"), mk("c2", "Devengada", 500, "UF"),
                        mk("c3", "Liquidada", 1000, "USD")]);
  igual(r.Devengada, { USD: 2000, UF: 500 });
  igual(r.Liquidada, { USD: 1000 });
});

prueba("el panel del equipo cruza ventas con comisiones", () => {
  const tks = [
    ticketBase({ id: "t1", vendedor: "vend", estado: "Cerrado", fechaCierre: "2026-03-20", montoEstimado: 40000 }),
    ticketBase({ id: "t2", vendedor: "vend", estado: "Perdido", fechaCierre: "2026-03-05", montoEstimado: 5000, motivoPerdida: "precio" }),
  ];
  const com = E.ENTIDADES.comisiones.normalizar({
    id: "com_1", vendedorId: "vnd_1", acuerdoId: "acu_1", monto: 2000,
    moneda: "USD", estado: "Devengada" });
  const [p] = CM.panelVendedores([VND], { tickets: tks, contratos: [], comisiones: [com] });
  igual(p.ganados, 1);
  igual(p.tasaConversion, 50);
  igual(p.pendienteDePago, 2000);
  igual(p.cumplimiento, 200, "40.000 sobre una cuota de 20.000");
  igual(p.costoComercial, 5, "2.000 de comisión sobre 40.000 vendidos");
});

prueba("un contrato de venta única no se valúa como abono anual", () => {
  // Regresión: el adaptador fijaba recurrencia "mensual" para todo contrato en
  // forma vieja, así que una venta única de 80.000 se comisionaba sobre 960.000.
  const idx = AD.indiceClientes(AD.clientesDesde({ tickets: [ticketViejo()] }));
  const base = { id: "ctr_x", numero: "CT-1", estado: "firmado", ticketId: "tk_1",
    presupuestoId: "pre_1", origen: "comercial",
    cliente: { nombreComercial: "Centro Ejemplo", razonesSociales: [] },
    economico: { canonMensual: 80000, moneda: "USD" }, vigencia: { meses: 12 },
    fechas: { creado: "2026-03-10", firmado: "2026-03-10" } };

  igual(AD.contratoANuevo(base, { indiceClientes: idx }).recurrencia, "mensual",
    "sin campo, se asume abono: es lo que son todos los históricos");
  igual(AD.contratoANuevo({ ...base, recurrencia: "unica" }, { indiceClientes: idx }).recurrencia,
    "unica", "con el campo explícito se respeta");
});

// ---------------------------------------------------------------------------
// Reparto interno por área
// ---------------------------------------------------------------------------

prueba("el reparto interno suma 4,5% y cubre los cinco países", () => {
  const total = CM.REPARTO_INTERNO.reduce((s, r) => s + r.porcentaje, 0);
  igual(total, 4.5, "3 + 0,5 + 0,5 + 0,5");
  igual(CM.PAISES_REPARTO, ["AR", "CL", "CO", "UY", "US"]);
  const acus = CM.acuerdosReparto("2026-01-01");
  igual(acus.length, 4);
  cierto(acus.every((a) => a.alcance === "Area" && a.base === "Neto"));
  cierto(acus.every((a) => !a.pagoTrasCobro), "el reparto no espera al cobro");
});

prueba("el reparto alcanza solo a los países listados", () => {
  const [ger] = CM.acuerdosReparto("2026-01-01");
  cierto(CM.alcanzaPais(ger, "AR"));
  cierto(CM.alcanzaPais(ger, "US"));
  cierto(!CM.alcanzaPais(ger, "BR"), "Brasil no está en el reparto");
});

prueba("devenga la comisión del vendedor MÁS las cuatro de área", () => {
  const coms = CM.devengarPorContrato(contratoFirmado(), {
    vendedores: [VND],
    acuerdos: [acuerdoPct(), ...CM.acuerdosReparto("2026-01-01")],
    comisiones: [], tickets: [ticketBase({ id: "tk_1", vendedor: "vend" })],
    presupuestos: [presuBase({ id: "pre_1", estado: "Aprobado" })],
  });
  igual(coms.length, 5, "1 del vendedor + 4 áreas");
  const porArea = Object.fromEntries(
    coms.filter((c) => c.alcance === "Area").map((c) => [c.area, c.monto]));
  // Base 40.000 sin IVA incluido -> el neto es el total
  igual(porArea["Gerencia comercial"], 1200, "3% de 40.000");
  igual(porArea["Marketing"], 200, "0,5%");
  igual(porArea["Diseño"], 200);
  igual(porArea["Ventas"], 200);
  const vendedorCom = coms.find((c) => c.alcance === "Vendedor");
  igual(vendedorCom.monto, 2000, "5% pactado");
});

prueba("el reparto corre aunque no haya vendedor asignado", () => {
  const coms = CM.devengarPorContrato(contratoFirmado(), {
    vendedores: [], acuerdos: CM.acuerdosReparto("2026-01-01"),
    comisiones: [], tickets: [], permitirSinVendedor: true,
  });
  igual(coms.length, 4, "solo las de área");
  cierto(coms.every((c) => c.alcance === "Area"));
});

prueba("un país fuera del alcance del acuerdo no devenga esa área", () => {
  // Acuerdo de área acotado a Argentina: una venta chilena no lo activa.
  const soloAR = E.ENTIDADES.acuerdosComision.normalizar({
    id: "acu_ar", alcance: "Area", area: "Gerencia comercial", paises: ["AR"],
    modalidad: "Porcentaje", porcentaje: 3, base: "Neto",
    moneda: "USD", vigenciaDesde: "2026-01-01" });

  igual(CM.acuerdosDeArea([soloAR], "AR", "2026-03-10").length, 1);
  igual(CM.acuerdosDeArea([soloAR], "CL", "2026-03-10").length, 0);

  rechaza("NX-061", () => CM.devengarPorContrato(
    contratoFirmado({ pais: "CL" }), {
      vendedores: [], acuerdos: [soloAR],
      comisiones: [], tickets: [], permitirSinVendedor: true }));
});

prueba("la base Neto descuenta el IVA cuando el precio lo incluye", () => {
  const conIVA = presuBase({ id: "pre_1", estado: "Aprobado",
    economico: { moneda: "USD", validezDias: 15, descuentoPct: 0,
      recurrencia: "unica", ivaPct: 21, incluyeIVA: true } });
  // total 18.500 con IVA incluido -> neto 15.289,26
  igual(conIVA.neto, 15289.26);

  const [com] = CM.devengarPorContrato(
    contratoFirmado({ economico: { canonMensual: 18500, moneda: "USD" } }), {
      vendedores: [VND], acuerdos: [acuerdoPct({ base: "Neto" })], comisiones: [],
      tickets: [ticketBase({ id: "tk_1", vendedor: "vend" })],
      presupuestos: [conIVA] });
  igual(com.baseCalculo, 15289.26, "comisiona sobre el neto, no sobre el IVA");
  igual(com.monto, 764.46, "5% del neto");
  cierto(com.detalleCalculo.includes("neto sin IVA"));
});

prueba("sin IVA incluido, el neto es el total", () => {
  igual(presuBase().neto, 18500);
});

prueba("dos acuerdos de la misma área con países cruzados se solapan", () => {
  const [ger] = CM.acuerdosReparto("2026-01-01");
  const otro = E.ENTIDADES.acuerdosComision.normalizar({
    id: "acu_x", alcance: "Area", area: "Gerencia comercial", paises: ["AR"],
    modalidad: "Porcentaje", porcentaje: 4, vigenciaDesde: "2026-06-01" });
  cierto(CM.seSolapa(otro, ger));

  // Distinta área: no se pisan
  const marketing = CM.acuerdosReparto("2026-01-01")[1];
  cierto(!CM.seSolapa(otro, marketing));
});

// ---------------------------------------------------------------------------
// Ida y vuelta sin pérdida · requisito para migrar al almacén particionado
// ---------------------------------------------------------------------------

const contratoViejo = (over = {}) => ({
  id: "ctr_1", tipo: "contrato", numero: "CT-2026-0001", estado: "firme_vigente",
  cliente: { nombreComercial: "Centro Ejemplo", razonesSociales: [
    { razonSocial: "Centro Ejemplo S.A.", cuit: "30-00000000-0", domicilio: "Calle 1", principal: true }] },
  equipos: [{ modelo: "Modelo A", marca: "GE", modalidad: "MRI", serie: "X1", ubicacion: "Sede" }],
  cobertura: { preventivoInspeccionesAnuales: 4, correctivoManoObra: true,
    reparacionBobinasPorAnio: 2, bobinasAlcance: "flota", soporteRemoto: true,
    saasMonitoreo: true, partesIncluidas: false, viaticosIncluidos: true,
    enviosRepuestosIncluidos: true, reparacionesIncluidas: ["Reparación electrónica"] },
  economico: { canonMensual: 4000, moneda: "USD", incluyeIVA: false, ivaPct: 21,
    formaPago: "Mensual, antes del 5º día hábil" },
  ajuste: { periodicidad: "trimestral", indice: "IPC", historial: [] },
  vigencia: { inicio: "2026-01-01", meses: 12, fin: "", renovacionAutomatica: true, preavisoDias: 30 },
  fechas: { creado: "2025-12-15", enviado: "2025-12-16", firmado: "2025-12-20" },
  archivos: [{ nombre: "contrato.pdf", ruta: "2026/contrato.pdf" }],
  notas: "Nota con & y <b>",
  historialEstados: [{ estado: "borrador", fecha: "2025-12-15", usuario: "maxi" }],
  plan: { id: "performance", etiquetaPublica: "NexoCare Performance", modulos: ["cryo"], notasInternas: "n" },
  negociacion: { desviaciones: [{ clausula: "precio", texto: "ajuste semestral" }] },
  ...over,
});

prueba("contrato: ida y vuelta sin perder ningún bloque de dominio", () => {
  const clientes = AD.clientesDesde({ data: [contratoViejo()] });
  const idx = AD.indiceClientes(clientes);
  const nuevo = AD.contratoANuevo(contratoViejo(), { indiceClientes: idx });
  const vuelta = AD.contratoAViejo(nuevo, { clientes });

  // Los bloques de dominio tienen que volver idénticos, no parecidos.
  for (const campo of ["equipos", "cobertura", "economico", "ajuste",
                       "fechas", "archivos", "historialEstados", "plan", "negociacion"]) {
    igual(vuelta[campo], contratoViejo()[campo], `bloque ${campo}`);
  }
  // Vigencia: el esquema normaliza la fecha vacía a null. Es limpieza, no
  // pérdida — ambos significan "sin fecha de fin"— así que se compara el
  // significado y no los bytes.
  igual(vuelta.vigencia.inicio, "2026-01-01");
  igual(vuelta.vigencia.meses, 12);
  igual(vuelta.vigencia.renovacionAutomatica, true);
  igual(vuelta.vigencia.preavisoDias, 30);
  cierto(!vuelta.vigencia.fin, "sin fecha de fin, sea \"\" o null");
  igual(vuelta.estado, "firme_vigente", "el estado vuelve a la forma vieja");
  igual(vuelta.numero, "CT-2026-0001");
  igual(vuelta.notas, "Nota con & y <b>", "el texto no se escapa dos veces");

  // Y una segunda vuelta tiene que dar lo mismo: la conversión es estable.
  const otraVez = AD.contratoANuevo(vuelta, { indiceClientes: idx });
  igual(otraVez, nuevo, "convertir dos veces da el mismo resultado");
});

prueba("contrato: el vínculo a la propuesta sobrevive al adaptador", () => {
  // Regresión: propuestaId no se propagaba y el contrato generado desde una
  // propuesta la perdía al primer guardado.
  const clientes = AD.clientesDesde({ data: [contratoViejo()] });
  const idx = AD.indiceClientes(clientes);
  const nuevo = AD.contratoANuevo(contratoViejo({ propuestaId: "prop_x", origen: "independiente", ticketId: null, presupuestoId: null }), { indiceClientes: idx });
  igual(nuevo.propuestaId, "prop_x");
  const vuelta = AD.contratoAViejo(nuevo, { clientes });
  igual(vuelta.propuestaId, "prop_x");
  igual(AD.contratoANuevo(vuelta, { indiceClientes: idx }).propuestaId, "prop_x", "segunda vuelta");
});

prueba("la condición de IVA sobrevive al adaptador", () => {
  // Regresión: sin propagarla, un presupuesto no gravado volvía a "Gravado"
  // y la facturación le sumaba 21% que el cliente no paga.
  const idx = AD.indiceClientes(AD.clientesDesde({ presupuestos: [presuViejo()] }));
  const exento = AD.presupuestoANuevo(
    presuViejo({ condicionIVA: "NoGravado" }), { indiceClientes: idx });
  igual(exento.condicionIVA, "NoGravado");
  const vuelta = AD.presupuestoAViejo(exento, { clientes: [] });
  igual(vuelta.condicionIVA, "NoGravado", "y vuelve entera");
});

prueba("presupuesto: ida y vuelta sin pérdida", () => {
  const clientes = AD.clientesDesde({ presupuestos: [presuViejo()] });
  const idx = AD.indiceClientes(clientes);
  const ctx = { indiceClientes: idx };
  const nuevo = AD.presupuestoANuevo(presuViejo({ pais: "CL", notas: "x & y" }), ctx);
  const vuelta = AD.presupuestoAViejo(nuevo, { clientes });
  const otraVez = AD.presupuestoANuevo(vuelta, ctx);
  igual(otraVez, nuevo, "estable en la segunda vuelta");
  igual(vuelta.pais, "CL", "el país sobrevive");
  igual(vuelta.items, [{ detalle: "Cold head", sku: "", cantidad: 1, unitario: 18500,
                         intercambio: false, unitarioIntercambio: null }]);
  igual(vuelta.economico.moneda, "USD");
  igual(vuelta.garantia.dias, 90, "la garantía sobrevive la vuelta");
});

prueba("presupuesto: vendedor, envío y anulación sobreviven la ida y vuelta", () => {
  const clientes = AD.clientesDesde({ presupuestos: [presuViejo()] });
  const ctx = { indiceClientes: AD.indiceClientes(clientes) };
  const viejo = presuViejo({ estado: "anulado", vendedorId: "vnd_x", fechaEnvio: "2026-09-02",
    motivoAnulacion: "Reemplazado por P20260999" });
  const nuevo = AD.presupuestoANuevo(viejo, ctx);
  igual(nuevo.estado, "Anulado");
  const vuelta = AD.presupuestoAViejo(nuevo, { clientes });
  igual(vuelta.estado, "anulado");
  igual(vuelta.vendedorId, "vnd_x");
  igual(vuelta.fechaEnvio, "2026-09-02");
  igual(vuelta.motivoAnulacion, "Reemplazado por P20260999");
  igual(AD.presupuestoANuevo(vuelta, ctx), nuevo, "estable en la segunda vuelta");
  // En negociación ya salió al cliente: antes volvía como borrador.
  igual(AD.presupuestoANuevo(presuViejo({ estado: "negociacion" }), ctx).estado, "Enviado");
});

// ===========================================================================
// PLANILLA DE PRESUPUESTOS (datos ficticios)
// ===========================================================================

const filaPl = (extra = {}) => ({
  ID: 20260901, Mes: "Septiembre", Tipo: "Servicio", "Título": "Reparación de bobina",
  Cliente: "Clínica Ficticia", "Monto s/iva": 1900, IVA: 399, Total: 2299,
  "Fecha de envío": "2026-09-03", "Última nota": "Pendiente de aprobación del cliente.",
  Estado: "Pendiente", ...extra,
});

prueba("planilla: estados y fecha de envío", () => {
  const PL = contexto.NEXO_PLANILLA;
  igual(PL.filaARegistro(filaPl()).presupuesto.estado, "enviado");
  igual(PL.filaARegistro(filaPl({ Estado: "Aprobado" })).presupuesto.estado, "ganado");
  igual(PL.filaARegistro(filaPl({ Estado: "Anulado" })).presupuesto.estado, "anulado");
  igual(PL.filaARegistro(filaPl({ Estado: "Desestimado" })).presupuesto.estado, "perdido",
    "desestimado por el cliente es venta perdida, no anulado");
  igual(PL.filaARegistro(filaPl({ "Fecha de envío": null, "Última nota": "Pendiente de enviar al cliente." })).presupuesto.estado,
    "borrador", "sin fecha y con 'enviar' en la nota es borrador");
  igual(PL.filaARegistro(filaPl({ "Fecha de envío": null })).presupuesto.estado,
    "enviado", "pendiente de respuesta sin fecha: salió, falta la fecha");
  const r = PL.filaARegistro(filaPl({ "Fecha de envío": "2016-09-03" }));
  igual(r.presupuesto.fechaEnvio, "2026-09-03", "el año mal tipeado se corrige al del número");
  cierto(r.avisos.length === 1);
  igual(PL.filaARegistro({ ID: 20260909, Mes: "Septiembre", Tipo: "-", "Título": "-", Cliente: "-" }), null, "fila vacía");
  cierto(PL.filaARegistro(filaPl({ Tipo: "Contrato" })).acuerdo, "una fila de tipo Contrato es acuerdo");
});

prueba("planilla: pesos, IVA cero y subtipo de venta", () => {
  const PL = contexto.NEXO_PLANILLA;
  const ars = PL.filaARegistro(filaPl({ "Monto s/iva": 6000000, IVA: 1260000, Total: 7260000 }));
  igual(ars.presupuesto.economico.moneda, "ARS");
  igual(PL.filaARegistro(filaPl({ IVA: 0, Total: 1900 })).presupuesto.condicionIVA, "NoGravado");
  igual(PL.filaARegistro(filaPl({ Tipo: "Venta", "Título": "Venta de equipo Achieva 1.5T" })).presupuesto.subtipo, "equipo");
  igual(PL.filaARegistro(filaPl({ Tipo: "Venta", "Título": "Provisión por intercambio de AMP" })).presupuesto.subtipo, "intercambio");
  igual(PL.filaARegistro(filaPl({ ID: "20260901CL" })).presupuesto.numero, "P20260901CL");
  igual(PL.filaARegistro(filaPl({ ID: "20260901CL" })).presupuesto.economico.ivaPct, 19, "Chile al 19 %");
});

prueba("planilla: el plan crea lo nuevo y actualiza solo lo que cambió", () => {
  const PL = contexto.NEXO_PLANILLA;
  const ya = PL.filaARegistro(filaPl()).presupuesto;
  ya.items = [{ detalle: "Detalle cargado en la app", sku: "", cantidad: 1, unitario: 490, intercambio: false, unitarioIntercambio: null }];
  const plan = PL.planImportacion([filaPl({ Estado: "Rechazado", "Monto s/iva": 1900 }), filaPl({ ID: 20260902 }), filaPl({ ID: 20260903 })], [ya]);
  igual(plan.crear.length, 2);
  igual(plan.actualizar.length, 1);
  igual(plan.actualizar[0].cambios.map((c) => c.campo).sort(), ["estado", "estadoOrigen", "neto"]);
  const p = PL.aplicarActualizacion(ya, plan.actualizar[0], { hoy: "2026-11-10" });
  igual(p.estado, "perdido");
  igual(p.items[0].unitario, 1900);
  igual(p.items[0].detalle, "Detalle cargado en la app", "el detalle de la app se respeta");
  const sinCambio = PL.planImportacion([filaPl()], [PL.filaARegistro(filaPl()).presupuesto]);
  igual(sinCambio.iguales, 1);
  const rep = PL.planImportacion([filaPl(), filaPl()], []);
  igual(rep.crear.length, 1, "número repetido: se toma la primera fila");
});

prueba("planilla: los acuerdos de mantenimiento pasan a Propuestas sin perder la línea", () => {
  const PL = contexto.NEXO_PLANILLA;
  cierto(PL.esAcuerdo("Propuesta de mantenimiento", "Servicio"));
  cierto(PL.esAcuerdo("Continuidad Operativa Full · MRI", ""));
  cierto(!PL.esAcuerdo("Mantenimiento preventivo", "Servicio"), "el preventivo suelto es un servicio puntual");

  // Uno ya cargado como presupuesto, con contrato colgado; otro nuevo en la planilla.
  const cargado = PL.filaARegistro(filaPl({ ID: 20260701, "Título": "Propuesta de mantenimiento", Estado: "Aprobado", "Monto s/iva": 3000 })).presupuesto;
  cargado.estado = "enviado";
  const ticket = { id: cargado.ticketId, presupuestoIds: [cargado.id, "pre_otro"] };
  const contrato = { id: "ctr_1", numero: "CT-2026-0009", origen: "comercial", presupuestoId: cargado.id, ticketId: cargado.ticketId, notas: "" };
  const plan = PL.planImportacion([
    filaPl({ ID: 20260701, "Título": "Propuesta de mantenimiento", Estado: "Aprobado", "Monto s/iva": 3000 }),
    filaPl({ ID: 20260702, Tipo: "Contrato", "Título": "Continuidad Operativa", Cliente: "Sanatorio Inventado" }),
  ], [cargado]);
  igual(plan.crear.length, 0, "un acuerdo no se crea como presupuesto");
  igual(plan.acuerdos.length, 2);
  igual(plan.acuerdos[0].presupuesto.estado, "ganado", "la planilla actualiza el estado antes de pasar");

  const r = PL.planAcuerdos(plan.acuerdos, {
    propuestas: [{ numero: "PR-2026-0003", numeroLegado: "" }],
    clientes: [{ id: "cli_ficticia", nombreComercial: "Clínica Ficticia", alias: [] }],
    contratos: [contrato], tickets: [ticket], hoy: "2026-11-10" });
  igual(r.propuestas.map((p) => [p.numero, p.numeroLegado, p.estado]),
    [["PR-2026-0004", "P20260701", "Aceptada"], ["PR-2026-0005", "P20260702", "Enviada"]]);
  igual(r.propuestas[0].clienteId, "cli_ficticia");
  igual(r.propuestas[0].economico.canonMensual, 3000);
  igual(r.propuestas[0].contratoId, "ctr_1");
  igual(r.propuestas[0].ticketId, cargado.ticketId, "conserva el ticket");
  igual(r.quitar, [cargado.id], "solo se quita lo que estaba cargado");
  igual(r.contratos[0].propuestaId, r.propuestas[0].id);
  igual(r.contratos[0].presupuestoId, null);
  igual(r.contratos[0].origen, "independiente", "sin presupuesto, comercial violaría NX-040");
  igual(r.tickets[0].presupuestoIds, ["pre_otro"]);
  igual(r.clientes.map((c) => c.nombreComercial), ["Sanatorio Inventado"]);

  const otraVez = PL.planAcuerdos(plan.acuerdos, { propuestas: r.propuestas, hoy: "2026-11-10" });
  igual(otraVez.propuestas.length, 0, "correrlo dos veces no duplica");
});

prueba("ticket: ida y vuelta estable", () => {
  const clientes = AD.clientesDesde({ tickets: [ticketViejo()] });
  const idx = AD.indiceClientes(clientes);
  const ctx = { indiceClientes: idx, presupuestos: [presuViejo()] };
  const nuevo = AD.ticketANuevo(ticketViejo({ pais: "UY", estado: "ganado" }), ctx);
  const vuelta = AD.ticketAViejo(nuevo, { clientes });
  const otraVez = AD.ticketANuevo({ ...vuelta, presupuestoIds: nuevo.presupuestoIds }, ctx);
  igual(otraVez, nuevo, "estable en la segunda vuelta");
  igual(vuelta.pais, "UY");
});

prueba("un presupuesto heredado en ARS no se vuelve a convertir", () => {
  // Regresión: P20260802 es un abono acordado en pesos. Multiplicarlo por el
  // tipo de cambio daba miles de millones.
  const p = presuBase({ estado: "Aprobado", pais: "AR",
    items: [{ detalle: "Abono", cantidad: 1, unitario: 6060000 }],
    economico: { moneda: "ARS", validezDias: 15, descuentoPct: 0,
      recurrencia: "mensual", ivaPct: 21, incluyeIVA: false } });
  const f = C.prepararFacturacion(p, { serie: serieBase });
  igual(f.tcValor, 1, "sin conversión: ya está en pesos");
  igual(f.montoNeto, 6060000, "el importe es el mismo, no multiplicado");
  igual(f.monedaLiquidacion, "ARS");
  cierto(f.tcFuente.includes("directamente"), f.tcFuente);
});

prueba("cliente exento: no se agrega IVA", () => {
  const f = C.prepararFacturacion(
    presuBase({ estado: "Aprobado", pais: "US", condicionIVA: "Exento" }), { serie: [] });
  igual(f.montoIVA, 0);
  igual(f.montoLiquidado, 18500, "paga el neto, sin IVA encima");
  igual(f.condicionIVA, "Exento");
});

prueba("IVA incluido en el precio: se extrae, no se suma", () => {
  const f = C.prepararFacturacion(
    presuBase({ estado: "Aprobado", pais: "US", condicionIVA: "IncluidoEnPrecio" }), { serie: [] });
  igual(f.montoLiquidado, 18500, "el total no cambia: el IVA ya estaba adentro");
  igual(f.montoNeto, 15289.26);
  igual(f.montoIVA, 3210.74);
  igual(E.money(f.montoNeto + f.montoIVA), 18500, "neto + IVA = total");
});

prueba("el desglose de IVA cubre los tres tratamientos", () => {
  igual(C.desglosarIVA(1000, "Gravado", 21), { neto: 1000, iva: 210, total: 1210 });
  igual(C.desglosarIVA(1210, "IncluidoEnPrecio", 21), { neto: 1000, iva: 210, total: 1210 });
  igual(C.desglosarIVA(1000, "Exento", 21), { neto: 1000, iva: 0, total: 1000 });
});

prueba("un cobro en efectivo se registra y cierra la operación", () => {
  const f = C.prepararFacturacion(
    presuBase({ estado: "Aprobado", pais: "AR", condicionIVA: "NoGravado" }),
    { serie: serieBase, tipoComprobante: "Efectivo", numeroComprobante: "",
      observaciones: "Cobrado en efectivo, sin factura" });
  igual(f.tipoComprobante, "Efectivo");
  igual(f.montoIVA, 0);
  cierto(f.montoLiquidado > 0, "queda registrado el importe cobrado");
  igual(f.numeroComprobante, "", "sin número: no hay factura");
});

// ---------------------------------------------------------------------------
// Cobro por período · el caso P20260802
// ---------------------------------------------------------------------------

/** El caso real: contrato de mantenimiento en pesos, en efectivo, sin IVA. */
const abonoEnPesos = (over = {}) => E.ENTIDADES.presupuestos.normalizar({
  id: "pre_ars", numero: "P20260802", ticketId: "tk_x", fecha: "2026-08-04",
  pais: "AR", estado: "Aprobado", titulo: "Propuesta de mantenimiento",
  items: [{ detalle: "Mantenimiento", cantidad: 1, unitario: 6060000 }],
  economico: { moneda: "ARS", validezDias: 15, descuentoPct: 0,
    recurrencia: "mensual", ivaPct: 21, incluyeIVA: false },
  condicionIVA: "NoGravado", ...over,
});

prueba("contrato en pesos, en efectivo y sin IVA: el importe queda intacto", () => {
  const f = C.prepararFacturacion(abonoEnPesos(), {
    serie: serieBase, tipoComprobante: "Efectivo", condicionIVA: "NoGravado",
    periodoCobrado: "2026-08" });
  igual(f.montoLiquidado, 6060000, "ni se convierte ni se le suma IVA");
  igual(f.tcValor, 1);
  igual(f.montoIVA, 0);
  igual(f.tipoComprobante, "Efectivo");
  igual(f.numeroComprobante, "", "un cobro en efectivo no lleva número");
  igual(f.periodoCobrado, "2026-08");
});

prueba("un abono mensual vuelve a estar pendiente el mes siguiente", () => {
  const p = abonoEnPesos();
  const cobroAgosto = E.ENTIDADES.facturaciones.normalizar({
    id: "f1", presupuestoId: p.id, fechaEmision: "2026-08-05",
    periodoCobrado: "2026-08", tipoComprobante: "Efectivo", montoLiquidado: 6060000 });

  cierto(!C.pendienteDeCobro(p, [cobroAgosto], "2026-08"), "agosto ya está cobrado");
  cierto(C.pendienteDeCobro(p, [cobroAgosto], "2026-09"),
    "septiembre sigue pendiente: es un abono, no un pago único");
  igual([...C.periodosCobrados(p.id, [cobroAgosto])], ["2026-08"]);
});

prueba("un pago único se cobra una sola vez", () => {
  const p = presuBase({ estado: "Aprobado" });   // recurrencia "unica"
  const cobro = E.ENTIDADES.facturaciones.normalizar({
    id: "f1", presupuestoId: p.id, fechaEmision: "2026-08-05", periodoCobrado: "2026-08" });
  cierto(C.pendienteDeCobro(p, [], "2026-08"), "sin cobros, pendiente");
  cierto(!C.pendienteDeCobro(p, [cobro], "2026-09"),
    "cobrado una vez, no reaparece nunca más");
});

prueba("una nota de crédito no cuenta como cobro", () => {
  const p = abonoEnPesos();
  const nc = E.ENTIDADES.facturaciones.normalizar({
    id: "f2", presupuestoId: p.id, fechaEmision: "2026-08-10",
    periodoCobrado: "2026-08", tipoComprobante: "NotaCredito" });
  cierto(C.pendienteDeCobro(p, [nc], "2026-08"),
    "una nota de crédito revierte un cobro, no lo constituye");
});

prueba("solo se cobra un presupuesto aprobado", () => {
  cierto(!C.pendienteDeCobro(presuBase({ estado: "Enviado" }), [], "2026-08"));
  cierto(!C.pendienteDeCobro(presuBase({ estado: "Rechazado" }), [], "2026-08"));
});

// ---------------------------------------------------------------------------
// Las dos etapas: propuesta comercial -> contrato
// ---------------------------------------------------------------------------

const propBase = (over = {}) => E.ENTIDADES.propuestas.normalizar({
  id: "prop_1", numero: "PR-2026-0001", clienteId: "cli_1", pais: "AR",
  estado: "Borrador", economico: { canonMensual: 4000, moneda: "USD" },
  equipos: [{ modelo: "A", marca: "GE", modalidad: "MRI" }],
  cobertura: { soporteRemoto: true }, plan: { id: "performance" }, ...over,
});

prueba("la propuesta no se resuelve sin haber salido al cliente", () => {
  rechaza("NX-020", () => R.validar("propuestas", "editar",
    propBase({ estado: "Aceptada" }), propBase(), ADMIN));
  R.validar("propuestas", "editar",
    propBase({ estado: "Aceptada" }), propBase({ estado: "Enviada" }), ADMIN);
});

prueba("una propuesta resuelta es terminal", () => {
  rechaza("NX-020", () => R.validar("propuestas", "editar",
    propBase({ estado: "Enviada" }), propBase({ estado: "Aceptada" }), ADMIN));
});

prueba("no se envia una propuesta sin canon", () => {
  rechaza("NX-040", () => R.validar("propuestas", "editar",
    propBase({ estado: "Enviada", economico: { canonMensual: 0, moneda: "USD" } }),
    propBase(), ADMIN));
});

prueba("una propuesta rechazada necesita motivo", () => {
  rechaza("NX-040", () => R.validar("propuestas", "editar",
    propBase({ estado: "Rechazada" }), propBase({ estado: "Enviada" }), ADMIN));
});

const contratoDePropuesta = (over = {}) => E.ENTIDADES.contratos.normalizar({
  id: "ctr_1", numero: "CT-2026-0001", origen: "independiente", clienteId: "cli_1",
  propuestaId: "prop_1", estado: "Borrador",
  economico: { canonMensual: 4000, moneda: "USD" }, ...over,
});

prueba("el contrato se redacta recien con la propuesta aceptada", () => {
  rechaza("NX-071", () => R.validar("contratos", "crear", contratoDePropuesta(), null,
    { ...ADMIN, propuestas: [propBase({ estado: "Enviada" })] }));
  R.validar("contratos", "crear", contratoDePropuesta(), null,
    { ...ADMIN, propuestas: [propBase({ estado: "Aceptada" })] });
});

prueba("el contrato y su propuesta no pueden ser de clientes distintos", () => {
  rechaza("NX-041", () => R.validar("contratos", "crear",
    contratoDePropuesta({ clienteId: "cli_9" }), null,
    { ...ADMIN, propuestas: [propBase({ estado: "Aceptada" })] }));
});

prueba("efecto · el contrato queda referenciado desde su propuesta", () => {
  const cambios = R.efectos("contratos", "crear", contratoDePropuesta(), null,
    { propuestas: [propBase({ estado: "Aceptada" })] });
  const ref = cambios.find((c) => c.entidad === "propuestas");
  igual(ref.campos.contratoId, "ctr_1",
    "sin esto la propuesta no sabria que ya se convirtio");
});

prueba("una propuesta con contrato no se desvincula sola", () => {
  rechaza("NX-070", () => R.validar("propuestas", "editar",
    propBase({ estado: "Aceptada", contratoId: null }),
    propBase({ estado: "Aceptada", contratoId: "ctr_1" }), ADMIN));
});

prueba("un contrato sin propuesta sigue siendo valido", () => {
  R.validar("contratos", "crear",
    contratoDePropuesta({ propuestaId: null }), null, { ...ADMIN, propuestas: [] });
});

// ===========================================================================

// ===========================================================================
// CATÁLOGO
// ===========================================================================

// Pieza ficticia en la forma del parts.json que escribía SharePoint.
const parteVieja = (over = {}) => ({
  ref: "NX-AR-901", nombre: "Bobina de prueba", categoria: "Bobina", modalidad: "MRI",
  marca: "MarcaX", modelo_compatible: "Modelo Y 1.5T", nro_parte: "0000000",
  estado: "Used", disponibilidad: "En stock", ubicacion: "Argentina", garantia: 90.0,
  precio: "1.200,00", descripcion: "Pieza de ejemplo", imagen: "NX-AR-901-1.jpg;NX-AR-901-2.jpg",
  ...over,
});
const itemBase = (over = {}) => E.ENTIDADES.catalogo.normalizar({
  id: "cat_1", ref: "NX-AR-901", nombre: "Bobina de prueba", condicion: "Usado",
  disponibilidad: "EnStock", pais: "AR", precio: 1200, garantiaDias: 90,
  fotos: [{ archivo: "NX-AR-901-1.jpg", publicada: true }], ...over,
});

prueba("catálogo · el precio null es Consultar, no gratis", () => {
  igual(itemBase({ precio: null }).precio, null, "null no puede volverse 0");
  igual(itemBase({ precio: "" }).precio, null, "vacío tampoco");
  igual(CAT.aParte(itemBase({ precio: null })).precio, "Consultar", "en la web");
  igual(CAT.aParte(itemBase({ precio: 0 })).precio, "0,00", "0 explícito sí es 0");
});

prueba("catálogo · precio en el formato que entiende el bot de DOTmed", () => {
  igual(CAT.precioATexto(1200), "1.200,00");
  igual(CAT.precioATexto(34000.5), "34.000,50");
  igual(CAT.textoAPrecio("1.200,00"), 1200);
  igual(CAT.textoAPrecio("1200,50"), 1200.5);
  igual(CAT.textoAPrecio("Consultar"), null);
});

prueba("catálogo · a la web solo salen campos públicos (lista blanca)", () => {
  const item = itemBase({
    costo: 300, proveedor: "Proveedor secreto", nroSerie: "SERIE-PRIVADA",
    codigoInterno: "COD-PRIV", notas: "nota privada", origenUrl: "https://ejemplo.invalid/x",
    ubicacionFisica: "Estante 4",
  });
  const salida = JSON.stringify(CAT.aParts([item]));
  for (const secreto of ["300", "Proveedor secreto", "SERIE-PRIVADA", "COD-PRIV",
    "nota privada", "ejemplo.invalid", "Estante 4"]) {
    cierto(!salida.includes(secreto), `se filtró a la web: ${secreto}`);
  }
  igual(Object.keys(CAT.aParte(item)).sort(), ["categoria", "descripcion", "disponibilidad",
    "dotmed", "estado", "garantia", "imagen", "marca", "modalidad", "modelo_compatible",
    "nombre", "nro_parte", "precio", "ref", "tipo", "ubicacion"], "campos publicados");
});

prueba("catálogo · solo se publica lo tildado y disponible", () => {
  const items = [
    itemBase({ id: "a", ref: "NX-AR-001" }),
    itemBase({ id: "b", ref: "NX-AR-002", disponibilidad: "APedido" }),
    itemBase({ id: "c", ref: "NX-AR-003", disponibilidad: "Vendido" }),
    itemBase({ id: "d", ref: "NX-AR-004", disponibilidad: "Reservado" }),
    itemBase({ id: "e", ref: "NX-AR-005", publicarWeb: false }),
  ];
  igual(CAT.aParts(items).map((p) => p.ref), ["NX-AR-001", "NX-AR-002"]);
});

prueba("catálogo · orden natural de referencias", () => {
  const items = ["NX-AR-010", "NX-AR-002", "NX-AR-1000"].map((ref, i) => itemBase({ id: `x${i}`, ref }));
  igual(CAT.aParts(items).map((p) => p.ref), ["NX-AR-002", "NX-AR-010", "NX-AR-1000"]);
});

prueba("catálogo · DOTmed apagado no publica ni borra nada", () => {
  igual(CAT.aParte(itemBase()).dotmed, false, "por defecto apagado");
  igual(CAT.aParte(itemBase({ canales: { dotmed: true } })).dotmed, true);
});

prueba("catálogo · ida y vuelta con el parts.json de SharePoint no cambia nada", () => {
  const viejo = [parteVieja()];
  const { nuevos } = CAT.importar(viejo, []);
  const d = CAT.diferencias(viejo, CAT.aParts(nuevos));
  igual([d.altas.length, d.bajas.length, d.cambios.length], [0, 0, 0],
    "la primera publicación tiene que dejar la web igual: " + JSON.stringify(d.cambios));
});

prueba("catálogo · importación normaliza lo que SharePoint mezclaba", () => {
  const { nuevos } = CAT.importar([
    parteVieja({ ref: "NX-AR-001", estado: "Usado", garantia: null, precio: "Consultar", nro_parte: "-" }),
    parteVieja({ ref: "NX-XX-002", estado: "For parts or not working", disponibilidad: "A pedido",
      imagen: "https://i.ebayimg.com/images/g/ejemplo/s-l225.jpg" }),
    parteVieja({ ref: "NX-AR-003", estado: "New", disponibilidad: "Sin stock" }),
  ], []);
  const [a, b, c] = nuevos;
  igual([a.condicion, a.garantiaDias, a.precio, a.nroParte], ["Usado", null, null, ""]);
  igual([b.condicion, b.disponibilidad, b.procedencia, b.proveedor], ["ParaPartes", "APedido", "Terceros", "eBay"]);
  igual([c.condicion, c.disponibilidad], ["Nuevo", "SinStock"]);
  cierto(nuevos.every((x) => x.auditoria.estado === "Pendiente"), "todo lo importado se audita");
  cierto(nuevos.every((x) => x.fotos.every((f) => f.publicada)), "las fotos importadas ya están en la web");
});

prueba("catálogo · importar dos veces no duplica", () => {
  const primera = CAT.importar([parteVieja()], []).nuevos;
  const segunda = CAT.importar([parteVieja(), parteVieja({ ref: "NX-AR-902" })], primera);
  igual(segunda.nuevos.map((x) => x.ref), ["NX-AR-902"]);
  igual(segunda.omitidos, ["NX-AR-901"]);
});

prueba("catálogo · próxima referencia y nombre de foto", () => {
  igual(CAT.proximaRef([{ ref: "NX-AR-040" }, { ref: "NX-AR-007" }, { ref: "NX-CL-099" }], "AR"), "NX-AR-041");
  igual(CAT.proximaRef([], "CL"), "NX-CL-001");
  igual(CAT.nombreFoto("NX-AR-001", [{ archivo: "NX-AR-001-1.jpg" }, { archivo: "NX-AR-001-9.jpeg" }]), "NX-AR-001-10.jpg");
});

prueba("catálogo · fotos por subir: solo las privadas de lo que se publica", () => {
  const items = [
    itemBase({ id: "a", ref: "NX-AR-001", fotos: [
      { archivo: "NX-AR-001-1.jpg", publicada: true }, { archivo: "NX-AR-001-2.jpg", publicada: false }] }),
    itemBase({ id: "b", ref: "NX-AR-002", publicarWeb: false, fotos: [{ archivo: "NX-AR-002-1.jpg", publicada: false }] }),
  ];
  igual(CAT.fotosPorSubir(items).map((x) => x.foto.archivo), ["NX-AR-001-2.jpg"]);
});

prueba("catálogo · auditar 'ya no está' da de baja y saca de la web", () => {
  const item = CAT.importar([parteVieja()], []).nuevos[0];
  const r = CAT.auditar(item, "baja", { usuario: "test", hoy: "2026-11-03" });
  igual([r.disponibilidad, r.publicarWeb, r.auditoria.estado, r.auditoria.usuario],
    ["Baja", false, "Confirmado", "test"]);
  cierto(!CAT.esPublicable(r), "no puede seguir en la web");
});

prueba("catálogo · reglas: referencia única y con formato", () => {
  const ctx = { ...ADMIN, catalogo: [itemBase({ id: "otro" })] };
  rechaza("NX-080", () => R.validar("catalogo", "crear", itemBase({ id: "cat_2" }), null, ctx));
  rechaza("NX-081", () => R.validar("catalogo", "crear", itemBase({ id: "cat_2", ref: "AR-1" }), null, ADMIN));
  rechaza("NX-040", () => R.validar("catalogo", "crear", itemBase({ id: "cat_2", nombre: "" }), null, ADMIN));
  R.validar("catalogo", "crear", itemBase({ id: "cat_2", ref: "NX-XX-002" }), null, ctx);
});

prueba("catálogo · una ref con fotos ya publicadas no se renombra", () => {
  const anterior = itemBase();
  rechaza("NX-082", () => R.validar("catalogo", "editar", itemBase({ ref: "NX-AR-950" }), anterior, ADMIN));
  // Sin fotos en la web todavía, sí se puede corregir.
  R.validar("catalogo", "editar", itemBase({ ref: "NX-AR-950", fotos: [] }), itemBase({ fotos: [] }), ADMIN);
});

prueba("catálogo · permisos: el vendedor consulta, no carga; publica dirección o admin", () => {
  rechaza("NX-010", () => R.validar("catalogo", "crear", itemBase(), null, { rol: "vendedor", usuario: "v" }));
  R.validar("catalogo", "crear", itemBase(), null, { rol: "gerente_comercial", usuario: "g" });
  igual(["direccion", "admin", "gerente_comercial"].map((r) => P.capacidad(r, "publicar_catalogo")),
    [true, true, false]);
});

prueba("catálogo · CSV con comillas, comas y comillas escapadas", () => {
  const filas = CAT.leerCsv('ref,nombre,nota\r\nNX-AR-001,"Bobina, 8ch","dice ""ok"""\nNX-AR-002,Simple,\n');
  igual(filas.length, 2);
  igual([filas[0].nombre, filas[0].nota, filas[1].nota], ["Bobina, 8ch", 'dice "ok"', ""]);
});

prueba("catálogo · auditoría externa: disponible a pedido, no encontrada de baja, dudosa intacta", () => {
  const items = ["NX-XX-001", "NX-XX-002", "NX-XX-003", "NX-XX-004"].map((ref, i) =>
    itemBase({ id: `c${i}`, ref, nombre: `Pieza ${i}`, disponibilidad: "APedido" }));
  const filas = [
    { ref: "NX-XX-001", resultado: "DISPONIBLE", link: "https://ejemplo.invalid/itm/1", precio_usd: "100" },
    { ref: "NX-XX-002", resultado: "NO_ENCONTRADA" },
    { ref: "NX-XX-003", resultado: "DUDOSA", link: "https://ejemplo.invalid/itm/3" },
    { ref: "NX-XX-999", resultado: "DISPONIBLE" },
  ];
  const { plan, omitidas } = CAT.planDesdeAuditoria(filas, items);
  igual([plan.get("c0").decision, plan.get("c0").origenUrl], ["pedido", "https://ejemplo.invalid/itm/1"]);
  igual(plan.get("c1").decision, "baja");
  cierto(!plan.has("c2") && !plan.has("c3"), "dudosa y sin fila quedan pendientes");
  igual(omitidas, ["NX-XX-999"]);
});

prueba("catálogo · duplicados: queda la ref más baja, el resto de baja", () => {
  const items = [
    itemBase({ id: "a", ref: "NX-XX-062", nombre: "Bobina  de rodilla" }),
    itemBase({ id: "b", ref: "NX-AR-040", nombre: "bobina de rodilla" }),
    itemBase({ id: "c", ref: "NX-XX-068", nombre: "Bobina de rodilla!" }),
    itemBase({ id: "d", ref: "NX-XX-070", nombre: "Otra pieza" }),
    // Stock propio con el mismo nombre: dos unidades reales, no se tocan.
    itemBase({ id: "e", ref: "NX-AR-001", nombre: "Shoulder coil", procedencia: "Propia" }),
    itemBase({ id: "f", ref: "NX-AR-005", nombre: "Shoulder coil", procedencia: "Propia" }),
  ].map((x) => (x.id === "e" || x.id === "f" ? x : { ...x, procedencia: "Terceros" }));
  const { plan } = CAT.planDesdeAuditoria([], items, { bajaDuplicados: true });
  igual([...plan.keys()].sort(), ["a", "c"]);
  cierto(plan.get("a").nota.includes("NX-AR-040"), "la nota dice de quién es duplicado");
  igual(CAT.planDesdeAuditoria([], items).plan.size, 0, "sin la opción no toca duplicados");
});

prueba("catálogo · etiqueta: PN y SN detrás de sus rótulos, con errores típicos de OCR", () => {
  const r = CAT.leerEtiqueta("MARCA X MEDICAL\nP/N: 2217680-2 REV 5\nS/N 36528ABC\nMade in USA 2016");
  igual([r.pn, r.sn], ["2217680-2", "36528ABC"]);
  const ocr = CAT.leerEtiqueta("PIN 453530252282\nSerial No. a2552210");
  igual([ocr.pn, ocr.sn], ["453530252282", "A2552210"]);
  cierto(CAT.leerEtiqueta("REF 10185453").pn === "10185453", "REF cuenta como PN");
});

prueba("catálogo · etiqueta sin rótulos: solo candidatos con dígitos", () => {
  const r = CAT.leerEtiqueta("COIL ARRAY 5341333 HEAD 16CH 2016");
  igual([r.pn, r.sn], ["", ""]);
  igual(r.candidatos, ["5341333", "16CH", "2016"]);
});

prueba("catálogo · nombre sugerido", () => {
  igual(CAT.nombreSugerido({ marca: "GE", categoria: "Bobina", modalidad: "MRI", nroParte: "2217680" }),
    "GE Bobina MRI · 2217680");
  igual(CAT.nombreSugerido({}), "");
});

prueba("catálogo · modalidad libre: una que no está en la lista se conserva", () => {
  for (const m of ["MRI", "CT"]) cierto(CAT.MODALIDADES.includes(m), m);
  const n = E.ENTIDADES.catalogo.normalizar({ ref: "NX-AR-900", nombre: "Tubo", modalidad: "Litotricia" });
  igual(n.modalidad, "Litotricia");
  igual(CAT.aParte({ ...n, disponibilidad: "EnStock", publicarWeb: true }).modalidad, "Litotricia");
});

// ===========================================================================

console.log(`\n  ${pasadas} pasadas · ${fallidas} fallidas\n`);
if (fallos.length) {
  console.log("  FALLOS:");
  for (const f of fallos) console.log(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log("  Núcleo verificado.\n");
