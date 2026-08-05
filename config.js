// Configuración de la plataforma de contratos.
// Editá estos valores si cambia el owner o el repo de datos.
window.NEXO_CONFIG = {
  owner: "maxinexolibre",
  dataRepo: "contratos-data",
  dataPath: "data/contratos.json",
  presupuestosPath: "data/presupuestos.json",
  ticketsPath: "data/tickets.json",
  // Entidades del modelo v3. Arrancan vacías: si el archivo no existe, la
  // carga devuelve 404 y la colección queda en [] sin romper nada.
  campanasPath: "data/campanas.json",
  estrategiasPath: "data/estrategias.json",
  leadsPath: "data/leads.json",
  facturacionesPath: "data/facturaciones.json",
  tiposCambioPath: "data/tipos-cambio.json",
  vendedoresPath: "data/vendedores.json",
  acuerdosComisionPath: "data/acuerdos-comision.json",
  comisionesPath: "data/comisiones.json",
  branch: "main",
};
