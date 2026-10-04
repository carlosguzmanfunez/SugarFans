// Reserve policy drafts shown in /legal. Every one is a DRAFT: it requires legal
// review before production launch, and the page says so on each document.
import { PROHIBITED_EXPERIENCES, PROFESSIONAL_SERVICES_ALLOWED, CANCELLATION_POLICIES, PROHIBITED_LOCATIONS } from '../config/reserve';

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
export const LEGAL_UPDATED = 'Octubre 2026 (borrador)';

export const RESERVE_POLICIES: PolicyDoc[] = [
  {
    id: 'reserve-agreement',
    name: 'Acuerdo de Creator (Reserve)',
    icon: 'fa-file-signature',
    intro:
      'Condiciones adicionales para los creators que publican experiencias en Reserve. Complementan el Contrato de Creadores.',
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
          'El flujo previsto es: solicitud, aceptación, pago, confirmación, experiencia y liquidación. Mientras la plataforma está en modo de prueba no se realizan cargos reales. La integración con un procesador de pagos, la retención de fondos y los reembolsos se definirán antes del lanzamiento.',
        ],
      },
    ],
  },
  {
    id: 'reserve-policy',
    name: 'Política de Reserve',
    icon: 'fa-ticket',
    intro: 'Cómo funcionan las reservas de experiencias para fans y creators.',
    sections: [
      {
        heading: 'Principio',
        paragraphs: ['Fans Reserve permite reservar experiencias, no personas. Una reserva da derecho únicamente a la experiencia descrita, en las condiciones publicadas.'],
      },
      {
        heading: 'Estados de una reserva',
        bullets: [
          'Solicitud pendiente: el creator la revisa.',
          'Contraoferta: el creator propone otra fecha, hora, precio o duración; el fan la acepta o la rechaza.',
          'Aceptada, pendiente de pago: el fan puede pagar.',
          'Confirmada: pagada; recibe la confirmación.',
          'Realizada, Rechazada, Cancelada, Reprogramación solicitada y En revisión (disputa).',
        ],
      },
      {
        heading: 'Regalos, suscripción y Reserve son distintos',
        bullets: [
          'Los regalos son apoyo voluntario. No garantizan respuesta, conversación, acceso ni experiencias de Reserve.',
          'La suscripción da acceso al contenido, a los Lives para suscriptores (grupales, sin tiempo privado garantizado) y a los beneficios que el creator define. No incluye Reserve Events, sesiones privadas 1:1 ni otras experiencias de Reserve. Un creator puede ofrecer un descuento explícito a suscriptores en sus experiencias.',
          'Reserve es la única vía para reservar una experiencia.',
        ],
      },
      {
        heading: 'Experiencias presenciales',
        paragraphs: [
          'Ocurren en venues, estudios, gimnasios, salones, espacios culinarios o artísticos, eventos y lugares públicos o comerciales.',
          'En todas las categorías menos Tu gente, una experiencia presencial o una propuesta de reserva también puede darse en el lugar del creator (su restaurante, local, estudio, taller o casa) o en el lugar que proponga el fan (por ejemplo, un chef, un entrenador, un profesor o un músico que va a tu casa u oficina). Esas reservas siempre las aprueba el creator a mano, y el creator puede rechazar cualquier lugar. En Tu gente, solo lugares públicos, eventos y estudios profesionales.',
          'Nunca en:',
        ],
        bullets: PROHIBITED_LOCATIONS.map((l) => l.label),
      },
    ],
  },
  {
    id: 'acceptable-experiences',
    name: 'Experiencias Aceptables',
    icon: 'fa-circle-check',
    intro: 'Ejemplos de lo que sí se puede ofrecer en Reserve. La lista exacta depende de la categoría del creator.',
    sections: [
      { heading: 'Servicios profesionales con propósito', paragraphs: [PROFESSIONAL_SERVICES_ALLOWED] },
      {
        heading: 'Por categoría',
        bullets: [
          'Cocina: clases de cocina, asesoría culinaria, degustaciones y experiencias gastronómicas en restaurante, cocina profesional, el lugar del creator o el del fan, y catering para eventos.',
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
        paragraphs: ['Glamour permitido. Contenido sexual explícito no permitido. Las experiencias de esta categoría son profesionales y se realizan online, en estudios, eventos o lugares públicos o comerciales.'],
      },
    ],
  },
  {
    id: 'prohibited-services',
    name: 'Servicios Prohibidos',
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
          'Las experiencias y solicitudes pasan por una revisión automática básica que bloquea los casos claros y marca los dudosos para que el creator y el equipo los revisen. Los usuarios pueden reportar cualquier perfil, experiencia o reserva. Las infracciones pueden suponer la retirada de la experiencia y el cierre de la cuenta.',
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
        heading: 'Políticas que elige el creator',
        bullets: Object.values(CANCELLATION_POLICIES).map((p) => `${p.label}: ${p.summary}`),
      },
      {
        heading: 'Antes del pago',
        paragraphs: ['El fan puede cancelar una solicitud pendiente, aceptada o con contraoferta sin coste. El creator puede rechazarla.'],
      },
      {
        heading: 'Reembolsos e incumplimientos',
        bullets: [
          'El creator no se presenta, llega más de 15 minutos tarde, cambia por su cuenta la fecha, la hora o el lugar, o la experiencia no corresponde a lo publicado: el fan recibe el reembolso completo, previa verificación.',
          'Live 1:1 y videollamadas: si el creator no entra a la sala en los primeros 10 minutos, o la sesión no se puede dar por un fallo de su lado, el fan recibe el reembolso completo.',
          'El fan es responsable de cumplir lo que el creator publicó: fecha, hora, lugar, requisitos y condiciones. Si no se presenta, llega tarde o no cumple los requisitos, se aplica la política de cancelación de la experiencia y el tiempo perdido no se repone.',
          'Para pedir el reembolso, el fan abre una revisión con "Reportar" en Mis reservas dentro de las 48 horas siguientes a la hora programada. El equipo revisa la reserva y lo que aporten ambas partes y resuelve en un máximo de 7 días.',
        ],
      },
      {
        heading: 'Créditos, regalos y contracargos',
        bullets: [
          'Los Créditos y los regalos no son reembolsables, salvo cobro duplicado, error técnico o cuando la ley lo exija.',
          'Si un fan abre un contracargo con su banco por una experiencia que sí se dio, la cuenta puede suspenderse mientras se revisa. El reembolso solo se descuenta al creator cuando el incumplimiento fue suyo.',
        ],
      },
      {
        heading: 'Modo de prueba',
        paragraphs: ['Mientras no haya un procesador de pagos real, no se realizan cargos ni reembolsos reales; los importes son de prueba y las revisiones se resuelven a mano.'],
      },
    ],
  },
  {
    id: 'community',
    name: 'Normas de la Comunidad',
    icon: 'fa-people-group',
    intro: 'Cómo nos tratamos en Fans Reserve.',
    sections: [
      {
        heading: 'Respeto',
        bullets: [
          'Trata a creators y fans con respeto; nadie está obligado a responder, aceptar ni continuar una conversación.',
          'Un regalo, una propina o una suscripción no dan derecho a nada que no esté descrito.',
          'Sin acoso, presión, amenazas ni insistencia después de un rechazo.',
        ],
      },
      {
        heading: 'Seguridad',
        bullets: [
          'Las experiencias presenciales se hacen en lugares públicos o profesionales; en el lugar del creator o del fan solo servicios profesionales aprobados por el creator, y nunca en Tu gente. Nunca en hoteles ni lugares discretos.',
          'Las videollamadas y los Lives no se graban. Está prohibido grabarlos o capturarlos por cualquier medio: el video muestra el nombre de quien lo ve y una copia filtrada identifica a su autor.',
          'Mantén la comunicación y los pagos dentro de Fans Reserve.',
          'Reporta cualquier conducta que te haga sentir inseguro.',
        ],
      },
      {
        heading: 'Contenido',
        paragraphs: ['Glamour permitido. Contenido sexual explícito no permitido. Sin contenido que involucre a menores, violencia o discriminación.'],
      },
    ],
  },
];
