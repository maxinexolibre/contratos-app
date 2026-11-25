/**
 * Propuestas comerciales: la primera de las dos etapas del contrato.
 *
 * La propuesta vende la idea de trabajar con Nexolibre —plan, equipos,
 * cobertura y canon— sin cláusulas legales. Cuando el cliente acepta, se
 * redacta el contrato, que es un registro aparte y enlazado.
 *
 * Separarlas permite medir algo que antes era invisible: cuántas propuestas
 * hacen falta por cada contrato y cuánto tarda una en convertirse. Con un
 * registro único, una propuesta rechazada y un contrato sin firmar eran
 * indistinguibles.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;
  const R = global.NEXO_REGLAS;
  const P = global.NEXO_PERMISOS;
  const T = global.NEXO_TABLA;
  const K = global.NEXO_KPI;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n, d = 0) => (n === null || n === undefined ? "—"
    : Number(n).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const SIM = { USD: "US$", ARS: "$", CLP: "CLP$", COP: "COP$", UYU: "$U", UF: "UF" };
  const money = (v, m = "USD") => (v === null || v === undefined ? "—" : `${SIM[m] || m} ${num(v)}`);

  const propuestas = () => global.state?.propuestas || [];
  const contratos = () => global.state?.data || [];
  const clientes = () => global.state?.clientes || [];
  const rol = () => global.state?.rol || "admin";

  const filtro = () => (global.state.filtroProp = global.state.filtroProp ||
    { pais: "", mes: "", estado: "", q: "", pagina: 1 });

  const nombreCliente = (id) => (clientes().find((c) => c.id === id)?.nombreComercial) || "—";
  const CAT = () => global.NEXO_CATALOGO;


  async function guardar(registro, mensaje) {
    const normalizado = E.ENTIDADES.propuestas.normalizar(registro);
    const anterior = propuestas().find((x) => x.id === normalizado.id) || null;
    const ctx = {
      rol: rol(), usuario: global.state?.user || "",
      propuestas: propuestas(), contratos: contratos(), clientes: clientes(),
    };
    try {
      R.validar("propuestas", anterior ? "editar" : "crear", normalizado, anterior, ctx);
    } catch (e) {
      global.toast(e.sugerencia ? `${e.message} — ${e.sugerencia}` : e.message, true, true);
      return false;
    }
    global.state.propuestas = [
      ...propuestas().filter((x) => x.id !== normalizado.id), normalizado];
    await global.persist(mensaje, "propuestas", normalizado);
    return true;
  }

  // ==========================================================================
  // Listado
  // ==========================================================================

  function renderPropuestas() {
    const f = filtro();
    const todas = propuestas();

    const filtradas = T.filtrar(todas, f, {
      pais: (p) => p.pais,
      fecha: (p) => p.fechas.creado,
      estado: (p) => p.estado,
      texto: (p) => `${p.numero} ${p.numeroLegado} ${nombreCliente(p.clienteId)}`,
    }).sort((a, b) => (b.fechas.creado || "").localeCompare(a.fechas.creado || ""));

    const pag = T.paginar(filtradas, f.pagina);

    // Conversión: de las resueltas, cuántas se aceptaron. Es el número que
    // justifica separar las dos etapas.
    const resueltas = todas.filter((p) => ["Aceptada", "Rechazada"].includes(p.estado));
    const aceptadas = todas.filter((p) => p.estado === "Aceptada");
    const sinContrato = aceptadas.filter((p) => !p.contratoId);

    document.getElementById("view-propuestas").innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap">
        <div style="flex:1">
          <div class="kicker">Etapa 1 · comercial</div>
          <h1>Pro<span class="hl">puestas</span></h1>
        </div>
        ${P.puede(rol(), "propuestas", "crear")
          ? `<a class="btn primary" href="#propform">+ Nueva propuesta</a>` : ""}
      </div>

      <p class="muted" style="max-width:74ch">
        La propuesta ofrece el plan, los equipos alcanzados, la cobertura y el canon.
        Cuando el cliente acepta se redacta el <b>contrato</b>, con las cláusulas.
      </p>

      <div class="grid-kpi" style="margin:18px 0">
        <div class="kpi">
          <div class="label">Abiertas</div>
          <div class="num num-lg">${todas.filter((p) => ["Borrador", "Enviada"].includes(p.estado)).length}</div>
          <div class="sub">borrador + enviadas</div>
        </div>
        <div class="kpi">
          <div class="label">Conversión</div>
          <div class="num num-lg">${K.pct(aceptadas.length, resueltas.length) ?? "—"}${resueltas.length ? "%" : ""}</div>
          <div class="sub">${aceptadas.length} de ${resueltas.length} resueltas</div>
        </div>
        <div class="kpi${sinContrato.length ? " warn" : ""}">
          <div class="label">Aceptadas sin contrato</div>
          <div class="num num-lg">${sinContrato.length}</div>
          <div class="sub">esperan redacción</div>
        </div>
        <div class="kpi">
          <div class="label">Canon propuesto</div>
          <div class="num num-md">${K.textoMonedas(K.porMoneda(
            // El canon vive dentro de `economico`: se aplana antes de sumar,
            // porque leerlo de la raíz da undefined y el total sale en cero.
            todas.filter((p) => ["Borrador", "Enviada"].includes(p.estado))
              .map((p) => ({ monto: p.economico.canonMensual, moneda: p.economico.moneda })),
            "monto", "moneda"))}</div>
          <div class="sub">/mes en juego</div>
        </div>
      </div>

      <div class="table-tools" style="margin-bottom:14px">
        <input type="search" id="propQ" placeholder="Buscar cliente o N.º…" value="${esc(f.q)}" />
        <select id="propEstado">
          <option value="">Todos los estados</option>
          ${E.PROPUESTA_ESTADO.map((s) =>
            `<option value="${s}"${f.estado === s ? " selected" : ""}>${s}</option>`).join("")}
        </select>
        <select id="propPais">
          <option value="">Todos los países</option>
          ${E.PAIS.map((p) =>
            `<option value="${p}"${f.pais === p ? " selected" : ""}>${esc(E.PAIS_NOMBRE[p])}</option>`).join("")}
        </select>
        <select id="propMes">
          <option value="">Todos los meses</option>
          ${T.mesesDisponibles(todas, (p) => p.fechas.creado).map((m) =>
            `<option value="${m}"${f.mes === m ? " selected" : ""}>${esc(T.etiquetaMes(m))}</option>`).join("")}
        </select>
        ${T.hayFiltro(f) ? `<button class="btn sm ghost" onclick="limpiarFiltroProp()">✕ Limpiar</button>` : ""}
        <button class="btn sm" onclick="exportarPropuestasCSV()">⬇ CSV</button>
      </div>

      ${sinContrato.length ? `<div class="card interno" style="margin-bottom:16px">
        <b>${sinContrato.length} propuesta(s) aceptadas sin contrato redactado.</b>
        ${sinContrato.some((p) => p.esquemaAnterior)
          ? `Incluye registros del esquema anterior, donde una misma ficha hacía de
             propuesta y de contrato. Están operando sin documento formal.`
          : ""}
      </div>` : ""}

      ${filtradas.length ? `<div style="overflow-x:auto"><table class="data">
        <thead><tr>
          <th>N.º</th><th>Cliente</th><th>País</th><th>Creada</th>
          <th class="num">Canon</th><th>Estado</th><th>Contrato</th>
        </tr></thead>
        <tbody>${pag.filas.map((p) => `<tr onclick="location.hash='propdetalle/${esc(p.id)}'">
          <td><b>${esc(p.numero)}</b>${p.version > 1 ? ` <span class="pill" title="Versión de la negociación">v${p.version}</span>` : ""}${p.numeroLegado
            ? `<br><span class="muted" style="font-size:11px">antes ${esc(p.numeroLegado)}</span>` : ""}</td>
          <td>${esc(nombreCliente(p.clienteId))}</td>
          <td><span class="pill">${esc(p.pais)}</span></td>
          <td>${esc(p.fechas.creado || "—")}</td>
          <td class="num">${money(p.economico.canonMensual, p.economico.moneda)}<span class="muted">/mes</span></td>
          <td><span class="pill">${esc(p.estado)}</span>${p.esquemaAnterior
            ? ` <span class="muted" title="Registro del esquema anterior: aceptada y operando, sin contrato redactado">histórico</span>` : ""}</td>
          <td>${p.contratoId
            ? `<span class="muted">${esc(numeroContrato(p.contratoId))}</span>`
            : (p.estado === "Aceptada" ? `<span class="muted">pendiente</span>` : "—")}</td>
        </tr>`).join("")}</tbody>
      </table></div>
      ${T.pie(pag, "irPaginaProp", T.describirFiltro(f, todas.length))}`
        : `<p class="muted">${T.hayFiltro(f)
            ? "Ninguna propuesta coincide con el filtro."
            : "Todavía no hay propuestas cargadas."}</p>`}
    `;

    const bind = (id, campo) => {
      const el = document.getElementById(id);
      if (!el) return;
      el[id === "propQ" ? "oninput" : "onchange"] = (e) => {
        f[campo] = e.target.value; f.pagina = 1; global.redibujarConFoco(renderPropuestas);
      };
    };
    bind("propQ", "q"); bind("propEstado", "estado");
    bind("propPais", "pais"); bind("propMes", "mes");
  }

  const numeroContrato = (id) => (contratos().find((c) => c.id === id)?.numero) || id;

  // ==========================================================================
  // Detalle
  // ==========================================================================

  function renderPropDetalle(id) {
    const p = propuestas().find((x) => x.id === id);
    if (!p) { global.go("propuestas"); return; }
    const contrato = p.contratoId ? contratos().find((c) => c.id === p.contratoId) : null;
    const puedeEditar = P.puedeSobre(rol(), "propuestas", "editar", p, global.state?.user);

    document.getElementById("view-propdetalle").innerHTML = `
      <a href="#propuestas" class="muted">← Propuestas</a>
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:8px">
        <div style="flex:1">
          <div class="kicker">Propuesta · ${esc(E.PAIS_NOMBRE[p.pais] || p.pais)}</div>
          <h1>${esc(p.numero)}${p.version > 1 ? ` <span class="muted" style="font-size:.55em">versión ${p.version}</span>` : ""}</h1>
          <p class="muted" style="margin:4px 0 0">
            ${esc(nombreCliente(p.clienteId))}
            ${p.numeroLegado ? ` · circuló como ${esc(p.numeroLegado)}` : ""}
          </p>
        </div>
        <button class="btn primary" onclick="verDocumento('propuesta','${esc(p.id)}')">👁 Ver propuesta / PDF</button>
        <button class="btn" onclick="generarPropuestaDocx('${esc(p.id)}')" title="Descarga un .docx editable en Word">⬇ .docx</button>
        ${puedeEditar && !["Aceptada", "Rechazada"].includes(p.estado)
          ? `<a class="btn ghost" href="#propform/${esc(p.id)}">Editar</a>` : ""}
        ${accionesEtapa(p, contrato)}
      </div>

      ${!p.plan?.id || !p.equipos.length ? `<div class="card interno" style="margin-top:16px">
        <b>La propuesta sale incompleta.</b> Falta${!p.plan?.id && !p.equipos.length ? "n el plan y los equipos"
          : !p.plan?.id ? " el plan" : "n los equipos"}: el plan arma el alcance y los equipos, el título.
        ${puedeEditar && !["Aceptada", "Rechazada"].includes(p.estado)
          ? `Cargalos desde <a href="#propform/${esc(p.id)}">Editar</a>.` : ""}
      </div>` : ""}

      ${p.esquemaAnterior ? `<div class="card interno" style="margin-top:16px">
        <b>Registro del esquema anterior.</b> Esta propuesta fue aceptada y está
        operando, pero nunca se redactó el contrato con cláusulas: antes una misma
        ficha hacía de las dos cosas. No se le generó un contrato automáticamente
        porque sería fabricar un documento que nadie firmó.
        ${!contrato && puedeEditar
          ? ` Cuando quieras formalizarla, usá <b>Generar contrato</b>.` : ""}
      </div>` : ""}

      <div class="grid-kpi" style="margin:18px 0">
        <div class="kpi">
          <div class="label">Canon propuesto</div>
          <div class="num num-md">${money(p.economico.canonMensual, p.economico.moneda)}</div>
          <div class="sub">por mes${p.economico.incluyeIVA ? " · IVA incluido" : " + IVA"}</div>
        </div>
        <div class="kpi">
          <div class="label">Estado</div>
          <div class="num num-md">${esc(p.estado)}</div>
          <div class="sub">${esc(p.fechas.resuelto || p.fechas.enviado || p.fechas.creado || "")}</div>
        </div>
        <div class="kpi">
          <div class="label">Equipos</div>
          <div class="num num-lg">${p.equipos.length}</div>
          <div class="sub">alcanzados</div>
        </div>
        <div class="kpi">
          <div class="label">Vigencia propuesta</div>
          <div class="num num-lg">${p.vigenciaPropuesta.meses}</div>
          <div class="sub">meses</div>
        </div>
      </div>

      ${contrato ? `<div class="card" style="margin-bottom:18px">
        <h3>Etapa 2 · contrato</h3>
        <p style="margin:8px 0 0">
          <b>${esc(contrato.numero)}</b> · ${esc(contrato.estado)}
          <a class="btn sm ghost" href="#detalle/${esc(contrato.id)}" style="margin-left:10px">Ver contrato</a>
        </p>
      </div>` : ""}

      ${renderNegociacion(p)}

      <div class="card">
        <h3>Lo que se ofrece</h3>
        ${p.plan?.id ? `<p style="margin:8px 0 0"><span class="pill-plan">${esc(p.plan.etiquetaPublica
          || CAT().PLANES[p.plan.id]?.etiquetaPublica || p.plan.id)}</span></p>` : ""}
        ${p.equipos.length ? `<table class="data" style="margin-top:12px">
          <thead><tr><th>Equipo</th><th>Marca</th><th>Modalidad</th><th>Ubicación</th></tr></thead>
          <tbody>${p.equipos.map((eq) => `<tr>
            <td>${esc(eq.modelo)}</td><td>${esc(eq.marca)}</td>
            <td>${esc(eq.modalidad)}</td><td>${esc(eq.ubicacion || "—")}${eq.ingreso
              ? `<br><span class="muted" style="font-size:12px">entra el ${esc(fechaCorta(eq.ingreso))}${eq.garantiaHasta ? ` · garantía hasta ${esc(fechaCorta(eq.garantiaHasta))}` : ""}</span>` : ""}</td>
          </tr>`).join("")}</tbody>
        </table>` : `<p class="muted" style="margin-top:12px">Sin equipos cargados.</p>`}
        <p style="margin-top:14px"><b>Alcance:</b> ${esc(resumenAlcance(p.cobertura || {}, p.equipos))}</p>
        ${(p.economico.tramos || []).length ? `<p style="margin-top:14px"><b>Canon por tramos:</b>
          ${p.economico.tramos.map((t) => `${esc(rangoTramo(t))}, ${money(t.canonMensual, p.economico.moneda)}/mes${t.motivo ? ` (${esc(t.motivo)})` : ""}`).join("; ")}.
          Fuera de los tramos rige el canon de ${money(p.economico.canonMensual, p.economico.moneda)}.</p>` : ""}
        ${p.notas ? `<p class="muted" style="margin-top:14px"><b>Notas:</b> ${esc(p.notas)}</p>` : ""}
      </div>

      ${global.tarjetaComision ? `<div style="margin-top:18px">${global.tarjetaComision("Propuesta", p.id)}</div>` : ""}

      ${p.motivoRechazo ? `<div class="card" style="margin-top:18px">
        <h3>Motivo del rechazo</h3>
        <p style="margin-top:8px">${esc(p.motivoRechazo)}</p>
      </div>` : ""}
    `;
  }

  /** Botones que dependen de en qué etapa está la propuesta. */
  function accionesEtapa(p, contrato) {
    if (!P.puedeSobre(rol(), "propuestas", "editar", p, global.state?.user)) return "";
    if (p.estado === "Borrador") {
      return `<button class="btn primary" onclick="enviarPropuesta('${esc(p.id)}')">Marcar como enviada</button>`;
    }
    if (p.estado === "Enviada") {
      return `<button class="btn primary" onclick="aceptarPropuesta('${esc(p.id)}')">Aceptar</button>
              <button class="btn" onclick="nuevaVersionPropuesta('${esc(p.id)}')" title="El cliente pidió cambios: se guarda esta versión tal como salió y se abre la siguiente">↻ Renegociar · versión ${(p.version || 1) + 1}</button>
              <button class="btn ghost" onclick="rechazarPropuesta('${esc(p.id)}')">Rechazar</button>`;
    }
    if (p.estado === "Aceptada" && !contrato) {
      return `<button class="btn primary" onclick="generarContrato('${esc(p.id)}')">Generar contrato</button>`;
    }
    return "";
  }

  const fechaCorta = (f) => (f ? f.split("-").reverse().join("/") : "—");
  const rangoTramo = (t) => t.desde && t.hasta ? `del ${fechaCorta(t.desde)} al ${fechaCorta(t.hasta)}`
    : t.desde ? `desde el ${fechaCorta(t.desde)}` : `hasta el ${fechaCorta(t.hasta)}`;

  /** Lo que cambió de una versión a la siguiente, en una línea. */
  function diferencias(a, b) {
    const d = [];
    const ca = Number(a.economico?.canonMensual) || 0, cb = Number(b.economico?.canonMensual) || 0;
    if (ca !== cb) d.push(`canon ${money(ca, a.economico?.moneda)} → ${money(cb, b.economico?.moneda)}`);
    const clave = (e) => [e.marca, e.modelo, e.ubicacion].join("|");
    const ea = new Set((a.equipos || []).map(clave)), eb = new Set((b.equipos || []).map(clave));
    const mas = [...eb].filter((x) => !ea.has(x)).length, menos = [...ea].filter((x) => !eb.has(x)).length;
    if (mas) d.push(`+${mas} equipo${mas > 1 ? "s" : ""}`);
    if (menos) d.push(`−${menos} equipo${menos > 1 ? "s" : ""}`);
    if (JSON.stringify(a.economico?.tramos || []) !== JSON.stringify(b.economico?.tramos || [])) d.push("tramos de canon");
    if ((a.plan?.id || "") !== (b.plan?.id || "")) d.push(`plan ${a.plan?.id || "—"} → ${b.plan?.id || "—"}`);
    if ((a.vigenciaPropuesta?.meses || 0) !== (b.vigenciaPropuesta?.meses || 0)) d.push(`vigencia ${a.vigenciaPropuesta?.meses || "—"} → ${b.vigenciaPropuesta?.meses || "—"} meses`);
    if (JSON.stringify(a.cobertura || {}) !== JSON.stringify(b.cobertura || {})) d.push("cobertura");
    return d.join(" · ") || "sin cambios en las condiciones";
  }

  /** Historial de la negociación: cada vuelta como salió al cliente. */
  function renderNegociacion(p) {
    if (!(p.versiones || []).length) return "";
    const actual = { n: p.version, enviado: p.estado === "Borrador" ? null : p.fechas.ultimoEnvio,
      economico: p.economico, equipos: p.equipos, plan: p.plan, cobertura: p.cobertura,
      vigenciaPropuesta: p.vigenciaPropuesta };
    const todas = [...p.versiones.slice().sort((a, b) => a.n - b.n), actual];
    return `<div class="card" style="margin-bottom:18px">
      <h3>Negociación · ${todas.length} versiones</h3>
      <table class="data" style="margin-top:10px">
        <thead><tr><th>Versión</th><th>Enviada</th><th class="num">Canon</th><th>Equipos</th><th>Qué cambió</th><th>Por qué</th></tr></thead>
        <tbody>${todas.map((v, i) => `<tr${v === actual ? ' style="font-weight:600"' : ""}>
          <td>v${v.n}${v === actual ? ` <span class="pill">${p.estado === "Aceptada" ? "acuerdo final" : "actual"}</span>` : ""}</td>
          <td>${v.enviado ? esc(fechaCorta(v.enviado)) : '<span class="muted">sin enviar</span>'}</td>
          <td class="num">${money(v.economico?.canonMensual, v.economico?.moneda)}</td>
          <td>${(v.equipos || []).length}</td>
          <td class="muted">${i ? esc(diferencias(todas[i - 1], v)) : "primera versión"}</td>
          <td class="muted">${esc((p.versiones.find((x) => x.n === v.n - 1) || {}).motivo || (i ? "" : "—"))}</td>
        </tr>`).join("")}</tbody>
      </table>
      <p class="muted" style="font-size:12.5px;margin:8px 0 0">«Por qué» es lo que pidió el cliente para pasar a esa versión. Las versiones anteriores quedan congeladas: el documento de cada una se puede reconstruir con lo que dice esta tabla.</p>
    </div>`;
  }

  /**
   * El cliente contraoferta: se congela la versión que salió y se abre la
   * siguiente en borrador para editarla. Es la misma propuesta —mismo número,
   * mismo cliente, misma comisión— en otra vuelta, no una propuesta nueva.
   */
  async function nuevaVersionPropuesta(id) {
    const p = propuestas().find((x) => x.id === id);
    if (!p || p.estado !== "Enviada") return;
    const motivo = prompt(
      `Versión ${(p.version || 1) + 1} de ${p.numero}\n\n¿Qué pidió el cliente o qué se renegocia?\n(Queda en el historial de la negociación.)`);
    if (motivo === null) return;
    const congelada = E.normalizarVersion({
      n: p.version || 1, creado: p.fechas.creado, enviado: p.fechas.ultimoEnvio || p.fechas.enviado,
      cerrado: E.hoy(), usuario: global.state?.user || "", motivo: motivo.trim(),
      economico: structuredClone(p.economico), equipos: structuredClone(p.equipos),
      plan: structuredClone(p.plan), cobertura: structuredClone(p.cobertura),
      vigenciaPropuesta: structuredClone(p.vigenciaPropuesta), validezDias: p.validezDias, notas: p.notas,
    });
    const reg = { ...p, estado: "Borrador", version: (p.version || 1) + 1,
      versiones: [...(p.versiones || []), congelada],
      historialEstados: [...(p.historialEstados || []),
        { estado: "Borrador", fecha: E.hoy(), usuario: global.state?.user || "", nota: `versión ${(p.version || 1) + 1}` }] };
    if (await guardar(reg, `Propuesta ${p.numero} · versión ${reg.version}`)) {
      global.toast(`Versión ${reg.version} abierta · editá las condiciones y volvé a enviarla`);
      global.go("propform/" + p.id);
    }
  }

  // ---- Alcance del servicio ----
  const CHECKS_ALCANCE = [
    ["correctivoManoObra", "Correctivo (mano de obra)"],
    ["soporteRemoto", "Soporte remoto"],
    ["saasMonitoreo", "SaaS Gestión y Monitoreo Cryo (RM)"],
    ["partesIncluidas", "Repuestos incluidos"],
    ["viaticosIncluidos", "Viáticos incluidos"],
    ["enviosRepuestosIncluidos", "Envío de repuestos incluido"],
    ["incluirSLA", "Niveles de servicio (SLA)"],
  ];
  function bloqueAlcance(cov) {
    return `<h3 style="margin-top:14px">Alcance del servicio</h3>
      <p class="muted" style="font-size:13px;margin-top:0">El plan lo precarga; después se ajusta a lo que se negoció. Es lo que lee el cliente en la propuesta.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <button type="button" class="btn sm" onclick="alcanceDesdePlan()">↻ Cargar desde el plan</button>
        <button type="button" class="btn sm" onclick="alcanceSoloManoObra()">Solo mano de obra</button>
      </div>
      <div class="form-grid">
        <div class="field"><label for="pfcPrev">Preventivos por año</label>
          <input type="number" min="0" id="pfcPrev" value="${esc(cov.preventivoInspeccionesAnuales ?? "")}" placeholder="0 = sin preventivo" /></div>
        <div class="field"><label for="pfcBob">Reparaciones de bobinas por año (RM)</label>
          <input id="pfcBob" value="${esc(cov.reparacionBobinasPorAnio ?? "")}" placeholder="vacío = no incluye · 2 · sin límite" /></div>
        <div class="field"><label for="pfcBobAlc">El cupo de bobinas es…</label>
          <select id="pfcBobAlc"><option value="flota"${cov.bobinasAlcance !== "porEquipo" ? " selected" : ""}>Para toda la flota de RM</option>
            <option value="porEquipo"${cov.bobinasAlcance === "porEquipo" ? " selected" : ""}>Por cada equipo de RM</option></select></div>
      </div>
      <div class="field full"><label for="pfcRep">Reparaciones / partes incluidas <span class="hint">(una por línea)</span></label>
        <textarea id="pfcRep" rows="2" placeholder="Reparaciones electromecánicas de camilla paciente">${esc((cov.reparacionesIncluidas || []).join("\n"))}</textarea></div>
      <div class="check-row" style="margin:8px 0 4px">
        ${CHECKS_ALCANCE.map(([k, l]) => `<label><input type="checkbox" data-cov="${k}" ${(k === "incluirSLA" ? cov[k] !== false : cov[k]) ? "checked" : ""}> ${esc(l)}</label>`).join("")}
      </div>`;
  }
  function leerAlcance() {
    const v = (id) => document.getElementById(id).value.trim();
    const o = {
      preventivoInspeccionesAnuales: v("pfcPrev") === "" ? 0 : Number(v("pfcPrev")),
      reparacionBobinasPorAnio: v("pfcBob"),
      bobinasAlcance: v("pfcBobAlc"),
      reparacionesIncluidas: v("pfcRep").split("\n").map((x) => x.trim()).filter(Boolean),
      relevamientoInicial: document.getElementById("pfRelev").checked,
    };
    document.querySelectorAll("[data-cov]").forEach((c) => (o[c.dataset.cov] = c.checked));
    return o;
  }
  function pintarAlcance(cov) {
    document.getElementById("pfcPrev").value = cov.preventivoInspeccionesAnuales ?? "";
    document.getElementById("pfcBob").value = cov.reparacionBobinasPorAnio ?? "";
    document.getElementById("pfcBobAlc").value = cov.bobinasAlcance === "porEquipo" ? "porEquipo" : "flota";
    document.getElementById("pfcRep").value = (cov.reparacionesIncluidas || []).join("\n");
    document.querySelectorAll("[data-cov]").forEach((c) => (c.checked = c.dataset.cov === "incluirSLA" ? cov.incluirSLA !== false : !!cov[c.dataset.cov]));
  }
  function alcanceDesdePlan() {
    const planId = document.getElementById("pfPlan").value;
    if (!planId) { global.toast("Elegí un plan primero", true, true); return; }
    pintarAlcance({ ...CAT().derivarDePlan(planId, []).cobertura, incluirSLA: true });
    global.toast("Alcance cargado desde el plan");
  }
  function resumenAlcance(cov, equipos = []) {
    const rm = equipos.some((e) => e.modalidad === "MRI");
    const t = [];
    if (Number(cov.preventivoInspeccionesAnuales)) t.push(`${cov.preventivoInspeccionesAnuales} preventivos/año`);
    if (cov.correctivoManoObra) t.push("correctivo (mano de obra)");
    if (rm && cov.reparacionBobinasPorAnio) t.push(`bobinas: ${cov.reparacionBobinasPorAnio}${cov.bobinasAlcance === "porEquipo" ? " por equipo" : ""}`);
    if (cov.soporteRemoto) t.push("soporte remoto");
    if (rm && cov.saasMonitoreo) t.push("monitoreo Cryo");
    t.push(cov.partesIncluidas ? "repuestos incluidos" : "repuestos no incluidos");
    if ((cov.reparacionesIncluidas || []).length) t.push(`+${cov.reparacionesIncluidas.length} reparación/es de partes`);
    if (cov.viaticosIncluidos) t.push("viáticos incl.");
    return t.join(" · ");
  }

  /** Preventivo + correctivo de mano de obra; sin bobinas, repuestos ni monitoreo. */
  function alcanceSoloManoObra() {
    const prev = Number(document.getElementById("pfcPrev").value) || 2;
    pintarAlcance({ preventivoInspeccionesAnuales: prev, correctivoManoObra: true, soporteRemoto: true,
      reparacionBobinasPorAnio: "", reparacionesIncluidas: [], partesIncluidas: false, saasMonitoreo: false,
      viaticosIncluidos: false, enviosRepuestosIncluidos: false, incluirSLA: true });
  }

  // ==========================================================================
  // Formulario
  // ==========================================================================

  function renderPropForm(id) {
    const p = id ? propuestas().find((x) => x.id === id) : null;
    const d = p || E.ENTIDADES.propuestas.normalizar({ fechas: { creado: E.hoy() } });
    const bloqueado = p && ["Aceptada", "Rechazada"].includes(p.estado);

    document.getElementById("view-propform").innerHTML = `
      <a href="#propuestas" class="muted">← Propuestas</a>
      <h1 style="margin-top:8px">${p ? "Editar" : "Nueva"} <span class="hl">propuesta</span></h1>

      ${bloqueado ? `<div class="card interno" style="margin-top:14px">
        Esta propuesta ya está <b>${esc(p.estado)}</b>. Las resueltas no se editan:
        para cambiar condiciones hay que hacer una propuesta nueva, y así queda
        registro de cuántas hicieron falta.
      </div>` : `
      ${p && p.version > 1 ? `<div class="card interno" style="margin-top:14px">
        Estás editando la <b>versión ${p.version}</b>. La versión ${p.version - 1} quedó guardada tal como salió${(p.versiones || []).slice(-1)[0]?.motivo ? `; el cliente pidió: <i>${esc(p.versiones.slice(-1)[0].motivo)}</i>` : ""}.
      </div>` : ""}
      <div class="card" style="margin-top:16px">
        <div class="form-grid">
          <div class="field"><label for="pfCliente">Cliente</label>
            <input id="pfCliente" list="listaClientes" value="${esc(nombreCliente(d.clienteId) === "—" ? "" : nombreCliente(d.clienteId))}"
              placeholder="Nombre comercial" />
            <datalist id="listaClientes">
              ${clientes().map((c) => `<option value="${esc(c.nombreComercial)}"></option>`).join("")}
            </datalist></div>
          <div class="field"><label for="pfPais">País</label>
            <select id="pfPais">${E.PAIS.map((x) =>
              `<option value="${x}"${d.pais === x ? " selected" : ""}>${esc(E.PAIS_NOMBRE[x])}</option>`).join("")}</select></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="pfCanon">Canon mensual propuesto</label>
            <input type="number" id="pfCanon" min="0" step="50" value="${d.economico.canonMensual || ""}" /></div>
          <div class="field"><label for="pfMoneda">Moneda</label>
            <select id="pfMoneda">${["USD", "UF"].map((x) =>
              `<option value="${x}"${d.economico.moneda === x ? " selected" : ""}>${x}</option>`).join("")}</select></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="pfMeses">Vigencia propuesta (meses)</label>
            <input type="number" id="pfMeses" min="1" value="${d.vigenciaPropuesta.meses}" /></div>
          <div class="field"><label for="pfValidez">Validez de la propuesta (días)</label>
            <input type="number" id="pfValidez" min="1" value="${d.validezDias}" /></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="pfReferencia">Valor de referencia (opcional)</label>
            <input type="number" id="pfReferencia" min="0" step="50" value="${d.economico.valorReferencia ?? ""}"
              placeholder="Precio de lista, si el canon es una condición especial" /></div>
          <div class="field"><label for="pfFormaPago">Forma de pago</label>
            <input id="pfFormaPago" value="${esc(d.economico.formaPago)}" placeholder="Facturación mensual." /></div>
        </div>
        <div class="form-grid">
          <div class="field"><label for="pfAjuste">Ajuste</label>
            <input id="pfAjuste" value="${esc(d.economico.ajuste)}" placeholder="Anual, según variación de costos." /></div>
          <div class="field"><label for="pfInicio">Inicio estimado</label>
            <input type="date" id="pfInicio" value="${esc(d.vigenciaPropuesta.inicioEstimado || "")}" /></div>
        </div>
        ${global.bloqueTramos ? global.bloqueTramos(d.economico.tramos, "pfTramos") : ""}
        <div class="check-row" style="margin:12px 0 12px">
          <label><input type="checkbox" id="pfIVA" ${d.economico.incluyeIVA ? "checked" : ""}> El canon incluye IVA</label>
          <label><input type="checkbox" id="pfRelev" ${d.cobertura?.relevamientoInicial !== false ? "checked" : ""}> Relevamiento técnico inicial sin cargo</label>
        </div>

        <h3 style="margin-top:8px">Programa NexoCare</h3>
        <div class="form-grid">
          <div class="field"><label for="pfPlan">Nivel del programa</label>
            <select id="pfPlan"><option value="">— sin nivel —</option>${CAT().PLAN_ORDEN.map((x) =>
              `<option value="${x}"${d.plan?.id === x ? " selected" : ""}>${esc(CAT().PLANES[x].label)} (${esc(CAT().PLANES[x].precioTxt)})</option>`).join("")}</select></div>
          <div class="field"><label for="pfEtiqueta">Etiqueta que ve el cliente</label>
            <input id="pfEtiqueta" value="${esc(d.plan?.etiquetaPublica || "")}" placeholder="Por defecto, la del plan" /></div>
        </div>
        ${bloqueAlcance(d.cobertura || {})}

        <h3 style="margin-top:8px">Equipos alcanzados</h3>
        <div class="equipos-list" id="pfEquipos">${(d.equipos || []).map(filaEquipo).join("")}</div>
        <button type="button" class="btn sm" onclick="document.getElementById('pfEquipos').insertAdjacentHTML('beforeend', filaEquipoProp())">+ Equipo</button>

        <div class="field" style="margin-top:14px"><label for="pfNotas">Notas</label>
          <input id="pfNotas" value="${esc(d.notas)}" /></div>
        <p class="muted" style="font-size:13px">
          Las cláusulas no van acá: son parte del contrato.
        </p>
        <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px">
          <a class="btn ghost" href="#propuestas">Cancelar</a>
          <button class="btn primary" onclick="guardarPropuesta(${p ? `'${esc(p.id)}'` : "null"})">Guardar</button>
        </div>
      </div>`}
    `;
    // Elegir un plan precarga su alcance; después se ajusta a mano.
    const sp = document.getElementById("pfPlan");
    if (sp) sp.onchange = () => sp.value && alcanceDesdePlan();
  }

  function filaEquipo(e = {}) {
    return `<div class="eq-row">
      <input placeholder="Marca" data-eq="marca" value="${esc(e.marca || "")}">
      <input placeholder="Modelo" data-eq="modelo" value="${esc(e.modelo || "")}">
      <select data-eq="modalidad">${["MRI", "CT"].map((m) =>
        `<option${e.modalidad === m ? " selected" : ""}>${m}</option>`).join("")}</select>
      <input placeholder="Ubicación / sede" data-eq="ubicacion" value="${esc(e.ubicacion || "")}">
      ${global.camposIngreso ? global.camposIngreso(e) : ""}
      <button type="button" class="btn sm danger" aria-label="Quitar" title="Quitar" onclick="this.parentElement.remove()">✕</button>
    </div>`;
  }

  async function guardarPropuesta(id) {
    const val = (x) => document.getElementById(x).value.trim();
    const nombre = val("pfCliente");
    if (!nombre) { global.toast("Falta el cliente", true, true); return; }

    // El cliente se resuelve por nombre normalizado; si no existe, se crea.
    const clave = E.claveCliente(nombre);
    let cli = clientes().find((c) => E.claveCliente(c.nombreComercial) === clave);
    if (!cli) {
      cli = E.ENTIDADES.clientes.normalizar({
        nombreComercial: nombre, razonSocial: nombre, alias: [nombre] });
      global.state.clientes = [...clientes(), cli];
      await global.persist(`Alta cliente ${nombre}`, "clientes", cli);
    }

    const anterior = id ? propuestas().find((x) => x.id === id) : null;

    // Plan y cobertura. La cobertura se deriva del plan sólo cuando el plan
    // cambia (o no había): si se rehiciera en cada guardado, pisaría los
    // ajustes que se hayan hecho a mano sobre una propuesta ya armada.
    const planId = val("pfPlan");
    const planAnt = anterior?.plan || {};
    const modulos = planAnt.modulos || [];
    const plan = planId ? { ...planAnt, id: planId, modulos,
      etiquetaPublica: val("pfEtiqueta") || CAT().PLANES[planId].etiquetaPublica } : {};
    // El alcance se lee de lo que está en pantalla: el plan sólo lo precarga.
    // Antes se derivaba del plan al guardar y no había forma de ofrecer, por
    // ejemplo, sólo mano de obra sin bobinas. Se parte de la cobertura anterior
    // para no perder claves que el formulario no muestra (banco de horas, etc.).
    const cobertura = { ...(anterior?.cobertura || {}), ...leerAlcance() };
    const equipos = [...document.querySelectorAll("#pfEquipos .eq-row")].map((row) => {
      const o = {};
      row.querySelectorAll("[data-eq]").forEach((f) => (o[f.dataset.eq] = f.value.trim()));
      return o;
    }).filter((e) => e.marca || e.modelo || e.ubicacion);
    const tramos = global.leerTramos ? global.leerTramos("pfTramos") : (anterior?.economico?.tramos || []);
    const errTramo = global.tramosIncoherentes ? global.tramosIncoherentes(tramos) : "";
    if (errTramo) { global.toast(errTramo, true, true); return; }

    const reg = {
      ...(anterior || {}),
      id: id || undefined,
      numero: anterior?.numero || proximoNumero(),
      clienteId: cli.id,
      pais: val("pfPais"),
      economico: {
        ...(anterior?.economico || {}),
        canonMensual: val("pfCanon"), moneda: val("pfMoneda"),
        formaPago: val("pfFormaPago"), incluyeIVA: document.getElementById("pfIVA").checked,
        valorReferencia: val("pfReferencia") || null, ajuste: val("pfAjuste"),
        tramos,
      },
      plan, equipos,
      cobertura: { ...cobertura, relevamientoInicial: document.getElementById("pfRelev").checked },
      vigenciaPropuesta: { ...(anterior?.vigenciaPropuesta || {}),
        meses: val("pfMeses"), inicioEstimado: val("pfInicio") || null },
      validezDias: val("pfValidez"),
      notas: val("pfNotas"),
      fechas: anterior?.fechas || { creado: E.hoy() },
    };
    const regId = reg.id || (reg.id = E.ENTIDADES.propuestas.normalizar(reg).id);
    if (await guardar(reg, `${id ? "Edita" : "Alta"} propuesta ${reg.numero}`)) {
      // Antes volvía al listado y el documento no aparecía por ningún lado.
      // Se va al detalle, que es donde está el seguimiento, y a una propuesta
      // recién creada se le abre el documento, como hacía el alta vieja.
      global.go("propdetalle/" + regId);
      if (!id) {
        global.toast(`Propuesta ${reg.numero} creada ✓`);
        setTimeout(() => global.verDocumento("propuesta", regId), 300);
      } else {
        global.toast("Propuesta guardada");
      }
    }
  }

  /** Siguiente número de la serie PR, anual y separada de la de contratos. */
  function proximoNumero() {
    const anio = String(new Date().getFullYear());
    const rx = new RegExp(`^PR-${anio}-(\\d{4})$`);
    const max = propuestas().reduce((m, p) => {
      const g = String(p.numero || "").match(rx);
      return g ? Math.max(m, Number(g[1])) : m;
    }, 0);
    return `PR-${anio}-${String(max + 1).padStart(4, "0")}`;
  }

  // ==========================================================================
  // Cambios de etapa
  // ==========================================================================

  async function enviarPropuesta(id) {
    const p = propuestas().find((x) => x.id === id);
    if (!p) return;
    // Al enviar se decide si lleva comisión (ver vistas/comisiones.js).
    if (global.marcarComision &&
        !global.NEXO_COMISIONES.marcaDe("Propuesta", p.id, global.state?.marcasComision) &&
        !(await global.marcarComision("Propuesta", p.id, { alGuardar: "Guardar y enviar" }))) return;
    // El primer envío no se pisa: mide cuánto tardó en convertirse. Cada
    // versión guarda el suyo en `ultimoEnvio`.
    if (await guardar({ ...p, estado: "Enviada",
        fechas: { ...p.fechas, enviado: p.fechas.enviado || E.hoy(), ultimoEnvio: E.hoy() } },
        `Propuesta ${p.numero}${p.version > 1 ? ` v${p.version}` : ""} enviada`)) {
      global.toast("Propuesta marcada como enviada");
      global.router();
    }
  }

  async function aceptarPropuesta(id) {
    const p = propuestas().find((x) => x.id === id);
    if (!p) return;
    if (await guardar({ ...p, estado: "Aceptada", fechas: { ...p.fechas, resuelto: E.hoy() } },
        `Propuesta ${p.numero} aceptada`)) {
      global.toast("Aceptada · ahora se puede redactar el contrato");
      global.router();
    }
  }

  async function rechazarPropuesta(id) {
    const p = propuestas().find((x) => x.id === id);
    if (!p) return;
    const motivo = prompt(
      "Motivo del rechazo\n\nAlimenta el análisis de por qué se pierden propuestas.");
    if (!motivo) return;
    if (await guardar({ ...p, estado: "Rechazada", motivoRechazo: motivo,
        fechas: { ...p.fechas, resuelto: E.hoy() } }, `Propuesta ${p.numero} rechazada`)) {
      global.toast("Propuesta rechazada");
      global.router();
    }
  }

  /**
   * Etapa 2: crea el contrato a partir de la propuesta aceptada.
   *
   * Arrastra lo ya acordado —plan, equipos, cobertura, canon, vigencia— para
   * que nadie lo vuelva a tipear, y deja el contrato en borrador para
   * completar cláusulas y ajuste antes de firmarlo.
   */
  async function generarContrato(id) {
    const p = propuestas().find((x) => x.id === id);
    if (!p) return;
    if (p.estado !== "Aceptada") {
      global.toast("El contrato se redacta recién con la propuesta aceptada", true, true);
      return;
    }
    const cli = clientes().find((c) => c.id === p.clienteId);
    const numero = proximoNumeroContrato();

    if (!confirm(
      `Se va a crear el contrato ${numero} a partir de ${p.numero}${p.version > 1 ? ` (versión ${p.version}, acuerdo final)` : ""}.\n\n` +
      `Cliente: ${cli?.nombreComercial || "—"}\n` +
      `Canon: ${money(p.economico.canonMensual, p.economico.moneda)}/mes\n` +
      `Vigencia: ${p.vigenciaPropuesta.meses} meses\n\n` +
      `Queda en borrador para completar cláusulas y ajuste.`)) return;

    const contrato = {
      id: "ctr_" + Date.now(),
      tipo: "contrato",
      numero,
      origen: "comercial",
      propuestaId: p.id,
      clienteId: p.clienteId,
      pais: p.pais,
      estado: "borrador",
      cliente: {
        nombreComercial: cli?.nombreComercial || "",
        razonesSociales: cli?.cuit
          ? [{ razonSocial: cli.razonSocial, cuit: cli.cuit, domicilio: "", principal: true }] : [],
        contacto: cli?.contacto || "", localidad: cli?.localidad || "", provincia: cli?.provincia || "",
      },
      plan: p.plan, equipos: p.equipos, cobertura: p.cobertura,
      economico: p.economico,
      vigencia: { inicio: p.vigenciaPropuesta.inicioEstimado || "",
        meses: p.vigenciaPropuesta.meses, fin: "", renovacionAutomatica: true, preavisoDias: 30 },
      ajuste: {}, archivos: [], notas: "",
      fechas: { creado: E.hoy(), enviado: "", firmado: "" },
      historialEstados: [{ estado: "borrador", fecha: E.hoy(), usuario: global.state?.user || "—" }],
      // Qué vuelta de la negociación es la que se firma: con varias versiones,
      // sin esto no se sabe cuál de los documentos enviados es el acuerdo.
      negociacion: { desviaciones: [], versionPropuesta: p.version || 1 },
    };

    global.state.data = [...contratos(), contrato];
    await global.persist(`Contrato ${numero} desde ${p.numero}`, "contratos", contrato);
    // El vínculo de vuelta: sin esto la propuesta no sabría que ya se convirtió.
    await guardar({ ...p, contratoId: contrato.id }, `Propuesta ${p.numero} → ${numero}`);

    global.toast(`Contrato ${numero} creado en borrador`);
    location.hash = "detalle/" + contrato.id;
  }

  function proximoNumeroContrato() {
    const anio = String(new Date().getFullYear());
    const rx = new RegExp(`^CT-${anio}-(\\d{4})$`);
    const max = contratos().reduce((m, c) => {
      const g = String(c.numero || "").match(rx);
      return g ? Math.max(m, Number(g[1])) : m;
    }, 0);
    return `CT-${anio}-${String(max + 1).padStart(4, "0")}`;
  }

  // ==========================================================================

  function exportarPropuestasCSV() {
    const f = filtro();
    const filas = T.filtrar(propuestas(), f, {
      pais: (p) => p.pais, fecha: (p) => p.fechas.creado,
      estado: (p) => p.estado,
      texto: (p) => `${p.numero} ${p.numeroLegado} ${nombreCliente(p.clienteId)}`,
    });
    T.exportarCSV(filas, [
      { titulo: "numero", valor: (p) => p.numero },
      { titulo: "numero_anterior", valor: (p) => p.numeroLegado },
      { titulo: "cliente", valor: (p) => nombreCliente(p.clienteId) },
      { titulo: "pais", valor: (p) => p.pais },
      { titulo: "estado", valor: (p) => p.estado },
      { titulo: "creada", valor: (p) => p.fechas.creado },
      { titulo: "enviada", valor: (p) => p.fechas.enviado },
      { titulo: "resuelta", valor: (p) => p.fechas.resuelto },
      { titulo: "canon_mensual", valor: (p) => p.economico.canonMensual },
      { titulo: "moneda", valor: (p) => p.economico.moneda },
      { titulo: "meses", valor: (p) => p.vigenciaPropuesta.meses },
      { titulo: "contrato", valor: (p) => (p.contratoId ? numeroContrato(p.contratoId) : "") },
      { titulo: "esquema_anterior", valor: (p) => (p.esquemaAnterior ? "si" : "no") },
      { titulo: "motivo_rechazo", valor: (p) => p.motivoRechazo },
    ], "propuestas");
    global.toast(`CSV: ${filas.length} propuesta(s)${T.hayFiltro(f) ? " (filtradas)" : ""}`);
  }

  function limpiarFiltroProp() {
    global.state.filtroProp = { pais: "", mes: "", estado: "", q: "", pagina: 1 };
    renderPropuestas();
  }
  function irPaginaProp(n) { filtro().pagina = Number(n); renderPropuestas(); }

  global.NEXO_VISTAS = global.NEXO_VISTAS || {};
  Object.assign(global.NEXO_VISTAS, {
    propuestas: renderPropuestas,
    propdetalle: () => renderPropDetalle(location.hash.split("/")[1]),
    propform: () => renderPropForm(location.hash.split("/")[1]),
  });

  Object.assign(global, {
    filaEquipoProp: filaEquipo, guardarPropuesta, enviarPropuesta, aceptarPropuesta, rechazarPropuesta,
    nuevaVersionPropuesta, alcanceDesdePlan, alcanceSoloManoObra,
    generarContrato, exportarPropuestasCSV, limpiarFiltroProp, irPaginaProp,
  });
})(typeof window !== "undefined" ? window : globalThis);
