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
  propuestasPath: "data/propuestas.json",
  clientesPath: "data/clientes.json",
  catalogoPath: "data/catalogo.json",
  // Raíz de la estructura particionada. Los archivos planos de `data/` quedan
  // como copia de seguridad hasta que se decida eliminarlos.
  baseDatos: "data/v3",
  branch: "main",
  // Catálogo de partes y equipos. La app lo publica en el repo PÚBLICO de la
  // web: solo viaja la proyección de lista blanca (nucleo/catalogo.js), nunca
  // costo, proveedor ni N° de serie. Quien publica necesita que su token
  // tenga también permiso de escritura sobre este repo.
  web: {
    owner: "nexolibre",
    repo: "nexolibre",
    branch: "main",
    partsPath: "parts.json",
    fotosDir: "assets/parts",
    sitio: "https://nexolibre.com",
  },
  // Fotos cargadas que todavía no se publicaron. Viven en el repo privado
  // hasta que alguien aprieta Publicar: el repo de la web es público y una
  // foto subida ahí ya es visible para cualquiera.
  fotosCatalogoPath: "data/v3/catalogo-fotos",
};
