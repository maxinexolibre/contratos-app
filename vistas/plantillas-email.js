/**
 * Plantillas de email para la prospección (área Marketing · Esta semana).
 *
 * Copy por segmento de decisor y por toque de la secuencia (0 · +4 · +11 · +21).
 * El panel "Redactar" arma el asunto y el cuerpo con estos textos y los datos
 * del lead, así quien prospecta no escribe de cero ni busca la plantilla: abre,
 * copia, lo pega en su casilla y manda.
 *
 * SIN FIRMA a propósito: el cuerpo termina en el contenido. La firma la agrega
 * el cliente de correo de cada uno (Gmail/Outlook/etc.) al enviar, así no queda
 * duplicada. Lo único que se personaliza es el nombre del saludo de apertura
 * (FIRMA.nombre), por si lo manda otra persona.
 *
 * Es copy comercial de Nexolibre, sin datos de clientes: vive en el repo público
 * sin problema. Los textos completos y la estrategia están en OneDrive
 * (Marketing y Diseño/Email/).
 *
 * Marcadores:
 *   {inst}  institución del lead          {nom}  nombre del decisor (o "[Nombre]")
 *   Los [corchetes] que quedan (p. ej. [equipo], [MRI/CT]) los completa a mano
 *   quien manda: son datos que la app no tiene todavía.
 */
(function (global) {
  "use strict";

  /**
   * Quién firma. Solo se usa en el saludo de apertura ("Soy {nombre}, de
   * Nexolibre"). La firma de pie la pone tu propio correo, no la plantilla.
   * Si lo manda otra persona, cambiá el nombre acá.
   */
  const FIRMA = { nombre: "Maxi" };
  const YO = FIRMA.nombre || "[Nombre]";
  const baja = "\n\nSi preferís que no te vuelva a escribir, respondé “baja” y listo.";

  // Cada segmento: 4 toques { asunto, cuerpo }. {inst} y {nom} se reemplazan.
  // El cuerpo NO lleva firma: la agrega el correo al enviar.
  const T = {
    DirectorMedico: [
      { asunto: "Auditoría del contrato de service de [MRI/CT] — {inst}",
        cuerpo: `Hola {nom},

Soy ${YO}, de Nexolibre. Trabajamos el service multimarca de equipos de diagnóstico por imágenes con tres laboratorios propios de reparación en la región.

No te escribo para venderte nada hoy. Si estás por firmar o renovar el contrato de service de tu [resonador/tomógrafo], pasámelo y te marco dónde están los agujeros —cláusulas de exclusión, topes de repuestos, tiempos de respuesta sin penalidad—, aunque termines renovando con tu proveedor actual.

Es gratis y te lo devuelvo por escrito en una semana. ¿Te sirve?${baja}` },
      { asunto: "Re: Auditoría del contrato de service de [MRI/CT]",
        cuerpo: `Hola {nom}, te dejo una sola cosa concreta por si ayuda a ubicarnos:

Un equipo parado no es un problema técnico, es financiero —turnos perdidos, derivante que aprende otro camino, personal que cobra igual. Por eso medimos la respuesta en días, no semanas: tenemos la pieza y el criterio en laboratorio propio, no esperando importación.

El ofrecimiento de la auditoría sigue en pie. Un renglón tuyo y coordinamos.` },
      { asunto: "Lo que te cubre si sale mal",
        cuerpo: `Hola {nom},

Sé que elegir fuera del fabricante se siente arriesgado: si algo falla, la decisión fue tuya. Por eso lo armamos para que sea defendible, no solo conveniente:

- SLA por escrito con penalidad por incumplimiento.
- Un ingeniero asignado con nombre y cara, antes de la visita.
- El respaldo institucional de Grupo Nexo.

No te pido una reunión: te pido 20 minutos de tu contrato actual para mostrarte, con tu propio papel, qué pasa hoy si tu equipo se cae un martes a la mañana.` },
      { asunto: "Cierro el hilo",
        cuerpo: `Hola {nom},

Te escribí un par de veces por el service de tu [equipo] y no tuve respuesta —seguramente no es el momento, todo bien. Cierro acá.

Si en algún momento el contrato del fabricante te aprieta o un equipo te deja a pie, el ofrecimiento de la auditoría sigue en pie. Quedo a tu disposición.

Éxitos.` },
    ],
    IngenieriaClinica: [
      { asunto: "¿Reparás bobinas/gradientes o las mandás a importar?",
        cuerpo: `Hola {nom},

Soy ${YO}, de Nexolibre. Tenemos tres laboratorios propios donde reparamos bobinas de RF, gradientes, camillas y electrónica de MRI/CT —en vez de reemplazar por importación.

Si alguna vez te quedaste esperando una pieza tres semanas, ya sabés el problema. Si estás por renovar el contrato de service, pasámelo y te marco qué cubre y qué no (los topes de repuestos suelen estar enterrados en una cláusula). Gratis, por escrito.

¿Te paso fotos del laboratorio así ves de qué hablo?${baja}` },
      { asunto: "La bobina abierta",
        cuerpo: `Hola {nom}, una sola cosa:

[Adjuntar foto/video del laboratorio con una pieza en reparación]

El OEM te cambia la pieza por una nueva importada y te cobra como tal; nosotros la reparamos y vuelve al equipo en días. Mismo resultado, otra economía y otro tiempo.

Si querés, te mando la lista de lo que reparamos en laboratorio propio.` },
      { asunto: "Para cuando te pregunten “¿y si sale mal?”",
        cuerpo: `Hola {nom},

Vos sabés que el independiente te resuelve más rápido. El problema es convencer a tu director, que es el que firma. Te dejo lo que podés mostrarle para que la decisión sea defendible:

- SLA por escrito con penalidad.
- Ingeniero asignado con nombre (probablemente trabajes directo con él).
- Protocolo escrito de qué pasa si sale mal.
- Respaldo de Grupo Nexo.

Con eso en la mano, la conversación interna deja de ser “confiemos en un tercero” y pasa a ser “tenemos cobertura por escrito”.` },
      { asunto: "Quedo a mano",
        cuerpo: `Hola {nom},

No tuve respuesta, así que cierro el hilo —el día a día te come, lo entiendo. Te dejo el laboratorio a mano: cuando tengas una pieza complicada o un equipo caído y el OEM te diga “tres semanas”, escribime y lo vemos.

Éxitos.` },
    ],
    GerenteGeneral: [
      { asunto: "El contrato de service que se renueva solo",
        cuerpo: `Hola {nom},

Soy ${YO}, de Nexolibre. La mayoría de los contratos de service de imágenes se autorrenuevan con aumento y nadie los vuelve a mirar hasta que algo se rompe.

Si estás por renovar el de {inst}, pasámelo y te devuelvo por escrito dónde estás pagando de más y qué no te cubre —gratis, aunque sigas con tu proveedor. Suele haber un 20-40% de diferencia y cláusulas de repuestos que nadie leyó.

¿Te sirve que lo mire?${baja}` },
      { asunto: "Re: El contrato de service que se renueva solo",
        cuerpo: `Hola {nom},

Un dato para dimensionar: mantenemos equipos multimarca con tres laboratorios propios de reparación, lo que baja el costo de las piezas críticas sin resignar cobertura. Para una flota de [N] equipos fuera de garantía, la diferencia anual suele pagar varias cosas más urgentes.

El ofrecimiento de revisar tu contrato actual sigue en pie.` },
      { asunto: "Sin riesgo para el que firma",
        cuerpo: `Hola {nom},

Entiendo que cambiar de proveedor de service es una decisión que después hay que justificar. Por eso la armamos para que sea defendible en números y en papeles:

- SLA con penalidad por incumplimiento (si no cumplimos, lo pagamos nosotros).
- Respaldo institucional de Grupo Nexo.
- La comparación, lado a lado, de tu contrato actual contra lo que te proponemos.

Son 20 minutos sobre tu propio contrato, sin compromiso. ¿Lo vemos esta semana o la que viene?` },
      { asunto: "Cierro",
        cuerpo: `Hola {nom},

Sin respuesta, cierro el hilo. Cuando toque la próxima renovación —o cuando el aumento del fabricante llame la atención en el directorio— tené a mano la auditoría gratis. Quedo a tu disposición.

Éxitos.` },
    ],
  };
  // El radiólogo es del track de software/IA (otro comprador): por ahora usa el
  // mismo ángulo que el director para no quedar sin plantilla.
  T.Radiologo = T.DirectorMedico;

  const NOMBRE_SEG = {
    DirectorMedico: "Director médico / Jefe de imágenes",
    IngenieriaClinica: "Ingeniería clínica / Mantenimiento",
    GerenteGeneral: "Gerente general / Dirección",
    Radiologo: "Radiólogo / Jefe de informes",
  };

  /**
   * Arma asunto y cuerpo para un lead y un toque.
   * @param {string} segmento  clave de T (si no hay, cae a DirectorMedico)
   * @param {number} idx       índice de toque 0..3
   * @param {object} lead      { institucion, contactoNombre }
   */
  function armar(segmento, idx, lead) {
    const serie = T[segmento] || T.DirectorMedico;
    const i = Math.max(0, Math.min(idx, serie.length - 1));
    const base = serie[i];
    const inst = (lead && lead.institucion) || (lead && lead.contactoNombre) || "tu institución";
    // Si el nombre de contacto es distinto de la institución, se usa; si no,
    // queda [Nombre] para completar cuando se identifique al decisor.
    const nom = (lead && lead.contactoNombre && lead.contactoNombre !== lead.institucion)
      ? lead.contactoNombre : "[Nombre]";
    const rep = (s) => String(s).replaceAll("{inst}", inst).replaceAll("{nom}", nom);
    return { asunto: rep(base.asunto), cuerpo: rep(base.cuerpo), toque: i + 1, total: serie.length };
  }

  global.NEXO_PLANTILLAS_EMAIL = { armar, FIRMA, NOMBRE_SEG, segmentos: Object.keys(NOMBRE_SEG) };
})(typeof window !== "undefined" ? window : globalThis);
