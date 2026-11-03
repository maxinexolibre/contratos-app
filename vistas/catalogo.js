/**
 * Catálogo de partes y equipos a la venta, y su publicación en nexolibre.com.
 *
 * Reemplaza a la lista de SharePoint + Power Automate que escribía parts.json
 * en el repo de la web. Tres pantallas:
 *
 *   catalogo      listado con filtros y la ficha de cada ítem (catform)
 *   catauditoria  revisión de lo importado de SharePoint, uno por uno
 *   catpublicar   qué cambia en la web y el botón que lo publica
 *
 * Decisiones que se ven en la pantalla:
 *
 * - Publicar es explícito (definición de Maxi, 2026-11-03). Guardar un ítem no
 *   toca la web; recién "Publicar" reescribe parts.json, y antes muestra la
 *   lista de altas, bajas y cambios. Entre la app y un sitio público tiene que
 *   haber una revisión.
 * - Las fotos nuevas esperan en el repo privado. El repo de la web es público:
 *   subirlas ahí al cargarlas haría visible algo que todavía no se decidió
 *   publicar.
 * - Una publicación es UN commit (API de git, no la de contenidos). Con la de
 *   contenidos, diez fotos eran once commits y once despliegues de Pages.
 * - Lo importado entra "pendiente de auditoría". Las oportunidades de eBay que
 *   se cargaron en SharePoint nadie las volvió a verificar: la bandeja de
 *   auditoría existe para confirmarlas o darlas de baja antes de seguir
 *   ofreciéndolas.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;
  const R = global.NEXO_REGLAS;
  const P = global.NEXO_PERMISOS;
  const CAT = global.NEXO_CATALOGO_PARTES;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n, d = 0) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const precioTxt = (x) => (x.precio == null ? `<span class="muted">Consultar</span>` : `US$ ${num(x.precio)}`);

  const cfg = () => global.NEXO_CONFIG;
  const items = () => global.state?.catalogo || [];
  const rol = () => global.state?.rol || "admin";
  const usuario = () => global.state?.user || "";
  const conectado = () => global.state?.mode === "connected";
  const puedeEditar = () => !global.state?.soloLectura && P.puede(rol(), "catalogo", "editar");
  const puedePublicar = () => !global.state?.soloLectura && P.capacidad(rol(), "publicar_catalogo");

  /** Token propio para el repo de la web. Ver tokenWeb(). */
  const LS_PAT_WEB = "nexo_pat_web";
  const LS_FOTO_DEMO = "nexo_demo_foto:";

  const BADGE_DISP = {
    EnStock: "firme_vigente", APedido: "enviada", Reservado: "negociacion",
    SinStock: "perdida", Vendido: "perdida", Baja: "perdida",
  };
  const badgeDisp = (d) => `<span class="badge ${BADGE_DISP[d] || ""}">${esc(CAT.DISPONIBILIDAD_TEXTO[d] || d)}</span>`;
  const opciones = (lista, actual, textos = {}) => lista.map((v) =>
    `<option value="${esc(v)}"${v === actual ? " selected" : ""}>${esc(textos[v] || v)}</option>`).join("");

  // ==========================================================================
  // Fotos
  // ==========================================================================

  /** URLs de objeto de las fotos privadas, para no bajarlas en cada render. */
  const cacheFotos = new Map();

  /**
   * src de una foto. Las publicadas se sirven desde la web; las privadas hay
   * que bajarlas con el token (repo privado), así que se resuelven después
   * del render con hidratarFotos().
   */
  function srcFoto(f) {
    if (CAT.esUrl(f.archivo)) return f.archivo;
    if (f.publicada) return `${cfg().web.sitio}/${cfg().web.fotosDir}/${encodeURIComponent(f.archivo)}`;
    return cacheFotos.get(f.archivo) || "";
  }

  function imgFoto(f, clase = "cat-thumb") {
    const src = srcFoto(f);
    return `<img class="${clase}" alt="" loading="lazy" ${src ? `src="${esc(src)}"` : `data-privada="${esc(f.archivo)}"`}>`;
  }

  /** Base64 de una foto que todavía no está en la web. */
  async function base64FotoPrivada(archivo) {
    if (!conectado()) {
      const d = localStorage.getItem(LS_FOTO_DEMO + archivo);
      if (!d) throw new Error(`No encuentro la foto ${archivo}`);
      return d.split(",")[1];
    }
    const c = cfg();
    const r = await fetch(`https://api.github.com/repos/${c.owner}/${c.dataRepo}/contents/${c.fotosCatalogoPath}/${encodeURIComponent(archivo)}?ref=${c.branch}`,
      { headers: global.ghHeaders() });
    if (!r.ok) throw new Error(`GitHub ${r.status} al leer la foto ${archivo}`);
    const j = await r.json();
    if (!j.content) throw new Error(`La foto ${archivo} es demasiado grande (más de 1 MB)`);
    return j.content.replace(/\n/g, "");
  }

  async function hidratarFotos(raiz) {
    for (const img of (raiz || document).querySelectorAll("img[data-privada]")) {
      const archivo = img.dataset.privada;
      try {
        if (!cacheFotos.has(archivo)) {
          const b64 = await base64FotoPrivada(archivo);
          const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
          cacheFotos.set(archivo, URL.createObjectURL(new Blob([bin], { type: "image/jpeg" })));
        }
        img.src = cacheFotos.get(archivo);
        img.removeAttribute("data-privada");
      } catch (e) {
        img.title = e.message;
      }
    }
  }

  /**
   * Achica la foto en el navegador antes de subirla: 1600 px de lado mayor,
   * JPEG al 82%. Una foto de celular pesa 4–8 MB; así queda en ~300 KB, que es
   * lo que hacía a mano tools/optimize_images.py en el repo de la web.
   */
  function comprimir(file) {
    return new Promise((ok, mal) => {
      const img = new Image();
      img.onload = () => {
        const lado = 1600;
        const k = Math.min(1, lado / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k);
        cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(img.src);
        ok(cv.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => mal(new Error(`No se pudo leer ${file.name} como imagen`));
      img.src = URL.createObjectURL(file);
    });
  }

  // ==========================================================================
  // Guardado
  // ==========================================================================

  function ctx() {
    return { catalogo: items(), rol: rol(), usuario: usuario() };
  }

  async function guardarItem(registro, mensaje) {
    const normalizado = E.ENTIDADES.catalogo.normalizar({ ...registro, actualizado: E.hoy() });
    const anterior = items().find((x) => x.id === normalizado.id) || null;
    try {
      R.validar("catalogo", anterior ? "editar" : "crear", normalizado, anterior, ctx());
    } catch (e) {
      global.toast(e.sugerencia ? `${e.message} — ${e.sugerencia}` : e.message, true, true);
      return null;
    }
    global.state.catalogo = [...items().filter((x) => x.id !== normalizado.id), normalizado];
    await global.persist(mensaje, "catalogo", normalizado);
    return normalizado;
  }

  /** Guarda muchos ítems en una sola escritura (importación, auditoría, publicación). */
  async function guardarTodos(mensaje) {
    await global.persist(mensaje, "catalogo");
  }

  // ==========================================================================
  // Listado
  // ==========================================================================

  const filtro = { texto: "", tipo: "", disponibilidad: "", procedencia: "", auditoria: "", web: "" };

  function renderCatalogo() {
    const el = document.getElementById("view-catalogo");
    const res = CAT.resumen(items());
    const vacio = !items().length;

    el.innerHTML = `
      <div class="kicker">Partes y equipos a la venta</div>
      <div class="page-head">
        <h1>Catá<span class="accent">logo</span></h1>
        <div style="display:flex; gap:8px; flex-wrap:wrap">
          ${puedeEditar() ? `<a class="btn primary" href="#catform/new">+ Nuevo ítem</a>` : ""}
          ${puedePublicar() ? `<a class="btn" href="#catpublicar">Publicar en la web</a>` : ""}
        </div>
      </div>

      ${vacio ? `<div class="card">
        <h3>El catálogo está vacío</h3>
        <p class="muted" style="max-width:68ch">
          Hoy la web muestra lo que se cargó en SharePoint. Podés traer esas piezas acá
          para seguir administrándolas desde la app: entran como <b>pendientes de auditoría</b>
          y la web no cambia hasta que publiques.
        </p>
        ${puedeEditar() ? `<p style="margin-top:12px">
          <button class="btn primary" onclick="catImportarDesdeWeb()">Importar el catálogo actual de la web</button>
        </p>` : ""}
      </div>` : `

      <div class="grid-kpi" style="margin-bottom:18px">
        <div class="kpi"><div class="label">En la web</div><div class="num num-lg">${res.enWeb}</div>
          <div class="sub">de ${res.total} cargados</div></div>
        <div class="kpi"><div class="label">Stock propio</div><div class="num num-lg">${res.enStock}</div>
          <div class="sub">disponible ya</div></div>
        <div class="kpi"><div class="label">A pedido</div><div class="num num-lg">${res.aPedido}</div>
          <div class="sub">se consigue a terceros</div></div>
        <div class="kpi${res.pendientes ? " warn" : ""}"><div class="label">Sin auditar</div>
          <div class="num num-lg">${res.pendientes}</div>
          <div class="sub">${res.pendientes ? `<a href="#catauditoria">revisar</a>` : "todo confirmado"}</div></div>
        <div class="kpi"><div class="label">Publicados sin foto</div><div class="num num-lg">${res.sinFoto}</div>
          <div class="sub">se ven con un ícono genérico</div></div>
      </div>

      <div class="table-tools">
        <input type="search" id="catQ" placeholder="Buscar ref, nombre, marca, N° de parte…" value="${esc(filtro.texto)}" />
        <select id="catTipo"><option value="">Partes y equipos</option>${opciones(E.CATALOGO_TIPO, filtro.tipo)}</select>
        <select id="catDisp"><option value="">Toda disponibilidad</option>${opciones(E.CATALOGO_DISPONIBILIDAD, filtro.disponibilidad, CAT.DISPONIBILIDAD_TEXTO)}</select>
        <select id="catProc"><option value="">Propios y de terceros</option>${opciones(E.CATALOGO_PROCEDENCIA, filtro.procedencia)}</select>
        <select id="catWeb"><option value="">En la web o no</option>
          <option value="si"${filtro.web === "si" ? " selected" : ""}>Solo en la web</option>
          <option value="no"${filtro.web === "no" ? " selected" : ""}>Solo fuera de la web</option></select>
        <span class="muted" style="font-size:13px" id="catCuenta"></span>
      </div>
      <div class="overflow"><table class="data">
        <thead><tr><th style="width:52px"></th><th>Ref</th><th>Ítem</th><th>Condición</th>
          <th>Disponibilidad</th><th class="num">Precio</th><th>Web</th></tr></thead>
        <tbody id="catFilas"></tbody>
      </table></div>`}`;

    if (vacio) return;
    const enlazar = (id, campo, ev = "onchange") => {
      document.getElementById(id)[ev] = (e) => { filtro[campo] = e.target.value; filas(); };
    };
    enlazar("catQ", "texto", "oninput");
    enlazar("catTipo", "tipo");
    enlazar("catDisp", "disponibilidad");
    enlazar("catProc", "procedencia");
    enlazar("catWeb", "web");
    filas();
  }

  /** Solo el cuerpo de la tabla: re-renderizar todo le sacaba el foco al buscador. */
  function filas() {
    const lista = CAT.filtrar(items(), filtro);
    document.getElementById("catCuenta").textContent = `${lista.length} de ${items().length}`;
    const tb = document.getElementById("catFilas");
    tb.innerHTML = lista.map((x) => `<tr onclick="location.hash='catform/${esc(x.id)}'">
      <td>${x.fotos.length ? imgFoto(x.fotos[0]) : `<span class="cat-thumb cat-sinfoto"></span>`}</td>
      <td><b>${esc(x.ref)}</b>${x.tipo === "Equipo" ? `<br><span class="pill-modal">Equipo</span>` : ""}</td>
      <td>${esc(x.nombre)}<br><span class="muted" style="font-size:12px">${esc(
        [x.marca, x.modeloCompatible, x.nroParte && `N° ${x.nroParte}`].filter(Boolean).join(" · "))}</span></td>
      <td>${esc(CAT.CONDICION_TEXTO[x.condicion])}</td>
      <td>${badgeDisp(x.disponibilidad)}${x.procedencia === "Terceros" ? ` <span class="muted" style="font-size:12px">terceros</span>` : ""}
        ${x.auditoria.estado === "Pendiente" ? `<br><span class="badge por_vencer">sin auditar</span>` : ""}</td>
      <td class="num">${precioTxt(x)}</td>
      <td>${CAT.esPublicable(x) ? "✓" : `<span class="muted">—</span>`}</td>
    </tr>`).join("") || `<tr><td colspan="7" class="empty">Sin resultados</td></tr>`;
    hidratarFotos(tb);
  }

  // ==========================================================================
  // Ficha
  // ==========================================================================

  /** Ítem que se está editando, con las fotos que se van subiendo. */
  let borrador = null;

  function renderCatForm(id) {
    const el = document.getElementById("view-catform");
    const existente = id && id !== "new" ? items().find((x) => x.id === id) : null;
    if (id && id !== "new" && !existente) { global.go("catalogo"); return; }
    borrador = existente
      ? structuredClone(existente)
      : E.ENTIDADES.catalogo.normalizar({ ref: CAT.proximaRef(items(), "AR"), usuario: usuario() });
    const d = borrador;
    const soloLectura = !puedeEditar();
    const refFija = d.fotos.some((f) => f.publicada && !CAT.esUrl(f.archivo));

    el.innerHTML = `
      <a href="#catalogo" class="muted">← Catálogo</a>
      <div class="page-head" style="margin-top:8px">
        <h1>${existente ? esc(d.ref) : `Nuevo <span class="accent">ítem</span>`}</h1>
        ${existente && d.auditoria.estado === "Pendiente" ? `<span class="badge por_vencer">Pendiente de auditoría</span>` : ""}
      </div>

      <fieldset ${soloLectura ? "disabled" : ""} style="border:0; padding:0; margin:0">
      <div class="card">
        <h3>Lo que se ve en la web</h3>
        <div class="form-grid">
          <div class="field"><label for="cRef">Referencia</label>
            <input id="cRef" value="${esc(d.ref)}" ${refFija ? "readonly" : ""} />
            <p class="muted" style="font-size:12px; margin:4px 0 0">${refFija
              ? "Ya tiene fotos en la web: no se puede cambiar."
              : "Es la que el cliente manda por WhatsApp. NX-XX para lo que se consigue a terceros."}</p></div>
          <div class="field"><label for="cPais">Ubicación</label>
            <select id="cPais" onchange="catSugerirRef()">${opciones(E.PAIS, d.pais, E.PAIS_NOMBRE)}</select></div>
        </div>
        <div class="field"><label for="cNombre">Nombre</label>
          <input id="cNombre" value="${esc(d.nombre)}" placeholder="Bobina de cabeza 8 canales" /></div>
        <div class="form-grid">
          <div class="field"><label for="cTipo">Tipo</label>
            <select id="cTipo">${opciones(E.CATALOGO_TIPO, d.tipo)}</select></div>
          <div class="field"><label for="cCategoria">Categoría</label>
            <input id="cCategoria" value="${esc(d.categoria)}" list="catCategorias" placeholder="Bobina, Amplificador, Coldhead…" />
            <datalist id="catCategorias">${[...new Set(items().map((x) => x.categoria).filter(Boolean))].sort()
              .map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="cModalidad">Modalidad</label>
            <select id="cModalidad">${opciones(["", "MRI", "CT"], d.modalidad, { "": "—" })}</select></div>
          <div class="field"><label for="cMarca">Marca</label>
            <input id="cMarca" value="${esc(d.marca)}" placeholder="GE, Philips, Siemens…" /></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="cModelo">Modelo compatible</label>
            <input id="cModelo" value="${esc(d.modeloCompatible)}" /></div>
          <div class="field"><label for="cNroParte">N° de parte</label>
            <input id="cNroParte" value="${esc(d.nroParte)}" /></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="cCondicion">Condición</label>
            <select id="cCondicion">${opciones(E.CATALOGO_CONDICION, d.condicion, CAT.CONDICION_TEXTO)}</select></div>
          <div class="field"><label for="cDisp">Disponibilidad</label>
            <select id="cDisp">${opciones(E.CATALOGO_DISPONIBILIDAD, d.disponibilidad, CAT.DISPONIBILIDAD_TEXTO)}</select>
            <p class="muted" style="font-size:12px; margin:4px 0 0">En la web solo se muestran «En stock» y «A pedido».</p></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="cPrecio">Precio (USD)</label>
            <input id="cPrecio" type="number" min="0" step="50" value="${d.precio ?? ""}" placeholder="vacío = Consultar" /></div>
          <div class="field"><label for="cGarantia">Garantía (días)</label>
            <input id="cGarantia" type="number" min="0" step="30" value="${d.garantiaDias ?? ""}" placeholder="vacío = no se informa" /></div>
        </div>
        <div class="field"><label for="cDesc">Descripción</label>
          <textarea id="cDesc" rows="3">${esc(d.descripcion)}</textarea></div>
        <label style="display:flex; gap:8px; align-items:center; margin-top:12px">
          <input type="checkbox" id="cWeb" ${d.publicarWeb ? "checked" : ""} /> Mostrar en nexolibre.com
        </label>
        <label style="display:flex; gap:8px; align-items:center; margin-top:6px" class="muted">
          <input type="checkbox" id="cDotmed" ${d.canales.dotmed ? "checked" : ""} />
          Publicar también en DOTmed <span style="font-size:12px">(el bot está en stand-by: se guarda la marca para cuando vuelva)</span>
        </label>
      </div>

      <div class="card">
        <h3>Fotos</h3>
        <p class="muted" style="font-size:13px; margin-top:4px">
          La primera es la principal. Las nuevas se achican antes de subir y quedan en el repo
          privado hasta que publiques.
        </p>
        <div class="cat-fotos" id="cFotos"></div>
        ${soloLectura ? "" : `<label class="btn sm" style="margin-top:10px; display:inline-block">
          + Agregar fotos <input type="file" accept="image/*" multiple hidden onchange="catSubirFotos(this.files)" />
        </label>`}
      </div>

      <div class="card interno">
        <h3>Datos internos <span class="pill-int">no se publican</span></h3>
        <div class="form-grid">
          <div class="field"><label for="cProc">Procedencia</label>
            <select id="cProc">${opciones(E.CATALOGO_PROCEDENCIA, d.procedencia, { Propia: "Propia (en depósito)", Terceros: "Terceros (se consigue a pedido)" })}</select></div>
          <div class="field"><label for="cProveedor">Proveedor</label>
            <input id="cProveedor" value="${esc(d.proveedor)}" /></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="cOrigenUrl">Link de origen</label>
            <input id="cOrigenUrl" value="${esc(d.origenUrl)}" placeholder="publicación de eBay, cotización del proveedor…" /></div>
          <div class="field"><label for="cCosto">Costo (USD)</label>
            <input id="cCosto" type="number" min="0" step="50" value="${d.costo ?? ""}" /></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="cSerie">N° de serie</label>
            <input id="cSerie" value="${esc(d.nroSerie)}" /></div>
          <div class="field"><label for="cCodigo">Código interno</label>
            <input id="cCodigo" value="${esc(d.codigoInterno)}" /></div>
        </div>
        <div class="field"><label for="cUbic">Ubicación física</label>
          <input id="cUbic" value="${esc(d.ubicacionFisica)}" placeholder="Depósito, estante…" /></div>
        <div class="field"><label for="cNotas">Notas</label>
          <textarea id="cNotas" rows="2">${esc(d.notas)}</textarea></div>
        ${existente ? `<p class="muted" style="font-size:12px; margin-top:10px">
          Alta ${esc(d.creado)}${d.origen === "sharepoint" ? " (importado de SharePoint)" : ""} ·
          última edición ${esc(d.actualizado)}${d.auditoria.fecha ? ` · auditado ${esc(d.auditoria.fecha)} por ${esc(d.auditoria.usuario || "—")}` : ""}
        </p>` : ""}
      </div>
      </fieldset>

      ${soloLectura ? "" : `<div style="display:flex; gap:10px; justify-content:flex-end">
        <a class="btn ghost" href="#catalogo">Cancelar</a>
        <button class="btn primary" onclick="catGuardar()">Guardar</button>
      </div>`}`;
    pintarFotos();
  }

  function pintarFotos() {
    const cont = document.getElementById("cFotos");
    if (!cont) return;
    const editable = puedeEditar();
    cont.innerHTML = borrador.fotos.map((f, i) => `<div class="cat-foto">
        ${imgFoto(f, "cat-foto-img")}
        <div class="cat-foto-pie">
          ${i === 0 ? `<b>Principal</b>` : (editable ? `<button class="btn sm ghost" onclick="catFotoPrincipal(${i})">Principal</button>` : "")}
          ${editable ? `<button class="btn sm ghost" title="Quitar" onclick="catQuitarFoto(${i})">✕</button>` : ""}
        </div>
        <div class="muted" style="font-size:11px">${f.publicada || CAT.esUrl(f.archivo) ? "en la web" : "sin publicar"}</div>
      </div>`).join("") || `<p class="muted">Sin fotos.</p>`;
    hidratarFotos(cont);
  }

  /** Lee el formulario sobre el borrador. */
  function leerForm() {
    const v = (id) => document.getElementById(id).value.trim();
    Object.assign(borrador, {
      ref: v("cRef").toUpperCase(), pais: v("cPais"), nombre: v("cNombre"), tipo: v("cTipo"),
      categoria: v("cCategoria"), modalidad: v("cModalidad"), marca: v("cMarca"),
      modeloCompatible: v("cModelo"), nroParte: v("cNroParte"), condicion: v("cCondicion"),
      disponibilidad: v("cDisp"), precio: v("cPrecio"), garantiaDias: v("cGarantia"),
      descripcion: v("cDesc"), publicarWeb: document.getElementById("cWeb").checked,
      canales: { ...borrador.canales, dotmed: document.getElementById("cDotmed").checked },
      procedencia: v("cProc"), proveedor: v("cProveedor"), origenUrl: v("cOrigenUrl"),
      costo: v("cCosto"), nroSerie: v("cSerie"), codigoInterno: v("cCodigo"),
      ubicacionFisica: v("cUbic"), notas: v("cNotas"),
    });
    return borrador;
  }

  /** Al cambiar de país en un ítem nuevo, la ref sigue la serie de ese país. */
  function catSugerirRef() {
    const esNuevo = !items().some((x) => x.id === borrador.id);
    const ref = document.getElementById("cRef");
    if (esNuevo && /^NX-[A-Z]{2}-\d+$/.test(ref.value) && !borrador.fotos.length) {
      ref.value = CAT.proximaRef(items(), document.getElementById("cPais").value);
    }
  }

  /**
   * Nombres de archivo que ya existen en assets/parts/ de la web. Sin esto,
   * un ítem nuevo cargado con una ref que la web ya usaba (por ejemplo antes
   * de importar) subía NX-AR-003-1.jpg y pisaba la foto de otra pieza.
   */
  let fotosEnWeb = null;
  async function nombresOcupados() {
    if (!fotosEnWeb) {
      fotosEnWeb = [];
      try {
        const w = cfg().web;
        const r = await fetch(`https://api.github.com/repos/${w.owner}/${w.repo}/contents/${w.fotosDir}?ref=${w.branch}`);
        if (r.ok) fotosEnWeb = (await r.json()).map((x) => x.name);
      } catch { /* sin la lista se usa solo lo que conoce el catálogo */ }
    }
    return [...fotosEnWeb, ...items().flatMap((x) => x.fotos.map((f) => f.archivo)), ...borrador.fotos.map((f) => f.archivo)];
  }

  async function catSubirFotos(files) {
    leerForm();
    if (!R.REF_CATALOGO.test(borrador.ref)) {
      global.toast("Primero poné una referencia válida (NX-AR-001): las fotos se nombran con ella", true, true);
      return;
    }
    for (const file of files) {
      try {
        const dataUrl = await comprimir(file);
        const archivo = CAT.nombreFoto(borrador.ref, await nombresOcupados());
        if (conectado()) {
          await global.ghUploadFile(`${cfg().fotosCatalogoPath}/${archivo}`, dataUrl.split(",")[1],
            `Foto ${archivo} (catálogo, sin publicar)`);
        } else {
          try { localStorage.setItem(LS_FOTO_DEMO + archivo, dataUrl); } catch {
            throw new Error("El navegador no tiene lugar para más fotos de prueba");
          }
        }
        cacheFotos.set(archivo, dataUrl);
        borrador.fotos.push({ archivo, publicada: false });
        pintarFotos();
      } catch (e) {
        global.toast(e.message, true, true);
      }
    }
    global.toast("Fotos cargadas. Guardá el ítem para no perderlas.");
  }

  function catQuitarFoto(i) {
    leerForm();
    borrador.fotos.splice(i, 1);
    pintarFotos();
  }

  function catFotoPrincipal(i) {
    leerForm();
    const [f] = borrador.fotos.splice(i, 1);
    borrador.fotos.unshift(f);
    pintarFotos();
  }

  async function catGuardar() {
    const reg = leerForm();
    const ok = await guardarItem(reg, `Catálogo ${reg.ref} · ${reg.nombre}`);
    if (ok) {
      global.toast("Guardado. La web cambia recién cuando publiques.");
      global.go("catalogo");
    }
  }

  // ==========================================================================
  // Importación desde la web
  // ==========================================================================

  async function leerPartsPublicado() {
    const r = await fetch(`${cfg().web.sitio}/parts.json?v=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`No se pudo leer el catálogo de la web (${r.status})`);
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  }

  async function catImportarDesdeWeb() {
    try {
      const parts = await leerPartsPublicado();
      const { nuevos, omitidos } = CAT.importar(parts, items(), { usuario: usuario() });
      if (!nuevos.length) {
        global.toast(`No hay nada nuevo para importar (${omitidos.length} ya estaban)`);
        return;
      }
      const terceros = nuevos.filter((x) => x.procedencia === "Terceros").length;
      if (!confirm(`Se van a importar ${nuevos.length} piezas de la web` +
        (omitidos.length ? ` (${omitidos.length} ya estaban y se saltean)` : "") + `.\n\n` +
        `${terceros} vienen de oportunidades de terceros (eBay).\n` +
        `Todas entran como pendientes de auditoría. La web no cambia hasta que publiques.`)) return;
      global.state.catalogo = [...items(), ...nuevos];
      await guardarTodos(`Importa ${nuevos.length} piezas del catálogo de la web (SharePoint)`);
      global.toast(`Importadas ${nuevos.length} piezas`);
      global.go("catauditoria");
    } catch (e) {
      global.toast(e.message, true, true);
    }
  }

  // ==========================================================================
  // Auditoría
  // ==========================================================================

  /** Decisiones marcadas y todavía no guardadas: id → stock | pedido | baja. */
  const decisiones = new Map();
  /** Datos que trae una auditoría externa: id → { origenUrl, nota }. */
  const extrasAud = new Map();
  let filtroAud = "Terceros";

  const DECISION_TEXTO = { stock: "En stock", pedido: "A pedido", baja: "Ya no está" };

  function renderCatAuditoria() {
    const el = document.getElementById("view-catauditoria");
    const pendientes = items().filter((x) => x.auditoria.estado === "Pendiente");
    const lista = pendientes.filter((x) => !filtroAud || x.procedencia === filtroAud)
      .sort((a, b) => a.ref.localeCompare(b.ref, "es", { numeric: true }));
    const cuenta = (p) => pendientes.filter((x) => !p || x.procedencia === p).length;
    const editable = puedeEditar();

    el.innerHTML = `
      <div class="kicker">Catálogo</div>
      <div class="page-head">
        <h1>Audi<span class="accent">toría</span></h1>
        ${editable && decisiones.size ? `<button class="btn primary" onclick="catGuardarAuditoria()">
          Guardar ${decisiones.size} decisión${decisiones.size === 1 ? "" : "es"}</button>` : ""}
      </div>
      <p class="muted" style="max-width:75ch; margin-top:-8px">
        Lo que vino de SharePoint, para confirmar qué sigue disponible. Las piezas de terceros
        salieron de oportunidades de eBay: el botón <b>Buscar en eBay</b> abre la búsqueda para
        ver si todavía se consigue. <b>Ya no está</b> no borra el ítem: lo da de baja y lo saca
        de la web en la próxima publicación.
      </p>

      ${!pendientes.length ? `<div class="card"><h3>No queda nada por auditar</h3>
        <p class="muted">Todo el catálogo está confirmado.${puedePublicar() ? ` Cuando quieras, <a href="#catpublicar">publicá</a>.` : ""}</p></div>` : `
      <div class="table-tools">
        <select id="audProc">
          <option value="Terceros"${filtroAud === "Terceros" ? " selected" : ""}>De terceros (${cuenta("Terceros")})</option>
          <option value="Propia"${filtroAud === "Propia" ? " selected" : ""}>Propios (${cuenta("Propia")})</option>
          <option value=""${!filtroAud ? " selected" : ""}>Todos (${cuenta("")})</option>
        </select>
        ${editable ? `<label class="btn sm ghost" title="Planilla con columnas ref, resultado, link, precio_usd, nota">
          Cargar resultado (CSV) <input type="file" accept=".csv,text/csv" hidden onchange="catCargarAuditoria(this.files[0])" /></label>
          <label class="muted" style="font-size:13px; display:flex; gap:6px; align-items:center">
            <input type="checkbox" id="audDup" checked /> dar de baja duplicados</label>` : ""}
        ${decisiones.size ? `<span class="muted" style="font-size:13px">${decisiones.size} marcada(s) sin guardar</span>` : ""}
      </div>
      <div class="overflow"><table class="data">
        <thead><tr><th style="width:52px"></th><th>Ref</th><th>Ítem</th><th>Hoy figura</th><th>Decisión</th></tr></thead>
        <tbody>${lista.map((x) => {
          const dec = decisiones.get(x.id);
          const btn = (k) => `<button class="btn sm${dec === k ? " primary" : " ghost"}" onclick="catDecidir('${esc(x.id)}','${k}')">${DECISION_TEXTO[k]}</button>`;
          return `<tr>
            <td>${x.fotos.length ? imgFoto(x.fotos[0]) : `<span class="cat-thumb cat-sinfoto"></span>`}</td>
            <td><a href="#catform/${esc(x.id)}"><b>${esc(x.ref)}</b></a></td>
            <td>${esc(x.nombre)}<br>
              <a class="muted" style="font-size:12px" target="_blank" rel="noopener"
                href="https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent([x.nroParte, x.nombre].filter(Boolean).join(" ").slice(0, 120))}">Buscar en eBay ↗</a></td>
            <td>${badgeDisp(x.disponibilidad)}<br><span class="muted" style="font-size:12px">${precioTxt(x)}</span></td>
            <td style="white-space:nowrap">${editable ? btn("stock") + " " + btn("pedido") + " " + btn("baja") : "—"}
              ${extrasAud.get(x.id) ? `<div class="muted" style="font-size:12px; white-space:normal; max-width:340px; margin-top:4px">
                ${esc(extrasAud.get(x.id).nota)}${extrasAud.get(x.id).origenUrl
                  ? ` · <a target="_blank" rel="noopener" href="${esc(extrasAud.get(x.id).origenUrl)}">ver aviso ↗</a>` : ""}</div>` : ""}</td>
          </tr>`;
        }).join("") || `<tr><td colspan="5" class="empty">Nada pendiente en este grupo</td></tr>`}</tbody>
      </table></div>`}`;

    const sel = document.getElementById("audProc");
    if (sel) sel.onchange = (e) => { filtroAud = e.target.value; renderCatAuditoria(); };
    hidratarFotos(el);
  }

  /**
   * Carga una auditoría hecha afuera (por ejemplo, la revisión de los avisos
   * de eBay) y deja las decisiones marcadas. No guarda: hay que revisar y
   * apretar Guardar, como si se hubieran marcado a mano.
   */
  async function catCargarAuditoria(file) {
    if (!file) return;
    try {
      const filas = CAT.leerCsv(await file.text());
      const dup = document.getElementById("audDup")?.checked;
      const { plan, omitidas } = CAT.planDesdeAuditoria(filas, items(), { bajaDuplicados: dup });
      for (const [id, p] of plan) {
        decisiones.set(id, p.decision);
        extrasAud.set(id, { origenUrl: p.origenUrl, nota: p.nota });
      }
      const n = (d) => [...plan.values()].filter((p) => p.decision === d).length;
      global.toast(`Marcadas ${plan.size}: ${n("pedido")} a pedido · ${n("baja")} de baja` +
        (omitidas.length ? ` · ${omitidas.length} ref(s) que no están en el catálogo` : "") +
        ". Revisá y guardá.");
      filtroAud = "";
    } catch (e) {
      global.toast(`No se pudo leer el CSV: ${e.message}`, true, true);
    }
    renderCatAuditoria();
  }

  function catDecidir(id, decision) {
    if (decisiones.get(id) === decision) decisiones.delete(id);
    else decisiones.set(id, decision);
    renderCatAuditoria();
  }

  /** Todas las decisiones en una sola escritura: auditar 100 piezas no son 100 commits. */
  async function catGuardarAuditoria() {
    const hoy = E.hoy();
    let n = 0;
    global.state.catalogo = items().map((x) => {
      const dec = decisiones.get(x.id);
      if (!dec) return x;
      n++;
      const r = CAT.auditar(x, dec, { usuario: usuario(), hoy });
      const ex = extrasAud.get(x.id);
      if (!ex) return r;
      return {
        ...r,
        origenUrl: ex.origenUrl || r.origenUrl,
        notas: [r.notas, `Auditoría ${hoy}: ${ex.nota}`].filter(Boolean).join("\n"),
      };
    });
    try {
      await guardarTodos(`Auditoría del catálogo: ${n} ítem(s) revisados`);
      decisiones.clear();
      extrasAud.clear();
      global.toast(`Auditoría guardada (${n}). La web cambia cuando publiques.`);
    } catch (e) {
      global.toast(e.message, true, true);
    }
    renderCatAuditoria();
  }

  // ==========================================================================
  // Publicación
  // ==========================================================================

  /** Última lectura del parts.json publicado, para mostrar la diferencia. */
  let publicado = null;

  async function renderCatPublicar() {
    const el = document.getElementById("view-catpublicar");
    const nuevo = CAT.aParts(items());
    const porSubir = CAT.fotosPorSubir(items());
    const res = CAT.resumen(items());

    el.innerHTML = `
      <div class="kicker">Catálogo</div>
      <div class="page-head">
        <h1>Publicar en <span class="accent">la web</span></h1>
        <div style="display:flex; gap:8px; flex-wrap:wrap">
          <button class="btn" onclick="catDescargarParts()">⬇ parts.json</button>
          ${puedePublicar() ? `<button class="btn primary" id="btnPublicar" onclick="catPublicar()">Publicar</button>` : ""}
        </div>
      </div>
      <div class="grid-kpi" style="margin-bottom:18px">
        <div class="kpi"><div class="label">Se publican</div><div class="num num-lg">${nuevo.length}</div>
          <div class="sub">de ${items().length} en el catálogo</div></div>
        <div class="kpi"><div class="label">Fotos nuevas</div><div class="num num-lg">${porSubir.length}</div>
          <div class="sub">pasan del repo privado a la web</div></div>
        <div class="kpi${res.pendientes ? " warn" : ""}"><div class="label">Sin auditar</div><div class="num num-lg">${res.pendientes}</div>
          <div class="sub">${res.pendientes ? `se publican igual · <a href="#catauditoria">auditar</a>` : "todo confirmado"}</div></div>
      </div>
      <div class="card" id="catDiff"><p class="muted">Leyendo lo que hoy muestra nexolibre.com…</p></div>
      ${!puedePublicar() ? `<p class="muted">Publicar lo hacen dirección o admin.</p>` : ""}`;

    try {
      publicado = await leerPartsPublicado();
      const d = CAT.diferencias(publicado, nuevo);
      const lista = (arr, fn) => arr.slice(0, 40).map(fn).join("") +
        (arr.length > 40 ? `<li class="muted">… y ${arr.length - 40} más</li>` : "");
      document.getElementById("catDiff").innerHTML = !d.altas.length && !d.bajas.length && !d.cambios.length && !porSubir.length
        ? `<h3>La web ya está al día</h3><p class="muted">Publicar no cambiaría nada.</p>`
        : `<h3>Qué cambia en nexolibre.com</h3>
          <p class="muted" style="font-size:13px">Hoy la web muestra ${publicado.length} piezas; después de publicar va a mostrar ${nuevo.length}.</p>
          ${d.altas.length ? `<h4 style="margin-top:14px">Aparecen (${d.altas.length})</h4><ul>${lista(d.altas, (p) => `<li><b>${esc(p.ref)}</b> ${esc(p.nombre)}</li>`)}</ul>` : ""}
          ${d.bajas.length ? `<h4 style="margin-top:14px">Dejan de mostrarse (${d.bajas.length})</h4><ul>${lista(d.bajas, (p) => `<li><b>${esc(p.ref)}</b> ${esc(p.nombre)} <span class="muted">· ${esc(p.disponibilidad || "")}</span></li>`)}</ul>` : ""}
          ${d.cambios.length ? `<h4 style="margin-top:14px">Cambian (${d.cambios.length})</h4><ul>${lista(d.cambios, (c) => `<li><b>${esc(c.parte.ref)}</b> ${esc(c.parte.nombre)} <span class="muted">· ${esc(c.campos.join(", "))}</span></li>`)}</ul>` : ""}
          ${porSubir.length ? `<h4 style="margin-top:14px">Fotos que se suben (${porSubir.length})</h4><p class="muted" style="font-size:13px">${esc(porSubir.map((x) => x.foto.archivo).join(" · "))}</p>` : ""}`;
    } catch (e) {
      document.getElementById("catDiff").innerHTML =
        `<p class="muted">No se pudo leer el catálogo publicado: ${esc(e.message)}. Igual podés publicar.</p>`;
    }
  }

  function catDescargarParts() {
    const blob = new Blob([JSON.stringify(CAT.aParts(items()), null, 2) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "parts.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---- API de GitHub sobre el repo de la web ----

  function headersWeb(token) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async function ghWeb(token, ruta, metodo = "GET", cuerpo) {
    const w = cfg().web;
    const r = await fetch(`https://api.github.com/repos/${w.owner}/${w.repo}/${ruta}`, {
      method: metodo, headers: headersWeb(token), body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    if (!r.ok) {
      const err = new Error(`GitHub ${r.status} en ${ruta}: ${(await r.json().catch(() => ({}))).message || r.statusText}`);
      err.status = r.status;
      throw err;
    }
    return r.json();
  }

  async function puedeEscribirWeb(token) {
    try {
      const j = await ghWeb(token, "");
      return Boolean(j.permissions?.push || j.permissions?.admin);
    } catch { return false; }
  }

  /**
   * Token con permiso de escritura sobre el repo de la web.
   *
   * Los tokens fine-grained de GitHub valen para UN dueño: el de la app es de
   * la cuenta que tiene contratos-data, y la web es de la organización
   * Nexolibre. Por eso puede hacer falta un segundo token, que se pide una vez
   * y queda en este navegador, igual que el primero.
   */
  async function tokenWeb() {
    const w = cfg().web;
    for (const t of [localStorage.getItem(LS_PAT_WEB), localStorage.getItem("nexo_pat")]) {
      if (t && await puedeEscribirWeb(t)) return t;
    }
    const nuevo = prompt(
      `Para publicar hace falta un token con permiso de escritura sobre ${w.owner}/${w.repo}.\n\n` +
      `En GitHub → Settings → Developer settings → Fine-grained tokens: dueño "${w.owner}", ` +
      `solo el repo "${w.repo}", permiso Contents: Read and write.\n\n` +
      `Se guarda solo en este navegador. Pegalo acá:`);
    if (!nuevo) return null;
    if (!(await puedeEscribirWeb(nuevo.trim()))) {
      throw new Error(`Ese token no puede escribir en ${w.owner}/${w.repo}`);
    }
    localStorage.setItem(LS_PAT_WEB, nuevo.trim());
    return nuevo.trim();
  }

  /**
   * Publica parts.json y las fotos nuevas en un solo commit.
   *
   * Si alguien empujó a la web entre que leímos la rama y la actualizamos,
   * GitHub rechaza el avance (422) y se rearma todo sobre la versión nueva.
   */
  async function commitWeb(token, archivos, mensaje) {
    const w = cfg().web;
    for (let intento = 1; intento <= 3; intento++) {
      const ref = await ghWeb(token, `git/ref/heads/${w.branch}`);
      const padre = ref.object.sha;
      const commitPadre = await ghWeb(token, `git/commits/${padre}`);
      const arbol = [];
      for (const a of archivos) {
        const blob = await ghWeb(token, "git/blobs", "POST", { content: a.base64, encoding: "base64" });
        arbol.push({ path: a.ruta, mode: "100644", type: "blob", sha: blob.sha });
      }
      const tree = await ghWeb(token, "git/trees", "POST", { base_tree: commitPadre.tree.sha, tree: arbol });
      const commit = await ghWeb(token, "git/commits", "POST", { message: mensaje, tree: tree.sha, parents: [padre] });
      try {
        await ghWeb(token, `git/refs/heads/${w.branch}`, "PATCH", { sha: commit.sha });
        return commit.sha;
      } catch (e) {
        if (e.status !== 422 || intento === 3) throw e;
      }
    }
    throw new Error("No se pudo publicar tras 3 intentos");
  }

  const utf8ABase64 = (texto) => {
    const bytes = new TextEncoder().encode(texto);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  async function catPublicar() {
    if (!puedePublicar()) return;
    const nuevo = CAT.aParts(items());
    const porSubir = CAT.fotosPorSubir(items());
    const d = publicado ? CAT.diferencias(publicado, nuevo) : null;
    const resumen = d ? `${d.altas.length} aparecen · ${d.bajas.length} dejan de mostrarse · ${d.cambios.length} cambian`
      : `${nuevo.length} piezas`;

    if (!conectado()) {
      global.toast("Modo demo: no se publica. Podés bajar el parts.json para revisarlo.", true, true);
      return;
    }
    if (!confirm(`Publicar en nexolibre.com\n\n${resumen}\n${porSubir.length} foto(s) nueva(s)\n\n` +
      `La web se actualiza en uno o dos minutos.`)) return;

    const btn = document.getElementById("btnPublicar");
    if (btn) { btn.disabled = true; btn.textContent = "Publicando…"; }
    try {
      const token = await tokenWeb();
      if (!token) return;
      const w = cfg().web;
      const archivos = [{ ruta: w.partsPath, base64: utf8ABase64(JSON.stringify(nuevo, null, 2) + "\n") }];
      for (const { foto } of porSubir) {
        archivos.push({ ruta: `${w.fotosDir}/${foto.archivo}`, base64: await base64FotoPrivada(foto.archivo) });
      }
      const sha = await commitWeb(token, archivos,
        `Actualización del catálogo desde contratos-app (${nuevo.length} piezas)\n\n` +
        `Publicado por ${usuario() || "la app"}. ${resumen}.`);

      // Las fotos subidas pasan a servirse desde la web.
      if (porSubir.length) {
        const subidas = new Set(porSubir.map((x) => x.foto.archivo));
        global.state.catalogo = items().map((x) => ({
          ...x, fotos: x.fotos.map((f) => (subidas.has(f.archivo) ? { ...f, publicada: true } : f)),
        }));
        await guardarTodos(`Catálogo publicado en la web (${sha.slice(0, 7)})`);
      }
      global.toast(`Publicado (${sha.slice(0, 7)}). La web se actualiza en uno o dos minutos.`);
    } catch (e) {
      global.toast(`No se publicó: ${e.message}`, true, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Publicar"; }
    }
    renderCatPublicar();
  }

  // ==========================================================================

  global.NEXO_VISTAS = global.NEXO_VISTAS || {};
  Object.assign(global.NEXO_VISTAS, {
    catalogo: renderCatalogo,
    catform: () => renderCatForm(location.hash.split("/")[1]),
    catauditoria: renderCatAuditoria,
    catpublicar: renderCatPublicar,
  });

  Object.assign(global, {
    catImportarDesdeWeb, catGuardar, catSubirFotos, catQuitarFoto, catFotoPrincipal, catSugerirRef,
    catDecidir, catGuardarAuditoria, catCargarAuditoria, catPublicar, catDescargarParts,
  });
})(typeof window !== "undefined" ? window : globalThis);
