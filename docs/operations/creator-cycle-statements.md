# Estado de cuenta del creador por ciclo

El creador consulta el estado actual de un ciclo que comienza el 26 a las 00:00 de Honduras y termina al empezar el 26 siguiente. La ventana de pago comprende del 26 al día 1 siguiente, ambos incluidos. La consulta no cambia las ganancias, los porcentajes, los costos ni las asignaciones.

## Qué explica

- Cada cobro conserva su valor, costo de PayPal y reparto originales. El costo aparece como comprobado, estimado o desconocido. Un costo desconocido no se interpreta como cero.
- Los regalos con Créditos y las bonificaciones aparecen por separado: no son otro cobro del mismo dinero al fan.
- Las devoluciones conservan el pago original. El estado muestra la reducción registrada y, cuando corresponde, la parte que Fans Reserve decidió conservar a favor del creador.
- En devoluciones supervisadas muestra únicamente los componentes numéricos guardados: costo de cobro, servicio e impuesto devueltos y proporción original del creador. No muestra las pruebas privadas ni las notas del administrador.
- Los ajustes documentados y los centavos del libro se presentan por separado. No se vuelve a cobrar la comisión de Fans Reserve al enviar un retiro.
- Un retiro puede utilizar ganancias de varios ciclos. El documento identifica cuánto saldo procede de este ciclo y muestra claramente que el importe entregado y el costo del retiro son los importes del retiro completo.
- «Sin asignar» no certifica disponibilidad para retirar. Puede faltar el cierre o existir una revisión. Un importe negativo puede representar una reserva que debe reducirse; no demuestra por sí solo una deuda del creador.

## Ejemplo ficticio de USD100

El costo de cobro de este ejemplo es USD5; **no es una tarifa confirmada de la cuenta comercial**.

1. El fan paga USD100.
2. Se registran USD5 de costo por cobrar; quedan USD95 para repartir.
3. En el reparto ordinario, el 20% de USD95 son USD19 para Fans Reserve. El 80% son USD76 para el creador.
4. Si el retiro utiliza esos USD76, se aparta el costo de envío previsto según la política vigente. Si se aparta USD1, la entrega prevista es USD75.
5. Al conciliar el comprobante del envío, cualquier diferencia se registra con el procedimiento de ajustes existente. El retiro original no se sobrescribe y no se vuelve a aplicar el 20%.

Los contratos, regalos, invitaciones y recompensas pueden tener otros repartos. El estado utiliza lo que se registró en cada actividad.

Otro ejemplo ficticio explica una devolución con componentes especiales: de un cobro de USD100, el costo fue USD5, el servicio USD5 y el impuesto USD10. Quedaron USD80 para repartir; el creador tenía el 80%, USD64. Si se devuelven USD20, de los cuales USD1 corresponde al servicio y USD2 al impuesto, y PayPal no devuelve costo de cobro, la parte restante es USD17. El 80% de USD17 son USD13,60. La ganancia del creador queda en USD50,40, salvo una decisión de cobertura documentada. El estado lee esos componentes de la resolución guardada.

## Datos y permisos

`finance_creator_statement(date,uuid)` devuelve un documento JSON completo desde una consulta consistente a Supabase. No se basa en las primeras 20 ventas de la pantalla ni en el límite de filas de una consulta de PostgREST. La interfaz presenta páginas de 25 movimientos; el CSV incluye todos los movimientos de la consulta cargada.

Los importes de la ganancia y sus reservas se leen de `finance_sources` y de las asignaciones persistidas. Los centavos del libro se conservan. La fecha de envío no se usa para inventar a qué ciclo pertenece una ganancia. Si falta una venta en los libros, la consulta rechaza la descarga en lugar de ocultarla.

El creador solo consulta su cuenta. Un administrador autorizado puede indicar otra cuenta. Las personas sin sesión y las cuentas ajenas sin permisos son rechazadas. Los comprobantes privados y los correos receptores no forman parte del estado. Las notas exportadas se protegen contra fórmulas de hoja de cálculo.

La consulta refleja el estado actual, incluidas devoluciones posteriores. No es una copia certificada e inmutable del cierre, ni un extracto bancario ni una certificación fiscal. El historial de operaciones y las asignaciones originales se conserva en sus registros existentes.

## Comprobaciones y publicación

Pruebas locales: `test:creator-statement`, `test:finance-cycle-rehearsal` y `test:finance-controls`. Cubren límites horarios, más de 1.000 movimientos, reparto, devoluciones, cobertura, recuperación individual, retiros de varios ciclos, permisos y exportación.

El ensayo de cierre usa PostgreSQL local desechable. Una preparación de instrucciones se comprueba habilitando temporalmente su puerta dentro de una transacción local y volviéndola a apagar. No existe un proveedor HTTP en ese ensayo, y la base se descarta. No constituye una entrega nativa de PayPal.

Las cuatro migraciones de esta entrega se aplican en este orden, sobre una base con los controles de cobro y devolución ordinarios previamente instalados:

1. `20261024202221_supervised_refund_resolution.sql`
2. `20261024203212_payout_recipient_controls.sql`
3. `20261025052625_creator_cycle_statement.sql`
4. `20261025055225_creator_statement_refund_breakdown.sql`

La segunda retira la escritura directa de cuentas receptoras. Publicar después el cliente correspondiente. El primer registro conserva un único correo; únicamente el cambio de una cuenta ya registrada requiere escribirlo dos veces.

La publicación QA utiliza el proyecto existente `fansreserve-qa-payouts`, referencia `pcxblbctafwmijfcwgdd`, y el sitio separado `fansreserve-payouts-qa`. Las cuentas nuevas son ficticias; las copias públicas se limitan a esos ejemplos. Las puertas `execution_enabled` y `batch_handoff_enabled` permanecen apagadas. Esta entrega no cambia producción, el calendario del programador ni la autorización comercial.
