# Devoluciones parciales: primera entrega

Rama aislada; no aplicada a Supabase ni publicada. Requiere `20261023155345_partial_refund_accounting.sql` antes del servidor y cliente. No habilita pagos ni modifica cron o tarifas.

## Alcance

Los avisos firmados `PAYMENT.CAPTURE.REFUNDED` y `PAYMENT.SALE.REFUNDED` se guardan antes de consultar el comprobante actual de PayPal. La API consulta rutas construidas con IDs validados, no URLs del aviso. Comprueba la devolución, su cobro padre, importe original, USD y una venta única. Los comprobantes individuales son inmutables y únicos por entorno, aplicación y devolución. Un mismo aviso con otro contenido conserva el original y abre revisión.

La venta conserva importe, fecha, comisión de cobro y participación originales. Se añaden importe devuelto, comisión devuelta comprobada y reducción de la ganancia. Una devolución parcial ordinaria conserva estado `paid`; una devolución acumulada total utiliza también el procedimiento existente para cancelar Reserve o terminar la suscripción. El fallo de cancelación posterior a confirmar SQL puede reintentarse sin repetir el débito.

## Cálculo

Se conserva la participación neta implícita en la venta original, sin recalcular niveles, premios o tarifa del proveedor:

```
participación neta original = importe original × creator_share / (importe original − comisión original)
pérdida del creador = mínimo(ganancia original, (devoluciones únicas − comisiones devueltas comprobadas) × participación neta original)
ganancia restante = ganancia original − pérdida del creador
```

La cobertura aprobada por Fans Reserve conserva la ganancia original. El redondeo del saldo sigue siendo acumulado; el diario registra revisiones, no sobrescribe asientos. El bono por invitación sigue la misma reducción neta del origen.

Ejemplo de prueba: venta USD100, comisión original USD5, ganancia original USD76. Una devolución de USD20 sin comisión reintegrada deja USD60 para el creador. Si el comprobante confirma USD1 de comisión reintegrada, deja USD60,80. Son datos de prueba, no tarifas comerciales prometidas.

El ensayo de integración con todas las migraciones también verifica la fórmula que actualmente genera el repositorio: la propina USD100 usa USD5,70 de comisión estimada y reconoce USD75,44. Tras devolver USD20, quedan USD59,44. `sale_gateway_fee` actualmente recupera el costo real del pedido solo para Reserve; revisar propinas y suscripciones en el punto 3, sin cambiar aquí su modelo o tarifas.

## Retenciones y excepciones

- La devolución parcial abre expediente de causa/cobertura y retiene solo al creador afectado. Un cambio de evidencia invalida la evaluación anterior. Un expediente parcial no puede cerrarse antes de evaluar cobertura.
- Una reserva previa conserva su importe y pasa a revisión. Un pago ya confirmado no se deshace: la reducción puede dejar deuda visible.
- Dos avisos de una misma devolución no duplican el descuento. Si PayPal ya informa devolución total y faltan comprobantes individuales, se conserva el aviso pendiente y la retención hasta completar las evidencias.
- Créditos totalmente devueltos conservan el procedimiento previo de reversión de billetera/regalos. Créditos parcialmente devueltos, descuentos Reserve, contratos con servicio/impuestos y bases históricas incompletas requieren revisión supervisada. Se conserva la compra completa y se bloquea nuevo gasto en regalos mientras una devolución de Créditos siga en revisión; los creadores expuestos se retienen.
- Los casos pendientes/revisión no se dan por resueltos automáticamente. La liberación de retenciones exige conciliar sus avisos y documentar la evaluación correspondiente.

## Validación

- `npm run test:partial-refunds`: SQL real en PGlite y API real con toda la red simulada; cálculos, duplicados, avisos fuera de orden, fallo SQL/HTTP, suscripciones, reservas, pagos previos, cobertura, Créditos y permisos.
- `node e2e/partial-refunds-postgres.mjs`: PostgreSQL desechable **local**, todas las migraciones del repositorio y dos conexiones independientes aplicando el mismo comprobante. Requiere PGHOST local, PGPORT, PGUSER y `psql` en PATH. Crea y elimina únicamente `fr_partial_refunds_test`.
- `node e2e/paypal-api.mjs`, comprobación de tipos, compilación y seguridad de la revisión programada.

Las pruebas no envían dinero ni llaman a PayPal/Supabase remotos. No certifican una devolución nativa Sandbox.

## Continuación y condición de publicación

La misma rama incorpora ahora el registro durable de cobros, renovaciones, disputas y reversiones, con recuperación administrativa. Véase [avisos y recuperación](income-event-reconciliation.md). Requiere también `20261023164424_income_event_reconciliation.sql` antes de publicar servidor y cliente.

La continuación reemplaza la reversión total del manejador legado de disputas por comprobantes individuales; las pruebas cubren resoluciones a favor del comprador con devolución parcial. Sigue pendiente el procedimiento específico de resolución para las excepciones de Créditos, descuentos y contratos especiales retenidas. No declarar resueltas esas excepciones con las pruebas ordinarias ni presentar la rama como automatización completa.

No ejecutar pagos reales para verificar una migración. Mantener `execution_enabled=false` y `batch_handoff_enabled=false`.

Referencias: [devoluciones PayPal](https://developer.paypal.com/checkout/refund-payment), [comprobante de devolución](https://developer.paypal.com/api/payments/v2/refunds-get), [especificación oficial](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/payments_payment_v2.json).
