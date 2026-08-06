/**
 * Capa de datos particionada.
 *
 * Reemplaza el esquema anterior de "un archivo JSON por entidad, cargado y
 * reescrito entero en cada guardado". Ese diseño tiene un techo duro:
 *
 *   - presupuestos.json pesa ~1,6 KB por registro. A 5.000 registros por mes
 *     son ~96 MB al año en un solo archivo.
 *   - La API de contenidos de GitHub devuelve como máximo 1 MB por archivo.
 *   - El navegador tiene que cargar y volver a serializar todo para cambiar
 *     un solo campo.
 *
 * Solución sin servidor: particionar por período y mantener un índice liviano
 * con los agregados ya calculados.
 *
 *   data/indice.json              catálogo + agregados por partición
 *   data/clientes.json            entidades chicas, sin partición
 *   data/contratos.json
 *   data/tickets/2026-08.json     particionadas por mes
 *   data/presupuestos/2026-08.json
 *
 * El tablero se dibuja SOLO con el índice: no carga ninguna partición. Las
 * particiones se cargan cuando hacés clic en un registro o filtrás un período.
 * Así el costo de abrir la aplicación deja de crecer con la historia.
 *
 * Este archivo vive en un repo público. Solo mecánica, nunca datos reales.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;

  /** Cuántos meses carga el tablero por defecto al pedir detalle. */
  const MESES_POR_DEFECTO = 12;

  /** Reintentos ante conflicto de escritura concurrente. */
  const REINTENTOS = 3;

  class Almacen {
    /**
     * @param {object} cfg  { owner, dataRepo, branch, token, usuario, rol }
     */
    constructor(cfg) {
      this.cfg = cfg;
      this.indice = null;
      /** Particiones cargadas en memoria: "entidad/periodo" -> { registros, sha } */
      this.cache = new Map();
      this.modoLocal = !cfg.token;
      // Prefijo de rutas. Permite que la estructura nueva conviva con los
      // archivos planos que usa la app anterior: "data/v3" al lado de "data".
      this.base = (cfg.base || "data").replace(/\/+$/, "");
    }

    // ------------------------------------------------------------------------
    // Transporte
    // ------------------------------------------------------------------------

    _headers() {
      return {
        Authorization: `Bearer ${this.cfg.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
    }

    _url(ruta) {
      return `https://api.github.com/repos/${this.cfg.owner}/${this.cfg.dataRepo}/contents/${ruta}`;
    }

    async _leer(ruta) {
      if (this.modoLocal) {
        const raw = localStorage.getItem(`nexo_local:${ruta}`);
        return raw ? { datos: JSON.parse(raw), sha: null } : { datos: null, sha: null };
      }
      const r = await fetch(`${this._url(ruta)}?ref=${this.cfg.branch}`, { headers: this._headers() });
      if (r.status === 404) return { datos: null, sha: null };
      if (!r.ok) throw new Error(`GitHub ${r.status} al leer ${ruta}`);
      const j = await r.json();
      // Los archivos de más de 1 MB vienen con content vacío: hay que ir por
      // la API de blobs. Con particiones mensuales no debería pasar nunca,
      // pero si pasa conviene enterarse acá y no con un JSON.parse críptico.
      if (!j.content && j.size > 1000000) {
        throw new Error(
          `La partición ${ruta} supera 1 MB (${Math.round(j.size / 1024)} KB). ` +
          `Hay que particionar más fino.`);
      }
      const texto = decodeURIComponent(escape(atob(j.content.replace(/\n/g, ""))));
      return { datos: JSON.parse(texto), sha: j.sha };
    }

    async _escribir(ruta, datos, sha, mensaje) {
      const texto = JSON.stringify(datos, null, 2) + "\n";
      if (this.modoLocal) {
        localStorage.setItem(`nexo_local:${ruta}`, texto);
        return null;
      }
      const body = {
        message: mensaje,
        content: btoa(unescape(encodeURIComponent(texto))),
        branch: this.cfg.branch,
      };
      if (sha) body.sha = sha;
      const r = await fetch(this._url(ruta), {
        method: "PUT", headers: this._headers(), body: JSON.stringify(body),
      });
      if (r.status === 409 || r.status === 422) {
        const err = new Error(`Conflicto de escritura en ${ruta}`);
        err.conflicto = true;
        throw err;
      }
      if (!r.ok) throw new Error(`GitHub ${r.status} al escribir ${ruta}`);
      return (await r.json()).content.sha;
    }

    // ------------------------------------------------------------------------
    // Rutas
    // ------------------------------------------------------------------------

    _rutaIndice() { return `${this.base}/indice.json`; }

    _ruta(entidad, periodo) {
      const def = E.ENTIDADES[entidad];
      if (!def) throw new Error(`Entidad desconocida: ${entidad}`);
      return def.particionado
        ? `${this.base}/${def.archivo}/${periodo}.json`
        : `${this.base}/${def.archivo}.json`;
    }

    // ------------------------------------------------------------------------
    // Índice
    // ------------------------------------------------------------------------

    _indiceVacio() {
      return {
        version: E.VERSION,
        actualizado: new Date().toISOString(),
        entidades: {},      // entidad -> { particiones: {periodo: resumen}, total }
        secuencias: {},     // "contratos:2026" -> último correlativo usado
      };
    }

    async abrir() {
      const { datos, sha } = await this._leer(this._rutaIndice());
      this.indice = datos || this._indiceVacio();
      this.indiceSha = sha;

      if (this.indice.version !== E.VERSION) {
        console.warn(
          `Índice en versión ${this.indice.version}, la app espera ${E.VERSION}. ` +
          `Correr la migración.`);
      }
      return this.indice;
    }

    /**
     * Resumen agregado de una partición. Es lo que permite dibujar el tablero
     * sin abrir ni un solo archivo de datos.
     *
     * Se recalcula SIEMPRE desde los registros que se están por escribir, así
     * el agregado no puede quedar desfasado del detalle.
     */
    _resumir(entidad, registros) {
      const base = { cantidad: registros.length };

      if (entidad === "tickets") {
        const porEstado = {};
        const montoPorEstado = {};
        for (const t of registros) {
          porEstado[t.estado] = (porEstado[t.estado] || 0) + 1;
          const k = `${t.estado}|${t.moneda}`;
          montoPorEstado[k] = E.money((montoPorEstado[k] || 0) + t.montoEstimado);
        }
        return { ...base, porEstado, montoPorEstado };
      }

      if (entidad === "presupuestos") {
        const porEstado = {};
        const montoPorEstado = {};
        for (const p of registros) {
          porEstado[p.estado] = (porEstado[p.estado] || 0) + 1;
          const k = `${p.estado}|${p.economico.moneda}|${p.economico.recurrencia}`;
          montoPorEstado[k] = E.money((montoPorEstado[k] || 0) + p.total);
        }
        return { ...base, porEstado, montoPorEstado };
      }

      if (entidad === "leads") {
        const porCanal = {};
        const porEstado = {};
        for (const l of registros) {
          porCanal[l.canal] = (porCanal[l.canal] || 0) + 1;
          porEstado[l.estado] = (porEstado[l.estado] || 0) + 1;
        }
        return { ...base, porCanal, porEstado };
      }

      if (entidad === "facturaciones") {
        const porMoneda = {};
        for (const f of registros) {
          porMoneda[f.monedaLiquidacion] =
            E.money((porMoneda[f.monedaLiquidacion] || 0) + f.montoLiquidado);
        }
        return { ...base, porMoneda };
      }

      return base;
    }

    _registrarEnIndice(entidad, periodo, registros) {
      if (!this.indice.entidades[entidad]) {
        this.indice.entidades[entidad] = { particiones: {}, total: 0 };
      }
      const ent = this.indice.entidades[entidad];
      const clave = periodo || "_";
      ent.particiones[clave] = this._resumir(entidad, registros);
      ent.total = Object.values(ent.particiones).reduce((s, p) => s + p.cantidad, 0);
      this.indice.actualizado = new Date().toISOString();
    }

    // ------------------------------------------------------------------------
    // Lectura
    // ------------------------------------------------------------------------

    /** Períodos disponibles de una entidad, del más reciente al más viejo. */
    periodos(entidad) {
      const ent = this.indice?.entidades?.[entidad];
      if (!ent) return [];
      return Object.keys(ent.particiones).filter((p) => p !== "_").sort().reverse();
    }

    /** Últimos N períodos. Es el alcance por defecto de las vistas de detalle. */
    periodosRecientes(entidad, n = MESES_POR_DEFECTO) {
      return this.periodos(entidad).slice(0, n);
    }

    async _cargarParticion(entidad, periodo) {
      const clave = `${entidad}/${periodo || "_"}`;
      if (this.cache.has(clave)) return this.cache.get(clave);

      const { datos, sha } = await this._leer(this._ruta(entidad, periodo));
      const { registros, fallidos } = E.normalizarColeccion(entidad, datos || []);
      if (fallidos.length) {
        console.warn(`${fallidos.length} registro(s) ilegibles en ${clave}`, fallidos);
      }
      const part = { registros, sha, fallidos };
      this.cache.set(clave, part);
      return part;
    }

    /**
     * Carga registros de una entidad.
     * @param {object} opciones { periodos?: string[], todos?: boolean }
     */
    async cargar(entidad, opciones = {}) {
      const def = E.ENTIDADES[entidad];
      if (!def.particionado) {
        const p = await this._cargarParticion(entidad, null);
        return p.registros;
      }

      let periodos = opciones.periodos;
      if (!periodos) {
        periodos = opciones.todos
          ? this.periodos(entidad)
          : this.periodosRecientes(entidad);
      }

      // En paralelo: son peticiones independientes y la latencia manda.
      const partes = await Promise.all(
        periodos.map((p) => this._cargarParticion(entidad, p)));
      return partes.flatMap((p) => p.registros);
    }

    /** Busca un registro puntual sin cargar todo el histórico. */
    async buscar(entidad, id) {
      const def = E.ENTIDADES[entidad];
      if (!def.particionado) {
        const regs = await this.cargar(entidad);
        return regs.find((r) => r.id === id) || null;
      }
      for (const periodo of this.periodos(entidad)) {
        const p = await this._cargarParticion(entidad, periodo);
        const hit = p.registros.find((r) => r.id === id);
        if (hit) return hit;
      }
      return null;
    }

    // ------------------------------------------------------------------------
    // Escritura
    // ------------------------------------------------------------------------

    /**
     * Guarda un registro. Solo toca la partición correspondiente y el índice.
     *
     * Ante conflicto (otro usuario escribió la misma partición) se recarga y
     * se reintenta: el registro propio se vuelve a aplicar sobre la versión
     * nueva, sin pisar lo ajeno.
     */
    async guardar(entidad, registro, mensaje) {
      const normalizado = E.ENTIDADES[entidad].normalizar(registro);
      const periodo = E.periodoDe(entidad, normalizado);

      for (let intento = 1; intento <= REINTENTOS; intento++) {
        const clave = `${entidad}/${periodo || "_"}`;
        const part = await this._cargarParticion(entidad, periodo);

        const idx = part.registros.findIndex((r) => r.id === normalizado.id);
        const copia = [...part.registros];
        if (idx >= 0) copia[idx] = normalizado;
        else copia.push(normalizado);

        try {
          const sha = await this._escribir(
            this._ruta(entidad, periodo), copia, part.sha,
            mensaje || `${idx >= 0 ? "Actualiza" : "Alta"} ${entidad} ${normalizado.numero || normalizado.id}`);

          this.cache.set(clave, { registros: copia, sha, fallidos: part.fallidos });
          this._registrarEnIndice(entidad, periodo, copia);
          await this._guardarIndice();
          return normalizado;
        } catch (e) {
          if (!e.conflicto || intento === REINTENTOS) throw e;
          // Otro escribió primero: se descarta la copia local y se reintenta.
          this.cache.delete(clave);
        }
      }
      throw new Error(`No se pudo guardar ${entidad} tras ${REINTENTOS} intentos`);
    }

    /** Guarda varios registros de la misma entidad en una sola escritura por partición. */
    async guardarLote(entidad, registros, mensaje) {
      const porPeriodo = new Map();
      for (const r of registros) {
        const n = E.ENTIDADES[entidad].normalizar(r);
        const p = E.periodoDe(entidad, n) || "_";
        if (!porPeriodo.has(p)) porPeriodo.set(p, []);
        porPeriodo.get(p).push(n);
      }

      for (const [periodo, lote] of porPeriodo) {
        const real = periodo === "_" ? null : periodo;
        const part = await this._cargarParticion(entidad, real);
        const mapa = new Map(part.registros.map((r) => [r.id, r]));
        for (const r of lote) mapa.set(r.id, r);
        const copia = [...mapa.values()];

        const sha = await this._escribir(
          this._ruta(entidad, real), copia, part.sha,
          mensaje || `Lote ${entidad} ${periodo} (${lote.length})`);

        this.cache.set(`${entidad}/${periodo}`, { registros: copia, sha, fallidos: [] });
        this._registrarEnIndice(entidad, real, copia);
      }
      await this._guardarIndice();
    }

    async _guardarIndice() {
      for (let intento = 1; intento <= REINTENTOS; intento++) {
        try {
          this.indiceSha = await this._escribir(
            this._rutaIndice(), this.indice, this.indiceSha, "Actualiza índice");
          return;
        } catch (e) {
          if (!e.conflicto || intento === REINTENTOS) throw e;
          // El índice es derivado: ante conflicto se relee y se re-aplica el
          // resumen propio sobre la versión ajena, que ya trae los suyos.
          const { datos, sha } = await this._leer(this._rutaIndice());
          const ajeno = datos || this._indiceVacio();
          for (const [ent, val] of Object.entries(this.indice.entidades)) {
            ajeno.entidades[ent] = ajeno.entidades[ent] || { particiones: {}, total: 0 };
            Object.assign(ajeno.entidades[ent].particiones, val.particiones);
            ajeno.entidades[ent].total = Object.values(ajeno.entidades[ent].particiones)
              .reduce((s, p) => s + p.cantidad, 0);
          }
          ajeno.secuencias = { ...ajeno.secuencias, ...this.indice.secuencias };
          this.indice = ajeno;
          this.indiceSha = sha;
        }
      }
    }

    // ------------------------------------------------------------------------
    // Numeración
    // ------------------------------------------------------------------------

    /**
     * Próximo número de una serie anual propia.
     *
     * Propuestas y contratos llevan series separadas —PR- y CT-— porque son
     * dos etapas distintas: saber de un vistazo qué se está mirando, y cuántas
     * propuestas hicieron falta por cada contrato, exige que no compartan
     * correlativo.
     */
    proximoNumeroSerie(prefijo, anio) {
      anio = anio || String(new Date().getFullYear());
      const clave = `${prefijo}:${anio}`;
      const n = (this.indice.secuencias[clave] || 0) + 1;
      return { numero: `${prefijo}-${anio}-${String(n).padStart(4, "0")}`, clave, n };
    }

    proximoNumeroContrato(anio) { return this.proximoNumeroSerie("CT", anio); }
    proximoNumeroPropuesta(anio) { return this.proximoNumeroSerie("PR", anio); }

    /** Confirma el consumo de un número. Se llama después de guardar. */
    confirmarSecuencia(clave, n) {
      this.indice.secuencias[clave] = Math.max(this.indice.secuencias[clave] || 0, n);
    }

    /**
     * Próxima secuencia mensual compartida entre tickets y presupuestos:
     * TK-AAAAMMNN ↔ PAAAAMMNN. Se mantiene porque es la convención con la que
     * ya están nombrados todos los archivos del histórico.
     */
    proximaSecuenciaMes() {
      const d = new Date();
      const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
      const clave = `comercial:${ym}`;
      const n = (this.indice.secuencias[clave] || 0) + 1;
      return {
        ym, n, clave,
        ticket: `TK-${ym}${String(n).padStart(2, "0")}`,
        presupuesto: `P${ym}${String(n).padStart(2, "0")}`,
      };
    }

    // ------------------------------------------------------------------------
    // Agregados desde el índice (sin abrir particiones)
    // ------------------------------------------------------------------------

    /**
     * Totales para el tablero, leídos del índice.
     * Esta es la razón de ser de todo el diseño: el tablero cuesta una sola
     * petición, tenga la base 74 registros o 74.000.
     */
    resumen(entidad, periodos) {
      const ent = this.indice?.entidades?.[entidad];
      if (!ent) return { cantidad: 0, porEstado: {}, montoPorEstado: {} };

      const claves = periodos || Object.keys(ent.particiones);
      const out = { cantidad: 0, porEstado: {}, montoPorEstado: {}, porCanal: {}, porMoneda: {} };

      for (const k of claves) {
        const p = ent.particiones[k];
        if (!p) continue;
        out.cantidad += p.cantidad;
        for (const campo of ["porEstado", "montoPorEstado", "porCanal", "porMoneda"]) {
          for (const [kk, vv] of Object.entries(p[campo] || {})) {
            out[campo][kk] = E.money((out[campo][kk] || 0) + vv);
          }
        }
      }
      return out;
    }

    /** Invalida la caché. Se usa tras un re-sync externo. */
    limpiarCache() {
      this.cache.clear();
    }
  }

  global.NEXO_ALMACEN = { Almacen, MESES_POR_DEFECTO, REINTENTOS };
})(typeof window !== "undefined" ? window : globalThis);
