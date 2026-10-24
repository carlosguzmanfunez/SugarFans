# Costo comprobado de cobros antes del reparto

Preparado el 23 de octubre y verificado el 24 de octubre de 2026. Trabajo en rama `codex/verified-collection-cost`; no aplicado a Supabase remoto ni fusionado. Depende del PR 104 ya integrado. No activa pagos ni cambia el calendario o los porcentajes contractuales.

## Regla

Para nuevas propinas, suscripciones, renovaciones y Reserve, la API actual registra las ganancias después de comprobar cuánto retuvo PayPal en ese cobro individual. Un costo ausente no equivale a cero. El cobro queda pendiente, con su referencia y la respuesta consultada; no se calcula una ganancia usando una comisión inventada. Un cero explícito en un comprobante válido sí se acepta.

Ejemplo ficticio: fan paga USD 100 y el comprobante informa USD 3 de costo. Quedan USD 97. En el reparto ordinario, USD 97 × 80% = USD 77,60 para el creador y USD 97 × 20% = USD 19,40 para Fans Reserve. USD 3 + USD 77,60 + USD 19,40 = USD 100. Los USD 3 son un ejemplo de prueba, no una nueva tarifa comercial.

Las recompensas, bonos por invitación, descuentos de Reserve y reglas de cuentas especiales conservan sus fórmulas. Cambia el costo que reciben esas fórmulas, no sus porcentajes. El cobro por enviar después el retiro es otro concepto y mantiene la regla de Honduras publicada en el PR 104.

## Evidencia y caminos de entrada

- Capturas: consulta autenticada de captura v2 y pedido v2. Se utiliza `seller_receivable_breakdown.paypal_fee` en USD; se contrastan importe, total recibido y datos del pedido cuando están presentes. Deducciones ajenas o conversión no compatible requieren revisión.
- Suscripciones: consulta de venta v1 y suscripción. Se utiliza `transaction_fee`; si falta ese dato o la vinculación con la suscripción, se consulta además su historial autenticado y su `amount_with_breakdown.fee_amount`. No se toma un importe del aviso sin comprobarlo. Dos costos distintos requieren revisión.
- La confirmación del fan y la consulta inicial de suscripciones pasan por la misma conciliación que los avisos del proveedor. Sus avisos internos se identifican como `origin=provider-query`, con referencia estable; no se presentan como notificaciones firmadas.
- Una consulta desde la pantalla no inicia devoluciones. Ante fallo de escritura o costo ausente conserva el cobro pendiente y comunica «No repitas el pago». Los seguimientos monetarios del procesador firmado conservan sus controles existentes. No restaurar el antiguo bloque genérico que devolvía dinero después de cualquier error de registro.

La nueva tabla privada `finance_private.collection_receipts` conserva el primer comprobante, con entorno, aplicación, ID de cobro, importe y costo. Tiene RLS y no permite lectura ni escritura directa al navegador o a `service_role`. Sus filas rechazan edición y borrado. Los procesos autorizados de conciliación son quienes la usan.

La transacción nacida de ese comprobante queda marcada `collection_fee_status=verified` y conserva su referencia. Importe, reparto, costo, fecha y condiciones originales no se reescriben. Se permite la desvinculación del pagador cuando se elimina su cuenta, conservando las cifras financieras. Una referencia repetida no repite ganancias ni bonos.

Las funciones históricas de cumplimiento siguen siendo auxiliares restringidas al servidor y se conservan para compatibilidad. No utilizarlas como integración nueva: las rutas actuales de cobro pasan por `paypal_income_receive` y `paypal_income_apply`. Los datos ficticios locales y las filas sin un comprobante vinculado permanecen marcados como estimados.

## Historial, Créditos y pantalla

No se recalculan automáticamente las ventas antiguas. Si una consulta posterior encuentra un costo diferente al utilizado en una venta existente, conserva ambas evidencias, abre revisión y retiene al creador afectado. Resolver esa diferencia requiere un ajuste documentado, con su impacto en ganancias, bonos y devoluciones; esta entrega no autoriza esa corrección automáticamente.

El libro y su exportación distinguen «Costo de PayPal comprobado» de «Costo de PayPal estimado». El costo cero comprobado aparece como USD 0,00. Los avisos explican por qué falta el costo o por qué el historial necesita revisión. La sección agregada de compras de Créditos conserva su estimación anterior y ahora lo indica expresamente; no se redefine el reparto de regalos ni se cambia el valor de los Créditos en esta entrega.

## Verificación y publicación

- `npm run test:collection-cost-db`: todas las migraciones sobre PostgreSQL local desechable, el procesador real y la API real del fan; proveedor simulado. Comprueba propinas, suscripciones, historial, Reserve, descuentos, cuentas especiales, datos inválidos, dos conexiones independientes, repetición, recuperación, devolución parcial, permisos y eliminación de una cuenta. Requiere `PGHOST` local, `PGPORT`, `PGUSER` y `psql` en PATH. Solo crea y elimina `fr_collection_cost_test`. `FANSRESERVE_ADVISOR_BIN` permite ejecutar los asesores locales.
- `npm run test:collection-cost-ui`: componentes reales y exportación en móvil/escritorio, ejemplos locales, sin red externa.
- Compatibilidad: API PayPal, avisos y recuperación administrativa, devoluciones, libros, descuentos, tipos y compilación.

Aplicar `20261023193447_verified_collection_cost.sql` después de las tres migraciones del PR 104 y antes de publicar conjuntamente servidor y cliente. Mantener `execution_enabled=false` y `batch_handoff_enabled=false`. Verificar que las definiciones actuales coincidan con los puntos de comprobación del archivo; si no, revisar la diferencia antes de instalar. No modificar el historial de versiones remoto para forzar coincidencias.

Estas pruebas no acreditan una entrega, comisión o devolución nueva en PayPal Sandbox nativo. La autorización comercial y las condiciones específicas de la cuenta siguen pendientes. Un despliegue Preview con el código nuevo tampoco sustituye instalar primero la actualización en una base aislada.

Referencias oficiales consultadas el 23 de octubre: [venta y costo de PayPal](https://developer.paypal.com/api/deprecated/payments/v1/definitions/sale/), [capturas](https://developer.paypal.com/sdk/payment/v2/definitions/capture/), [especificación de suscripciones e historial](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/billing_subscriptions_v1.json), [funciones y permisos de Supabase](https://supabase.com/docs/guides/database/functions).
