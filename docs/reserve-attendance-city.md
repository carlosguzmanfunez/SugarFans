# Reserve presencial por ciudad de asistencia

El fan elige el país y la ciudad donde asistirá, aunque viaje desde otro lugar. Confirma que podrá asistir allí. Ve únicamente las experiencias presenciales de ese destino y todas las virtuales. El país del documento del creador y el país de registro del fan no cambian.

## Reglas de la experiencia

- El creador indica país, departamento o estado y ciudad **de la experiencia**, que pueden ser distintos de su residencia.
- El fan elige entre los destinos publicados. Los nombres iguales se distinguen por país y departamento o estado. Acentos, mayúsculas y espacios no cambian la coincidencia.
- La selección se comparte entre Reserve, el perfil, próximos eventos y las experiencias elegibles para tickets. El visitante la guarda en su navegador; al entrar, la cuenta requiere su propia confirmación y la conserva entre dispositivos.
- Antes de reservar y antes de pagar, el fan confirma expresamente que asistirá en persona. Las solicitudes personalizadas presenciales también exigen que el creador tenga una experiencia presencial publicada en ese destino.
- La ciudad confirmada queda en la reserva. Cambiar la ciudad para otro viaje no invalida esa reserva ni impide cancelarla.
- El lugar de una reserva solicitada no se cambia después: se cancela y se acuerda otra. Cambiar el lugar de la oferta afecta las nuevas reservas; las anteriores conservan lo acordado.
- No se utiliza GPS, seguimiento de ubicación ni una deducción por nacionalidad. Es una declaración de asistencia; no certifica la presencia física de la persona.

## Protección antes del cobro

`20261031051239_reserve_attendance_city.sql` agrega funciones con permisos explícitos y búsqueda de esquemas fijada. No crea pagos, no cambia saldos ni activa los envíos automáticos.

| Entrada | Comprobación |
| --- | --- |
| Reserva normal, evento o ticket | El servidor copia el destino de la experiencia y exige que coincida con la selección confirmada del fan. |
| Solicitud personalizada presencial | El destino seleccionado debe coincidir con la ciudad solicitada y con la cobertura publicada del creador. |
| Cotización PayPal | La reserva debe pertenecer al fan, estar aceptada y conservar su destino confirmado. |
| Captura PayPal | Revisa el pedido guardado y su propietario, sin aceptar un tipo o una reserva sustitutos desde el navegador. |
| Créditos o confirmación de un ticket | El cambio de estado también comprueba la asistencia. Un rechazo revierte toda la operación. |
| Pedido incierto o anterior | Conserva su referencia; no envía una devolución ni crea otro pedido para superar el bloqueo. Puede recuperarse después de confirmar el destino. |

La selección de la cuenta vive en `profiles.settings.reserveAttendance`. La reserva guarda `details.country`, `details.region`, `details.city` y `details.attendance`. Los clientes no reciben permisos de escritura directa sobre las reservas. Los métodos nuevos son `reserve_select_attendance_city`, `reserve_confirm_booking_attendance` y `reserve_assert_order_attendance`.

## Datos anteriores y publicación

La migración no reescribe ofertas ni reservas históricas. Las ofertas presenciales sin país o departamento quedan ocultas para fans y no aceptan nuevas reservas. Su creador puede verlas y completar esos datos desde el editor. No se infieren a partir del documento de identidad.

Una reserva antigua sin destino suficiente debe aclararse antes de cobrar. Si pertenece a una oferta con país y departamento ya completados y conserva la misma ciudad, el fan puede seleccionar ese destino y confirmar desde Mis reservas. Una solicitud personalizada antigua sin país no se completa por suposición; se acuerda una nueva reserva. Las reservas ya pagadas mantienen su historial y su cancelación.

La API nueva requiere las funciones de esta migración: instalar y comprobar primero en QA, luego publicar base y aplicación de forma coordinada. Si falta la comprobación, la captura se detiene antes de llamar a PayPal. No fusionar o desplegar a producción sin revisar la migración y el inventario de ofertas anteriores.

## Validación reproducible

- `npm run typecheck` y `npm run build`.
- `npm run test:reserve-city-db`: PostgreSQL local desechable con **todas** las migraciones, sesiones y permisos. Requiere `PGHOST=127.0.0.1`, `PGPORT`, `PGUSER` y `psql` en PATH; nunca acepta un servidor remoto. Crea y elimina solo `fr_reserve_city_test`.
- `npm run test:reserve-cancellation-db` y `npm run test:reserve-time-zones-db`: regresiones de cancelaciones, Créditos, tickets y horarios.
- `npm run e2e:paypal`: proveedor y Supabase simulados; comprueba que el rechazo precede a la captura y que se recupera la misma referencia.
- `npm run test:reserve-city-ui`: aplicación offline real en escritorio y celular, con solicitudes externas bloqueadas. `RESERVE_CITY_OUTPUT` permite elegir dónde guardar capturas y resultados.
- `.github/workflows/reserve-city.yml`: repite base de datos y recorrido visual en las propuestas de cambio, sin secretos de proveedores ni conexiones de producción.

Las pruebas locales de la interfaz usan el backend offline; las pruebas SQL ejecutan las funciones reales en PostgreSQL. No equivalen a una prueba conectada en Supabase QA ni a un cobro nativo en PayPal Sandbox.
