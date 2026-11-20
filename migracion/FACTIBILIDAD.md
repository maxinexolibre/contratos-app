# Migración de contratos-app a Nexolibre Gestión · factibilidad

Análisis hecho el 20/11/2026 contra `main` (5a33aef) y el documento
"Requisitos para migrar una app a Nexolibre Gestión". Sin acceso todavía al
repo del sistema: todo lo que dice "a confirmar" depende de ver su esquema real.

## Veredicto

**Es factible, pero es una reescritura de pantallas con migración de datos, no
una mudanza de código.** El documento lo dice explícito: una app que no está en
Next.js + TypeScript no se migra, se migran los datos y la lógica.

Lo que sí se salva casi entero es `nucleo/`: unos 260 KB de lógica pura, sin DOM
ni fetch, con pruebas headless. Reglas, códigos NX, transiciones, KPIs por
moneda, comisiones escalonadas marginales, tipo de cambio congelado, lista
blanca del catálogo. Pasarlo a TypeScript es trabajo mecánico y es justamente
lo más caro de rehacer. Lo que se reescribe es `app/` y `vistas/` (~7.900
líneas de pantallas) y la capa de datos (GitHub → Supabase).

Esfuerzo estimado: **8 a 12 semanas** de una persona con Claude, más el tiempo
de respuesta de la compañera a las preguntas de la sección 6.

## 1. Compatibilidad de stack

| Tema | contratos-app hoy | Nexolibre Gestión | Qué implica |
|---|---|---|---|
| Lenguaje | JavaScript sin build, ámbito global | TypeScript estricto, Next.js 16 | Se reescriben las pantallas. `nucleo/` se porta a `lib/comercial/*.ts` |
| Base | JSON en repo privado de GitHub, particionado por período | Supabase/Postgres con RLS | GitHub como base viva está en la lista de "no se aceptan". Se migran los datos |
| Credenciales | PAT por usuario en `localStorage` | Sesión de Supabase | Desaparece el PAT. Mejora real de seguridad |
| Permisos | `permisos.js` solo esconde botones (lo dice el propio archivo) | RLS en la base | Pasa a ser un límite real. La matriz ya está escrita en un solo lugar y se traduce a políticas |
| Deploy | GitHub Pages + `versionar.mjs` | Vercel desde `main` | Se termina el problema del caché |
| Documentos | HTML imprimible + `docx` | `jspdf` / `exceljs` | A confirmar si aceptan seguir generando Word para contratos |
| Integraciones | dolarapi.com, API de GitHub (publicar catálogo), tesseract.js | Server Actions | La publicación a nexolibre.com pasa a una Server Action con el token en variables de Vercel |

## 2. Mapeo del modelo de datos

El detalle campo por campo está en [`mapeo.json`](mapeo.json), y
`node tools/probar-migracion.mjs` falla si aparece un campo en el esquema sin
destino ahí. Resumen:

**Se reutiliza (tabla maestra, solo se agregan columnas)**

| Entidad nuestra | Tabla del sistema | Notas |
|---|---|---|
| clientes | `clientes` + `razones_sociales` | Nuestro `grupo` es su cliente y cada `sede` es una razón social (`CL025-01`). Se cruza por CUIT; lo que no cruce se lista a mano |
| usuarios | `profiles` / `memberships` | Ver roles abajo |
| presupuestos | `presupuestos` | Faltan probablemente: tipo/subtipo, país, condición IVA, garantía, validez, vendedor, hash, motivo de anulación. Ítems a `presupuesto_items` si no existe |
| contratos | `contratos` | Faltan: origen, propuesta, vigencia completa, cobertura/ajuste/plan (jsonb), número legado |
| equipos de contratos y propuestas | `equipos` | Hoy son una lista dentro del contrato; pasan a referenciar el equipo instalado |
| facturaciones | `facturas` / `cobros` | Hoy un solo registro hace de las dos cosas. Faltan tipo de cambio congelado y `periodo_cobrado` |
| proveedor del catálogo | `proveedores` | Hoy es texto libre |

**Se agrega (tabla nueva)**

`oportunidades` (nuestros tickets), `propuestas` + `propuesta_equipos`,
`vendedores`, `acuerdos_comision`, `comisiones`, `tipos_cambio` (si Finanzas no
tiene una), `catalogo_items` + `catalogo_fotos`, y para una fase 2 las de
marketing: `mkt_campanas`, `mkt_estrategias`, `mkt_leads`, `mkt_toques`.

Todas con `empresa_id`, `uuid`, `created_at`/`created_by`, estados como `text`
con `check` y una columna `legado_id` con el id viejo (`pre_…`, `ctr_…`) para
poder reconciliar durante la convivencia.

**Roles**

| Rol nuestro | Rol del sistema | Falta |
|---|---|---|
| vendedor | `comercial` | Que la RLS limite a "propios" (`vendedor_id` = el suyo) |
| gerente_comercial | `comercial` + capacidad `aprobar_comercial` | La capacidad |
| gerente_administrativo | `finanzas` | — |
| direccion | `acceso_total` | — |
| marketing | — | No existe el rol. Capacidad o rol nuevo |
| admin | `admin` | — |

## 3. Brechas a resolver

- **B1 · Multiempresa y país.** Cada registro nuestro lleva `pais` (AR · CL · CO · UY · US), que define moneda de facturación y comisiones de área. Hay que saber si Nexolibre es una empresa en `empresas` o vive dentro de `grupo-nexo`, y si las filiales de cada país son empresas aparte. Cambia todas las políticas.
- **B2 · Monedas.** El documento dice `moneda: ARS / USD`. Nosotros cotizamos en USD o UF y liquidamos en ARS, CLP o USD. Hay que ampliar el `check`.
- **B3 · Ticket vs. Trabajo.** El Trabajo es su expediente. Nuestro ticket es una oportunidad que puede perderse. Propuesta: la oportunidad es tabla propia y el Trabajo nace al aprobarse el presupuesto o firmarse el contrato.
- **B4 · Propuesta → Contrato.** Las dos etapas no existen en el sistema. El "Vinculado a" tiene que aceptar `propuesta` como tipo.
- **B5 · Estados.** Hay que mapear nuestros estados (`Borrador/Enviado/Aprobado/Rechazado/Anulado`, `EnRevision/Firmado/Activo…`) a los que ya admite su `check`, sin perder transiciones.
- **B6 · Totales congelados.** Su regla es no guardar derivados. Nosotros guardamos subtotal/total/neto a propósito: un presupuesto aprobado no puede cambiar de monto solo. Propuesta: calcular en vista mientras es borrador y congelar al emitir.
- **B7 · Cobro por período.** Sin `periodo_cobrado`, el primer cobro de un abono da el contrato por cerrado. Tiene que existir en `cobros`/`facturas`.
- **B8 · Comisiones son datos sensibles.** Montos por persona: solo totales salvo Finanzas y Admin. Encaja con su regla, pero hay que escribir las políticas.
- **B9 · Catálogo y stock.** Existe el rol `stock`. Si ya hay inventario, el catálogo de partes tendría que colgar de ahí y no ser una tabla aparte.
- **B10 · Publicación en nexolibre.com.** Escribe en el repo público `nexolibre/nexolibre`. Necesita un token en las variables de Vercel, nunca en el código.

## 4. Paquete de entrega (sección 5 del documento)

| # | Entregable | Estado |
|---|---|---|
| 1 | Descripción funcional | Se arma de `CLAUDE.md` y `README.md`. Falta |
| 2 | Pantallas (capturas/video) | Lo tiene que grabar alguien con la app abierta. Falta |
| 3 | Modelo de datos | `mapeo.json` + este documento. Falta exportarlo en tabla (nombre, tipo, obligatorio, ejemplo ficticio) |
| 4 | Reglas de negocio | Están en código (`nucleo/reglas.js`, `kpi.js`, `comisiones.js`). Falta documento legible |
| 5 | Roles y permisos | `nucleo/permisos.js` + tabla de arriba |
| 6 | Datos a migrar | Falta script que pase `contratos-data` a CSV por tabla. Se entrega por canal privado, nunca en este repo |
| 7 | Integraciones | Sección 1. Sin claves |
| 8 | Código fuente | Este repo |

## 5. Migraciones SQL

Quedan para cuando tengamos el esquema real (`supabase db dump --schema-only`
o acceso al repo). Escribirlas antes es adivinar nombres de columnas de
`presupuestos`, `contratos` y `facturas`. Van a seguir sus reglas: un archivo
por cambio, `if not exists`, `drop policy if exists` + `create policy`, y la
importación histórica en partes de hasta 200 KB.

## 6. Preguntas para la compañera

1. ¿Nos podés dar acceso al repo, o un dump del esquema sin datos?
2. ¿Nexolibre es una empresa en `empresas`? ¿Y cada país? (B1)
3. ¿Se puede ampliar `moneda` a USD, UF, ARS y CLP? (B2)
4. ¿Cuándo nace el Trabajo de una venta? (B3)
5. ¿Qué estados admiten hoy `presupuestos` y `contratos`? (B5)
6. ¿Aceptan totales congelados al emitir? (B6)
7. ¿`facturas`/`cobros` tienen tipo de cambio y período? ¿Quién es el dueño de esas tablas? (B7)
8. ¿Rol o capacidad para Marketing y para el gerente comercial?
9. ¿Hay inventario de stock? (B9)
10. ¿Se puede seguir generando el contrato en Word?

## 7. Cómo convive con el desarrollo en main

- Esta rama solo suma archivos en `migracion/` y `tools/probar-migracion.mjs`. No toca nada de la app, así que traer `main` (`git merge origin/main`) no da conflictos.
- Lo que se agregue en `main` a `nucleo/` (reglas, campos, KPIs) se lleva a la migración casi gratis. Lo que se agregue en `app/` o `vistas/` (pantallas) se va a escribir dos veces.
- `probar-migracion.mjs` avisa cuando un campo nuevo del esquema no tiene destino. Conviene sumarlo a la lista de "Antes de commitear" cuando la migración arranque en serio.

## 8. Plan por fases

| Fase | Qué | Duración |
|---|---|---|
| 0 | Respuestas de la compañera y esquema real | depende de ella |
| 1 | Migraciones SQL: columnas nuevas, tablas nuevas, RLS | 3 a 4 días |
| 2 | Portar `nucleo/` a TypeScript con sus pruebas | 1 a 1,5 semanas |
| 3 | Script de exportación y reconciliación de clientes por CUIT | 3 a 5 días |
| 4 | Pantallas: presupuestos, propuestas, contratos, facturación, comisiones, catálogo, tableros. Marketing al final | 4 a 6 semanas |
| 5 | Convivencia con usuarios reales, corte y baja de la app vieja | 2 semanas |
