/**
 * Visor de documentos en pantalla.
 *
 * Hasta ahora, para ver un contrato o un presupuesto había que descargar el
 * .docx y abrirlo en Word. Eso convierte una consulta de diez segundos en un
 * archivo más en la carpeta de descargas.
 *
 * El .docx y esta vista salen del MISMO modelo: `construirContrato` y
 * `construirPresupuesto` arman los datos una sola vez, y de ahí se derivan
 * tanto el documento de Word como el HTML. Lo que se ve acá es lo que se
 * descarga, no una aproximación.
 *
 * Para los adjuntos ya subidos al repositorio —PDF, imágenes— se abre el
 * archivo real. El .docx no se puede mostrar en un navegador sin una librería
 * de conversión, así que en ese caso se ofrece la descarga y se aclara por qué.
 */
(function (global) {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const ID = "ovVisor";

  /** Extensión en minúsculas, sin el punto. */
  const extension = (nombre) => String(nombre || "").split(".").pop().toLowerCase();

  const VISIBLES_EN_NAVEGADOR = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "svg"];

  // --------------------------------------------------------------------------
  // Contenedor
  // --------------------------------------------------------------------------

  function abrir(titulo, cuerpo, acciones = "") {
    cerrar();
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.id = ID;
    ov.innerHTML = `<div class="modal visor">
      <div class="visor-head">
        <div style="flex:1;min-width:0">
          <div class="kicker">Vista previa</div>
          <h2 style="margin:0;font-size:20px">${esc(titulo)}</h2>
        </div>
        ${acciones}
        <button class="btn ghost sm" onclick="cerrarVisor()" aria-label="Cerrar">✕</button>
      </div>
      <div class="visor-cuerpo">${cuerpo}</div>
    </div>`;
    document.body.appendChild(ov);
    ov.style.display = "flex";
    // Cerrar con Escape y clic afuera: un visor del que no se sale rápido
    // termina siendo peor que descargar el archivo.
    ov.onclick = (e) => { if (e.target === ov) cerrar(); };
    document.addEventListener("keydown", alEscape);
    return ov;
  }

  function alEscape(e) {
    if (e.key === "Escape") cerrar();
  }

  function cerrar() {
    document.getElementById(ID)?.remove();
    document.removeEventListener("keydown", alEscape);
  }

  // --------------------------------------------------------------------------
  // Documentos generados
  // --------------------------------------------------------------------------

  /**
   * Muestra el documento tal como saldría impreso.
   *
   * El HTML se inserta dentro de un contenedor con los mismos estilos que usa
   * la impresión, así que la vista previa no es una maqueta parecida: es el
   * documento.
   */
  function verDocumento(tipo, id) {
    const st = global.state;
    let html, titulo, descarga;

    if (tipo === "contrato") {
      const c = (st.data || []).find((x) => x.id === id);
      if (!c) return;
      const m = global.NEXO_CONTRATO.construirContrato(c, { plantilla: false });
      html = global.renderContratoHTML(m);
      titulo = `${c.numero} · ${c.cliente?.nombreComercial || ""}`;
      descarga = `generarDocx('${esc(id)}')`;
    } else {
      const p = (st.presupuestos || []).find((x) => x.id === id);
      if (!p) return;
      const m = global.NEXO_PRESUPUESTO.construirPresupuesto(p, { plantilla: false });
      html = global.renderPresupuestoHTML(m);
      titulo = `${p.numero} · ${p.cliente?.nombreComercial || ""}`;
      descarga = `generarPresupuestoDocx('${esc(id)}')`;
    }

    abrir(titulo, `<div class="visor-doc" id="visorDoc">${html}</div>`, `
      <button class="btn sm" onclick="imprimirDesdeVisor()">🖨 Imprimir</button>
      <button class="btn sm" onclick="${descarga}">⬇ .docx</button>`);
  }

  /**
   * Imprime lo que se está viendo.
   * Se copia al contenedor de impresión, que es el único que el CSS deja
   * visible al imprimir.
   */
  function imprimirDesdeVisor() {
    const doc = document.getElementById("visorDoc");
    if (!doc) return;
    document.getElementById("printRoot").innerHTML = doc.innerHTML;
    global.print();
  }

  // --------------------------------------------------------------------------
  // Archivos adjuntos
  // --------------------------------------------------------------------------

  /**
   * Abre un archivo del repositorio privado.
   *
   * No se puede usar un enlace directo: los archivos viven en un repo privado
   * y hace falta el token. Se descarga con la API y se muestra desde memoria,
   * sin dejar nada en el disco.
   */
  async function verArchivo(ruta, nombre) {
    const ext = extension(nombre || ruta);
    const CFG = global.NEXO_CONFIG;

    if (!VISIBLES_EN_NAVEGADOR.includes(ext)) {
      abrir(nombre || ruta, `<div style="padding:28px;text-align:center">
        <p class="muted" style="max-width:52ch;margin:0 auto 16px">
          Los archivos <b>.${esc(ext)}</b> no se pueden mostrar en el navegador sin
          convertirlos primero. Para contratos y presupuestos generados por el
          sistema conviene usar <b>Ver documento</b>, que muestra el mismo
          contenido sin descargar nada.
        </p>
        <button class="btn primary" onclick="descargarArchivo('${esc(ruta)}','${esc(nombre || "")}')">
          ⬇ Descargar ${esc(nombre || "archivo")}</button>
      </div>`);
      return;
    }

    abrir(nombre || ruta, `<div style="padding:40px;text-align:center" class="muted">Cargando…</div>`);
    try {
      const url = `https://api.github.com/repos/${CFG.owner}/${CFG.dataRepo}/contents/${ruta}?ref=${CFG.branch}`;
      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("nexo_pat")}`,
          Accept: "application/vnd.github.raw",
        },
      });
      if (!r.ok) throw new Error(`No se pudo abrir (${r.status})`);
      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);

      const cuerpo = document.querySelector(`#${ID} .visor-cuerpo`);
      cuerpo.innerHTML = ext === "pdf"
        ? `<iframe class="visor-pdf" src="${objUrl}" title="${esc(nombre || ruta)}"></iframe>`
        : `<div style="padding:18px;text-align:center"><img src="${objUrl}" alt="${esc(nombre || ruta)}" style="max-width:100%;height:auto;border-radius:10px" /></div>`;

      // Se libera cuando se cierra: si no, el blob queda en memoria toda la sesión.
      document.getElementById(ID).addEventListener("remove", () => URL.revokeObjectURL(objUrl));
    } catch (e) {
      const cuerpo = document.querySelector(`#${ID} .visor-cuerpo`);
      if (cuerpo) {
        cuerpo.innerHTML = `<div style="padding:28px;text-align:center">
          <p><b>No se pudo abrir el archivo.</b></p>
          <p class="muted">${esc(e.message)}</p>
          <button class="btn" onclick="descargarArchivo('${esc(ruta)}','${esc(nombre || "")}')">
            ⬇ Descargar</button></div>`;
      }
    }
  }

  /** Descarga un adjunto del repositorio privado. */
  async function descargarArchivo(ruta, nombre) {
    const CFG = global.NEXO_CONFIG;
    try {
      const r = await fetch(
        `https://api.github.com/repos/${CFG.owner}/${CFG.dataRepo}/contents/${ruta}?ref=${CFG.branch}`,
        { headers: {
          Authorization: `Bearer ${localStorage.getItem("nexo_pat")}`,
          Accept: "application/vnd.github.raw",
        } });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = nombre || ruta.split("/").pop();
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      global.toast("No se pudo descargar: " + e.message, true, true);
    }
  }

  Object.assign(global, {
    verDocumento, verArchivo, descargarArchivo,
    cerrarVisor: cerrar, imprimirDesdeVisor,
  });
})(typeof window !== "undefined" ? window : globalThis);
