import fs from "node:fs"; import vm from "node:vm";
process.chdir(new URL("..", import.meta.url).pathname);
const _els = {}, store = {};
const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, files: [], value: "", checked: false, querySelectorAll: () => [], querySelector: () => null, insertAdjacentHTML() {}, appendChild() {}, click() {}, remove() {}, innerHTML: "", textContent: "" });
const ctx = {
  _els, console, structuredClone, TextEncoder, TextDecoder, btoa, atob, setTimeout, clearTimeout, Blob, URL,
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => store[k] = String(v), removeItem: k => delete store[k] },
  fetch: async (u) => ({ ok: true, arrayBuffer: async () => fs.readFileSync(u.replace(/^\//, "")).buffer }),
  document: { createElement: () => ({ style: {}, click() {} }), head: { appendChild() {} }, getElementById: (id) => (_els[id] ||= el()), querySelectorAll: () => [], querySelector: () => null, addEventListener() {} },
  location: { hash: "" }, alert() {}, confirm: () => true, prompt: () => null, print() {},
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.addEventListener = () => {};
vm.createContext(ctx);
for (const f of ["config.js", "brand.js", "planes.js", "contrato.js", "presupuesto.js", "app.js"]) vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f });
vm.runInContext(fs.readFileSync("vendor/docx.iife.js", "utf8"), ctx, { filename: "docx.iife.js" });
vm.runInContext("window.docx = docx;", ctx);
vm.runInContext(fs.readFileSync("docgen.js", "utf8"), ctx, { filename: "docgen.js" });

// Presupuesto PLANTILLA: sin datos → el sistema emite [campos] en naranja.
// Se muestra la estructura de un presupuesto de servicio con filas de ejemplo.
const blob = await vm.runInContext(`(async()=>{
  const T = {
    tipo:"servicio", numero:"", fecha:"",
    cliente:{ nombreComercial:"", razonesSociales:[{razonSocial:"",cuit:"",domicilio:"",principal:true}], contacto:"", localidad:"", provincia:"" },
    items:[ {detalle:"", cantidad:"", unitario:""}, {detalle:"", cantidad:"", unitario:""} ],
    saas:[ {producto:"cryo", detalle:"", abonoMensual:"", meses:"", setup:""} ],
    economico:{ moneda:"USD", ivaPct:21, incluyeIVA:false, validezDias:"", formaPago:"" },
    notas:""
  };
  const m = NEXO_PRESUPUESTO.construirPresupuesto(T,{plantilla:true});
  m.titulo = "[Tipo de presupuesto]";
  return await armarPresupuestoDocx(window.docx, m);
})()`, ctx);
const buf = Buffer.from(await blob.arrayBuffer());
const out = "/Users/Maxi/Library/CloudStorage/OneDrive-Personal/2. Comercial/Marketing y Diseño/Nexolibre - Plantilla Presupuesto (NexoCare).docx";
fs.writeFileSync(out, buf);
console.log("plantilla presupuesto:", buf.length, "bytes →", out.split("/").pop());
