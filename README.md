# contratos-app — Plataforma de contratos de Nexolibre

Interfaz web (estática) para gestionar propuestas y contratos de service de imágenes (MRI/CT):
tablero, pipeline, cobertura visual, vencimientos/aumentos, PDF de marca y exportación.

**App en vivo:** https://nexolibre.github.io/contratos-app/
**Datos (privado):** [`Nexolibre/contratos-data`](https://github.com/Nexolibre/contratos-data)

## Cómo funciona

- Es una SPA sin backend. Los datos viven en el repo **privado** `contratos-data` (`data/contratos.json`).
- La app lee y escribe ese archivo vía la API de GitHub, usando un **token personal** que cada usuario
  pega una vez (se guarda solo en su navegador, en `localStorage`).
- Sin token, la app abre en **modo demo** (datos de ejemplo, cambios solo locales).

## Primer uso (cada integrante)

1. Pedile a Maxi que te agregue como colaborador de `Nexolibre/contratos-data`.
2. Abrí la app → botón ⚙ → seguí los pasos para generar el token (fine-grained PAT,
   solo `contratos-data`, permiso *Contents: Read and write*) y pegalo.
3. Listo: ves y editás los datos reales desde cualquier dispositivo.

## Configuración

`config.js` define el owner y el repo de datos. Editar solo si cambian esos valores.

## Desarrollo local

```bash
python3 -m http.server 8765   # y abrir http://localhost:8765
```

Nexolibre es miembro de Grupo Nexo.

---

## Catálogo comercial (`planes.js`)

Dos capas separadas a propósito:

### 1. Lo que el cliente ve — tres planes y un servicio

| | Claim | Precio |
|---|---|---|
| **Essential** | Para quien quiere empezar. | desde USD 890 |
| **Professional** | El equilibrio entre cobertura y costo. | USD 1.800 – 2.500 |
| **Enterprise** | Continuidad operativa como estándar. | hasta USD 3.900 |
| **Nexo Custom** | «Diseñamos un contrato exactamente para su operación.» | sin precio publicado |

El folleto tiene tres precios y una decisión fácil. Nexo Custom no es un plan: es un
servicio de diseño, y por eso no lleva precio de lista.

### 2. Lo que el cliente NO ve — los módulos internos

`Bobinas · Prioridad · Horas adicionales · Repuestos · Stock reservado · Capacitación ·
Auditoría · Monitoreo Cryo`

Cada módulo tiene un **valor de referencia** (para armar el número) y una **línea
pública** redactada como beneficio, nunca como módulo. Ejemplo: el módulo *Prioridad*
no se nombra jamás — se traduce en un SLA on-site de 12 h y en la frase «Atención
prioritaria con tiempos de respuesta reducidos».

El cliente recibe un **«Contrato Professional»**. No sabe que por dentro es
`Professional + Prioridad + Bobinas + 8 h extra + Auditoría + Stock reservado`.

**Garantía técnica de la separación:** `generarPDF()` imprime únicamente
`plan.etiquetaPublica` y el alcance resultante. Los nombres de módulo viven en la
tarjeta «🔒 Composición interna» del detalle (fondo taupe = interno) y en el CSV, que
es de uso interno. El informe PDF, que sí puede circular, solo muestra el rótulo público.

## Criogenia

**No ofrecemos mantenimiento de criogenia.** Sí ofrecemos su **monitoreo**, dentro del
SaaS de Gestión y Monitoreo Cryo. La cláusula DECIMOTERCERA lo dice sin ambigüedad:
la prestación comprende «monitoreo, registro y gestión de la información criogénica» y
«no constituye servicio de mantenimiento de la cadena de frío»; helio, cold-head,
compresores y líneas quedan excluidos y se cotizan aparte.

## Identidad del cliente

Un cliente tiene **un nombre comercial** (el que se ve en toda la app) y **N razones
sociales**, una de ellas marcada como la que factura y firma. Si hay más de una, el
preámbulo del contrato las incorpora como sociedades alcanzadas por el acuerdo.

## Documentos del expediente

Los contratos se negocian y el texto final rara vez es idéntico al modelo. Desde el
detalle se puede **adjuntar el acuerdo final** (y la propuesta, el firmado, anexos):
el archivo se sube a `archivos/<N° de contrato>/` en el repo privado de datos y queda
enlazado en la ficha. Los desvíos respecto del modelo se registran además como texto
en «Cambios acordados en la negociación».
