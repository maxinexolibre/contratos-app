/**
 * Matriz de permisos por rol.
 *
 * ADVERTENCIA IMPORTANTE, LEER ANTES DE CONFIAR EN ESTE ARCHIVO:
 *
 * Sin servidor, esto NO es un límite de seguridad. Todo corre en el navegador
 * del usuario y cualquiera con las herramientas de desarrollo puede saltearlo.
 * El único límite real es el alcance del token (PAT) de cada persona sobre el
 * repo privado: quien tiene permiso de escritura puede modificar cualquier
 * archivo de datos, sin importar lo que diga esta matriz.
 *
 * Lo que esta matriz sí resuelve:
 *   - No mostrar botones que la persona no debería usar.
 *   - Dejar registro de quién hizo qué (trazabilidad, no prevención).
 *   - Ser la única fuente de la matriz: si mañana se monta un servidor, la
 *     lógica ya está escrita en un solo lugar y se mueve tal cual.
 *
 * Para convertir esto en un límite real hacen falta dos cosas: un servidor que
 * valide, y tokens de solo lectura para quien no deba escribir.
 */
(function (global) {
  "use strict";

  const ACCIONES = ["crear", "leer", "editar", "borrar"];

  /**
   * Alcance de un permiso:
   *   "todos"   → sobre cualquier registro
   *   "propios" → solo los que la persona creó o tiene asignados
   *   "agregado"→ solo totales, sin detalle por registro
   *   null      → sin acceso
   */
  const MATRIZ = {
    tickets: {
      vendedor:               { crear: "todos", leer: "propios", editar: "propios", borrar: null },
      gerente_comercial:      { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
      gerente_administrativo: { crear: null, leer: "todos", editar: null, borrar: null },
      direccion:              { crear: "todos", leer: "todos", editar: "todos", borrar: null },
      marketing:              { crear: null, leer: null, editar: null, borrar: null },
      admin:                  { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
    },
    presupuestos: {
      vendedor:               { crear: "todos", leer: "propios", editar: "propios", borrar: null },
      gerente_comercial:      { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
      gerente_administrativo: { crear: "todos", leer: "todos", editar: "todos", borrar: null },
      direccion:              { crear: "todos", leer: "todos", editar: "todos", borrar: null },
      marketing:              { crear: null, leer: null, editar: null, borrar: null },
      admin:                  { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
    },
    contratos: {
      vendedor:               { crear: null, leer: "propios", editar: null, borrar: null },
      gerente_comercial:      { crear: "todos", leer: "todos", editar: "todos", borrar: null },
      gerente_administrativo: { crear: "todos", leer: "todos", editar: "todos", borrar: null },
      direccion:              { crear: "todos", leer: "todos", editar: "todos", borrar: null },
      marketing:              { crear: null, leer: null, editar: null, borrar: null },
      admin:                  { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
    },
    clientes: {
      vendedor:               { crear: null, leer: "todos", editar: null, borrar: null },
      gerente_comercial:      { crear: "todos", leer: "todos", editar: "todos", borrar: null },
      gerente_administrativo: { crear: "todos", leer: "todos", editar: "todos", borrar: null },
      direccion:              { crear: null, leer: "todos", editar: null, borrar: null },
      marketing:              { crear: null, leer: "todos", editar: null, borrar: null },
      admin:                  { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
    },
    facturaciones: {
      vendedor:               { crear: null, leer: null, editar: null, borrar: null },
      gerente_comercial:      { crear: null, leer: "agregado", editar: null, borrar: null },
      gerente_administrativo: { crear: "todos", leer: "todos", editar: "todos", borrar: null },
      direccion:              { crear: null, leer: "agregado", editar: null, borrar: null },
      marketing:              { crear: null, leer: null, editar: null, borrar: null },
      admin:                  { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
    },
    tiposCambio: {
      vendedor:               { crear: null, leer: "todos", editar: null, borrar: null },
      gerente_comercial:      { crear: null, leer: "todos", editar: null, borrar: null },
      gerente_administrativo: { crear: "todos", leer: "todos", editar: "todos", borrar: null },
      direccion:              { crear: null, leer: "todos", editar: null, borrar: null },
      marketing:              { crear: null, leer: "todos", editar: null, borrar: null },
      admin:                  { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
    },
    campanas: {
      vendedor:               { crear: null, leer: null, editar: null, borrar: null },
      gerente_comercial:      { crear: null, leer: "todos", editar: null, borrar: null },
      gerente_administrativo: { crear: null, leer: null, editar: null, borrar: null },
      direccion:              { crear: null, leer: "todos", editar: null, borrar: null },
      marketing:              { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
      admin:                  { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
    },
    estrategias: {
      vendedor:               { crear: null, leer: null, editar: null, borrar: null },
      gerente_comercial:      { crear: null, leer: null, editar: null, borrar: null },
      gerente_administrativo: { crear: null, leer: null, editar: null, borrar: null },
      direccion:              { crear: null, leer: "todos", editar: null, borrar: null },
      marketing:              { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
      admin:                  { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
    },
    vendedores: {
      vendedor:               { crear: null, leer: "propios", editar: null, borrar: null },
      gerente_comercial:      { crear: "todos", leer: "todos", editar: "todos", borrar: null },
      gerente_administrativo: { crear: null, leer: "todos", editar: null, borrar: null },
      direccion:              { crear: null, leer: "todos", editar: null, borrar: null },
      marketing:              { crear: null, leer: null, editar: null, borrar: null },
      admin:                  { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
    },
    acuerdosComision: {
      // Un vendedor ve su propio acuerdo: es el contrato bajo el que trabaja.
      vendedor:               { crear: null, leer: "propios", editar: null, borrar: null },
      gerente_comercial:      { crear: "todos", leer: "todos", editar: "todos", borrar: null },
      gerente_administrativo: { crear: null, leer: "todos", editar: null, borrar: null },
      direccion:              { crear: null, leer: "todos", editar: null, borrar: null },
      marketing:              { crear: null, leer: null, editar: null, borrar: null },
      admin:                  { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
    },
    comisiones: {
      vendedor:               { crear: null, leer: "propios", editar: null, borrar: null },
      gerente_comercial:      { crear: "todos", leer: "todos", editar: "todos", borrar: null },
      gerente_administrativo: { crear: null, leer: "todos", editar: "todos", borrar: null },
      direccion:              { crear: null, leer: "todos", editar: null, borrar: null },
      marketing:              { crear: null, leer: null, editar: null, borrar: null },
      admin:                  { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
    },
    leads: {
      vendedor:               { crear: null, leer: "propios", editar: null, borrar: null },
      gerente_comercial:      { crear: null, leer: "todos", editar: "todos", borrar: null },
      gerente_administrativo: { crear: null, leer: null, editar: null, borrar: null },
      direccion:              { crear: null, leer: "todos", editar: null, borrar: null },
      marketing:              { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
      admin:                  { crear: "todos", leer: "todos", editar: "todos", borrar: "todos" },
    },
  };

  /**
   * Capacidades sueltas que no son CRUD sobre una entidad.
   * Cada una lista los roles habilitados.
   */
  const CAPACIDADES = {
    // Aprobar presupuestos: gerencia comercial y administrativa, sin importar
    // el monto (definición de Maxi, 2026-08-04). No hay umbral activo.
    aprobar_presupuesto: ["gerente_comercial", "gerente_administrativo", "admin"],
    asignar_vendedor: ["gerente_comercial", "admin"],
    // La comisión la aprueba quien la va a pagar, nunca quien la cobra.
    aprobar_comision: ["gerente_comercial", "gerente_administrativo", "admin"],
    liquidar_comision: ["gerente_administrativo", "admin"],
    ver_comisiones_equipo: ["gerente_comercial", "gerente_administrativo", "direccion", "admin"],
    reabrir_ticket: ["gerente_comercial", "admin"],
    ver_kpi_comercial: ["gerente_comercial", "gerente_administrativo", "direccion", "admin"],
    ver_kpi_marketing: ["gerente_comercial", "direccion", "marketing", "admin"],
    ver_forecast: ["gerente_comercial", "gerente_administrativo", "direccion", "admin"],
    ver_reportes: ["gerente_comercial", "gerente_administrativo", "direccion", "marketing", "admin"],
    configurar_umbrales: ["direccion", "admin"],
    administrar_usuarios: ["admin"],
  };

  /** Áreas de trabajo visibles por rol. Define también dónde aterriza cada uno. */
  const AREAS = {
    comercial:  ["vendedor", "gerente_comercial", "gerente_administrativo", "direccion", "admin"],
    contratos:  ["gerente_comercial", "gerente_administrativo", "direccion", "admin"],
    marketing:  ["marketing", "direccion", "admin"],
    direccion:  ["direccion", "gerente_comercial", "gerente_administrativo", "admin"],
  };

  /** Pantalla inicial por rol: nadie debe aterrizar en una vista vacía. */
  const INICIO = {
    vendedor: "pipeline",
    gerente_comercial: "pipeline",
    gerente_administrativo: "facturacion",
    direccion: "ejecutivo",
    marketing: "calendario",
    admin: "pipeline",
  };

  // --------------------------------------------------------------------------

  /** Alcance del permiso, o null si no tiene. */
  function alcance(rol, entidad, accion) {
    return MATRIZ[entidad]?.[rol]?.[accion] ?? null;
  }

  /** ¿Puede hacer la acción, con cualquier alcance? */
  function puede(rol, entidad, accion) {
    return alcance(rol, entidad, accion) !== null;
  }

  /** ¿Tiene una capacidad suelta? */
  function capacidad(rol, nombre) {
    return (CAPACIDADES[nombre] || []).includes(rol);
  }

  /** ¿Ve el área de trabajo? */
  function veArea(rol, area) {
    return (AREAS[area] || []).includes(rol);
  }

  function areasDe(rol) {
    return Object.keys(AREAS).filter((a) => veArea(rol, a));
  }

  function inicioDe(rol) {
    return INICIO[rol] || "pipeline";
  }

  /**
   * ¿Puede tocar este registro puntual?
   * Con alcance "propios" el registro tiene que ser suyo: creado por esa
   * persona o con ella como vendedor asignado.
   */
  function puedeSobre(rol, entidad, accion, registro, usuario) {
    const a = alcance(rol, entidad, accion);
    if (a === null) return false;
    if (a === "todos") return true;
    if (a === "agregado") return accion === "leer";
    if (a === "propios") {
      if (!registro || !usuario) return false;
      const propio = registro.vendedor === usuario || registro.usuario === usuario ||
                     registro.emitidoPor === usuario;
      return Boolean(propio);
    }
    return false;
  }

  /**
   * Filtra una lista dejando solo lo que el rol puede leer.
   * Es la contraparte en cliente de lo que serían las políticas RLS.
   */
  function filtrarLectura(rol, entidad, lista, usuario) {
    const a = alcance(rol, entidad, "leer");
    if (a === null) return [];
    if (a === "todos" || a === "agregado") return lista;
    return lista.filter((r) => puedeSobre(rol, entidad, "leer", r, usuario));
  }

  global.NEXO_PERMISOS = {
    ACCIONES, MATRIZ, CAPACIDADES, AREAS, INICIO,
    alcance, puede, capacidad, veArea, areasDe, inicioDe, puedeSobre, filtrarLectura,
  };
})(typeof window !== "undefined" ? window : globalThis);
