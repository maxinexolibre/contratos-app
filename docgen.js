/* ============================================================
   Nexolibre · Generación del contrato en .docx (editable)
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
  if (!c) return;
  toast("Generando documento…");
  try {
    const D = await cargarDocx();
    const m = NEXO_CONTRATO.construirContrato(c, { plantilla: false });
    const blob = await armarDocx(D, m, c);
    const nombre = `${c.numero || "Contrato"} - ${nombreCliente(c)} - ${m.esContrato ? "Contrato" : "Propuesta"} MRI-CT.docx`
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
  kids.push(new Paragraph({ children: [new TextRun({ text: "Términos y Condiciones Generales del Servicio", bold: true, color: DC.taupe, size: 34, font: FH })], spacing: { after: 160 } }));
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
    title: `${m.esContrato ? "Contrato" : "Propuesta"} de Mantenimiento MRI / CT`,
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

window.generarDocx = generarDocx;
