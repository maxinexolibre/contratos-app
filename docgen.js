/* ============================================================
   Nexolibre · Generación del Programa de Continuidad Operativa en .docx
   ------------------------------------------------------------
   Toma el modelo de contrato.js y arma un Word real, con la puesta en
   página de la plantilla final: A4, márgenes de diseño y viñetas grises.

   La librería (≈1 MB) se carga bajo demanda la primera vez que se pide
   una descarga, para no penalizar la carga de la app.
   ============================================================ */

// Puesta en página de la plantilla final (valores en twips)
const PAGINA = {
  ancho: 11906, alto: 16838,            // A4
  margen: { top: 1134, right: 1247, bottom: 1531, left: 1247, header: 709, footer: 709 },
};
const DC = {
  orange: "EF8F03", taupe: "645D56", ink: "211C16",
  mut: "8C867D", line: "D9D3CA", crema: "F4F1EC", white: "FFFFFF",
  vineta: "747474", // gris de viñetas de la plantilla final
};
const FH = "Exo", FB = "Helvetica Neue";

let _docxCargando = null;
function cargarDocx() {
  if (window.docx) return Promise.resolve(window.docx);
  if (_docxCargando) return _docxCargando;
  _docxCargando = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "vendor/docx.iife.js";
    s.onload = () => (window.docx ? res(window.docx) : rej(new Error("no se pudo inicializar docx")));
    s.onerror = () => rej(new Error("no se pudo descargar el generador de Word"));
    document.head.appendChild(s);
  });
  return _docxCargando;
}

const _imgCache = {};
async function imagen(nombre) {
  if (!_imgCache[nombre]) {
    const r = await fetch(`assets/${nombre}`);
    if (!r.ok) throw new Error(`falta ${nombre}`);
    _imgCache[nombre] = new Uint8Array(await r.arrayBuffer());
  }
  return _imgCache[nombre];
}

async function generarDocx(id) {
  const c = state.data.find((x) => x.id === id);
  // Una propuesta comercial tiene su propio documento, sin cláusulas.
  if (!c) return (state.propuestas || []).some((p) => p.id === id) ? generarPropuestaDocx(id) : undefined;
  toast("Generando documento…");
  try {
    const D = await cargarDocx();
    const m = NEXO_CONTRATO.construirContrato(c, { plantilla: false });
    const blob = await armarDocx(D, m, c);
    const nombre = `${c.numero || "Contrato"} - ${nombreCliente(c)} - ${m.esContrato ? "Programa" : "Propuesta"} de Continuidad Operativa.docx`
      .replace(/[\/\\:*?"<>|]/g, "-");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Documento descargado ✓");
  } catch (e) {
    toast("No se pudo generar el .docx: " + e.message, true, true);
  }
}

async function armarDocx(D, m, c) {
  const {
    Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
    Table, TableRow, TableCell, WidthType, ImageRun, Footer, PageBreak, ShadingType,
  } = D;

  const dec = (s) => String(s ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
  // Respeta <b> y pinta los [campos] pendientes en naranja
  const runs = (frag, { size = 20, color = DC.ink, italics = false } = {}) => {
    const out = [];
    let bold = false;
    for (const p of dec(frag).split(/(<\/?b>)/)) {
      if (p === "<b>") { bold = true; continue; }
      if (p === "</b>") { bold = false; continue; }
      if (!p) continue;
      const txt = p.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
      for (const seg of txt.split(/(\[[^\]]+\])/)) {
        if (!seg) continue;
        const ph = /^\[.+\]$/.test(seg);
        out.push(new TextRun({ text: seg, bold: bold || ph, italics, color: ph ? DC.orange : color, size, font: FB }));
      }
    }
    return out;
  };
  const P = (frag, o = {}) => new Paragraph({ children: runs(frag, o), spacing: { after: o.after ?? 120, line: 280 }, alignment: o.align });
  const H2 = (t) => new Paragraph({
    children: [new TextRun({ text: t.toUpperCase(), bold: true, color: DC.taupe, size: 24, font: FH })],
    spacing: { before: 320, after: 120 }, keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: DC.line, space: 4 } },
  });
  const H3 = (t) => new Paragraph({
    children: [new TextRun({ text: t, bold: true, color: DC.taupe, size: 21, font: FH })],
    spacing: { before: 220, after: 60 }, keepNext: true,
  });
  const bullet = (t) => new Paragraph({
    children: runs(t, { size: 19 }), bullet: { level: 0 },
    spacing: { after: 70, line: 270 },
    run: { color: DC.vineta },
  });
  const cell = (frag, { w, head = false, bg, size = 19 } = {}) => new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    shading: bg ? { type: ShadingType.CLEAR, fill: bg } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    children: [new Paragraph({
      children: head
        ? [new TextRun({ text: dec(frag), bold: true, color: bg === DC.taupe ? DC.white : DC.taupe, size, font: FB })]
        : runs(frag, { size }),
    })],
  });
  const tbl = (rows) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: ["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"]
      .reduce((a, k) => (a[k] = { style: BorderStyle.SINGLE, size: 4, color: DC.line }, a), {}),
    rows,
  });
  const img = async (f, w, h) => new Paragraph({
    children: [new ImageRun({ type: "png", data: await imagen(f), transformation: { width: w, height: h } })],
    spacing: { after: 60 },
  });

  const kids = [];

  // ---------- Encabezado ----------
  kids.push(await img("nexolibre-logo.png", 190, 44));
  kids.push(new Paragraph({
    children: [new TextRun({ text: "Ingeniería médica multimarca · Diagnóstico por imágenes MRI / CT", color: DC.mut, size: 17, font: FB })],
    spacing: { after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: DC.orange, space: 6 } },
  }));
  kids.push(new Paragraph({ children: runs(m.kicker, { size: 16, color: DC.orange }), spacing: { before: 200, after: 40 } }));
  kids.push(new Paragraph({ children: [new TextRun({ text: m.etiquetaPub, bold: true, color: DC.orange, size: 40, font: FH })], spacing: { after: 20 } }));
  kids.push(new Paragraph({ children: [new TextRun({ text: m.subtitulo, color: DC.mut, size: 19, font: FB })], spacing: { after: 200 } }));

  // ---------- Cliente ----------
  if (m.filasCliente.length) {
    kids.push(tbl(m.filasCliente.map(([l1, v1, l2, v2]) => new TableRow({
      children: v2 === null && l2 === null
        ? [cell(l1, { w: 22, head: true, bg: DC.crema }), cell(v1 ?? "—", { w: 78 })]
        : [cell(l1, { w: 22, head: true, bg: DC.crema }), cell(v1 ?? "—", { w: 28 }),
           cell(l2, { w: 22, head: true, bg: DC.crema }), cell(v2 ?? "—", { w: 28 })],
    }))));
  }

  // ---------- Equipos ----------
  if (m.equipos.length) {
    kids.push(H2("Equipos cubiertos"));
    kids.push(tbl([
      new TableRow({
        tableHeader: true,
        children: [cell("#", { w: 6, head: true, bg: DC.taupe }), cell("Equipo", { w: 30, head: true, bg: DC.taupe }),
                   cell("Marca", { w: 20, head: true, bg: DC.taupe }), cell("Modalidad", { w: 18, head: true, bg: DC.taupe }),
                   cell("Ubicación", { w: 26, head: true, bg: DC.taupe })],
      }),
      ...m.equipos.map((e) => new TableRow({
        children: [cell(String(e.n), { w: 6 }), cell(e.modelo || "—", { w: 30 }), cell(e.marca || "—", { w: 20 }),
                   cell(e.modalidad, { w: 18 }), cell(e.ubicacion || "—", { w: 26 })],
      })),
    ]));
  }

  // ---------- Alcance / reparaciones ----------
  if (m.alcance.length) { kids.push(H2("Alcance del servicio")); m.alcance.forEach((a) => kids.push(bullet(a))); }
  if (m.reparaciones.length) { kids.push(H2("Reparaciones de partes incluidas")); m.reparaciones.forEach((r) => kids.push(bullet(r))); }

  // ---------- Económicas ----------
  if (m.economico.length) {
    kids.push(H2("Condiciones económicas"));
    kids.push(tbl(m.economico.map(([l, v]) => new TableRow({
      children: [cell(l, { w: 34, head: true, bg: DC.taupe }), cell(v, { w: 66 })],
    }))));
  }

  // ---------- Exclusiones ----------
  if (m.exclusiones.length) { kids.push(H2("Exclusiones")); m.exclusiones.forEach((e) => kids.push(bullet(e))); }

  // ---------- ANEXO I ----------
  kids.push(new Paragraph({ children: [new PageBreak()] }));
  kids.push(new Paragraph({ children: [new TextRun({ text: "ANEXO I", bold: true, color: DC.orange, size: 16, font: FB })], spacing: { after: 40 } }));
  kids.push(new Paragraph({ children: [new TextRun({ text: "Términos y Condiciones Generales del Programa", bold: true, color: DC.taupe, size: 34, font: FH })], spacing: { after: 160 } }));
  kids.push(P(m.preambulo, { size: 20, align: AlignmentType.JUSTIFIED, after: 180 }));
  for (const cl of m.clausulas) {
    kids.push(H3(cl.titulo));
    kids.push(P(cl.cuerpo, { size: 19, align: AlignmentType.JUSTIFIED, after: 140 }));
  }

  // ---------- Firmas ----------
  const sinBorde = ["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"]
    .reduce((a, k) => (a[k] = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, a), {});
  kids.push(new Paragraph({ text: "", spacing: { before: 500 } }));
  kids.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders: sinBorde,
    rows: [new TableRow({
      children: [
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE }, margins: { top: 80, right: 200 },
          borders: { top: { style: BorderStyle.SINGLE, size: 6, color: DC.ink } },
          children: [new Paragraph({ children: [new TextRun({ text: "Por el Prestador · Nexolibre", bold: true, size: 18, font: FB })] }),
                     new Paragraph({ children: [new TextRun({ text: "Aclaración / cargo:", size: 17, color: DC.mut, font: FB })] })],
        }),
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE }, margins: { top: 80, left: 200 },
          borders: { top: { style: BorderStyle.SINGLE, size: 6, color: DC.ink } },
          children: [new Paragraph({ children: [new TextRun({ text: "Por el Cliente · ", bold: true, size: 18, font: FB }), ...runs(m.firmaCliente, { size: 18 })] }),
                     new Paragraph({ children: [new TextRun({ text: "Aclaración / cargo:", size: 17, color: DC.mut, font: FB })] })],
        }),
      ],
    })],
  }));

  // ---------- ANEXO II ----------
  if (m.fichas.length) {
    kids.push(new Paragraph({ children: [new PageBreak()] }));
    kids.push(new Paragraph({ children: [new TextRun({ text: "ANEXO II", bold: true, color: DC.orange, size: 16, font: FB })], spacing: { after: 40 } }));
    kids.push(new Paragraph({ children: [new TextRun({ text: "Ficha Técnica por Equipo", bold: true, color: DC.taupe, size: 34, font: FH })], spacing: { after: 180 } }));
    for (const f of m.fichas) {
      kids.push(H3(`Ficha Técnica N.º ${f.n}`));
      kids.push(tbl(f.filas.map(([l1, v1, l2, v2]) => new TableRow({
        children: l2 === null
          ? [cell(l1, { w: 22, head: true, bg: DC.crema }), cell(v1 || "—", { w: 78 })]
          : [cell(l1, { w: 22, head: true, bg: DC.crema }), cell(v1 || "—", { w: 28 }),
             cell(l2, { w: 22, head: true, bg: DC.crema }), cell(v2 || "—", { w: 28 })],
      }))));
    }
    if (m.notaCT) {
      kids.push(new Paragraph({ children: runs(m.notaCT, { size: 17, color: DC.mut, italics: true }), spacing: { before: 140 } }));
    }
  }

  // ---------- Documento ----------
  const doc = new Document({
    creator: "Nexolibre",
    title: `${m.esContrato ? "Contrato" : "Propuesta"} · Programa de Continuidad Operativa NexoCare`,
    description: "Generado desde el sistema de gestión de contratos de Nexolibre",
    sections: [{
      properties: { page: { size: { width: PAGINA.ancho, height: PAGINA.alto }, margin: PAGINA.margen } },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER, spacing: { before: 100 },
              border: { top: { style: BorderStyle.SINGLE, size: 4, color: DC.line, space: 6 } },
              children: [new TextRun({ text: m.pie, color: DC.mut, size: 15, font: FB })],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER, spacing: { before: 40 },
              children: [new TextRun({ text: "Nexolibre es miembro de  ", color: DC.mut, size: 15, font: FB }),
                         new ImageRun({ type: "png", data: await imagen("gruponexo-logo.png"), transformation: { width: 74, height: 23 } })],
            }),
          ],
        }),
      },
      children: kids,
    }],
  });
  return Packer.toBlob(doc);
}

// ============================================================
//  Presupuesto en .docx (misma puesta en página y estilo)
// ============================================================
async function generarPresupuestoDocx(id) {
  const p = (state.presupuestos || []).find((x) => x.id === id);
  if (!p) return;
  toast("Generando presupuesto…");
  try {
    const D = await cargarDocx();
    const m = NEXO_PRESUPUESTO.construirPresupuesto(p, { plantilla: false });
    const blob = await armarPresupuestoDocx(D, m);
    const nombre = `${p.numero || "Presupuesto"} - ${nombreCliente(p)} - Presupuesto ${m.tipoLabel}.docx`.replace(/[\/\\:*?"<>|]/g, "-");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Presupuesto descargado ✓");
  } catch (e) {
    toast("No se pudo generar el .docx: " + e.message, true, true);
  }
}
async function armarPresupuestoDocx(D, m) {
  const {
    Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
    Table, TableRow, TableCell, WidthType, ImageRun, Footer, ShadingType,
  } = D;

  const dec = (s) => String(s ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
  const runs = (frag, { size = 19, color = DC.ink } = {}) => {
    const out = [];
    let bold = false;
    for (const part of dec(frag).split(/(<\/?b>)/)) {
      if (part === "<b>") { bold = true; continue; }
      if (part === "</b>") { bold = false; continue; }
      if (!part) continue;
      const txt = part.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
      for (const seg of txt.split(/(\[[^\]]+\])/)) {
        if (!seg) continue;
        const ph = /^\[.+\]$/.test(seg);
        out.push(new TextRun({ text: seg, bold: bold || ph, color: ph ? DC.orange : color, size, font: FB }));
      }
    }
    return out;
  };
  const P = (frag, o = {}) => new Paragraph({ children: runs(frag, o), spacing: { after: o.after ?? 120, line: 280 }, alignment: o.align });
  const H2 = (t) => new Paragraph({
    children: [new TextRun({ text: t.toUpperCase(), bold: true, color: DC.taupe, size: 24, font: FH })],
    spacing: { before: 300, after: 100 }, keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: DC.line, space: 4 } },
  });
  const cellTxt = (frag, { w, head = false, bg, num = false, strong = false } = {}) => new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    shading: bg ? { type: ShadingType.CLEAR, fill: bg } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: num ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: head
        ? [new TextRun({ text: dec(frag), bold: true, color: DC.white, size: 18, font: FB })]
        : (strong ? [new TextRun({ text: dec(frag).replace(/<[^>]+>/g, ""), bold: true, size: 18, font: FB })] : runs(frag, { size: 18 })),
    })],
  });
  // Tabla genérica a partir de {head:[{t,w,num}], rows:[[{t,num,strong}]]}
  const tabla = (t, headBg = DC.taupe) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: ["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"]
      .reduce((a, k) => (a[k] = { style: BorderStyle.SINGLE, size: 4, color: DC.line }, a), {}),
    rows: [
      new TableRow({ tableHeader: true, children: t.head.map((h) => cellTxt(h.t, { w: h.w, head: true, bg: headBg, num: h.num })) }),
      ...t.rows.map((r) => new TableRow({ children: r.map((c, i) => cellTxt(c.t, { w: t.head[i].w, num: t.head[i].num, strong: c.strong })) })),
    ],
  });

  const kids = [];
  kids.push(new Paragraph({
    children: [new ImageRun({ type: "png", data: await imagen("nexolibre-logo.png"), transformation: { width: 190, height: 44 } })],
    spacing: { after: 60 },
  }));
  kids.push(new Paragraph({
    children: [new TextRun({ text: "Ingeniería médica multimarca · Diagnóstico por imágenes MRI / CT", color: DC.mut, size: 17, font: FB })],
    spacing: { after: 60 }, border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: DC.orange, space: 6 } },
  }));
  kids.push(new Paragraph({ children: runs(m.kicker, { size: 16, color: DC.orange }), spacing: { before: 200, after: 40 } }));
  kids.push(new Paragraph({ children: [new TextRun({ text: m.titulo, bold: true, color: DC.orange, size: 40, font: FH })], spacing: { after: 20 } }));
  kids.push(new Paragraph({ children: [new TextRun({ text: m.subtitulo, color: DC.mut, size: 19, font: FB })], spacing: { after: 200 } }));

  if (m.filasCliente.length) {
    // Datos del cliente: mismo layout de dos pares por fila que el contrato.
    kids.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: ["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].reduce((a, k) => (a[k] = { style: BorderStyle.SINGLE, size: 4, color: DC.line }, a), {}),
      rows: m.filasCliente.map(([l1, v1, l2, v2]) => new TableRow({
        children: v2 === null && l2 === null
          ? [cellTxt(l1, { w: 22, head: false, bg: DC.crema, strong: true }), cellTxt(v1 ?? "—", { w: 78 })]
          : [cellTxt(l1, { w: 22, bg: DC.crema, strong: true }), cellTxt(v1 ?? "—", { w: 28 }), cellTxt(l2, { w: 22, bg: DC.crema, strong: true }), cellTxt(v2 ?? "—", { w: 28 })],
      })),
    }));
  }

  kids.push(P(m.intro, { size: 20, align: AlignmentType.JUSTIFIED, after: 160 }));

  if (m.tabla.rows.length) { kids.push(H2("Detalle")); kids.push(tabla(m.tabla)); }

  // Totales (tabla a la derecha, dos columnas)
  kids.push(H2("Totales"));
  kids.push(new Table({
    width: { size: 60, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.RIGHT,
    borders: ["insideHorizontal", "bottom"].reduce((a, k) => (a[k] = { style: BorderStyle.SINGLE, size: 2, color: DC.line }, a), { top: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } }),
    rows: m.totales.map(([l, v, big]) => new TableRow({
      children: [
        new TableCell({ width: { size: 60, type: WidthType.PERCENTAGE }, margins: { top: 50, bottom: 50, left: 100 }, children: [new Paragraph({ children: [new TextRun({ text: l, bold: !!big, color: big ? DC.taupe : DC.ink, size: big ? 20 : 18, font: FB })] })] }),
        new TableCell({ width: { size: 40, type: WidthType.PERCENTAGE }, margins: { top: 50, bottom: 50, right: 100 }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: v, bold: true, color: big ? DC.orange : DC.ink, size: big ? 22 : 18, font: FB })] })] }),
      ],
    })),
  }));

  if (m.condiciones.length) {
    kids.push(H2("Condiciones comerciales"));
    kids.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: ["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].reduce((a, k) => (a[k] = { style: BorderStyle.SINGLE, size: 4, color: DC.line }, a), {}),
      rows: m.condiciones.map(([l, v]) => new TableRow({ children: [cellTxt(l, { w: 28, bg: DC.crema, strong: true }), cellTxt(v, { w: 72 })] })),
    }));
  }

  if (m.notas.length) {
    kids.push(H2("Notas"));
    for (const n of m.notas) kids.push(P(`· ${n}`, { size: 18, after: 60 }));
  }

  // Anexo de garantía. Va después de la firma en el papel? No: antes, para que
  // lo que el cliente firma incluya la cobertura que se le prometió.
  if (m.garantia) {
    kids.push(H2(`Anexo I · Garantía (${m.garantia.plazo})`));
    if (m.garantia.libre) {
      kids.push(P(m.garantia.libre, { size: 18, align: AlignmentType.JUSTIFIED, after: 120 }));
    } else {
      kids.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: ["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].reduce((a, k) => (a[k] = { style: BorderStyle.SINGLE, size: 4, color: DC.line }, a), {}),
        rows: m.garantia.puntos.map(([l, v]) => new TableRow({
          children: [cellTxt(l, { w: 26, bg: DC.crema, strong: true }), cellTxt(v, { w: 74 })],
        })),
      }));
    }
  }

  // Firmas
  kids.push(new Paragraph({ text: "", spacing: { before: 400 } }));
  kids.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: ["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].reduce((a, k) => (a[k] = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, a), {}),
    rows: [new TableRow({
      children: [
        new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, margins: { top: 80, right: 200 }, borders: { top: { style: BorderStyle.SINGLE, size: 6, color: DC.ink } }, children: [new Paragraph({ children: [new TextRun({ text: "Por Nexolibre", bold: true, size: 18, font: FB })] }), new Paragraph({ children: [new TextRun({ text: "Aclaración / cargo:", size: 17, color: DC.mut, font: FB })] })] }),
        new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, margins: { top: 80, left: 200 }, borders: { top: { style: BorderStyle.SINGLE, size: 6, color: DC.ink } }, children: [new Paragraph({ children: [new TextRun({ text: "Conformidad del Cliente · ", bold: true, size: 18, font: FB }), ...runs(m.firmaCliente, { size: 18 })] }), new Paragraph({ children: [new TextRun({ text: "Aclaración / cargo:", size: 17, color: DC.mut, font: FB })] })] }),
      ],
    })],
  }));

  const doc = new Document({
    creator: "Nexolibre",
    title: `Presupuesto · ${m.tipoLabel}`,
    description: "Presupuesto generado desde el sistema de gestión de Nexolibre",
    sections: [{
      properties: { page: { size: { width: PAGINA.ancho, height: PAGINA.alto }, margin: PAGINA.margen } },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100 }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: DC.line, space: 6 } }, children: [new TextRun({ text: m.pie, color: DC.mut, size: 15, font: FB })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40 }, children: [new TextRun({ text: "Nexolibre es miembro de  ", color: DC.mut, size: 15, font: FB }), new ImageRun({ type: "png", data: await imagen("gruponexo-logo.png"), transformation: { width: 74, height: 23 } })] }),
          ],
        }),
      },
      children: kids,
    }],
  });
  return Packer.toBlob(doc);
}

window.generarDocx = generarDocx;
window.generarPresupuestoDocx = generarPresupuestoDocx;

// ============================================================
//  Propuesta comercial en .docx (propuesta.js)
//  Membrete en encabezado y pie, una hoja por sección: portada,
//  alcance y propuesta económica. Sin cláusulas: eso es del contrato.
// ============================================================
async function generarPropuestaDocx(id) {
  const p = (state.propuestas || []).find((x) => x.id === id);
  if (!p) return;
  const cli = (state.clientes || []).find((c) => c.id === p.clienteId) || {};
  toast("Generando propuesta…");
  try {
    const D = await cargarDocx();
    const m = NEXO_PROPUESTA.construirPropuesta(p, cli);
    const blob = await armarPropuestaDocx(D, m);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${m.nombreArchivo}.docx`.replace(/[\/\\:*?"<>|]/g, "-");
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Propuesta descargada ✓");
  } catch (e) {
    toast("No se pudo generar el .docx: " + e.message, true, true);
  }
}

async function armarPropuestaDocx(D, m) {
  const {
    Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
    Table, TableRow, TableCell, WidthType, ImageRun, Header, Footer, PageBreak, ShadingType,
  } = D;
  const GRIS = "8C867D", OSCURO = "4A443E", RESALTE = "C47500";

  const dec = (s) => String(s ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  // <b> negrita, <em> resaltado naranja de la marca.
  const runs = (frag, { size = 20, color = DC.ink, bold: base = false, italics = false, font = FB } = {}) => {
    const out = [];
    let b = false, e = false;
    for (const part of dec(frag).split(/(<\/?(?:b|em)>)/)) {
      if (part === "<b>") { b = true; continue; }
      if (part === "</b>") { b = false; continue; }
      if (part === "<em>") { e = true; continue; }
      if (part === "</em>") { e = false; continue; }
      if (!part) continue;
      out.push(new TextRun({ text: part.replace(/<[^>]+>/g, ""), bold: base || b || e, italics, color: e ? RESALTE : color, size, font }));
    }
    return out;
  };
  const P = (frag, o = {}) => new Paragraph({ children: runs(frag, o), alignment: o.align ?? AlignmentType.JUSTIFIED,
    spacing: { before: o.before ?? 0, after: o.after ?? 140, line: 276 }, keepNext: o.keepNext });
  const kicker = () => new Paragraph({ children: [new TextRun({ text: m.kicker, bold: true, color: DC.orange, size: 16, font: FB, characterSpacing: 40 })], spacing: { before: 200, after: 60 } });
  const H1 = (frag) => new Paragraph({ children: runs(frag, { size: 34, bold: true, color: DC.taupe, font: FH }), spacing: { after: 60 } });
  const linea = () => new Paragraph({ children: [], spacing: { before: 120, after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: DC.line, space: 1 } } });
  const H3 = (frag) => P(frag, { size: 20, bold: true, color: OSCURO, font: FH, after: 40, before: 120, keepNext: true, align: AlignmentType.LEFT });
  const salto = () => new Paragraph({ children: [new PageBreak()] });
  const sinBorde = ["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"]
    .reduce((a, k) => (a[k] = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, a), {});
  const conBorde = ["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"]
    .reduce((a, k) => (a[k] = { style: BorderStyle.SINGLE, size: 4, color: DC.ink }, a), {});
  const celda = (hijos, w, o = {}) => new TableCell({ width: { size: w, type: WidthType.PERCENTAGE }, children: hijos,
    shading: o.bg ? { type: ShadingType.CLEAR, fill: o.bg } : undefined,
    margins: { top: o.pad ?? 110, bottom: o.pad ?? 110, left: 140, right: 140 } });

  const kids = [];

  // ---------- Portada ----------
  kids.push(kicker());
  kids.push(H1(`${m.titulo.pre ? m.titulo.pre + " " : ""}<em>${m.titulo.resaltado}</em>`));
  kids.push(P(`Preparado exclusivamente para <em>${m.cliente}</em>${m.plan ? ` · ${m.plan}` : ""}`, { color: GRIS, after: 20, align: AlignmentType.LEFT }));
  kids.push(P(`${m.numero ? `Propuesta ${m.numero} · ` : ""}${m.fecha}`, { color: GRIS, size: 16, after: 0, align: AlignmentType.LEFT }));
  kids.push(linea());
  kids.push(P(m.intro.destacado, { bold: true, size: 22, color: OSCURO, after: 200 }));
  m.intro.parrafos.forEach((t) => kids.push(P(t)));
  if (m.equipos.length) {
    kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: conBorde, rows: [
      new TableRow({ tableHeader: true, children: ["#", "Equipo", "Modalidad", "Ubicación"].map((h, i) =>
        celda([P(h, { bold: true, color: OSCURO, after: 0, align: AlignmentType.LEFT })], [6, 50, 18, 26][i], { bg: DC.crema, pad: 60 })) }),
      ...m.equipos.map((e) => new TableRow({ children: [String(e.n), e.equipo, e.modalidad, e.ubicacion || "—"].map((v, i) =>
        celda([P(v, { after: 0, align: AlignmentType.LEFT })], [6, 50, 18, 26][i], { pad: 60 })) })),
    ] }));
  }

  // ---------- Alcance ----------
  kids.push(salto());
  kids.push(kicker());
  kids.push(H1("Alcance del Programa"));
  kids.push(linea());
  kids.push(P(m.alcanceIntro, { after: 200 }));
  for (const a of m.alcance) {
    kids.push(H3(a.titulo));
    kids.push(P(a.porque, { after: 20, keepNext: true }));
    kids.push(P(a.que, { color: GRIS }));
  }
  if (m.opcionales) { kids.push(H3("Servicios opcionales")); kids.push(P(m.opcionales)); }

  // ---------- Propuesta económica ----------
  kids.push(salto());
  kids.push(kicker());
  kids.push(H1("Propuesta Económica"));
  kids.push(linea());
  kids.push(P(m.economicaIntro));
  if (m.referencia) { kids.push(H3("Valor de referencia del Programa")); kids.push(P(m.referencia, { bold: true, size: 24, align: AlignmentType.LEFT })); }
  if (m.precio) { kids.push(H3(m.precioTitulo)); kids.push(P(m.precio, { bold: true, size: 24, align: AlignmentType.LEFT })); }
  if (m.precioNota) kids.push(P(m.precioNota));
  kids.push(H3("Condiciones comerciales"));
  kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: conBorde,
    rows: m.condiciones.map(([l, v]) => new TableRow({ children: [
      celda([P(l, { bold: true, color: OSCURO, size: 19, after: 0, align: AlignmentType.LEFT })], 38, { bg: DC.crema }),
      celda([P(v, { size: 19, after: 0, align: AlignmentType.LEFT })], 62),
    ] })) }));
  kids.push(P(m.aviso, { italics: true, color: GRIS, size: 16, before: 120 }));
  kids.push(linea());
  kids.push(P(m.cierre));

  // ---------- Membrete ----------
  const header = new Header({ children: [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: sinBorde, rows: [
    new TableRow({ children: [
      celda(["innovación", "y crecimiento", "continuo_"].map((t) => new Paragraph({ children: [new TextRun({ text: t, italics: true, color: DC.orange, size: 20, font: FB })] })), 50, { pad: 0 }),
      celda([new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ type: "png", data: await imagen("nexolibre-logo.png"), transformation: { width: 172, height: 40 } })] })], 50, { pad: 0 }),
    ] }),
  ] })] });
  const footer = new Footer({ children: [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: sinBorde, rows: [
    new TableRow({ children: [
      ...NEXO_PROPUESTA.OFICINAS.map((o) => celda([
        new Paragraph({ children: [new TextRun({ text: o.pais, color: DC.orange, size: 13, font: FB })] }),
        ...o.lineas.map((l) => new Paragraph({ children: [new TextRun({ text: l, color: DC.taupe, size: 13, font: FB })] })),
      ], 21, { pad: 0 })),
      celda([new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "www.nexolibre.com", bold: true, color: DC.orange, size: 18, font: FB })] })], 37, { pad: 0 }),
    ] }),
  ] })] });

  const doc = new Document({
    creator: "Nexolibre",
    title: `Propuesta · Programa de Continuidad Operativa · ${dec(m.cliente)}`,
    description: "Generado desde el sistema comercial de Nexolibre",
    sections: [{
      properties: { page: { size: { width: PAGINA.ancho, height: PAGINA.alto },
        margin: { top: 1900, right: 1500, bottom: 1700, left: 1500, header: 600, footer: 500 } } },
      headers: { default: header },
      footers: { default: footer },
      children: kids,
    }],
  });
  return Packer.toBlob(doc);
}
