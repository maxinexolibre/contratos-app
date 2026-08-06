/**
 * Filtros, paginación y exportación para los listados.
 *
 * Existe porque cada listado resolvía esto a su manera y no todos igual: el
 * CSV de contratos respetaba el filtro activo y el de presupuestos exportaba
 * la lista completa. Bajar el mismo botón y obtener cosas distintas según la
 * pantalla es la clase de inconsistencia que hace desconfiar de los números.
 *
 * Regla que impone este módulo: **lo que se exporta es exactamente lo que se
 * ve**. Si hay filtros aplicados, el CSV los respeta; si hay selección, gana
 * la selección.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;

  /** Cuántas filas se muestran por página. */
  const POR_PAGINA = 50;

  // --------------------------------------------------------------------------
  // Filtros
  // --------------------------------------------------------------------------

  /**
   * Aplica un conjunto de filtros a una lista.
   *
   * @param {Array} lista
   * @param {object} filtro  { q, estado, tipo, pais, mes, desde, hasta }
   * @param {object} campos  cómo leer cada dato del registro
   */
  function filtrar(lista, filtro = {}, campos = {}) {
    const texto = (filtro.q || "").trim().toLowerCase();
    const leer = {
      texto: campos.texto || ((r) => `${r.numero || ""} ${r.descripcion || ""}`),
      estado: campos.estado || ((r) => r.estado),
      tipo: campos.tipo || ((r) => r.tipo),
      pais: campos.pais || ((r) => r.pais),
      fecha: campos.fecha || ((r) => r.fecha),
    };

    return (lista || []).filter((r) => {
      if (texto && !leer.texto(r).toLowerCase().includes(texto)) return false;
      if (filtro.estado && leer.estado(r) !== filtro.estado) return false;
      if (filtro.tipo && leer.tipo(r) !== filtro.tipo) return false;
      if (filtro.pais && leer.pais(r) !== filtro.pais) return false;

      const f = leer.fecha(r) || "";
      // El mes es el filtro que más se usa y el que no existía: cerrar un mes
      // obliga a mirar exactamente ese mes.
      if (filtro.mes && !String(f).startsWith(filtro.mes)) return false;
      if (filtro.desde && f < filtro.desde) return false;
      if (filtro.hasta && f > filtro.hasta) return false;
      return true;
    });
  }

  /** Meses presentes en una lista, del más reciente al más viejo. */
  function mesesDisponibles(lista, campoFecha = "fecha") {
    const set = new Set();
    for (const r of lista || []) {
      const f = typeof campoFecha === "function" ? campoFecha(r) : r[campoFecha];
      if (f) set.add(String(f).slice(0, 7));
    }
    return [...set].sort().reverse();
  }

  /** Etiqueta legible de un mes: "2026-03" → "marzo 2026". */
  const MES_NOMBRE = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  function etiquetaMes(ym) {
    const [a, m] = String(ym).split("-");
    return `${MES_NOMBRE[Number(m) - 1] || m} ${a}`;
  }

  // --------------------------------------------------------------------------
  // Paginación
  // --------------------------------------------------------------------------

  /**
   * Corta una lista en la página pedida.
   * Devuelve también los datos que necesita el pie para dibujarse.
   */
  function paginar(lista, pagina = 1, porPagina = POR_PAGINA) {
    const total = lista.length;
    const paginas = Math.max(1, Math.ceil(total / porPagina));
    const p = Math.min(Math.max(1, pagina), paginas);
    const desde = (p - 1) * porPagina;
    return {
      filas: lista.slice(desde, desde + porPagina),
      pagina: p, paginas, total,
      desde: total ? desde + 1 : 0,
      hasta: Math.min(desde + porPagina, total),
    };
  }

  /**
   * Pie de paginación. `alIr` es el nombre de una función global que recibe
   * el número de página.
   */
  function pie(pag, alIr) {
    if (pag.total === 0) return "";
    if (pag.paginas === 1) {
      return `<p class="muted" style="font-size:13px;margin-top:10px">${pag.total} registro(s)</p>`;
    }
    const btn = (n, txt, activo) =>
      `<button class="btn sm${activo ? " primary" : ""}" onclick="${alIr}(${n})"${activo ? " aria-current=\"page\"" : ""}>${txt}</button>`;

    // Ventana de páginas alrededor de la actual: con 40 páginas, listarlas
    // todas es peor que no tener paginación.
    const nums = [];
    const desde = Math.max(1, pag.pagina - 2);
    const hasta = Math.min(pag.paginas, desde + 4);
    for (let i = desde; i <= hasta; i++) nums.push(btn(i, i, i === pag.pagina));

    return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px">
      <span class="muted" style="font-size:13px">${pag.desde}–${pag.hasta} de ${pag.total}</span>
      <span style="flex:1"></span>
      ${pag.pagina > 1 ? btn(pag.pagina - 1, "‹") : ""}
      ${desde > 1 ? btn(1, "1") + '<span class="muted">…</span>' : ""}
      ${nums.join("")}
      ${hasta < pag.paginas ? '<span class="muted">…</span>' + btn(pag.paginas, pag.paginas) : ""}
      ${pag.pagina < pag.paginas ? btn(pag.pagina + 1, "›") : ""}
    </div>`;
  }

  // --------------------------------------------------------------------------
  // Exportación
  // --------------------------------------------------------------------------

  /**
   * Descarga un CSV.
   *
   * Recibe las filas YA filtradas: este módulo no vuelve a consultar el estado
   * global, justamente para que no pueda exportar algo distinto de lo que se
   * está viendo.
   *
   * @param {Array} filas
   * @param {Array} columnas  [{ clave, titulo, valor(fila) }]
   * @param {string} nombre   nombre del archivo, sin extensión
   */
  function exportarCSV(filas, columnas, nombre) {
    const escapar = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lineas = [columnas.map((c) => escapar(c.titulo || c.clave)).join(",")];
    for (const f of filas) {
      lineas.push(columnas.map((c) => escapar(c.valor ? c.valor(f) : f[c.clave])).join(","));
    }
    // El BOM hace que Excel abra bien los acentos. Sin él, "Diagnóstico"
    // aparece como "DiagnÃ³stico".
    const blob = new Blob(["﻿" + lineas.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${nombre}-${E.hoy()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    return filas.length;
  }

  /** Descripción legible de los filtros activos, para avisar qué se exportó. */
  function describirFiltro(filtro = {}) {
    const partes = [];
    if (filtro.q) partes.push(`"${filtro.q}"`);
    if (filtro.pais) partes.push(E.PAIS_NOMBRE[filtro.pais] || filtro.pais);
    if (filtro.mes) partes.push(etiquetaMes(filtro.mes));
    if (filtro.estado) partes.push(filtro.estado);
    if (filtro.tipo) partes.push(filtro.tipo);
    return partes.length ? partes.join(" · ") : "sin filtros";
  }

  /** ¿Hay algún filtro activo? Sirve para ofrecer el botón de limpiar. */
  const hayFiltro = (f = {}) =>
    Boolean(f.q || f.estado || f.tipo || f.pais || f.mes || f.desde || f.hasta);

  // --------------------------------------------------------------------------
  // Selector de país, compartido por los tableros
  // --------------------------------------------------------------------------

  /**
   * Barra de países. "Todos" queda primero porque la mirada consolidada
   * sigue siendo la principal; los países son un corte sobre ella.
   */
  function selectorPais(actual, alElegir, disponibles) {
    const lista = disponibles?.length ? disponibles : E.PAIS;
    const btn = (v, txt) =>
      `<button type="button" class="btn sm${actual === v ? " primary" : ""}" onclick="${alElegir}('${v}')">${txt}</button>`;
    return `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <span class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.08em">País</span>
      ${btn("", "Todos")}
      ${lista.map((p) => btn(p, E.PAIS_NOMBRE[p] || p)).join("")}
    </div>`;
  }

  global.NEXO_TABLA = {
    POR_PAGINA, filtrar, mesesDisponibles, etiquetaMes,
    paginar, pie, exportarCSV, describirFiltro, hayFiltro, selectorPais,
  };
})(typeof window !== "undefined" ? window : globalThis);
