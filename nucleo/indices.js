/**
 * Índices de precios y ajuste sugerido de canon.
 *
 * La serie guarda la variación mensual en % de cada índice (lo que publica
 * INDEC y lo que se puede cargar a mano). El acumulado de un período se
 * calcula componiendo los meses, nunca sumándolos: 2% + 2% + 2% no es 6%,
 * es 6,12%. Con inflación alta la diferencia deja de ser redondeo.
 *
 * La sugerencia no se aplica sola: completa el % del formulario de ajuste y
 * quien registra decide. El contrato puede pactar otro rezago, otro índice o
 * un tope, y eso no está modelado.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;

  /**
   * Fuentes públicas por índice. Las mismas reglas que en cambio.js: sin
   * servidor, la fuente tiene que habilitar CORS. Si no responde, la serie
   * se carga a mano y la sugerencia sigue funcionando.
   */
  const INDICES = {
    IPC_INDEC: {
      etiqueta: "IPC INDEC",
      // IPC nivel general nacional, base dic-2016. percent_change devuelve la
      // variación contra el mes anterior como fracción (0,027 = 2,7%).
      url: "https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&representation_mode=percent_change&limit=36&sort=desc&format=json",
      fuente: "INDEC · datos.gob.ar",
      extraer: (j) => (j?.data || []).map(([f, v]) => ({ mes: String(f).slice(0, 7), variacion: v == null ? null : v * 100 })),
    },
    US_CPI: {
      etiqueta: "US CPI",
      // CPI-U, todos los ítems, sin desestacionalizar. La API pública de BLS
      // da niveles: la variación se calcula contra el mes anterior.
      url: "https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0",
      fuente: "BLS · CPI-U",
      extraer: (j) => {
        const datos = (j?.Results?.series?.[0]?.data || [])
          .filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period))
          .map((d) => ({ mes: `${d.year}-${d.period.slice(1)}`, nivel: Number(d.value) }))
          .sort((a, b) => a.mes.localeCompare(b.mes));
        const out = [];
        for (let i = 1; i < datos.length; i++) {
          if (mesMas(datos[i - 1].mes, 1) !== datos[i].mes || !(datos[i - 1].nivel > 0)) continue;
          out.push({ mes: datos[i].mes, variacion: (datos[i].nivel / datos[i - 1].nivel - 1) * 100 });
        }
        return out;
      },
    },
  };

  /** "2026-11" + n meses. */
  function mesMas(mes, n) {
    const [a, m] = String(mes).split("-").map(Number);
    const t = a * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  }

  /** Meses de `desde` a `hasta`, inclusive. */
  function rangoMeses(desde, hasta) {
    const out = [];
    for (let m = desde, g = 0; m <= hasta && g < 240; m = mesMas(m, 1), g++) out.push(m);
    return out;
  }

  function valor(serie, indice, mes) {
    const r = (serie || []).find((x) => x.indice === indice && x.mes === mes);
    return r && r.variacion != null ? r : null;
  }

  /** Último mes cargado de un índice, sin pasar de `tope` si se indica. */
  function ultimoMes(serie, indice, tope) {
    return (serie || [])
      .filter((x) => x.indice === indice && x.variacion != null && (!tope || x.mes <= tope))
      .map((x) => x.mes).sort().pop() || null;
  }

  /**
   * Variación acumulada de un índice entre dos meses, inclusive.
   * Si falta algún mes no hay número: un acumulado con huecos subestima el
   * ajuste sin que se note.
   */
  function acumulado(serie, indice, desde, hasta) {
    const meses = rangoMeses(desde, hasta);
    const detalle = meses.map((mes) => ({ mes, variacion: valor(serie, indice, mes)?.variacion ?? null }));
    const faltan = detalle.filter((d) => d.variacion == null).map((d) => d.mes);
    const pct = faltan.length || !meses.length ? null
      : (detalle.reduce((f, d) => f * (1 + d.variacion / 100), 1) - 1) * 100;
    return { indice, desde, hasta, meses: meses.length, detalle, faltan,
      porcentaje: pct == null ? null : Math.round(pct * 100) / 100 };
  }

  /**
   * Período que se toma por defecto para un ajuste: los `meses` de la
   * periodicidad que terminan en el mes anterior al del ajuste. Un ajuste
   * trimestral del 1/12 mira septiembre, octubre y noviembre.
   *
   * Si ese último mes todavía no se publicó (INDEC publica a mitad del mes
   * siguiente), se corre la ventana al último mes cargado, y se avisa.
   */
  function periodoSugerido(serie, indice, fechaAjuste, meses) {
    const f = E.fecha(fechaAjuste) || E.hoy();
    const ideal = mesMas(f.slice(0, 7), -1);
    const ultimo = ultimoMes(serie, indice, ideal);
    const hasta = ultimo || ideal;
    const n = Math.max(1, Number(meses) || 1);
    return { desde: mesMas(hasta, -(n - 1)), hasta, ideal, corrido: hasta !== ideal };
  }

  /** Sugerencia completa para el formulario de ajuste. */
  function sugerirAjuste(serie, indice, fechaAjuste, meses, periodo) {
    const p = periodo?.desde && periodo?.hasta ? { ...periodo, corrido: false }
      : periodoSugerido(serie, indice, fechaAjuste, meses);
    return { ...acumulado(serie, indice, p.desde, p.hasta), corrido: !!p.corrido, ideal: p.ideal || null,
      etiqueta: INDICES[indice]?.etiqueta || indice };
  }

  /** Inserta o reemplaza el valor de un mes. */
  function upsert(serie, registro) {
    const r = E.ENTIDADES.indices.normalizar(registro);
    return [...(serie || []).filter((x) => !(x.indice === r.indice && x.mes === r.mes)), r]
      .sort((a, b) => a.indice.localeCompare(b.indice) || a.mes.localeCompare(b.mes));
  }

  /**
   * Trae un índice de su fuente pública. No lanza: devuelve ok/error.
   * No pisa meses cargados a mano con otro valor: si difieren, gana la fuente
   * pero se informa cuáles cambiaron, porque INDEC a veces revisa.
   */
  async function traer(indice, serie) {
    const def = INDICES[indice];
    if (!def?.url) return { indice, ok: false, error: `Sin fuente definida para ${indice}` };
    try {
      const r = await fetch(def.url, { cache: "no-store" });
      if (!r.ok) return { indice, ok: false, error: `HTTP ${r.status}` };
      const filas = def.extraer(await r.json())
        .filter((x) => /^\d{4}-\d{2}$/.test(x.mes) && Number.isFinite(x.variacion));
      if (!filas.length) return { indice, ok: false, error: "La fuente no devolvió datos" };
      let nueva = serie || [];
      const nuevos = [], cambiados = [];
      for (const f of filas) {
        const v = Math.round(f.variacion * 1000) / 1000;
        const previo = valor(nueva, indice, f.mes);
        if (previo && Math.abs(previo.variacion - v) < 0.0005) continue;
        (previo ? cambiados : nuevos).push(f.mes);
        nueva = upsert(nueva, { indice, mes: f.mes, variacion: v, fuente: def.fuente });
      }
      return { indice, ok: true, serie: nueva, nuevos, cambiados };
    } catch (e) {
      return { indice, ok: false, error: String(e.message || e).slice(0, 120) };
    }
  }

  global.NEXO_INDICES = {
    INDICES, mesMas, rangoMeses, ultimoMes, acumulado, periodoSugerido, sugerirAjuste, upsert, traer,
  };
})(typeof window !== "undefined" ? window : globalThis);
