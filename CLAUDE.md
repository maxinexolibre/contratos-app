# Plataforma comercial Nexolibre

App estática sin build. Se sirve desde GitHub Pages (repo público) y guarda los
datos en el repo **privado** `maxinexolibre/contratos-data`, vía la API de
contenidos de GitHub con un PAT por usuario guardado en `localStorage`.

> **Regla que no se negocia:** este repo es público. Nunca poner acá datos
> reales de clientes —nombres, CUIT, cánones, importes—. Los ejemplos y las
> pruebas usan datos ficticios. Antes de commitear, escanear el diff.

---

## Dónde está cada cosa

| Necesitás tocar… | Archivo | ~tokens |
|---|---|---|
| Forma de un registro, campos, validación de tipos | `nucleo/esquema.js` | 8k |
| Reglas de negocio, códigos NX, transiciones de estado | `nucleo/reglas.js` | 7k |
| Cálculo de KPIs, monedas, denominadores | `nucleo/kpi.js` | 5k |
| Matriz de permisos por rol | `nucleo/permisos.js` | 2k |
| Lectura/escritura particionada, índice, conflictos | `nucleo/almacen.js` | 4k |
| Traducción forma vieja ↔ modelo v3 | `nucleo/adaptador.js` | 4k |
| Tipos de cambio, conversión, facturación | `nucleo/cambio.js` | 3k |
| Comisiones, acuerdos, reparto interno | `nucleo/comisiones.js` | 5k |
| Capa de datos de la app sobre el almacén | `nucleo/repositorio.js` | 3k |
| Filtros, paginación, CSV, selector de país | `nucleo/tabla.js` | 2k |
| Catálogo de partes/equipos: parts.json, importación, auditoría | `nucleo/catalogo.js` | 4k |
| Estado global, constantes, fechas, migraciones | `app/base.js` | 4k |
| API de GitHub, stores, persistencia, demo | `app/datos.js` | 4k |
| Arranque, router, navegación, tema | `app/chrome.js` | 2k |
| Pantallas de contratos | `app/contratos.js` | 17k |
| Pantallas de tickets | `app/tickets.js` | 3k |
| Pantallas de presupuestos | `app/presupuestos.js` | 9k |
| Tableros, gráficos, reportes | `app/tableros.js` | 7k |
| Propuestas, facturación, marketing, vendedores | `vistas/*.js` | 6–8k c/u |
| Catálogo: pantallas y publicación en nexolibre.com | `vistas/catalogo.js` | 9k |

**Empezá por la tabla, no por una búsqueda.** El repo entero son ~176 mil
tokens; leer el archivo correcto cuesta entre 2k y 17k.

---

## Arquitectura

```
nucleo/    lógica pura, sin DOM ni fetch. Testeable headless.
app/       la aplicación: estado global + pantallas. Ámbito compartido.
vistas/    pantallas nuevas, construidas directo sobre el núcleo.
tools/     pruebas y utilidades de línea de comandos.
```

`nucleo/` **no depende de nada** de `app/` ni de `vistas/` — verificado por el
grafo de código. Si agregás una dependencia hacia afuera, rompés eso.

Los archivos de `app/` comparten el ámbito global: se cargan en orden y las
constantes declaradas antes se ven después. `app/tableros.js` va último porque
arranca la aplicación. Ese orden está en `index.html` y hay que respetarlo.

---

## Modelo de datos

Ticket → Presupuesto → Contrato para trabajos puntuales.
Propuesta comercial → Contrato para acuerdos de mantenimiento (dos etapas).

Tipos de presupuesto: **servicio** y **venta** (subtipo partes / intercambio /
equipo). El SaaS de Gestión y Monitoreo Cryo **no se cotiza por presupuesto**:
tiene documento propio. Como cobertura de un contrato sí existe
(`saasMonitoreo` en `planes.js` y `contrato.js`) — son cosas distintas.

El presupuesto lleva **Notas** (una por cada línea del campo) y un **Anexo I ·
Garantía** de plazo configurable, 90 días por defecto, que se puede apagar por
presupuesto o reemplazar por un texto propio.

- **Todo se cotiza en USD** (o UF en Chile). La conversión a moneda local ocurre
  únicamente al facturar, y el tipo de cambio queda congelado en el comprobante.
- Los importes **nunca se suman entre monedas**. Los KPIs devuelven mapas por
  moneda, no un número único.
- Un abono mensual se cobra **por período**: `periodoCobrado` en cada
  comprobante. Sin eso, el primer cobro da el contrato por cerrado.

Países: AR · CL · CO · UY · US.

---

## Catálogo de partes y equipos

Reemplaza a la lista de SharePoint. Los ítems viven en `contratos-data`
(`data/v3/catalogo.json`) y el botón **Publicar** escribe `parts.json` y las
fotos nuevas en el repo **público** `nexolibre/nexolibre`, en un solo commit.

- `aParte()` en `nucleo/catalogo.js` es una **lista blanca**. Costo, proveedor,
  N° de serie y notas nunca salen. Un campo nuevo no se publica hasta que se
  agrega ahí, y hay prueba que lo controla.
- `parts.json` conserva la forma que escribía SharePoint: de ella dependen
  `catalog.js`, `pseo_build.py`, el PDF y el bot de DOTmed.
- Las fotos sin publicar quedan en `data/v3/catalogo-fotos/` del repo privado.
- `NEXO_CATALOGO` (planes.js) es el catálogo comercial de planes; el de partes
  es `NEXO_CATALOGO_PARTES`.

## Convenciones

- **Español rioplatense** en código, comentarios, mensajes de commit e interfaz.
- Los comentarios explican **por qué**, no qué. Si el porqué es un bug que ya
  pasó, contalo: evita que alguien lo "arregle" de vuelta.
- Marca Nexolibre: `~/.claude/NEXOLIBRE-BRAND.md`. Naranja `#ef8f03`, oscuro
  taupe `#645d56`, títulos en Exo.
- Clases CSS reales: `grid-kpi` (no `kpis`), `table.data` (no `tabla`),
  `form-grid` (no `grid-2`).

---

## Antes de commitear

```bash
node tools/probar-nucleo.mjs        # reglas, KPIs, esquema
node tools/probar-repositorio.mjs   # capa de datos particionada
node tools/versionar.mjs            # cache-busting de los recursos
```

`versionar.mjs` es obligatorio: sin él, Pages sirve el JavaScript viejo después
de desplegar. Ya pasó tres veces.

Y siempre `git fetch` + `pull --ff-only` en `contratos-data` antes de escribir:
el equipo carga datos por la app mientras se trabaja.

---

## Trampas conocidas

Cosas que ya rompieron y tienen prueba de regresión:

- **Campo anidado sin propagar en el adaptador.** Pasó cuatro veces: `moneda`
  del presupuesto, `condicionIVA`, `pais` y `unitarioIntercambio` (este cotizaba
  el precio de lista en una venta por intercambio: US$ 34.000 en lugar de
  US$ 22.900). Al agregar un campo al esquema, revisá `adaptador.js` en las
  **dos** direcciones y sumale una prueba de ida y vuelta.
- **`null` que se vuelve `0` en la segunda vuelta.** `unitarioIntercambio: null`
  significa "no se cotizó precio con intercambio"; `money(null)` da 0, que
  significa "gratis". Usá `== null`, no `=== undefined`.
- **KPI que lee de la raíz un campo anidado.** `p.canonMensual` vs
  `p.economico.canonMensual` — da cero en silencio.
- **`cierreEstimado` dándose vuelta** en el ida y vuelta: hace que el ciclo de
  venta cuente cierres de 0 días como reales.
- **Denominador cero → `null`, nunca `0`.** Un 0% se lee como "pésimo"; un "—"
  se lee como "todavía no hay datos".
- **Escalonado marginal**, no por tramo alcanzado: si no, vender un peso más
  dispara la comisión e incentiva demorar el cierre.
- **Caché del navegador.** Si un error persiste con números de línea que no
  coinciden con el archivo, es caché: pestaña nueva.
