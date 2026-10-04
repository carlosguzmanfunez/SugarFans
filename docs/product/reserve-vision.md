# Reserve: visión de producto

> **North star:** Fans Reserve allows fans to follow, subscribe to and interact with creators, while Reserve enables structured, creator-controlled access to experiences.

Estado: en modo de prueba. Los pagos de Reserve son simulados y **no** están listos para producción. Las políticas de este documento y de `/legal` son borradores: *Requires legal review before production launch.*

## 1. Filosofía

**Fans Reserve permite reservar experiencias, no personas.**

Una Reserve es siempre una experiencia concreta, descrita de antemano por el creator: qué es, cómo se hace, cuánto dura, cuánto cuesta, cuándo y dónde ocurre, qué incluye, qué no incluye y bajo qué reglas. El creator decide si la acepta. Nada en la plataforma se compra "por tiempo con alguien".

## 2. Jerarquía de producto: Suscribirse y Reserve

> “Fans Reserve no busca reemplazar las redes sociales donde los creators construyen su audiencia. Fans Reserve existe para ayudarles a monetizar acceso, experiencias y relaciones estructuradas con esa audiencia.”

```
SUSCRIBIRSE
└── Subscriber Live        (Live grupal incluido en la suscripción activa)

RESERVE
├── Reserve Event          (experiencia grupal con fecha, duración, precio y plazas)
└── Reserve 1:1            (sesión privada: solo el fan y el creator de la reserva)

Open Live                  (Live público y gratis: conservado, DESACTIVADO por ENABLE_OPEN_LIVE)
```

| Nivel | Qué da | Qué no da | Quién entra a la sala |
|---|---|---|---|
| **Seguir** | Gratis: contenido público, novedades y la campanita. | Acceso exclusivo. | — |
| **Suscribirse** | Contenido exclusivo, **Subscriber Live** y beneficios del creator. Puede haber un descuento explícito en Reserve. | Reserve Events, sesiones privadas ni otras experiencias de Reserve. | Subscriber Live: el creator y fans con suscripción activa. |
| **Reserve Event** | Una plaza en una experiencia grupal (Q&A, masterclass, workshop, gaming…) con fecha, duración, precio y plazas limitadas. | Tiempo privado con el creator. | El creator y fans con plaza confirmada (aceptada y pagada). |
| **Reserve 1:1** | Una sesión privada definida, aprobada por el creator. | Compañía, citas ni nada fuera de lo descrito. | Solo el fan y el creator de esa reserva. |

Live no es un pilar propio: el Subscriber Live vive dentro de la suscripción y las salas de Reserve dentro de Reserve. La navegación es **Explorar, Suscribirse, Reserve, Para creadores, Cómo funciona**, y el perfil muestra Seguir → Suscribirse → Reserve (`AccessLadder`), la sección "Reserve con {creator}" agrupada en Reserve Events, Reserve 1:1 y otras, y "Próximo acceso" con el Subscriber Live en curso y los próximos Reserve Events.

CTAs: "Exclusivo para suscriptores", "Reserva tu plaza", "Reservar sesión privada". Nunca "Live gratis" mientras el Open Live esté apagado.

### Permisos (se aplican en el servidor)

- La decisión vive en `src/lib/liveAccess.ts` y la aplica `api/live-token.ts` antes de firmar el token de LiveKit; ocultar un botón nunca es control de acceso.
- **Open Live**: rechazado mientras esté apagado (403 en el token; `start_live` en la base de datos también lo rechaza).
- **Subscriber Live**: el creator publica; solo fans con suscripción activa reciben token (de solo ver). Los avisos van solo a suscriptores activos.
- **Reserve Event**: una sala por evento (`event-<experiencia>-<fecha>-<hora>`); el creator publica y los participantes con plaza confirmada miran y chatean. Una plaza por fan; plazas limitadas (`reserve_book_event_seat`).
- **Reserve 1:1**: sala `booking-<id>`; solo el fan y el creator de la reserva.
- Los regalos nunca dan acceso. La suscripción nunca da acceso a Reserve.

### Open Live: conservado y desactivado

El Open Live no se borró: LiveKit, `api/live-token.ts`, `live_broadcasts`, avisos, `follows.live_alerts`, migraciones, componentes y realtime siguen ahí. Para reactivarlo hay que encender los tres interruptores:

1. `VITE_ENABLE_OPEN_LIVE=true` en Vercel (interfaz: menú, pestaña y opción "Live abierto").
2. `ENABLE_OPEN_LIVE=true` en Vercel (servidor: el token de LiveKit).
3. En Supabase: `create or replace function public.open_live_enabled() returns boolean language sql immutable set search_path = '' as $$ select true $$;`

## 3. Gift vs Reserve

- **Gift**: apoyo voluntario. No garantiza respuesta, conversación, acceso ni experiencias de Reserve. No desbloquea nada: desde el 2 de octubre de 2026 ningún regalo da video personalizado ni videollamada; los videos y videollamadas ganados antes se siguen entregando. El Círculo y la Bóveda se eliminaron (decisión de Carlos: comprometían demasiado al creator).
- **Reserve**: compra o solicitud de una experiencia concreta.
- Los regalos **ya no** dan videollamadas privadas: las videollamadas son experiencias de Reserve. Las videollamadas ganadas con regalos antes del cambio siguen funcionando.
- El copy aparece en el diálogo de regalo, en el perfil y en la página Reserve (`RESERVE_COPY` en `src/config/reserve.ts`).

## 4. Control del creator

El creator define, por experiencia:

- tipo (solo los permitidos para su categoría), nombre y descripción;
- modalidad: virtual, presencial, evento o profesional;
- duración, precio y descuento opcional para suscriptores;
- días y horas (dentro de su disponibilidad general) y anticipación mínima;
- tipos de lugar permitidos, ciudad y venue;
- participantes máximos y requisitos (fans verificados, solo suscriptores);
- qué incluye, qué no incluye y condiciones extra;
- aprobación manual o automática (algunos tipos siempre manual);
- política de cancelación (flexible, moderada, estricta).

Y para cada solicitud puede aceptar, rechazar, pedir cambios o enviar una contraoferta de fecha, hora, precio o duración.

Panel del creator → pestaña **Reserve**:

- Mis experiencias.
- Crear experiencia: asistente de 14 pasos (tipo → nombre → descripción → modalidad → duración → precio → disponibilidad → ubicación → participantes → requisitos → aprobación → cancelación → vista previa → publicar).
- Solicitudes.
- Disponibilidad.
- Próximas.
- Historial.

## 5. Arquitectura de categorías

Todo es declarativo en `src/config/reserve.ts`:

- `CREATOR_CATEGORIES`: cada categoría declara sus experiencias permitidas, sus modalidades, sus tipos de lugar, los propósitos de la experiencia personalizada y, cuando aplica, su línea de contenido y sus restricciones. Los nombres antiguos (por ejemplo "Modelaje & Glamour", "Modelaje" o "Arte") siguen funcionando como alias.
- `RESERVE_EXPERIENCE_TYPES`: 44 tipos. Cada uno define sus modalidades, lugares, rango de duración, máximo de participantes y si requiere siempre aprobación manual.
- `LOCATION_TYPES` y `PROHIBITED_LOCATIONS`.
- `PURPOSES`, `RESERVE_STATUSES`, `CANCELLATION_POLICIES` y `RESERVE_COPY`.

Categorías: Modelos, Fitness, Cocina, Música, Gaming, Arte & Creatividad, Belleza, Lifestyle y Educación. No existen "+18", "Adultos", "Adult Content" ni "Sexy Creators".

La base de datos acepta exactamente la misma lista de tipos que la configuración. Un test e2e lo comprueba.

## 6. Modelos

*Glamour permitido. Contenido sexual explícito no permitido.*

**Permitido:**

- sesiones de fotos en estudio;
- asesoría de posado y portafolio;
- charlas de moda y belleza;
- meet & greet en eventos;
- apariciones;
- colaboraciones de marca;
- contenido personalizado;
- videollamadas 1:1 en la sala de la app.

**Lugares:** online, lugar público, venue de evento, convención, estudio y espacio comercial.

**Sí se ofrece:** servicios profesionales con propósito definido, también 1:1 (clase de cocina, coaching, entrenamiento, asesoría, sesión de fotos en estudio).

**No se ofrece:** compañía o "pasar tiempo conmigo" sin servicio definido, citas, hotel, residencia, escort ni actividad sexual.

## 7. Experiencias prohibidas (todas las categorías)

Los servicios profesionales con propósito definido sí se permiten, también 1:1. Lo prohibido es vender la compañía o la intimidad de una persona:

- Vender compañía o tiempo personal ("pasar tiempo conmigo") sin un servicio definido.
- Cita romántica o "date" remunerada.
- Compensated dating.
- Hotel, habitación o lugar discreto como lugar de la experiencia.
- Escort o acompañamiento.
- Cualquier actividad sexual.
- Lives sexuales o sexting remunerado.

Tampoco se permiten:

- lugares: habitaciones de hotel, cuartos privados ni vehículos; domicilios solo para servicios profesionales, en todas las categorías menos Modelos (lugar del creator o lugar que propone el fan, aprobación manual, decisiones de Carlos 2026-10-03);
- contacto o pagos fuera de la plataforma.

**Cómo se aplica.** La moderación está en `src/lib/moderation.ts` (cliente) y en `reserve_text_blocked` (servidor):

- Bloquea frases claras: servicios sexuales, escort, citas, hotel o noche, casa o domicilio en solicitudes, WhatsApp, Telegram, pagos por fuera, teléfonos y emails.
- Marca para revisión los casos dudosos (menores, términos ambiguos), que el creator ve en la solicitud.
- No censura palabras sueltas: entiende negaciones ("sin contenido sexual") y no bloquea "Essex" ni "como en tu casa" dentro de una descripción.

## 8. Experiencia personalizada

"Solicitar experiencia personalizada" tiene cinco pasos estructurados:

1. **Modalidad.**
2. **Propósito**, según la categoría y la modalidad.
3. **Fecha, hora, duración, participantes y lugar**, solo entre los tipos permitidos.
4. **Presupuesto.**
5. **Mensaje** (moderado), con un resumen antes de enviar.

El creator acepta, rechaza, pide cambios o envía una contraoferta. El fan acepta o rechaza la contraoferta. Al aceptarla, se aplican los nuevos términos y la reserva queda pendiente de pago.

## 9. Estados

| Estado | Etiqueta |
|---|---|
| `pending` | Solicitud pendiente |
| `countered` | Contraoferta del creator |
| `accepted` | Aceptada · pendiente de pago |
| `confirmed` | Confirmada |
| `completed` | Realizada (también se deriva de `confirmed` cuando ya pasó la hora) |
| `rejected` | Rechazada |
| `cancelled` | Cancelada |
| `reschedule_requested` | Reprogramación solicitada |
| `disputed` | En revisión |

Se reutilizan los estados de `vip_bookings`; los nuevos se añadieron a su `check`.

## 10. Seguridad y confianza

**Ya implementado:**

- Las experiencias presenciales se hacen en venues y lugares públicos o profesionales; en el lugar del creator o del fan solo servicios profesionales, nunca en Modelos.
- Requisito opcional de fan verificado.
- Anticipación mínima.
- Aprobación manual para los tipos sensibles.
- Moderación básica en cliente y servidor.
- "Reportar" en cada reserva confirmada o realizada.
- Motivos de reporte nuevos: servicio prohibido, no-show o cancelación.
- La sala en vivo solo existe para reservas virtuales.

**Pendiente** (se hará sin añadir complejidad invasiva):

- cola de moderación en admin para solicitudes marcadas;
- historial de cumplimiento por creator;
- check-in en eventos presenciales;
- contacto de emergencia;
- verificación del venue.

## 11. Flujo de pago futuro

Solicitud → Aceptación → Pago → Confirmación → Experiencia → Liquidación.

**Hoy:**

- `vip_pay_booking` simula el pago en modo de prueba y acredita al creator el 80% según las reglas de ingresos existentes. No se mueve dinero real.
- Wallet y Créditos (id interno `terrones`) no cambian.

**Para producción hará falta:**

- un PSP real (Stripe Connect o similar) con retención hasta que la experiencia se realiza;
- reembolsos según la política de cancelación;
- liquidación tras la experiencia;
- disputas;
- facturación e impuestos por país.

## 12. Áreas que requieren revisión legal

- Acuerdo de Creator (Reserve).
- Política de Reserve.
- Experiencias Aceptables.
- Servicios Prohibidos.
- Cancelación y No-show.
- Normas de la Comunidad.
- Responsabilidad en experiencias presenciales (seguros, venues, menores, permisos locales).
- Clasificación fiscal de los pagos de Reserve y de los regalos.
- Retención de fondos y reembolsos.
- Verificación de identidad de los fans (KYC) para experiencias presenciales.
- Tratamiento de datos de ubicación.
- Política de Glamour frente a las normas de app stores y procesadores de pago.
