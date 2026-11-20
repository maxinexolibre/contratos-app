#!/usr/bin/env node
/**
 * Guarda de sincronía con la migración a Nexolibre Gestión.
 *
 * La app sigue creciendo en main mientras se prepara la migración. El riesgo
 * es el mismo que ya rompió el adaptador cuatro veces: un campo nuevo en el
 * esquema que nadie lleva al otro lado y se pierde en silencio al importar.
 * Esta prueba normaliza un registro vacío de cada entidad y exige que cada
 * campo tenga destino en migracion/mapeo.json (aunque el destino sea "no se
 * migra, porque…").
 *
 *   node tools/probar-migracion.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(resolve(RAIZ, "nucleo/esquema.js"), "utf8"), ctx, { filename: "esquema" });

const mapeo = JSON.parse(readFileSync(resolve(RAIZ, "migracion/mapeo.json"), "utf8"));
const { ENTIDADES } = ctx.NEXO_ESQUEMA;
const errores = [];

for (const [entidad, def] of Object.entries(ENTIDADES)) {
  const m = mapeo[entidad];
  if (!m) { errores.push(`${entidad}: la entidad no tiene destino en mapeo.json`); continue; }
  const campos = Object.keys(def.normalizar({}));
  for (const c of campos) {
    if (!(c in m.campos)) errores.push(`${entidad}.${c}: campo sin destino`);
  }
  for (const c of Object.keys(m.campos)) {
    if (!campos.includes(c)) errores.push(`${entidad}.${c}: está en mapeo.json pero ya no existe en el esquema`);
  }
}
for (const e of Object.keys(mapeo)) {
  if (!e.startsWith("_") && !ENTIDADES[e]) errores.push(`${e}: está en mapeo.json pero no es una entidad del esquema`);
}

if (errores.length) {
  console.error("\n  Mapeo de migración desactualizado:\n");
  for (const e of errores) console.error("   ✗ " + e);
  console.error("\n  Agregá el destino en migracion/mapeo.json.\n");
  process.exit(1);
}
console.log(`\n  Mapeo de migración al día (${Object.keys(ENTIDADES).length} entidades).\n`);
