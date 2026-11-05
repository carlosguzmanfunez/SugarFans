# Asistencia y avisos de Reserve

Implementación para revisión. No publica cambios, no ejecuta pagos, no modifica saldos y no declara culpabilidad automáticamente.

## Recorrido

1. Solo una reserva virtual confirmada y con duración puede generar avisos. Se usa su zona horaria guardada, no la zona del servidor.
2. Se programan recordatorios diez minutos y un minuto antes para ambas partes. En un evento grupal, el creador recibe un aviso por sesión; cada fan recibe el suyo.
3. El aviso enlaza a la reserva autenticada e indica mantener el celular desbloqueado y Fans Reserve visible. El enlace no concede acceso a otra cuenta.
4. «Aceptar y preparar llamada» guarda la aceptación de las indicaciones y solicita juntos los permisos necesarios. La vista previa es privada; los filtros existentes se conservan. Un espectador de un evento no necesita publicar cámara o micrófono.
5. Al completar la preparación, se entra automáticamente desde un minuto antes, mientras la página esté visible. Se puede desactivar la entrada automática o cancelar la preparación; cancelar libera cámara y micrófono. El navegador conserva el control de sus permisos.
6. Antes de la hora acordada, la pantalla identifica el tiempo de preparación. Los intervalos compartidos del comprobante excluyen ese tiempo.
7. Se conservan las entradas y salidas firmadas por LiveKit. Las declaraciones del navegador, los avisos y la presencia comprobada son categorías separadas.
8. Fan y creador consultan y descargan la constancia desde su reserva. El administrador puede consultar la misma función, con autorización comprobada en la base.

## Regla comercial

- El tiempo que pierde el fan por ausencia, llegada tardía o problemas comprobados de su dispositivo no extiende la reserva ni se repone comercialmente.
- Las sesiones virtuales nuevas permiten al creador un minuto de tolerancia. Ese minuto no permite acortar el servicio: debe completar la duración contratada.
- Los fallos de Fans Reserve, el incumplimiento del creador y los derechos legales de reparación/devolución se revisan por separado.
- No se atribuye responsabilidad por el solo envío del aviso, un permiso rechazado, una pantalla oculta o la ausencia de un webhook.
- La versión `reserve-session-2026-11-04` se guarda en las reservas nuevas antes del pago. Las anteriores conservan su contrato y se señalan para revisión. Una aceptación operativa posterior no reemplaza retroactivamente su contrato.
- Los documentos de `/legal` siguen marcados como borradores sujetos a revisión legal. Este cambio no los convierte en una certificación jurídica.

## Evidencia y protección

| Registro | Qué demuestra |
| --- | --- |
| `reserve_session_reminders.created_at` | Se creó el recordatorio. |
| `push_attempted_at` | Se intentó entregar al servicio de avisos. |
| `push_accepted_at` | Al menos un servicio de notificaciones aceptó el envío; no prueba recepción o lectura humana. |
| `opened_at` | El navegador autenticado abrió el enlace; no prueba asistencia. |
| `reserve_session_events`, origen `browser` | Aceptación, preparación, permisos o incidencia declarada por el navegador, con hora del servidor. |
| Origen `livekit` | Evento con firma y huella del cuerpo validadas, identidad y sesión del participante, horario y sala autorizados. |

No se guardan grabaciones, mensajes de chat, direcciones IP ni huellas del dispositivo en estas tablas. Los eventos no admiten UPDATE/DELETE, ni escritura directa desde cuentas de usuario o el rol de servicio. Las funciones autorizadas agregan eventos nuevos; nunca corrigen el pasado. Se mantienen RLS y permisos explícitos. El secreto de LiveKit solo existe en el servidor.

El resumen usa intervalos cerrados y confirmados, une las conexiones simultáneas de una misma persona y calcula su intersección. Una salida perdida o evidencia insuficiente produce revisión, no minutos inventados, ausencia automática, multa o devolución. Los sucesos recibidos fuera de orden se ordenan por su hora original. El proveedor puede agotar reintentos: conservar estos datos no garantiza ganar una disputa ni demuestra por sí solo la calidad de lo entregado.

La política de retención, las solicitudes legales de acceso/supresión y cualquier archivo o anonimización deben gestionarse de forma supervisada junto con el historial contractual y financiero; no se programa un borrado indiscriminado.

## Programación y publicación pendiente

Los enlaces públicos `/api/reserve-session` y `/api/reserve-session-webhook` se resuelven hacia `api/live-token.ts` mediante dos reglas de Vercel. Sus manejadores internos comienzan con `_` y conservan por separado la validación de sesión y la firma del proveedor. La aplicación sigue utilizando doce funciones dentro del plan actual; la plantilla de Pro conserva los mismos enlaces sin activar sus horarios. Las constantes públicas que Production ya utiliza son el respaldo cuando no existen variables explícitas; una URL QA explícita requiere su propia clave pública y no se sustituye por la de producción.

La migración instala la tarea `reserve-session-reminders` en Supabase Cron, cada minuto, con **el interruptor apagado y sin destino configurado**. No utiliza el cron diario de Vercel ni requiere modificarlo. La ejecución no puede prometer entrega exacta al segundo: depende de la ronda, de la red, de los permisos y del sistema del teléfono.

Orden de preparación de un entorno QA aislado:

1. Aplicar la migración `20261105053851_reserve_session_attendance_reminders.sql` en QA y publicar conjuntamente los cambios de servidor y cliente en su versión de revisión.
2. En el proyecto LiveKit de QA, registrar `/api/reserve-session-webhook` de esa versión. Debe usar la misma clave de firma que `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` de QA. Un webhook de producción no se usa para simular asistencia.
3. Configurar `reserve_session_settings.delivery_base_url` con el origen HTTPS de **esa versión QA**, sin rutas ni barra final. Los nuevos recordatorios jamás usan el destino histórico de producción de `app_base_url()`.
4. Comprobar los avisos desde dispositivos de prueba, su inscripción y permisos. En iPhone se requiere una web app añadida a la pantalla de inicio compatible con Web Push.
5. Habilitar `reminders_enabled` únicamente en QA y comprobar la ejecución real de Cron. Publicar o habilitar en la base principal es un paso separado.

Los recordatorios de diez minutos caducan al entrar en la ventana del recordatorio de un minuto; los de un minuto caducan al comenzar la sesión. Se comprueba de nuevo que la reserva siga confirmada y conserve el horario antes del envío. El teléfono descarta una notificación que ya haya vencido. La ronda recupera hasta tres intentos sin aceptación, mientras el aviso siga vigente; si se agotan, quedan como pendientes para revisión. El aviso de un minuto puede agotar su breve ventana antes del siguiente intento: nunca se inventa una entrega.

Para detener los avisos, desactivar `reminders_enabled`. Los registros se conservan. Este control no toca la ejecución de pagos ni el saldo de creadores o fans.

## Consulta desde Administración

`/admin?section=attendance` abre **Asistencia de Reserve**. Permite buscar por creador, fan, título o referencia y filtrar las fechas en hora de Fans Reserve (UTC−6). La consulta usa páginas de veinte reservas virtuales con duración; las canceladas aparecen cuando conservan registros. No enumera experiencias presenciales ni solicitudes todavía sin confirmar.

Cada reserva muestra su estado de conexión. La constancia detalla entradas, salidas, tiempo compartido comprobado y estado de los avisos. Puede descargarse como texto legible. Falta de evidencia, datos incompletos, duración menor y condiciones anteriores exigen revisión; no se convierten en una ausencia, multa o devolución automática. Los datos corresponden al horario actual guardado para la reserva. Los eventos históricos permanecen protegidos en la base.

La migración `20261105215719_reserve_admin_attendance.sql` añade solo una consulta administrativa: valida `auth.uid()` y `is_admin()` (incluida la verificación adicional de la cuenta), fija `search_path`, limita intervalo/página/búsqueda y revoca ejecución anónima y del rol de servicio sin identidad. Los nombres provienen de la reserva; no entrega correos, mensajes privados ni permisos de lectura directa de las tablas de asistencia. La API usa el token del administrador y el enlace existente, sin crear una función adicional de Vercel ni emplear su clave de servicio para saltar la autorización.

El panel distingue carga, fallo y búsqueda vacía, descarta respuestas antiguas, conserva el acceso aunque falle la consulta general de contenido y mantiene la sección al recargar. La hora de evaluación procede de la respuesta del servidor. No permite editar constancias ni resolver responsabilidades desde este apartado.

Pruebas: `test:admin-reserve-attendance`, `test:admin-reserve-attendance-db` y `test:admin-reserve-attendance-ui`. La revisión visual ficticia se sirve con `node e2e/admin-reserve-attendance-review.mjs`, después de compilar la aplicación. Sus ejemplos están exclusivamente en archivos de prueba y no se cargan en el panel publicado con datos reales.

## Ensayo publicado en QA, 4–5 de noviembre de 2026

Se instaló la actualización únicamente en Supabase `pcxblbctafwmijfcwgdd` y se publicó una aplicación separada en `fansreserve-reserve-qa.vercel.app`. LiveKit usa el proyecto exclusivo `fansreserve-reserve-qa`, con su receptor firmado en `/api/reserve-session-webhook`. No se sustituyó el proyecto de reportes `fansreserve-payouts-qa` ni se configuraron proveedores de pagos en esta aplicación.

Se comprobó autenticación real de Supabase, preparación móvil y escritorio, entrada automática y entradas/salidas firmadas de LiveKit Cloud. Dos receptores virtuales comprobaron la firma y descifraron los cuatro avisos de ambas personas. El primer aviso ejercitó la recuperación: los dispositivos se registraron después de su creación. La invitación de un minuto se recibió por Realtime y abrió la reserva correcta. Esto no certifica recepción en teléfonos físicos ni que una persona haya prestado los quince minutos completos de la experiencia.

Se detectó un reloj local adelantado aproximadamente diecinueve segundos. El cliente ahora sincroniza la hora con `/api/reserve-session`, mantiene el tiempo transcurrido con un reloj monotónico y vuelve a comprobarlo al mostrar la pantalla. La hora pública no revela datos de reservas ni consulta la base. Se repitió el recorrido con un equipo cinco minutos adelantado y otro cinco minutos atrasado: ambos entraron a las 00:09:02 de Tegucigalpa para una reserva de las 00:10. Los avisos dentro de la aplicación usan la misma referencia.

Al terminar se apagó `reminders_enabled`, se cerró el receptor temporal y se retiraron sus dos suscripciones ficticias. Se conservan las constancias QA. La base principal y la rama `main` no fueron modificadas. Antes de publicar quedan la comprobación en celulares físicos, la revisión de las dependencias antiguas detectadas por `npm audit` y la autorización de publicación.

## Comprobaciones locales

Continuación del 5 de noviembre: el trabajo anterior se integró sobre la versión principal que incluye las correcciones legales #159/#161 y la pantalla completa móvil #151. Se conserva la devolución completa cuando cancela el creador y el funcionamiento de la pantalla completa; la regla virtual nueva se separa de las condiciones de reservas anteriores. React Router y las herramientas de compilación quedaron actualizados y la auditoría completa de dependencias terminó sin alertas registradas. La integración también se comprueba con todas las migraciones en PostgreSQL local y con los avisos de suscripciones de #160.

- `npm run test:reserve-session-api`: firma real del SDK, rechazos, límites, cómputo de tiempos, zonas horarias y conservación de contratos anteriores.
- `npm run test:reserve-session-db`: PostgreSQL local desechable con todas las migraciones, permisos, roles, avisos, eventos grupales, recuperación del horario e invocaciones concurrentes independientes.
- `npm run test:reserve-session-native`: servidor LiveKit local con webhooks firmados y Chromium con cámara y micrófono ficticios; recorre móvil/escritorio, preparación, espera, entrada, salida, rechazo de permisos e invitación.
- `npm run test:push`: servicio HTTPS local que recibe los envíos Web Push cifrados; comprueba vencimiento, rechazo de reservas canceladas y recuperación de un error temporal.
- `npm run test:access`, `npm run test:reserve-time-zones-db`, `npm run typecheck` y `npm run build`: regresiones y compilación.

Para las pruebas PostgreSQL hay que definir `PGHOST=127.0.0.1`, el puerto del servidor local y un usuario de prueba. El arnés rechaza servidores remotos y solo crea bases desechables con prefijo `fr_`. Para el ensayo nativo hay que indicar `LIVEKIT_SERVER` con la ruta del binario local de LiveKit verificado. No utiliza PayPal, cuentas comerciales reales ni datos de producción.

Referencias: [eventos y entrega de LiveKit](https://docs.livekit.io/home/server/webhooks/), [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart), [Protección al Vendedor de PayPal Honduras](https://www.paypal.com/hn/legalhub/paypal/seller-protection?locale.x=en_HN), [reglamento de protección al consumidor de Honduras](https://www.tsc.gob.hn/web/leyes/Acuerdo-084-2021.pdf).
