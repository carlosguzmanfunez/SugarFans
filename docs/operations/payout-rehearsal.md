# Ensayo virtual de lotes programados

El volumen inicial solicitado es de **1.000 creadores por ciclo**. La pantalla «Ensayar un lote con datos ficticios», dentro de Pagos a creadores, permite practicar sin usar destinatarios reales ni registrar movimientos. No recibe un adaptador financiero y no hace llamadas a PayPal, correo o base de datos. No almacena el ensayo al recargar; permite descargar un JSON identificado como virtual, sin valor de orden de pago, comprobante de entrega o asiento contable.

## Qué se practica

- Calendario de Honduras: ganancias del 26 al 25, pago desde el 26 hasta terminar el día 1 siguiente. Un ingreso registrado exactamente a las 00:00 del 26 pertenece al siguiente ciclo.
- Lista ficticia de hasta 1.000 creadores, presupuesto y margen para comisiones. El ejemplo parte de ganancias ya calculadas: $100 por creador, $2 de costo estimado de retiro, $98 netos y techo de comisión de $5. No se vuelve a restar la comisión de la plataforma.
- Comparación entre la frecuencia diaria publicada y propuestas por hora, cada 15 minutos o cada cinco minutos, con cinco, 25 o 50 casos por ronda. Cambiar una propuesta no cambia la programación ni las puertas reales.
- Pausar/reanudar el ensayo, identidad pendiente, destinatario pendiente, mínimo, disputa, fondos insuficientes o evidencia vencida a las 24 horas.
- Una respuesta perdida conserva su referencia y presupuesto. Simular una confirmación no inicia otro envío. Los bloqueos no tienen un botón que los libere sin evidencia.

La pantalla es un modelo ilustrativo para planificación. Sus estados «confirmados» son ficticios. Las pruebas independientes siguientes ejercitan la API programada y el SQL vigente; no utilizan el simulador como sustituto del ejecutor.

## Prueba repetible del ejecutor

1. `npm run test:payout-rehearsal`: calendario, centavos, capacidad, fondos, pausa, referencias y exportación del simulador.
2. `npm run test:payout-batch-rehearsal`: 1.000 creadores sintéticos con PostgreSQL temporal y la API real de `/api/payout-job`. Todos los transportes se interceptan; una dirección no prevista se rechaza. No lee claves, inicia sesión ni conecta a servicios externos. `PAYOUT_TEST_CREATORS` admite entre 10 y 1.000 para depuración; la aceptación usa el valor por defecto de 1.000.
3. `npm run typecheck`, `npm run build`, `npm run test:payout-rehearsal-ui` y `npm run test:payout-operations-ui`: integración y pantallas en escritorio y móvil. Se comprueba que practicar no invoque las operaciones reales del panel.
4. `npm run test:payout-capacity`: ampliación de 25 y 50 casos, espera persistida del proveedor, respuesta incierta, interrupción de la ronda y permisos. `npm run test:payout-pro-schedule` verifica el horario propuesto de cinco minutos contra el calendario de Honduras entre 2026 y 2028.
5. `npm run test:payout-isolation`: casos bloqueados, pendientes y fallos de preparación individuales no acaparan la lista. Comprueba que se conserven las reservas y que los casos sanos avancen, incluso dentro de la misma ronda.

El ensayo completo registra una entrega aceptada y un asiento confirmado por creador, sin duplicados al repetir la revisión. Comprueba la exclusión de ingresos posteriores al cierre, el calendario diario real, la recuperación de acuses perdidos, la respuesta 429 y los fondos insuficientes/vencidos. Los tiempos medidos corresponden solo al equipo y PostgreSQL temporal; no acreditan latencias ni capacidad de PayPal o Supabase alojado.

## Capacidad publicada y ampliación preparada

La configuración publicada procesa **hasta cinco elementos por revisión**, no cinco pagos garantizados. Cada consulta o evento pendiente consume un lugar. El lote interno tiene múltiples creadores, pero la integración envía **un destinatario por solicitud a PayPal**; no se cambió a una sola solicitud con mil destinatarios.

Una lista de mil requiere al menos 200 revisiones. La frecuencia diaria ofrece 35 lugares en la ventana de octubre y solo 20 en febrero de un año no bisiesto. Una revisión por hora tampoco cubre mil creadores en la ventana de octubre. La propuesta cada 15 minutos puede cubrir el escenario teórico sin incidencias, pero requiere dimensionar latencias, reintentos, fondos y supervisión.

El plan Hobby de Vercel admite una ejecución diaria y su hora puede variar dentro de la hora programada. La referencia de las 06:00 usada por el simulador no certifica el minuto de la revisión real. No se modificó el cron, no se contrató otro plan ni se activaron las propuestas. [Documentación de frecuencia y precisión](https://vercel.com/docs/cron-jobs/usage-and-pricing).

La ampliación prepara `PAYOUT_WORK_LIMIT` de 1 a 50 en el servidor, conservando cinco por defecto, y un ejemplo de programación Pro cada cinco minutos. Incluye reutilización de autorización, separación de solicitudes, rotación de casos y espera persistida ante errores del proveedor. Requiere aplicar primero `20261021191647_payout_provider_capacity.sql` y después `20261021200143_payout_work_rotation.sql`; la pantalla virtual por sí sola no requiere cambios en la base. La migración de capacidad se comprobó únicamente en QA; la de rotación, en PostgreSQL temporal. [Diseño, resultados y procedimiento de aceptación](payout-provider-capacity.md).

Las pruebas virtuales completaron 1.000 creadores en 40 rondas de 25 o 20 rondas de 50, sin duplicados. Antes de activar esa capacidad hay que repetir la carga en QA alojado, medir la duración por revisión y probar el envío completo con cuentas nativas de PayPal Sandbox. PayPal recomienda conservar identificadores de envío y usar avisos para seguimiento; sus límites efectivos deben observarse en la integración. [Payouts API](https://developer.paypal.com/api/payouts).

Las pruebas virtuales no conceden autorización comercial, no prueban recepción de dinero real ni sustituyen extractos. Siguen cerradas `execution_enabled`, `batch_handoff_enabled` y la activación del servidor. La simulación puede usarse mientras esos requisitos están pendientes.
