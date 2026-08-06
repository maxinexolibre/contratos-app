/**
 * Repositorio: la capa de datos de la aplicación sobre el almacén particionado.
 *
 * Une tres piezas que hasta ahora estaban sueltas:
 *
 *   NEXO_ALMACEN    lee y escribe particiones mensuales + índice con agregados
 *   NEXO_ADAPTADOR  traduce entre la forma vieja de app.js y el modelo v3
 *   NEXO_ESQUEMA    define la forma de cada registro
 *
 * En disco todo queda en modelo v3 y particionado por mes. En memoria, app.js
 * sigue trabajando con la forma vieja: sus 2.900 líneas de vistas no se tocan.
 * La traducción ocurre solo en el borde, al leer y al escribir.
 *
 * Por qué particionar: presupuestos.json pesa ~1,6 KB por registro y la API de
 * contenidos de GitHub corta en 1 MB por archivo. Con particiones mensuales el
 * tablero se dibuja leyendo únicamente el índice —8 KB en vez de 176— y
 * guardar un presupuesto reescribe un archivo de 30 KB en lugar de 120.
 *
 * Compatibilidad: si el repo todavía no tiene la estructura particionada, se
 * leen los archivos planos y se migran en la primera escritura. Nadie tiene
 * que correr nada a mano.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;
  const AD = global.NEXO_ADAPTADOR;

  /** Entidades que app.js maneja en forma vieja y hay que traducir. */
  const TRADUCIDAS = {
    contratos: { aNuevo: "contratoANuevo", aViejo: "contratoAViejo", clave: "data" },
    presupuestos: { aNuevo: "presupuestoANuevo", aViejo: "presupuestoAViejo", clave: "presupuestos" },
    tickets: { aNuevo: "ticketANuevo", aViejo: "ticketAViejo", clave: "tickets" },
  };

  /** El resto ya nace en modelo v3: no necesita traducción. */
  const NATIVAS = ["clientes", "campanas", "estrategias", "leads", "facturaciones",
    "tiposCambio", "vendedores", "acuerdosComision", "comisiones", "usuarios"];

  class Repositorio {
    /**
     * @param {object} cfg  { owner, dataRepo, branch, token, base }
     * @param {object} estado  el `state` de app.js
     */
    constructor(cfg, estado) {
      this.almacen = new global.NEXO_ALMACEN.Almacen(cfg);
      this.estado = estado;
      this.cfg = cfg;
      /** Clientes derivados, para resolver ids al traducir. */
      this.clientes = [];
    }

    async abrir() {
      await this.almacen.abrir();
      return this.almacen.indice;
    }

    /** ¿El repo ya tiene la estructura particionada? */
    get migrado() {
      const ent = this.almacen.indice?.entidades || {};
      return Object.keys(ent).length > 0;
    }

    // ------------------------------------------------------------------------
    // Lectura
    // ------------------------------------------------------------------------

    /**
     * Carga todo lo que la aplicación necesita para arrancar.
     *
     * De las entidades particionadas se traen los últimos meses; el histórico
     * completo se pide aparte cuando alguien lo filtra. Así el arranque no
     * crece con los años.
     */
    async cargarTodo({ meses = 12 } = {}) {
      const A = this.almacen;

      // Los clientes se cargan primero: hacen falta para resolver los ids
      // al traducir el resto.
      this.clientes = await A.cargar("clientes");

      const [contratos, presupuestos, tickets] = await Promise.all([
        A.cargar("contratos"),
        A.cargar("presupuestos", { periodos: A.periodosRecientes("presupuestos", meses) }),
        A.cargar("tickets", { periodos: A.periodosRecientes("tickets", meses) }),
      ]);

      // El padrón puede no existir todavía: se deriva de los registros.
      if (!this.clientes.length) {
        this.clientes = AD.clientesDesde({
          data: contratos.map((c) => AD.contratoAViejo(c, { clientes: [] })),
          presupuestos: presupuestos.map((p) => AD.presupuestoAViejo(p, { clientes: [] })),
          tickets: tickets.map((t) => AD.ticketAViejo(t, { clientes: [] })),
        });
      }

      const ctx = { clientes: this.clientes };
      this.estado.data = contratos.map((c) => AD.contratoAViejo(c, ctx));
      this.estado.presupuestos = presupuestos.map((p) => AD.presupuestoAViejo(p, ctx));
      this.estado.tickets = tickets.map((t) => AD.ticketAViejo(t, ctx));
      this.estado.clientes = this.clientes;

      for (const ent of NATIVAS) {
        if (ent === "clientes") continue;
        this.estado[ent] = await A.cargar(ent);
      }

      return {
        contratos: contratos.length,
        presupuestos: presupuestos.length,
        tickets: tickets.length,
        periodosDisponibles: A.periodos("presupuestos").length,
      };
    }

    /** Carga el histórico completo de una entidad particionada. */
    async cargarHistorico(entidad) {
      const registros = await this.almacen.cargar(entidad, { todos: true });
      const ctx = { clientes: this.clientes };
      const t = TRADUCIDAS[entidad];
      if (t) {
        this.estado[t.clave] = registros.map((r) => AD[t.aViejo](r, ctx));
      } else {
        this.estado[entidad] = registros;
      }
      return registros.length;
    }

    // ------------------------------------------------------------------------
    // Escritura
    // ------------------------------------------------------------------------

    /**
     * Guarda un registro puntual. Toca una sola partición.
     *
     * @param {string} entidad
     * @param {object} registroViejo  el registro tal como lo tiene app.js
     */
    async guardar(entidad, registroViejo, mensaje) {
      const t = TRADUCIDAS[entidad];
      let nuevo;
      if (t) {
        const idx = AD.indiceClientes(this.clientes);
        nuevo = AD[t.aNuevo](registroViejo, {
          indiceClientes: idx,
          presupuestos: this.estado.presupuestos,
          indicePresupuestos: AD.indicePresupuestos(this.estado.presupuestos),
        });
        await this._asegurarCliente(registroViejo.cliente);
      } else {
        nuevo = registroViejo;
      }
      await this.almacen.guardar(entidad, nuevo, mensaje);
      return nuevo;
    }

    /**
     * Guarda una colección entera. Se usa en el alta masiva y en la migración
     * inicial; para una edición puntual conviene `guardar`, que escribe un
     * solo archivo.
     */
    async guardarColeccion(entidad, mensaje) {
      const t = TRADUCIDAS[entidad];
      const lista = t ? this.estado[t.clave] : this.estado[entidad];
      let registros = lista || [];

      if (t) {
        const idx = AD.indiceClientes(this.clientes);
        const ip = AD.indicePresupuestos(this.estado.presupuestos);
        registros = registros.map((r) => AD[t.aNuevo](r, {
          indiceClientes: idx, presupuestos: this.estado.presupuestos, indicePresupuestos: ip,
        }));
      }
      await this.almacen.guardarLote(entidad, registros, mensaje);
      return registros.length;
    }

    /**
     * Da de alta el cliente si todavía no está en el padrón.
     *
     * El cliente viene embebido en cada registro de la forma vieja; el modelo
     * nuevo lo tiene como entidad propia. Sin esto, el `clienteId` quedaría
     * vacío y el registro perdería a quién pertenece.
     */
    async _asegurarCliente(bloque) {
      const nombre = (bloque?.nombreComercial || "").trim();
      if (!nombre) return null;
      const clave = E.claveCliente(nombre);
      const ya = this.clientes.find(
        (c) => E.claveCliente(c.nombreComercial) === clave || (c.alias || []).some(
          (a) => E.claveCliente(a) === clave));
      if (ya) return ya;

      const nuevo = E.ENTIDADES.clientes.normalizar({
        id: `cli_${clave.replace(/\s+/g, "-").slice(0, 32)}`,
        nombreComercial: nombre, razonSocial: nombre,
        localidad: bloque.localidad, provincia: bloque.provincia,
        contacto: bloque.contacto, alias: [nombre],
      });
      const rs = (bloque.razonesSociales || []).find((r) => r.cuit);
      if (rs) { nuevo.cuit = rs.cuit; nuevo.razonSocial = rs.razonSocial || nombre; }

      this.clientes.push(nuevo);
      this.estado.clientes = this.clientes;
      await this.almacen.guardar("clientes", nuevo, `Alta cliente ${nombre}`);
      return nuevo;
    }

    // ------------------------------------------------------------------------
    // Migración desde los archivos planos
    // ------------------------------------------------------------------------

    /**
     * Convierte la estructura plana en particionada, una sola vez.
     *
     * Lee los archivos planos con las rutas de la configuración anterior, los
     * traduce al modelo v3 y los escribe particionados. No borra los planos:
     * quedan como copia de seguridad hasta que se decida eliminarlos.
     */
    async migrarDesdePlano(rutasPlanas, cargarPlano) {
      const informe = { clientes: 0, contratos: 0, presupuestos: 0, tickets: 0, errores: [] };

      const planos = {};
      for (const [entidad, ruta] of Object.entries(rutasPlanas)) {
        try {
          planos[entidad] = await cargarPlano(ruta);
        } catch (e) {
          informe.errores.push(`${entidad}: ${e.message}`);
          planos[entidad] = [];
        }
      }

      // El padrón se deriva de todos los registros a la vez, para que un mismo
      // cliente que aparece en un ticket y en un contrato sea una sola ficha.
      this.clientes = AD.clientesDesde({
        data: planos.contratos || [],
        presupuestos: planos.presupuestos || [],
        tickets: planos.tickets || [],
      });
      informe.clientes = this.clientes.length;
      await this.almacen.guardarLote("clientes", this.clientes, "Padrón unificado de clientes");

      const idx = AD.indiceClientes(this.clientes);
      const ip = AD.indicePresupuestos(planos.presupuestos || []);
      const ctx = { indiceClientes: idx, presupuestos: planos.presupuestos || [], indicePresupuestos: ip };

      for (const [entidad, def] of Object.entries(TRADUCIDAS)) {
        const lista = planos[entidad] || [];
        const registros = lista.map((r) => AD[def.aNuevo](r, ctx));
        await this.almacen.guardarLote(entidad, registros, `Migración v3 · ${entidad}`);
        informe[entidad] = registros.length;
      }

      return informe;
    }
  }

  global.NEXO_REPOSITORIO = { Repositorio, TRADUCIDAS, NATIVAS };
})(typeof window !== "undefined" ? window : globalThis);
