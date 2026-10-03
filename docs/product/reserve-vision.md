# Reserve: visión de producto

> **North star:** Fans Reserve allows fans to follow, subscribe to and interact with creators, while Reserve enables structured, creator-controlled access to experiences.

Estado: en modo de prueba. Los pagos de Reserve son simulados y **no** están listos para producción. Las políticas de este documento y de `/legal` son borradores: *Requires legal review before production launch.*

## 1. Filosofía

**Fans Reserve permite reservar experiencias, no personas.**

Una Reserve es siempre una experiencia concreta, descrita de antemano por el creator: qué es, cómo se hace, cuánto dura, cuánto cuesta, cuándo y dónde ocurre, qué incluye, qué no incluye y bajo qué reglas. El creator decide si la acepta. Nada en la plataforma se compra "por tiempo con alguien".

## 2. Los cuatro pilares

| Pilar | Qué da | Qué no da |
|---|---|---|
| **Discover / Seguir** | Gratis: contenido público y novedades. | Acceso exclusivo. |
| **Subscribe / Suscribirse** | Contenido exclusivo del creator. Puede haber un descuento explícito en Reserve. | Videollamadas ni experiencias de Reserve. |
| **Live** | Sesiones en vivo en la sala privada de Fans Reserve (hoy: las sesiones virtuales reservadas en Reserve). | — |
| **Reserve** | Una experiencia definida, aprobada por el creator, con fecha, precio y reglas. | Compañía, citas ni nada fuera de lo descrito. |

El perfil del creator muestra los cuatro en ese orden (`AccessLadder`) y una sección destacada "Reserve con {creator}".

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
- Hotel o residencia privada como lugar de la experiencia.
- Escort o acompañamiento.
- Cualquier actividad sexual.
- Lives sexuales o sexting remunerado.

Tampoco se permiten:

- lugares: domicilios, habitaciones de hotel, cuartos privados ni vehículos;
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

- Las experiencias presenciales solo se hacen en venues y lugares públicos o profesionales.
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
