/**
 * Catálogo de partes y equipos: la lógica que no depende de la pantalla.
 *
 * El catálogo de nexolibre.com lee un único archivo, `parts.json`, en el repo
 * público de la web. Antes lo escribía un flujo de Power Automate a partir de
 * una lista de SharePoint; ahora lo genera esta aplicación al publicar.
 *
 * Se mantiene la forma exacta de ese archivo porque de él dependen cinco
 * cosas de la web: el catálogo (catalog.js), las páginas /repuestos/
 * (pseo_build.py), el PDF del catálogo, el bot de DOTmed y el dedupe del
 * agente de eBay. Cambiar la forma acá obligaría a tocar las cinco.
 *
 * La regla de oro: `aParte` es una LISTA BLANCA. El registro del catálogo
 * tiene costo, proveedor y N° de serie, y el repo de la web es público. Un
 * campo nuevo en el esquema no llega a la web hasta que alguien lo agrega
 * acá a propósito, y hay una prueba que lo verifica.
 *
 * Ojo con el nombre: NEXO_CATALOGO (planes.js) es el catálogo COMERCIAL de
 * planes y módulos. Este es el de partes y equipos, NEXO_CATALOGO_PARTES.
 *
 * Este archivo vive en un repo público. Solo mecánica, nunca datos reales.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;

  /** Lo único que se ofrece en la web. Reservado, vendido o sin stock no se muestran. */
  const PUBLICABLES = ["EnStock", "APedido"];

  /**
   * Modalidades sugeridas en las pantallas. No es un vocabulario cerrado: el
   * campo es texto libre y el filtro de la web se arma con lo que haya en
   * parts.json, así que una modalidad nueva aparece sola sin tocar el sitio.
   */
  const MODALIDADES = ["MRI", "CT", "PET/CT", "SPECT", "Rayos X", "Mamografía", "Angiografía", "Arco en C", "Ecografía"];

  const CONDICION_TEXTO = {
    Nuevo: "Nuevo", Reacondicionado: "Reacondicionado", Usado: "Usado", ParaPartes: "Para partes",
  };
  const DISPONIBILIDAD_TEXTO = {
    EnStock: "En stock", APedido: "A pedido", Reservado: "Reservado",
    SinStock: "Sin stock", Vendido: "Vendido", Baja: "Baja",
  };

  /** Ubicación tal como la escribía SharePoint → código de país. */
  const PAIS_DE_TEXTO = {
    argentina: "AR", chile: "CL", colombia: "CO", uruguay: "UY",
    "estados unidos": "US", usa: "US", "united states": "US", eeuu: "US",
  };

  const vacio = (v) => v == null || String(v).trim() === "" || String(v).trim() === "-";
  const textoONull = (v) => (vacio(v) ? null : String(v).trim());

  // --------------------------------------------------------------------------
  // Precios
  // --------------------------------------------------------------------------

  /**
   * "1.200,00" → 1200 · "Consultar" → null.
   * Es el mismo criterio que usa precio_num() en el bot de DOTmed: si los dos
   * lados no coinciden, un precio publicado acá llega distinto allá.
   */
  function textoAPrecio(v) {
    if (v == null) return null;
    if (typeof v === "number") return v > 0 ? v : null;
    let s = String(v).trim();
    if (!/\d/.test(s)) return null;
    s = s.replace(/[^\d.,]/g, "");
    if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
    else if (s.includes(",")) s = s.replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /** 1200 → "1.200,00" · null → "Consultar". */
  function precioATexto(n) {
    if (n == null) return "Consultar";
    const [ent, dec] = Number(n).toFixed(2).split(".");
    return `${ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
  }

  // --------------------------------------------------------------------------
  // Referencias y fotos
  // --------------------------------------------------------------------------

  /** Siguiente referencia libre del país: NX-AR-041 si la última es NX-AR-040. */
  function proximaRef(items, pais) {
    const pre = `NX-${pais || "AR"}-`;
    const max = (items || []).reduce((m, x) => {
      const r = String(x.ref || "");
      if (!r.startsWith(pre)) return m;
      const n = Number(r.slice(pre.length));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    return pre + String(max + 1).padStart(3, "0");
  }

  /**
   * Nombre de archivo para una foto nueva: NX-AR-001-3.jpg. Sigue la
   * convención que ya usan las 40 piezas propias en assets/parts/.
   */
  function nombreFoto(ref, fotos, ext = "jpg") {
    const rx = new RegExp(`^${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.\\w+$`, "i");
    const max = (fotos || []).reduce((m, f) => {
      const g = String(f.archivo || f).match(rx);
      return g ? Math.max(m, Number(g[1])) : m;
    }, 0);
    return `${ref}-${max + 1}.${ext}`;
  }

  const esUrl = (s) => /^https?:\/\//i.test(String(s || ""));

  // --------------------------------------------------------------------------
  // Hacia la web
  // --------------------------------------------------------------------------

  function esPublicable(item) {
    return Boolean(item.publicarWeb && item.nombre && item.ref && PUBLICABLES.includes(item.disponibilidad));
  }

  /**
   * Proyección pública de un ítem, en la forma de parts.json.
   * LISTA BLANCA: cada campo que sale está escrito acá a mano.
   */
  function aParte(item) {
    return {
      ref: item.ref,
      nombre: item.nombre,
      categoria: textoONull(item.categoria),
      modalidad: textoONull(item.modalidad),
      marca: textoONull(item.marca),
      modelo_compatible: textoONull(item.modeloCompatible),
      nro_parte: textoONull(item.nroParte),
      estado: CONDICION_TEXTO[item.condicion] || "Usado",
      disponibilidad: DISPONIBILIDAD_TEXTO[item.disponibilidad],
      ubicacion: E.PAIS_NOMBRE[item.pais] || null,
      // Número, no texto: el bot de DOTmed hace int(garantia).
      garantia: item.garantiaDias == null ? null : item.garantiaDias,
      precio: precioATexto(item.precio),
      descripcion: textoONull(item.descripcion),
      imagen: item.fotos.length ? item.fotos.map((f) => f.archivo).join(";") : null,
      tipo: item.tipo,
      // El bot de DOTmed publica solo lo que trae este campo en true. Con todos
      // en false no publica ni borra nada (ver publicables() en dotmed_sync.py).
      dotmed: Boolean(item.canales?.dotmed),
    };
  }

  const porRef = (a, b) => a.ref.localeCompare(b.ref, "es", { numeric: true });

  /** El parts.json completo que se publica. */
  function aParts(items) {
    return (items || []).filter(esPublicable).sort(porRef).map(aParte);
  }

  /** Fotos que todavía no están en la web y hacen falta para publicar. */
  function fotosPorSubir(items) {
    return (items || []).filter(esPublicable).flatMap((item) =>
      item.fotos.filter((f) => !f.publicada && !esUrl(f.archivo)).map((f) => ({ item, foto: f })));
  }

  /** JSON con claves ordenadas: el orden de las claves no es un cambio. */
  function firma(o) {
    if (Array.isArray(o)) return `[${o.map(firma).join(",")}]`;
    if (o && typeof o === "object") {
      return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${firma(o[k])}`).join(",")}}`;
    }
    return JSON.stringify(o);
  }

  /**
   * Qué cambia en la web si se publica. Se muestra antes de confirmar: es la
   * única revisión que hay entre la app y un sitio público.
   */
  function diferencias(actual, nuevo) {
    const a = new Map((actual || []).map((p) => [p.ref, p]));
    const n = new Map((nuevo || []).map((p) => [p.ref, p]));
    const altas = [], bajas = [], cambios = [];
    for (const [ref, p] of n) {
      if (!a.has(ref)) altas.push(p);
      else {
        const viejo = a.get(ref);
        // Se ignoran los campos que el parts.json de SharePoint no tenía: si no,
        // la primera publicación marcaría las 138 piezas como cambiadas.
        const campos = Object.keys(p).filter((k) => k in viejo &&
          firma(p[k]) !== firma(normalizarViejo(k, viejo[k])));
        if (campos.length) cambios.push({ parte: p, campos });
      }
    }
    for (const [ref, p] of a) if (!n.has(ref)) bajas.push(p);
    return { altas, bajas, cambios };
  }

  /** SharePoint escribía 90.0, "" o null donde ahora va 90, null o "Consultar". No son cambios. */
  function normalizarViejo(k, v) {
    if (k === "garantia") return vacio(v) ? null : Number(v);
    if (k === "estado") return CONDICION_TEXTO[condicionDesde(v)];
    if (k === "precio") return precioATexto(textoAPrecio(v));      // null y "Consultar" son lo mismo
    if (typeof v === "string") return textoONull(v);
    return v;
  }

  // --------------------------------------------------------------------------
  // Desde la web (importación inicial de lo que cargó SharePoint)
  // --------------------------------------------------------------------------

  function condicionDesde(t) {
    const s = String(t || "").toLowerCase();
    if (/part/.test(s)) return "ParaPartes";            // "For parts or not working", "Para partes"
    if (/recond|refurb/.test(s)) return "Reacondicionado";
    if (/^(new|nuevo)/.test(s)) return "Nuevo";
    return "Usado";
  }

  function disponibilidadDesde(t) {
    const s = String(t || "").toLowerCase();
    if (/sin stock|out of stock/.test(s)) return "SinStock";
    if (/stock/.test(s)) return "EnStock";
    if (/vendid|sold/.test(s)) return "Vendido";
    if (/reserv/.test(s)) return "Reservado";
    return "APedido";
  }

  const EQUIPO = /\b(equipo|resonador|tom[oó]grafo|scanner|system)\b/i;

  /**
   * Una pieza de parts.json → ítem del catálogo.
   *
   * Todo lo importado entra con auditoría "Pendiente": la lista de SharePoint
   * tenía oportunidades de eBay que nadie verificó si siguen a la venta, y la
   * idea es revisarlas una por una antes de seguir ofreciéndolas.
   */
  function desdeParte(p, { usuario = "", hoy = E.hoy() } = {}) {
    const fotos = String(p.imagen || "").split(/[;,\n]+/).map((s) => s.trim()).filter(Boolean)
      .map((archivo) => ({ archivo, publicada: true }));
    const deEbay = fotos.some((f) => /ebayimg\.com/i.test(f.archivo));
    const ref = String(p.ref || "").trim().toUpperCase();
    const garantia = vacio(p.garantia) ? null : Number(p.garantia);
    return E.ENTIDADES.catalogo.normalizar({
      ref,
      tipo: EQUIPO.test(p.categoria || "") ? "Equipo" : "Parte",
      nombre: p.nombre,
      categoria: textoONull(p.categoria) || "",
      modalidad: textoONull(p.modalidad) || "",
      marca: textoONull(p.marca) || "",
      modeloCompatible: textoONull(p.modelo_compatible) || "",
      nroParte: textoONull(p.nro_parte) || "",
      condicion: condicionDesde(p.estado),
      disponibilidad: disponibilidadDesde(p.disponibilidad),
      pais: PAIS_DE_TEXTO[String(p.ubicacion || "").trim().toLowerCase()] || "AR",
      garantiaDias: Number.isFinite(garantia) && garantia > 0 ? garantia : null,
      precio: textoAPrecio(p.precio),
      descripcion: textoONull(p.descripcion) || "",
      fotos,
      publicarWeb: true,
      canales: { dotmed: p.dotmed === true },
      // NX-XX es la serie que se usó para las oportunidades de terceros.
      procedencia: deEbay || ref.startsWith("NX-XX-") ? "Terceros" : "Propia",
      proveedor: deEbay ? "eBay" : "",
      auditoria: { estado: "Pendiente" },
      origen: "sharepoint",
      creado: hoy,
      usuario,
    });
  }

  /** Importa sin pisar: lo que ya está en el catálogo (misma ref) se saltea. */
  function importar(parts, existentes, opciones) {
    const ya = new Set((existentes || []).map((x) => x.ref));
    const nuevos = [], omitidos = [];
    for (const p of parts || []) {
      const item = desdeParte(p, opciones);
      if (!item.ref || ya.has(item.ref)) { omitidos.push(item.ref || "(sin ref)"); continue; }
      ya.add(item.ref);
      nuevos.push(item);
    }
    return { nuevos, omitidos };
  }

  // --------------------------------------------------------------------------
  // Consultas para la pantalla
  // --------------------------------------------------------------------------

  function resumen(items) {
    const r = { total: 0, enWeb: 0, enStock: 0, aPedido: 0, pendientes: 0, sinFoto: 0, porTipo: {} };
    for (const x of items || []) {
      r.total++;
      if (esPublicable(x)) r.enWeb++;
      if (x.disponibilidad === "EnStock") r.enStock++;
      if (x.disponibilidad === "APedido") r.aPedido++;
      if (x.auditoria.estado === "Pendiente") r.pendientes++;
      if (esPublicable(x) && !x.fotos.length) r.sinFoto++;
      r.porTipo[x.tipo] = (r.porTipo[x.tipo] || 0) + 1;
    }
    return r;
  }

  /** Filtro de la tabla. Texto libre sobre ref, nombre, marca, N° de parte y modelo. */
  function filtrar(items, f = {}) {
    const q = String(f.texto || "").toLowerCase().trim();
    return (items || []).filter((x) => {
      if (f.tipo && x.tipo !== f.tipo) return false;
      if (f.disponibilidad && x.disponibilidad !== f.disponibilidad) return false;
      if (f.procedencia && x.procedencia !== f.procedencia) return false;
      if (f.auditoria && x.auditoria.estado !== f.auditoria) return false;
      if (f.web === "si" && !esPublicable(x)) return false;
      if (f.web === "no" && esPublicable(x)) return false;
      if (q) {
        const hay = [x.ref, x.nombre, x.marca, x.nroParte, x.modeloCompatible, x.categoria]
          .join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort(porRef);
  }

  /**
   * Resultado de auditar un ítem. "Ya no está" no borra: lo da de baja y lo
   * saca de la web, para que quede el rastro de que existió y se vendió o se
   * perdió la oportunidad.
   */
  function auditar(item, decision, { usuario = "", hoy = E.hoy() } = {}) {
    const auditoria = { estado: "Confirmado", fecha: hoy, usuario };
    const base = { ...item, auditoria, actualizado: hoy };
    switch (decision) {
      case "stock": return { ...base, disponibilidad: "EnStock" };
      case "pedido": return { ...base, disponibilidad: "APedido" };
      case "baja": return { ...base, disponibilidad: "Baja", publicarWeb: false };
      case "confirmar": return base;
      default: throw new Error(`Decisión de auditoría desconocida: ${decision}`);
    }
  }

  // --------------------------------------------------------------------------
  // Resultado de una auditoría hecha afuera (planilla CSV)
  // --------------------------------------------------------------------------

  /** CSV con comillas dobles (RFC 4180). Devuelve objetos por encabezado. */
  function leerCsv(texto) {
    const filas = [];
    let fila = [], campo = "", comillas = false;
    const t = String(texto || "").replace(/^\uFEFF/, "");
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (comillas) {
        if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; }
        else if (c === '"') comillas = false;
        else campo += c;
      } else if (c === '"') comillas = true;
      else if (c === ",") { fila.push(campo); campo = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && t[i + 1] === "\n") i++;
        fila.push(campo); campo = "";
        if (fila.some((x) => x !== "")) filas.push(fila);
        fila = [];
      } else campo += c;
    }
    fila.push(campo);
    if (fila.some((x) => x !== "")) filas.push(fila);
    const [cab, ...resto] = filas;
    if (!cab) return [];
    const claves = cab.map((x) => x.trim().toLowerCase());
    return resto.map((f) => Object.fromEntries(claves.map((k, i) => [k, (f[i] ?? "").trim()])));
  }

  const claveNombre = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  /**
   * Convierte el resultado de una auditoría externa (ref, resultado, link,
   * nota) en decisiones para la bandeja. No guarda nada: la bandeja las
   * muestra marcadas y una persona las confirma.
   *
   *   DISPONIBLE / ALTERNATIVA → a pedido, con el link donde se consigue
   *   NO_ENCONTRADA            → baja
   *   DUDOSA / PENDIENTE       → no se toca: sigue pendiente
   *
   * Con `bajaDuplicados`, de cada grupo de ítems con el mismo nombre queda el
   * de referencia más baja y el resto se da de baja. SharePoint acumuló la
   * misma oportunidad de eBay con dos y tres refs, y en la web se veía repetida.
   */
  function planDesdeAuditoria(filas, items, { bajaDuplicados = false } = {}) {
    const porRef = new Map((items || []).map((x) => [x.ref, x]));
    const plan = new Map();
    const omitidas = [];
    for (const f of filas || []) {
      const item = porRef.get(String(f.ref || "").trim().toUpperCase());
      if (!item) { omitidas.push(f.ref); continue; }
      const r = String(f.resultado || "").toUpperCase();
      const nota = [r, f.precio_usd && `US$ ${f.precio_usd}`, f.nota].filter(Boolean).join(" · ");
      if (r === "DISPONIBLE" || r === "ALTERNATIVA") {
        plan.set(item.id, { decision: "pedido", origenUrl: esUrl(f.link) ? f.link : "", nota });
      } else if (r === "NO_ENCONTRADA") {
        plan.set(item.id, { decision: "baja", origenUrl: "", nota });
      }
    }
    if (bajaDuplicados) {
      const grupos = new Map();
      for (const x of items || []) {
        if (["Baja", "Vendido"].includes(x.disponibilidad)) continue;
        // Solo terceros: en stock propio dos ítems con el mismo nombre son dos
        // unidades físicas distintas (otro N° de serie), no un duplicado.
        if (x.procedencia !== "Terceros") continue;
        const k = claveNombre(x.nombre);
        if (!k) continue;
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(x);
      }
      for (const grupo of grupos.values()) {
        if (grupo.length < 2) continue;
        grupo.sort((a, b) => a.ref.localeCompare(b.ref, "es", { numeric: true }));
        const [queda, ...repetidos] = grupo;
        for (const x of repetidos) {
          // Solo se bajan duplicados de algo que sigue: si el original también
          // se da de baja, no hace falta una segunda razón.
          const previo = plan.get(x.id);
          plan.set(x.id, {
            decision: "baja", origenUrl: previo?.origenUrl || "",
            nota: `Duplicado de ${queda.ref}${previo?.nota ? ` · ${previo.nota}` : ""}`,
          });
        }
      }
    }
    return { plan, omitidas };
  }

  // --------------------------------------------------------------------------
  // Lectura de etiquetas (carga desde el celular)
  // --------------------------------------------------------------------------

  /**
   * Rótulos con los que los fabricantes marcan cada dato en la etiqueta.
   * El OCR confunde a menudo la barra: "P/N" sale "PIN" o "P N", por eso se
   * aceptan esas variantes.
   */
  const ROTULO_PN = /\b(?:P\s*[\/.\-]?\s*N|PIN|PART\s*(?:NO|NUMBER|#)|REF(?:ERENCE)?|MODEL(?:\s*NO)?|CAT(?:\s*NO)?|12NC)\b\s*[:#.\-]?\s*/i;
  const ROTULO_SN = /\b(?:S\s*[\/.\-]?\s*N|SER(?:IAL)?(?:\s*(?:NO|NUMBER|#))?)\b\s*[:#.\-]?\s*/i;
  const TOKEN = /[A-Z0-9][A-Z0-9\-\/.]{2,}[A-Z0-9]/gi;

  const limpiarToken = (t) => String(t || "").replace(/^[\-\/.]+|[\-\/.]+$/g, "").toUpperCase();
  const pareceCodigo = (t) => /\d/.test(t) && t.length >= 4 && t.length <= 30;

  /** Primer código que sigue a un rótulo en el texto, o "" si no hay. */
  function trasRotulo(texto, rotulo) {
    for (const linea of String(texto || "").split(/\r?\n/)) {
      const m = linea.match(rotulo);
      if (!m) continue;
      const resto = linea.slice(m.index + m[0].length);
      const tok = (resto.match(TOKEN) || []).map(limpiarToken).find(pareceCodigo);
      if (tok) return tok;
    }
    return "";
  }

  /**
   * Del texto de una etiqueta (OCR o código de barras) saca el N° de parte,
   * el N° de serie y la lista de códigos candidatos, para que en el celular
   * se asignen con un toque en vez de tipear 12 caracteres.
   */
  function leerEtiqueta(texto) {
    const t = String(texto || "");
    const pn = trasRotulo(t, ROTULO_PN);
    const sn = trasRotulo(t, ROTULO_SN);
    const vistos = new Set();
    const candidatos = [];
    for (const tok of (t.match(TOKEN) || []).map(limpiarToken)) {
      if (!pareceCodigo(tok) || vistos.has(tok)) continue;
      vistos.add(tok);
      candidatos.push(tok);
    }
    return { pn, sn, candidatos };
  }

  /** Nombre por defecto para no tener que escribirlo: "GE Bobina MRI · 2217680". */
  function nombreSugerido(x) {
    const base = [x.marca, x.categoria, x.modalidad].filter(Boolean).join(" ");
    const cod = x.modeloCompatible || x.nroParte;
    return [base, cod].filter(Boolean).join(" · ");
  }

  global.NEXO_CATALOGO_PARTES = {
    PUBLICABLES, MODALIDADES, CONDICION_TEXTO, DISPONIBILIDAD_TEXTO,
    textoAPrecio, precioATexto, proximaRef, nombreFoto, esUrl,
    esPublicable, aParte, aParts, fotosPorSubir, diferencias,
    desdeParte, importar, resumen, filtrar, auditar,
    leerCsv, planDesdeAuditoria, leerEtiqueta, nombreSugerido,
  };
})(typeof window !== "undefined" ? window : globalThis);
