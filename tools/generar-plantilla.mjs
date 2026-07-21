import fs from "node:fs"; import vm from "node:vm";
const _els={}, store={};
const el=()=>({style:{},classList:{add(){},remove(){},toggle(){}},dataset:{},files:[],value:"",checked:false,
  querySelectorAll:()=>[],querySelector:()=>null,insertAdjacentHTML(){},appendChild(){},click(){},remove(){},innerHTML:"",textContent:""});
const ctx={_els,console,structuredClone,TextEncoder,TextDecoder,btoa,atob,setTimeout,clearTimeout,Blob,URL,
  localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v),removeItem:k=>delete store[k]},
  fetch:async(u)=>({ok:true, arrayBuffer:async()=>fs.readFileSync(u.replace(/^\//,"")).buffer}),
  document:{createElement:()=>({style:{},click(){}}),head:{appendChild(){}},getElementById:(id)=>(_els[id]||=el()),
            querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},
  location:{hash:""},alert(){},confirm:()=>true,prompt:()=>null,print(){}};
ctx.window=ctx; ctx.globalThis=ctx; ctx.addEventListener=()=>{};
vm.createContext(ctx);
for(const f of ["config.js","brand.js","planes.js","contrato.js","app.js"]) vm.runInContext(fs.readFileSync(f,"utf8"),ctx,{filename:f});
vm.runInContext(fs.readFileSync("vendor/docx.iife.js","utf8"),ctx,{filename:"docx.iife.js"});
vm.runInContext("window.docx = docx;",ctx);
vm.runInContext(fs.readFileSync("docgen.js","utf8"),ctx,{filename:"docgen.js"});
const R=(e)=>vm.runInContext(e,ctx);

// Contrato PLANTILLA: sin datos → el sistema emite [campos] en naranja.
// Dos RM y un CT para que se vea el cupo compartido y el n/a de tomografía.
const blob = await R(`(async()=>{
  const T = {
    id:"plantilla", tipo:"contrato", numero:"", estado:"firme_vigente",
    cliente:{ nombreComercial:"", razonesSociales:[{razonSocial:"",cuit:"",domicilio:"",principal:true},{razonSocial:"[razón social adicional]",cuit:"[CUIT]",domicilio:"",principal:false}],
              contacto:"", localidad:"", provincia:"" },
    plan:{ id:"professional", etiquetaPublica:"", modulos:[], notasInternas:"" },
    negociacion:{ desviaciones:[] },
    equipos:[ {modelo:"",marca:"",modalidad:"MRI",serie:"",ubicacion:""},
              {modelo:"",marca:"",modalidad:"MRI",serie:"",ubicacion:""},
              {modelo:"",marca:"",modalidad:"CT",serie:"",ubicacion:""} ],
    cobertura: Object.assign(structuredClone(NEXO_CATALOGO.PLANES.performance.base), {reparacionesIncluidas:[], incluirSLA:true}),
    economico:{ canonMensual:"", moneda:"USD", incluyeIVA:false, ivaPct:21, formaPago:"" },
    ajuste:{ periodicidad:"", indice:"", proximoAjuste:"", historial:[] },
    vigencia:{ inicio:"", meses:"", fin:"", renovacionAutomatica:true, preavisoDias:"" },
    fechas:{creado:"",enviado:"",firmado:""}, archivos:[], notas:"", historialEstados:[]
  };
  state.data.push(T);
  const m = NEXO_CONTRATO.construirContrato(T,{plantilla:true});
  m.etiquetaPub = "[Nivel NexoCare®]";
  m.pie = "Esta propuesta se rige por los Términos y Condiciones Generales del Programa aquí incluidos. Los campos [entre corchetes] se completan al perfeccionar el acuerdo.";
  return await armarDocx(window.docx, m, T);
})()`);
const buf = Buffer.from(await blob.arrayBuffer());
const out = "/Users/Maxi/Library/CloudStorage/OneDrive-Personal/2. Comercial/Marketing y Diseño/Nexolibre - Plantilla Programa de Continuidad Operativa (NexoCare).docx";
fs.writeFileSync(out, buf);
console.log("plantilla:", buf.length, "bytes →", out.split("/").pop());
