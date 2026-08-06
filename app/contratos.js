/**
 * Área de Contratos: tablero, pipeline, listado, agenda, detalle,
 * ajustes de canon, archivos, cobertura, formulario y exportaciones.
 *
 * Parte de la aplicación, dividida por dominio. Todos los archivos de
 * app/ comparten el ámbito global: se cargan en orden y las constantes
 * declaradas antes son visibles después. El orden importa.
 */

function renderDashboard() {
  const el = document.getElementById("view-dashboard");
  const vigentes = state.data.filter((c) => ACTIVOS.has(c.estado));
  const pipeline = state.data.filter((c) => ["borrador", "enviada", "negociacion"].includes(c.estado));
  const mrr = vigentes.reduce((s, c) => s + (Number(c.economico?.canonMensual) || 0), 0);
  const { venc, aum, pend } = calcAlertas();
  // MRR por nivel NexoCare (dona)
  const nivelItems = CAT.PLAN_ORDEN.map((id) => {
    const v = vigentes.filter((c) => c.plan?.id === id).reduce((s, c) => s + (Number(c.economico?.canonMensual) || 0), 0);
    return { label: CAT.PLANES[id].label, value: v, text: moneyK(v) };
  }).filter((i) => i.value > 0);
  const sinNivel = vigentes.filter((c) => !c.plan?.id).reduce((s, c) => s + (Number(c.economico?.canonMensual) || 0), 0);
  if (sinNivel) nivelItems.push({ label: "Sin nivel", value: sinNivel, text: moneyK(sinNivel) });
  // Vencimientos por mes (próximos 6)
  const vmeses = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const n = vigentes.filter((c) => { const f = computeFin(c); return f && `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}` === key; }).length;
    vmeses.push({ label: d.toLocaleDateString("es-AR", { month: "short" }), value: n, text: String(n) });
  }

  el.innerHTML = `
    <div class="kicker">Panel general</div>
    <div class="page-head">
      <h1>Tablero de <span class="accent">contratos</span></h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" onclick="exportarInforme()">📄 Informe para dirección</button>
        <button class="btn sm" onclick="exportarCSV()">⬇ CSV</button>
      </div>
    </div>
    ${barraPais()}
    <div class="grid-kpi">
      ${kpi("Contratos vigentes", vigentes.length, "en servicio activo")}
      ${kpi("En pipeline", pipeline.length, "propuestas abiertas")}
      ${kpi("Ingreso mensual (MRR)", money(mrr), `${money(mrr * 12)} anualizado`)}
      ${kpi("Por vencer", venc.length, "≤ 30 días", venc.length ? "warn" : "")}
      ${kpi("Ajustes sin registrar", pend.length, pend.length ? "revisar si se aplicaron" : "todo al día", pend.length ? "danger" : "")}
    </div>
    <div class="dir-2col">
      <div class="card"><h3>MRR por nivel NexoCare</h3>
        ${nivelItems.some((i) => i.value) ? `<div class="chart-donut-row">${chartDonut(nivelItems, { centro: moneyK(mrr) })}${chartLegend(nivelItems)}</div>` : `<p class="muted">Sin contratos vigentes con nivel asignado.</p>`}</div>
      <div class="card"><h3>Vencimientos por mes <span class="muted" style="font-weight:400">· próximos 6</span></h3>
        ${vmeses.some((m) => m.value) ? chartColumns(vmeses) : `<p class="muted">Sin vencimientos en los próximos 6 meses.</p>`}</div>
    </div>
    ${pend.length ? `<div class="card alert-panel danger">
      <h3>⚠ Ajustes de canon sin registrar</h3>
      <p class="muted" style="font-size:13.5px;margin:0 0 10px">Estas fechas de ajuste ya pasaron y el sistema no tiene registro de que se hayan aplicado. Un ajuste no aplicado no se recupera y arrastra la base del período siguiente.</p>
      ${pend.map((p) => `<div class="alert-row" onclick="location.hash='detalle/${p.c.id}'" style="cursor:pointer">
        <span class="tag pend">${p.fechas.length} sin registrar</span>
        <b>${esc(p.c.numero)}</b> · ${esc(nombreCliente(p.c))}
        <span style="flex:1"></span>
        <span class="muted">${p.fechas.map(fmt).join(" · ")}</span>
      </div>`).join("")}
    </div>` : ""}
    <div class="card alert-panel">
      <h3>🔔 Próximas acciones</h3>
      ${venc.length || aum.length ? [
        ...venc.map((v) => alertRow("venc", "Vence", v.c, `${fmt(v.fin)} · faltan ${v.dias} días`)),
        ...aum.map((a) => alertRow("aum", "Aumento", a.c, `${fmt(a.fecha)} · ${a.c.ajuste?.periodicidad} · faltan ${a.dias} días`)),
      ].join("") : `<p class="muted">Sin vencimientos ni aumentos dentro de los umbrales. ✅</p>`}
    </div>
    <div class="card">
      <h3>Cartera por estado</h3>
      ${renderBarras()}
    </div>`;
}
// El número es el protagonista de la tarjeta, pero un importe largo
// ("US$ 19.700 · $ 800.000") no puede desbordarla: la escala baja por tramos
// según cuántos caracteres tenga el valor.
function kpi(label, num, sub, tone = "") {
  const txt = String(num);
  const size = txt.length > 22 ? "xs" : txt.length > 15 ? "sm" : txt.length > 9 ? "md" : "lg";
  return `<div class="kpi${tone ? " " + tone : ""}">
    <div class="label">${label}</div>
    <div class="num num-${size}">${num}</div>
    ${sub ? `<div class="sub">${sub}</div>` : ""}
  </div>`;
}
function alertRow(tipo, tag, c, detail) {
  return `<div class="alert-row" onclick="location.hash='detalle/${c.id}'" style="cursor:pointer">
    <span class="tag ${tipo}">${tag}</span>
    <b>${esc(c.numero)}</b> · ${esc(nombreCliente(c))}
    <span class="spacer" style="flex:1"></span>
    <span class="muted">${detail}</span></div>`;
}
function renderBarras() {
  const counts = {};
  ESTADOS.forEach((e) => (counts[e.id] = 0));
  state.data.forEach((c) => (counts[c.estado] = (counts[c.estado] || 0) + 1));
  const max = Math.max(1, ...Object.values(counts));
  return `<div style="display:flex;flex-direction:column;gap:8px">${ESTADOS.filter((e) => counts[e.id]).map((e) => `
    <div style="display:flex;align-items:center;gap:10px">
      <span style="width:130px;font-size:13px;color:var(--taupe)">${e.label}</span>
      <div style="flex:1;background:var(--surface-2);border-radius:8px;height:22px;overflow:hidden">
        <div style="width:${(counts[e.id] / max) * 100}%;height:100%;background:var(--orange);border-radius:8px"></div>
      </div>
      <b style="width:26px;text-align:right">${counts[e.id]}</b>
    </div>`).join("")}</div>`;
}

// ============================================================
//  Vista: Pipeline (kanban)
// ============================================================
function renderPipeline() {
  const el = document.getElementById("view-pipeline");
  el.innerHTML = `
    <div class="kicker">Flujo comercial</div>
    <div class="page-head"><h1>Pipeline de <span class="accent">propuestas</span></h1></div>
    <div class="kanban">${KANBAN_COLS.map((estId) => {
      const items = state.data.filter((c) => c.estado === estId);
      return `<div class="kcol"><h4>${ESTADO_LABEL[estId]} <span class="count">${items.length}</span></h4>
        ${items.map(kcard).join("") || '<p class="muted" style="font-size:13px">—</p>'}</div>`;
    }).join("")}</div>`;
}
function kcard(c) {
  const next = nextEstado(c.estado);
  return `<div class="kcard">
    <div class="cli" onclick="location.hash='detalle/${c.id}'" style="cursor:pointer">${esc(nombreCliente(c))}</div>
    <div class="meta">${esc(c.numero)} · ${c.equipos?.length || 0} equipos</div>
    <div class="row"><span class="num-usd">${money(c.economico?.canonMensual)}/mes</span>
      ${next && !state.soloLectura ? `<button class="btn sm" onclick="avanzar('${c.id}')">→ ${ESTADO_LABEL[next]}</button>` : ""}
    </div></div>`;
}
function nextEstado(est) {
  const flujo = ["borrador", "enviada", "negociacion", "firme_vigente"];
  const i = flujo.indexOf(est);
  return i >= 0 && i < flujo.length - 1 ? flujo[i + 1] : null;
}
async function avanzar(id) {
  const c = state.data.find((x) => x.id === id);
  const next = nextEstado(c.estado);
  if (!next) return;
  if (next === "firme_vigente" && !c.vigencia?.inicio) {
    const f = prompt("Fecha de inicio de vigencia (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!f) return;
    c.vigencia.inicio = f;
    c.tipo = "contrato";
    c.fechas.firmado = f;
  }
  await cambiarEstado(c, next);
}
async function cambiarEstado(c, nuevo) {
  c.estado = nuevo;
  c.historialEstados = c.historialEstados || [];
  c.historialEstados.push({ estado: nuevo, fecha: new Date().toISOString().slice(0, 10), usuario: state.user || "—" });
  try {
    await persist(`Estado ${c.numero} → ${nuevo}`);
    toast(`${c.numero}: ${ESTADO_LABEL[nuevo]}`);
    router();
  } catch (e) { toast("Error: " + e.message, true, true); }
}

// ============================================================
//  Vista: Listado
// ============================================================
function renderListado() {
  const el = document.getElementById("view-listado");
  const rows = filtrados();
  el.innerHTML = `
    <div class="kicker">Base completa</div>
    <div class="page-head">
      <h1>Todos los <span class="accent">contratos</span></h1>
      <div style="display:flex;gap:8px">
        <button class="btn sm" onclick="exportarCSV()">⬇ CSV</button>
        <button class="btn sm" onclick="exportarInforme()">⬇ Informe PDF</button>
      </div>
    </div>
    <div class="table-tools">
      <input type="search" id="fq" placeholder="Buscar cliente o N°…" value="${esc(state.filtro.q)}" />
      <select id="festado"><option value="">Todos los estados</option>${ESTADOS.map((e) => `<option value="${e.id}" ${state.filtro.estado === e.id ? "selected" : ""}>${e.label}</option>`).join("")}</select>
      <select id="fmod"><option value="">Toda modalidad</option><option value="MRI" ${state.filtro.modalidad === "MRI" ? "selected" : ""}>MRI</option><option value="CT" ${state.filtro.modalidad === "CT" ? "selected" : ""}>CT</option></select>
      <span class="muted" style="font-size:13px">${rows.length} de ${state.data.length}</span>
    </div>
    <div class="overflow"><table class="data">
      <thead><tr>
        <th style="width:34px"><input type="checkbox" id="selAll"></th>
        <th>N°</th><th>Cliente</th><th>Equipos</th><th>Estado</th><th>Canon</th><th>Vence</th><th>Próx. ajuste</th>
      </tr></thead>
      <tbody>${rows.map(trContrato).join("") || `<tr><td colspan="8" class="empty">Sin resultados</td></tr>`}</tbody>
    </table></div>`;
  document.getElementById("fq").oninput = (e) => { state.filtro.q = e.target.value; renderListado(); };
  document.getElementById("festado").onchange = (e) => { state.filtro.estado = e.target.value; renderListado(); };
  document.getElementById("fmod").onchange = (e) => { state.filtro.modalidad = e.target.value; renderListado(); };
  document.getElementById("selAll").onclick = (e) => {
    rows.forEach((c) => (e.target.checked ? state.selected.add(c.id) : state.selected.delete(c.id)));
    renderListado();
  };
}
function filtrados() {
  return state.data.filter((c) => {
    const q = state.filtro.q.toLowerCase();
    // busca por N°, nombre de fantasía, cualquier razón social y cualquier CUIT
    const rs = (c.cliente?.razonesSociales || []).map((r) => `${r.razonSocial} ${r.cuit}`).join(" ");
    if (q && !(`${c.numero} ${c.cliente?.nombreComercial || ""} ${rs}`.toLowerCase().includes(q))) return false;
    if (state.filtro.estado && c.estado !== state.filtro.estado) return false;
    if (state.filtro.modalidad && !c.equipos?.some((e) => e.modalidad === state.filtro.modalidad)) return false;
    return true;
  });
}
function trContrato(c) {
  const fin = computeFin(c), dv = daysUntil(fin);
  const pa = computeProximoAjuste(c), da = daysUntil(pa);
  const vencTxt = fin ? `${fmt(fin)}${dv !== null && dv <= 30 ? ` <span class="badge por_vencer">${dv}d</span>` : ""}` : "—";
  const ajTxt = pa ? `${fmt(pa)}${da !== null && da <= 15 ? ` <span class="badge por_vencer">${da}d</span>` : ""}` : "—";
  return `<tr onclick="location.hash='detalle/${c.id}'">
    <td onclick="event.stopPropagation()"><input type="checkbox" ${state.selected.has(c.id) ? "checked" : ""} onclick="toggleSel('${c.id}',this.checked)"></td>
    <td><b>${esc(c.numero)}</b></td>
    <td><b>${esc(nombreCliente(c))}</b>${(() => {
      const rss = c.cliente?.razonesSociales || [];
      const p = rsPrincipal(c).razonSocial;
      if (!p || p === nombreCliente(c)) return "";
      return `<br><span class="muted" style="font-size:12px">${esc(p)}${rss.length > 1 ? ` · +${rss.length - 1} razón/es social/es` : ""}</span>`;
    })()}</td>
    <td>${(c.equipos || []).length} <span class="muted">(${[...new Set((c.equipos || []).map((e) => e.modalidad))].join("/")})</span></td>
    <td><span class="badge ${c.estado}">${ESTADO_LABEL[c.estado]}</span></td>
    <td>${money(c.economico?.canonMensual)}</td>
    <td>${vencTxt}</td>
    <td>${ajTxt}</td></tr>`;
}
function toggleSel(id, on) { on ? state.selected.add(id) : state.selected.delete(id); }

// ============================================================
//  Vista: Agenda (vencimientos y aumentos)
// ============================================================
function renderAgenda() {
  const el = document.getElementById("view-agenda");
  const items = [];
  for (const c of state.data) {
    if (!ACTIVOS.has(c.estado)) continue;
    const fin = computeFin(c);
    if (fin) items.push({ c, fecha: fin, tipo: "venc", dias: daysUntil(fin) });
    const pa = computeProximoAjuste(c);
    if (pa) items.push({ c, fecha: pa, tipo: "aum", dias: daysUntil(pa) });
  }
  items.sort((a, b) => a.fecha - b.fecha);
  el.innerHTML = `
    <div class="kicker">Calendario</div>
    <div class="page-head"><h1>Vencimientos y <span class="accent">aumentos</span></h1></div>
    <div class="card">
      ${items.length ? `<div class="overflow"><table class="data"><thead><tr><th>Fecha</th><th>Tipo</th><th>Contrato</th><th>Detalle</th><th>Faltan</th></tr></thead><tbody>
      ${items.map((i) => `<tr onclick="location.hash='detalle/${i.c.id}'">
        <td><b>${fmt(i.fecha)}</b></td>
        <td><span class="tag ${i.tipo}">${i.tipo === "venc" ? "Vencimiento" : "Aumento"}</span></td>
        <td>${esc(i.c.numero)} · ${esc(nombreCliente(i.c))}</td>
        <td class="muted">${i.tipo === "venc" ? "Fin de vigencia" : `Ajuste ${i.c.ajuste?.periodicidad} (${i.c.ajuste?.indice})`}</td>
        <td>${i.dias < 0 ? '<span class="badge vencida">vencido</span>' : `${i.dias} días${i.dias <= 15 ? ' <span class="badge por_vencer">pronto</span>' : ""}`}</td>
      </tr>`).join("")}
      </tbody></table></div>` : `<p class="empty">No hay contratos vigentes con fechas cargadas todavía.</p>`}
    </div>`;
}

// ============================================================
//  Vista: Detalle
// ============================================================
function renderDetalle(id) {
  const c = state.data.find((x) => x.id === id);
  const el = document.getElementById("view-detalle");
  if (!c) { el.innerHTML = `<p class="empty">No encontrado. <a href="#listado">Volver</a></p>`; return; }
  const fin = computeFin(c), pa = computeProximoAjuste(c);
  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="kicker">${c.tipo === "contrato" ? "Contrato" : "Propuesta"} · <span class="badge ${c.estado}">${ESTADO_LABEL[c.estado]}</span></div>
        <h1>${esc(nombreCliente(c))}</h1>
        <p class="muted">${esc(c.numero)} · ${esc(c.cliente?.contacto || "")} · ${esc(c.cliente?.localidad || "")}</p>
        ${c.plan?.id ? `<p style="margin:4px 0 0"><span class="pill-plan">${esc(CAT.PLANES[c.plan.id]?.label || c.plan.id)}</span>
          ${(c.plan.modulos || []).length ? `<span class="pill-int" title="Uso interno · no aparece en el documento del cliente">🔒 ${c.plan.modulos.length} módulo${c.plan.modulos.length > 1 ? "s" : ""} interno${c.plan.modulos.length > 1 ? "s" : ""}</span>` : ""}</p>` : ""}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${state.soloLectura ? "" : `<button class="btn sm" onclick="location.hash='form/${c.id}'">✎ Editar</button>`}
        <button class="btn sm primary" onclick="verDocumento('contrato','${c.id}')">👁 Ver documento</button>
        <button class="btn sm" onclick="generarDocx('${c.id}')" title="Descarga un .docx editable en Word">⬇ Descargar .docx</button>
        ${!state.soloLectura && c.estado !== "firme_vigente" && ["enviada", "negociacion", "borrador"].includes(c.estado) ? `<button class="btn primary sm" onclick="hacerFirme('${c.id}')">✔ Marcar firme</button>` : ""}
      </div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="card"><h3>Cobertura por equipo</h3>${renderCoverage(c)}</div>
        ${(c.cobertura?.reparacionesIncluidas || []).length ? `<div class="card"><h3>Reparaciones / partes incluidas</h3>
          <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7">${c.cobertura.reparacionesIncluidas.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
        <div class="card"><h3>Alcance del servicio</h3><div class="check-row">
          ${coberturaChips(c)}
        </div></div>
        ${renderComposicionInterna(c)}
        ${renderArchivos(c)}
      </div>
      <div>
        <div class="card"><h3>Datos económicos</h3>
          <dl class="kv">
            <dt>Canon mensual</dt><dd><b>${money(c.economico?.canonMensual, c.economico?.moneda)}</b> ${c.economico?.incluyeIVA ? "(IVA incl.)" : "+ IVA"}</dd>
            ${!c.economico?.incluyeIVA && c.economico?.canonMensual ? `<dt>Total c/ IVA ${c.economico?.ivaPct ?? 21}%</dt><dd>${money(Math.round(Number(c.economico.canonMensual) * (1 + (Number(c.economico?.ivaPct ?? 21) / 100))), c.economico?.moneda)}</dd>` : ""}
            <dt>Forma de pago</dt><dd>${esc(c.economico?.formaPago || "—")}</dd>
            <dt>Ajuste</dt><dd>${c.ajuste?.periodicidad || "—"} · ${c.ajuste?.indice || ""}</dd>
            <dt>Próximo ajuste</dt><dd>${fmt(pa)}</dd>
          </dl>
        </div>
        ${renderAjustes(c)}
        <div class="card"><h3>Vigencia</h3>
          <dl class="kv">
            <dt>Inicio</dt><dd>${fmt(c.vigencia?.inicio)}</dd>
            <dt>Duración</dt><dd>${c.vigencia?.meses || "—"} meses</dd>
            <dt>Vencimiento</dt><dd><b>${fmt(fin)}</b></dd>
            <dt>Renovación</dt><dd>${c.vigencia?.renovacionAutomatica ? "Automática" : "Manual"} · preaviso ${c.vigencia?.preavisoDias || 0}d</dd>
          </dl>
        </div>
        <div class="card"><h3>Identidad del cliente</h3>
          <dl class="kv">
            <dt>Nombre comercial</dt><dd><b>${esc(c.cliente?.nombreComercial || "—")}</b></dd>
          </dl>
          <h4 style="margin:10px 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--taupe)">Razones sociales</h4>
          ${(c.cliente?.razonesSociales || []).length ? `<ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.7">
            ${c.cliente.razonesSociales.map((r) => `<li>${esc(r.razonSocial)} ${r.cuit ? `<span class="muted">· CUIT ${esc(r.cuit)}</span>` : ""} ${r.principal ? '<span class="pill-plan" style="font-size:10px">factura / firma</span>' : ""}</li>`).join("")}
          </ul>` : `<p class="muted" style="font-size:13px">Sin razones sociales cargadas.</p>`}
        </div>
        <div class="card"><h3>Trazabilidad</h3>
          <ul class="tl">${(c.historialEstados || []).slice().reverse().map((h) => `<li><span class="est">${ESTADO_LABEL[h.estado] || h.estado}</span> <span class="fch">${fmt(h.fecha)} · ${esc(h.usuario || "")}</span></li>`).join("")}</ul>
        </div>
        ${c.notas ? `<div class="card"><h3>Notas</h3><p style="font-size:14px">${esc(c.notas)}</p></div>` : ""}
      </div>
    </div>
    <p style="margin-top:14px"><a href="#listado">← Volver al listado</a></p>`;
}
// ---- Ajustes de canon: historial, pendientes y registro ----
function renderAjustes(c) {
  const step = AJUSTE_STEP[c.ajuste?.periodicidad] || 0;
  if (!step) return "";
  const pend = ajustesPendientes(c);
  const hist = (c.ajuste?.historial || []).slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const canon = Number(c.economico?.canonMensual) || 0;
  const m = c.economico?.moneda;
  const ro = state.soloLectura;
  return `<div class="card${pend.length ? " alerta" : ""}"><h3>Ajustes de canon</h3>
    ${pend.length ? `<div class="pend-box">
      <b>${pend.length} ajuste${pend.length > 1 ? "s" : ""} sin registrar</b>
      <div class="muted" style="font-size:12.5px;margin-top:2px">${pend.map(fmt).join(" · ")}</div>
      ${ro ? "" : `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn sm" onclick="regularizarAjustes('${c.id}')" title="Marca los anteriores como ya aplicados fuera del sistema, sin tocar el canon">Ya estaban aplicados</button>
      </div>`}
    </div>` : `<p class="muted" style="font-size:13px;margin:0 0 10px">Ajustes al día. ✅</p>`}

    ${ro ? "" : `<div class="aj-form">
      <div class="aj-row">
        <label>Fecha<input type="date" id="ajFecha" value="${(pend[0] ? pend[0] : hoy()).toISOString().slice(0, 10)}"></label>
        <label>%<input type="number" step="0.01" id="ajPct" placeholder="0.00" oninput="calcAjuste('${c.id}')"></label>
        <label>Canon nuevo<input type="number" step="0.01" id="ajCanon" placeholder="${canon}" oninput="calcAjustePct('${c.id}')"></label>
      </div>
      <button class="btn primary sm" onclick="registrarAjuste('${c.id}')">Registrar ajuste</button>
      <span class="muted" style="font-size:12px" id="ajHint">Canon actual: ${money(canon, m)}</span>
    </div>`}

    ${hist.length ? `<table class="aj-hist">
      <thead><tr><th>Fecha</th><th>%</th><th>Canon</th><th>Quién</th></tr></thead>
      <tbody>${hist.map((h) => `<tr>
        <td>${fmt(h.fecha)}</td>
        <td>${h.porcentaje != null && h.porcentaje !== "" ? `<b>${h.porcentaje > 0 ? "+" : ""}${h.porcentaje}%</b>` : "—"}</td>
        <td>${h.canonAnterior ? `<span class="muted">${money(h.canonAnterior, m)} →</span> ` : ""}${h.canonNuevo ? money(h.canonNuevo, m) : "—"}</td>
        <td class="muted">${esc(h.usuario || "—")}${h.nota ? ` · ${esc(h.nota)}` : ""}</td>
      </tr>`).join("")}</tbody></table>`
      : `<p class="muted" style="font-size:12.5px;margin:8px 0 0">Todavía no hay ajustes registrados.</p>`}
  </div>`;
}
// Los dos campos se completan entre sí: cargás el % y sale el canon, o al revés.
function calcAjuste(id) {
  const c = state.data.find((x) => x.id === id);
  const base = Number(c.economico?.canonMensual) || 0;
  const pct = parseFloat(document.getElementById("ajPct").value);
  if (isNaN(pct)) return;
  document.getElementById("ajCanon").value = Math.round(base * (1 + pct / 100) * 100) / 100;
  hintAjuste(c, base);
}
function calcAjustePct(id) {
  const c = state.data.find((x) => x.id === id);
  const base = Number(c.economico?.canonMensual) || 0;
  const nuevo = parseFloat(document.getElementById("ajCanon").value);
  if (isNaN(nuevo) || !base) return;
  document.getElementById("ajPct").value = Math.round((nuevo / base - 1) * 10000) / 100;
  hintAjuste(c, base);
}
function hintAjuste(c, base) {
  const nuevo = parseFloat(document.getElementById("ajCanon").value);
  const el = document.getElementById("ajHint");
  if (!el) return;
  el.textContent = isNaN(nuevo)
    ? `Canon actual: ${money(base, c.economico?.moneda)}`
    : `${money(base, c.economico?.moneda)} → ${money(nuevo, c.economico?.moneda)} · ${money(Math.round((nuevo - base) * 12), c.economico?.moneda)}/año de diferencia`;
}
async function registrarAjuste(id) {
  const c = state.data.find((x) => x.id === id);
  const fecha = document.getElementById("ajFecha").value;
  const pct = document.getElementById("ajPct").value;
  const nuevo = Number(document.getElementById("ajCanon").value);
  if (!fecha) { toast("Falta la fecha del ajuste", true, true); return; }
  if (!nuevo || nuevo <= 0) { toast("Falta el canon nuevo", true, true); return; }
  const anterior = Number(c.economico?.canonMensual) || 0;
  c.ajuste.historial = c.ajuste.historial || [];
  c.ajuste.historial.push({
    fecha, porcentaje: pct === "" ? null : Number(pct),
    canonAnterior: anterior, canonNuevo: nuevo,
    usuario: state.user || "—",
  });
  c.economico.canonMensual = nuevo;
  try {
    await persist(`Ajuste ${c.numero} · ${money(anterior)} → ${money(nuevo)}`);
    toast(`Ajuste registrado · canon ${money(nuevo)}`);
    router();
  } catch (e) { toast("Error: " + e.message, true, true); }
}
// Contratos cargados a mitad de vida: los ajustes previos ya se aplicaron
// fuera del sistema. Se marca la línea de corte sin tocar el canon.
async function regularizarAjustes(id) {
  const c = state.data.find((x) => x.id === id);
  const pend = ajustesPendientes(c);
  if (!confirm(`¿Marcar ${pend.length} ajuste(s) anterior(es) como ya aplicados fuera del sistema?\n\nNo modifica el canon actual (${money(c.economico?.canonMensual)}). A partir de acá el sistema controla solo los nuevos.`)) return;
  c.ajuste.controlDesde = new Date().toISOString().slice(0, 10);
  c.ajuste.historial = c.ajuste.historial || [];
  c.ajuste.historial.push({
    fecha: c.ajuste.controlDesde, porcentaje: null,
    canonAnterior: null, canonNuevo: Number(c.economico?.canonMensual) || null,
    usuario: state.user || "—", nota: "regularización de ajustes previos al sistema",
  });
  try {
    await persist(`Regulariza ajustes previos · ${c.numero}`);
    toast("Ajustes anteriores regularizados");
    router();
  } catch (e) { toast("Error: " + e.message, true, true); }
}

// ---- Composición interna: SOLO para el equipo Nexolibre. No se imprime. ----
function renderComposicionInterna(c) {
  const plan = CAT.PLANES[c.plan?.id];
  if (!plan) return "";
  const mods = (c.plan.modulos || []).map((m) => CAT.MODULOS[m]).filter(Boolean);
  const der = CAT.derivarDePlan(c.plan.id, c.plan.modulos || []);
  const canon = Number(c.economico?.canonMensual) || 0;
  const delta = canon - der.valorSugerido;
  const desv = c.negociacion?.desviaciones || [];
  return `<div class="card interno">
    <h3>🔒 Composición interna <span class="muted" style="font-weight:400;font-size:12px">— no aparece en el documento del cliente</span></h3>
    <p style="font-size:14px;margin:0 0 10px">
      El cliente lee <b>«${esc(c.plan.etiquetaPublica || plan.etiquetaPublica)}»</b>. Por dentro es:
    </p>
    <div class="check-row">
      <span class="pill-plan">${esc(plan.label)}</span>
      ${mods.map((m) => `<span class="pill-int" title="${esc(m.desc)}">+ ${esc(m.label)}</span>`).join("")}
    </div>
    <dl class="kv" style="margin-top:12px">
      <dt>Valor de referencia</dt><dd>${money(der.valorSugerido)}/mes ${mods.length ? `<span class="muted">(base ${money(plan.desde || 0)} + módulos)</span>` : ""}</dd>
      <dt>Canon pactado</dt><dd><b>${money(canon)}</b>/mes</dd>
      <dt>Diferencia</dt><dd style="color:${delta < 0 ? "var(--warn)" : "inherit"}"><b>${delta >= 0 ? "+" : ""}${money(delta)}</b> ${delta < 0 ? "— por debajo de la referencia" : ""}</dd>
      <dt>SLA efectivo</dt><dd>remoto ${der.sla.remoto} h · on-site ${der.sla.onsite} h · repuesto ${der.sla.repuesto} h</dd>
    </dl>
    ${desv.length ? `<h4 style="margin:12px 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--taupe)">Cambios acordados en la negociación</h4>
      <ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.7">${desv.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
    ${c.plan.notasInternas ? `<p class="muted" style="font-size:13px;margin-top:10px">${esc(c.plan.notasInternas)}</p>` : ""}
  </div>`;
}

// ---- Documentos adjuntos (propuesta, acuerdo final negociado, firmado) ----
function renderArchivos(c) {
  const arr = c.archivos || [];
  const base = `https://github.com/${CFG.owner}/${CFG.dataRepo}/blob/${CFG.branch}/`;
  return `<div class="card"><h3>Documentos del expediente</h3>
    ${arr.length ? `<ul class="files">${arr.map((a, i) => `<li>
      <span class="pill-modal">${TIPO_ARCHIVO[a.tipo] || a.tipo || "Archivo"}</span>
      ${a.path ? `<a href="${base}${encodeURI(a.path)}" target="_blank" rel="noopener">${esc(a.nombre)}</a>` : `<span>${esc(a.nombre)}</span> <span class="muted">(sin subir)</span>`}
      ${a.fecha ? `<span class="muted"> · ${fmt(a.fecha)}</span>` : ""}
      ${state.soloLectura ? "" : `<button class="btn sm danger" onclick="quitarArchivo('${c.id}',${i})">✕</button>`}
    </li>`).join("")}</ul>` : `<p class="muted" style="font-size:13px">Todavía no hay documentos adjuntos.</p>`}
    ${state.soloLectura ? "" : `<div class="upload-row">
      <select id="upTipo">${Object.entries(TIPO_ARCHIVO).map(([k, v]) => `<option value="${k}" ${k === "acuerdo_final" ? "selected" : ""}>${v}</option>`).join("")}</select>
      <input type="file" id="upFile" accept=".pdf,.doc,.docx,.png,.jpg">
      <button class="btn sm primary" onclick="subirArchivo('${c.id}')">⬆ Adjuntar</button>
    </div>
    <p class="muted" style="font-size:12px;margin:8px 0 0">El contrato firmado casi nunca es idéntico al modelo: subí acá la versión final negociada para que quede como documento de referencia del expediente.</p>`}
  </div>`;
}

async function subirArchivo(id) {
  const c = state.data.find((x) => x.id === id);
  const inp = document.getElementById("upFile");
  const tipo = document.getElementById("upTipo").value;
  const file = inp.files[0];
  if (!file) { toast("Elegí un archivo primero", true, true); return; }
  if (state.mode !== "connected") { toast("Necesitás estar conectado para adjuntar archivos", true, true); return; }
  toast("Subiendo…");
  try {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const safe = file.name.replace(/[^\w.\- ]/g, "_");
    const path = `archivos/${c.numero}/${safe}`;
    await ghUploadFile(path, b64, `Adjunto ${TIPO_ARCHIVO[tipo]} · ${c.numero}`);
    c.archivos = c.archivos || [];
    c.archivos.push({ nombre: safe, path, tipo, fecha: new Date().toISOString().slice(0, 10), usuario: state.user || "—" });
    await persist(`Adjunto ${safe} · ${c.numero}`);
    toast("Adjuntado ✓");
    router();
  } catch (e) { toast("Error al subir: " + e.message, true, true); }
}
async function quitarArchivo(id, i) {
  const c = state.data.find((x) => x.id === id);
  if (!confirm(`¿Quitar «${c.archivos[i]?.nombre}» del expediente?\n(El archivo queda en el repositorio; solo se saca de la ficha.)`)) return;
  c.archivos.splice(i, 1);
  await persist(`Quita adjunto · ${c.numero}`);
  router();
}

function renderCoverage(c) {
  const cov = c.cobertura || {};
  const val = {
    preventivo: cov.preventivoInspeccionesAnuales ? `${cov.preventivoInspeccionesAnuales}×` : null,
    correctivo: cov.correctivoManoObra,
    bobinas: cov.reparacionBobinasPorAnio ? bobinasTexto(c) : false,
    cryo: cov.saasMonitoreo,
    partes: cov.partesIncluidas,
  };
  const cellFor = (srv, modalidad) => {
    // El servicio no existe en este tipo de equipo: no es una exclusión
    // comercial, es que físicamente no aplica.
    if (!aplicaA(srv, modalidad)) return `<span class="na" title="No aplica a ${modalidad}">n/a</span>`;
    const v = val[srv.key];
    if (typeof v === "string") return `<span class="chk">✓ ${v}</span>`;
    if (v === true) return `<span class="chk">✓</span>`;
    if (srv.key === "partes") return `<span class="exc">excl.</span>`;
    return `<span class="no">—</span>`;
  };
  return `<div class="overflow"><table class="cover">
    <thead><tr><th>Equipo</th>${SERVICIOS.map((s) => `<th>${s.label}</th>`).join("")}</tr></thead>
    <tbody>${(c.equipos || []).map((e) => `<tr><td><b>${esc(e.marca)} ${esc(e.modelo)}</b> <span class="pill-modal">${e.modalidad}</span></td>${SERVICIOS.map((s) => `<td>${cellFor(s, e.modalidad)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>
  ${(() => {
    const notas = [];
    const cov = c.cobertura || {};
    // Sin esta aclaración, ver "2/año" repetido en cada fila se lee como 2 por equipo.
    if (cov.reparacionBobinasPorAnio && !bobinasIlimitadas(c) && tieneMRI(c)) {
      const flota = cov.bobinasAlcance !== "porEquipo";
      notas.push(flota
        ? `<b>Bobinas:</b> el cupo de ${cov.reparacionBobinasPorAnio} reparación/es al año es <b>para el conjunto</b> de los ${cantMRI(c)} equipo/s de RM, no por cada uno. Total anual: <b>${bobinasTotal(c)}</b>.`
        : `<b>Bobinas:</b> ${cov.reparacionBobinasPorAnio} reparación/es al año <b>por cada</b> equipo de RM (${cantMRI(c)} equipos). Total anual: <b>${bobinasTotal(c)}</b>.`);
    }
    if ((c.equipos || []).some((e) => e.modalidad === "CT")) {
      notas.push(`<b>n/a</b>: la reparación de bobinas y el monitoreo criogénico son propios de resonancia; los equipos de CT quedan cubiertos por preventivo, correctivo y el resto del alcance.`);
    }
    return notas.length ? `<p class="muted" style="font-size:12px;margin:8px 0 0;line-height:1.6">${notas.join("<br>")}</p>` : "";
  })()}`;
}
function coberturaChips(c) {
  const cov = c.cobertura || {};
  const chips = [];
  if (cov.preventivoInspeccionesAnuales) chips.push(`Preventivo ${cov.preventivoInspeccionesAnuales}/año`);
  if (cov.correctivoManoObra) chips.push("Correctivo (mano de obra)");
  // Bobinas y criogenia solo se anuncian si hay al menos un equipo de RM.
  if (cov.reparacionBobinasPorAnio && tieneMRI(c)) chips.push(`Rep. bobinas ${bobinasTexto(c)}${bobinasIlimitadas(c) ? " (RM)" : ""}`);
  if (cov.soporteRemoto) chips.push("Soporte remoto");
  if (cov.incluirSLA === false) chips.push("Sin cláusula de SLA");
  if (cov.saasMonitoreo && tieneMRI(c)) chips.push("SaaS Gestión y Monitoreo Cryo (RM)");
  if (cov.viaticosIncluidos) chips.push("Viáticos incluidos");
  if (cov.enviosRepuestosIncluidos) chips.push("Envío de repuestos incluido");
  if (cov.stockReservado) chips.push("Partes críticas disponibles");
  if (cov.capacitacion) chips.push("Capacitación anual");
  if (cov.auditoria) chips.push("Auditoría de performance");
  if (cov.bancoHoras) chips.push(`Banco de ${cov.bancoHoras} h de ingeniería`);
  chips.push(cov.partesIncluidas ? "Partes incluidas" : "Partes NO incluidas");
  // Ofrecemos MONITOREO criogénico (dentro del SaaS Cryo), no mantenimiento de criogenia.
  if (tieneMRI(c)) chips.push(cov.saasMonitoreo ? "Criogenia: monitoreo (no mantenimiento)" : "Criogenia no cubierta");
  if (soloCT(c)) chips.push("Solo CT: sin bobinas ni criogenia");
  return chips.map((t) => `<span class="pill-modal" style="padding:5px 10px">${esc(t)}</span>`).join("");
}
async function hacerFirme(id) {
  const c = state.data.find((x) => x.id === id);
  const f = prompt("Fecha de inicio de vigencia / firma (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
  if (!f) return;
  c.vigencia.inicio = f;
  c.fechas.firmado = f;
  c.tipo = "contrato";
  await cambiarEstado(c, "firme_vigente");
  go("detalle/" + id);
}

// ============================================================
//  Vista: Formulario (alta / edición)
// ============================================================
function renderForm(id) {
  const el = document.getElementById("view-form");
  const isNew = !id || id === "new";
  const c = isNew ? nuevoContrato() : structuredClone(state.data.find((x) => x.id === id));
  if (!c) { el.innerHTML = `<p class="empty">No encontrado</p>`; return; }
  state.editId = isNew ? null : id;
  window._draft = c;
  const cov = c.cobertura || {};
  el.innerHTML = `
    <div class="kicker">${isNew ? "Alta" : "Edición"}</div>
    <div class="page-head"><h1>${isNew ? "Nueva" : "Editar"} <span class="accent">propuesta</span></h1></div>
    <form id="cform">
      <fieldset><legend>Cliente</legend><div class="form-grid">
        ${inp("Nombre comercial / fantasía", "cliente.nombreComercial", c.cliente.nombreComercial, "full")}
        ${inp("Contacto", "cliente.contacto", c.cliente.contacto)}
        ${inp("Localidad", "cliente.localidad", c.cliente.localidad)}
        ${inp("Provincia", "cliente.provincia", c.cliente.provincia)}
      </div>
      <div style="margin-top:14px">
        <label style="font-weight:700;font-size:13px">Razones sociales <span class="hint">— un mismo cliente puede tener varias. Marcá cuál factura y firma el contrato.</span></label>
        <div class="rs-list" id="razones">${(c.cliente.razonesSociales || []).map(rsRow).join("")}</div>
        <button type="button" class="btn sm" onclick="addRazon()">+ Razón social</button>
      </div></fieldset>

      <fieldset><legend>Programa NexoCare</legend>
        <div class="form-grid">
          ${sel("Nivel del Programa", "plan.id", c.plan?.id || "", [["", "— sin nivel —"], ...CAT.PLAN_ORDEN.map((p) => [p, `${CAT.PLANES[p].label} (${CAT.PLANES[p].precioTxt})`])])}
          ${inp("Etiqueta que ve el cliente", "plan.etiquetaPublica", c.plan?.etiquetaPublica, "", "text")}
        </div>
        <p class="hint" style="margin:8px 0 0">La etiqueta es el único nombre que aparece en el documento. Podés vender un armado a medida bajo el rótulo «Contrato Professional».</p>
        <div class="modulos-box">
          <label style="font-weight:700;font-size:13px">🔒 Módulos internos <span class="hint">— no se imprimen. Suman alcance y precio de referencia.</span></label>
          <div class="check-row" style="margin-top:8px">
            ${CAT.MODULO_ORDEN.map((m) => {
              const mod = CAT.MODULOS[m];
              return `<label title="${esc(mod.desc)}"><input type="checkbox" data-mod="${m}" ${(c.plan?.modulos || []).includes(m) ? "checked" : ""}> ${esc(mod.label)} <span class="muted">+${money(mod.valor)}</span></label>`;
            }).join("")}
          </div>
          <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button type="button" class="btn sm" onclick="aplicarPlanAForm()">↻ Aplicar plan + módulos a la cobertura</button>
            <span class="muted" style="font-size:12.5px" id="valorRef"></span>
          </div>
        </div>
        <div class="field full" style="margin-top:12px">
          <label>Notas internas <span class="hint">(no se imprimen)</span></label>
          <textarea data-path="plan.notasInternas" rows="2">${esc(c.plan?.notasInternas || "")}</textarea>
        </div>
        <div class="field full">
          <label>Cambios acordados en la negociación <span class="hint">(uno por línea — desvíos respecto del modelo)</span></label>
          <textarea data-path="negociacion.desviaciones" data-list="1" rows="3" placeholder="SLA on-site llevado a 12 h a pedido del cliente&#10;Se excluye el equipo de Baradero del primer semestre">${esc((c.negociacion?.desviaciones || []).join("\n"))}</textarea>
        </div>
      </fieldset>

      <fieldset><legend>Equipos</legend>
        <div class="equipos-list" id="equipos">${(c.equipos || []).map(eqRow).join("")}</div>
        <button type="button" class="btn sm" onclick="addEquipo()">+ Equipo</button>
      </fieldset>

      <fieldset><legend>Cobertura</legend>
        <div class="form-grid">
          ${inp("Inspecciones preventivas / año", "cobertura.preventivoInspeccionesAnuales", cov.preventivoInspeccionesAnuales, "", "number")}
          ${inp("Rep. bobinas / año", "cobertura.reparacionBobinasPorAnio", cov.reparacionBobinasPorAnio)}
          ${sel("El cupo de bobinas es…", "cobertura.bobinasAlcance", cov.bobinasAlcance || "flota", [["flota", "Para toda la flota de RM"], ["porEquipo", "Por cada equipo de RM"]])}
        </div>
        <p class="hint" style="margin:6px 0 0">Con 3 RM y un cupo de 2: <b>para la flota</b> son 2 reparaciones al año en total; <b>por equipo</b> son 6. Dejalo en flota salvo que se haya pactado lo contrario. Si el cupo es «sin límite», este campo no aplica.</p>
        <div class="field full" style="margin-top:12px">
          <label>Reparaciones / partes incluidas <span class="hint">(una por línea — p. ej. módulo amplificador de gradientes, camilla paciente, host y software)</span></label>
          <textarea data-path="cobertura.reparacionesIncluidas" data-list="1" placeholder="Bobinas de RM: todas, sin límite&#10;1 Módulo Amplificador de Gradientes&#10;Reparaciones electromecánicas de camilla paciente">${esc((cov.reparacionesIncluidas || []).join("\n"))}</textarea>
        </div>
        <div class="check-row" style="margin-top:12px">
          ${chk("Incluir cláusula de SLA", "cobertura.incluirSLA", cov.incluirSLA !== false)}
          ${chk("Correctivo mano de obra", "cobertura.correctivoManoObra", cov.correctivoManoObra)}
          ${chk("Soporte remoto", "cobertura.soporteRemoto", cov.soporteRemoto)}
          ${chk("SaaS Gestión y Monitoreo Cryo", "cobertura.saasMonitoreo", cov.saasMonitoreo)}
          ${chk("Partes incluidas", "cobertura.partesIncluidas", cov.partesIncluidas)}
          ${chk("Viáticos incluidos", "cobertura.viaticosIncluidos", cov.viaticosIncluidos)}
          ${chk("Envío de repuestos incluido", "cobertura.enviosRepuestosIncluidos", cov.enviosRepuestosIncluidos)}
        </div>
      </fieldset>

      <fieldset><legend>Económico y ajuste</legend><div class="form-grid">
        ${inp("Canon mensual", "economico.canonMensual", c.economico.canonMensual, "", "number")}
        ${sel("Moneda", "economico.moneda", c.economico.moneda, [["USD", "USD"], ["ARS", "ARS"]])}
        ${inp("IVA %", "economico.ivaPct", c.economico.ivaPct ?? 21, "", "number")}
        ${inp("Forma de pago", "economico.formaPago", c.economico.formaPago)}
        ${sel("Periodicidad de ajuste", "ajuste.periodicidad", c.ajuste.periodicidad, [["ninguno", "Ninguno"], ["trimestral", "Trimestral"], ["semestral", "Semestral"], ["anual", "Anual"]])}
        ${sel("Índice", "ajuste.indice", c.ajuste.indice, [["US_CPI", "US CPI"], ["IPC_INDEC", "IPC INDEC"]])}
      </div>
      <div class="check-row" style="margin-top:12px">${chk("Canon incluye IVA", "economico.incluyeIVA", c.economico.incluyeIVA)}</div>
      </fieldset>

      <fieldset><legend>Vigencia</legend><div class="form-grid">
        ${inp("Inicio", "vigencia.inicio", c.vigencia.inicio, "", "date")}
        ${inp("Duración (meses)", "vigencia.meses", c.vigencia.meses, "", "number")}
        ${inp("Preaviso (días)", "vigencia.preavisoDias", c.vigencia.preavisoDias, "", "number")}
        ${sel("Estado", "estado", c.estado, ESTADOS.map((e) => [e.id, e.label]))}
      </div>
      <div class="check-row" style="margin-top:12px">${chk("Renovación automática", "vigencia.renovacionAutomatica", c.vigencia.renovacionAutomatica)}</div>
      </fieldset>

      <fieldset><legend>Notas</legend>
        <div class="field full"><textarea data-path="notas">${esc(c.notas || "")}</textarea></div>
      </fieldset>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn ghost" onclick="location.hash='${isNew ? "listado" : "detalle/" + id}'">Cancelar</button>
        <button type="submit" class="btn primary">${isNew ? "Crear" : "Guardar"}</button>
      </div>
    </form>`;
  document.getElementById("cform").onsubmit = (e) => { e.preventDefault(); guardarForm(isNew); };
}
function inp(label, path, val, cls = "", type = "text") {
  return `<div class="field ${cls}"><label>${label}</label><input type="${type}" data-path="${path}" value="${val === 0 ? 0 : esc(val || "")}"></div>`;
}
function sel(label, path, val, opts) {
  return `<div class="field"><label>${label}</label><select data-path="${path}">${opts.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select></div>`;
}
function chk(label, path, val) {
  return `<label><input type="checkbox" data-path="${path}" ${val ? "checked" : ""}> ${label}</label>`;
}
function eqRow(e = {}) {
  return `<div class="eq-row">
    <input placeholder="Marca" data-eq="marca" value="${esc(e.marca || "")}">
    <input placeholder="Modelo" data-eq="modelo" value="${esc(e.modelo || "")}">
    <select data-eq="modalidad"><option ${e.modalidad === "MRI" ? "selected" : ""}>MRI</option><option ${e.modalidad === "CT" ? "selected" : ""}>CT</option></select>
    <input placeholder="Ubicación" data-eq="ubicacion" value="${esc(e.ubicacion || "")}">
    <button type="button" class="btn sm danger" aria-label="Quitar" title="Quitar" onclick="this.parentElement.remove()">✕</button>
  </div>`;
}
function addEquipo() { document.getElementById("equipos").insertAdjacentHTML("beforeend", eqRow()); }
function rsRow(r = {}) {
  return `<div class="rs-row">
    <input placeholder="Razón social" data-rs="razonSocial" value="${esc(r.razonSocial || "")}">
    <input placeholder="CUIT" data-rs="cuit" value="${esc(r.cuit || "")}">
    <input placeholder="Domicilio legal" data-rs="domicilio" value="${esc(r.domicilio || "")}">
    <label class="rs-pri" title="Factura y firma el contrato"><input type="radio" name="rsPrincipal" ${r.principal ? "checked" : ""}> firma</label>
    <button type="button" class="btn sm danger" aria-label="Quitar" title="Quitar" onclick="this.parentElement.remove()">✕</button>
  </div>`;
}
function addRazon() {
  const box = document.getElementById("razones");
  box.insertAdjacentHTML("beforeend", rsRow({ principal: !box.querySelector(".rs-row") }));
}
// Rellena la cobertura a partir del plan elegido + módulos internos.
function aplicarPlanAForm() {
  const planId = document.querySelector('[data-path="plan.id"]').value;
  if (!planId) { toast("Elegí un plan primero", true, true); return; }
  const mods = [...document.querySelectorAll("[data-mod]")].filter((x) => x.checked).map((x) => x.dataset.mod);
  const der = CAT.derivarDePlan(planId, mods);
  const set = (path, v) => {
    const f = document.querySelector(`#cform [data-path="${path}"]`);
    if (!f) return;
    if (f.type === "checkbox") f.checked = !!v;
    else f.value = v ?? "";
  };
  const cov = der.cobertura;
  set("cobertura.preventivoInspeccionesAnuales", cov.preventivoInspeccionesAnuales);
  set("cobertura.reparacionBobinasPorAnio", cov.reparacionBobinasPorAnio);
  set("cobertura.correctivoManoObra", cov.correctivoManoObra);
  set("cobertura.soporteRemoto", cov.soporteRemoto);
  set("cobertura.saasMonitoreo", cov.saasMonitoreo);
  set("cobertura.partesIncluidas", cov.partesIncluidas);
  set("cobertura.viaticosIncluidos", cov.viaticosIncluidos);
  set("cobertura.enviosRepuestosIncluidos", cov.enviosRepuestosIncluidos);
  set("cobertura.reparacionesIncluidas", (cov.reparacionesIncluidas || []).join("\n"));
  const et = document.querySelector('[data-path="plan.etiquetaPublica"]');
  if (et && !et.value) et.value = CAT.PLANES[planId].etiquetaPublica;
  const ref = document.getElementById("valorRef");
  if (ref) ref.textContent = `Valor de referencia: ${money(der.valorSugerido)}/mes · SLA on-site ${der.sla.onsite} h`;
  toast("Cobertura actualizada desde el plan");
}

function nuevoContrato() {
  const d = new Date().toISOString().slice(0, 10);
  return {
    id: "ctr_" + Date.now(), tipo: "propuesta", numero: "P" + d.replace(/-/g, ""), estado: "borrador",
    cliente: { nombreComercial: "", razonesSociales: [{ razonSocial: "", cuit: "", domicilio: "", principal: true }], contacto: "", localidad: "", provincia: "" },
    plan: { id: "performance", etiquetaPublica: "NexoCare Performance", modulos: [], notasInternas: "" },
    negociacion: { desviaciones: [] },
    equipos: [], cobertura: Object.assign(structuredClone(CAT.PLANES.performance.base), { incluirSLA: true }),
    economico: { canonMensual: 0, moneda: "USD", incluyeIVA: false, ivaPct: 21, formaPago: "Mensual, antes del 5º día hábil" },
    ajuste: { periodicidad: "trimestral", indice: "US_CPI", proximoAjuste: "", historial: [] },
    vigencia: { inicio: "", meses: 12, fin: "", renovacionAutomatica: true, preavisoDias: 30 },
    fechas: { creado: d, enviado: "", firmado: "" }, archivos: [], notas: "",
    historialEstados: [{ estado: "borrador", fecha: d, usuario: state.user || "—" }],
  };
}
function setPath(obj, path, val) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] = o[keys[i]] || {};
  o[keys[keys.length - 1]] = val;
}
async function guardarForm(isNew) {
  const c = window._draft;
  const prevEstado = isNew ? null : state.data.find((x) => x.id === state.editId)?.estado;
  document.querySelectorAll("#cform [data-path]").forEach((f) => {
    let v;
    if (f.dataset.list) v = f.value.split("\n").map((s) => s.trim()).filter(Boolean);
    else if (f.type === "checkbox") v = f.checked;
    else if (f.type === "number") v = f.value === "" ? "" : Number(f.value);
    else v = f.value;
    setPath(c, f.dataset.path, v);
  });
  c.equipos = [...document.querySelectorAll("#equipos .eq-row")].map((row) => {
    const o = {};
    row.querySelectorAll("[data-eq]").forEach((f) => (o[f.dataset.eq] = f.value));
    return o;
  });
  // razones sociales (repetibles) — la marcada con el radio es la que firma/factura
  const rsRows = [...document.querySelectorAll("#razones .rs-row")];
  c.cliente.razonesSociales = rsRows.map((row) => {
    const o = {};
    row.querySelectorAll("[data-rs]").forEach((f) => (o[f.dataset.rs] = f.value.trim()));
    o.principal = !!row.querySelector('input[type="radio"]')?.checked;
    return o;
  }).filter((r) => r.razonSocial);
  if (c.cliente.razonesSociales.length && !c.cliente.razonesSociales.some((r) => r.principal)) c.cliente.razonesSociales[0].principal = true;
  // módulos internos
  c.plan = c.plan || {};
  c.plan.modulos = [...document.querySelectorAll("[data-mod]")].filter((x) => x.checked).map((x) => x.dataset.mod);
  // el modelo viejo ya no se usa
  delete c.cliente.razonSocial; delete c.cliente.cuit;
  if (c.cobertura) c.cobertura.criogeniaIncluida = false;

  if (!c.cliente.nombreComercial && !c.cliente.razonesSociales.length) { toast("Falta el nombre del cliente o una razón social", true, true); return; }
  if (!c.cliente.nombreComercial) c.cliente.nombreComercial = c.cliente.razonesSociales[0].razonSocial;
  if (!isNew && prevEstado !== c.estado) {
    c.historialEstados = c.historialEstados || [];
    c.historialEstados.push({ estado: c.estado, fecha: new Date().toISOString().slice(0, 10), usuario: state.user || "—" });
  }
  if (isNew) state.data.push(c);
  else { const i = state.data.findIndex((x) => x.id === state.editId); state.data[i] = c; }
  try {
    await persist(`${isNew ? "Alta" : "Edición"} ${c.numero} · ${nombreCliente(c)}`);
    go("detalle/" + c.id);
    // Recién creada: se ofrece el .docx para editarlo y mandarlo.
    if (isNew) {
      toast("Creada ✓ — generando el .docx…");
      setTimeout(() => generarDocx(c.id), 400);
    } else {
      toast("Guardado ✓");
    }
  } catch (e) { toast("Error: " + e.message, true, true); }
}

// ============================================================
//  PDF de marca (propuesta / contrato) vía impresión
// ============================================================
// Parámetros legales por defecto (editables acá o, a futuro, por contrato)
const LEGAL = {
  slaRemoto: 2, slaOnsite: 24, slaRepuesto: 48,
  garantiaReparacionDias: 90, limiteCanones: 3, confidAnios: 2,
  preavisoNoRenovacion: 60, indiceLabel: { US_CPI: "US CPI", IPC_INDEC: "IPC INDEC" },
};
function generarPDF(id) {
  const c = state.data.find((x) => x.id === id);
  if (!c) return;
  const m = NEXO_CONTRATO.construirContrato(c, { plantilla: false });
  document.getElementById("printRoot").innerHTML = renderContratoHTML(m);
  window.print();
}

// Renderiza el modelo de contrato.js a HTML imprimible.
// Misma puesta en página que el .docx: A4 y márgenes de la plantilla final.
function renderContratoHTML(m) {
  const filaCli = ([l1, v1, l2, v2]) => (l2 === null && v2 === null)
    ? `<tr><th>${l1}</th><td colspan="3">${v1 ?? "—"}</td></tr>`
    : `<tr><th>${l1}</th><td>${v1 ?? "—"}</td><th>${l2}</th><td>${v2 ?? "—"}</td></tr>`;
  const filaFicha = ([l1, v1, l2, v2]) => (l2 === null)
    ? `<tr><th>${l1}</th><td colspan="3">${v1 || "—"}</td></tr>`
    : `<tr><th>${l1}</th><td>${v1 || "—"}</td><th>${l2}</th><td>${v2 || "—"}</td></tr>`;

  return `
    <style>
      @page { size: A4; margin: 20mm 22mm 27mm 22mm; }
      #printRoot { font-family: var(--body); color: #211c16; font-size: 12.5px; line-height: 1.5; }
      #printRoot .hd { border-bottom: 3px solid #ef8f03; padding-bottom: 10px; margin-bottom: 16px; break-inside: avoid; }
      #printRoot .hd img { height: 30px; width: auto; display: block; margin-bottom: 6px; }
      #printRoot .kick { color:#ef8f03; font-weight:700; font-size:11px; letter-spacing:.12em; }
      #printRoot h1 { font-family: var(--head); font-weight: 800; color: #ef8f03; font-size: 26px; margin: 6px 0 4px; break-after: avoid; page-break-after: avoid; }
      #printRoot h2 { font-family: var(--head); font-weight:800; color: #645d56; font-size: 15px; text-transform: uppercase; letter-spacing: .04em; margin: 16px 0 6px; border-bottom: 1px solid #e0dacf; padding-bottom: 4px; break-after: avoid; page-break-after: avoid; break-inside: avoid; }
      #printRoot h3 { font-family: var(--head); font-weight:700; color:#645d56; font-size:12.5px; margin:12px 0 2px; break-after: avoid; page-break-after: avoid; }
      #printRoot table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 6px 0; break-inside: auto; }
      #printRoot thead { display: table-header-group; }
      #printRoot tr { break-inside: avoid; page-break-inside: avoid; }
      #printRoot td, #printRoot th { border: 1px solid #d9d3ca; padding: 6px 9px; text-align: left; vertical-align: top; }
      #printRoot th { background: #f4f1ec; color: #645d56; font-weight: 700; }
      #printRoot table.eq th, #printRoot table.eco th { background: #645d56; color: #fff; }
      #printRoot table.eco th { width: 32%; }
      #printRoot ul { font-size: 12px; padding-left: 18px; margin:4px 0; }
      #printRoot li { break-inside: avoid; color: #747474; }
      #printRoot li > span { color: #211c16; }
      #printRoot .foot { margin-top: 22px; color: #8c867d; font-size: 10.5px; border-top: 1px solid #e0dacf; padding-top: 8px; break-inside: avoid; }
      #printRoot .foot img { height: 18px; width: auto; vertical-align: middle; margin-left: 4px; }
      #printRoot .num { color: #ef8f03; font-weight: 800; }
      #printRoot .ph { color:#ef8f03; font-weight:700; }
      #printRoot p { orphans: 3; widows: 3; }
      #printRoot p.cl { margin: 0 0 8px; text-align: justify; }
      #printRoot .clause { break-inside: avoid; page-break-inside: avoid; margin: 12px 0 0; }
      #printRoot .pg { page-break-before: always; }
      #printRoot .sign { margin-top: 40px; display:flex; gap:40px; break-inside: avoid; page-break-inside: avoid; }
      #printRoot .sign div { flex:1; border-top:1px solid #211c16; padding-top:6px; font-size:11px; }
      #printRoot .blk { break-inside: avoid; page-break-inside: avoid; }
    </style>

    <div class="hd">
      <img src="${NEXO_BRAND.logo}" alt="Nexolibre" />
      <div style="color:#8c867d;font-size:12px">Ingeniería médica multimarca · Diagnóstico por imágenes MRI / CT</div>
    </div>
    <div class="kick">${m.kicker}</div>
    <h1>${m.etiquetaPub}</h1>
    <p style="color:#8c867d;margin:0 0 10px">${m.subtitulo}</p>

    ${m.filasCliente.length ? `<table>${m.filasCliente.map(filaCli).join("")}</table>` : ""}

    ${m.equipos.length ? `<div class="blk"><h2>Equipos cubiertos</h2>
    <table class="eq"><thead><tr><th>#</th><th>Equipo</th><th>Marca</th><th>Modalidad</th><th>Ubicación</th></tr></thead>
    <tbody>${m.equipos.map((e) => `<tr><td>${e.n}</td><td>${e.modelo || "—"}</td><td>${e.marca || "—"}</td><td>${e.modalidad}</td><td>${e.ubicacion || "—"}</td></tr>`).join("")}</tbody></table></div>` : ""}

    ${m.alcance.length ? `<h2>Alcance del servicio</h2><ul>${m.alcance.map((a) => `<li><span>${a}</span></li>`).join("")}</ul>` : ""}

    ${m.reparaciones.length ? `<h2>Reparaciones de partes incluidas</h2><ul>${m.reparaciones.map((r) => `<li><span>${r}</span></li>`).join("")}</ul>` : ""}

    ${m.economico.length ? `<div class="blk"><h2>Condiciones económicas</h2>
    <table class="eco">${m.economico.map(([l, v, destacado]) => `<tr><th>${l}</th><td${destacado ? ' class="num"' : ""}>${v}</td></tr>`).join("")}</table></div>` : ""}

    ${m.exclusiones.length ? `<h2>Exclusiones</h2><ul>${m.exclusiones.map((e) => `<li><span>${e}</span></li>`).join("")}</ul>` : ""}

    <div class="pg"></div>
    <div class="kick">Anexo I</div>
    <h1 style="font-size:22px;color:#645d56">Términos y Condiciones Generales del Programa</h1>
    <p class="cl">${m.preambulo}</p>
    ${m.clausulas.map((cl) => `<div class="clause"><h3>${cl.titulo}</h3><p class="cl">${cl.cuerpo}</p></div>`).join("")}
    <div class="sign">
      <div><b>Por el Prestador · Nexolibre</b><br>Aclaración / cargo:</div>
      <div><b>Por el Cliente · ${m.firmaCliente}</b><br>Aclaración / cargo:</div>
    </div>

    ${m.fichas.length ? `<div class="pg"></div>
    <div class="kick">Anexo II</div>
    <h1 style="font-size:22px;color:#645d56">Ficha Técnica por Equipo</h1>
    ${m.fichas.map((f) => `<div class="blk"><h3>Ficha Técnica N.º ${f.n}</h3>
      <table>${f.filas.map(filaFicha).join("")}</table></div>`).join("")}
    ${m.notaCT ? `<p style="font-size:11px;color:#8c867d;font-style:italic;margin-top:10px">${m.notaCT}</p>` : ""}` : ""}

    <div class="foot">${m.pie}${m.plantilla ? ' Los campos <span class="ph">[entre corchetes]</span> se completan al perfeccionar el acuerdo.' : ""}<br>Nexolibre es miembro de <img src="${NEXO_BRAND.grupoNexo}" alt="Grupo Nexo" />.</div>`;
}

// ============================================================
//  Exportaciones
// ============================================================
function seleccionOTodo() {
  const sel = state.data.filter((c) => state.selected.has(c.id));
  return sel.length ? sel : filtrados();
}
function exportarCSV() {
  const rows = seleccionOTodo();
  const cols = ["numero", "cliente", "razon_social", "cuit", "programa", "modulos_internos", "estado", "equipos", "modalidad", "bobinas_cupo", "bobinas_alcance", "bobinas_total_anual", "canon", "moneda", "inicio", "vence", "ajuste_periodicidad", "proximo_ajuste"];
  const lines = [cols.join(",")];
  for (const c of rows) {
    const fin = computeFin(c), pa = computeProximoAjuste(c);
    const vals = [
      c.numero, nombreCliente(c), rsPrincipal(c).razonSocial, rsPrincipal(c).cuit,
      CAT.PLANES[c.plan?.id]?.label || "", (c.plan?.modulos || []).map((m) => CAT.MODULOS[m]?.label).filter(Boolean).join(" + "),
      ESTADO_LABEL[c.estado], (c.equipos || []).length,
      [...new Set((c.equipos || []).map((e) => e.modalidad))].join("/"),
      c.cobertura?.reparacionBobinasPorAnio ?? "",
      c.cobertura?.reparacionBobinasPorAnio && !bobinasIlimitadas(c) ? (c.cobertura?.bobinasAlcance === "porEquipo" ? "por equipo" : "flota") : "",
      bobinasTotal(c) ?? (bobinasIlimitadas(c) ? "sin límite" : ""),
      c.economico?.canonMensual, c.economico?.moneda, c.vigencia?.inicio || "",
      fin ? fin.toISOString().slice(0, 10) : "", c.ajuste?.periodicidad, pa ? pa.toISOString().slice(0, 10) : "",
    ];
    lines.push(vals.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
  }
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `contratos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  toast(`CSV: ${rows.length} registros · uso interno (incluye módulos)`);
}
// ------------------------------------------------------------
//  Informe ejecutivo para dirección (CEO / Gerencia)
//  Es el canal por el que Gabriel y Geraldine ven la información:
//  ellos no entran al sistema. Por eso muestra SOLO el rótulo público
//  del plan — jamás los módulos internos ni las notas internas.
// ------------------------------------------------------------
function exportarInforme() {
  const rows = seleccionOTodo();
  const vig = rows.filter((c) => ACTIVOS.has(c.estado));
  const pipe = rows.filter((c) => ["borrador", "enviada", "negociacion"].includes(c.estado));
  const cerrados = rows.filter((c) => ["vencida", "rescindida", "perdida"].includes(c.estado));
  const mrr = vig.reduce((s, c) => s + (Number(c.economico?.canonMensual) || 0), 0);
  const potencial = pipe.reduce((s, c) => s + (Number(c.economico?.canonMensual) || 0), 0);
  const equipos = vig.reduce((s, c) => s + (c.equipos || []).length, 0);
  const planPub = (c) => c.plan?.etiquetaPublica || CAT.PLANES[c.plan?.id]?.label || "—";

  // Agenda de los próximos 180 días: vencimientos y aumentos pactados
  const agenda = [];
  for (const c of vig) {
    const fin = computeFin(c), dv = daysUntil(fin);
    if (dv !== null && dv <= 180) agenda.push({ c, tipo: "Vencimiento", fecha: fin, dias: dv });
    const pa = computeProximoAjuste(c), da = daysUntil(pa);
    if (da !== null && da <= 180 && da >= -5) agenda.push({ c, tipo: "Aumento", fecha: pa, dias: da });
  }
  agenda.sort((a, b) => a.fecha - b.fecha);

  // Qué cubre cada contrato, en lenguaje de negocio
  const coberturaTxt = (c) => {
    const v = c.cobertura || {}, t = [];
    if (v.preventivoInspeccionesAnuales) t.push(`${v.preventivoInspeccionesAnuales} preventivos/año`);
    if (v.correctivoManoObra) t.push("correctivo ilimitado");
    // Bobinas y criogenia solo si el contrato tiene equipos de resonancia
    if (v.reparacionBobinasPorAnio && tieneMRI(c)) t.push(`bobinas ${bobinasTexto(c)}${bobinasIlimitadas(c) ? " (RM)" : ""}`);
    if (v.saasMonitoreo && tieneMRI(c)) t.push("monitoreo Cryo (RM)");
    if (soloCT(c)) t.push("sin bobinas ni criogenia (CT)");
    if (v.viaticosIncluidos) t.push("viáticos incl.");
    t.push(v.partesIncluidas ? "partes incl." : "partes no incl.");
    return t.join(" · ");
  };

  const filaVig = (c) => {
    const fin = computeFin(c), pa = computeProximoAjuste(c);
    const iva = Number(c.economico?.ivaPct ?? 21);
    const canon = Number(c.economico?.canonMensual) || 0;
    return `<tr>
      <td><b>${esc(nombreCliente(c))}</b><br><span class="sub">${esc(rsPrincipal(c).razonSocial || "")}${rsPrincipal(c).cuit ? " · CUIT " + esc(rsPrincipal(c).cuit) : ""}</span></td>
      <td>${esc(planPub(c))}<br><span class="sub">${esc(c.numero)}</span></td>
      <td>${(c.equipos || []).map((e) => `${esc(e.marca)} ${esc(e.modelo)} <span class="sub">(${e.modalidad})</span>`).join("<br>") || "—"}</td>
      <td class="num">${money(canon, c.economico?.moneda)}<br><span class="sub">c/IVA ${money(Math.round(canon * (1 + iva / 100)), c.economico?.moneda)}</span></td>
      <td>${fmt(fin)}<br><span class="sub">${c.vigencia?.renovacionAutomatica ? "renov. automática" : "renov. manual"}</span></td>
      <td>${fmt(pa)}<br><span class="sub">${c.ajuste?.periodicidad || "—"} · ${LEGAL.indiceLabel[c.ajuste?.indice] || c.ajuste?.indice || ""}</span></td>
    </tr>
    <tr class="cov"><td colspan="6"><b>Cobertura:</b> ${esc(coberturaTxt(c))}</td></tr>`;
  };

  document.getElementById("printRoot").innerHTML = `
    <style>
      @page { margin: 16mm 14mm; }
      #printRoot { font-family: var(--body); color: #211c16; font-size: 12px; line-height: 1.5; }
      #printRoot .hd { border-bottom: 3px solid #ef8f03; padding-bottom: 10px; margin-bottom: 16px; break-inside: avoid; }
      #printRoot .hd img { height: 30px; width: auto; display: block; margin-bottom: 6px; }
      #printRoot h1 { font-family: var(--head); font-weight: 800; color: #645d56; font-size: 26px; margin: 6px 0 2px; break-after: avoid; page-break-after: avoid; }
      #printRoot h2 { font-family: var(--head); font-weight: 800; color: #645d56; font-size: 14px;
        text-transform: uppercase; letter-spacing: .05em; margin: 24px 0 6px;
        border-bottom: 1px solid #e0dacf; padding-bottom: 4px; break-after: avoid; page-break-after: avoid; }
      #printRoot table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin: 4px 0; break-inside: auto; }
      #printRoot thead { display: table-header-group; }
      #printRoot tr { break-inside: avoid; page-break-inside: avoid; }
      #printRoot td, #printRoot th { border: 1px solid #d9d3ca; padding: 6px 8px; text-align: left; vertical-align: top; }
      #printRoot th { background: #645d56; color: #fff; font-weight: 700; }
      #printRoot .sub { color: #8c867d; font-size: 10.5px; }
      #printRoot .num { font-weight: 700; color: #ef8f03; white-space: nowrap; }
      #printRoot tr.cov td { background: #f7f5f1; font-size: 10.5px; color: #645d56; }
      #printRoot .kpis { display: flex; gap: 10px; margin: 14px 0 4px; break-inside: avoid; }
      #printRoot .k { flex: 1; border: 1px solid #d9d3ca; border-radius: 14px; padding: 12px 14px; background: #f4f1ec; }
      #printRoot .k .lb { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #8c867d; font-weight: 600; }
      #printRoot .k .vl { font-family: var(--head); font-weight: 800; font-size: 22px; color: #ef8f03; padding: 3px 0; }
      #printRoot .k .sb { font-size: 10.5px; color: #8c867d; }
      #printRoot .foot { margin-top: 26px; color: #8c867d; font-size: 10.5px; border-top: 1px solid #e0dacf; padding-top: 8px; break-inside: avoid; }
      #printRoot .foot img { height: 18px; width: auto; vertical-align: middle; margin-left: 4px; }
      #printRoot .kick { color: #ef8f03; font-weight: 700; font-size: 11px; letter-spacing: .12em; }
    </style>

    <div class="hd">
      <img src="${NEXO_BRAND.logo}" alt="Nexolibre" />
      <div style="color:#8c867d;font-size:11.5px">Ingeniería médica multimarca · Diagnóstico por imágenes MRI / CT</div>
    </div>

    <div class="kick">INFORME EJECUTIVO</div>
    <h1>Estado de la cartera de contratos</h1>
    <p style="color:#8c867d;margin:0">${fmt(new Date())}${rows.length !== state.data.length ? ` · selección de ${rows.length} de ${state.data.length} registros` : ""}</p>

    <div class="grid-kpi">
      <div class="k"><div class="lb">Contratos vigentes</div><div class="vl">${vig.length}</div><div class="sb">${equipos} equipos en servicio</div></div>
      <div class="k"><div class="lb">Ingreso mensual</div><div class="vl">${money(mrr)}</div><div class="sb">${money(mrr * 12)} anualizado</div></div>
      <div class="k"><div class="lb">Propuestas abiertas</div><div class="vl">${pipe.length}</div><div class="sb">${money(potencial)}/mes potencial</div></div>
    </div>

    <h2>Contratos vigentes</h2>
    ${vig.length ? `<table><thead><tr><th style="width:20%">Cliente</th><th style="width:15%">Programa</th><th style="width:23%">Equipos cubiertos</th><th style="width:13%">Canon mensual</th><th style="width:14%">Vencimiento</th><th style="width:15%">Próximo ajuste</th></tr></thead>
      <tbody>${vig.map(filaVig).join("")}</tbody></table>` : `<p style="color:#8c867d">Sin contratos vigentes.</p>`}

    <h2>Propuestas en curso</h2>
    ${pipe.length ? `<table><thead><tr><th>Cliente</th><th>Programa propuesto</th><th>Estado</th><th>Equipos</th><th>Canon propuesto</th></tr></thead>
      <tbody>${pipe.map((c) => `<tr>
        <td><b>${esc(nombreCliente(c))}</b><br><span class="sub">${esc(c.numero)}</span></td>
        <td>${esc(planPub(c))}</td>
        <td>${ESTADO_LABEL[c.estado]}</td>
        <td>${(c.equipos || []).length} <span class="sub">(${[...new Set((c.equipos || []).map((e) => e.modalidad))].join("/")})</span></td>
        <td class="num">${money(c.economico?.canonMensual, c.economico?.moneda)}</td></tr>`).join("")}</tbody></table>` : `<p style="color:#8c867d">Sin propuestas abiertas.</p>`}

    <h2>Agenda — próximos 180 días</h2>
    ${agenda.length ? `<table><thead><tr><th style="width:14%">Fecha</th><th style="width:14%">Qué</th><th>Contrato</th><th style="width:14%">Faltan</th><th style="width:18%">Acción</th></tr></thead>
      <tbody>${agenda.map((a) => `<tr>
        <td><b>${fmt(a.fecha)}</b></td>
        <td style="color:${a.tipo === "Aumento" ? "#ef8f03" : "#645d56"};font-weight:700">${a.tipo}</td>
        <td>${esc(nombreCliente(a.c))} <span class="sub">· ${esc(a.c.numero)}</span></td>
        <td>${a.dias < 0 ? "vencido" : a.dias + " días"}</td>
        <td class="sub">${a.tipo === "Aumento" ? `Aplicar ajuste ${a.c.ajuste?.periodicidad || ""}` : a.c.vigencia?.renovacionAutomatica ? "Renueva sola salvo preaviso" : "Requiere renovación"}</td></tr>`).join("")}</tbody></table>`
      : `<p style="color:#8c867d">Sin vencimientos ni ajustes en los próximos 180 días.</p>`}

    ${cerrados.length ? `<h2>Contratos cerrados</h2>
      <table><thead><tr><th>Cliente</th><th>Estado</th><th>Último canon</th></tr></thead>
      <tbody>${cerrados.map((c) => `<tr><td>${esc(nombreCliente(c))}</td><td>${ESTADO_LABEL[c.estado]}</td><td>${money(c.economico?.canonMensual)}</td></tr>`).join("")}</tbody></table>` : ""}

    <div class="foot">
      Informe generado desde el sistema de gestión de contratos de Nexolibre.
      Los importes son netos de IVA salvo donde se indica lo contrario.<br>
      <b>Documento de circulación interna.</b> Nexolibre es miembro de <img src="${NEXO_BRAND.grupoNexo}" alt="Grupo Nexo" />.
    </div>`;
  window.print();
}

// ============================================================
//  TICKETS  (pedidos de cliente — trazabilidad ligera)
// ============================================================
const ticketPorId = (id) => state.tickets.find((t) => t.id === id);
const presupuestosDeTicket = (tk) => state.presupuestos.filter((p) => p.ticketId === tk.id);

/** Tickets que pasan el filtro activo, ordenados por fecha. */
