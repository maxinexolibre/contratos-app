/**
 * Padrón de clientes: grupos con sedes, duplicados y fusión.
 *
 * El padrón se armó de a poco, a partir de nombres escritos a mano en la
 * planilla y en los documentos. Un mismo cliente quedó con dos o tres nombres
 * ("Ejemplo", "Sanatorio Ejemplo") y las redes con varias sedes quedaron como
 * clientes sueltos. Este módulo detecta los parecidos, agrupa por sede y arma
 * —sin escribir nada— el plan para fusionar dos registros que son el mismo.
 *
 * Lógica pura: recibe listas y devuelve listas. No toca DOM ni red.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;
  const clave = (s) => E.claveCliente(s);

  /** Nombre con el que el cliente suma en reportes: su grupo, o él mismo. */
  const nombreGrupo = (c) => c.grupo || c.nombreComercial || c.razonSocial || "";

  /**
   * Clientes agrupados: [{ nombre, clave, clientes: [...] }], ordenados por nombre.
   * Un cliente sin grupo es un grupo de uno.
   */
  function agrupar(clientes) {
    const m = new Map();
    for (const c of clientes || []) {
      const n = nombreGrupo(c);
      const k = clave(n);
      if (!m.has(k)) m.set(k, { nombre: n, clave: k, clientes: [] });
      m.get(k).clientes.push(c);
    }
    for (const g of m.values()) {
      g.clientes.sort((a, b) => (a.sede || a.nombreComercial).localeCompare(b.sede || b.nombreComercial, "es"));
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }

  /** Grupos existentes, para ofrecerlos al cargar una sede. */
  const nombresDeGrupo = (clientes) =>
    [...new Set((clientes || []).map((c) => c.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));

  // Similitud por distancia de edición: 1 menos la proporción de letras a
  // cambiar. Con bigramas, dos nombres cortos que difieren en una letra daban 0,6 por ser palabras cortas;
  // así da 0,75 y una sola letra de diferencia se detecta igual.
  function similitud(a, b) {
    if (a === b) return 1;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return 1 - prev[n] / Math.max(m, n, 1);
  }
  const distancia = (a, b) => Math.round((1 - similitud(a, b)) * Math.max(a.length, b.length));

  // Palabras que no distinguen a un cliente de otro: dos "Sanatorio X" no se
  // parecen por ser sanatorios.
  const GENERICAS = new Set(["sanatorio", "clinica", "centro", "medico", "hospital", "instituto",
    "diagnostico", "imagenes", "salud", "de", "del", "la", "el", "los", "y", "s", "a", "srl", "sa"]);
  const nucleoNombre = (s) => clave(s).split(" ").filter((w) => w && !GENERICAS.has(w)).join(" ");

  /**
   * Pares de clientes que podrían ser el mismo o del mismo grupo.
   * No mira los que ya comparten grupo. Devuelve [{a, b, motivo}] de mayor a menor parecido.
   */
  function parecidos(clientes, umbral = 0.8) {
    const lista = (clientes || []).filter((c) => c.nombreComercial);
    const out = [];
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i], b = lista[j];
        if (a.grupo && clave(a.grupo) === clave(b.grupo)) continue;
        const ka = clave(a.nombreComercial), kb = clave(b.nombreComercial);
        const na = nucleoNombre(a.nombreComercial), nb = nucleoNombre(b.nombreComercial);
        let motivo = null, puntaje = 0;
        if (ka === kb) { motivo = "Mismo nombre"; puntaje = 1; }
        else if (na && nb && na === nb) { motivo = "Mismo nombre sin el tipo de institución"; puntaje = 0.95; }
        else if (na.length >= 4 && nb.length >= 4 && (` ${nb} `.includes(` ${na} `) || ` ${na} `.includes(` ${nb} `))) {
          motivo = "Un nombre contiene al otro (¿sede?)"; puntaje = 0.9;
        } else if (na && nb) {
          const s = similitud(na, nb);
          if (s >= umbral || (Math.min(na.length, nb.length) >= 4 && distancia(na, nb) === 1)) { motivo = "Nombres muy parecidos (¿error de tipeo?)"; puntaje = s; }
        }
        if (motivo) out.push({ a, b, motivo, puntaje });
      }
    }
    return out.sort((x, y) => y.puntaje - x.puntaje);
  }

  /**
   * Plan para fusionar `origen` en `destino` (son el mismo cliente).
   *
   * Los registros en forma vieja (presupuestos, tickets, contratos) no llevan
   * id de cliente: lo resuelve el adaptador por nombre al guardar. Por eso se
   * les cambia el nombre al del destino, y el destino se queda con los nombres
   * del origen como alias: un documento viejo con el nombre anterior sigue cayendo en
   * el cliente correcto. Las entidades nativas llevan clienteId y se cambia ese.
   *
   * @param {object} estado { presupuestos, tickets, data (contratos), propuestas, leads, comisiones }
   * @returns {{ destino, quitar, cambios: {store: [registros]}, cuenta }}
   */
  function planFusion(origen, destino, estado = {}) {
    if (!origen || !destino || origen.id === destino.id) throw new Error("Elegí dos clientes distintos");
    const claves = new Set([origen.nombreComercial, origen.razonSocial, ...(origen.alias || [])]
      .filter(Boolean).map(clave));
    const nuevoDestino = E.ENTIDADES.clientes.normalizar({
      ...destino,
      alias: [...new Set([...(destino.alias || []), origen.nombreComercial, origen.razonSocial, ...(origen.alias || [])]
        .filter((a) => a && clave(a) !== clave(destino.nombreComercial)))],
    });
    // Lo que el destino no tiene y el origen sí, se completa. Nunca se pisa.
    for (const k of ["cuit", "localidad", "provincia", "contacto", "email", "telefono", "grupo", "sede"]) {
      if (!nuevoDestino[k] && origen[k]) nuevoDestino[k] = origen[k];
    }

    const cambios = {};
    const viejos = { presupuestos: "presupuestos", tickets: "tickets", data: "contratos" };
    for (const [clv, store] of Object.entries(viejos)) {
      const tocados = (estado[clv] || [])
        .filter((r) => claves.has(clave(r.cliente?.nombreComercial)))
        .map((r) => ({ ...r, cliente: { ...r.cliente, nombreComercial: destino.nombreComercial } }));
      if (tocados.length) cambios[store] = tocados;
    }
    for (const store of ["propuestas", "leads", "comisiones"]) {
      const tocados = (estado[store] || []).filter((r) => r.clienteId === origen.id)
        .map((r) => ({ ...r, clienteId: destino.id }));
      if (tocados.length) cambios[store] = tocados;
    }
    const cuenta = Object.fromEntries(Object.entries(cambios).map(([k, v]) => [k, v.length]));
    return { destino: nuevoDestino, quitar: origen.id, cambios, cuenta };
  }

  global.NEXO_CLIENTES = { agrupar, nombresDeGrupo, nombreGrupo, parecidos, planFusion, similitud };
})(typeof window !== "undefined" ? window : globalThis);
