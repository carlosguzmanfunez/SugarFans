# Lotes de cincuenta y espejos de revisión

Cada cierre conserva su lote financiero original. Al apartarlo se asignan sus miembros a grupos estables de hasta 50 creadores. Mil miembros producen veinte grupos. Un último grupo puede tener menos de cincuenta; los creadores con importe positivo pero bloqueados al cierre también conservan su lugar.

Cada grupo tiene un **espejo de seguimiento**, con el mismo identificador y las referencias de los ítems y retiros originales. El espejo no es un segundo lote financiero, no añade reservas ni asientos, y no contiene instrucciones de envío. La integración PayPal continúa enviando un destinatario por solicitud; estos grupos son organización interna, no una implementación nueva de la API multiparte o de solicitudes con cincuenta destinatarios.

## Qué muestra cada lista

- **Pagos confirmados:** retiro en estado pagado con registro de confirmación en el ledger. Un pago aceptado o una respuesta recibida no bastan para presentarlo como entregado.
- **Espejo:** casos que requieren revisión y pagos que esperan confirmación. Cada uno muestra creador, importe previsto, motivo, siguiente paso y retiro o ítem original. Identidad, bloqueo, disputa y fallos de preparación se distinguen de la espera de confirmación.
- **Por atender:** miembros que todavía no se han procesado. No se presentan como pagos fallidos ni se añaden al espejo únicamente por no haber llegado su turno.

La consulta refleja la evidencia guardada en ese momento. Cuando se confirma el retiro, el mismo miembro aparece en la lista de confirmados; la pertenencia al grupo es inmutable. El espejo activo deja de mostrarlo, mientras se conservan el historial original de incidencias, consultas del proveedor y asientos. El CSV incluye la fecha de consulta para archivar un corte del informe; no es una orden de pago ni un extracto bancario.

**Atender este caso** abre el expediente ya existente de la incidencia, con su identificador y referencia originales. Prioriza incidencias del ítem y del aviso del proveedor, después las del retiro, la cuenta, su bloqueo o venta relacionada. Abrirlo no crea expedientes, autoriza envíos ni libera fondos. La decisión conserva la revisión de evidencia, responsabilidad, efecto y confirmación documentada del procedimiento existente. Si todavía no hay incidencia, la interfaz distingue el seguimiento normal de un envío pendiente de un caso que necesita «Revisar ahora» para registrar la causa.

Los grupos sirven para seguimiento y no imponen una barrera entre sí. El ejecutor mantiene la rotación de casos: si uno falla, los demás pueden avanzar. Las consultas y reintentos también consumen capacidad por ronda; no se prometen cincuenta entregas por invocación. Siguen vigentes las pausas comunes por proveedor, fondos, conciliación, ventana y autorización.

## Acceso y publicación

`finance_private.payout_groups` y `payout_group_members` tienen RLS y acceso directo revocado, incluso para el rol del servidor. Las funciones de consulta se limitan a cuentas administrativas mediante el control existente; los datos devueltos excluyen correos de destinatarios, payloads y credenciales. No se añaden botones de pago, liberación de reservas o eliminación de bloqueos.

Aplicar, en este orden, las migraciones de capacidad, rotación y `20261021203712_payout_group_mirrors.sql` antes de publicar el servidor y cliente del PR. La migración de espejos solo añade pertenencia para cierres existentes y engancha la creación al cierre nuevo; no reconstruye retiros ni cambia importes. Las tres están instaladas en QA alojado. El ensayo nativo confirmó 25 pagos en la primera muestra y 49 de cincuenta en la segunda, conservando un caso en revisión. La aceptación de cincuenta sin intervención sigue pendiente; ver [la evidencia y sus límites](payout-native-acceptance.md). Producción y las puertas de dinero siguen sin cambios.

## Pruebas

`npm run test:payout-group-mirrors` usa la API y SQL reales con 1.000 creadores sintéticos, PostgreSQL temporal y toda la red interceptada. Comprueba veinte grupos estables de cincuenta, membresías inmutables, idempotencia, consulta sin escrituras financieras y acceso administrativo. El escenario completa 997 pagos ficticios: lote 01 con 47 confirmados y espejo de tres, otros diecinueve grupos con cincuenta confirmados. Al resolver dos casos, el lote 01 pasa a 49 confirmados y un caso en el espejo, sin reenviar el pago previamente aceptado.

Una respuesta del proveedor que contradice la referencia original se presenta como revisión humana, conservando el estado y dinero inciertos. No se confunde con una espera normal de confirmación ni se declara pagada por haber recibido una respuesta HTTP correcta.

`npm run test:payout-group-mirrors-ui` comprueba escritorio y móvil, detalle del espejo, separación de los 47 confirmados, paginación de veinte grupos, actualización y exportación CSV protegida contra fórmulas. También comprueba la apertura y reapertura del expediente exacto cuando la misma cuenta tiene más de una incidencia, sin llamadas de escritura. La interfaz usa una muestra explícitamente ficticia y no invoca operaciones financieras ni red externa. Las regresiones del panel anterior, aislamiento y ejecutor se mantienen.
