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
| Índices (IPC, CPI) y ajuste sugerido de canon | `nucleo/indices.js` | 2k |
| Comisiones: seguimiento por operación, cliente nuevo, alertas, reparto 6:2:1 | `nucleo/comisiones.js` · `vistas/comisiones.js` | 9k · 6k |
| Capa de datos de la app sobre el almacén | `nucleo/repositorio.js` | 3k |
| Filtros, paginación, CSV, selector de país | `nucleo/tabla.js` | 2k |
| Catálogo de partes/equipos: parts.json, importación, auditoría | `nucleo/catalogo.js` | 4k |
| Importación de la planilla de presupuestos (Excel) | `nucleo/planilla.js` | 3k |
| Padrón de clientes: grupos y sedes, parecidos, fusión | `nucleo/clientes.js` · `vistas/clientes.js` | 2k · 4k |
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

Hasta noviembre de 2026 los acuerdos de mantenimiento se numeraron como
presupuestos (P2026…). Se pasan a Propuestas con `planAcuerdos()` en
`nucleo/planilla.js`: la propuesta guarda el número viejo en `numeroLegado` y el
contrato que colgaba del presupuesto pasa a colgar de la propuesta.
"Mantenimiento preventivo" a secas es un servicio puntual: sigue siendo presupuesto.

Tipos de presupuesto: **servicio** y **venta** (subtipo partes / intercambio /
equipo). El SaaS de Gestión y Monitoreo Cryo **no se cotiza por presupuesto**:
tiene documento propio. Como cobertura de un contrato sí existe
(`saasMonitoreo` en `planes.js` y `contrato.js`) — son cosas distintas.

El presupuesto lleva **Notas** (una por cada línea del campo) y un **Anexo I ·
Garantía** de plazo configurable, 90 días por defecto, que se puede apagar por
presupuesto o reemplazar por un texto propio.

- **Canon por tramos y equipos que entran después.** `economico.tramos`
  (`{desde, hasta, canonMensual, motivo}`) dice cuánto se factura en un
  período distinto del canon pleno; `equipos[].ingreso` y `garantiaHasta`
  marcan un equipo que figura pero se incorpora más adelante (p. ej. al vencer
  la garantía). Lo que se factura hoy es `canonVigente()` (esquema.js): el MRR
  lo usa, no `canonMensual`. Un ajuste de canon también ajusta los tramos en curso.
- **Bajas, pausas y reanudaciones de equipos** sin reescribir el contrato:
  `equipos[].eventos` (`{fecha, tipo, motivo, canonAntes, canonDespues}`). El
  estado del equipo no se guarda, lo calcula `estadoEquipo()`; los eventos van
  en orden y la regla rechaza una historia imposible. Una pausa con canon
  reducido abre un tramo que la reanudación cierra; una baja con canon nuevo
  deja el cambio también en `ajuste.historial`.
- **Ajuste sugerido por índice.** La ficha del contrato propone el % de ajuste
  con el índice y el período elegidos (por defecto, los meses de la
  periodicidad que terminan antes del ajuste). La serie (`data/indices.json`)
  guarda la **variación mensual** por índice y mes; el acumulado se compone, no
  se suma, y un mes faltante deja la sugerencia en `null`. Se trae de
  datos.gob.ar (IPC) o BLS (CPI) o se carga a mano. Si se usa el sugerido, el
  historial guarda `indiceAplicado`.
- **Moneda y facturación del contrato.** `economico.moneda` (USD/ARS) y
  `economico.facturacion` (`ConFactura` / `SinFactura`, interno: no se imprime).
  El tablero muestra la cartera vigente por cada combinación y el listado filtra
  por las dos.
- **La propuesta se negocia en versiones.** "Renegociar" congela la versión
  enviada en `versiones[]` y abre la siguiente en Borrador (`version` + 1);
  no se puede volver a Borrador sin congelar, ni borrar versiones. La aceptada
  es el acuerdo final que pasa a contrato (`negociacion.versionPropuesta`).
  `fechas.enviado` es el primer envío; `fechas.ultimoEnvio`, el de la vigente.
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
- **Carga rápida** (`#catrapida`) es la pantalla para el celular: cámara directa,
  botones en vez de selects y lectura de etiqueta (BarcodeDetector + tesseract.js
  cargado bajo demanda) que pasa el texto por `leerEtiqueta()`. La foto de la
  etiqueta no se guarda: tiene el SN, que es interno.
- `NEXO_CATALOGO` (planes.js) es el catálogo comercial de planes; el de partes
  es `NEXO_CATALOGO_PARTES`.

## Seguimiento de comisiones

- Al **enviar** un presupuesto o una propuesta se pregunta "¿Lleva comisión?" y
  se guarda una marca (`marcasComision`, en `data/v3/marcas-comision.json`):
  la decisión, quién cobra y los pagos. **El estado no se guarda**: Prevista →
  Ganada (Devengada) → A cobrar (cobro registrado en Facturación) → Pagada, o
  Anulada si la operación se pierde. Lo calcula `lineas()`.
- Base: precio sin IVA, menos `costos` si se cargaron (venta de equipo). La
  comisión se **libera a medida que el cliente paga** (cuotas, abono mes a mes)
  según los cobros de Facturación; una nota de crédito resta.
- Pagos en USD o ARS (TC BNA vendedor de la factura al cliente, guardado en el
  pago). Lo pagado de una operación que se anula queda **a compensar** y se
  descuenta de la próxima de esa persona (pago `Compensacion` + `Ajuste`
  negativo en la otra). `pagadoEfectivo` cuenta solo los `Pago`.
- El reparto va a personas: `vendedores.areaComision`. Cada usuario con rol
  vendedor o marketing ve solo sus líneas.
- Área comercial: 4,5% sin IVA repartido 6:2:1 (Gerencia 3 · Diseño 1 ·
  Marketing 0,5), **solo con clientes nuevos**: sin trabajos efectuados con
  Nexo (presupuesto aprobado, propuesta aceptada, contrato firmado) antes del
  2026-03-01 (`elegibilidad()`, mira también las sedes del mismo grupo). Si lo
  anterior tiene más de 2 años, la app pregunta en vez de decidir.
- Un externo cobra solo si el ticket tiene `traidoPor` con su id (lo asigna
  gerencia). Las cargas históricas se exceptúan, con motivo.
- Para decidir si un cliente es nuevo hace falta todo el historial:
  `asegurarHistorico()` (app/datos.js) carga las particiones viejas.
- El circuito anterior (devengar por contrato → aprobar → liquidar) queda solo
  en el legajo del vendedor, para cerrar lo que hubiera de antes.

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
