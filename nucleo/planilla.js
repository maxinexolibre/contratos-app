/**
 * Importación de la planilla de presupuestos («Nexolibre - Presupuestos 2026.xlsx»).
 *
 * El área comercial llevó los presupuestos en Excel hasta noviembre de 2026.
 * Este módulo traduce esas filas a registros de la plataforma y arma un plan
 * —qué se crea, qué se actualiza, qué hay que mirar— antes de escribir nada.
 * La planilla se importa una vez (o pocas, mientras se termina la transición):
 * la carpeta de OneDrive no queda conectada a nada.
 *
 * Lógica pura: recibe filas ya leídas (objetos con los encabezados de la
 * planilla como claves) y la lista actual en forma vieja. No toca DOM ni red.
 *
 * Criterios, acordados con Maxi el 10/11/2026:
 *   - La planilla gana sobre lo ya cargado: es la que el equipo mantuvo al día.
 *   - "Pendiente" con fecha de envío es Enviado; sin fecha, Borrador.
 *   - Un importe de un millón o más es pesos: hay mantenimientos que se
 *     cotizan y cobran en ARS, y la planilla no tiene columna de moneda.
 *   - Un año de envío que no es el del número es un error de tipeo (pasó con
 *     un "2016"): se corrige al año del número y se avisa.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;

  /** Estado de la planilla → estado de la forma vieja de la app. */
  function estadoDesdePlanilla(estado, fechaEnvio, nota = "") {
    const e = String(estado || "").trim().toLowerCase();
    if (e === "aprobado") return "ganado";
    // "Desestimado" es como Maxi marca la oportunidad que el cliente dejó
    // caer sin rechazarla formalmente: para la tasa de aprobación es una
    // venta perdida, no un anulado (anulado es error nuestro o reemplazo).
    if (e === "rechazado" || e === "desestimado") return "perdido";
    if (e === "anulado") return "anulado";
    // "Pendiente" sin fecha de envío no siempre es borrador: muchas filas
    // dicen "pendiente de respuesta del cliente" y nunca se les cargó la
    // fecha. Solo es borrador si la nota dice que falta enviarlo.
    if (e === "pendiente") return fechaEnvio || !/enviar|confirmar env/i.test(nota) ? "enviado" : "borrador";
    return "borrador"; // "No enviado" y vacíos
  }

  /** Estado del ticket que acompaña al presupuesto importado. */
  const TICKET_SEGUN_PRESU = {
    ganado: "ganado", perdido: "perdido", anulado: "perdido",
    enviado: "presupuestado", borrador: "presupuestado",
  };

  /**
   * Subtipo de una venta según el título. La planilla solo dice
   * "Servicio" o "Venta"; el subtipo decide el plazo de seguimiento
   * (un equipo se define en meses) y, más adelante, la comisión.
   */
  function subtipoVenta(titulo) {
    const t = String(titulo || "").toLowerCase();
    if (/(venta|provisi[oó]n) de (equipo|rm|mri|ct\b|resonador|tom[oó]grafo)|propuesta de upgrade|venta de mri|venta de rm/.test(t)) return "equipo";
    if (/intercambio/.test(t)) return "intercambio";
    return "partes";
  }

  const num = (v) => {
    if (v === null || v === undefined || v === "" || v === "-") return null;
    if (typeof v === "number") return v;
    const s = String(v).replace(/[^\d,.-]/g, "");
    const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  /** Fecha de la planilla (Date, número de serie de Excel o texto) → AAAA-MM-DD. */
  function fechaPlanilla(v) {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    if (typeof v === "number") {
      // Serie de Excel: días desde 1899-12-30.
      const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return d.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const a = m[3].length === 2 ? "20" + m[3] : m[3];
      return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    return null;
  }

  /** Lee una columna tolerando mayúsculas, tildes y espacios de más. */
  function campo(fila, ...nombres) {
    const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const claves = Object.keys(fila);
    for (const n of nombres) {
      const k = claves.find((c) => norm(c) === norm(n));
      if (k !== undefined && fila[k] !== null && fila[k] !== undefined && fila[k] !== "") return fila[k];
    }
    return null;
  }

  /**
   * Traduce una fila a { presupuesto, ticket, avisos } en forma vieja.
   * Devuelve null para filas sin número o vacías (la planilla tiene una con guiones).
   */
  function filaARegistro(fila, opciones = {}) {
    const id = String(campo(fila, "ID", "Nro", "Numero") || "").replace(/^P/i, "").trim();
    if (!/^\d{8}(CL)?$/i.test(id)) return null;
    const titulo = String(campo(fila, "Título", "Titulo") || "").trim();
    const cliente = String(campo(fila, "Cliente") || "").trim();
    if ((!titulo || titulo === "-") && (!cliente || cliente === "-")) return null;

    const avisos = [];
    const pais = /CL$/i.test(id) || String(campo(fila, "País", "Pais") || "").toUpperCase() === "CL" ? "CL" : "AR";
    const numero = "P" + id.replace(/CL$/i, "") + (pais === "CL" ? "CL" : "");
    const anio = id.slice(0, 4), mes = id.slice(4, 6);

    const neto = num(campo(fila, "Monto s/iva", "Monto", "Neto"));
    const iva = num(campo(fila, "IVA"));
    const total = num(campo(fila, "Total"));

    let fechaEnvio = fechaPlanilla(campo(fila, "Fecha de envío", "Fecha de envio", "Envío", "Envio"));
    if (fechaEnvio && fechaEnvio.slice(0, 4) !== anio) {
      const corregida = anio + fechaEnvio.slice(4);
      avisos.push(`Fecha de envío ${fechaEnvio} con otro año: se tomó ${corregida}`);
      fechaEnvio = corregida;
    }

    let moneda = String(campo(fila, "Moneda") || "").toUpperCase() || null;
    if (!moneda) {
      moneda = neto !== null && neto >= 1_000_000 ? "ARS" : (pais === "CL" ? "USD" : "USD");
      if (moneda === "ARS") avisos.push("Importe de un millón o más: se cargó en pesos (ARS)");
    }
    if (neto === null) avisos.push("Sin importe: entra con ítem en cero, completalo");

    // IVA: la planilla lo trae calculado. En cero con total igual al neto es
    // una operación sin IVA (efectivo, exento); en cero con total cero es una
    // fila sin terminar de cargar.
    const ivaPct = pais === "CL" ? 19 : 21;
    let condicionIVA = "Gravado";
    if (neto && iva === 0 && total === neto) condicionIVA = "NoGravado";
    else if (neto && (total === 0 || total === null) && !iva) avisos.push("IVA y total en cero en la planilla: se asume gravado");

    const notaPrincipal = String(campo(fila, "Última nota", "Ultima nota", "Nota") || "");
    const estado = estadoDesdePlanilla(campo(fila, "Estado"), fechaEnvio, notaPrincipal);
    if (estado === "enviado" && !fechaEnvio) avisos.push("Pendiente sin fecha de envío: entra como enviado, cargá la fecha");
    const tipoPl = String(campo(fila, "Tipo") || "").toLowerCase();
    const tipo = tipoPl.startsWith("venta") ? "venta" : "servicio";
    const subtipo = tipo === "venta" ? subtipoVenta(titulo) : "";

    // Columna2 de la planilla es una cuenta auxiliar (repite el neto), no una nota.
    const notas = [notaPrincipal, campo(fila, "Columna1")]
      .filter((x) => x !== null && String(x).trim() && String(x).trim() !== "0").map(String).join("\n");

    const fecha = fechaEnvio || `${anio}-${mes}-01`;
    const usuario = opciones.usuario || "importación";
    const pid = "pre_" + numero;
    const tid = "tk_" + numero;

    const presupuesto = {
      id: pid, numero, tipo, subtipo, titulo, pais, condicionIVA,
      estado, estadoOrigen: String(campo(fila, "Estado") || "").trim(),
      fecha, fechaEnvio, ticketId: tid, ticketNumero: "TK-" + numero.slice(1).replace(/CL$/, ""),
      cliente: { nombreComercial: cliente, razonesSociales: [], contacto: "", localidad: "", provincia: "" },
      items: [{ detalle: titulo, sku: "", cantidad: 1, unitario: neto || 0, intercambio: false, unitarioIntercambio: null }],
      garantia: { aplica: tipo === "servicio", dias: 90, texto: "" },
      economico: { moneda, recurrencia: "unica", ivaPct, incluyeIVA: false, validezDias: 10, formaPago: "", descuentoPct: 0 },
      notas, archivos: [], usuario, vendedorId: "",
      motivoAnulacion: estado === "anulado" ? (notas.split("\n")[0] || "Anulado en la planilla") : "",
      historialEstados: [{ estado, fecha, usuario }],
      origen: "planilla",
    };
    const ticket = {
      id: tid, numero: presupuesto.ticketNumero + (pais === "CL" ? "CL" : ""), fecha,
      cliente: { nombreComercial: cliente, razonesSociales: [], contacto: "" },
      tipoPedido: tipo === "servicio" ? "servicio" : (subtipo === "equipo" ? "equipo" : "parte"),
      pais, descripcion: titulo, estado: TICKET_SEGUN_PRESU[estado], presupuestoIds: [pid],
      motivoPerdida: estado === "perdido" || estado === "anulado" ? (notas.split("\n")[0] || "") : "",
      usuario, historial: [{ estado: TICKET_SEGUN_PRESU[estado], fecha, usuario }],
    };
    return { presupuesto, ticket, avisos };
  }

  /** Neto de un presupuesto en forma vieja (para comparar con la planilla). */
  const netoViejo = (p) => E.money((p.items || []).reduce((s, i) => s + (Number(i.cantidad) || 0) * (Number(i.unitario) || 0), 0));

  /**
   * Arma el plan de importación sin escribir nada.
   *
   * @param {Array<object>} filas        filas de la planilla
   * @param {Array<object>} existentes   presupuestos actuales (forma vieja)
   * @returns {{crear, actualizar, iguales, avisos, ignoradas}}
   *   crear:      [{presupuesto, ticket}]
   *   actualizar: [{id, numero, cambios: [{campo, antes, despues}], aplicar(p)}]
   */
  function planImportacion(filas, existentes = [], opciones = {}) {
    const porNumero = new Map((existentes || []).map((p) => [String(p.numero).toUpperCase(), p]));
    const plan = { crear: [], actualizar: [], iguales: 0, avisos: [], ignoradas: 0 };
    const vistos = new Set();

    for (const fila of filas || []) {
      const r = filaARegistro(fila, opciones);
      if (!r) { plan.ignoradas++; continue; }
      const { presupuesto: n, ticket, avisos } = r;
      for (const a of avisos) plan.avisos.push({ numero: n.numero, texto: a });
      if (vistos.has(n.numero)) {
        plan.avisos.push({ numero: n.numero, texto: "Número repetido en la planilla: se tomó la primera fila" });
        continue;
      }
      vistos.add(n.numero);

      const ya = porNumero.get(n.numero.toUpperCase());
      if (!ya) { plan.crear.push({ presupuesto: n, ticket }); continue; }

      // Solo se tocan los datos que lleva la planilla. Ítems con detalle,
      // garantía, razones sociales y archivos cargados en la app se respetan.
      const cambios = [];
      const comparar = (campoNombre, antes, despues) => {
        if ((antes ?? "") !== (despues ?? "")) cambios.push({ campo: campoNombre, antes: antes ?? "", despues: despues ?? "" });
      };
      comparar("estado", ya.estado, n.estado);
      comparar("estadoOrigen", ya.estadoOrigen, n.estadoOrigen);
      comparar("fechaEnvio", ya.fechaEnvio, n.fechaEnvio);
      comparar("notas", ya.notas, n.notas);
      comparar("moneda", ya.economico?.moneda, n.economico.moneda);
      const netoYa = netoViejo(ya), netoN = netoViejo(n);
      if (Math.abs(netoYa - netoN) >= 1 && netoN > 0) cambios.push({ campo: "neto", antes: netoYa, despues: netoN });

      if (!cambios.length) { plan.iguales++; continue; }
      plan.actualizar.push({
        id: ya.id, numero: ya.numero, cambios,
        nuevo: n,
      });
    }
    return plan;
  }

  /**
   * Aplica una actualización del plan sobre una copia del presupuesto.
   * Si cambió el neto y el presupuesto tenía un solo ítem, se corrige ese
   * ítem; con varios ítems no se adivina cuál: se agrega una nota.
   */
  function aplicarActualizacion(existente, act, opciones = {}) {
    const p = JSON.parse(JSON.stringify(existente));
    const n = act.nuevo;
    const hoy = opciones.hoy || E.hoy();
    for (const c of act.cambios) {
      if (c.campo === "estado") {
        p.estado = n.estado;
        p.historialEstados = [...(p.historialEstados || []), { estado: n.estado, fecha: hoy, usuario: opciones.usuario || "importación" }];
        if (n.estado === "anulado") p.motivoAnulacion = n.motivoAnulacion;
      } else if (c.campo === "estadoOrigen") p.estadoOrigen = n.estadoOrigen;
      else if (c.campo === "fechaEnvio") p.fechaEnvio = n.fechaEnvio;
      else if (c.campo === "notas") p.notas = n.notas;
      else if (c.campo === "moneda") p.economico = { ...(p.economico || {}), moneda: n.economico.moneda };
      else if (c.campo === "neto") {
        if ((p.items || []).length <= 1) {
          const it = (p.items || [])[0] || { detalle: n.titulo, sku: "", cantidad: 1, intercambio: false, unitarioIntercambio: null };
          p.items = [{ ...it, cantidad: 1, unitario: c.despues }];
        } else {
          p.notas = `${p.notas || ""}\nLa planilla indica un neto de ${c.despues}; revisar ítems.`.trim();
        }
      }
    }
    return p;
  }

  global.NEXO_PLANILLA = {
    filaARegistro, planImportacion, aplicarActualizacion, estadoDesdePlanilla, subtipoVenta, fechaPlanilla,
  };
})(typeof window !== "undefined" ? window : globalThis);
