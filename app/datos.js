/**
 * Capa de datos: API de contenidos de GitHub, stores, persistencia,
 * repositorio particionado, semilla de demostración y numeración.
 *
 * Parte de la aplicación, dividida por dominio. Todos los archivos de
 * app/ comparten el ámbito global: se cargan en orden y las constantes
 * declaradas antes son visibles después. El orden importa.
 */

// -------- base64 utf-8 --------
const b64encode = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob((b64 || "").replace(/\n/g, "")), (c) => c.charCodeAt(0)));

// ============================================================
//  Capa de datos (GitHub API o demo local)
// ============================================================
function ghHeaders() {
  return {
    Authorization: `Bearer ${localStorage.getItem(LS.pat)}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
// ¿El token tiene permiso de escritura sobre el repo de datos?
// Si es de solo lectura, la app se pone en modo consulta en vez de dejar
// que el usuario cargue cosas y falle recién al guardar.
async function ghPuedeEscribir() {
  try {
    const r = await fetch(`https://api.github.com/repos/${CFG.owner}/${CFG.dataRepo}`, { headers: ghHeaders() });
    if (!r.ok) return false;
    const j = await r.json();
    return !!(j.permissions?.push || j.permissions?.admin);
  } catch { return false; }
}
// Registro de los tres archivos de datos del repo privado. Cada uno se
// carga y guarda por separado, con su propio sha, para que un cambio en
// presupuestos no pise una edición de contratos hecha en paralelo.
const STORE_DEF = {
  contratos: { path: () => CFG.dataPath, key: "data", shaKey: "sha", ls: LS.demo, seed: () => DEMO_SEED, migrate: (a) => migrarTodos(a) },
  presupuestos: { path: () => CFG.presupuestosPath, key: "presupuestos", shaKey: "presuSha", ls: LS.demoPresu, seed: () => DEMO_PRESU, migrate: (a) => migrarPresupuestos(a) },
  tickets: { path: () => CFG.ticketsPath, key: "tickets", shaKey: "ticketsSha", ls: LS.demoTickets, seed: () => DEMO_TICKETS, migrate: (a) => migrarTickets(a) },
  // Entidades del modelo v3. Se normalizan con el esquema del núcleo, que es
  // el único lugar donde está definida su forma. Arrancan vacías.
  campanas: { path: () => CFG.campanasPath, key: "campanas", shaKey: "campanasSha", ls: "nexo_demo_campanas", seed: () => [], migrate: (a) => normalizar("campanas", a) },
  estrategias: { path: () => CFG.estrategiasPath, key: "estrategias", shaKey: "estrategiasSha", ls: "nexo_demo_estrategias", seed: () => [], migrate: (a) => normalizar("estrategias", a) },
  leads: { path: () => CFG.leadsPath, key: "leads", shaKey: "leadsSha", ls: "nexo_demo_leads", seed: () => [], migrate: (a) => normalizar("leads", a) },
  facturaciones: { path: () => CFG.facturacionesPath, key: "facturaciones", shaKey: "facturacionesSha", ls: "nexo_demo_facturaciones", seed: () => [], migrate: (a) => normalizar("facturaciones", a) },
  tiposCambio: { path: () => CFG.tiposCambioPath, key: "tiposCambio", shaKey: "tiposCambioSha", ls: "nexo_demo_tc", seed: () => [], migrate: (a) => normalizar("tiposCambio", a) },
  propuestas: { path: () => CFG.propuestasPath, key: "propuestas", shaKey: "propuestasSha", ls: "nexo_demo_prop", seed: () => [], migrate: (a) => normalizar("propuestas", a) },
  clientes: { path: () => CFG.clientesPath, key: "clientes", shaKey: "clientesSha", ls: "nexo_demo_cli", seed: () => [], migrate: (a) => normalizar("clientes", a) },
  vendedores: { path: () => CFG.vendedoresPath, key: "vendedores", shaKey: "vendedoresSha", ls: "nexo_demo_vnd", seed: () => [], migrate: (a) => normalizar("vendedores", a) },
  acuerdosComision: { path: () => CFG.acuerdosComisionPath, key: "acuerdosComision", shaKey: "acuerdosSha", ls: "nexo_demo_acu", seed: () => [], migrate: (a) => normalizar("acuerdosComision", a) },
  comisiones: { path: () => CFG.comisionesPath, key: "comisiones", shaKey: "comisionesSha", ls: "nexo_demo_com", seed: () => [], migrate: (a) => normalizar("comisiones", a) },
};

// Normaliza una colección con el esquema del núcleo. Los registros ilegibles
// se avisan por consola en vez de desaparecer en silencio.
function normalizar(entidad, arr) {
  const { registros, fallidos } = window.NEXO_ESQUEMA.normalizarColeccion(entidad, arr);
  if (fallidos.length) console.warn(`${fallidos.length} registro(s) ilegibles en ${entidad}`, fallidos);
  return registros;
}
async function ghLoadFile(path) {
  const url = `https://api.github.com/repos/${CFG.owner}/${CFG.dataRepo}/contents/${path}?ref=${CFG.branch}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (r.status === 404) return { arr: [], sha: null };
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json()).message || r.statusText}`);
  const j = await r.json();
  return { arr: JSON.parse(b64decode(j.content)), sha: j.sha };
}
async function ghSaveFile(path, arr, sha, msg) {
  const url = `https://api.github.com/repos/${CFG.owner}/${CFG.dataRepo}/contents/${path}`;
  const body = { message: msg, content: b64encode(JSON.stringify(arr, null, 2) + "\n"), branch: CFG.branch };
  if (sha) body.sha = sha;
  const r = await fetch(url, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json()).message || r.statusText}`);
  return (await r.json()).content.sha;
}
// Carga un store desde el repo y lo migra. Los archivos de presupuestos y
// tickets pueden no existir todavía (404) → arrancan vacíos.
async function loadStore(store) {
  const def = STORE_DEF[store];
  const { arr, sha } = await ghLoadFile(def.path());
  state[def.key] = def.migrate(arr);
  state[def.shaKey] = sha;
}

/**
 * Capa de datos particionada. Se instancia al conectar y, a partir de ahí,
 * todas las lecturas y escrituras pasan por acá.
 */
let repo = null;

/**
 * Carga todo desde la estructura particionada.
 *
 * Si el repo todavía no la tiene, se leen los archivos planos y se migran en
 * el momento. Es una sola vez y queda hecho para todo el equipo.
 */
async function cargarDesdeRepositorio() {
  repo = new window.NEXO_REPOSITORIO.Repositorio({
    owner: CFG.owner, dataRepo: CFG.dataRepo, branch: CFG.branch,
    token: localStorage.getItem(LS.pat), base: CFG.baseDatos || "data/v3",
  }, state);
  await repo.abrir();

  if (!repo.migrado) {
    toast("Primera vez: migrando a la estructura particionada…", false, true);
    const informe = await repo.migrarDesdePlano(
      { contratos: CFG.dataPath, presupuestos: CFG.presupuestosPath, tickets: CFG.ticketsPath },
      async (ruta) => (await ghLoadFile(ruta)).arr);
    console.info("Migración a estructura particionada:", informe);
    if (informe.errores.length) console.warn("Errores en la migración:", informe.errores);
    toast(`Migrado: ${informe.tickets} tickets · ${informe.presupuestos} presupuestos · ` +
          `${informe.contratos} contratos · ${informe.clientes} clientes`);
    await repo.abrir();
  }

  const r = await repo.cargarTodo({ meses: 12 });
  console.info(`Cargado desde particiones: ${r.tickets} tickets, ${r.presupuestos} ` +
    `presupuestos de los últimos 12 meses (${r.periodosDisponibles} períodos disponibles).`);
  return r;
}
async function ghUploadFile(path, base64, msg) {
  const url = `https://api.github.com/repos/${CFG.owner}/${CFG.dataRepo}/contents/${path}`;
  // averiguar sha si ya existe
  let sha;
  const cur = await fetch(`${url}?ref=${CFG.branch}`, { headers: ghHeaders() });
  if (cur.ok) sha = (await cur.json()).sha;
  const body = { message: msg, content: base64, branch: CFG.branch };
  if (sha) body.sha = sha;
  const r = await fetch(url, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Upload ${r.status}`);
}

/**
 * Guarda un store, reintentando si otro usuario escribió el mismo archivo.
 *
 * Sin esto, dos personas guardando a la vez terminaban con la segunda
 * recibiendo un error de GitHub y perdiendo su edición. Ahora se recarga la
 * versión ajena, se vuelven a aplicar los cambios propios encima y se
 * reintenta: nadie pisa a nadie y nadie pierde trabajo.
 *
 * La lógica es la misma que implementa NEXO_ALMACEN; vive acá mientras la
 * capa de datos siga siendo de archivo plano.
 */
async function ghSaveConReintento(store, msg) {
  const def = STORE_DEF[store];
  const REINTENTOS = 3;

  for (let intento = 1; intento <= REINTENTOS; intento++) {
    try {
      return await ghSaveFile(def.path(), state[def.key], state[def.shaKey], msg);
    } catch (e) {
      const conflicto = /\b(409|422)\b/.test(String(e.message));
      if (!conflicto || intento === REINTENTOS) throw e;

      // Se recarga lo que hay en el repo y se reaplican los registros propios
      // por id. Los ajenos que no tocamos quedan intactos.
      const { arr, sha } = await ghLoadFile(def.path());
      const ajenos = def.migrate(arr);
      const mios = new Map((state[def.key] || []).map((r) => [r.id, r]));
      const fusionado = ajenos.map((r) => mios.get(r.id) || r);
      for (const [id, r] of mios) {
        if (!ajenos.some((x) => x.id === id)) fusionado.push(r);
      }
      state[def.key] = fusionado;
      state[def.shaKey] = sha;
      console.warn(`Conflicto en ${store}: se fusionó con la versión del repo y se reintenta.`);
    }
  }
}

/**
 * Guarda cambios.
 *
 * Con `registro` se escribe una sola partición —el archivo del mes de ese
 * registro— en lugar de toda la colección. Es la diferencia entre reescribir
 * 30 KB y reescribir 120 KB en cada guardado, y crece con la historia.
 */
async function persist(msg, store = "contratos", registro = null) {
  if (state.soloLectura) throw new Error("Tu acceso es de solo lectura: podés consultar y descargar, no modificar.");
  const def = STORE_DEF[store];
  if (state.mode === "connected") {
    if (repo) {
      if (registro) await repo.guardar(store, registro, msg);
      else await repo.guardarColeccion(store, msg);
      return;
    }
    state[def.shaKey] = await ghSaveConReintento(store, msg);
  } else {
    localStorage.setItem(def.ls, JSON.stringify(state[def.key]));
    localStorage.setItem(LS.demoVer, DEMO_VERSION);
    toast("Modo demo: cambios guardados solo en este navegador", true, false);
  }
}

// Dataset demo embebido: clientes FICTICIOS, a propósito.
// Este archivo vive en un repo público. Nunca poner acá datos reales de
// clientes (nombres, contactos, canones): los datos reales viven solo en
// el repo privado y llegan por la API con el token de cada usuario.
const DEMO_SEED = [
  {
    id: "demo_propuesta", tipo: "propuesta", numero: "P20260101", estado: "enviada",
    cliente: {
      nombreComercial: "Centro de Imágenes Ejemplo",
      razonesSociales: [{ razonSocial: "Centro de Imágenes Ejemplo S.A.", cuit: "30-00000000-0", domicilio: "Calle Ejemplo 100", principal: true }],
      contacto: "Contacto de ejemplo", localidad: "Ciudad Ejemplo", provincia: "Buenos Aires",
    },
    plan: { id: "performance", etiquetaPublica: "NexoCare Performance", modulos: ["cryo"], notasInternas: "Registro de ejemplo para probar la interfaz." },
    equipos: [
      { modelo: "Modelo A 1.5T", marca: "GE", modalidad: "MRI", serie: "", ubicacion: "Sede central" },
      { modelo: "Modelo B", marca: "GE", modalidad: "CT", serie: "", ubicacion: "Sede central" },
    ],
    cobertura: { preventivoInspeccionesAnuales: 4, correctivoManoObra: true, reparacionBobinasPorAnio: 2, bobinasAlcance: "flota", soporteRemoto: true, saasMonitoreo: true, partesIncluidas: false, viaticosIncluidos: true, enviosRepuestosIncluidos: true, reparacionesIncluidas: ["Reparación electrónica de bobinas de RM: hasta 2 por año para el conjunto de los equipos de resonancia, no acumulables"] },
    economico: { canonMensual: 2000, moneda: "USD", incluyeIVA: false, ivaPct: 21, formaPago: "Mensual, antes del 5º día hábil" },
    ajuste: { periodicidad: "trimestral", indice: "US_CPI", proximoAjuste: "", historial: [] },
    vigencia: { inicio: "", meses: 12, fin: "", renovacionAutomatica: true, preavisoDias: 30 },
    fechas: { creado: "2026-01-01", enviado: "2026-01-01", firmado: "" },
    archivos: [], notas: "Registro de ejemplo. Los datos reales se cargan al conectar con el repositorio privado.",
    negociacion: { desviaciones: [] },
    historialEstados: [{ estado: "borrador", fecha: "2026-01-01", usuario: "demo" }, { estado: "enviada", fecha: "2026-01-01", usuario: "demo" }],
  },
  {
    id: "demo_contrato", tipo: "contrato", numero: "P20250505", estado: "firme_vigente",
    cliente: {
      nombreComercial: "Diagnóstico Demo",
      razonesSociales: [
        { razonSocial: "Diagnóstico Demo S.R.L.", cuit: "30-11111111-1", domicilio: "Av. Ejemplo 200", principal: true },
        { razonSocial: "Demo Imágenes S.A.", cuit: "30-22222222-2", domicilio: "", principal: false },
      ],
      contacto: "Contacto de ejemplo", localidad: "Ciudad Ejemplo", provincia: "Santa Fe",
    },
    plan: { id: "assurance", etiquetaPublica: "NexoCare Assurance", modulos: ["bobinas", "prioridad"], notasInternas: "Registro de ejemplo: muestra la composición interna." },
    equipos: [{ modelo: "Modelo C 1.5T", marca: "Philips", modalidad: "MRI", serie: "", ubicacion: "Sede única" }],
    cobertura: {
      preventivoInspeccionesAnuales: 4, correctivoManoObra: true, reparacionBobinasPorAnio: "sin límite", bobinasAlcance: "flota",
      soporteRemoto: true, saasMonitoreo: true, partesIncluidas: false,
      viaticosIncluidos: true, enviosRepuestosIncluidos: true,
      reparacionesIncluidas: [
        "Bobinas de RM: todas las del equipo, sin límite de reparaciones",
        "Reparaciones electromecánicas de camilla paciente",
        "Host y recargas de software",
      ],
    },
    economico: { canonMensual: 3000, moneda: "USD", incluyeIVA: false, ivaPct: 21, formaPago: "Mensual (mes vencido), entre el día 1 y 10 de cada mes" },
    ajuste: { periodicidad: "semestral", indice: "US_CPI", proximoAjuste: "", historial: [] },
    vigencia: { inicio: "2025-05-05", meses: 12, fin: "", renovacionAutomatica: true, preavisoDias: 30 },
    fechas: { creado: "2025-05-05", enviado: "2025-05-05", firmado: "2025-05-05" },
    archivos: [], notas: "Registro de ejemplo.",
    negociacion: { desviaciones: [] },
    historialEstados: [
      { estado: "borrador", fecha: "2025-05-05", usuario: "demo" },
      { estado: "enviada", fecha: "2025-05-05", usuario: "demo" },
      { estado: "firme_vigente", fecha: "2025-05-05", usuario: "demo" },
    ],
  },
];

// Datasets demo de tickets y presupuestos: FICTICIOS a propósito (repo público).
const DEMO_TICKETS = [
  {
    id: "demo_tk1", numero: "TK-2026-001", fecha: "2026-02-10",
    cliente: { nombreComercial: "Centro de Imágenes Ejemplo", razonesSociales: [{ razonSocial: "Centro de Imágenes Ejemplo S.A.", cuit: "30-00000000-0", principal: true }], contacto: "Contacto de ejemplo" },
    tipoPedido: "servicio", descripcion: "Solicitan presupuesto de reparación de bobina de RF con falla intermitente.",
    estado: "presupuestado", presupuestoIds: ["demo_pre1"], usuario: "demo", historial: [{ estado: "abierto", fecha: "2026-02-10", usuario: "demo" }, { estado: "presupuestado", fecha: "2026-02-12", usuario: "demo" }],
  },
];
const DEMO_PRESU = [
  {
    id: "demo_pre1", numero: "PRE-2026-001", tipo: "servicio", estado: "enviado", fecha: "2026-02-12", ticketId: "demo_tk1",
    cliente: { nombreComercial: "Centro de Imágenes Ejemplo", razonesSociales: [{ razonSocial: "Centro de Imágenes Ejemplo S.A.", cuit: "30-00000000-0", domicilio: "Calle Ejemplo 100", principal: true }], contacto: "Contacto de ejemplo", localidad: "Ciudad Ejemplo", provincia: "Buenos Aires" },
    items: [
      { detalle: "Diagnóstico y reparación electrónica de bobina de RF", cantidad: 1, unitario: 3200 },
      { detalle: "Visita técnica y viáticos", cantidad: 1, unitario: 400 },
    ],
    economico: { moneda: "USD", ivaPct: 21, incluyeIVA: false, validezDias: 15, formaPago: "50% anticipo, 50% contra entrega" },
    notas: "Registro de ejemplo. Los datos reales se cargan al conectar con el repositorio privado.",
    archivos: [], usuario: "demo", historialEstados: [{ estado: "borrador", fecha: "2026-02-12", usuario: "demo" }, { estado: "enviado", fecha: "2026-02-12", usuario: "demo" }],
  },
  {
    id: "demo_pre2", numero: "PRE-2026-002", tipo: "partes", estado: "borrador", fecha: "2026-03-01",
    cliente: { nombreComercial: "Diagnóstico Demo", razonesSociales: [{ razonSocial: "Diagnóstico Demo S.R.L.", cuit: "30-11111111-1", principal: true }], contacto: "Contacto de ejemplo", provincia: "Santa Fe" },
    items: [
      { detalle: "Gradient amplifier (reacondicionado)", sku: "GA-000", cantidad: 1, unitario: 18500, unitarioIntercambio: 12500, intercambio: true },
    ],
    economico: { moneda: "USD", ivaPct: 10.5, incluyeIVA: false, validezDias: 20, formaPago: "Contado" },
    notas: "Registro de ejemplo.", archivos: [], usuario: "demo", historialEstados: [{ estado: "borrador", fecha: "2026-03-01", usuario: "demo" }],
  },
];

// ---- numeración ----
// TK-AAAA-NNN / PRE-AAAA-NNN, correlativo por año sobre lo ya existente.
// Numeración real del área comercial: P + AAAA + MM + correlativo del mes
// (P20260413 = cuarto mes de 2026, presupuesto 13). El ticket la espeja.
function proxSecuenciaMes() {
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const rx = new RegExp(`^(?:P|TK-)${ym}(\\d{2})`);
  // Se mira en los dos registros: ticket y presupuesto comparten correlativo,
  // así el pedido TK-20260805 se corresponde con el presupuesto P20260805.
  const max = [...(state.presupuestos || []), ...(state.tickets || [])].reduce((m, x) => {
    const g = String(x.numero || "").match(rx);
    return g ? Math.max(m, Number(g[1])) : m;
  }, 0);
  return { ym, n: String(max + 1).padStart(2, "0") };
}
function proxNumeroPresu() { const { ym, n } = proxSecuenciaMes(); return `P${ym}${n}`; }
function proxNumeroTicket() { const { ym, n } = proxSecuenciaMes(); return `TK-${ym}${n}`; }

// ============================================================
//  Init
// ============================================================
