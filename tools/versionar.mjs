#!/usr/bin/env node
/**
 * Estampa una versión en las etiquetas <script> y <link> de index.html.
 *
 * Por qué hace falta: el sitio se sirve estático desde GitHub Pages, sin paso
 * de compilación. El navegador cachea app.js y los módulos, así que al
 * desplegar un arreglo los usuarios siguen ejecutando el código anterior hasta
 * que hacen una recarga forzada. Eso ya nos pasó dos veces durante el
 * desarrollo: un error corregido seguía apareciendo en la consola, con números
 * de línea que no coincidían con el archivo.
 *
 * Agregar ?v=<marca> a cada recurso hace que una versión nueva sea una URL
 * nueva, y el navegador la baja sí o sí.
 *
 *   node tools/versionar.mjs           # usa la fecha y hora
 *   node tools/versionar.mjs abc1234   # usa un valor propio (por ejemplo el commit)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = resolve(RAIZ, "index.html");

/**
 * Marca de versión.
 *
 * El commit sirve para un despliegue, pero NO alcanza mientras se desarrolla:
 * entre commit y commit el árbol cambia y el hash no, así que la URL queda
 * igual y el navegador sigue sirviendo el archivo viejo. Por eso, si hay
 * cambios sin commitear se agrega una marca de tiempo.
 */
function marca() {
  if (process.argv[2]) return process.argv[2];
  let base;
  try {
    base = execSync("git rev-parse --short HEAD", { cwd: RAIZ }).toString().trim();
  } catch {
    return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  }
  let sucio = false;
  try {
    // Se ignora index.html: lo modifica este mismo script.
    const est = execSync("git status --porcelain -- . ':!index.html'", { cwd: RAIZ }).toString().trim();
    sucio = est.length > 0;
  } catch { /* si git falla, se asume limpio */ }

  return sucio
    ? `${base}-${Date.now().toString(36)}`
    : base;
}

const v = marca();
let html = readFileSync(HTML, "utf8");

// Solo recursos propios: los de CDN (fuentes) tienen su propia caché.
const RECURSO = /(<(?:script src|link[^>]*?href)=")(?!https?:)([^"?]+)(?:\?v=[^"]*)?(")/g;

let cambios = 0;
html = html.replace(RECURSO, (_, ini, ruta, fin) => {
  cambios++;
  return `${ini}${ruta}?v=${v}${fin}`;
});

writeFileSync(HTML, html, "utf8");
console.log(`  versión ${v} estampada en ${cambios} recurso(s) de index.html`);
