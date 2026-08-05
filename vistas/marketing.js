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
          <div class="field"><label for="lNombre">Nombre del contacto</label>
            <input id="lNombre" placeholder="Nombre y apellido" /></div>
          <div class="field"><label for="lEmpresa">Institución</label>
            <input id="lEmpresa" placeholder="Centro de imágenes" /></div>
        </div>
        <div class="form-grid" style="gap:12px">
          <div class="field"><label for="lEmail">Email</label>
            <input type="email" id="lEmail" placeholder="contacto@centro.com" /></div>
          <div class="field"><label for="lTel">Teléfono</label>
            <input id="lTel" placeholder="+54 ..." /></div>
        </div>
        <p class="muted" style="font-size:13px; margin:-4px 0 12px">
          Alcanza con email o teléfono. El email además sirve para no contar dos
          veces al mismo contacto dentro de una campaña.
        </p>
        <div class="form-grid" style="gap:12px">
          <div class="field"><label for="lCanal">Canal</label>
            <select id="lCanal">${E.CANAL.map((c) => `<option value="${c}">${c}</option>`).join("")}</select></div>
          <div class="field"><label for="lCampana">Campaña</label>
            <select id="lCampana"><option value="">— sin campaña —</option>
              ${cs.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("")}</select></div>
          <div class="field"><label for="lFecha">Fecha de captura</label>
            <input type="date" id="lFecha" value="${E.hoy()}" /></div>
        </div>
        <div class="field"><label for="lOrigen">Detalle de origen</label>
          <input id="lOrigen" placeholder="utm_source, nombre del evento, referido…" /></div>
        <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px">
          <a class="btn ghost" href="#leads">Cancelar</a>
          <button class="btn primary" onclick="guardarLead()">Guardar</button>
        </div>
      </div>
    `;
  }

  async function guardarLead() {
    const reg = {
      contactoNombre: document.getElementById("lNombre").value.trim(),
      contactoEmail: document.getElementById("lEmail").value.trim(),
      contactoTel: document.getElementById("lTel").value.trim(),
      canal: document.getElementById("lCanal").value,
      campanaId: document.getElementById("lCampana").value || null,
      fechaCaptura: document.getElementById("lFecha").value,
      origenDetalle: document.getElementById("lOrigen").value.trim(),
      estado: "Nuevo",
    };
    if (await guardar("leads", reg, `Lead ${reg.contactoNombre}`)) {
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

  global.NEXO_VISTAS = global.NEXO_VISTAS || {};
  Object.assign(global.NEXO_VISTAS, {
    mktablero: renderMkTablero,
    campanas: renderCampanas,
    campdetalle: () => renderCampDetalle(location.hash.split("/")[1]),
    campform: () => renderCampForm(location.hash.split("/")[1]),
    leads: renderLeads,
    leadform: renderLeadForm,
    canales: renderCanales,
  });

  Object.assign(global, {
    guardarCampana, finalizarCampana, nuevaEstrategia, finalizarEstrategia,
    guardarLead, calificarLead,
  });
})(typeof window !== "undefined" ? window : globalThis);
