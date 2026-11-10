/**
 * Padrón de clientes: grupos con sedes y limpieza de duplicados.
 *
 * El padrón se armó solo, a partir de los nombres de la planilla y de los
 * documentos. Esta pantalla es para ordenarlo:
 *
 *   Grupos y sedes   una red con varias sedes suma como un solo cliente en
 *                    reportes, sin perder cada sede.
 *   Parecidos        pares que pueden ser el mismo cliente o del mismo grupo,
 *                    para decidir uno por uno.
 *   Unificar         dos registros que son el mismo quedan en uno; el nombre
 *                    viejo pasa a alias y todo lo que colgaba se mueve.
 */
(function (global) {
  "use strict";

  const E = global.NEXO_ESQUEMA;
  const CL = global.NEXO_CLIENTES;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clientes = () => global.state?.clientes || [];
  const porId = (id) => clientes().find((c) => c.id === id);

  // Pares que Maxi ya revisó y no son el mismo cliente. Es una preferencia de
  // quien mira, no un dato del cliente: va en el navegador.
  const LS_DESCARTES = "nexo_clientes_descartados";
  const descartes = () => { try { return new Set(JSON.parse(localStorage.getItem(LS_DESCARTES) || "[]")); } catch { return new Set(); } };
  const clavePar = (a, b) => [a, b].sort().join("|");

  /** Cuántos registros cuelgan de cada cliente, para saber qué se mueve. */
  function usos() {
    const st = global.state || {};
    const idx = global.NEXO_ADAPTADOR.indiceClientes(clientes());
    const cuenta = new Map();
    const sumar = (id, k) => {
      if (!id) return;
      if (!cuenta.has(id)) cuenta.set(id, { presupuestos: 0, propuestas: 0, contratos: 0 });
      cuenta.get(id)[k]++;
    };
    for (const p of st.presupuestos || []) sumar(idx.get(E.claveCliente(p.cliente?.nombreComercial)), "presupuestos");
    for (const c of st.data || []) sumar(idx.get(E.claveCliente(c.cliente?.nombreComercial)), "contratos");
    for (const p of st.propuestas || []) sumar(p.clienteId, "propuestas");
    return (id) => cuenta.get(id) || { presupuestos: 0, propuestas: 0, contratos: 0 };
  }

  // ==========================================================================
  // Listado
  // ==========================================================================

  function renderClientes() {
    const el = document.getElementById("view-clientes");
    const f = (global.state.filtroCli = global.state.filtroCli || { q: "" });
    const uso = usos();
    const desc = descartes();
    const pares = CL.parecidos(clientes()).filter((p) => !desc.has(clavePar(p.a.id, p.b.id)));
    const q = E.claveCliente(f.q);
    const grupos = CL.agrupar(clientes()).filter((g) => !q || g.clientes.some((c) =>
      [c.nombreComercial, c.razonSocial, c.grupo, c.sede, c.localidad, ...(c.alias || [])]
        .some((x) => E.claveCliente(x).includes(q))));
    const conSedes = grupos.filter((g) => g.clientes.length > 1 || g.clientes[0].grupo).length;
    const usoTxt = (u) => [u.presupuestos && `${u.presupuestos} presup.`, u.propuestas && `${u.propuestas} prop.`,
      u.contratos && `${u.contratos} contr.`].filter(Boolean).join(" · ") || "—";
    const nombre = (c) => `${esc(c.nombreComercial)}${c.localidad ? ` <span class="muted">· ${esc(c.localidad)}</span>` : ""}`;

    el.innerHTML = `
      <div class="kicker">Presupuestos</div>
      <div class="page-head"><h1>Clientes</h1>
        <div class="actions"><a class="btn primary" href="#cliform/new">+ Nuevo cliente</a></div></div>

      <div class="grid-kpi" style="margin-bottom:16px">
        ${global.kpi("Clientes", clientes().length)}
        ${global.kpi("Grupos con sedes", conSedes)}
        ${global.kpi("Para revisar", pares.length, "posibles duplicados o sedes", pares.length ? "warn" : "")}
      </div>

      ${pares.length ? `<div class="card" style="margin-bottom:16px">
        <h3 style="margin-top:0">Posibles duplicados o sedes</h3>
        <p class="muted" style="margin-top:0"><b>Unificar</b> cuando son el mismo cliente: queda uno solo, el otro nombre pasa a alias y
        sus presupuestos, propuestas y contratos se mueven. <b>Mismo grupo</b> cuando son sedes distintas de una misma red.</p>
        <div class="overflow"><table class="data"><thead><tr><th>Cliente</th><th>Cliente</th><th>Por qué</th><th></th></tr></thead><tbody>
        ${pares.map(({ a, b, motivo }) => `<tr>
          <td>${nombre(a)}<br><span class="muted" style="font-size:11px">${usoTxt(uso(a.id))}</span></td>
          <td>${nombre(b)}<br><span class="muted" style="font-size:11px">${usoTxt(uso(b.id))}</span></td>
          <td class="muted">${esc(motivo)}</td>
          <td style="white-space:nowrap">
            <button class="btn sm" onclick="unificarClientes('${esc(b.id)}','${esc(a.id)}')" title="Queda «${esc(a.nombreComercial)}»">Unificar en ←</button>
            <button class="btn sm" onclick="unificarClientes('${esc(a.id)}','${esc(b.id)}')" title="Queda «${esc(b.nombreComercial)}»">Unificar en →</button>
            <button class="btn sm" onclick="agruparClientes('${esc(a.id)}','${esc(b.id)}')">Mismo grupo</button>
            <button class="btn sm ghost" onclick="descartarPar('${esc(a.id)}','${esc(b.id)}')" title="No son el mismo ni del mismo grupo">No</button>
          </td></tr>`).join("")}
        </tbody></table></div></div>` : ""}

      <div class="table-tools" style="margin-bottom:14px">
        <input type="search" id="cliQ" placeholder="Buscar cliente, sede, localidad…" value="${esc(f.q)}" />
      </div>
      <div class="overflow"><table class="data">
        <thead><tr><th>Grupo / cliente</th><th>Sede</th><th>Localidad</th><th>País</th><th>Registros</th></tr></thead>
        <tbody>${grupos.map((g) => {
          const multi = g.clientes.length > 1 || g.clientes[0].grupo;
          const cab = multi ? `<tr class="grupo"><td colspan="5"><b>${esc(g.nombre)}</b>
            <span class="muted">· ${g.clientes.length} sede${g.clientes.length > 1 ? "s" : ""}</span></td></tr>` : "";
          return cab + g.clientes.map((c) => `<tr onclick="location.hash='cliform/${esc(c.id)}'">
            <td>${multi ? `<span class="muted" style="margin-left:14px">└</span> ` : ""}<b>${esc(c.nombreComercial)}</b>${
              (c.alias || []).filter((x) => x !== c.nombreComercial).length
                ? `<br><span class="muted" style="font-size:11px">también: ${esc(c.alias.filter((x) => x !== c.nombreComercial).join(", "))}</span>` : ""}</td>
            <td>${esc(c.sede || "—")}</td><td>${esc(c.localidad || "—")}</td>
            <td><span class="pill">${esc(c.pais)}</span></td>
            <td class="muted">${usoTxt(uso(c.id))}</td></tr>`).join("");
        }).join("")}</tbody></table></div>`;

    const q2 = document.getElementById("cliQ");
    q2.oninput = (e) => { f.q = e.target.value; global.redibujarConFoco(renderClientes); };
  }

  function descartarPar(a, b) {
    const d = descartes();
    d.add(clavePar(a, b));
    try { localStorage.setItem(LS_DESCARTES, JSON.stringify([...d])); } catch { /* sin almacenamiento: se vuelve a mostrar */ }
    renderClientes();
  }

  // ==========================================================================
  // Mismo grupo
  // ==========================================================================

  async function agruparClientes(aId, bId) {
    const a = porId(aId), b = porId(bId);
    if (!a || !b) return;
    // Nombre del grupo: el que ya tenga uno de los dos, o el más corto.
    const sugerido = a.grupo || b.grupo ||
      [a.nombreComercial, b.nombreComercial].sort((x, y) => x.length - y.length)[0];
    const grupo = prompt(`Nombre del grupo para «${a.nombreComercial}» y «${b.nombreComercial}»:`, sugerido);
    if (!grupo || !grupo.trim()) return;
    for (const c of [a, b]) {
      const nuevo = E.ENTIDADES.clientes.normalizar({ ...c, grupo: grupo.trim(), sede: c.sede || sedeSugerida(c, grupo) });
      reemplazarEnPadron(nuevo);
      await global.persist(`Cliente ${c.nombreComercial} en el grupo ${grupo.trim()}`, "clientes", nuevo);
    }
    global.toast(`Agrupados en ${grupo.trim()}`);
    renderClientes();
  }

  /** "Diagnóstico Ficticio Norte" en el grupo "Diagnóstico Ficticio" → "Norte". */
  function sedeSugerida(c, grupo) {
    const resto = E.claveCliente(c.nombreComercial).replace(E.claveCliente(grupo), "").trim();
    return resto ? c.nombreComercial.slice(-resto.length) : "";
  }

  // El padrón se cambia en el mismo arreglo: el repositorio lo comparte y
  // resuelve nombres con él.
  function reemplazarEnPadron(c) {
    const lista = clientes();
    const i = lista.findIndex((x) => x.id === c.id);
    if (i >= 0) lista[i] = c; else lista.push(c);
  }

  // ==========================================================================
  // Unificar
  // ==========================================================================

  async function unificarClientes(origenId, destinoId) {
    const origen = porId(origenId), destino = porId(destinoId);
    if (!origen || !destino) return;
    const st = global.state;
    const plan = CL.planFusion(origen, destino, st);
    const c = plan.cuenta;
    const detalle = [c.presupuestos && `${c.presupuestos} presupuesto(s)`, c.tickets && `${c.tickets} ticket(s)`,
      c.contratos && `${c.contratos} contrato(s)`, c.propuestas && `${c.propuestas} propuesta(s)`,
      c.leads && `${c.leads} lead(s)`, c.comisiones && `${c.comisiones} comisión(es)`].filter(Boolean).join(", ") || "nada";
    if (!confirm(`Unificar «${origen.nombreComercial}» en «${destino.nombreComercial}».\n\n` +
      `Se mueven: ${detalle}.\n«${origen.nombreComercial}» queda como otro nombre de «${destino.nombreComercial}» ` +
      `y se borra del padrón.`)) return;

    const ref = `Unifica ${origen.nombreComercial} en ${destino.nombreComercial}`;
    try {
      // Primero el destino con sus alias: los registros viejos se resuelven por
      // nombre al guardar, y sin el alias crearían otra vez al cliente borrado.
      reemplazarEnPadron(plan.destino);
      await global.persist(ref, "clientes", plan.destino);
      const CLAVE = { presupuestos: "presupuestos", tickets: "tickets", contratos: "data" };
      for (const [store, regs] of Object.entries(plan.cambios)) {
        const k = CLAVE[store] || store;
        const ids = new Map(regs.map((r) => [r.id, r]));
        st[k] = (st[k] || []).map((r) => ids.get(r.id) || r);
        // Pocos se guardan de a uno (una partición cada uno); muchos, de una vez.
        if (regs.length <= 3) for (const r of regs) await global.persist(ref, store, r);
        else await global.persist(`${ref} · ${regs.length} ${store}`, store, null);
      }
      const lista = clientes();
      const i = lista.findIndex((x) => x.id === origen.id);
      if (i >= 0) lista.splice(i, 1);
      await global.eliminarRegistros("clientes", [origen.id], ref);
      global.toast(`Unificado en ${destino.nombreComercial}`);
    } catch (e) {
      global.toast(`No se pudo terminar: ${e.message} — recargá antes de reintentar`, true, true);
    }
    renderClientes();
  }

  // ==========================================================================
  // Alta y edición
  // ==========================================================================

  function renderClienteForm(id) {
    const el = document.getElementById("view-cliform");
    const c = id && id !== "new" ? porId(id) : null;
    const v = (k) => esc(c?.[k] || "");
    const campo = (k, label, extra = "") => `<div class="field"><label>${label}</label><input id="cf_${k}" value="${v(k)}" ${extra}></div>`;
    el.innerHTML = `
      <div class="kicker">Clientes</div>
      <div class="page-head"><h1>${c ? esc(c.nombreComercial) : "Nuevo cliente"}</h1></div>
      <div class="card"><div class="form-grid">
        ${campo("nombreComercial", "Nombre comercial")}
        ${campo("razonSocial", "Razón social")}
        ${campo("cuit", "CUIT / RUT")}
        <div class="field"><label>País</label><select id="cf_pais">${E.PAIS.map((p) =>
          `<option value="${p}"${(c?.pais || "AR") === p ? " selected" : ""}>${esc(E.PAIS_NOMBRE[p])}</option>`).join("")}</select></div>
        ${campo("grupo", "Grupo", `list="cf_grupos" placeholder="Vacío si es un cliente suelto"`)}
        ${campo("sede", "Sede", `placeholder="Ej.: Centro, Norte…"`)}
        ${campo("localidad", "Localidad")}
        ${campo("provincia", "Provincia / región")}
        ${campo("contacto", "Contacto")}
        ${campo("email", "Email")}
        ${campo("telefono", "Teléfono")}
      </div>
      <datalist id="cf_grupos">${CL.nombresDeGrupo(clientes()).map((g) => `<option value="${esc(g)}">`).join("")}</datalist>
      ${c && (c.alias || []).length ? `<p class="muted">También aparece como: ${esc(c.alias.join(", "))}</p>` : ""}
      <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px">
        <a class="btn ghost" href="#clientes">Cancelar</a>
        <button class="btn primary" onclick="guardarCliente(${c ? `'${esc(c.id)}'` : "null"})">Guardar</button>
      </div></div>`;
  }

  async function guardarCliente(id) {
    const val = (k) => document.getElementById("cf_" + k).value.trim();
    const anterior = id ? porId(id) : null;
    const nombre = val("nombreComercial");
    if (!nombre) { global.toast("Falta el nombre comercial", true, true); return; }
    const otro = clientes().find((x) => x.id !== id && E.claveCliente(x.nombreComercial) === E.claveCliente(nombre));
    if (otro) { global.toast(`Ya existe «${otro.nombreComercial}»: unificalos desde la lista`, true, true); return; }
    // Un cambio de nombre deja el anterior como alias: los presupuestos y
    // tickets se resuelven por nombre, y sin esto quedarían sin cliente.
    const alias = [...(anterior?.alias || [])];
    if (anterior && E.claveCliente(anterior.nombreComercial) !== E.claveCliente(nombre)) alias.push(anterior.nombreComercial);
    const c = E.ENTIDADES.clientes.normalizar({
      ...(anterior || {}), id: id || undefined,
      nombreComercial: nombre, razonSocial: val("razonSocial") || nombre, cuit: val("cuit"), pais: val("pais"),
      grupo: val("grupo"), sede: val("sede"), localidad: val("localidad"), provincia: val("provincia"),
      contacto: val("contacto"), email: val("email"), telefono: val("telefono"),
      alias: alias.length ? alias : [nombre],
    });
    reemplazarEnPadron(c);
    // Los registros cargados muestran el nombre que tenían al abrir la app; se
    // actualiza para que no vuelvan a guardar el viejo.
    if (anterior && alias.includes(anterior.nombreComercial)) {
      const k = E.claveCliente(anterior.nombreComercial);
      for (const lista of [global.state.presupuestos, global.state.tickets, global.state.data]) {
        for (const r of lista || []) if (E.claveCliente(r.cliente?.nombreComercial) === k) r.cliente.nombreComercial = nombre;
      }
    }
    await global.persist(`${anterior ? "Edita" : "Alta"} cliente ${nombre}`, "clientes", c);
    global.toast("Cliente guardado");
    global.go("clientes");
  }

  global.NEXO_VISTAS = global.NEXO_VISTAS || {};
  Object.assign(global.NEXO_VISTAS, {
    clientes: renderClientes,
    cliform: () => renderClienteForm((location.hash.split("/")[1]) || "new"),
  });
  Object.assign(global, { unificarClientes, agruparClientes, descartarPar, guardarCliente });
})(window);
