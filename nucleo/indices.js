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
      url: "https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&representation_mode=percent_change&limit=72&sort=desc&format=json",
      fuente: "INDEC · datos.gob.ar",
      extraer: (j) => (j?.data || []).map(([f, v]) => ({ mes: String(f).slice(0, 7), variacion: v == null ? null : v * 100 })),
    },
    US_CPI: {
      etiqueta: "US CPI",
      // CPI-U, todos los ítems, sin desestacionalizar. La API pública de BLS
      // da niveles: la variación se calcula contra el mes anterior.
      url: "https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0",
      // El GET sin parámetros trae solo los últimos tres años, y un ajuste
      // anual atrasado necesita más. Primero se pide por POST con el rango de
      // años (hasta 10 en la v1); si eso falla, el GET.
      pedir: async (hoy) => {
        const a = Number((hoy || "").slice(0, 4)) || new Date().getFullYear();
        try {
          const r = await fetch("https://api.bls.gov/publicAPI/v1/timeseries/data/", {
            method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
            body: JSON.stringify({ seriesid: ["CUUR0000SA0"], startyear: String(a - 9), endyear: String(a) }),
          });
          if (r.ok) {
            const j = await r.json();
            if (j?.Results?.series?.[0]?.data?.length) return j;
          }
        } catch { /* sigue con el GET */ }
        return null;
      },
      fuente: "BLS · CPI-U",
      extraer: (j) => {
        const datos = (j?.Results?.series?.[0]?.data || [])
          .filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period))
          .map((d) => ({ mes: `${d.year}-${d.period.slice(1)}`, nivel: Number(d.value) }))
          .sort((a, b) => a.mes.localeCompare(b.mes));
        // Cada mes lleva su nivel; la variación solo si está el mes anterior.
        return datos.map((d, i) => {
          const prev = datos[i - 1];
          const ok = prev && mesMas(prev.mes, 1) === d.mes && prev.nivel > 0;
          return { mes: d.mes, nivel: d.nivel, variacion: ok ? (d.nivel / prev.nivel - 1) * 100 : null };
        });
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

  function nivelDe(serie, indice, mes) {
    const r = (serie || []).find((x) => x.indice === indice && x.mes === mes);
    return r && r.nivel > 0 ? r.nivel : null;
  }

  /**
   * Variación acumulada de un índice entre dos meses, inclusive.
   *
   * Si están los niveles del mes anterior al período y del último, sale de
   * su cociente: es como publica BLS la variación interanual y no depende
   * de que estén todos los meses del medio. Si no, se componen las
   * variaciones mensuales, y si falta alguna no hay número: un acumulado con
   * huecos subestima el ajuste sin que se note.
   */
  function acumulado(serie, indice, desde, hasta) {
    const meses = rangoMeses(desde, hasta);
    const detalle = meses.map((mes) => ({ mes, variacion: valor(serie, indice, mes)?.variacion ?? null }));
    const n0 = meses.length ? nivelDe(serie, indice, mesMas(desde, -1)) : null;
    const n1 = meses.length ? nivelDe(serie, indice, hasta) : null;
    const porNivel = !!(n0 && n1);
    const faltanMeses = detalle.filter((d) => d.variacion == null).map((d) => d.mes);
    const faltan = porNivel ? [] : faltanMeses;
    const pct = porNivel ? (n1 / n0 - 1) * 100
      : faltan.length || !meses.length ? null
      : (detalle.reduce((f, d) => f * (1 + d.variacion / 100), 1) - 1) * 100;
    return { indice, desde, hasta, meses: meses.length, detalle, faltan, porNivel,
      porcentaje: pct == null ? null : Math.round(pct * 100) / 100 };
  }

  /** Día del mes desde el que se da por publicado el índice del mes anterior. */
  const DIA_PUBLICACION = 15;

  /**
   * Último mes publicado a una fecha. INDEC y BLS publican el mes M a mitad
   * de M+1: hasta el 15 se da por publicado M-2, después M-1. Si el mes ya
   * está cargado en la serie, está publicado aunque no haya llegado el 15.
   */
  function ultimoPublicado(serie, indice, hoy) {
    const h = (E.fecha(hoy) || E.hoy());
    const porCalendario = mesMas(h.slice(0, 7), Number(h.slice(8, 10)) >= DIA_PUBLICACION ? -1 : -2);
    const cargado = ultimoMes(serie, indice);
    return cargado && cargado > porCalendario ? cargado : porCalendario;
  }

  /**
   * Período de un ajuste: de ajuste a ajuste. El de septiembre de 2024 anual
   * mide de septiembre de 2023 a agosto de 2024; el trimestral de diciembre,
   * septiembre a noviembre.
   *
   * Solo si el último mes todavía no se publicó, la ventana se corre hacia
   * atrás con el mismo largo: el trimestral de diciembre calculado el 26/11
   * toma agosto a octubre, porque noviembre sale a mitad de diciembre. Lo que
   * decide es la publicación, no lo que haya cargado: si un mes ya publicado
   * no está en la serie, se pide cargarlo en vez de correrse (Maxi,
   * 2026-11-26).
   */
  function periodoSugerido(serie, indice, fechaAjuste, meses, hoy) {
    const f = E.fecha(fechaAjuste) || E.hoy();
    const ideal = mesMas(f.slice(0, 7), -1);
    const publicado = ultimoPublicado(serie, indice, hoy);
    const hasta = ideal <= publicado ? ideal : publicado;
    const n = Math.max(1, Number(meses) || 1);
    return { desde: mesMas(hasta, -(n - 1)), hasta, ideal, corrido: hasta !== ideal };
  }

  /** Sugerencia para un ajuste. `periodo` explícito manda sobre el calculado. */
  function sugerirAjuste(serie, indice, fechaAjuste, meses, periodo, hoy) {
    const p = periodo?.desde && periodo?.hasta ? { ...periodo, corrido: false }
      : periodoSugerido(serie, indice, fechaAjuste, meses, hoy);
    return { ...acumulado(serie, indice, p.desde, p.hasta), fecha: E.fecha(fechaAjuste) || E.hoy(),
      corrido: !!p.corrido, ideal: p.ideal || null, etiqueta: INDICES[indice]?.etiqueta || indice };
  }

  /**
   * Varios ajustes atrasados (p. ej. tres anuales sin aplicar): el % de cada
   * período por separado y el total compuesto, que es lo que termina subiendo
   * el canon si se aplican todos. Si falta un mes en cualquier período, el
   * total queda en null.
   */
  function sugerirPendientes(serie, indice, fechas, meses, hoy) {
    const periodos = (fechas || []).map((f) => sugerirAjuste(serie, indice, f, meses, null, hoy));
    const completos = periodos.length && periodos.every((p) => p.porcentaje != null);
    const total = completos
      // Se compone con el % redondeado de cada período, que es el que se
      // registra: así el total que se muestra es el que termina en el canon.
      ? Math.round((periodos.reduce((f, p) => f * (1 + p.porcentaje / 100), 1) - 1) * 10000) / 100 : null;
    return { periodos, total, faltan: [...new Set(periodos.flatMap((p) => p.faltan))].sort() };
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
      let j = def.pedir ? await def.pedir(E.hoy()) : null;
      if (!j) {
        const r = await fetch(def.url, { cache: "no-store" });
        if (!r.ok) return { indice, ok: false, error: `HTTP ${r.status}` };
        j = await r.json();
      }
      const filas = def.extraer(j)
        .filter((x) => /^\d{4}-\d{2}$/.test(x.mes) && (Number.isFinite(x.variacion) || x.nivel > 0));
      if (!filas.length) return { indice, ok: false, error: "La fuente no devolvió datos" };
      let nueva = serie || [];
      const nuevos = [], cambiados = [];
      for (const f of filas) {
        const v = Number.isFinite(f.variacion) ? Math.round(f.variacion * 1000) / 1000 : null;
        const nivel = f.nivel > 0 ? f.nivel : null;
        const previo = (nueva || []).find((x) => x.indice === indice && x.mes === f.mes);
        // No se pisa una variación cargada con un null: la fuente puede no
        // traer el mes anterior y el dato a mano sigue valiendo.
        const variacion = v ?? previo?.variacion ?? null;
        const nivelFinal = nivel ?? previo?.nivel ?? null;
        if (previo && (previo.variacion == null ? variacion == null : variacion != null && Math.abs(previo.variacion - variacion) < 0.0005)
          && previo.nivel === nivelFinal) continue;
        (previo ? cambiados : nuevos).push(f.mes);
        nueva = upsert(nueva, { indice, mes: f.mes, variacion, nivel: nivelFinal, fuente: def.fuente });
      }
      return { indice, ok: true, serie: nueva, nuevos, cambiados };
    } catch (e) {
      return { indice, ok: false, error: String(e.message || e).slice(0, 120) };
    }
  }

  global.NEXO_INDICES = {
    DIA_PUBLICACION, INDICES, mesMas, rangoMeses, ultimoMes, ultimoPublicado, nivelDe, acumulado, periodoSugerido, sugerirAjuste, sugerirPendientes, upsert, traer,
  };
})(typeof window !== "undefined" ? window : globalThis);
