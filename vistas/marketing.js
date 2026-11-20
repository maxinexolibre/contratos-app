/**
 * Área de Marketing: campañas, estrategias, leads y comparativa de canales.
 *
 * Construida directamente sobre el núcleo v3 — no hay forma vieja que traducir
 * porque estas entidades no existían antes. Es donde el núcleo se usa como se
 * pensó: el esquema normaliza, las reglas validan, el motor de KPIs calcula.
 *
 * Decisiones que se ven en la pantalla:
 *
 * - El canal vive en el LEAD, no en la campaña. Una campaña multicanal no
 *   permite atribuir costo por lead si el canal está solo arriba.
 * - Los leads se deduplican por email dentro de la campaña. Contar dos veces
 *   el mismo contacto baja artificialmente el costo por lead.
 * - Una campaña no se cierra con estrategias abiertas (R5).
 * - El ROI de una campaña más nueva que el ciclo de venta se marca como
 *   parcial: si no, toda campaña recién lanzada parece un fracaso.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;
  const R = global.NEXO_REGLAS;
  const K = global.NEXO_KPI;
  const AD = global.NEXO_ADAPTADOR;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n, d = 0) => n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pctTxt = (v) => (v === null || v === undefined ? "—" : `${num(v, 1)}%`);
  const SIM = { USD: "US$", ARS: "$", CLP: "CLP$", UF: "UF" };
  const money = (v, m = "USD") => v === null ? "—" : `${SIM[m] || m} ${num(v, 0)}`;

  const campanas = () => global.state?.campanas || [];
  const estrategias = () => global.state?.estrategias || [];
  const leads = () => global.state?.leads || [];

  /** Contexto completo en modelo nuevo, para el motor de KPIs. */
  function ctx() {
    const n = AD.estadoANuevo(global.state || {});
    return {
      ...n,
      campanas: campanas(), estrategias: estrategias(), leads: leads(),
    };
  }

  const rol = () => global.state?.rol || "admin";

  /** Guarda validando contra las reglas. Devuelve true si se escribió. */
  async function guardar(entidad, registro, mensaje) {
    const c = ctx();
    const normalizado = E.ENTIDADES[entidad].normalizar(registro);
    const anterior = (global.state[entidad] || []).find((x) => x.id === normalizado.id) || null;
    try {
      R.validar(entidad, anterior ? "editar" : "crear", normalizado, anterior,
        { ...c, rol: rol(), usuario: global.state?.user || "" });
    } catch (e) {
      global.toast(e.sugerencia ? `${e.message} — ${e.sugerencia}` : e.message, true);
      return false;
    }
    const resto = (global.state[entidad] || []).filter((x) => x.id !== normalizado.id);
    global.state[entidad] = [...resto, normalizado];
    await global.persist(mensaje, entidad);
    return true;
  }

  // ==========================================================================
  // Tablero
  // ==========================================================================

  function renderMkTablero() {
    const c = ctx();
    const filas = K.porCampana(campanas(), c);
    const activas = filas.filter((f) => f.estado === "Activa");
    const ld = leads();

    const inversion = filas.reduce((s, f) => s + f.inversion, 0);
    const totLeads = ld.length;
    const convertidos = ld.filter((l) => l.ticketId).length;
    const cpl = totLeads ? E.money(inversion / totLeads) : null;

    const vacio = !campanas().length;

    document.getElementById("view-mktablero").innerHTML = `
      <div class="kicker">Panel general</div>
      <h1>Tablero de <span class="hl">marketing</span></h1>

      ${vacio ? `<div class="card" style="margin-top:18px">
        <h3>Todavía no hay campañas cargadas</h3>
        <p class="muted" style="max-width:65ch">
          Los indicadores de marketing —ROI, costo por lead, conversión— se calculan
          sobre campañas, estrategias y leads. Sin esos datos las métricas dan cero,
          que no es lo mismo que dar mal: simplemente no hay nada que medir todavía.
        </p>
        <p style="margin-top:12px">
          <a class="btn primary" href="#campform">Crear la primera campaña</a>
        </p>
      </div>` : `
      <div class="grid-kpi" style="margin:18px 0">
        <div class="kpi">
          <div class="label">Campañas activas</div>
          <div class="num num-lg">${activas.length}</div>
          <div class="sub">de ${campanas().length} en total</div>
        </div>
        <div class="kpi">
          <div class="label">Inversión ejecutada</div>
          <div class="num num-md">${money(inversion)}</div>
          <div class="sub">suma de estrategias</div>
        </div>
        <div class="kpi">
          <div class="label">Leads</div>
          <div class="num num-lg">${totLeads}</div>
          <div class="sub">${convertidos} convertidos en ticket</div>
        </div>
        <div class="kpi">
          <div class="label">Costo por lead</div>
          <div class="num num-md">${cpl === null ? "—" : money(cpl)}</div>
          <div class="sub">inversión / leads</div>
        </div>
        <div class="kpi">
          <div class="label">Lead → ticket</div>
          <div class="num num-lg">${pctTxt(K.pct(convertidos, totLeads))}</div>
          <div class="sub">${convertidos} de ${totLeads}</div>
        </div>
      </div>

      <div class="card">
        <h3>Campañas vs. ventas</h3>
        ${tablaCampanas(filas)}
      </div>`}
    `;
  }

  function tablaCampanas(filas) {
    if (!filas.length) return `<p class="muted">Sin campañas.</p>`;
    return `<div style="overflow-x:auto"><table class="data">
      <thead><tr>
        <th>Campaña</th><th>Estado</th><th class="num">Inversión</th>
        <th class="num">Leads</th><th class="num">Tickets</th><th class="num">Contratos</th>
        <th class="num">Ingresos</th><th class="num">CPL</th><th class="num">CAC</th><th class="num">ROI</th>
      </tr></thead>
      <tbody>${filas.map((f) => `<tr onclick="location.hash='campdetalle/${esc(f.id)}'">
        <td><b>${esc(f.nombre)}</b><br><span class="muted" style="font-size:12px">${f.canales.map(esc).join(" · ")}</span></td>
        <td><span class="pill">${esc(f.estado)}</span></td>
        <td class="num">${money(f.inversion, f.moneda)}</td>
        <td class="num">${f.leads}</td>
        <td class="num">${f.tickets}</td>
        <td class="num">${f.contratos}</td>
        <td class="num">${K.textoMonedas(f.ingresos)}</td>
        <td class="num">${f.costoPorLead === null ? "—" : money(f.costoPorLead, f.moneda)}</td>
        <td class="num">${f.cac === null ? "—" : money(f.cac, f.moneda)}</td>
        <td class="num"><b>${pctTxt(f.roi)}</b>${f.roiParcial ? ` <span class="muted" title="La campaña es más nueva que el ciclo de venta: todavía puede subir">parcial</span>` : ""}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    <p class="muted" style="font-size:13px; margin-top:10px">
      El ROI compara ingresos con inversión en la misma moneda. Las campañas marcadas
      como <b>parciales</b> son más nuevas que el ciclo de venta: su ROI todavía puede subir.
    </p>`;
  }

  // ==========================================================================
  // Campañas
  // ==========================================================================

  function renderCampanas() {
    const filas = K.porCampana(campanas(), ctx());
    document.getElementById("view-campanas").innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap">
        <div style="flex:1">
          <div class="kicker">Marketing</div>
          <h1>Cam<span class="hl">pañas</span></h1>
        </div>
        <a class="btn primary" href="#campform">+ Nueva campaña</a>
      </div>
      <div style="margin-top:18px">${tablaCampanas(filas)}</div>
    `;
  }

  function renderCampDetalle(id) {
    const c = campanas().find((x) => x.id === id);
    if (!c) { global.go("campanas"); return; }
    const m = K.porCampana([c], ctx())[0];
    const est = estrategias().filter((e) => e.campanaId === id);
    const ld = leads().filter((l) => l.campanaId === id);
    const pendientes = est.filter((e) => !["Finalizada", "Cancelada"].includes(e.estado));

    document.getElementById("view-campdetalle").innerHTML = `
      <a href="#campanas" class="muted">← Campañas</a>
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:8px">
        <div style="flex:1">
          <div class="kicker">${esc(c.canales.join(" · "))}</div>
          <h1>${esc(c.nombre)}</h1>
        </div>
        <a class="btn ghost" href="#campform/${esc(c.id)}">Editar</a>
        ${c.estado === "Activa" ? `<button class="btn primary" onclick="finalizarCampana('${esc(c.id)}')">Finalizar campaña</button>` : ""}
      </div>

      <div class="grid-kpi" style="margin:18px 0">
        <div class="kpi"><div class="label">Inversión</div><div class="num num-md">${money(m.inversion, c.moneda)}</div><div class="sub">de ${money(c.presupuestoAsignado, c.moneda)} · ${pctTxt(m.ejecucionPct)}</div></div>
        <div class="kpi"><div class="label">Leads</div><div class="num num-lg">${m.leads}</div><div class="sub">${m.leadsCalificados} calificados</div></div>
        <div class="kpi"><div class="label">Contratos</div><div class="num num-lg">${m.contratos}</div><div class="sub">de ${m.tickets} tickets</div></div>
        <div class="kpi"><div class="label">CAC</div><div class="num num-md">${m.cac === null ? "—" : money(m.cac, c.moneda)}</div><div class="sub">inversión / contratos</div></div>
        <div class="kpi${m.roi !== null && m.roi < 0 ? " warn" : ""}"><div class="label">ROI</div><div class="num num-md">${pctTxt(m.roi)}</div><div class="sub">${m.roiParcial ? "parcial · ciclo en curso" : "sobre inversión"}</div></div>
      </div>

      ${pendientes.length && c.estado === "Activa" ? `<div class="card interno" style="margin-bottom:18px">
        <b>${pendientes.length} estrategia(s) sin finalizar.</b> La campaña no se puede
        cerrar hasta resolverlas: ${esc(pendientes.map((e) => e.descripcion || e.tipo).join(" · "))}
      </div>` : ""}

      <div class="card">
        <div style="display:flex; align-items:center; gap:12px">
          <h3 style="flex:1; margin:0">Estrategias</h3>
          <button class="btn sm ghost" onclick="nuevaEstrategia('${esc(c.id)}')">+ Agregar</button>
        </div>
        ${est.length ? `<table class="data" style="margin-top:12px">
          <thead><tr><th>Tipo</th><th>Descripción</th><th class="num">Inversión</th><th>Ejecución</th><th>Estado</th><th></th></tr></thead>
          <tbody>${est.map((e) => `<tr>
            <td><span class="pill">${esc(e.tipo)}</span></td>
            <td>${esc(e.descripcion || "—")}</td>
            <td class="num">${money(e.inversion, c.moneda)}</td>
            <td>${esc(e.fechaEjecucion || "—")}</td>
            <td>${esc(e.estado)}</td>
            <td>${["Finalizada", "Cancelada"].includes(e.estado)
              ? ""
              : `<button class="btn sm ghost" onclick="finalizarEstrategia('${esc(e.id)}')">Finalizar</button>`}</td>
          </tr>`).join("")}</tbody>
        </table>` : `<p class="muted" style="margin-top:12px">Sin estrategias todavía.</p>`}
      </div>

      <div class="card" style="margin-top:18px">
        <h3>Leads (${ld.length})</h3>
        ${ld.length ? `<table class="data" style="margin-top:12px">
          <thead><tr><th>Contacto</th><th>Canal</th><th>Captura</th><th>Estado</th><th>Ticket</th></tr></thead>
          <tbody>${ld.slice(0, 25).map((l) => `<tr>
            <td>${esc(l.contactoNombre)}<br><span class="muted" style="font-size:12px">${esc(l.contactoEmail || l.contactoTel)}</span></td>
            <td><span class="pill">${esc(l.canal)}</span></td>
            <td>${esc(l.fechaCaptura)}</td>
            <td>${esc(l.estado)}</td>
            <td>${l.ticketId ? esc(l.ticketId) : "—"}</td>
          </tr>`).join("")}</tbody>
        </table>` : `<p class="muted" style="margin-top:12px">Sin leads.</p>`}
      </div>
    `;
  }

  function renderCampForm(id) {
    const c = id ? campanas().find((x) => x.id === id) : null;
    const v = c || E.ENTIDADES.campanas.normalizar({ fechaInicio: E.hoy(), moneda: "USD" });
    document.getElementById("view-campform").innerHTML = `
      <a href="#campanas" class="muted">← Campañas</a>
      <h1 style="margin-top:8px">${c ? "Editar" : "Nueva"} <span class="hl">campaña</span></h1>
      <div class="card" style="margin-top:16px">
        <div class="field"><label for="cNombre">Nombre</label>
          <input id="cNombre" value="${esc(v.nombre)}" placeholder="Congreso SAR 2026" /></div>
        <div class="field"><label for="cObjetivo">Objetivo</label>
          <input id="cObjetivo" value="${esc(v.objetivo)}" placeholder="Generar demanda de contratos de mantenimiento" /></div>
        <div class="form-grid" style="gap:12px">
          <div class="field"><label for="cPresu">Presupuesto asignado</label>
            <input type="number" id="cPresu" min="0" step="100" value="${v.presupuestoAsignado}" /></div>
          <div class="field"><label for="cMoneda">Moneda</label>
            <select id="cMoneda">${["USD", "ARS", "CLP"].map((m) =>
              `<option value="${m}"${v.moneda === m ? " selected" : ""}>${m}</option>`).join("")}</select></div>
          <div class="field"><label for="cEstado">Estado</label>
            <select id="cEstado">${E.CAMPANA_ESTADO.map((s) =>
              `<option value="${s}"${v.estado === s ? " selected" : ""}>${s}</option>`).join("")}</select></div>
        </div>
        <div class="form-grid" style="gap:12px">
          <div class="field"><label for="cInicio">Inicio</label>
            <input type="date" id="cInicio" value="${esc(v.fechaInicio)}" /></div>
          <div class="field"><label for="cFin">Fin</label>
            <input type="date" id="cFin" value="${esc(v.fechaFin || "")}" /></div>
          <div class="field"><label for="cResp">Responsable</label>
            <input id="cResp" value="${esc(v.responsable)}" /></div>
        </div>
        <div class="field">
          <label>Canales</label>
          <div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:6px">
            ${E.CANAL.map((ch) => `<label style="display:flex; gap:6px; align-items:center; font-weight:400">
              <input type="checkbox" class="cCanal" value="${ch}"${v.canales.includes(ch) ? " checked" : ""} /> ${ch}
            </label>`).join("")}
          </div>
          <p class="muted" style="font-size:13px; margin-top:6px">
            El canal de cada lead se carga por separado. Estos son los canales previstos de la campaña.
          </p>
        </div>
        <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px">
          <a class="btn ghost" href="#campanas">Cancelar</a>
          <button class="btn primary" onclick="guardarCampana(${c ? `'${esc(c.id)}'` : "null"})">Guardar</button>
        </div>
      </div>
    `;
  }

  async function guardarCampana(id) {
    const reg = {
      id: id || undefined,
      nombre: document.getElementById("cNombre").value.trim(),
      objetivo: document.getElementById("cObjetivo").value.trim(),
      presupuestoAsignado: document.getElementById("cPresu").value,
      moneda: document.getElementById("cMoneda").value,
      estado: document.getElementById("cEstado").value,
      fechaInicio: document.getElementById("cInicio").value,
      fechaFin: document.getElementById("cFin").value,
      responsable: document.getElementById("cResp").value.trim(),
      canales: [...document.querySelectorAll(".cCanal:checked")].map((x) => x.value),
    };
    if (await guardar("campanas", reg, `Campaña ${reg.nombre}`)) {
      global.toast("Campaña guardada");
      global.go("campanas");
    }
  }

  async function finalizarCampana(id) {
    const c = campanas().find((x) => x.id === id);
    if (!c) return;
    // R5 se verifica en el núcleo; acá solo se intenta y se muestra el motivo.
    if (await guardar("campanas", { ...c, estado: "Finalizada", fechaFin: c.fechaFin || E.hoy() },
        `Finaliza campaña ${c.nombre}`)) {
      global.toast("Campaña finalizada");
      global.router();
    }
  }

  async function nuevaEstrategia(campanaId) {
    const desc = prompt("Descripción de la estrategia");
    if (!desc) return;
    const tipo = prompt(`Tipo (${E.ESTRATEGIA_TIPO.join(" / ")})`, "Contenido");
    if (!tipo) return;
    const inv = prompt("Inversión", "0");
    if (inv === null) return;
    if (await guardar("estrategias", {
      campanaId, tipo, descripcion: desc.trim(), inversion: inv,
      fechaEjecucion: E.hoy(), estado: "EnCurso",
    }, `Estrategia ${tipo} · ${desc}`)) {
      global.toast("Estrategia agregada");
      global.router();
    }
  }

  async function finalizarEstrategia(id) {
    const e = estrategias().find((x) => x.id === id);
    if (!e) return;
    const valor = prompt(
      `Valor final de ${e.kpiObjetivo?.metrica || "el KPI"}` +
      (e.kpiObjetivo?.objetivo ? ` (objetivo: ${e.kpiObjetivo.objetivo})` : ""), "");
    if (valor === null) return;
    if (await guardar("estrategias", { ...e, estado: "Finalizada", kpiValorActual: valor },
        `Finaliza estrategia ${e.descripcion || e.tipo}`)) {
      global.toast("Estrategia finalizada");
      global.router();
    }
  }

  // ==========================================================================
  // Leads
  // ==========================================================================

  function renderLeads() {
    const ld = [...leads()].sort((a, b) => b.fechaCaptura.localeCompare(a.fechaCaptura));
    const porEstado = {};
    for (const l of ld) porEstado[l.estado] = (porEstado[l.estado] || 0) + 1;
    const mapaCamp = new Map(campanas().map((c) => [c.id, c.nombre]));

    document.getElementById("view-leads").innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap">
        <div style="flex:1">
          <div class="kicker">Marketing</div>
          <h1><span class="hl">Leads</span></h1>
        </div>
        <a class="btn primary" href="#leadform">+ Nuevo lead</a>
      </div>

      <div class="grid-kpi" style="margin:18px 0">
        ${E.LEAD_ESTADO.map((s) => `<div class="kpi">
          <div class="label">${s}</div>
          <div class="num num-lg">${porEstado[s] || 0}</div>
        </div>`).join("")}
      </div>

      ${ld.length ? `<table class="data">
        <thead><tr><th>Contacto</th><th>Canal</th><th>Campaña</th><th>Captura</th><th>Estado</th><th></th></tr></thead>
        <tbody>${ld.map((l) => `<tr>
          <td><b>${esc(l.contactoNombre)}</b><br><span class="muted" style="font-size:12px">${esc(l.contactoEmail || l.contactoTel)}</span></td>
          <td><span class="pill">${esc(l.canal)}</span></td>
          <td>${esc(mapaCamp.get(l.campanaId) || "—")}</td>
          <td>${esc(l.fechaCaptura)}</td>
          <td>${esc(l.estado)}</td>
          <td>${l.ticketId
            ? `<span class="muted">ticket ${esc(l.ticketId)}</span>`
            : `<button class="btn sm ghost" onclick="calificarLead('${esc(l.id)}')">Calificar</button>`}</td>
        </tr>`).join("")}</tbody>
      </table>` : `<p class="muted">Todavía no hay leads cargados. Sin ellos, los indicadores
        de costo por lead y conversión no tienen sobre qué calcular.</p>`}
    `;
  }

  function renderLeadForm() {
    const cs = campanas();
    document.getElementById("view-leadform").innerHTML = `
      <a href="#leads" class="muted">← Leads</a>
      <h1 style="margin-top:8px">Nuevo <span class="hl">lead</span></h1>
      <div class="card" style="margin-top:16px">
        <div class="form-grid" style="gap:12px">
          <div class="field"><label for="lEmpresa">Institución</label>
            <input id="lEmpresa" placeholder="Centro de imágenes" /></div>
          <div class="field"><label for="lNombre">Nombre del contacto</label>
            <input id="lNombre" placeholder="Nombre y apellido (si ya lo tenés)" /></div>
        </div>
        <div class="form-grid" style="gap:12px">
          <div class="field"><label for="lEmail">Email</label>
            <input type="email" id="lEmail" placeholder="contacto@centro.com" /></div>
          <div class="field"><label for="lTel">Teléfono</label>
            <input id="lTel" placeholder="+54 ..." /></div>
          <div class="field"><label for="lWeb">Sitio web</label>
            <input id="lWeb" placeholder="www.centro.com" /></div>
        </div>
        <p class="muted" style="font-size:13px; margin:-4px 0 12px">
          Para prospectar alcanza con la <b>institución y su sitio web</b>: el decisor se
          investiga después. El email, cuando lo tengas, evita contar dos veces al mismo
          contacto en una campaña.
        </p>
        <div class="form-grid" style="gap:12px">
          <div class="field"><label for="lSegmento">Segmento del decisor</label>
            <select id="lSegmento"><option value="">— sin definir —</option>
              ${E.SEGMENTO.map((s) => `<option value="${s}">${esc(E.SEGMENTO_NOMBRE[s])}</option>`).join("")}</select></div>
          <div class="field"><label for="lCanal">Canal</label>
            <select id="lCanal">${E.CANAL.map((c) => `<option value="${c}"${c === "Email" ? " selected" : ""}>${c}</option>`).join("")}</select></div>
          <div class="field"><label for="lPais">País</label>
            <select id="lPais">${E.PAIS.map((p) => `<option value="${p}"${p === "AR" ? " selected" : ""}>${esc(E.PAIS_NOMBRE[p])}</option>`).join("")}</select></div>
        </div>
        <div class="form-grid" style="gap:12px">
          <div class="field"><label for="lCampana">Campaña</label>
            <select id="lCampana"><option value="">— sin campaña —</option>
              ${cs.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("")}</select></div>
          <div class="field"><label for="lFecha">Fecha de captura</label>
            <input type="date" id="lFecha" value="${E.hoy()}" /></div>
        </div>
        <div class="field"><label for="lOrigen">Detalle de origen</label>
          <input id="lOrigen" placeholder="utm_source, nombre del evento, referido, provincia…" /></div>
        <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px">
          <a class="btn ghost" href="#leads">Cancelar</a>
          <button class="btn primary" onclick="guardarLead()">Guardar</button>
        </div>
      </div>
    `;
  }

  async function guardarLead() {
    const institucion = document.getElementById("lEmpresa").value.trim();
    const reg = {
      institucion,
      contactoNombre: document.getElementById("lNombre").value.trim(),
      contactoEmail: document.getElementById("lEmail").value.trim(),
      contactoTel: document.getElementById("lTel").value.trim(),
      sitioWeb: document.getElementById("lWeb").value.trim(),
      segmento: document.getElementById("lSegmento").value,
      canal: document.getElementById("lCanal").value,
      pais: document.getElementById("lPais").value,
      campanaId: document.getElementById("lCampana").value || null,
      fechaCaptura: document.getElementById("lFecha").value,
      origenDetalle: document.getElementById("lOrigen").value.trim(),
      estado: "Nuevo",
    };
    if (await guardar("leads", reg, `Lead ${reg.contactoNombre || institucion}`)) {
      global.toast("Lead guardado");
      global.go("leads");
    }
  }

  async function calificarLead(id) {
    const l = leads().find((x) => x.id === id);
    if (!l) return;
    const estado = prompt(
      `Estado del lead ${l.contactoNombre}\n(${E.LEAD_ESTADO.join(" / ")})`, "Calificado");
    if (!estado) return;
    const reg = { ...l, estado };
    if (estado === "Descartado") {
      const motivo = prompt("Motivo del descarte");
      if (!motivo) return;
      reg.motivoDescarte = motivo;
    }
    if (await guardar("leads", reg, `Lead ${l.contactoNombre}: ${estado}`)) {
      global.toast("Lead actualizado");
      global.router();
    }
  }

  // ==========================================================================
  // Canales
  // ==========================================================================

  function renderCanales() {
    const r = K.porCanal(ctx());
    const max = Math.max(1, ...r.filas.map((f) => f.costoPorLead || 0));

    document.getElementById("view-canales").innerHTML = `
      <div class="kicker">Marketing</div>
      <h1>Compara<span class="hl">tiva de canales</span></h1>

      ${r.filas.length ? `
      <div class="card" style="margin-top:18px">
        <h3>Costo por lead</h3>
        <div style="margin-top:14px">
          ${r.filas.filter((f) => f.costoPorLead !== null)
            .sort((a, b) => a.costoPorLead - b.costoPorLead)
            .map((f) => `<div style="display:flex; align-items:center; gap:12px; margin-bottom:10px">
              <div style="width:80px" class="muted">${esc(f.canal)}</div>
              <div style="flex:1; background:var(--surface-2); border-radius:8px; height:22px; overflow:hidden">
                <div style="width:${Math.round((f.costoPorLead / max) * 100)}%; height:100%; background:var(--orange); border-radius:8px"></div>
              </div>
              <div style="width:90px; text-align:right"><b>${money(f.costoPorLead)}</b></div>
            </div>`).join("")}
        </div>
        <p class="muted" style="font-size:13px; margin-top:12px">
          Un costo por lead bajo no significa mejor canal. Un canal caro puede traer
          los negocios más grandes: hay que leerlo junto a la columna de ingresos.
        </p>
      </div>

      <div class="card" style="margin-top:18px">
        <h3>Detalle</h3>
        <div style="overflow-x:auto"><table class="data" style="margin-top:12px">
          <thead><tr>
            <th>Canal</th><th class="num">Leads</th><th class="num">Descartados</th>
            <th class="num">Tickets</th><th class="num">Contratos</th>
            <th class="num">Ingresos</th><th class="num">Inversión</th>
            <th class="num">CPL</th><th class="num">Lead→ticket</th>
          </tr></thead>
          <tbody>${r.filas.map((f) => `<tr>
            <td><b>${esc(f.canal)}</b></td>
            <td class="num">${f.leads}</td>
            <td class="num">${f.descartados}</td>
            <td class="num">${f.tickets}</td>
            <td class="num">${f.contratos}</td>
            <td class="num">${K.textoMonedas(f.ingresos)}</td>
            <td class="num">${money(f.inversion)}</td>
            <td class="num">${f.costoPorLead === null ? "—" : money(f.costoPorLead)}</td>
            <td class="num">${pctTxt(f.tasaLeadTicket)}</td>
          </tr>`).join("")}</tbody>
        </table></div>
        ${r.inversionSinAtribuir > 0 ? `<p class="muted" style="font-size:13px; margin-top:12px">
          <b>${money(r.inversionSinAtribuir)} sin atribuir a ningún canal:</b> corresponde a
          estrategias que todavía no generaron ningún lead. No se reparte entre los demás
          canales porque cualquier criterio para hacerlo sería inventado.
        </p>` : ""}
      </div>` : `<div class="card" style="margin-top:18px">
        <p class="muted">Sin leads cargados no hay nada que comparar.
        <a href="#leadform">Cargar el primero</a>.</p>
      </div>`}
    `;
  }

  // ==========================================================================
  // Esta semana · secuencia de prospección
  // ==========================================================================

  const SEG_LABEL = (s) => (s ? E.SEGMENTO_NOMBRE[s] || s : "Sin segmento definido");

  /** Leads activos (no respondidos) que todavía están dentro de una secuencia. */
  function enSecuencia() {
    return leads().filter((l) =>
      !["Calificado", "Convertido", "Descartado"].includes(l.estado) && l.proximoToque);
  }

  function renderSemana() {
    const hoyISO = E.hoy();
    const horizonte = E.sumarDias(hoyISO, 7);
    const activos = leads().filter((l) =>
      !["Calificado", "Convertido", "Descartado"].includes(l.estado));
    const sec = enSecuencia();
    const toca = sec
      .filter((l) => l.proximoToque <= horizonte)
      .sort((a, b) => a.proximoToque.localeCompare(b.proximoToque));
    const vencidos = toca.filter((l) => l.proximoToque < hoyISO).length;
    const agotados = activos.filter((l) => !l.proximoToque && l.paso >= E.CADENCIA.toques);

    // Agrupado por segmento: cada decisor se trabaja distinto.
    const grupos = {};
    for (const l of toca) (grupos[l.segmento || ""] ??= []).push(l);

    const filaLead = (l) => {
      const atrasado = l.proximoToque < hoyISO;
      const toqueN = l.paso + 1;
      const esBreakup = toqueN === E.CADENCIA.toques;
      return `<tr>
        <td><b>${esc(l.institucion || l.contactoNombre)}</b>
          ${l.contactoNombre && l.contactoNombre !== l.institucion
            ? `<br><span class="muted" style="font-size:12px">${esc(l.contactoNombre)}</span>` : ""}
          ${l.sitioWeb ? `<br><a href="${/^https?:/.test(l.sitioWeb) ? "" : "https://"}${esc(l.sitioWeb)}" target="_blank" rel="noopener" class="muted" style="font-size:12px">${esc(l.sitioWeb)}</a>` : ""}
        </td>
        <td>${l.tier ? `<span class="pill">${esc(l.tier)}</span>` : "—"}</td>
        <td>Toque ${toqueN} de ${E.CADENCIA.toques}${esBreakup ? ' <span class="muted">· cierre</span>' : ""}</td>
        <td${atrasado ? ' style="color:var(--critico,#ff8a5c)"' : ""}><b>${esc(l.proximoToque)}</b>${atrasado ? " ⚠" : ""}</td>
        <td style="white-space:nowrap">
          <button class="btn sm primary" onclick="registrarToque('${esc(l.id)}')">Registré el toque</button>
          <button class="btn sm ghost" onclick="calificarLead('${esc(l.id)}')">Respondió</button>
        </td>
      </tr>`;
    };

    document.getElementById("view-semana").innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap">
        <div style="flex:1">
          <div class="kicker">Prospección · recontacto sistemático</div>
          <h1>Esta <span class="hl">semana</span></h1>
        </div>
        <a class="btn ghost" href="#importar">Importar lista</a>
        <a class="btn primary" href="#leadform">+ Lead manual</a>
      </div>

      <div class="grid-kpi" style="margin:18px 0">
        <div class="kpi"><div class="label">Tocan esta semana</div><div class="num num-lg">${toca.length}</div><div class="sub">${vencidos} atrasado(s)</div></div>
        <div class="kpi"><div class="label">En secuencia</div><div class="num num-lg">${sec.length}</div><div class="sub">activos sin respuesta</div></div>
        <div class="kpi"><div class="label">Secuencia agotada</div><div class="num num-md">${agotados.length}</div><div class="sub">4 toques sin respuesta</div></div>
      </div>

      ${toca.length ? Object.entries(grupos).map(([seg, ls]) => `
        <div class="card" style="margin-bottom:16px">
          <h3 style="margin:0 0 4px">${esc(SEG_LABEL(seg))} <span class="muted" style="font-weight:400">· ${ls.length}</span></h3>
          <table class="data" style="margin-top:10px">
            <thead><tr><th>Institución</th><th>Tier</th><th>Paso</th><th>Vence</th><th></th></tr></thead>
            <tbody>${ls.map(filaLead).join("")}</tbody>
          </table>
        </div>`).join("") : `<div class="card">
          <h3>Nada pendiente esta semana</h3>
          <p class="muted" style="max-width:62ch">Cuando importes la lista o cargues leads, acá
          aparece a quién tocás y recontactás cada semana, ordenado por vencimiento.
          Cada toque registrado reprograma el siguiente según la cadencia (0 · +4 · +11 · +21 días).</p>
          <p style="margin-top:12px"><a class="btn primary" href="#importar">Importar la lista</a></p>
        </div>`}

      ${agotados.length ? `<div class="card interno" style="margin-top:6px">
        <b>${agotados.length} con la secuencia agotada.</b> Cuatro toques sin respuesta.
        Decidí: descartar (con motivo) o dejar en pausa para una campaña futura.
        <div style="overflow-x:auto; margin-top:10px"><table class="data">
          <thead><tr><th>Institución</th><th>Último toque</th><th></th></tr></thead>
          <tbody>${agotados.slice(0, 30).map((l) => `<tr>
            <td>${esc(l.institucion || l.contactoNombre)}</td>
            <td>${esc(l.fechaUltimoToque || "—")}</td>
            <td><button class="btn sm ghost" onclick="calificarLead('${esc(l.id)}')">Resolver</button></td>
          </tr>`).join("")}</tbody>
        </table></div>
      </div>` : ""}
    `;
  }

  /**
   * Registra un toque dado: avanza el paso, lo anota en el historial y deja que
   * el esquema reprograme el próximo según la cadencia. No pregunta por la
   * respuesta acá: si el prospecto respondió, se usa "Respondió" (calificar),
   * que lo saca de la secuencia.
   */
  async function registrarToque(id) {
    const l = leads().find((x) => x.id === id);
    if (!l) return;
    const canal = prompt(`¿Por dónde fue el toque? (${E.TOQUE_CANAL.join(" / ")})`,
      l.canal === "Email" ? "Email" : "Email");
    if (!canal) return;
    const nota = prompt("Nota del toque (asunto del mail, qué le dijiste). Opcional:", "");
    if (nota === null) return;
    const nuevoPaso = l.paso + 1;
    const hist = [...l.historialToques,
      { fecha: E.hoy(), paso: nuevoPaso, canal, nota: nota.trim(), resultado: "" }];
    const reg = {
      ...l, paso: nuevoPaso, historialToques: hist, fechaUltimoToque: E.hoy(),
      estado: l.estado === "Nuevo" ? "Contactado" : l.estado,
      // Null fuerza al esquema a recalcular el próximo toque desde la cadencia.
      proximoToque: null,
    };
    if (await guardar("leads", reg, `Toque ${nuevoPaso} · ${l.institucion || l.contactoNombre}`)) {
      const quedan = E.proximoToque(nuevoPaso, E.hoy());
      global.toast(quedan ? `Toque ${nuevoPaso} registrado — próximo ${quedan}` : "Último toque registrado · secuencia agotada");
      global.router();
    }
  }

  // ==========================================================================
  // Importador de la lista de prospección (CSV)
  // ==========================================================================

  /** Parser CSV mínimo con soporte de comillas y comas internas. */
  function parseCSV(texto) {
    const filas = [];
    let campo = "", fila = [], enComillas = false;
    const t = texto.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (enComillas) {
        if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else enComillas = false; }
        else campo += c;
      } else if (c === '"') enComillas = true;
      else if (c === ",") { fila.push(campo); campo = ""; }
      else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
      else campo += c;
    }
    if (campo.length || fila.length) { fila.push(campo); filas.push(fila); }
    if (!filas.length) return [];
    const cab = filas[0].map((h) => h.trim().toLowerCase());
    return filas.slice(1).filter((f) => f.some((x) => x.trim()))
      .map((f) => Object.fromEntries(cab.map((h, i) => [h, (f[i] || "").trim()])));
  }

  let _impFilas = null;  // filas parseadas en memoria para el importador

  function renderImportar() {
    const emailCamps = campanas().filter((c) => c.canales.includes("Email"));
    document.getElementById("view-importar").innerHTML = `
      <a href="#semana" class="muted">← Esta semana</a>
      <h1 style="margin-top:8px">Importar <span class="hl">lista de prospección</span></h1>
      <div class="card" style="margin-top:16px; max-width:70ch">
        <p class="muted">Subí el CSV de la lista (universo-argentina.csv / universo-chile.csv).
        Se crean leads con la institución, el tier y el sitio web; cada uno arranca la
        secuencia de recontacto. El decisor se completa después. No se sube ningún archivo
        a ningún lado: se lee en tu navegador y se guardan solo los leads.</p>

        <div class="field" style="margin-top:14px"><label for="impFile">Archivo CSV</label>
          <input type="file" id="impFile" accept=".csv,text/csv" onchange="impPreview()" /></div>

        <div class="form-grid" style="gap:12px">
          <div class="field"><label for="impPais">País de la lista</label>
            <select id="impPais">${E.PAIS.map((p) => `<option value="${p}"${p === "AR" ? " selected" : ""}>${esc(E.PAIS_NOMBRE[p])}</option>`).join("")}</select></div>
          <div class="field"><label for="impSeg">Segmento por defecto</label>
            <select id="impSeg"><option value="">— sin definir —</option>
              ${E.SEGMENTO.map((s) => `<option value="${s}">${esc(E.SEGMENTO_NOMBRE[s])}</option>`).join("")}</select></div>
          <div class="field"><label for="impSoloA"><input type="checkbox" id="impSoloA" checked /> Solo núcleo (Tier A)</label></div>
        </div>

        <div class="field"><label for="impCamp">Campaña destino</label>
          <select id="impCamp">
            <option value="__nueva__">+ Crear "Prospección Email" (canal Email)</option>
            ${emailCamps.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("")}
          </select></div>

        <div id="impEstado" class="muted" style="margin-top:8px"></div>

        <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px">
          <a class="btn ghost" href="#semana">Cancelar</a>
          <button class="btn primary" id="impBtn" onclick="ejecutarImport()" disabled>Importar</button>
        </div>
      </div>
    `;
    _impFilas = null;
  }

  function impPreview() {
    const inp = document.getElementById("impFile");
    const est = document.getElementById("impEstado");
    const btn = document.getElementById("impBtn");
    const f = inp.files?.[0];
    if (!f) return;
    const lector = new FileReader();
    lector.onload = () => {
      try {
        _impFilas = parseCSV(String(lector.result));
        const conInst = _impFilas.filter((r) => (r.institucion || "").trim()).length;
        const conA = _impFilas.filter((r) => (r.tier || "").toUpperCase() === "A").length;
        est.innerHTML = `Leídas <b>${_impFilas.length}</b> filas · ${conInst} con institución · ${conA} Tier A.`;
        btn.disabled = conInst === 0;
      } catch (e) {
        est.innerHTML = `<span style="color:var(--critico,#ff8a5c)">No se pudo leer el CSV: ${esc(e.message)}</span>`;
        _impFilas = null; btn.disabled = true;
      }
    };
    lector.readAsText(f);
  }

  async function ejecutarImport() {
    if (!_impFilas) return;
    const pais = document.getElementById("impPais").value;
    const segDef = document.getElementById("impSeg").value;
    const soloA = document.getElementById("impSoloA").checked;
    let campId = document.getElementById("impCamp").value;
    const btn = document.getElementById("impBtn");
    const est = document.getElementById("impEstado");
    btn.disabled = true;

    // Campaña destino: se crea una si hace falta.
    if (campId === "__nueva__") {
      const reg = E.ENTIDADES.campanas.normalizar({
        nombre: "Prospección Email AR/CL", objetivo: "Generar reuniones con centros de imágenes",
        canales: ["Email"], estado: "Activa", fechaInicio: E.hoy(), responsable: "Maxi",
      });
      if (!(await guardar("campanas", reg, "Campaña Prospección Email"))) { btn.disabled = false; return; }
      campId = reg.id;
    }

    // Deduplicación por institución dentro de la campaña.
    const yaEn = new Set((leads() || [])
      .filter((l) => l.campanaId === campId)
      .map((l) => E.claveCliente(l.institucion || l.contactoNombre)));

    const nuevos = [];
    let saltados = 0;
    for (const r of _impFilas) {
      const institucion = (r.institucion || "").trim();
      if (!institucion) { saltados++; continue; }
      if (soloA && (r.tier || "").toUpperCase() !== "A") { saltados++; continue; }
      const clave = E.claveCliente(institucion);
      if (yaEn.has(clave)) { saltados++; continue; }
      yaEn.add(clave);
      const zona = [r.localidad || r.comuna, r.provincia || r.region].filter(Boolean).join(", ");
      nuevos.push(E.ENTIDADES.leads.normalizar({
        campanaId: campId, canal: "Email", pais,
        institucion, tier: (r.tier || "").toUpperCase(),
        sitioWeb: r.sitio_web || r.web || "",
        contactoTel: r.telefono || "",
        segmento: segDef,
        origenDetalle: zona ? `Lista ${pais} · ${zona}` : `Lista ${pais}`,
        fechaCaptura: E.hoy(), estado: "Nuevo",
      }));
    }

    if (!nuevos.length) {
      est.innerHTML = `Nada para importar: ${saltados} fila(s) salteada(s) (sin institución, no Tier A, o ya cargadas).`;
      btn.disabled = false;
      return;
    }

    est.innerHTML = `Guardando ${nuevos.length} leads…`;
    global.state.leads = [...(leads() || []), ...nuevos];
    try {
      await global.persist(`Importación prospección: ${nuevos.length} leads (${pais})`, "leads");
    } catch (e) {
      global.toast(`Error al guardar: ${e.message}`, true);
      btn.disabled = false;
      return;
    }
    global.toast(`${nuevos.length} leads importados${saltados ? ` · ${saltados} salteados` : ""}`);
    global.go("semana");
  }

  // ==========================================================================

  global.NEXO_VISTAS = global.NEXO_VISTAS || {};
  Object.assign(global.NEXO_VISTAS, {
    mktablero: renderMkTablero,
    campanas: renderCampanas,
    campdetalle: () => renderCampDetalle(location.hash.split("/")[1]),
    campform: () => renderCampForm(location.hash.split("/")[1]),
    leads: renderLeads,
    leadform: renderLeadForm,
    canales: renderCanales,
    semana: renderSemana,
    importar: renderImportar,
  });

  Object.assign(global, {
    guardarCampana, finalizarCampana, nuevaEstrategia, finalizarEstrategia,
    guardarLead, calificarLead, registrarToque,
    impPreview, ejecutarImport,
  });
})(typeof window !== "undefined" ? window : globalThis);
