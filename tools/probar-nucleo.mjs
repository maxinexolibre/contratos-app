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

for (const f of ["esquema", "permisos", "reglas", "kpi", "almacen", "adaptador", "cambio", "comisiones"]) {
  vm.runInContext(readFileSync(resolve(RAIZ, `nucleo/${f}.js`), "utf8"), contexto, { filename: f });
}

const {
  NEXO_ESQUEMA: E, NEXO_PERMISOS: P, NEXO_REGLAS: R, NEXO_KPI: K,
  NEXO_ALMACEN: A, NEXO_ADAPTADOR: AD, NEXO_CAMBIO: C, NEXO_COMISIONES: CM,
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

function igual(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
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

prueba("marca legado lo que no está cotizado en USD ni UF", () => {
  cierto(presuBase({ economico: { moneda: "ARS", recurrencia: "mensual", validezDias: 15, descuentoPct: 0 } }).esLegado);
  cierto(!presuBase().esLegado);
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
  items: [{ detalle: "Cold head", cantidad: 1, unitario: 18500 }], saas: [],
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
  { unidad: "ARS", fecha: E.hoy(), tasa: 1412.5, fuente: "BNA billete vendedor" },
  { unidad: "CLP", fecha: E.hoy(), tasa: 940, fuente: "BCCh" },
  { unidad: "UF", fecha: E.hoy(), tasa: 39500, fuente: "SII" },
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

prueba("USD no se convierte: ya es la moneda de referencia", () => {
  igual(C.aUSD(18500, "USD", E.hoy(), []), 18500, "sin necesitar la serie");
});

prueba("UF pasa por CLP para llegar a USD", () => {
  // 1.480 UF × 39.500 CLP/UF = 58.460.000 CLP ÷ 940 CLP/USD
  igual(C.aUSD(1480, "UF", E.hoy(), serieBase), 62191.49);
});

prueba("UF sin CLP cargado falla con NX-030, no con un número inventado", () => {
  const parcial = serieBase.filter((x) => x.unidad === "UF");
  rechaza("NX-030", () => C.aUSD(1000, "UF", E.hoy(), parcial));
});

prueba("factura congelando el tipo de cambio, la fecha y la fuente", () => {
  const p = presuBase({ estado: "Aprobado" });
  const f = C.prepararFacturacion(p, { serie: serieBase, numeroComprobante: "A-0001" });
  igual(f.monedaCotizacion, "USD");
  igual(f.montoCotizado, 18500);
  igual(f.tcValor, 1412.5);
  igual(f.tcFuente, "BNA billete vendedor");
  igual(f.monedaLiquidacion, "ARS");
  igual(f.montoLiquidado, 26131250, "18.500 × 1.412,50");
});

prueba("un presupuesto en UF se factura en CLP", () => {
  const p = presuBase({ estado: "Aprobado",
    items: [{ detalle: "abono", cantidad: 1, unitario: 1480 }],
    economico: { moneda: "UF", recurrencia: "mensual", descuentoPct: 0, validezDias: 15 } });
  const f = C.prepararFacturacion(p, { serie: serieBase });
  igual(f.tcUnidad, "UF");
  igual(f.monedaLiquidacion, "CLP");
  igual(f.montoLiquidado, 58460000, "1.480 UF × 39.500");
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
  const com = CM.devengarPorContrato(contratoFirmado(), {
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
  const com = CM.devengarPorContrato(
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

// ===========================================================================

console.log(`\n  ${pasadas} pasadas · ${fallidas} fallidas\n`);
if (fallos.length) {
  console.log("  FALLOS:");
  for (const f of fallos) console.log(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log("  Núcleo verificado.\n");
