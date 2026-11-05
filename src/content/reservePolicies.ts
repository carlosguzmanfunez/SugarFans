// Reserve policy drafts shown in /legal. Every one is a DRAFT: it requires legal
// review before production launch, and the page says so on each document.
import { PROHIBITED_EXPERIENCES, PROFESSIONAL_SERVICES_ALLOWED, CANCELLATION_RULE, PROHIBITED_LOCATIONS } from '../config/reserve';

export interface PolicySection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface PolicyDoc {
  id: string;
  name: string;
  icon: string;
  intro: string;
  sections: PolicySection[];
}

export const LEGAL_REVIEW_NOTICE = 'Requires legal review before production launch.';
export const LEGAL_UPDATED = 'Noviembre 2026 (borrador)';

export const RESERVE_POLICIES: PolicyDoc[] = [
  {
    id: 'reserve-agreement',
    name: 'Acuerdo de Creator (Reserve)',
    icon: 'fa-file-signature',
    intro:
      'Condiciones adicionales para los creadores que publican experiencias en Reserve. Complementan el Contrato de Creadores.',
    sections: [
      {
        heading: '1. Qué ofreces',
        paragraphs: [
          'Reserve permite ofrecer experiencias definidas, no la compañía de una persona. Cada experiencia debe indicar tipo, modalidad, duración, precio, disponibilidad, ubicación cuando aplique, qué incluye, qué no incluye, requisitos, aprobación y política de cancelación.',
          'Solo puedes publicar los tipos de experiencia permitidos para tu categoría. Fans Reserve puede ocultar o retirar experiencias que no cumplan estas reglas.',
        ],
      },
      {
        heading: '2. Tu control',
        bullets: [
          'Decides precio, duración, días, horas, anticipación mínima, modalidad, tipos de lugar, número de participantes y requisitos.',
          'Eliges aprobación manual o automática; algunos tipos (apariciones, producciones, colaboraciones) siempre requieren tu aprobación.',
          'Puedes aceptar, rechazar o enviar una contraoferta sin dar explicaciones.',
          'Puedes reportar o bloquear a cualquier fan.',
        ],
      },
      {
        heading: '3. Tus compromisos',
        bullets: [
          'Cumplir lo publicado, en la fecha, hora y lugar confirmados.',
          'No ofrecer ni aceptar servicios prohibidos, aunque el fan los proponga.',
          'No mover el contacto ni los pagos fuera de Fans Reserve.',
          'Cumplir las leyes, permisos e impuestos aplicables a tu actividad y a tu país.',
        ],
      },
      {
        heading: '4. Pagos',
        paragraphs: [
          'El flujo es: solicitud, aceptación, pago, confirmación, experiencia y liquidación. En las experiencias con aprobación, el fan paga cuando aceptas; en las de confirmación inmediata, paga al reservar. Paga con PayPal o con sus Créditos. Fans Reserve procesa el pago en nombre del creador, retiene su comisión y registra la parte del creador como saldo a su favor, que se acumula en ciclos del 26 al 25, se acredita al comenzar el 26 y se solicita a su cuenta PayPal del 26 al día 1 siguiente, ambos incluidos, en hora de Fans Reserve (UTC−6).',
          'Recibes el 80% del neto de cada reserva (lo que paga el fan menos la comisión de PayPal), o el porcentaje mayor que te dé tu nivel, el programa de Creadores Fundadores o los fans de tu enlace, según el Contrato de Creadores.',
          'Si activas un descuento para suscriptores (del 5% al 25%), lo absorbes de tu parte: la parte de Fans Reserve se calcula sobre el precio sin descuento.',
        ],
      },
      {
        heading: '5. Cancelaciones y fiabilidad',
        bullets: [
          'Si el fan cancela con 24 horas o más de anticipación, se le devuelve el 100% menos la comisión de cobro de PayPal y esa venta no se te acredita.',
          'Si el fan cancela con menos de 24 horas, se le devuelve el 50% menos la comisión de cobro de PayPal; la otra mitad se reparte como una venta normal y recibes tu porcentaje de ella.',
          'Si el fan no se presenta, conservas tu ganancia completa.',
          'Si cancelas una reserva pagada o no cumples lo publicado, el fan recibe el 100%, pierdes la ganancia de esa reserva, cubres el costo de PayPal que no se recupere (con comprobante) y cuenta en tu historial de fiabilidad, que influye en tu nivel. Si ya retiraste esa ganancia, el ajuste se descuenta de tus ingresos futuros.',
          'El fan tiene un cambio de fecha gratis por reserva 1:1, pedido con 24 horas o más de anticipación. Tú lo aceptas o lo rechazas; mientras tanto la reserva sigue confirmada.',
          'Los detalles están en la política de Cancelación y No-show.',
        ],
      },
    ],
  },
  {
    id: 'reserve-policy',
    name: 'Política de Reserve',
    icon: 'fa-ticket',
    intro: 'Cómo funcionan las reservas de experiencias para fans y creadores.',
    sections: [
      {
        heading: 'Principio',
        paragraphs: ['Fans Reserve permite reservar experiencias, no personas. Una reserva da derecho únicamente a la experiencia descrita, en las condiciones publicadas.'],
      },
      {
        heading: 'Quién puede reservar y qué se reserva',
        bullets: [
          'Cualquier persona registrada y mayor de 18 años puede reservar o proponer una experiencia. No hace falta estar suscrito.',
          'Solo se puede reservar a creadores con identidad verificada.',
          'Formatos: Reserve 1:1 (videollamada privada en la sala de Fans Reserve, solo el fan y el creador), Reserve Event y Meet & Greet (experiencias de grupo con plazas limitadas, una plaza por fan) y experiencias presenciales o entregadas, según la categoría del creador.',
          'Todo el video en vivo con un creador se reserva y se paga en Reserve. La suscripción no incluye Lives ni videollamadas.',
          'Proponer experiencia: el fan describe lo que quiere y el creador la acepta, la rechaza o responde con una contraoferta. Una propuesta no aparta el horario hasta que se paga.',
        ],
      },
      {
        heading: 'Estados de una reserva',
        bullets: [
          'Solicitud pendiente: el creador la revisa.',
          'Contraoferta: el creador propone otra fecha, hora, precio o duración; el fan la acepta o la rechaza.',
          'Aceptada, pendiente de pago: el fan puede pagar.',
          'Confirmada: pagada; recibe la confirmación.',
          'Realizada, Rechazada, Cancelada, Reprogramación solicitada y En revisión (disputa).',
        ],
      },
      {
        heading: 'Regalos, suscripción y Reserve son distintos',
        bullets: [
          'Los regalos son apoyo voluntario. No garantizan respuesta, conversación, acceso ni experiencias de Reserve.',
          'La suscripción da acceso al contenido exclusivo y a los beneficios que el creador define. No incluye Reserve Events, videollamadas 1:1 ni otras experiencias de Reserve. Un creador puede ofrecer un descuento explícito a suscriptores en sus experiencias.',
          'Reserve es la única vía para reservar una experiencia.',
        ],
      },
      {
        heading: 'Experiencias presenciales',
        paragraphs: [
          'Ocurren en venues, estudios, gimnasios, salones, espacios culinarios o artísticos, eventos y lugares públicos o comerciales.',
          'En todas las categorías menos Tu gente, una experiencia presencial o una propuesta de reserva también puede darse en el lugar del creador (su restaurante, local, estudio, taller o casa) o en el lugar que proponga el fan (por ejemplo, un chef, un entrenador, un profesor o un músico que va a tu casa u oficina). Esas reservas siempre las aprueba el creador a mano, y el creador puede rechazar cualquier lugar. En Tu gente, solo lugares públicos, eventos y estudios profesionales.',
          'Nunca en:',
        ],
        bullets: PROHIBITED_LOCATIONS.map((l) => l.label),
      },
    ],
  },
  {
    id: 'acceptable-experiences',
    name: 'Experiencias aceptables',
    icon: 'fa-circle-check',
    intro: 'Ejemplos de lo que sí se puede ofrecer en Reserve. La lista exacta depende de la categoría del creador.',
    sections: [
      { heading: 'Servicios profesionales con propósito', paragraphs: [PROFESSIONAL_SERVICES_ALLOWED] },
      {
        heading: 'Por categoría',
        bullets: [
          'Cocina: clases de cocina, asesoría culinaria, degustaciones y experiencias gastronómicas en restaurante, cocina profesional, el lugar del creador o el del fan, y catering para eventos.',
          'Fitness: entrenamiento 1:1 online, en gimnasio o a domicilio, coaching, rutinas personalizadas, evaluaciones y clínicas.',
          'Música: clases, escuchas y revisiones de demos, sesiones de estudio, talleres y apariciones en eventos.',
          'Gaming: partidas privadas, coaching, sesiones de juego, torneos, eventos y meet & greet.',
          'Arte & Creatividad: clases, revisiones de portafolio, mentorías, sesiones creativas y talleres.',
          'Belleza: asesorías de belleza, styling, sesiones de maquillaje en salón o estudio y talleres.',
          'Lifestyle: Q&A, coaching, charlas temáticas, behind the scenes, acceso anticipado, meet & greet y eventos.',
          'Educación: mentorías, coaching, Q&A, revisiones con feedback y talleres.',
          'Tu gente: sesiones de fotos profesionales en estudio, asesoría de posado y portafolio, charlas de moda y belleza, apariciones en eventos, colaboraciones de marca.',
        ],
      },
      {
        heading: 'Tu gente',
        paragraphs: ['Contenido sexual explícito no permitido. Las experiencias de esta categoría son profesionales y se realizan online, en estudios, eventos o lugares públicos o comerciales.'],
      },
    ],
  },
  {
    id: 'prohibited-services',
    name: 'Servicios prohibidos',
    icon: 'fa-ban',
    intro: 'Lo que nunca se puede ofrecer, solicitar ni acordar a través de Fans Reserve, en ninguna categoría.',
    sections: [
      { heading: 'Qué sí está permitido', paragraphs: [PROFESSIONAL_SERVICES_ALLOWED] },
      { heading: 'Prohibido', bullets: [...PROHIBITED_EXPERIENCES] },
      {
        heading: 'También prohibido',
        bullets: [
          'Compartir teléfono, correo o redes para continuar fuera de la plataforma, o pedir pagos por fuera.',
          'Cualquier experiencia con menores de edad o que los involucre.',
          'Usar descripciones ambiguas para ofrecer servicios prohibidos.',
        ],
      },
      {
        heading: 'Cómo lo aplicamos',
        paragraphs: [
          'Las experiencias y solicitudes pasan por una revisión automática básica que bloquea los casos claros y marca los dudosos para que el creador y el equipo los revisen. Las fotos y los videos se analizan automáticamente antes de publicarse. Los usuarios pueden reportar cualquier perfil, experiencia o reserva. Las infracciones pueden suponer la retirada de la experiencia y el cierre de la cuenta.',
        ],
      },
    ],
  },
  {
    id: 'cancellation',
    name: 'Cancelación y No-show',
    icon: 'fa-calendar-xmark',
    intro: 'Qué pasa cuando una reserva se cancela o una de las partes no se presenta.',
    sections: [
      {
        heading: 'Una sola regla para todas las experiencias',
        paragraphs: ['Cuenta la hora de inicio en la zona horaria guardada con la reserva. La política comercial no sustituye los derechos legales de devolución. El fan puede solicitar la devolución al medio original o elegir Créditos voluntariamente cuando corresponda.'],
        bullets: CANCELLATION_RULE.bullets,
      },
      {
        heading: 'Antes del pago',
        paragraphs: ['Una propuesta pendiente no aparta el horario. Una experiencia de confirmación inmediata se aparta durante 15 minutos para pagar; si hubo aprobación del creador, el plazo es de 2 horas. Al vencer sin pago se libera, salvo que PayPal esté comprobando un cobro incierto. El fan puede cancelar antes de pagar sin mover dinero.'],
      },
      {
        heading: 'Reembolsos e incumplimientos',
        bullets: [
          'En experiencias presenciales, si el creador no se presenta, llega más de 15 minutos tarde, cambia por su cuenta la fecha, la hora o el lugar, o la experiencia no corresponde a lo publicado, el fan recibe el reembolso completo, previa verificación.',
          'En sesiones virtuales, el creador dispone de un minuto de tolerancia desde el inicio confirmado, sin penalización por esa demora. Debe cumplir la duración contratada: la tolerancia no permite reducirla. Una demora mayor o una sesión que no pueda realizarse por causas del creador se registra para revisión; si se confirma incumplimiento, corresponde la devolución completa.',
          'Si el creador cancela una reserva pagada, se trata como un incumplimiento: el fan recibe el 100% por el medio original (o en Créditos si así pagó) y la cancelación cuenta en el historial de fiabilidad del creador.',
          'El fan es responsable de cumplir la fecha, hora, lugar, requisitos y condiciones publicados. La ausencia o llegada tarde del fan no genera una devolución comercial ni repone el tiempo perdido, sin limitar los derechos legales aplicables.',
          'Para pedir la devolución por incumplimiento, el fan usa Solicitar devolución o Reportar en Mis reservas. Se recomienda hacerlo dentro de 48 horas para conservar la evidencia, sin reducir plazos ni derechos legales. La solicitud queda registrada para revisión.',
          'Si se confirma el incumplimiento del creador, se solicita la devolución del 100% al medio original del fan. El costo real de PayPal no devuelto se registra como cargo separado contra los ingresos presentes o futuros del creador, con comprobante y explicación. Los errores atribuibles a Fans Reserve no se cargan al creador.',
        ],
      },
      {
        heading: 'Preparación y puntualidad en las sesiones virtuales',
        bullets: [
          'Se programan avisos para el fan y el creador diez minutos y un minuto antes de la sesión. Son una ayuda: la fecha y hora confirmadas siguen siendo responsabilidad de cada participante. Su entrega depende también de la conexión y los permisos del dispositivo.',
          'Mantén el celular desbloqueado, Fans Reserve abierto y visible, una conexión estable y los permisos de cámara y micrófono disponibles. Al preparar la llamada, acepta los permisos solicitados por el navegador y comprueba que los dispositivos funcionen. En eventos de solo visualización no se requiere publicar cámara o micrófono del fan.',
          'El fan debe ingresar puntualmente. El tiempo perdido por su ausencia, llegada tardía o problemas comprobados de su propio dispositivo no se repone ni extiende el horario reservado. No se aplica esta regla a fallas de Fans Reserve, incumplimiento del creador o derechos legales de devolución, reparación o compensación.',
          'Que el sistema haya enviado una notificación no prueba que se recibió, leyó o que el teléfono causó un problema. La responsabilidad se determina mediante los registros y la revisión del caso; una falta de evidencia no se considera por sí sola ausencia o culpa del fan.',
          'La preparación y espera anteriores a la hora acordada no consumen la duración contratada. El inicio automático requiere que la persona haya aceptado prepararse y que la pantalla siga visible. Cada participante puede cancelar esa preparación.',
          'Se conservan por separado la versión de las indicaciones aceptadas, la preparación declarada por el navegador, los avisos y las entradas y salidas confirmadas por el servidor de videollamada. No se graba audio, video ni el contenido de la conversación. Estos datos sirven para revisar incidencias y responder reclamaciones, con acceso limitado a los participantes de su reserva y al personal autorizado.',
          'Las condiciones nuevas se identifican por su versión y no sustituyen retroactivamente las condiciones de una reserva anterior. Se conservan los derechos y las vías de reclamación legales aplicables.',
        ],
      },
      {
        heading: 'Créditos, regalos y contracargos',
        bullets: [
          'Los Créditos y los regalos no son reembolsables en dinero, salvo cobro duplicado, error técnico o cuando la ley lo exija. Los Créditos que recibes por una cancelación funcionan igual que los comprados.',
          'Si un fan abre un contracargo con su banco por una experiencia que sí se dio, la cuenta puede suspenderse mientras se revisa.',
          'Mientras PayPal resuelve una disputa, la parte del creador de esa venta queda congelada. Si el fan gana, se descuenta del saldo del creador (de sus ingresos futuros si ya la retiró); si el equipo determina que no fue culpa del creador, Fans Reserve asume el importe. Si el fan pierde, la parte del creador se libera.',
        ],
      },
      {
        heading: 'Cómo se devuelve el dinero',
        paragraphs: ['Ejemplo con una reserva de USD 25 pagada con PayPal y una comisión de cobro de USD 1.65: con 24 horas o más se devuelven USD 23.35; con menos de 24 horas, USD 10.85 (la mitad, USD 12.50, menos la comisión); en Créditos, 2,500 o 1,250 Créditos sin descuento; si el creador cancela, USD 25. La comisión exacta de cada pago aparece en Mis reservas.', 'La devolución al medio original queda pendiente hasta comprobar su ejecución. No se entrega simultáneamente dinero y Créditos por el mismo importe. La revocación legal de una contratación a distancia se revisa conforme a la normativa aplicable: en Honduras, los artículos 58 a 60 de la Ley de Protección al Consumidor contemplan cinco días hábiles para revocar un servicio aún no iniciado y hasta cinco días hábiles desde la notificación para restituir lo pagado. Una solicitud legal o un incumplimiento del creador no se cuenta como cancelación voluntaria.'],
      },
    ],
  },
  {
    id: 'community',
    name: 'Normas de la comunidad',
    icon: 'fa-people-group',
    intro: 'Cómo nos tratamos en Fans Reserve.',
    sections: [
      {
        heading: 'Respeto',
        bullets: [
          'Trata a creadores y fans con respeto; nadie está obligado a responder, aceptar ni continuar una conversación.',
          'Un regalo, una propina o una suscripción no dan derecho a nada que no esté descrito.',
          'Sin acoso, presión, amenazas ni insistencia después de un rechazo.',
        ],
      },
      {
        heading: 'Seguridad',
        bullets: [
          'Las experiencias presenciales se hacen en lugares públicos o profesionales; en el lugar del creador o del fan solo servicios profesionales aprobados por el creador, y nunca en Tu gente. Nunca en hoteles ni lugares discretos.',
          'Las videollamadas y los Lives no se graban. Está prohibido grabarlos o capturarlos por cualquier medio: el video muestra el nombre de quien lo ve y una copia filtrada identifica a su autor.',
          'Mantén la comunicación y los pagos dentro de Fans Reserve.',
          'Reporta cualquier conducta que te haga sentir inseguro.',
        ],
      },
      {
        heading: 'Contenido',
        paragraphs: ['Contenido sexual explícito no permitido. Sin contenido que involucre a menores, violencia o discriminación.'],
      },
    ],
  },
];

// Platform policies that use the same simple layout as the Reserve ones (also drafts).
export const PLATFORM_POLICIES: PolicyDoc[] = [
  {
    id: 'verification',
    name: 'Verificación de identidad',
    icon: 'fa-id-card',
    intro: 'Quién verifica su identidad en Fans Reserve, cómo se hace y qué datos se guardan.',
    sections: [
      {
        heading: 'Quién se verifica',
        bullets: [
          'Solo los creadores. Los fans confirman que son mayores de 18 años al entrar y al registrarse, y no suben documentos.',
          'Un creador sin verificar puede preparar su perfil y guardar publicaciones como borrador, pero no puede publicarlas ni recibir pagos. Al verificarse, sus borradores se publican.',
        ],
      },
      {
        heading: 'Cómo se hace',
        bullets: [
          'La verificación la hace Didit, nuestro proveedor de verificación de identidad: foto del documento oficial, prueba de vida con la cámara y comparación del rostro con el del documento.',
          'En un ordenador sin cámara, puede continuar en el móvil con el código QR que muestra la pantalla.',
          'Se rechaza a cualquier persona menor de 18 años. Si Didit no puede decidir, la revisa una persona del equipo.',
          'Al aprobarse, el perfil muestra la insignia "Verificado". El país del creador queda fijado al país del documento.',
        ],
      },
      {
        heading: 'Qué datos se guardan',
        bullets: [
          'Fans Reserve guarda el resultado, el nombre legal, la fecha de nacimiento, el país y el tipo y número del documento. Estos datos nunca se muestran en el perfil.',
          'Las imágenes del documento y del rostro las procesa Didit conforme a su propia política de privacidad; Fans Reserve no las guarda.',
          'Si la verificación se hace con el formulario manual de respaldo, las imágenes se eliminan al aprobarse.',
          'Podemos pedir una nueva verificación si hay indicios de suplantación o de un error.',
        ],
      },
    ],
  },
];
