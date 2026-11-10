#!/usr/bin/env node
/**
 * Prueba de la capa de datos particionada, sin navegador y sin tocar GitHub.
 *
 * Levanta un repositorio falso en memoria que responde como la API de
 * contenidos —incluido el sha y el conflicto 409— y verifica el ciclo
 * completo: migrar desde los archivos planos, leer particionado, escribir una
 * sola partición, y que nada se pierda en el camino.
 *
 * Esto es lo que hay que ver en verde ANTES de correr la migración sobre los
 * datos reales.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Repositorio falso: guarda archivos en memoria y emula sha + conflictos
// ---------------------------------------------------------------------------

const archivos = new Map();   // ruta -> { contenido, sha }
let contadorSha = 0;
const peticiones = { get: 0, put: 0 };

const b64 = {
  enc: (t) => Buffer.from(t, "utf8").toString("base64"),
  dec: (t) => Buffer.from(t, "base64").toString("utf8"),
};

function fetchFalso(url, opciones = {}) {
  const ruta = decodeURIComponent(String(url).split("/contents/")[1].split("?")[0]);

  if (!opciones.method || opciones.method === "GET") {
    peticiones.get++;
    const f = archivos.get(ruta);
    if (!f) return respuesta(404, { message: "Not Found" });
    return respuesta(200, { content: b64.enc(f.contenido), sha: f.sha, size: f.contenido.length });
  }

  peticiones.put++;
  const body = JSON.parse(opciones.body);
  const actual = archivos.get(ruta);
  // Mismo control que hace GitHub: sin el sha correcto, conflicto.
  if (actual && body.sha !== actual.sha) return respuesta(409, { message: "conflict" });
  if (!actual && body.sha) return respuesta(422, { message: "sha para archivo inexistente" });

  const sha = `sha${++contadorSha}`;
  archivos.set(ruta, { contenido: b64.dec(body.content), sha });
  return respuesta(200, { content: { sha } });
}

const respuesta = (status, cuerpo) => Promise.resolve({
  ok: status >= 200 && status < 300, status,
  json: async () => cuerpo,
});

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

const almacenLocal = new Map();
const contexto = {
  console: { ...console, info: () => {}, warn: () => {} },
  localStorage: {
    getItem: (k) => almacenLocal.get(k) ?? null,
    setItem: (k, v) => almacenLocal.set(k, String(v)),
    removeItem: (k) => almacenLocal.delete(k),
  },
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  fetch: fetchFalso,
  escape, unescape,
};
contexto.window = contexto;
contexto.globalThis = contexto;
vm.createContext(contexto);

for (const f of ["esquema", "permisos", "reglas", "kpi", "almacen", "adaptador",
                 "cambio", "comisiones", "repositorio"]) {
  vm.runInContext(readFileSync(resolve(RAIZ, `nucleo/${f}.js`), "utf8"), contexto, { filename: f });
}
const { NEXO_ESQUEMA: E, NEXO_REPOSITORIO: REP, NEXO_KPI: K, NEXO_ADAPTADOR: AD } = contexto;

// ---------------------------------------------------------------------------
// Mini framework
// ---------------------------------------------------------------------------

let pasadas = 0, fallidas = 0;
const fallos = [];
async function prueba(nombre, fn) {
  try { await fn(); pasadas++; }
  catch (e) { fallidas++; fallos.push(`${nombre}\n    ${e.stack?.split("\n").slice(0, 3).join("\n    ") || e.message}`); }
}
const estable = (v) => Array.isArray(v) ? "[" + v.map(estable).join(",") + "]"
  : v && typeof v === "object"
    ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + estable(v[k])).join(",") + "}"
    : JSON.stringify(v);
function igual(a, b, m) {
  if (estable(a) !== estable(b)) throw new Error(`${m || "distinto"}: esperaba ${estable(b)}, obtuve ${estable(a)}`);
}
const cierto = (v, m) => { if (!v) throw new Error(m || "esperaba verdadero"); };

// ---------------------------------------------------------------------------
// Datos planos de partida (ficticios, con la forma real)
// ---------------------------------------------------------------------------

const MESES = ["2026-03", "2026-04", "2026-05", "2026-06"];
const planos = { contratos: [], presupuestos: [], tickets: [] };

for (let i = 0; i < 40; i++) {
  const mes = MESES[i % MESES.length];
  const fecha = `${mes}-1${(i % 9) + 1}`;
  const id = `tk_${i}`, pid = `pre_${i}`;
  const cliente = { nombreComercial: `Centro ${i % 12}`, razonesSociales: [], contacto: "" };
  planos.tickets.push({
    id, numero: `TK-${mes.replace("-", "")}${i}`, fecha, cliente,
    tipoPedido: i % 3 === 0 ? "parte" : "servicio", descripcion: `Pedido ${i}`,
    estado: ["abierto", "presupuestado", "ganado", "perdido"][i % 4],
    presupuestoIds: [pid], usuario: "demo", vendedor: "demo",
    historial: [{ estado: "abierto", fecha, usuario: "demo" }],
  });
  planos.presupuestos.push({
    id: pid, numero: `P${mes.replace("-", "")}${i}`, tipo: "servicio", subtipo: "",
    titulo: `Presupuesto ${i}`, estado: ["borrador", "enviado", "ganado", "perdido"][i % 4],
    estadoOrigen: "", fecha, ticketId: id, cliente, pais: ["AR", "CL", "CO", "UY", "US"][i % 5],
    items: [{ detalle: "Ítem", cantidad: 1, unitario: 1000 + i * 10 }],
    economico: { moneda: "USD", validezDias: 15, descuentoPct: 0, recurrencia: "unica", ivaPct: 21, incluyeIVA: false },
    notas: "", archivos: [], usuario: "demo", historialEstados: [],
  });
}
// Réplica de la forma real: propuestas en distintos estados + un contrato.
for (const [i, est] of ["borrador", "enviada", "firme_vigente", "firme_vigente"].entries()) {
  planos.contratos.push({
    id: `ctr_prop_${i}`, tipo: "propuesta", numero: `P2026070${i}`, estado: est,
    cliente: { nombreComercial: `Centro ${i}`, razonesSociales: [] },
    equipos: [{ modelo: "A", marca: "GE", modalidad: "MRI", serie: "", ubicacion: "" }],
    cobertura: { soporteRemoto: true }, economico: { canonMensual: 3000 + i * 500, moneda: "USD" },
    ajuste: {}, vigencia: { inicio: "2026-02-01", meses: 12 },
    fechas: { creado: `2026-0${i + 1}-10`, enviado: `2026-0${i + 1}-11`, firmado: "" },
    archivos: [], notas: "", historialEstados: [], plan: { id: "performance" },
    negociacion: { desviaciones: [] },
  });
}
planos.contratos.push({
  id: "ctr_1", tipo: "contrato", numero: "CT-2026-0001", estado: "firme_vigente",
  cliente: { nombreComercial: "Centro 0", razonesSociales: [] },
  equipos: [{ modelo: "A", marca: "GE", modalidad: "MRI", serie: "", ubicacion: "" }],
  cobertura: { soporteRemoto: true }, economico: { canonMensual: 4000, moneda: "USD" },
  ajuste: { periodicidad: "trimestral" },
  vigencia: { inicio: "2026-01-01", meses: 12, renovacionAutomatica: true, preavisoDias: 30 },
  fechas: { creado: "2025-12-15", enviado: "2025-12-16", firmado: "2025-12-20" },
  archivos: [], notas: "", historialEstados: [], plan: { id: "performance" },
  negociacion: { desviaciones: [] },
});

const CFG = { owner: "x", dataRepo: "y", branch: "main", token: "t", base: "data/v3" };
const cargarPlano = async (ruta) => planos[ruta.replace("data/", "").replace(".json", "")] || [];
const RUTAS = { contratos: "data/contratos.json", presupuestos: "data/presupuestos.json", tickets: "data/tickets.json" };

// ===========================================================================

const estado = {};
let repo;

await prueba("arranca vacío y detecta que falta migrar", async () => {
  repo = new REP.Repositorio(CFG, estado);
  await repo.abrir();
  cierto(!repo.migrado, "un repo sin índice no está migrado");
});

await prueba("migra desde los archivos planos sin perder registros", async () => {
  const informe = await repo.migrarDesdePlano(RUTAS, cargarPlano);
  igual(informe.errores, [], "sin errores");
  igual(informe.tickets, 40);
  igual(informe.presupuestos, 40);
  igual(informe.contratos, 1);
  cierto(informe.clientes >= 12, `clientes derivados: ${informe.clientes}`);
});

await prueba("escribe una partición por mes, no un archivo único", async () => {
  const rutas = [...archivos.keys()].filter((r) => r.includes("tickets/"));
  igual(rutas.length, MESES.length, "un archivo por mes");
  cierto(rutas.every((r) => /data\/v3\/tickets\/\d{4}-\d{2}\.json$/.test(r)), rutas.join(" "));
});

await prueba("el índice guarda los agregados de cada partición", async () => {
  await repo.abrir();
  cierto(repo.migrado);
  const resumen = repo.almacen.resumen("tickets");
  igual(resumen.cantidad, 40);
  cierto(resumen.porEstado.Cerrado > 0, "cuenta por estado sin abrir las particiones");
});

await prueba("el tablero se dibuja solo con el índice", async () => {
  const antes = peticiones.get;
  const resumen = repo.almacen.resumen("presupuestos");
  igual(peticiones.get - antes, 0, "cero peticiones para el resumen");
  igual(resumen.cantidad, 40);
});

await prueba("carga solo los meses recientes, no todo el histórico", async () => {
  const r2 = new REP.Repositorio(CFG, estado);
  await r2.abrir();
  const r = await r2.cargarTodo({ meses: 2 });
  igual(r.tickets, 20, "dos meses de 10 tickets cada uno");
  igual(r.periodosDisponibles, MESES.length);

  const total = await r2.cargarHistorico("tickets");
  igual(total, 40, "el histórico completo se pide aparte");
});

await prueba("los registros vuelven en la forma que espera app.js", async () => {
  const r2 = new REP.Repositorio(CFG, estado);
  await r2.abrir();
  await r2.cargarTodo({ meses: 12 });

  const t = estado.tickets[0];
  cierto(t.cliente?.nombreComercial, "el cliente vuelve embebido");
  cierto(["abierto", "presupuestado", "ganado", "perdido"].includes(t.estado),
    `estado en forma vieja: ${t.estado}`);

  // Tras separar etapas, `data` contiene solo contratos: las propuestas
  // viven en su propia colección.
  const original = planos.contratos.find((x) => x.tipo === "contrato");
  const c = estado.data.find((x) => x.id === original.id);
  cierto(c, "el contrato sigue en la colección de contratos");
  igual(estado.data.length, 1, "las propuestas ya no están acá");
  igual(c.estado, "firme_vigente");
  igual(c.fechas, original.fechas, "las fechas del contrato sobreviven");
  igual(c.negociacion, original.negociacion, "la negociación sobrevive");
  igual(c.equipos, original.equipos);
});

await prueba("el país del presupuesto sobrevive a la migración", async () => {
  const paises = estado.presupuestos.map((p) => p.pais);
  cierto(paises.includes("CL") && paises.includes("US") && paises.includes("CO"),
    `países presentes: ${[...new Set(paises)].join(",")}`);
});

await prueba("guardar un registro toca una sola partición", async () => {
  const r2 = new REP.Repositorio(CFG, estado);
  await r2.abrir();
  await r2.cargarTodo({ meses: 12 });

  const antes = peticiones.put;
  const t = { ...estado.tickets.find((x) => x.fecha.startsWith("2026-03")), descripcion: "Editado" };
  await r2.guardar("tickets", t, "edición");
  const escrituras = peticiones.put - antes;
  cierto(escrituras <= 2, `escrituras: ${escrituras} (partición + índice)`);

  // Y el cambio quedó guardado
  const r3 = new REP.Repositorio(CFG, {});
  await r3.abrir();
  const guardados = await r3.almacen.cargar("tickets", { todos: true });
  cierto(guardados.some((x) => x.descripcion === "Editado"), "el cambio persistió");
});

await prueba("un alta con cliente nuevo lo suma al padrón", async () => {
  const r2 = new REP.Repositorio(CFG, estado);
  await r2.abrir();
  await r2.cargarTodo({ meses: 12 });
  const antes = r2.clientes.length;

  await r2.guardar("tickets", {
    id: "tk_nuevo", numero: "TK-20260601", fecha: "2026-06-20",
    cliente: { nombreComercial: "Cliente Recién Creado", razonesSociales: [] },
    tipoPedido: "servicio", descripcion: "x", estado: "abierto",
    presupuestoIds: [], usuario: "demo", historial: [],
  }, "alta");

  igual(r2.clientes.length, antes + 1, "el padrón creció");
  const r3 = new REP.Repositorio(CFG, {});
  await r3.abrir();
  const cls = await r3.almacen.cargar("clientes");
  cierto(cls.some((c) => c.nombreComercial === "Cliente Recién Creado"), "quedó guardado");
});

await prueba("un alta masiva da de alta sus clientes nuevos en una sola escritura", async () => {
  const r2 = new REP.Repositorio(CFG, estado);
  await r2.abrir();
  await r2.cargarTodo({ meses: 12 });
  const antes = r2.clientes.length;
  estado.tickets.push(
    { id: "tk_lote1", numero: "TK-20260602", fecha: "2026-06-21", cliente: { nombreComercial: "Cliente Lote Uno", razonesSociales: [] },
      tipoPedido: "servicio", descripcion: "x", estado: "abierto", presupuestoIds: [], usuario: "demo", historial: [] },
    { id: "tk_lote2", numero: "TK-20260603", fecha: "2026-06-22", cliente: { nombreComercial: "Cliente Lote Dos", razonesSociales: [] },
      tipoPedido: "servicio", descripcion: "x", estado: "abierto", presupuestoIds: [], usuario: "demo", historial: [] });
  await r2.guardarColeccion("tickets", "lote");
  igual(r2.clientes.length, antes + 2, "los dos clientes entraron al padrón");
  const r3 = new REP.Repositorio(CFG, {});
  await r3.abrir();
  const tks = await r3.almacen.cargar("tickets", { todos: true });
  cierto(tks.find((t) => t.id === "tk_lote1").clienteId !== "", "el ticket quedó con su cliente");
});

await prueba("reintenta ante escritura concurrente en vez de perder el cambio", async () => {
  const r2 = new REP.Repositorio(CFG, {});
  await r2.abrir();
  await r2.almacen.cargar("tickets", { periodos: ["2026-03"] });

  // Otro usuario escribe la misma partición por detrás: el sha cambia.
  const ruta = "data/v3/tickets/2026-03.json";
  archivos.set(ruta, { contenido: archivos.get(ruta).contenido, sha: "sha-ajeno" });

  const t = E.ENTIDADES.tickets.normalizar({
    id: "tk_concurrente", numero: "TK-C", fecha: "2026-03-15",
    clienteId: "cli_x", descripcion: "concurrente", estado: "Nuevo",
  });
  await r2.almacen.guardar("tickets", t, "concurrente");

  const r3 = new REP.Repositorio(CFG, {});
  await r3.abrir();
  const guardados = await r3.almacen.cargar("tickets", { periodos: ["2026-03"] });
  cierto(guardados.some((x) => x.id === "tk_concurrente"), "el registro sobrevivió al conflicto");
  cierto(guardados.length > 1, "y no borró lo que ya estaba");
});


await prueba("separa el registro único en propuesta y contrato", async () => {
  const r2 = new REP.Repositorio(CFG, {});
  await r2.abrir();
  const props = await r2.almacen.cargar("propuestas");
  const ctrs = await r2.almacen.cargar("contratos");
  igual(props.length, 4, "las cuatro propuestas");
  igual(ctrs.length, 1, "el contrato que ya era contrato");
});

await prueba("las propuestas se numeran con serie PR propia", async () => {
  const r2 = new REP.Repositorio(CFG, {});
  await r2.abrir();
  const props = await r2.almacen.cargar("propuestas");
  cierto(props.every((p) => /^PR-\d{4}-\d{4}$/.test(p.numero)),
    props.map((p) => p.numero).join(" "));
  // Y el número con el que circularon queda para reconciliar.
  cierto(props.every((p) => p.numeroLegado.startsWith("P2026")));
  // Serie separada de la de contratos: no comparten correlativo.
  const ctrs = await r2.almacen.cargar("contratos");
  cierto(!ctrs.some((c) => props.some((p) => p.numero === c.numero)),
    "ningún número se repite entre series");
});

await prueba("las aceptadas sin contrato quedan marcadas como histórico", async () => {
  const r2 = new REP.Repositorio(CFG, {});
  await r2.abrir();
  const props = await r2.almacen.cargar("propuestas");
  const aceptadas = props.filter((p) => p.estado === "Aceptada");
  igual(aceptadas.length, 2, "las dos que estaban en firme_vigente");
  cierto(aceptadas.every((p) => p.esquemaAnterior),
    "marcadas como esquema anterior, no convertidas a contrato");
  cierto(aceptadas.every((p) => !p.contratoId),
    "sin contrato inventado: nadie firmó uno");

  // Y las que no estaban aceptadas no llevan la marca.
  igual(props.filter((p) => p.estado === "Borrador")[0].esquemaAnterior, false);
});

await prueba("el estado viejo se traduce al ciclo de la propuesta", async () => {
  const r2 = new REP.Repositorio(CFG, {});
  await r2.abrir();
  const props = await r2.almacen.cargar("propuestas");
  const porLegado = Object.fromEntries(props.map((p) => [p.numeroLegado, p.estado]));
  igual(porLegado.P20260700, "Borrador");
  igual(porLegado.P20260701, "Enviada");
  igual(porLegado.P20260702, "Aceptada");
});

await prueba("la propuesta conserva lo que se le ofreció al cliente", async () => {
  const r2 = new REP.Repositorio(CFG, {});
  await r2.abrir();
  const p = (await r2.almacen.cargar("propuestas")).find((x) => x.numeroLegado === "P20260702");
  igual(p.economico.canonMensual, 4000);
  igual(p.equipos.length, 1);
  igual(p.cobertura, { soporteRemoto: true });
  igual(p.plan, { id: "performance" });
  igual(p.vigenciaPropuesta.meses, 12);
});

await prueba("ninguna partición se acerca al límite de 1 MB de la API", async () => {
  const grandes = [...archivos.entries()]
    .filter(([r]) => r.includes("/v3/"))
    .map(([r, f]) => ({ ruta: r, kb: Math.round(f.contenido.length / 1024) }))
    .sort((a, b) => b.kb - a.kb);
  cierto(grandes[0].kb < 1024, `la mayor es ${grandes[0].ruta} con ${grandes[0].kb} KB`);
});

await prueba("los KPIs dan lo mismo antes y después de migrar", async () => {
  const idx = AD.indiceClientes(AD.clientesDesde({ tickets: planos.tickets, presupuestos: planos.presupuestos }));
  const ctxPlano = { indiceClientes: idx, presupuestos: planos.presupuestos,
    indicePresupuestos: AD.indicePresupuestos(planos.presupuestos) };
  const antesT = planos.tickets.map((t) => AD.ticketANuevo(t, ctxPlano));

  const r2 = new REP.Repositorio(CFG, {});
  await r2.abrir();
  const despuesT = await r2.almacen.cargar("tickets", { todos: true });

  const a = K.comercial(antesT, { contratos: [] });
  const d = K.comercial(despuesT.filter((x) => !String(x.id).startsWith("tk_concurrente")
    && x.id !== "tk_nuevo"), { contratos: [] });

  igual(d.ganados, a.ganados, "mismos ganados");
  igual(d.perdidos, a.perdidos, "mismos perdidos");
  igual(d.tasaConversion, a.tasaConversion, "misma conversión");
  igual(d.pipeline, a.pipeline, "mismo pipeline");
});

await prueba("el repositorio ve el mismo padrón que la app aunque se reemplace", async () => {
  const st = {};
  const r5 = new REP.Repositorio(CFG, st);
  st.clientes = [{ id: "cli_x", nombreComercial: "Cliente Ficticio", alias: [] }];
  cierto(r5.clientes === st.clientes, "mismo arreglo");
});

await prueba("quitar registros solo toca las particiones que los tienen", async () => {
  const r3 = new REP.Repositorio(CFG, {});
  await r3.abrir();
  const todos = await r3.almacen.cargar("presupuestos", { todos: true });
  const victima = todos[0];
  const putAntes = peticiones.put;
  const n = await r3.eliminarLote("presupuestos", [victima.id, "pre_que_no_existe"], "Prueba de baja");
  igual(n, 1);
  igual(peticiones.put - putAntes, 2, "una partición y el índice");
  const r4 = new REP.Repositorio(CFG, {});
  await r4.abrir();
  const despues = await r4.almacen.cargar("presupuestos", { todos: true });
  igual(despues.length, todos.length - 1);
  cierto(!despues.some((p) => p.id === victima.id), "ya no está");
  igual(await r4.eliminarLote("presupuestos", [], ""), 0, "sin ids no escribe");
});

// ===========================================================================

console.log(`\n  ${pasadas} pasadas · ${fallidas} fallidas`);
console.log(`  peticiones al repo: ${peticiones.get} lecturas · ${peticiones.put} escrituras`);
console.log(`  archivos creados: ${[...archivos.keys()].filter((r) => r.includes("/v3/")).length}\n`);
if (fallos.length) {
  console.log("  FALLOS:");
  for (const f of fallos) console.log(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log("  Capa de datos particionada verificada.\n");
